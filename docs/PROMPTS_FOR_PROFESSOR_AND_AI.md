# Prompts (to show your professor and to give to another AI)

Prompt 1 asks an AI to produce the **relational schema**. Prompt 2 asks an AI to produce the **ER diagram**. Both contain the full project description so they work on their own, in a fresh chat.

---

## PROMPT 1 — Database schema design

```
ROLE
You are a senior database architect and DBMS lecturer. Produce a complete,
normalized relational database schema for the system described below. Explain
your design the way you would for a university DBMS course.

PROJECT
GraphFlow is a multi-tenant SaaS web application for creative agencies and
software teams that bill clients by the hour. It measures how employees spend
time across projects, tools and files, turns that into timesheets, and supports
an approval and billing workflow.

Business flow:
1. A company (organization) has teams, users and projects. Users have one of
   five roles: SUPER_ADMIN, ORG_ADMIN, PROJECT_MANAGER, TEAM_LEAD, EMPLOYEE.
2. Employees are assigned to projects (many-to-many). A project has a budget in
   hours, an hourly rate, a currency, a status (PLANNING, ACTIVE, ON_HOLD,
   COMPLETED, ARCHIVED), a manager and an owning team.
3. A collector on an employee's device sends activity events (app opened,
   application switch, file context changed, focus started/ended, idle
   started/ended, project changed, heartbeat). Events are stored raw (JSON)
   exactly as received, with a unique client event id to prevent duplicates, and
   a processing status (PENDING, PROCESSING, PROCESSED, RETRYING, FAILED,
   SKIPPED). A processing ledger row exists per raw event.
4. A background worker reconstructs events into non-overlapping time intervals
   ("focus events") with a category (DEEP_FOCUS, ACTIVE_WORK, COLLABORATION,
   ADMINISTRATIVE, IDLE, UNASSIGNED), the tool used, optional file and project,
   and whether the interval is billable.
5. Collaboration between two employees on the same project is detected from
   overlapping sessions.
6. Timesheets are generated per user, project and period as DRAFT, then
   SUBMITTED by the employee, then APPROVED, REJECTED or sent back
   (ADJUSTMENT_REQUIRED) by the project manager. Every change to billable time
   is kept as an append-only adjustment record. Approved timesheets are
   immutable. A user may never approve their own timesheet.
7. Projects have billing rules: which activity categories are billable, whether
   collaboration or administrative time is billable, tools that are always or
   never billable, a rounding rule (none, 6 min, 15 min, nearest 15 min) and
   whether approval is required.
8. Periodic billing audit snapshots per project and an append-only audit log of
   every important action (with request id and JSON metadata).
9. Authentication: server-side login sessions (store only a hash of the token),
   password-reset tokens, and invitation tokens.
10. Employees must give tracking consent; the consent value and its time are
    stored. Organizations configure analytics thresholds, retention periods and
    default currency (one settings row per organization).
11. A development simulator records "simulation runs" (who started it, which
    employee it simulated, scenario, speed, status) and links the events it
    generated.
12. Files are stored as metadata only (name, path, type, project, tool,
    creator) — never contents.
13. Devices belong to users, may be simulated, and may hold a hashed token for
    a future desktop agent.

TECHNICAL REQUIREMENTS
- Target PostgreSQL 16. UUID primary keys. All timestamps timestamptz in UTC.
  Durations as integer seconds. Money as DECIMAL (never float).
- Strict tenant isolation: every tenant table carries organization_id; describe
  Row-Level Security policies per table (who can read and write what by role).
- Use enums, CHECK constraints, UNIQUE constraints, indexes for reporting
  queries, and ON DELETE rules chosen deliberately (cascade vs set null) with a
  one-line justification each.
- Include triggers or rules for: append-only audit log, immutability of approved
  timesheets, no self-approval, and a guard preventing an employee from
  changing their own role.

DELIVERABLES (in this order)
1. A list of entities with a one-sentence purpose each.
2. For each table: columns, data types, PK, FK, UNIQUE, NOT NULL, CHECK,
   defaults, and indexes — as a table.
3. Complete PostgreSQL DDL (CREATE TYPE, CREATE TABLE, indexes, constraints).
4. A relationship table: parent, child, cardinality, ON DELETE behaviour.
5. Normalization analysis: show functional dependencies and justify 3NF/BCNF;
   point out every deliberate denormalization (for example the hourly_rate
   snapshot on timesheets, aggregate counters on sessions) and why.
6. The 15 most important queries the schema must support efficiently, with
   SQL (for example: approved billable hours per project, deep-focus ratio per
   team, pending timesheets for a manager, duplicate event detection).
7. Row-Level Security policy summary table.
8. A short section "Design decisions and trade-offs" (maximum 10 bullets).
9. A proposed extension (clearly labelled future work): per-signal consent
   records, monitoring policies with allow/exclude rules, classification
   disputes, and work segments from a fusion engine — as additional tables;
   plus which flexible data would suit a document database (MongoDB) and which
   temporary data would suit Redis, with a table stating which database is the
   source of truth for each kind of data.

OUTPUT RULES
- Be precise and complete; do not invent features beyond those listed.
- State every assumption explicitly.
- Use Markdown tables and fenced SQL.
```

