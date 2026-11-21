# Testing

| Suite | Command | Needs | Count |
| --- | --- | --- | --- |
| Unit | `npm test` | nothing | 39 |
| Integration + RLS | `npm run test:integration` | Docker Postgres + Redis | 30 |
| End-to-end | `npm run test:e2e` | app + worker running (or auto-started), seeded DB | 10 |

## Unit (`tests/unit`, Vitest)

Pure engines: duration calculation, out-of-order independence, idempotent start/stop, last-evidence rule, missing-heartbeat splitting, idle detection (explicit and heartbeat-based), context switching, interval subtraction, deep-focus classification and thresholds, categories and billability rules, collaboration detection, rounding rules, exact money arithmetic, zero denominators, budget utilization, friction rules, timezone bucketing and DST, scenario determinism and schema validity.

## Integration (`tests/integration`, Vitest + PostgreSQL)

Runs against the separate `graphflow_test` database (created by the Postgres init script). `global-setup.ts` runs `prisma migrate deploy` (non-destructive); each file creates uniquely named organizations and deletes them afterwards. Queries go through the restricted `graphflow_app` role, exactly like the app. BullMQ uses a separate key prefix (`graphflow-test`) so tests never share queues with a running dev worker.

- `pipeline.test.ts` — raw JSONB + ledger persistence, duplicates, project/device/timestamp rejection, consent, acting for others, FocusEvent persistence, idempotent reprocessing, out-of-order delivery, multi-device overlap, consent withdrawal before processing, retry bookkeeping (`RETRYING` → `FAILED`), PostgreSQL recovery scan.
- `billing.test.ts` — timesheet generation, submit permissions, self-approval blocked (service and trigger), cross-project review blocked, adjustments with history, approval updating approved totals, approved immutability, regeneration skipping locked timesheets, audit trail, append-only audit log.
- `rls.test.ts` — app role is not superuser / no BYPASSRLS, no rows without context, `_prisma_migrations` inaccessible, Employee A vs B, PM A vs Project B, Team Lead A vs Team B, Org A vs Org B, admin scope, role escalation blocked, direct writes to normalized tables blocked, cross-tenant insert blocked.

## End-to-end (`tests/e2e`, Playwright)

Against the real local stack. `playwright.config.ts` reuses servers on :3000 / :9100 or starts `npm run dev` and `npm run worker`. For speed and realism, run against a production build:

```bash
npm run build
```

```bash
npm start
```

```bash
npm run test:e2e
```

- `workflow.spec.ts` — the full acceptance workflow: admin creates a team and project and assigns an employee → employee runs the simulator (300×) → raw events persisted and processed (verified in PostgreSQL) → FocusEvents with deep focus → project analytics equal database sums → employee generates and submits a timesheet → PM approves → amount = hours × rate, approved totals updated → audit trail contains every step.
- `api-authorization.spec.ts` — unauthenticated access, employee access to restricted endpoints, cross-org resources, role escalation, organization reports, PM approving another PM's timesheet, CSRF (missing and foreign `Origin`), simulating for another employee.

The E2E global setup clears local login rate-limit counters (the suite signs in many times from 127.0.0.1).

## Static checks

```bash
npm run typecheck
```

```bash
npm run lint
```

`npm run build` also type-checks and lints.
