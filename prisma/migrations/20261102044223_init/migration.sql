-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ORG_ADMIN', 'PROJECT_MANAGER', 'TEAM_LEAD', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ToolCategory" AS ENUM ('DESIGN', 'DEVELOPMENT', 'THREE_D', 'BROWSER', 'COMMUNICATION', 'PRODUCTIVITY', 'DOCUMENTATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ActivityEventType" AS ENUM ('APP_OPENED', 'APP_CLOSED', 'APPLICATION_SWITCH', 'FILE_CONTEXT_CHANGED', 'FOCUS_STARTED', 'FOCUS_ENDED', 'IDLE_STARTED', 'IDLE_ENDED', 'PROJECT_CHANGED', 'SESSION_HEARTBEAT');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'RETRYING', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ActivityCategory" AS ENUM ('DEEP_FOCUS', 'ACTIVE_WORK', 'COLLABORATION', 'ADMINISTRATIVE', 'IDLE', 'UNASSIGNED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'CLOSED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ADJUSTMENT_REQUIRED');

-- CreateEnum
CREATE TYPE "RoundingRule" AS ENUM ('NONE', 'UP_6_MIN', 'UP_15_MIN', 'NEAREST_15_MIN');

-- CreateEnum
CREATE TYPE "SimulationStatus" AS ENUM ('RUNNING', 'PAUSED', 'STOPPED', 'COMPLETED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_settings" (
    "organization_id" UUID NOT NULL,
    "deep_focus_min_minutes" INTEGER NOT NULL DEFAULT 25,
    "deep_focus_max_gap_minutes" INTEGER NOT NULL DEFAULT 2,
    "idle_timeout_minutes" INTEGER NOT NULL DEFAULT 5,
    "heartbeat_timeout_minutes" INTEGER NOT NULL DEFAULT 5,
    "context_switch_threshold_per_hour" INTEGER NOT NULL DEFAULT 6,
    "context_switch_cost_seconds" INTEGER NOT NULL DEFAULT 120,
    "fragment_threshold_seconds" INTEGER NOT NULL DEFAULT 120,
    "fragment_min_count_per_hour" INTEGER NOT NULL DEFAULT 3,
    "budget_alert_threshold_pct" INTEGER NOT NULL DEFAULT 80,
    "raw_event_retention_days" INTEGER NOT NULL DEFAULT 90,
    "audit_log_retention_days" INTEGER NOT NULL DEFAULT 730,
    "default_currency" TEXT NOT NULL DEFAULT 'USD',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'EMPLOYEE',
    "team_id" UUID,
    "title" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "tracking_consent" BOOLEAN NOT NULL DEFAULT false,
    "consent_updated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "last_login_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'EMPLOYEE',
    "team_id" UUID,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "manager_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "team_id" UUID,
    "project_manager_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "client_name" TEXT,
    "budget_hours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "hourly_rate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "start_date" DATE,
    "deadline" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assigned_role" TEXT NOT NULL DEFAULT 'Contributor',
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_billing_configs" (
    "project_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "billable_categories" "ActivityCategory"[] DEFAULT ARRAY['DEEP_FOCUS', 'ACTIVE_WORK']::"ActivityCategory"[],
    "collaboration_billable" BOOLEAN NOT NULL DEFAULT true,
    "administrative_billable" BOOLEAN NOT NULL DEFAULT false,
    "billable_tool_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "non_billable_tool_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "rounding_rule" "RoundingRule" NOT NULL DEFAULT 'NONE',
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_billing_configs_pkey" PRIMARY KEY ("project_id")
);

-- CreateTable
CREATE TABLE "tools" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ToolCategory" NOT NULL,
    "executable_name" TEXT NOT NULL,
    "default_billable_status" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID,
    "tool_id" UUID,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_type" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'web-simulator',
    "is_simulated" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "token_hash" TEXT,
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "project_id" UUID,
    "is_simulated" BOOLEAN NOT NULL DEFAULT true,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "last_event_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "tracked_seconds" INTEGER NOT NULL DEFAULT 0,
    "active_seconds" INTEGER NOT NULL DEFAULT 0,
    "idle_seconds" INTEGER NOT NULL DEFAULT 0,
    "deep_focus_seconds" INTEGER NOT NULL DEFAULT 0,
    "context_switch_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "activity_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_activity_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "simulation_run_id" UUID,
    "event_type" "ActivityEventType" NOT NULL,
    "event_timestamp" TIMESTAMPTZ(3) NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "is_simulated" BOOLEAN NOT NULL DEFAULT true,
    "processing_status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "last_error" TEXT,

    CONSTRAINT "raw_activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_event_inbox" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "source_event_id" UUID NOT NULL,
    "processing_status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "enqueued_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "activity_event_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "focus_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "project_id" UUID,
    "tool_id" UUID,
    "file_id" UUID,
    "device_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "source_event_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "idle_duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "is_idle" BOOLEAN NOT NULL DEFAULT false,
    "is_billable" BOOLEAN NOT NULL DEFAULT false,
    "is_context_switch" BOOLEAN NOT NULL DEFAULT false,
    "is_simulated" BOOLEAN NOT NULL DEFAULT true,
    "activity_category" "ActivityCategory" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "focus_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "source_user_id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source_session_id" UUID NOT NULL,
    "target_session_id" UUID NOT NULL,
    "interaction_type" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "context_switch_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collaboration_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "project_id" UUID,
    "scenario" TEXT NOT NULL,
    "speed" INTEGER NOT NULL DEFAULT 1,
    "status" "SimulationStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "simulation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billable_audits" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID,
    "reporting_period_start" TIMESTAMPTZ(3) NOT NULL,
    "reporting_period_end" TIMESTAMPTZ(3) NOT NULL,
    "total_tracked_seconds" INTEGER NOT NULL,
    "total_deep_focus_seconds" INTEGER NOT NULL,
    "total_active_work_seconds" INTEGER NOT NULL,
    "total_idle_seconds" INTEGER NOT NULL,
    "total_friction_seconds" INTEGER NOT NULL,
    "total_billable_seconds" INTEGER NOT NULL,
    "total_non_billable_seconds" INTEGER NOT NULL,
    "approved_billable_seconds" INTEGER NOT NULL DEFAULT 0,
    "context_switch_count" INTEGER NOT NULL,
    "billable_amount" DECIMAL(14,2) NOT NULL,
    "budget_utilization_percentage" DECIMAL(7,2) NOT NULL,
    "calculated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billable_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "reporting_period_start" TIMESTAMPTZ(3) NOT NULL,
    "reporting_period_end" TIMESTAMPTZ(3) NOT NULL,
    "tracked_seconds" INTEGER NOT NULL,
    "billable_seconds" INTEGER NOT NULL,
    "non_billable_seconds" INTEGER NOT NULL,
    "calculated_billable_seconds" INTEGER NOT NULL DEFAULT 0,
    "hourly_rate" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "billable_amount" DECIMAL(14,2) NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "submitted_at" TIMESTAMPTZ(3),
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "timesheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_adjustments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "timesheet_id" UUID NOT NULL,
    "previous_billable_seconds" INTEGER NOT NULL,
    "adjusted_billable_seconds" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "adjusted_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "project_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

-- CreateIndex
CREATE INDEX "users_organization_id_role_idx" ON "users"("organization_id", "role");

-- CreateIndex
CREATE INDEX "users_team_id_idx" ON "users"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_organization_id_email_idx" ON "invitations"("organization_id", "email");

-- CreateIndex
CREATE INDEX "teams_manager_id_idx" ON "teams"("manager_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_organization_id_name_key" ON "teams"("organization_id", "name");

-- CreateIndex
CREATE INDEX "projects_organization_id_status_idx" ON "projects"("organization_id", "status");

-- CreateIndex
CREATE INDEX "projects_team_id_idx" ON "projects"("team_id");

-- CreateIndex
CREATE INDEX "projects_project_manager_id_idx" ON "projects"("project_manager_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_organization_id_name_key" ON "projects"("organization_id", "name");

-- CreateIndex
CREATE INDEX "project_members_user_id_idx" ON "project_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_project_id_user_id_key" ON "project_members"("project_id", "user_id");

-- CreateIndex
CREATE INDEX "project_billing_configs_organization_id_idx" ON "project_billing_configs"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "tools_organization_id_executable_name_key" ON "tools"("organization_id", "executable_name");

-- CreateIndex
CREATE UNIQUE INDEX "tools_organization_id_name_key" ON "tools"("organization_id", "name");

-- CreateIndex
CREATE INDEX "files_project_id_idx" ON "files"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "files_organization_id_file_path_key" ON "files"("organization_id", "file_path");

-- CreateIndex
CREATE UNIQUE INDEX "devices_token_hash_key" ON "devices"("token_hash");

-- CreateIndex
CREATE INDEX "devices_organization_id_idx" ON "devices"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_user_id_name_key" ON "devices"("user_id", "name");

-- CreateIndex
CREATE INDEX "activity_sessions_organization_id_user_id_started_at_idx" ON "activity_sessions"("organization_id", "user_id", "started_at");

-- CreateIndex
CREATE INDEX "activity_sessions_status_last_event_at_idx" ON "activity_sessions"("status", "last_event_at");

-- CreateIndex
CREATE INDEX "raw_activity_events_organization_id_idx" ON "raw_activity_events"("organization_id");

-- CreateIndex
CREATE INDEX "raw_activity_events_user_id_idx" ON "raw_activity_events"("user_id");

-- CreateIndex
CREATE INDEX "raw_activity_events_event_timestamp_idx" ON "raw_activity_events"("event_timestamp");

-- CreateIndex
CREATE INDEX "raw_activity_events_event_type_idx" ON "raw_activity_events"("event_type");

-- CreateIndex
CREATE INDEX "raw_activity_events_processing_status_received_at_idx" ON "raw_activity_events"("processing_status", "received_at");

-- CreateIndex
CREATE INDEX "raw_activity_events_session_id_event_timestamp_idx" ON "raw_activity_events"("session_id", "event_timestamp");

-- CreateIndex
CREATE INDEX "raw_activity_events_simulation_run_id_idx" ON "raw_activity_events"("simulation_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "raw_activity_events_organization_id_client_event_id_key" ON "raw_activity_events"("organization_id", "client_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "activity_event_inbox_source_event_id_key" ON "activity_event_inbox"("source_event_id");

-- CreateIndex
CREATE INDEX "activity_event_inbox_processing_status_received_at_idx" ON "activity_event_inbox"("processing_status", "received_at");

-- CreateIndex
CREATE INDEX "activity_event_inbox_organization_id_idx" ON "activity_event_inbox"("organization_id");

-- CreateIndex
CREATE INDEX "focus_events_organization_id_started_at_idx" ON "focus_events"("organization_id", "started_at");

-- CreateIndex
CREATE INDEX "focus_events_user_id_started_at_idx" ON "focus_events"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "focus_events_project_id_started_at_idx" ON "focus_events"("project_id", "started_at");

-- CreateIndex
CREATE INDEX "focus_events_session_id_idx" ON "focus_events"("session_id");

-- CreateIndex
CREATE INDEX "focus_events_tool_id_idx" ON "focus_events"("tool_id");

-- CreateIndex
CREATE INDEX "collaboration_links_organization_id_started_at_idx" ON "collaboration_links"("organization_id", "started_at");

-- CreateIndex
CREATE INDEX "collaboration_links_project_id_idx" ON "collaboration_links"("project_id");

-- CreateIndex
CREATE INDEX "collaboration_links_source_session_id_idx" ON "collaboration_links"("source_session_id");

-- CreateIndex
CREATE INDEX "collaboration_links_target_session_id_idx" ON "collaboration_links"("target_session_id");

-- CreateIndex
CREATE INDEX "simulation_runs_organization_id_actor_id_started_at_idx" ON "simulation_runs"("organization_id", "actor_id", "started_at");

-- CreateIndex
CREATE INDEX "billable_audits_organization_id_reporting_period_start_idx" ON "billable_audits"("organization_id", "reporting_period_start");

-- CreateIndex
CREATE INDEX "billable_audits_project_id_reporting_period_start_idx" ON "billable_audits"("project_id", "reporting_period_start");

-- CreateIndex
CREATE INDEX "timesheets_organization_id_status_idx" ON "timesheets"("organization_id", "status");

-- CreateIndex
CREATE INDEX "timesheets_project_id_status_idx" ON "timesheets"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "timesheets_user_id_project_id_reporting_period_start_report_key" ON "timesheets"("user_id", "project_id", "reporting_period_start", "reporting_period_end");

-- CreateIndex
CREATE INDEX "billing_adjustments_timesheet_id_idx" ON "billing_adjustments"("timesheet_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_project_id_idx" ON "audit_logs"("project_id");

-- AddForeignKey
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_project_manager_id_fkey" FOREIGN KEY ("project_manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_billing_configs" ADD CONSTRAINT "project_billing_configs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_billing_configs" ADD CONSTRAINT "project_billing_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tools" ADD CONSTRAINT "tools_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_sessions" ADD CONSTRAINT "activity_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_sessions" ADD CONSTRAINT "activity_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_sessions" ADD CONSTRAINT "activity_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_sessions" ADD CONSTRAINT "activity_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_activity_events" ADD CONSTRAINT "raw_activity_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_activity_events" ADD CONSTRAINT "raw_activity_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_activity_events" ADD CONSTRAINT "raw_activity_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_activity_events" ADD CONSTRAINT "raw_activity_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "activity_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_activity_events" ADD CONSTRAINT "raw_activity_events_simulation_run_id_fkey" FOREIGN KEY ("simulation_run_id") REFERENCES "simulation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_event_inbox" ADD CONSTRAINT "activity_event_inbox_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_event_inbox" ADD CONSTRAINT "activity_event_inbox_source_event_id_fkey" FOREIGN KEY ("source_event_id") REFERENCES "raw_activity_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_events" ADD CONSTRAINT "focus_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_events" ADD CONSTRAINT "focus_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_events" ADD CONSTRAINT "focus_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_events" ADD CONSTRAINT "focus_events_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_events" ADD CONSTRAINT "focus_events_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_events" ADD CONSTRAINT "focus_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_events" ADD CONSTRAINT "focus_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "activity_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_links" ADD CONSTRAINT "collaboration_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_links" ADD CONSTRAINT "collaboration_links_source_user_id_fkey" FOREIGN KEY ("source_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_links" ADD CONSTRAINT "collaboration_links_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_links" ADD CONSTRAINT "collaboration_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billable_audits" ADD CONSTRAINT "billable_audits_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billable_audits" ADD CONSTRAINT "billable_audits_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billable_audits" ADD CONSTRAINT "billable_audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_adjustments" ADD CONSTRAINT "billing_adjustments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_adjustments" ADD CONSTRAINT "billing_adjustments_timesheet_id_fkey" FOREIGN KEY ("timesheet_id") REFERENCES "timesheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_adjustments" ADD CONSTRAINT "billing_adjustments_adjusted_by_fkey" FOREIGN KEY ("adjusted_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
