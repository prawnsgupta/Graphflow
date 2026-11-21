# GraphFlow — Database Schema

Relational schema of the implemented system (PostgreSQL 16). Part B lists the **proposed** extension (not built yet).

Conventions: `PK` primary key · `FK` foreign key · `UQ` unique · `NN` not null · all ids are UUID · all timestamps are `timestamptz` (UTC) · durations are integer seconds · money is `DECIMAL`.

---

## Part A — Implemented schema (23 tables)

### A1. Tenancy and identity

**organizations** — a tenant (company)
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | text | NN |
| slug | text | UQ, NN |
| timezone | text | NN, default `UTC` (IANA name) |
| is_demo | boolean | NN, default false |
| created_at, updated_at | timestamptz | NN |

**organization_settings** — 1:1 with organizations
| Column | Type | Constraints |
|---|---|---|
| organization_id | uuid | PK, FK → organizations (cascade) |
| deep_focus_min_minutes | int | default 25, CHECK 1–480 |
| deep_focus_max_gap_minutes | int | default 2, CHECK 0–60 |
| idle_timeout_minutes | int | default 5 |
| heartbeat_timeout_minutes | int | default 5 |
| context_switch_threshold_per_hour | int | default 6 |
| context_switch_cost_seconds | int | default 120 |
| fragment_threshold_seconds / fragment_min_count_per_hour | int | friction rules |
| budget_alert_threshold_pct | int | default 80, CHECK 1–100 |
| raw_event_retention_days / audit_log_retention_days | int | defaults 90 / 730 |
| default_currency | text | default `USD` |

**users**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | FK → organizations, NN |
| display_name | text | NN |
| email | text | UQ, NN, CHECK lowercase |
| password_hash | text | Argon2id, nullable |
| role | enum UserRole | SUPER_ADMIN, ORG_ADMIN, PROJECT_MANAGER, TEAM_LEAD, EMPLOYEE |
| team_id | uuid | FK → teams (set null) |
| title | text | |
| is_active | boolean | default true |
| tracking_consent | boolean | default false |
| consent_updated_at, last_login_at | timestamptz | |

**teams**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | FK, NN |
| name | text | NN, UQ with organization_id |
| description | text | |
| manager_id | uuid | FK → users (set null) |

**auth_sessions** — server-side login sessions
`id PK · organization_id · user_id FK→users (cascade) · token_hash UQ (HMAC of cookie token) · user_agent · ip_address · created_at · last_seen_at · expires_at · revoked_at`

**password_reset_tokens**
`id PK · organization_id · user_id FK→users · token_hash UQ · expires_at · used_at · created_at`

**invitations**
`id PK · organization_id FK · email · display_name · role · team_id · token_hash UQ · invited_by_id FK→users · expires_at · accepted_at · revoked_at · created_at`

### A2. Projects, tools, files, devices

**projects**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | FK, NN |
| team_id | uuid | FK → teams (set null) |
| project_manager_id | uuid | FK → users (set null) |
| name | text | NN, UQ with organization_id |
| description, client_name | text | |
| budget_hours | decimal(10,2) | CHECK ≥ 0 |
| hourly_rate | decimal(12,2) | CHECK ≥ 0 |
| currency | text | default `USD` |
| status | enum | PLANNING, ACTIVE, ON_HOLD, COMPLETED, ARCHIVED |
| start_date, deadline | date | CHECK deadline ≥ start_date |

**project_members** — many-to-many users ↔ projects
`id PK · project_id FK→projects (cascade) · user_id FK→users (cascade) · assigned_role · assigned_at · UQ(project_id, user_id)`

**project_billing_configs** — 1:1 with projects
`project_id PK/FK · organization_id · billable_categories ActivityCategory[] · collaboration_billable bool · administrative_billable bool · billable_tool_ids uuid[] · non_billable_tool_ids uuid[] · rounding_rule enum(NONE, UP_6_MIN, UP_15_MIN, NEAREST_15_MIN) · requires_approval bool`

