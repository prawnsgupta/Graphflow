# GraphFlow upgrade — assessment and phased plan

Status: **proposal, awaiting approval. No upgrade code has been written.**

## 1. Existing system (inspected, not assumed)

| Area | Current state |
| --- | --- |
| Frontend | Next.js 15 App Router, React 19, Tailwind 4, shadcn/ui, Recharts, TanStack Query. Pages: landing, login, Overview, Employees, Projects, Teams, Activity, Billing, Simulator, Reports, Audit Logs, Settings |
| Backend | Next.js Route Handlers (`src/app/api/**`) → services → repositories. Session auth, RBAC, CSRF, rate limiting. Device bearer tokens (`gfd_…`) already exist for a future collector |
| PostgreSQL | 23 tables, UUID keys, RLS forced under non-superuser `graphflow_app`, append-only audit log, guard triggers. Consent is a boolean on `users` |
| MongoDB | **Not present.** Raw events currently live in PostgreSQL JSONB |
| Redis | BullMQ event queue + maintenance scheduler, rate limiting, worker heartbeat |
| Worker | Separate Node process. Rebuilds a whole session from raw events (idempotent, order-independent) and writes `focus_events` |
| Simulator | Browser-based, 5 scenarios, uses `/api/simulator/events` → same ingestion service |
| Event schema | `src/lib/validation/events.ts`, **strict**: 10 event types, metadata only; unknown fields rejected |
| Tests | 39 unit, 30 integration/RLS, 10 Playwright — all passing |
| Deployment | Docker Compose (postgres, redis, migrate, app, worker); image builds |

## 2. Conflicts and wrong assumptions in the spec

1. **"FastAPI receives events."** The backend is Next.js. Adding FastAPI would be a second API with its own auth, RLS context and rate limiting, which your own rule forbids ("no unnecessary microservices"). **Proposal:** keep ingestion in Next.js (`/api/collector/v1/*`). Use Python only where it earns its place: a local sidecar for webcam CV, and optionally OCR.
2. **MongoDB.** Today there is nothing in the workload that needs it. It becomes justified once screenshot-analysis, OCR observations and document analysis arrive: they are versioned, variable-shape documents. **Proposal:** add it for exactly those, and nothing else. Postgres stays authoritative.
3. **Raw keystroke recording (your point 2) conflicts with the spec's own section 3.3 and section 9.** A recorder of typed content captures passwords, codes and private messages. I will **not** build that. See section 3 below.
4. **Reading all files with "company" extensions.** The spec says an extension proves nothing about ownership. File content is read only inside approved company directories, only for approved extensions, only if the policy allows content extraction, never in excluded directories.
5. **"Real screen data instead of the simulator."** The spec also says keep the simulator. I will keep it, labelled separately (`source = SIMULATOR | COLLECTOR | IMPORTED`).
6. **Webcam in Rust or browser?** MediaPipe + OpenCV are Python/JS. **Proposal:** a local Python sidecar process started by the Tauri app, communicating over localhost, emitting only derived attention events. Raw frames never leave memory.

## 3. What I will and will not collect

| Signal | Will build | Will not build |
| --- | --- | --- |
| Keyboard | counts per interval, shortcut categories (copy/paste/save…), active/idle intervals | key content, typed text, anything that can reconstruct text |
| Mouse | click counts, scroll counts, movement intensity per interval | raw cursor trajectories |
| Screenshots | policy-driven capture, local OCR, structured result, auto-deletion of the image after analysis or short retention; sensitive windows excluded and regions redacted | hidden capture, continuous recording, uploading raw images by default |
| Files | metadata always (inside approved workspaces); content only inside authorised workspaces and approved extensions when the policy allows | personal files, excluded directories, anything outside the policy |
| Webcam | local face/head-pose/gaze/eye-state → attention events with confidence | raw video storage or upload |

Why aggregate counts are enough: the engine only needs "was the person actively interacting in this minute", which counts answer fully.

Consent: per signal (screen, interaction, files, webcam), recorded with timestamp and policy version, revocable at any time, with a persistent visible indicator and pause/stop in the desktop app. Ambiguous extensions or sites (a `.pdf`, a YouTube tab) trigger an employee prompt rather than an automatic guess.

## 4. Proposed architecture