---

## PROMPT 2 — ER diagram

```
ROLE
You are a data-modelling expert producing an Entity-Relationship diagram for a
university DBMS submission. The diagram must be correct, uncluttered and
readable when printed on A3 landscape.

SYSTEM
GraphFlow: a multi-tenant time-tracking and billing system. Employees' device
activity is recorded as raw events, reconstructed into time intervals, rolled up
into timesheets, approved by project managers and billed per project.

ENTITIES (23) AND THEIR ATTRIBUTES
Show primary keys (PK), foreign keys (FK) and unique keys (UK). Show only key
attributes plus the important business attributes listed.

1. organizations: id PK, name, slug UK, timezone, is_demo
2. organization_settings: organization_id PK/FK, deep_focus_min_minutes,
   idle_timeout_minutes, heartbeat_timeout_minutes, budget_alert_threshold_pct,
   raw_event_retention_days
3. users: id PK, organization_id FK, team_id FK, email UK, role, is_active,
   tracking_consent, consent_updated_at
4. teams: id PK, organization_id FK, manager_id FK, name
5. auth_sessions: id PK, user_id FK, token_hash UK, expires_at, revoked_at
6. password_reset_tokens: id PK, user_id FK, token_hash UK, used_at
7. invitations: id PK, invited_by_id FK, email, role, token_hash UK
8. projects: id PK, organization_id FK, team_id FK, project_manager_id FK, name,
   budget_hours, hourly_rate, status, deadline
9. project_members: id PK, project_id FK, user_id FK, assigned_role
   (UNIQUE project_id + user_id) — associative entity for the M:N
10. project_billing_configs: project_id PK/FK, billable_categories,
    collaboration_billable, administrative_billable, rounding_rule,
    requires_approval
11. tools: id PK, organization_id FK, name, category, executable_name,
    default_billable_status
12. files: id PK, project_id FK, tool_id FK, created_by FK, file_name, file_path
13. devices: id PK, user_id FK, name, is_simulated, token_hash UK
14. activity_sessions: id PK, user_id FK, device_id FK, project_id FK, status,
    started_at, tracked_seconds, deep_focus_seconds
15. raw_activity_events: id PK, session_id FK, simulation_run_id FK,
    client_event_id UK, event_type, event_timestamp, payload (JSONB),
    processing_status, attempts
16. activity_event_inbox: id PK, source_event_id FK/UK, processing_status,
    attempts, enqueued_at
17. focus_events: id PK, session_id FK, user_id FK, project_id FK, tool_id FK,
    file_id FK, started_at, ended_at, duration_seconds, activity_category,
    is_billable, is_context_switch
18. collaboration_links: id PK, source_user_id FK, target_user_id FK,
    project_id FK, duration_seconds, interaction_type
19. simulation_runs: id PK, actor_id FK, user_id FK, scenario, speed, status
20. timesheets: id PK, user_id FK, project_id FK, reviewed_by FK,
    reporting_period_start, billable_seconds, hourly_rate, billable_amount,
    status
21. billing_adjustments: id PK, timesheet_id FK, adjusted_by FK,
    previous_billable_seconds, adjusted_billable_seconds, reason
22. billable_audits: id PK, project_id FK, reporting_period_start,
    total_billable_seconds, approved_billable_seconds, billable_amount
23. audit_logs: id PK, actor_id FK, action, entity_type, metadata (JSONB),
    request_id

RELATIONSHIPS (cardinality and meaning)
- organizations 1:1 organization_settings (configured by)
- organizations 1:N users, teams, projects, tools, devices (tenant ownership;
  all other tables also belong to an organization — do NOT draw those extra
  lines, add the note "all entities carry organization_id" once)
- teams 1:N users (has members); users 1:N teams (manages) — two separate
  relationships between the same pair; label both
- teams 1:N projects; users 1:N projects (project manager)
- projects M:N users through project_members
- projects 1:1 project_billing_configs
- tools 1:N files; projects 1:N files; users 1:N files (creator)
- users 1:N devices; users 1:N auth_sessions, password_reset_tokens,
  invitations (sender)
- devices 1:N activity_sessions; users 1:N activity_sessions;
  projects 1:N activity_sessions (optional)
- activity_sessions 1:N raw_activity_events
- raw_activity_events 1:0..1 activity_event_inbox
- simulation_runs 1:N raw_activity_events (optional);
  users 1:N simulation_runs twice (starter, simulated employee)
- activity_sessions 1:N focus_events; users, projects (optional), tools
  (optional), files (optional) each 1:N focus_events
- users M:N users through collaboration_links (source and target), per project
- users 1:N timesheets (owner); users 1:N timesheets (reviewer, optional);
  projects 1:N timesheets
- timesheets 1:N billing_adjustments; users 1:N billing_adjustments
- projects 1:N billable_audits
- users 1:N audit_logs (actor, optional)

DRAWING RULES
- Use Chen or crow's-foot notation (crow's-foot preferred). State which one.
- Group entities into five coloured regions with a legend:
  (1) Tenancy and identity: organizations, organization_settings, users, teams,
      auth_sessions, password_reset_tokens, invitations
  (2) Projects and assets: projects, project_members, project_billing_configs,
      tools, files, devices
  (3) Event pipeline: activity_sessions, raw_activity_events,
      activity_event_inbox, focus_events, collaboration_links, simulation_runs
  (4) Billing: timesheets, billing_adjustments, billable_audits
  (5) Audit: audit_logs
- Place users and projects near the centre because most relationships touch them.
- Minimise line crossings; use orthogonal connectors; label every relationship
  with a verb phrase and show cardinality at both ends.
- Draw project_members and collaboration_links as associative entities (diamond
  or box) between their parents.
- Mark optional (0..1) relationships with a circle.
- Underline primary keys, italicise foreign keys, mark unique keys "UK".
- Use consistent attribute order: PK, FKs, UKs, business attributes.

DELIVERABLES
1. The diagram as Mermaid erDiagram code (valid syntax) AND as an SVG or
   PlantUML version if possible.
2. A numbered legend and a one-paragraph "how to read this diagram".
3. A table of every relationship: from, to, cardinality, participation
   (total/partial), and the foreign key that implements it.
4. A list of weak or associative entities with justification.
5. Three alternative layouts you considered and why you chose the final one.
6. Then, on a separate second diagram, the PROPOSED extension (future work):
   consent_records, monitoring_policies, policy_rules, collector_devices,
   classification_reviews, work_segments attached to users, devices,
   focus_events and projects; and show, as a side panel, the MongoDB
   collections (screen_observations, document_analyses, attention_observations,
   fusion_evidence) with dotted reference lines to PostgreSQL ids, and the Redis
   key families (queue, live status, cache, rate limits). Label PostgreSQL as
   "source of truth".

OUTPUT RULES
- Do not add entities or relationships that are not listed.
- If something is ambiguous, state your assumption instead of guessing silently.
```

---

## Tips for using the prompts

1. Start a **new chat** for each prompt so earlier text does not affect the result.
2. Give Prompt 2 together with `docs/ER_DIAGRAM.md` as the reference answer and ask the AI to "improve layout and fix any mistakes".
3. Paste the Mermaid code into https://mermaid.live to render and export PNG or SVG.
4. Check the AI's output against `docs/SCHEMA.md`, which is the reference answer for Prompt 1.
