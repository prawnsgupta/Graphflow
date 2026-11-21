# Deployment

## Environment

All variables are documented in `.env.example`.

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | **restricted** `graphflow_app` role — used by web and worker |
| `MIGRATION_DATABASE_URL` | owner role — migrations and seed only |
| `REDIS_URL` | BullMQ + rate limiting |
| `APP_URL` | public origin (CSRF checks, links) |
| `SESSION_SECRET` | 32+ random characters |
| `SESSION_TTL_HOURS` | default 12 |
| `DEMO_MODE` | `false` in production |
| `WORKER_CONCURRENCY`, `WORKER_HEALTH_PORT`, `RECOVERY_SCAN_INTERVAL_SECONDS` | worker tuning |
| `BULLMQ_PREFIX` | optional queue key prefix (tests use `graphflow-test`) |

## Local development

See the [README quick start](../README.md#quick-start). Infrastructure: `docker compose up -d postgres redis` (Postgres on host port 5433).

## Migrations

```bash
npm run db:migrate
```

Runs `prisma migrate deploy` with `MIGRATION_DATABASE_URL`. Run it before starting new application versions. To create a migration in development: `npm run db:migrate:dev -- --name <change>`.

## Seed (development / demo only)

```bash
npm run db:seed
```

Deterministic and re-runnable (deletes and recreates the demo organizations). Refuses to run when `NODE_ENV=production`.

## Production build

```bash
npm run build
```

```bash
npm start
```

`next.config.ts` uses `output: "standalone"`; the Docker image runs `node server.js`. Run the worker as a separate process: `npm run worker`.

## Docker

```bash
docker compose --profile full up -d --build
```

Services: `postgres` (healthcheck `pg_isready`), `redis` (`redis-cli ping`, AOF on, `noeviction`), `migrate` (one-shot `prisma migrate deploy`), `app` (port 3000, healthcheck `/api/health/live`), `worker` (healthcheck `:9100/health`). The image runs as a non-root user.

For a real deployment:

1. Provision PostgreSQL 16 and Redis 7 (managed services are fine). Create the `graphflow_app` role exactly as in `docker/postgres/init/01-roles.sh` (NOSUPERUSER NOBYPASSRLS) with a strong password.
2. Set secrets via your platform's secret store; `DEMO_MODE=false`; HTTPS; `APP_URL` = public origin.
3. Run the `migrate` job, then deploy `app` (≥1 replica) and `worker` (≥1 replica; workers are safe to scale — idempotent processing with row and advisory locks).
4. Monitor `GET /api/health` (`status`, `checks.worker`, `eventBacklog`) and the worker's `/health`.

## Health checks

| Endpoint | Meaning |
| --- | --- |
| `GET /api/health/live` | web process alive |
| `GET /api/health` | PostgreSQL, Redis, worker heartbeat, unprocessed-event backlog; 503 when PostgreSQL is down, `degraded` when Redis/worker are |
| `GET :9100/health` (worker) | database reachable and Redis connected |

## Behaviour when infrastructure is unavailable

- **Redis down:** ingestion still stores events durably and responds `202` with `queued:false`; rate limiting falls back to per-process memory; the worker's fallback loop keeps closing stale sessions; once Redis returns, the recovery scan re-enqueues everything pending.
- **Worker down:** events accumulate as `PENDING` (visible as backlog in `/api/health`); processed on restart.
- **PostgreSQL down:** API returns 5xx; nothing is acknowledged that is not stored.

## Known limitations

- Email delivery is not configured: password-reset links are written to the server log and invitation links are shown once to the inviting admin.
- The activity collector is the in-browser simulator; a native desktop agent is a future component (the API, device tokens and event schema are ready for it).
- Analytics are computed on request from normalized records (bounded date ranges); very large tenants would benefit from pre-aggregated daily tables.
- Timesheet periods are 7-day weeks (up to 31 days via the API) in the organization timezone.