```
Tauri 2 desktop collector (Rust)  ── local SQLite buffer (offline, idempotent)
   ├─ active window / app / idle   ├─ screenshot → OCR (local) → structured result
   ├─ input counters               ├─ file watcher (policy-limited)
   └─ webcam sidecar (Python: OpenCV + MediaPipe + solvePnP) → attention events
                     │ HTTPS, versioned schema, device token
                     ▼
        Next.js  /api/collector/v1/*   (auth, consent, policy checks, Zod)
                     │
          ┌──────────┴───────────┐
          ▼                      ▼
   PostgreSQL (truth)       Redis + BullMQ ─► workers
   sessions, consent,            │
   policy, timesheets,           ├─► MongoDB: observation documents
   billing, audit                └─► fusion engine → work sessions → PostgreSQL
                     ▲
                     └─ Redis cache + live status → dashboards
```

## 5. Database responsibility matrix

| Data | PostgreSQL | MongoDB | Redis |
| --- | --- | --- | --- |
| Users, orgs, teams, roles, projects, tasks | **owner** | | |
| Consent records, monitoring policies | **owner** | | cached copy |
| Work sessions, timesheets, billing, audit | **owner** | | |
| Approved activity summaries | **owner** | | |
| Screenshot analysis / OCR observations | reference id only | **owner** (versioned documents) | |
| Document analysis, model inference metadata | | **owner** | |
| Fusion evidence per session | summary | **owner** (detail) | |
| Event queue, retries | ledger row | | **owner** (BullMQ) |
| Live collector status, latest attention state | | | **owner** (TTL keys) |
| Rate limits, dashboard cache | | | **owner** |

Conflict rule: PostgreSQL always wins. If Mongo and Postgres disagree, Postgres is correct and the Mongo document is regenerated or marked stale.

Outage behaviour: Redis down → events stored in Postgres, recovery scan re-queues. Mongo down → business records and timesheets unaffected, observation writes retry from the queue, dashboards show "detail unavailable". Postgres down → nothing is acknowledged.

## 6. Multimodal engine

Rule-based first, as specified: temporal segmentation → per-signal confidence → weighted combination → state machine with smoothing. States: focused work, work (attention uncertain), looking away, work-related learning, work communication, personal, idle, unknown.

`P = ARS × ACS × A` is stored as an **experimental confidence value per segment**, never rolled into an employee score. Unknown stays unknown.

## 7. Phases (each ends with tests, a migration check, docs and a report)

| Phase | Deliverable | Notes |
| --- | --- | --- |
| 1 | **Database Infrastructure page** + MongoDB in Docker + Mongo client + health check + `source` labelling (simulator/collector/imported) | Safe, visible, no monitoring yet. Page shows the 3 DB cards, arrows, outage behaviour; live status from real health checks |
| 2 | Consent & Privacy v2 (per-signal consent, policy table, excluded apps/dirs, classification disputes) + collector API v1 + event schema v2 | Backend only; schema is versioned and backward compatible |
| 3 | Tauri desktop shell: pairing, tray indicator, pause/stop, SQLite buffer, sync with idempotency; active window/app/idle | Windows first (the platform on this machine) |
| 4 | Input counters + policy-limited file watcher | Aggregates only |
| 5 | Screenshot capture with exclusions + local OCR (Tesseract first; PaddleOCR later if accuracy demands) + Mongo observations + employee confirmation prompts | |
| 6 | Webcam sidecar: MediaPipe, solvePnP, EAR, iris gaze, calibration, smoothing, benchmark | Benchmark CPU/RAM before choosing FPS |
| 7 | Fusion engine → work sessions → timesheets | Existing worker extended, not replaced |
| 8 | Live Monitoring, Screen Intelligence, Attention Analytics, Unified Timeline pages | Role-scoped |
| 9 | End-to-end tests, performance, security review | Honest status of what is verified |

## 8. Decisions needed

1. Approve **no raw keystroke content** (aggregates only)?
2. Approve **keeping ingestion in Next.js** and using Python only as a local webcam/OCR sidecar, instead of FastAPI?
3. Approve **MongoDB** limited to observation/analysis documents?
4. Start with **Phase 1** (Database Infrastructure page + MongoDB)?
5. Windows-only collector first?

## 9. What I can and cannot verify here

I can build and test the backend, the web pages, the Rust agent's compilation, the policy logic and the Python pipeline on this Windows machine (it has Rust, Python and a camera). I cannot validate gaze accuracy across different people, lighting or monitors, or macOS behaviour. Any such claim will be stated as untested.
