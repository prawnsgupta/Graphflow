-- =============================================================================
-- GraphFlow security migration
--   * restricted application role + grants
--   * CHECK constraints
--   * request-context helper functions (transaction-scoped GUCs)
--   * Row-Level Security policies (ENABLE + FORCE) on every tenant table
--   * guard triggers (append-only audit log, privilege-escalation guard,
--     timesheet review rules)
--   * narrow SECURITY DEFINER functions for pre-authentication lookups and
--     cross-tenant maintenance jobs
--
-- Request context is set per transaction by the application:
--   SELECT set_config('app.user_id', $1, true),
--          set_config('app.organization_id', $2, true),
--          set_config('app.user_role', $3, true);
-- 'SYSTEM' is used as app.user_role by the background worker for a single
-- organization at a time.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Application role and privileges
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'graphflow_app') THEN
    CREATE ROLE graphflow_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO graphflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO graphflow_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO graphflow_app;
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE "_prisma_migrations" FROM graphflow_app';
  END IF;
END $$;
-- Append-only tables
REVOKE UPDATE, DELETE ON TABLE audit_logs FROM graphflow_app;
REVOKE UPDATE, DELETE ON TABLE billing_adjustments FROM graphflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO graphflow_app;

-- ---------------------------------------------------------------------------
-- 2. Integrity constraints Prisma cannot express
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email));
ALTER TABLE projects ADD CONSTRAINT projects_budget_nonneg CHECK (budget_hours >= 0);
ALTER TABLE projects ADD CONSTRAINT projects_rate_nonneg CHECK (hourly_rate >= 0);
ALTER TABLE projects ADD CONSTRAINT projects_dates_valid CHECK (deadline IS NULL OR start_date IS NULL OR deadline >= start_date);
ALTER TABLE focus_events ADD CONSTRAINT focus_events_interval_valid CHECK (ended_at > started_at);
ALTER TABLE focus_events ADD CONSTRAINT focus_events_duration_valid CHECK (duration_seconds > 0);
ALTER TABLE focus_events ADD CONSTRAINT focus_events_idle_valid CHECK (idle_duration_seconds >= 0 AND idle_duration_seconds <= duration_seconds);
ALTER TABLE activity_sessions ADD CONSTRAINT activity_sessions_time_valid CHECK (last_event_at >= started_at);
ALTER TABLE collaboration_links ADD CONSTRAINT collab_interval_valid CHECK (ended_at > started_at AND duration_seconds > 0);
ALTER TABLE collaboration_links ADD CONSTRAINT collab_distinct_users CHECK (source_user_id <> target_user_id);
ALTER TABLE timesheets ADD CONSTRAINT timesheets_period_valid CHECK (reporting_period_end > reporting_period_start);
ALTER TABLE timesheets ADD CONSTRAINT timesheets_seconds_valid CHECK (
  tracked_seconds >= 0 AND billable_seconds >= 0 AND non_billable_seconds >= 0 AND calculated_billable_seconds >= 0
  AND billable_seconds <= tracked_seconds);
ALTER TABLE timesheets ADD CONSTRAINT timesheets_amount_valid CHECK (billable_amount >= 0 AND hourly_rate >= 0);
ALTER TABLE billing_adjustments ADD CONSTRAINT billing_adjustments_valid CHECK (
  previous_billable_seconds >= 0 AND adjusted_billable_seconds >= 0 AND length(trim(reason)) > 0);
ALTER TABLE billable_audits ADD CONSTRAINT billable_audits_period_valid CHECK (reporting_period_end > reporting_period_start);
ALTER TABLE raw_activity_events ADD CONSTRAINT raw_events_attempts_valid CHECK (attempts >= 0);
ALTER TABLE organization_settings ADD CONSTRAINT org_settings_valid CHECK (
  deep_focus_min_minutes BETWEEN 1 AND 480 AND deep_focus_max_gap_minutes BETWEEN 0 AND 60
  AND idle_timeout_minutes BETWEEN 1 AND 120 AND heartbeat_timeout_minutes BETWEEN 1 AND 120
  AND context_switch_threshold_per_hour BETWEEN 0 AND 600 AND context_switch_cost_seconds BETWEEN 0 AND 3600
  AND fragment_threshold_seconds BETWEEN 0 AND 3600 AND fragment_min_count_per_hour BETWEEN 1 AND 600
  AND budget_alert_threshold_pct BETWEEN 1 AND 100
  AND raw_event_retention_days BETWEEN 1 AND 3650 AND audit_log_retention_days BETWEEN 30 AND 3650);

