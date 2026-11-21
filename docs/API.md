# API

REST API implemented with Next.js Route Handlers (`src/app/api/**`). Machine-readable **OpenAPI 3.1** document: `GET /api/openapi` (generated from `src/lib/openapi.ts`).

## Conventions

- **Envelope:** success `{ "data": … }` (lists: `{ items, total, page, pageSize }`); error `{ "error": { "code", "message", "details" }, "requestId" }`.
- **Request IDs:** every response has `x-request-id` (also stored in audit records).
- **Auth:** HTTP-only session cookie (`gf_session`, `__Host-gf_session` in production). `/api/events` also accepts `Authorization: Bearer gfd_…` device tokens.
- **CSRF:** state-changing cookie requests must be same-origin (`Origin` header).
- **Status codes:** 200, 201 created, 202 accepted (events), 400 malformed JSON, 401 unauthenticated, 403 forbidden / RLS / consent, 404 not found or not visible, 409 conflict / invalid state, 422 validation, 429 rate limited, 500.
- **Pagination:** `page`, `pageSize` (≤ 200). **Filtering** via query parameters; dates as `YYYY-MM-DD` in the organization's timezone.
- **Visibility:** lists only return what RLS allows; resources you cannot see return 404.

## Endpoints

| Group | Endpoints |
| --- | --- |
| Health | `GET /api/health` (app, PostgreSQL, Redis, worker, backlog), `GET /api/health/live` |
| Auth | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, `POST /api/auth/change-password`, `GET|POST /api/auth/invitations/{token}` |
| Organizations | `GET|PATCH /api/organizations/current` |
| Employees | `GET|POST /api/employees` (POST = invite), `GET|PATCH /api/employees/{id}`, `GET /api/employees/{id}/analytics`, `GET /api/invitations`, `DELETE /api/invitations/{id}` |
| Teams | `GET|POST /api/teams`, `PATCH|DELETE /api/teams/{id}`, `GET /api/teams/analytics` |
| Projects | `GET|POST /api/projects`, `GET|PATCH|DELETE /api/projects/{id}`, `POST|DELETE /api/projects/{id}/members`, `GET|PUT /api/projects/{id}/billing-config`, `GET /api/projects/{id}/analytics`, `GET /api/projects/{id}/audit` |
| Tools & devices | `GET|POST /api/tools`, `PATCH /api/tools/{id}`, `GET|POST /api/devices`, `PATCH /api/devices/{id}`, `POST /api/devices/{id}/token` |
| Events | `POST /api/events` |
| Activity | `GET /api/activity`, `GET /api/activity/raw` (admin), `POST /api/activity/raw/retry` (admin) |
| Analytics & insights | `GET /api/analytics/overview`, `GET /api/insights` |
| Timesheets | `GET /api/timesheets`, `POST /api/timesheets/generate`, `GET|DELETE /api/timesheets/{id}`, `POST /api/timesheets/{id}/{submit|approve|reject|request-adjustment|adjust}` |
| Billing | `GET /api/billing/summary`, `GET|POST /api/billing/audits`, `GET /api/billing/export` (CSV) |
| Reports | `GET /api/reports`, `GET /api/reports/{type}?format=json|csv|pdf` |
| Simulator | `GET /api/simulator/options`, `POST /api/simulator/runs`, `GET|PATCH /api/simulator/runs/{id}`, `POST /api/simulator/events` |
| Audit | `GET /api/audit-logs` |
| Settings | `GET|PATCH /api/settings`, `PATCH /api/settings/organization`, `PATCH /api/settings/profile`, `POST /api/settings/consent` |

Report types: `employee-timesheet`, `project-billing`, `team-productivity`, `organization-monthly` (admin), `application-usage`, `workflow-friction`.

## Examples

```bash
curl -c jar -H "Origin: http://localhost:3000" -H "content-type: application/json" \
  -d '{"email":"liam@graphflow.demo","password":"GraphFlow!2026"}' http://localhost:3000/api/auth/login
```

```bash
curl -b jar "http://localhost:3000/api/analytics/overview?from=2026-10-20&to=2026-11-02"
```

Ingestion response:

```json
{ "data": { "results": [ { "eventId": "…", "status": "accepted", "rawEventId": "…" },
                         { "eventId": "…", "status": "rejected", "code": "INVALID_PROJECT", "message": "…" } ],
            "accepted": 1, "duplicates": 0, "rejected": 1, "queued": true } }
```

## Analytics formulas

```
Billable Hours      = Approved Billable Seconds / 3600
Billable Amount     = Approved Billable Hours × Project Hourly Rate   (integer cents, half-up, per timesheet)
Budget Utilization  = Approved Billable Hours / Project Budget Hours × 100   (null when no budget)
Deep Focus Ratio    = Deep Focus Seconds / Active Work Seconds × 100
Friction Ratio      = Friction Seconds / Tracked Seconds × 100
Friction            = idle + unassigned + Σ max(0, switches/hour − threshold) × cost + repeated fragments
```

Zero denominators return 0 (or `null` for utilization). Seconds are never rounded before aggregation; timesheet rounding rules apply only to the timesheet's billable total.