**tools**
`id PK · organization_id FK · name · category enum(DESIGN, DEVELOPMENT, THREE_D, BROWSER, COMMUNICATION, PRODUCTIVITY, DOCUMENTATION, OTHER) · executable_name · default_billable_status bool · UQ(organization_id, name) · UQ(organization_id, executable_name)`

**files** — metadata only, never contents
`id PK · organization_id FK · project_id FK→projects · tool_id FK→tools · file_name · file_path · file_type · created_by FK→users · UQ(organization_id, file_path)`

**devices** — an activity collector registered to a user
`id PK · organization_id FK · user_id FK→users (cascade) · name · platform · is_simulated bool · is_active bool · token_hash UQ · last_seen_at · UQ(user_id, name)`

### A3. Event pipeline

**activity_sessions** — one continuous session on one device
`id PK (client generated) · organization_id · user_id FK · device_id FK · project_id FK · is_simulated · status enum(OPEN, CLOSED, TIMED_OUT) · started_at · last_event_at · ended_at · tracked_seconds · active_seconds · idle_seconds · deep_focus_seconds · context_switch_count · CHECK last_event_at ≥ started_at`

**raw_activity_events** — raw packets as received
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | FK |
| client_event_id | uuid | UQ with organization_id (duplicate protection) |
| user_id, device_id, session_id | uuid | FK |
| simulation_run_id | uuid | FK → simulation_runs, nullable |
| event_type | enum | APP_OPENED, APP_CLOSED, APPLICATION_SWITCH, FILE_CONTEXT_CHANGED, FOCUS_STARTED, FOCUS_ENDED, IDLE_STARTED, IDLE_ENDED, PROJECT_CHANGED, SESSION_HEARTBEAT |
| event_timestamp | timestamptz | indexed |
| sequence | int | tie-breaker |
| payload | **jsonb** | the raw packet |
| processing_status | enum | PENDING, PROCESSING, PROCESSED, RETRYING, FAILED, SKIPPED |
| attempts | int | CHECK ≥ 0 |
| received_at, processed_at | timestamptz | |
| last_error | text | |

**activity_event_inbox** — processing ledger (1:1 with raw events)
`id PK · organization_id · source_event_id UQ FK→raw_activity_events (cascade) · processing_status · attempts · last_error · enqueued_at · received_at · processed_at`

**focus_events** — normalized, non-overlapping intervals (central analytics table)
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| organization_id, user_id, device_id, session_id, source_event_id | uuid | FK / NN |
| project_id, tool_id, file_id | uuid | FK, nullable |
| started_at, ended_at | timestamptz | CHECK ended_at > started_at |
| duration_seconds | int | CHECK > 0 |
| idle_duration_seconds | int | CHECK 0 ≤ x ≤ duration |
| is_idle, is_billable, is_context_switch, is_simulated | boolean | |
| activity_category | enum | DEEP_FOCUS, ACTIVE_WORK, COLLABORATION, ADMINISTRATIVE, IDLE, UNASSIGNED |

**collaboration_links**
`id PK · organization_id · source_user_id FK · target_user_id FK · project_id FK · source_session_id · target_session_id · interaction_type · started_at · ended_at · duration_seconds · context_switch_count · CHECK source_user_id <> target_user_id AND ended_at > started_at`

**simulation_runs**
`id PK · organization_id · actor_id FK→users (who pressed start) · user_id FK→users (simulated employee) · device_id · project_id · scenario · speed · status enum(RUNNING, PAUSED, STOPPED, COMPLETED) · started_at · ended_at`

### A4. Billing and audit

**timesheets**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| organization_id, user_id, project_id | uuid | FK |
| reporting_period_start / _end | timestamptz | CHECK end > start; UQ(user_id, project_id, start, end) |
| tracked_seconds, billable_seconds, non_billable_seconds | int | CHECK ≥ 0, billable ≤ tracked |
| calculated_billable_seconds | int | value before any adjustment |
| hourly_rate | decimal(12,2) | snapshot of project rate |
| billable_amount | decimal(14,2) | CHECK ≥ 0 |
| status | enum | DRAFT, SUBMITTED, APPROVED, REJECTED, ADJUSTMENT_REQUIRED |
| submitted_at, reviewed_at | timestamptz | |
| reviewed_by | uuid | FK → users |
| rejection_reason, notes | text | |

