# Security

## Privacy principles

- **Metadata only.** Collected: active application, project, file name/path, idle state, heartbeats. Never collected: screenshots, keystrokes, clipboard, messages, browser page contents, file contents. The event schema is `strict` — unknown fields are rejected.
- **Consent first.** Ingestion requires `users.tracking_consent = true` (403 `CONSENT_REQUIRED`, nothing stored). Withdrawing consent stops ingestion immediately; queued events timestamped after the withdrawal are marked `SKIPPED` and never normalized.
- **No hidden surveillance.** The simulator is clearly labelled SIMULATED; all generated data carries `is_simulated = true`. It does not observe the real computer.
- **No individual performance judgments.** Insights describe projects, teams and the organization, with the supporting metric.

## Authentication

- Credentials login; passwords hashed with **Argon2id** (m=19 MiB, t=2, p=1). Timing equalised for unknown emails.
- **Server-side sessions** (`auth_sessions`). The cookie holds a random 256-bit token; only its HMAC-SHA256 (keyed by `SESSION_SECRET`) is stored. Cookie: `HttpOnly`, `SameSite=Lax`, `Secure` + `__Host-` prefix in production. Logout revokes the row; password reset and deactivation revoke all sessions.
- Password reset: single-use, 30-minute HMAC'd token, identical response whether or not the email exists. Email delivery is not configured in this build — the link is written to the server log.
- Invitations: single-use 7-day token; the invitee sets their own password and consent.
- Device tokens (`gfd_…`) for future native collectors: shown once, stored as HMAC, scoped to one device.

Identity and role are always resolved on the server from the session. Role information from the client is never trusted.

## Authorization (defence in depth)

1. **Capability matrix** (`src/lib/permissions`) — route-level `capability` checks; the same matrix drives navigation.
2. **Service checks** — e.g. only the project manager or an admin reviews a timesheet, never their own; employees only ingest for themselves; managers may simulate only for people they manage.
3. **PostgreSQL RLS** — see [DATABASE.md](DATABASE.md#row-level-security). The app role is `NOSUPERUSER NOBYPASSRLS`, owns no tables, RLS is `FORCE`d, and context is transaction-scoped (`set_config(..., true)`), so pooled connections can never leak identity.
4. **Guard triggers** — append-only audit log and adjustments; privilege-escalation guard on `users`; timesheet workflow rules.

Note: the application role can set its own context GUCs; RLS protects against query bugs and missing filters in application code, not against a fully compromised application server. Keep database credentials secret and scoped.

## Web protections

- **CSRF:** cookie-authenticated state-changing requests must carry a same-origin `Origin` (or `Sec-Fetch-Site: same-origin`); otherwise 403. Bearer-token requests are exempt.
- **Rate limiting** (Redis, falls back to memory): login per IP+account and per IP, password reset, invitations, ingestion, reports, device tokens.
- **Headers:** CSP, `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, restrictive `Permissions-Policy`, COOP. `x-powered-by` disabled.
- **Request IDs** on every response (`x-request-id`) and stored in audit records.
- **Errors:** consistent envelope; internal errors return a generic message (details logged server-side).
- **CSV exports** neutralise spreadsheet formula injection.
- **Secrets** only in server environment variables; never exposed to the client. `.env` is git-ignored; `.env.example` contains no real secrets.

## Audit trail

Recorded (append-only): logins/failed logins/logout, password changes and resets, invitations, user/role/team/status changes, team and project changes, member assignments, billing configuration, tool changes, consent changes, device registration/tokens, simulation runs, timesheet generation/submission/approval/rejection/adjustment/auto-approval, billable audits, report exports, settings changes, admin retries of failed events.

## Data retention

Daily job: raw events of closed, processed sessions older than `raw_event_retention_days` (default 90) and audit logs older than `audit_log_retention_days` (default 730). Normalized records and timesheets are kept.

## Security tests

`tests/integration/rls.test.ts`, `tests/integration/billing.test.ts`, `tests/e2e/api-authorization.spec.ts` cover: employee A vs employee B, PM A vs project B, team lead A vs team B, org A vs org B, direct API calls, CSRF, app role cannot bypass RLS, append-only audit, role escalation, cross-tenant inserts.

## Production checklist

- `NODE_ENV=production`, `DEMO_MODE=false`, strong random `SESSION_SECRET`, HTTPS with correct `APP_URL`.
- Distinct strong passwords for `graphflow` and `graphflow_app`; the app must use `graphflow_app`.
- Do not run the seed in production (it refuses to).
- Configure email delivery before relying on password reset / invitations.