-- ---------------------------------------------------------------------------
-- 3. Request-context helpers (SECURITY INVOKER)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_current_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_role', true), '')
$$;

CREATE OR REPLACE FUNCTION app_is_system() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(app_current_role() = 'SYSTEM', false)
$$;

CREATE OR REPLACE FUNCTION app_is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(app_current_role() IN ('SUPER_ADMIN', 'ORG_ADMIN', 'SYSTEM'), false)
$$;

CREATE OR REPLACE FUNCTION app_is_superuser() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
$$;

-- ---------------------------------------------------------------------------
-- 4. Relationship helpers (SECURITY DEFINER: read relationships without
--    recursive RLS evaluation; always constrained to the current org)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_user_team(p_user uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT team_id FROM users WHERE id = p_user AND organization_id = app_current_org()
$$;

CREATE OR REPLACE FUNCTION app_project_team(p_project uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT team_id FROM projects WHERE id = p_project AND organization_id = app_current_org()
$$;

CREATE OR REPLACE FUNCTION app_is_project_member(p_project uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members m JOIN projects p ON p.id = m.project_id
    WHERE m.project_id = p_project AND m.user_id = p_user AND p.organization_id = app_current_org())
$$;

-- Can the current user see this project?
CREATE OR REPLACE FUNCTION app_can_view_project(p_project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project AND p.organization_id = app_current_org()
      AND (
        app_is_admin()
        OR p.project_manager_id = app_current_user_id()
        OR (app_current_role() = 'TEAM_LEAD' AND p.team_id IS NOT NULL
            AND p.team_id = app_user_team(app_current_user_id()))
        OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = app_current_user_id())
      ))
$$;

-- Can the current user manage (edit, assign, review billing for) this project?
CREATE OR REPLACE FUNCTION app_manages_project(p_project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project AND p.organization_id = app_current_org()
      AND (app_is_admin() OR p.project_manager_id = app_current_user_id()))
$$;

-- Can the current user manage this person (team lead of their team, PM of a
-- project they belong to, or admin)? Used for simulation on behalf of others.
CREATE OR REPLACE FUNCTION app_can_manage_user(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM users u WHERE u.id = p_user AND u.organization_id = app_current_org())
    AND (
      app_is_admin()
      OR (app_current_role() = 'TEAM_LEAD' AND app_user_team(p_user) IS NOT NULL
          AND app_user_team(p_user) = app_user_team(app_current_user_id()))
      OR (app_current_role() = 'PROJECT_MANAGER' AND EXISTS (
            SELECT 1 FROM project_members m JOIN projects p ON p.id = m.project_id
            WHERE m.user_id = p_user AND p.project_manager_id = app_current_user_id()
              AND p.organization_id = app_current_org()))
    )
$$;

-- Can the current user see this person's activity on this project?
--   self: always; admin: all; team lead: members of own team;
--   project manager: only activity attributed to projects they manage.
CREATE OR REPLACE FUNCTION app_can_view_user_activity(p_user uuid, p_project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p_user = app_current_user_id()
    OR app_is_admin()
    OR (app_current_role() = 'TEAM_LEAD' AND app_user_team(p_user) IS NOT NULL
        AND app_user_team(p_user) = app_user_team(app_current_user_id()))
    OR (app_current_role() = 'PROJECT_MANAGER' AND p_project IS NOT NULL AND EXISTS (
          SELECT 1 FROM projects p WHERE p.id = p_project AND p.organization_id = app_current_org()
            AND p.project_manager_id = app_current_user_id()))
$$;

-- ---------------------------------------------------------------------------
-- 5. Row-Level Security
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','organization_settings','users','auth_sessions','password_reset_tokens',
    'invitations','teams','projects','project_members','project_billing_configs','tools','files',
    'devices','activity_sessions','raw_activity_events','activity_event_inbox','focus_events',
    'collaboration_links','simulation_runs','billable_audits','timesheets','billing_adjustments',
    'audit_logs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- organizations
CREATE POLICY org_select ON organizations FOR SELECT USING (id = app_current_org());
CREATE POLICY org_update ON organizations FOR UPDATE
  USING (id = app_current_org() AND app_is_admin()) WITH CHECK (id = app_current_org());

-- organization_settings
CREATE POLICY org_settings_select ON organization_settings FOR SELECT USING (organization_id = app_current_org());
CREATE POLICY org_settings_insert ON organization_settings FOR INSERT
  WITH CHECK (organization_id = app_current_org() AND app_is_admin());
CREATE POLICY org_settings_update ON organization_settings FOR UPDATE
  USING (organization_id = app_current_org() AND app_is_admin()) WITH CHECK (organization_id = app_current_org());

-- users (directory is visible within the org; activity is protected separately)
CREATE POLICY users_select ON users FOR SELECT USING (organization_id = app_current_org());
CREATE POLICY users_insert ON users FOR INSERT WITH CHECK (organization_id = app_current_org() AND app_is_admin());
CREATE POLICY users_update ON users FOR UPDATE
  USING (organization_id = app_current_org() AND (app_is_admin() OR id = app_current_user_id()))
  WITH CHECK (organization_id = app_current_org());

-- auth_sessions
CREATE POLICY auth_sessions_all ON auth_sessions FOR ALL
  USING (organization_id = app_current_org() AND (user_id = app_current_user_id() OR app_is_system()))
  WITH CHECK (organization_id = app_current_org() AND (user_id = app_current_user_id() OR app_is_system()));

-- password_reset_tokens (system context only)
CREATE POLICY reset_tokens_all ON password_reset_tokens FOR ALL
  USING (organization_id = app_current_org() AND app_is_system())
  WITH CHECK (organization_id = app_current_org() AND app_is_system());

-- invitations
CREATE POLICY invitations_all ON invitations FOR ALL
  USING (organization_id = app_current_org() AND app_is_admin())
  WITH CHECK (organization_id = app_current_org() AND app_is_admin());

-- teams
CREATE POLICY teams_select ON teams FOR SELECT USING (organization_id = app_current_org());
CREATE POLICY teams_insert ON teams FOR INSERT WITH CHECK (organization_id = app_current_org() AND app_is_admin());
CREATE POLICY teams_update ON teams FOR UPDATE
  USING (organization_id = app_current_org() AND app_is_admin()) WITH CHECK (organization_id = app_current_org());
CREATE POLICY teams_delete ON teams FOR DELETE USING (organization_id = app_current_org() AND app_is_admin());

-- projects
CREATE POLICY projects_select ON projects FOR SELECT USING (
  organization_id = app_current_org() AND (
    app_is_admin()
    OR project_manager_id = app_current_user_id()
    OR (app_current_role() = 'TEAM_LEAD' AND team_id IS NOT NULL AND team_id = app_user_team(app_current_user_id()))
    OR app_is_project_member(id, app_current_user_id())));
CREATE POLICY projects_insert ON projects FOR INSERT WITH CHECK (
  organization_id = app_current_org() AND (
    app_is_admin() OR (app_current_role() = 'PROJECT_MANAGER' AND project_manager_id = app_current_user_id())));
CREATE POLICY projects_update ON projects FOR UPDATE
  USING (organization_id = app_current_org() AND (app_is_admin() OR project_manager_id = app_current_user_id()))
  WITH CHECK (organization_id = app_current_org() AND (app_is_admin() OR project_manager_id = app_current_user_id()));
CREATE POLICY projects_delete ON projects FOR DELETE USING (organization_id = app_current_org() AND app_is_admin());

-- project_members (no organization_id column: scoped through the project)
CREATE POLICY project_members_select ON project_members FOR SELECT
  USING (user_id = app_current_user_id() OR app_can_view_project(project_id));
CREATE POLICY project_members_insert ON project_members FOR INSERT WITH CHECK (app_manages_project(project_id));
CREATE POLICY project_members_update ON project_members FOR UPDATE
  USING (app_manages_project(project_id)) WITH CHECK (app_manages_project(project_id));
CREATE POLICY project_members_delete ON project_members FOR DELETE USING (app_manages_project(project_id));

-- project_billing_configs
CREATE POLICY billing_cfg_select ON project_billing_configs FOR SELECT
  USING (organization_id = app_current_org() AND (app_is_system() OR app_can_view_project(project_id)));
CREATE POLICY billing_cfg_insert ON project_billing_configs FOR INSERT
  WITH CHECK (organization_id = app_current_org() AND app_manages_project(project_id));
CREATE POLICY billing_cfg_update ON project_billing_configs FOR UPDATE
  USING (organization_id = app_current_org() AND app_manages_project(project_id))
  WITH CHECK (organization_id = app_current_org() AND app_manages_project(project_id));

-- tools
CREATE POLICY tools_select ON tools FOR SELECT USING (organization_id = app_current_org());
CREATE POLICY tools_write ON tools FOR ALL
  USING (organization_id = app_current_org() AND app_is_admin())
  WITH CHECK (organization_id = app_current_org() AND app_is_admin());

-- files (metadata only)
CREATE POLICY files_select ON files FOR SELECT USING (
  organization_id = app_current_org() AND (project_id IS NULL OR app_is_system() OR app_can_view_project(project_id)));
CREATE POLICY files_insert ON files FOR INSERT WITH CHECK (
  organization_id = app_current_org() AND (app_is_admin() OR created_by = app_current_user_id()));
CREATE POLICY files_update ON files FOR UPDATE
  USING (organization_id = app_current_org() AND (app_is_admin() OR created_by = app_current_user_id()))
  WITH CHECK (organization_id = app_current_org());

-- devices
CREATE POLICY devices_all ON devices FOR ALL
  USING (organization_id = app_current_org() AND (
    user_id = app_current_user_id() OR app_is_system() OR app_can_manage_user(user_id)))
  WITH CHECK (organization_id = app_current_org() AND (
    user_id = app_current_user_id() OR app_is_system() OR app_can_manage_user(user_id)));

-- activity_sessions
CREATE POLICY sessions_select ON activity_sessions FOR SELECT USING (
  organization_id = app_current_org() AND (app_is_system() OR app_can_view_user_activity(user_id, project_id)));
CREATE POLICY sessions_insert ON activity_sessions FOR INSERT WITH CHECK (
  organization_id = app_current_org() AND (
    app_is_system() OR user_id = app_current_user_id() OR app_can_manage_user(user_id)));
CREATE POLICY sessions_update ON activity_sessions FOR UPDATE
  USING (organization_id = app_current_org() AND app_is_system()) WITH CHECK (organization_id = app_current_org());
CREATE POLICY sessions_delete ON activity_sessions FOR DELETE
  USING (organization_id = app_current_org() AND app_is_system());

-- raw_activity_events: raw metadata only visible to the owner, admins and the worker
CREATE POLICY raw_events_select ON raw_activity_events FOR SELECT USING (
  organization_id = app_current_org() AND (app_is_admin() OR user_id = app_current_user_id()));
CREATE POLICY raw_events_insert ON raw_activity_events FOR INSERT WITH CHECK (
  organization_id = app_current_org() AND (
    app_is_system() OR user_id = app_current_user_id() OR app_can_manage_user(user_id)));
CREATE POLICY raw_events_update ON raw_activity_events FOR UPDATE
  USING (organization_id = app_current_org() AND app_is_system()) WITH CHECK (organization_id = app_current_org());
CREATE POLICY raw_events_delete ON raw_activity_events FOR DELETE
  USING (organization_id = app_current_org() AND app_is_system());

-- activity_event_inbox (processing ledger)
CREATE POLICY inbox_select ON activity_event_inbox FOR SELECT
  USING (organization_id = app_current_org() AND app_is_admin());
CREATE POLICY inbox_insert ON activity_event_inbox FOR INSERT WITH CHECK (organization_id = app_current_org());
CREATE POLICY inbox_update ON activity_event_inbox FOR UPDATE
  USING (organization_id = app_current_org() AND app_is_system()) WITH CHECK (organization_id = app_current_org());

-- focus_events (written only by the worker)
CREATE POLICY focus_select ON focus_events FOR SELECT USING (
  organization_id = app_current_org() AND (app_is_system() OR app_can_view_user_activity(user_id, project_id)));
CREATE POLICY focus_write ON focus_events FOR ALL
  USING (organization_id = app_current_org() AND app_is_system())
  WITH CHECK (organization_id = app_current_org() AND app_is_system());

-- collaboration_links (written only by the worker)
CREATE POLICY collab_select ON collaboration_links FOR SELECT USING (
  organization_id = app_current_org() AND (
    app_is_system()
    OR app_can_view_user_activity(source_user_id, project_id)
    OR app_can_view_user_activity(target_user_id, project_id)));
CREATE POLICY collab_write ON collaboration_links FOR ALL
  USING (organization_id = app_current_org() AND app_is_system())
  WITH CHECK (organization_id = app_current_org() AND app_is_system());

-- simulation_runs
CREATE POLICY sim_select ON simulation_runs FOR SELECT USING (
  organization_id = app_current_org() AND (
    actor_id = app_current_user_id() OR user_id = app_current_user_id() OR app_is_admin()));
CREATE POLICY sim_insert ON simulation_runs FOR INSERT WITH CHECK (
  organization_id = app_current_org() AND actor_id = app_current_user_id());
CREATE POLICY sim_update ON simulation_runs FOR UPDATE
  USING (organization_id = app_current_org() AND (actor_id = app_current_user_id() OR app_is_system()))
  WITH CHECK (organization_id = app_current_org());

-- billable_audits
CREATE POLICY audits_select ON billable_audits FOR SELECT USING (
  organization_id = app_current_org() AND (
    app_is_admin()
    OR app_manages_project(project_id)
    OR (app_current_role() = 'TEAM_LEAD' AND app_project_team(project_id) IS NOT NULL
        AND app_project_team(project_id) = app_user_team(app_current_user_id()))
    OR user_id = app_current_user_id()));
CREATE POLICY audits_write ON billable_audits FOR ALL
  USING (organization_id = app_current_org() AND (app_is_admin() OR app_manages_project(project_id)))
  WITH CHECK (organization_id = app_current_org() AND (app_is_admin() OR app_manages_project(project_id)));

-- timesheets
CREATE POLICY timesheets_select ON timesheets FOR SELECT USING (
  organization_id = app_current_org() AND (app_is_system() OR app_can_view_user_activity(user_id, project_id)));
CREATE POLICY timesheets_insert ON timesheets FOR INSERT WITH CHECK (
  organization_id = app_current_org() AND (
    app_is_system() OR user_id = app_current_user_id() OR app_manages_project(project_id)));
CREATE POLICY timesheets_update ON timesheets FOR UPDATE
  USING (organization_id = app_current_org() AND (
    app_is_system() OR user_id = app_current_user_id() OR app_manages_project(project_id)))
  WITH CHECK (organization_id = app_current_org());
CREATE POLICY timesheets_delete ON timesheets FOR DELETE USING (
  organization_id = app_current_org() AND (
    app_is_admin() OR (user_id = app_current_user_id() AND status = 'DRAFT')));

-- billing_adjustments (append-only)
CREATE POLICY adjustments_select ON billing_adjustments FOR SELECT USING (
  organization_id = app_current_org()
  AND EXISTS (SELECT 1 FROM timesheets t WHERE t.id = timesheet_id));
CREATE POLICY adjustments_insert ON billing_adjustments FOR INSERT WITH CHECK (
  organization_id = app_current_org()
  AND (adjusted_by = app_current_user_id() OR app_is_system())
  AND EXISTS (SELECT 1 FROM timesheets t WHERE t.id = timesheet_id));

-- audit_logs (append-only)
CREATE POLICY audit_select ON audit_logs FOR SELECT USING (
  organization_id = app_current_org() AND (
    app_is_admin()
    OR actor_id = app_current_user_id()
    OR (project_id IS NOT NULL AND app_manages_project(project_id))));
CREATE POLICY audit_insert ON audit_logs FOR INSERT WITH CHECK (
  organization_id = app_current_org() AND (
    actor_id IS NULL OR actor_id = app_current_user_id() OR app_is_system()));

-- ---------------------------------------------------------------------------
-- 6. Guard triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_superuser() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION app_append_only_guard();
CREATE TRIGGER billing_adjustments_append_only BEFORE UPDATE OR DELETE ON billing_adjustments
  FOR EACH ROW EXECUTE FUNCTION app_append_only_guard();

-- Non-admins may update their own profile but never their role, team,
-- activation state, organization or email.
CREATE OR REPLACE FUNCTION app_users_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_superuser() OR app_is_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.team_id IS DISTINCT FROM OLD.team_id
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'insufficient privilege to change role, team, status or email' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER users_guard BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION app_users_guard();

-- Timesheet workflow rules enforced in the database as defence in depth.
CREATE OR REPLACE FUNCTION app_timesheets_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_superuser() OR app_is_system() THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'APPROVED' THEN
    RAISE EXCEPTION 'approved timesheets are immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'timesheet ownership cannot change' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('APPROVED', 'REJECTED', 'ADJUSTMENT_REQUIRED') THEN
      IF NEW.user_id = app_current_user_id() THEN
        RAISE EXCEPTION 'users cannot review their own timesheets' USING ERRCODE = '42501';
      END IF;
      IF NOT app_manages_project(NEW.project_id) THEN
        RAISE EXCEPTION 'only the project manager or an administrator can review timesheets' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.status = 'SUBMITTED' AND NEW.user_id <> app_current_user_id() THEN
      RAISE EXCEPTION 'only the timesheet owner can submit it' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER timesheets_guard BEFORE UPDATE ON timesheets FOR EACH ROW EXECUTE FUNCTION app_timesheets_guard();

-- ---------------------------------------------------------------------------
-- 7. SECURITY DEFINER entry points (pre-authentication + maintenance).
--    Each returns only the minimum columns needed.
-- ---------------------------------------------------------------------------

-- Credentials login lookup by email.
CREATE OR REPLACE FUNCTION app_auth_lookup_user(p_email text)
RETURNS TABLE (id uuid, organization_id uuid, role "UserRole", password_hash text, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.organization_id, u.role, u.password_hash, u.is_active
  FROM users u WHERE u.email = lower(p_email)
$$;

-- Resolve a session cookie (token HMAC) to the current identity.
CREATE OR REPLACE FUNCTION app_auth_session_lookup(p_token_hash text)
RETURNS TABLE (
  session_id uuid, user_id uuid, organization_id uuid, role "UserRole", display_name text, email text,
  team_id uuid, tracking_consent boolean, expires_at timestamptz, last_seen_at timestamptz,
  org_name text, org_slug text, org_timezone text, org_is_demo boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, u.id, u.organization_id, u.role, u.display_name, u.email, u.team_id, u.tracking_consent,
         s.expires_at, s.last_seen_at, o.name, o.slug, o.timezone, o.is_demo
  FROM auth_sessions s
  JOIN users u ON u.id = s.user_id
  JOIN organizations o ON o.id = u.organization_id
  WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL AND s.expires_at > now() AND u.is_active
$$;

-- Resolve a device bearer token (future desktop agent).
CREATE OR REPLACE FUNCTION app_device_token_lookup(p_token_hash text)
RETURNS TABLE (device_id uuid, user_id uuid, organization_id uuid, role "UserRole")
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id, u.id, u.organization_id, u.role
  FROM devices d JOIN users u ON u.id = d.user_id
  WHERE d.token_hash = p_token_hash AND d.is_active AND u.is_active
$$;

CREATE OR REPLACE FUNCTION app_lookup_reset_token(p_token_hash text)
RETURNS TABLE (id uuid, user_id uuid, organization_id uuid, expires_at timestamptz, used_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.user_id, t.organization_id, t.expires_at, t.used_at
  FROM password_reset_tokens t WHERE t.token_hash = p_token_hash
$$;

CREATE OR REPLACE FUNCTION app_lookup_invitation(p_token_hash text)
RETURNS TABLE (id uuid, organization_id uuid, email text, display_name text, role "UserRole", team_id uuid,
               expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz, org_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.organization_id, i.email, i.display_name, i.role, i.team_id,
         i.expires_at, i.accepted_at, i.revoked_at, o.name
  FROM invitations i JOIN organizations o ON o.id = i.organization_id
  WHERE i.token_hash = p_token_hash
$$;

-- Ownership check for a client-supplied session id (prevents a collector from
-- appending events to someone else's session). True if absent or matching.
CREATE OR REPLACE FUNCTION app_session_owner_matches(p_session uuid, p_user uuid, p_device uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM activity_sessions s
    WHERE s.id = p_session AND (s.user_id <> p_user OR s.device_id <> p_device OR s.organization_id <> app_current_org()))
$$;

-- Simulator status for a run the caller started, is the subject of, or administers.
CREATE OR REPLACE FUNCTION app_simulation_run_stats(p_run uuid)
RETURNS TABLE (processing_status "ProcessingStatus", event_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.processing_status, count(*)
  FROM raw_activity_events e JOIN simulation_runs r ON r.id = e.simulation_run_id
  WHERE r.id = p_run AND r.organization_id = app_current_org()
    AND (r.actor_id = app_current_user_id() OR r.user_id = app_current_user_id() OR app_is_admin())
  GROUP BY e.processing_status
$$;

CREATE OR REPLACE FUNCTION app_simulation_run_events(p_run uuid, p_limit int)
RETURNS TABLE (client_event_id uuid, event_type "ActivityEventType", event_timestamp timestamptz,
               processing_status "ProcessingStatus", last_error text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.client_event_id, e.event_type, e.event_timestamp, e.processing_status, e.last_error
  FROM raw_activity_events e JOIN simulation_runs r ON r.id = e.simulation_run_id
  WHERE r.id = p_run AND r.organization_id = app_current_org()
    AND (r.actor_id = app_current_user_id() OR r.user_id = app_current_user_id() OR app_is_admin())
  ORDER BY e.received_at DESC
  LIMIT least(p_limit, 500)
$$;

-- Maintenance: events accepted but not yet processed (recovery scanner).
CREATE OR REPLACE FUNCTION app_unprocessed_events(p_stale_seconds int, p_limit int)
RETURNS TABLE (id uuid, organization_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.source_event_id, i.organization_id
  FROM activity_event_inbox i
  WHERE i.processing_status IN ('PENDING', 'RETRYING', 'PROCESSING')
    AND (i.enqueued_at IS NULL OR i.enqueued_at < now() - make_interval(secs => p_stale_seconds))
  ORDER BY i.received_at
  LIMIT least(p_limit, 5000)
$$;

-- Maintenance: open sessions whose heartbeat timed out.
CREATE OR REPLACE FUNCTION app_stale_open_sessions(p_limit int)
RETURNS TABLE (id uuid, organization_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.organization_id
  FROM activity_sessions s
  LEFT JOIN organization_settings os ON os.organization_id = s.organization_id
  WHERE s.status = 'OPEN'
    AND s.last_event_at < now() - make_interval(mins => coalesce(os.heartbeat_timeout_minutes, 5))
  ORDER BY s.last_event_at
  LIMIT least(p_limit, 1000)
$$;

CREATE OR REPLACE FUNCTION app_list_organization_ids()
RETURNS TABLE (id uuid, timezone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.timezone FROM organizations o ORDER BY o.created_at
$$;

-- Maintenance: data retention for raw events of closed sessions and old audit logs.
CREATE OR REPLACE FUNCTION app_apply_retention()
RETURNS TABLE (raw_events_deleted bigint, audit_logs_deleted bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE r bigint; a bigint;
BEGIN
  WITH del AS (
    DELETE FROM raw_activity_events e
    USING activity_sessions s, organization_settings os
    WHERE s.id = e.session_id AND s.status <> 'OPEN'
      AND os.organization_id = e.organization_id
      AND e.processing_status IN ('PROCESSED', 'SKIPPED')
      AND e.received_at < now() - make_interval(days => os.raw_event_retention_days)
    RETURNING 1)
  SELECT count(*) INTO r FROM del;
  WITH del AS (
    DELETE FROM audit_logs l
    USING organization_settings os
    WHERE os.organization_id = l.organization_id
      AND l.created_at < now() - make_interval(days => os.audit_log_retention_days)
    RETURNING 1)
  SELECT count(*) INTO a FROM del;
  RETURN QUERY SELECT r, a;
END $$;

-- Lock down definer functions: only the app role may execute them.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'app_auth_lookup_user(text)', 'app_auth_session_lookup(text)', 'app_device_token_lookup(text)',
    'app_lookup_reset_token(text)', 'app_lookup_invitation(text)',
    'app_session_owner_matches(uuid,uuid,uuid)', 'app_simulation_run_stats(uuid)',
    'app_simulation_run_events(uuid,integer)', 'app_unprocessed_events(integer,integer)',
    'app_stale_open_sessions(integer)', 'app_list_organization_ids()', 'app_apply_retention()',
    'app_user_team(uuid)', 'app_project_team(uuid)', 'app_is_project_member(uuid,uuid)',
    'app_can_view_project(uuid)', 'app_manages_project(uuid)', 'app_can_manage_user(uuid)',
    'app_can_view_user_activity(uuid,uuid)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO graphflow_app', f);
  END LOOP;
END $$;
