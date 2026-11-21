# Architecture

## Overview

```
                     GRAPHFLOW WEB APPLICATION (Next.js)
                ┌──────────────────┴──────────────────┐
          USER DASHBOARD                       ACTIVITY SIMULATOR (/simulator)
   (React, TanStack Query, Recharts)        simulated desktop agent in the browser
                │                                      │ authenticated batches
                └─────────────┬────────────────────────┘
                              ▼
                   NEXT.JS ROUTE HANDLERS  (src/app/api/**)
     route() wrapper: request id → session / device-token auth → CSRF origin check
                 → capability check → rate limit → Zod validation
                              │
                       SERVICE LAYER  (src/services/**)  ── repositories (src/repositories)
                              │   every query inside withRls(actor) → SET LOCAL app.* context
                              ▼
                 POSTGRESQL  (graphflow_app role, RLS FORCED)
       raw_activity_events (JSONB) + activity_event_inbox (ledger)  ─── COMMIT
                              │
                              ▼ enqueue (jobId = raw event id)
                     REDIS + BULLMQ  "graphflow-events"
                              │
                              ▼
          BACKGROUND WORKER  (separate Node process, src/workers)
     inbox row lock (dedupe) → per-session advisory lock → rebuild session:
     sort events → reconstruct segments → idle → switches → clip overlaps →
     classify (deep focus, billable) → replace focus_events → collaboration links
                              │
                              ▼
                 POSTGRESQL normalized records
                              │
                              ▼
            ANALYTICS / BILLING / INSIGHTS / REPORTS services
                              │
                              ▼
                 Dashboards & exports — role-scoped by RLS
```

## Separation of responsibilities

| Concern | Location |
| --- | --- |
| Presentation | `src/app/(marketing|auth|dashboard)/**`, `src/components/**` — server components gate access, client components fetch APIs |
| API handling | `src/app/api/**/route.ts` — thin handlers using `route()` from `src/lib/api/handler.ts` |
| Authentication | `src/services/auth/*`, `src/lib/auth/*` — Argon2id, HMAC'd session tokens, server-side sessions |
| Authorization | `src/lib/permissions` (capability matrix) + service checks + PostgreSQL RLS policies |
| Event collection & validation | `src/lib/validation/events.ts` (strict schema), `src/services/events/ingestion-service.ts` |
| Raw storage | `raw_activity_events` (JSONB) + `activity_event_inbox` |
| Background processing | `src/workers/*`, `src/services/events/processor.ts` |
| Reconstruction (pure) | `src/services/events/reconstruction.ts`, `classification.ts`, `collaboration.ts` |
| Analytics | `src/services/analytics/metrics.ts` (pure), `analytics-service.ts` |
| Billing | `src/services/billing/billing-math.ts` (pure), `timesheet-service.ts`, `billable-audit-service.ts` |
| Insights | `src/services/insights/insights-engine.ts` (pure) |
| Reporting | `src/services/reports/*` (CSV, PDF via pdf-lib) |

Business logic lives in services; React components contain no business rules, and route handlers contain no business rules beyond input parsing.

## Key design decisions

**PostgreSQL is the source of truth; Redis is a delivery mechanism.** An event is acknowledged only after the raw row and its ledger row commit. Enqueueing happens after commit; if Redis is down the API still returns `202` with `queued: false` and the recovery scanner re-enqueues from the ledger. No distributed transaction is assumed.

**Rebuild-the-session processing.** Instead of incrementally mutating state per event, the worker rebuilds the whole session from all its accepted raw events and replaces its normalized rows in one transaction. This makes processing idempotent and independent of delivery order, and makes duplicate/late events harmless. Sessions are small (one device, at most a working day), so this is cheap.

**Evidence-based durations.** Segments end at the last observed event. Gaps longer than the heartbeat timeout close the segment at the last evidence. An open browser tab never creates time.

**RLS everywhere + application checks.** The application connects as `graphflow_app` (not superuser, no `BYPASSRLS`, owns no tables, `FORCE ROW LEVEL SECURITY` on all tenant tables). Each request runs in a transaction that sets `app.user_id`, `app.organization_id` and `app.user_role` with `set_config(..., true)`. Services still perform explicit authorization checks (defence in depth).

**Pure, testable engines.** Reconstruction, classification, friction, billing math, insights and timezone handling are pure functions with unit tests.

**JSONB for raw events.** A dedicated indexed table with a JSONB payload; the storage layer is isolated in the ingestion service and processor, so a different raw store could be introduced later if volume requires it.

**Extensible to a native agent.** `/api/events` accepts a device bearer token (`gfd_…`) as well as a session. A desktop collector only needs to emit the documented event schema.

## Processes

| Process | Command | Responsibilities |
| --- | --- | --- |
| Web | `npm start` / `node server.js` | UI, REST API, ingestion |
| Worker | `npm run worker` | Event jobs (concurrency 4), maintenance scheduler (stale-session sweep 1 min, recovery scan 30 s, billable audits 6 h, retention 24 h), health server `:9100/health`, Redis-independent fallback sweep |

## Timezones

All instants are stored in UTC (`timestamptz`). Day buckets, report periods and timesheet weeks use the organization's IANA timezone (`src/lib/utils/time.ts`, DST-safe, unit-tested).
