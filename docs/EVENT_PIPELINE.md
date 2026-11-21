# Event pipeline

## Event contract

`POST /api/events` (collectors: session cookie or `Authorization: Bearer gfd_…`) and `POST /api/simulator/events` (simulator, adds `runId` and optional target `userId`). Up to 200 events per batch. Schema: `src/lib/validation/events.ts` (strict).

```json
{
  "events": [
    {
      "eventId": "7d3c…",              // collector-generated UUID; re-sending is a no-op
      "type": "APPLICATION_SWITCH",
      "timestamp": "2026-11-02T09:41:00.000Z",
      "deviceId": "…", "sessionId": "…", "sequence": 42,
      "projectId": "…",                 // optional; null = unassigned
      "tool": "Code.exe",              // executable name
      "file": { "name": "app.tsx", "path": "~/work/app.tsx", "type": "tsx" },  // metadata only
      "idleSeconds": 3,                // seconds since last input (heartbeats)
      "simulated": true
    }
  ]
}
```

Types: `APP_OPENED, APP_CLOSED, APPLICATION_SWITCH, FILE_CONTEXT_CHANGED, FOCUS_STARTED, FOCUS_ENDED, IDLE_STARTED, IDLE_ENDED, PROJECT_CHANGED, SESSION_HEARTBEAT`.

## Ingestion (`src/services/events/ingestion-service.ts`)

1. Authenticate (route wrapper). 2. Organization membership (RLS hides other orgs). 3. Tracking consent. 4. Zod validation. 5. Device belongs to the user and is active (and matches the device token). 6. Project assigned to the user and `PLANNING`/`ACTIVE`. 7. Session id not owned by another user/device. 8. Timestamp within −7 days / +2 minutes. 9. In **one transaction**: create the session row if new, `INSERT … ON CONFLICT (organization_id, client_event_id) DO NOTHING` the raw JSONB event, insert the ledger row. 10. Commit. 11. Enqueue BullMQ jobs (`jobId` = raw event id). 12. Respond `202` with per-event `accepted | duplicate | rejected` (+ code).

The event is durable before acknowledgement. If Redis is unavailable, enqueue returns `false`, the response says `queued: false`, and recovery takes over.

## Processing (`src/services/events/processor.ts`, worker)

For each job, in a `SYSTEM`-context transaction for the event's organization:

1. `SELECT … FROM activity_event_inbox … FOR UPDATE` — if already `PROCESSED`/`SKIPPED`, return `duplicate` (handles duplicate jobs and concurrent workers).
2. Consent check at processing time (withdrawn before the event → `SKIPPED`).
3. `pg_advisory_xact_lock(session)` — serialises work on a session.
4. **Rebuild the session** from all accepted raw events (excluding `FAILED`/`SKIPPED`):
   - sort by `(timestamp, sequence, id)` → out-of-order delivery does not matter;
   - state machine → segments with one context each (tool, project, file, idle); repeated start/stop are idempotent; activity after a lost `FOCUS_STARTED` starts focus implicitly;
   - **missing heartbeats / disconnects**: a gap longer than `heartbeat_timeout_minutes` closes the segment at the last evidence;
   - **idle**: `IDLE_STARTED/ENDED`, or heartbeat `idleSeconds ≥ idle_timeout` (idle since `ts − idleSeconds`);
   - **context switches**: tool or project changes between real contexts;
   - **overlaps**: time already covered by the user's other sessions (e.g. two devices) is subtracted — never counted twice;
   - invalid/deleted project references become unassigned;
   - **classification**: `IDLE`, `UNASSIGNED`, `COLLABORATION` (communication tools), `ADMINISTRATIVE` (productivity/documentation tools), `ACTIVE_WORK`, promoted to `DEEP_FOCUS` when a same-project-same-tool run reaches `deep_focus_min_minutes` with interruptions ≤ `deep_focus_max_gap_minutes` (interruptions not counted);
   - **billability** from project billing rules + tool defaults/overrides;
   - file metadata upserted into `files`;
   - replace the session's `focus_events`; update session aggregates and status (`CLOSED` on `FOCUS_ENDED`, `TIMED_OUT` when neither events nor receipts arrived within the heartbeat timeout);
   - **collaboration links**: overlapping `COLLABORATION` intervals of two project members on the same project (project-level advisory locks).
5. Mark raw event + ledger `PROCESSED`.

On error the transaction rolls back; a separate transaction records `attempts`, `last_error` and status `RETRYING` (or `FAILED` on the 5th attempt). BullMQ retries with exponential backoff. Admins can re-queue `FAILED` events from Activity → Raw events.

## Reliability matrix

| Situation | Handling |
| --- | --- |
| Duplicate event | unique `(organization_id, client_event_id)` → `duplicate` |
| Duplicate job / concurrent workers | BullMQ `jobId`; inbox row lock; `PROCESSED` check |
| Failed job | attempts + error recorded; backoff retries; `FAILED` after 5 |
| Redis down at ingestion | event stored; `queued:false`; recovery scan re-enqueues from the ledger |
| Redis down in worker | jobs pause; fallback loop keeps closing stale sessions from PostgreSQL; on reconnect the scan re-enqueues |
| Worker restart / crash | processing transaction rolls back; startup recovery re-enqueues pending ledger rows |
| App restart | nothing in memory is required; the ledger is authoritative |
| Out-of-order events | full sorted rebuild |
| Missing heartbeats / device disconnect | close at last evidence; stale-session sweep marks `TIMED_OUT` |
| Repeated start/stop | idempotent state machine |
| Overlapping intervals | subtracted against the user's other sessions |
| Invalid project | rejected at ingestion; deleted later → unassigned |
| Consent withdrawn | ingestion 403; queued later events skipped |

## Simulator specifics

- One 250 ms timer; starting clears any previous timer; pause freezes the simulated clock; stop sends `FOCUS_ENDED` for open sessions; reset clears state.
- Accelerated runs are **back-dated**: the timeline ends no later than now (no future timestamps), and the server returns the latest free window before the employee's recent sessions so new runs never land on top of earlier ones.
- Events are submitted in order, one request at a time, in batches, and the UI shows ingestion status per event and backend processing status (polled from `GET /api/simulator/runs/{id}`).

## Trusted seed process

`prisma/seed.ts` (owner credentials, refuses in production) generates historical events with the same scenario library, inserts raw events + ledger rows, then calls the worker's `rebuildSession()` for each session and marks the events processed. It never writes `focus_events` directly. Events carry `simulated: true, source: "seed"`.

## Scheduled maintenance (BullMQ repeatable jobs)

| Job | Interval | Purpose |
| --- | --- | --- |
| `sweep-stale-sessions` | 1 min | rebuild/close sessions past the heartbeat timeout |
| `recover-events` | 30 s (`RECOVERY_SCAN_INTERVAL_SECONDS`) | re-enqueue ledger rows not processed |
| `billable-audits` | 6 h | per-project snapshot for yesterday (org timezone) |
| `retention` | 24 h | apply retention settings |