**billing_adjustments** — append-only history
`id PK · organization_id · timesheet_id FK→timesheets (cascade) · previous_billable_seconds · adjusted_billable_seconds · reason NN · adjusted_by FK→users · created_at`

**billable_audits** — period snapshots per project
`id PK · organization_id · project_id FK · user_id FK (nullable) · reporting_period_start/end · total_tracked_seconds · total_deep_focus_seconds · total_active_work_seconds · total_idle_seconds · total_friction_seconds · total_billable_seconds · total_non_billable_seconds · approved_billable_seconds · context_switch_count · billable_amount · budget_utilization_percentage · calculated_at`

**audit_logs** — append-only (UPDATE/DELETE revoked and blocked by trigger)
`id PK · organization_id · actor_id FK→users (set null) · action · entity_type · entity_id · project_id · metadata jsonb · request_id · created_at`

### A5. Relationships summary

| Parent (1) | Child (N) | Meaning |
|---|---|---|
| organizations | every tenant table | tenant isolation |
| teams | users | team membership |
| users | teams (manager_id) | who leads a team |
| teams | projects | owning team |
| users | projects (project_manager_id) | who manages a project |
| projects ↔ users | project_members | assignment (M:N) |
| projects | project_billing_configs | billing rules (1:1) |
| tools | files, focus_events | application used |
| users | devices | collectors |
| devices | activity_sessions | sessions per device |
| activity_sessions | raw_activity_events, focus_events | events and results |
| raw_activity_events | activity_event_inbox | ledger (1:1) |
| users, projects | timesheets | weekly billing records |
| timesheets | billing_adjustments | change history |

### A6. Security layer

Row-Level Security is **enabled and forced** on every tenant table. The application connects as `graphflow_app` (no superuser, no BYPASSRLS). Every request sets `app.user_id`, `app.organization_id`, `app.user_role` inside its transaction. Triggers: append-only audit log and adjustments; privilege-escalation guard on users; timesheet workflow guard (approved = immutable, no self-review). Details: `docs/DATABASE.md`.

---

## Part B — Proposed extension (NOT implemented yet)

### B1. New PostgreSQL tables

| Table | Purpose | Key columns |
|---|---|---|
| consent_records | per-signal consent history | id, user_id, signal enum(SCREEN, INTERACTION, FILES, WEBCAM), granted bool, policy_version, recorded_at |
| monitoring_policies | organization policy | id, organization_id, version, screenshot_interval_s, retention_days, content_extraction_allowed |
| policy_rules | approved/excluded apps, folders, extensions | id, policy_id, rule_type enum(APP, DIRECTORY, EXTENSION), mode enum(ALLOW, EXCLUDE), pattern |
| collector_devices | real desktop agents | id, device_id FK→devices, agent_version, last_heartbeat, status |
| classification_reviews | employee corrections / disputes | id, focus_event_id FK, original_category, new_category, reason, decided_by, created_at |
| work_segments | fused sessions (authoritative summary) | id, user_id, project_id, state enum, relevance, attention_conf, activity_conf, experimental_score, started_at, ended_at |
| source label | add `source enum(SIMULATOR, COLLECTOR, IMPORTED)` to sessions, raw events, focus events | |

### B2. MongoDB collections (flexible documents; Postgres stays the source of truth)

| Collection | Holds | Reference to Postgres |
|---|---|---|
| screen_observations | OCR/vision results per capture (versioned) | session_id, user_id |
| document_analyses | extracted metadata of authorised files | file_id |
| attention_observations | webcam-derived attention samples with confidence | session_id |
| fusion_evidence | per-segment evidence that explains a classification | work_segment_id |

### B3. Redis keys

| Key pattern | Purpose | TTL |
|---|---|---|
| bull:graphflow-events:* | job queue | – |
| collector:status:{deviceId} | live online/offline + last event | 60 s |
| attention:latest:{userId} | latest attention state | 30 s |
| cache:overview:{org}:{range} | dashboard cache | 60 s |
| graphflow:rl:* | rate limiting | window |
