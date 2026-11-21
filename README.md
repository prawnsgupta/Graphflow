# GraphFlow

**Creative workflow intelligence & billable-hour optimization.** GraphFlow reconstructs how people spend time across projects, tools and files from *permitted operational metadata*, detects deep focus, idle time, context switching and workflow friction, and turns tracked work into draft timesheets that go through an approval workflow into billing — with tenant isolation enforced by PostgreSQL Row-Level Security and a complete audit trail.

> This build ships an in-browser **simulated desktop agent**. Simulated activity travels through exactly the same authenticated API, validation, PostgreSQL storage, Redis/BullMQ queue and background worker that a future native collector will use. GraphFlow never collects screenshots, keystrokes, clipboard, messages, browser page contents or file contents.

---

## Contents

- [Features](#features)
- [Technology](#technology)
- [Quick start](#quick-start)
- [Demo accounts](#demo-accounts)
- [Commands](#commands)
- [Project structure](#project-structure)
- [Documentation](#documentation)
- [Implementation checklist](#implementation-checklist)

## Features

| Area | What you get |
| --- | --- |
| Event pipeline | Authenticated ingestion → Zod validation → consent / device / project checks → raw JSONB in PostgreSQL + processing ledger → BullMQ → separate worker → session reconstruction → normalized `focus_events` |
| Activity simulator | `/simulator`: 5 scenarios (deep design, interrupted development, idle period, collaboration, mixed admin), speeds 1×/5×/10×/60×/300×, start/pause/resume/stop/reset, live event log with ingestion and processing status |
| Analytics | Tracked/active/idle/deep-focus/billable time, context switching, friction, budget utilization — computed server-side, scoped by role |
| Insights | Deterministic rules with supporting metric, related entity and recommended action |
| Billing | Draft timesheets from activity, submit → approve / reject / request adjustment, append-only adjustment history, project billing rules (categories, tool overrides, rounding, approval), billable audits |
| Reports | 6 reports, CSV and PDF export, period + timezone stated, same authorization as the pages |
| Security | Argon2id, server-side sessions in HTTP-only cookies, CSRF origin checks, rate limiting, RBAC + PostgreSQL RLS under a non-privileged role, append-only audit log |

## Technology

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · shadcn/ui · Recharts · TanStack Query · React Hook Form + Zod · Prisma 6 · PostgreSQL 16 · Redis 7 + BullMQ 5 · Vitest · Playwright · Docker Compose.

## Quick start

Prerequisites: **Node.js 22+**, **Docker Desktop**.

```bash
cd graphflow
cp .env.example .env          # then set SESSION_SECRET (see the comment in the file)
npm install
```

Start PostgreSQL (port **5433**) and Redis (port 6379):

```bash
npm run db:up
```

Apply migrations (schema, Row-Level Security policies, triggers) and load the DEMO data:

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

Run the web app and the background worker (two terminals):

```bash
npm run dev
```

```bash
npm run worker
```

Open http://localhost:3000 and sign in with a demo account. Health: http://localhost:3000/api/health.

> Port 5433 is used for the Docker PostgreSQL so it does not clash with a locally installed PostgreSQL on 5432. Change `POSTGRES_PORT` and the URLs in `.env` if needed.

### Full stack in Docker

```bash
docker compose --profile full up -d --build
```

Runs migrations, the web app (port 3000) and the worker (health on 9100). Seed from the host with `npm run db:seed`.

## Demo accounts

DEMO data only (`DEMO_MODE=true`, never in production — the seed refuses to run with `NODE_ENV=production`). Password for every account: **`GraphFlow!2026`**

| Role | Email |
| --- | --- |
| Organization admin | `admin@graphflow.demo` |
| Project managers | `olivia.pm@graphflow.demo`, `marcus.pm@graphflow.demo`, `sofia.pm@graphflow.demo` |
| Team leads | `priya.lead@graphflow.demo`, `daniel.lead@graphflow.demo`, `hana.lead@graphflow.demo` |
| Employees | `liam@`, `emma@`, `noah@`, `ava@`, `ethan@`, `mia@`, `lucas@`, `zoe@`, `arjun@`, `chloe@graphflow.demo` (Chloe has not granted tracking consent) |
| Second tenant (isolation demo) | `admin@northwind.demo`, `oscar@northwind.demo` |

The seed creates 1 demo organization, 3 teams, 17 users, 7 projects, 10 tools, ~300 sessions / ~23,500 raw events from the last two weeks (normalized by the worker's own code), and timesheets in every status.

**Try the acceptance flow:** sign in as `liam@graphflow.demo` → Simulator → pick a project, scenario *A · Deep design work*, speed *300x* → Start. Watch events get processed, then open Overview and Billing → Generate timesheets → Submit. Sign in as `olivia.pm@graphflow.demo` (if the project is one she manages) → Billing → Approve → Audit Logs.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npm run worker` | Web app (dev) / background worker |
| `npm run build` / `npm start` | Production build / server |
| `npm run db:up` | Start PostgreSQL + Redis containers |
| `npm run db:migrate` | Apply migrations (`prisma migrate deploy`) |
| `npm run db:migrate:dev` | Create a new migration during development |
| `npm run db:seed` | Load / reload deterministic DEMO data |
| `npm test` | Unit tests |
| `npm run test:integration` | Integration + RLS tests (uses the `graphflow_test` database) |
| `npm run test:e2e` | Playwright end-to-end tests (needs app, worker, seeded DB) |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |

## Project structure

```
graphflow/
├── prisma/                 schema.prisma, migrations (init + security_rls), seed.ts
├── docker/postgres/init/   creates the restricted graphflow_app role + test database
├── src/
│   ├── app/                (marketing) landing · (auth) login/reset/invite · (dashboard) pages · api/** route handlers
│   ├── components/         ui (shadcn) · layout · dashboard · charts · simulator · shared · per-page views
│   ├── services/           business logic: events, analytics, billing, insights, reports, auth, …
│   ├── repositories/       reusable data-access helpers
│   ├── lib/                db (RLS context), redis, queue, auth, api (route wrapper), permissions, validation, utils
│   ├── workers/            worker entry point, event worker, maintenance (aggregation) worker
│   └── config/             validated environment
├── tests/                  unit · integration (PostgreSQL + RLS) · e2e (Playwright)
└── docs/                   architecture, database, security, event pipeline, API, testing, deployment
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Database](docs/DATABASE.md)
- [Security](docs/SECURITY.md)
- [Event pipeline](docs/EVENT_PIPELINE.md)
- [API](docs/API.md) (OpenAPI document served at `/api/openapi`)
- [Testing](docs/TESTING.md)
- [Deployment](docs/DEPLOYMENT.md)

## Implementation checklist

- [x] M1 Project initialization — Next.js, strict TS, Tailwind, shadcn/ui, Prisma, Docker Compose, Redis/BullMQ, migrations, seed
- [x] M2 Authentication & security — Argon2id, server-side sessions, roles, RBAC, PostgreSQL RLS (FORCE) under a non-superuser role, security tests
- [x] M3 Core business — employees, invitations, teams, projects, assignments, tools, file metadata, devices, organization settings
- [x] M4 Event ingestion & processing — schemas, ingestion API, raw JSONB, ledger, BullMQ, worker, dedupe, retries, PostgreSQL recovery
- [x] M5 Activity simulator — UI, 5 scenarios, speeds, controls, event log, backend processing status
- [x] M6 Reconstruction & analytics — sessions, idle, switches, deep focus, friction, billing math, utilization
- [x] M7 Timesheets & billing — generation, submit/approve/reject/adjust, adjustments, audit trail, exports
- [x] M8 Frontend — landing, dashboard, employees, projects, teams, activity, billing, simulator, audit logs, reports, settings
- [x] M9 Insights engine — budget, switching trend, unassigned work, focus trend, idle, approvals
- [x] M10 Testing & readiness — 39 unit, 30 integration/RLS, 10 E2E tests; production build; Dockerfile; docs

Known limitations are listed in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#known-limitations).
