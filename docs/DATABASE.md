# Database

PostgreSQL 16, managed with Prisma migrations (`prisma/migrations`). All primary keys are UUIDs, timestamps are `timestamptz(3)`, durations are integer seconds, money is `DECIMAL`.

Migrations:

1. `…_init` — tables, enums, foreign keys, indexes, unique constraints (generated from `prisma/schema.prisma`).
2. `…_security_rls` — grants, CHECK constraints, context helper functions, RLS policies, guard triggers, narrow `SECURITY DEFINER` functions. Hand-written SQL.

## Roles

| Role | Used by | Privileges |
| --- | --- | --- |
| `graphflow` (owner, superuser in Docker) | migrations, trusted seed | owns all objects |
| `graphflow_app` | web app and worker | `SELECT/INSERT/UPDATE/DELETE` on tables (no `UPDATE/DELETE` on `audit_logs`, `billing_adjustments`), no access to `_prisma_migrations`, **NOSUPERUSER NOBYPASSRLS** |

Created by `docker/postgres/init/01-roles.sh` (login + password) and re-asserted in the security migration.

## Entities

```
organizations 1─┬─* users ─┬─* project_members *─1 projects ─1 project_billing_configs
                │          ├─* devices ─* activity_sessions ─* raw_activity_events ─1 activity_event_inbox
                │          ├─* focus_events (session, device, project, tool, file)
                │          ├─* timesheets ─* billing_adjustments
                │          └─* auth_sessions, password_reset_tokens
                ├─ organization_settings (1:1)
                ├─* teams (manager → users) ─* users, projects
                ├─* tools ─* files (metadata only)
                ├─* collaboration_links (source/target users + sessions, project)
                ├─* billable_audits (project, optional user)
                ├─* simulation_runs (actor, target user, device)
                ├─* invitations
                └─* audit_logs (append-only)
```

### Main tables

| Table | Purpose / notable columns |
| --- | --- |
| `organizations` | tenant; `timezone` (IANA), `is_demo` |
| `organization_settings` | deep-focus thresholds, idle & heartbeat timeouts, friction rules, budget alert %, retention days, default currency |
| `users` | `email` (globally unique, lowercase), `role`, `team_id`, `tracking_consent`, `consent_updated_at`, `password_hash` (Argon2id; never selected by the app) |
| `teams`, `projects`, `project_members` | `project_members (project_id, user_id)` unique; projects have budget hours, hourly rate, currency, status, dates |
| `project_billing_configs` | billable categories, collaboration/administrative billability, always/never billable tool ids, rounding rule, approval requirement |
| `tools`, `files` | executable names + default billability; file **metadata only** |
| `devices` | collectors per user; `is_simulated`; `token_hash` for native agents |
| `activity_sessions` | one per collector session; aggregates (tracked/active/idle/deep focus seconds, switches) and lifecycle `OPEN/CLOSED/TIMED_OUT` |
| `raw_activity_events` | raw packets: `payload JSONB`, `client_event_id` unique per org, `processing_status`, `attempts`, `last_error`; indexed on org, user, timestamp, type, status, session |
| `activity_event_inbox` | processing ledger; `source_event_id` unique; `enqueued_at` drives recovery |
| `focus_events` | normalized, non-overlapping intervals: category, idle, billable, context-switch flag, simulated flag |
| `collaboration_links` | overlap of two users' collaboration intervals on the same project |
| `timesheets` | per user × project × period; unique on those four columns; snapshot `hourly_rate`; `calculated_billable_seconds` vs adjusted `billable_seconds` |
| `billing_adjustments` | append-only history of billable-time changes |
| `billable_audits` | point-in-time billing snapshots per project/period |
| `audit_logs` | append-only; `project_id` column enables PM-scoped visibility |

### Constraints (security migration)

Examples: `focus_events.ended_at > started_at`, `duration_seconds > 0`, `idle ≤ duration`; `timesheets.billable_seconds ≤ tracked_seconds`; non-negative money; valid project dates; `collaboration_links.source_user_id <> target_user_id`; settings ranges; lowercase emails.

## Row-Level Security

Enabled **and forced** on every tenant table. Context functions: `app_current_org()`, `app_current_user_id()`, `app_current_role()`, `app_is_admin()` (SUPER_ADMIN, ORG_ADMIN, SYSTEM), `app_is_system()`.

Relationship helpers (`SECURITY DEFINER`, always constrained to the current org): `app_can_view_project`, `app_manages_project`, `app_can_manage_user`, `app_can_view_user_activity(user, project)`.

| Table | Read | Write |
| --- | --- | --- |
| organizations | own org | admin update |
| users | org directory | admin; self-update (guard trigger blocks role/team/status/email changes) |
| teams | org | admin |
| projects / project_members | admin, PM of project, team lead of project's team, members | admin / PM (own projects) |
| focus_events, activity_sessions, timesheets | self; admin; team lead → own team members; PM → activity on projects they manage | worker (SYSTEM) for normalized data; owners/PMs for timesheets |
| raw_activity_events | self, admin | self or managed users (simulator), SYSTEM updates |
| collaboration_links | if either side's activity is visible | SYSTEM |
| billable_audits | admin, PM, team lead of project team, subject user | admin, PM |
| audit_logs | admin; own actions; PM for their projects | insert only |

Guard triggers: `audit_logs` / `billing_adjustments` append-only; `users_guard`; `timesheets_guard` (approved = immutable, no self-review, only project manager/admin reviews, only owner submits).

`SECURITY DEFINER` entry points (execute granted to `graphflow_app` only): login lookup, session lookup, device-token lookup, reset/invitation token lookup, session ownership check, simulator run stats, unprocessed-event scan, stale-session scan, organization list, retention.

## Indexes for reporting

`focus_events (organization_id, started_at)`, `(user_id, started_at)`, `(project_id, started_at)`, `(session_id)`; `raw_activity_events (processing_status, received_at)`, `(session_id, event_timestamp)`; `timesheets (organization_id, status)`, `(project_id, status)`; `audit_logs (organization_id, created_at)`.

## Schema changes

Edit `prisma/schema.prisma`, then `npm run db:migrate:dev -- --name <change>`. New tenant tables must get `ENABLE` + `FORCE ROW LEVEL SECURITY` and policies in a hand-written migration. Never change the production schema outside migrations.
