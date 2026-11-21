/**
 * OpenAPI 3.1 description of the GraphFlow REST API.
 * Served at GET /api/openapi. Keep in sync with src/app/api/** route handlers.
 */
type Op = { summary: string; tag: string; auth?: "session" | "none" | "session-or-device"; body?: string; query?: string[]; responses?: Record<string, string> };

const ops: Record<string, Partial<Record<"get" | "post" | "patch" | "put" | "delete", Op>>> = {
  "/api/health": { get: { summary: "Health of app, PostgreSQL, Redis and worker", tag: "Health", auth: "none" } },
  "/api/health/live": { get: { summary: "Liveness probe", tag: "Health", auth: "none" } },
  "/api/auth/login": { post: { summary: "Log in with email/password; sets HTTP-only session cookie", tag: "Auth", auth: "none", body: "LoginRequest", responses: { "200": "Logged in", "401": "Invalid credentials", "429": "Rate limited" } } },
  "/api/auth/logout": { post: { summary: "Revoke current session", tag: "Auth" } },
  "/api/auth/session": { get: { summary: "Current identity, role and navigation", tag: "Auth", auth: "none" } },
  "/api/auth/forgot-password": { post: { summary: "Request a password reset link (always 200)", tag: "Auth", auth: "none", body: "ForgotPasswordRequest" } },
  "/api/auth/reset-password": { post: { summary: "Reset password with a one-time token", tag: "Auth", auth: "none", body: "ResetPasswordRequest" } },
  "/api/auth/change-password": { post: { summary: "Change own password", tag: "Auth", body: "ChangePasswordRequest" } },
  "/api/auth/invitations/{token}": {
    get: { summary: "Inspect an invitation", tag: "Auth", auth: "none" },
    post: { summary: "Accept an invitation and create the account", tag: "Auth", auth: "none", body: "AcceptInvitationRequest" },
  },
  "/api/organizations/current": { get: { summary: "Current organization", tag: "Organizations" }, patch: { summary: "Update organization (admin)", tag: "Organizations" } },
  "/api/employees": {
    get: { summary: "List employees visible to the caller", tag: "Employees", query: ["search", "teamId", "role", "status", "page", "pageSize"] },
    post: { summary: "Invite an employee (admin)", tag: "Employees", body: "InviteRequest" },
  },
  "/api/employees/{id}": { get: { summary: "Employee details", tag: "Employees" }, patch: { summary: "Update role/team/status (admin)", tag: "Employees" } },
  "/api/employees/{id}/analytics": { get: { summary: "Employee analytics (RLS-scoped)", tag: "Analytics", query: ["from", "to", "projectId"] } },
  "/api/invitations": { get: { summary: "Pending invitations (admin)", tag: "Employees" } },
  "/api/invitations/{id}": { delete: { summary: "Revoke invitation (admin)", tag: "Employees" } },
  "/api/teams": { get: { summary: "List teams", tag: "Teams" }, post: { summary: "Create team (admin)", tag: "Teams", body: "TeamRequest" } },
  "/api/teams/{id}": { patch: { summary: "Update team (admin)", tag: "Teams" }, delete: { summary: "Delete empty team (admin)", tag: "Teams" } },
  "/api/teams/analytics": { get: { summary: "Team workload, focus, utilization, collaboration", tag: "Analytics", query: ["from", "to", "teamId"] } },
  "/api/projects": {
    get: { summary: "List projects visible to the caller", tag: "Projects", query: ["search", "status", "teamId", "page", "pageSize"] },
    post: { summary: "Create project (admin / PM)", tag: "Projects", body: "ProjectRequest" },
  },
  "/api/projects/{id}": { get: { summary: "Project details", tag: "Projects" }, patch: { summary: "Update project", tag: "Projects" }, delete: { summary: "Delete project without timesheets (admin)", tag: "Projects" } },
  "/api/projects/{id}/members": { post: { summary: "Assign employee", tag: "Projects", body: "MemberRequest" }, delete: { summary: "Unassign employee (?userId=)", tag: "Projects" } },
  "/api/projects/{id}/billing-config": { get: { summary: "Project billing rules", tag: "Billing" }, put: { summary: "Update project billing rules", tag: "Billing", body: "BillingConfig" } },
  "/api/projects/{id}/analytics": { get: { summary: "Project analytics", tag: "Analytics", query: ["from", "to"] } },
  "/api/projects/{id}/audit": { get: { summary: "Project audit history", tag: "Audit" } },
  "/api/tools": { get: { summary: "List tools", tag: "Tools" }, post: { summary: "Create tool (admin)", tag: "Tools" } },
  "/api/tools/{id}": { patch: { summary: "Update tool default billability (admin)", tag: "Tools" } },
  "/api/devices": { get: { summary: "List devices (?userId=)", tag: "Devices" }, post: { summary: "Register device", tag: "Devices" } },
  "/api/devices/{id}": { patch: { summary: "Activate/deactivate device", tag: "Devices" } },
  "/api/devices/{id}/token": { post: { summary: "Issue device bearer token (shown once)", tag: "Devices" } },
  "/api/events": {
    post: {
      summary: "Ingest activity events (collector API). Stored durably as JSONB, then queued.",
      tag: "Events",
      auth: "session-or-device",
      body: "EventBatch",
      responses: { "202": "At least one event accepted", "200": "All duplicates", "403": "Consent required / forbidden", "422": "All events rejected or invalid" },
    },
  },
  "/api/activity": { get: { summary: "Normalized activity timeline", tag: "Activity", query: ["from", "to", "userId", "projectId", "toolId", "category", "billable", "page", "pageSize"] } },
  "/api/activity/raw": { get: { summary: "Raw JSONB events and processing status (admin)", tag: "Activity", query: ["userId", "status", "page", "pageSize"] } },
  "/api/activity/raw/retry": { post: { summary: "Re-queue FAILED events (admin)", tag: "Activity" } },
  "/api/analytics/overview": { get: { summary: "Dashboard KPIs, charts, alerts and insights", tag: "Analytics", query: ["from", "to", "projectId", "userId", "teamId"] } },
  "/api/insights": { get: { summary: "Rule-based workflow insights", tag: "Insights", query: ["from", "to", "projectId", "teamId"] } },
  "/api/timesheets": { get: { summary: "List timesheets", tag: "Timesheets", query: ["status", "projectId", "userId", "scope", "page", "pageSize"] } },
  "/api/timesheets/generate": { post: { summary: "Generate DRAFT timesheets for a period", tag: "Timesheets", body: "GenerateTimesheetsRequest" } },
  "/api/timesheets/{id}": { get: { summary: "Timesheet with adjustment history", tag: "Timesheets" }, delete: { summary: "Delete own draft", tag: "Timesheets" } },
  "/api/timesheets/{id}/submit": { post: { summary: "Submit (owner)", tag: "Timesheets" } },
  "/api/timesheets/{id}/approve": { post: { summary: "Approve (project manager / admin, not own)", tag: "Timesheets" } },
  "/api/timesheets/{id}/reject": { post: { summary: "Reject with reason", tag: "Timesheets", body: "ReasonRequest" } },
  "/api/timesheets/{id}/request-adjustment": { post: { summary: "Send back for adjustment", tag: "Timesheets", body: "ReasonRequest" } },
  "/api/timesheets/{id}/adjust": { post: { summary: "Adjust billable seconds (audited)", tag: "Timesheets", body: "AdjustRequest" } },
  "/api/billing/summary": { get: { summary: "Billing totals by status and project", tag: "Billing", query: ["projectId"] } },
  "/api/billing/audits": { get: { summary: "Billable audit snapshots", tag: "Billing" }, post: { summary: "Calculate billable audits for a period", tag: "Billing" } },
  "/api/billing/export": { get: { summary: "CSV export of visible timesheets", tag: "Billing", query: ["from", "to", "projectId", "userId"] } },
  "/api/reports": { get: { summary: "Available report types", tag: "Reports" } },
  "/api/reports/{type}": { get: { summary: "Build report (format=json|csv|pdf)", tag: "Reports", query: ["format", "from", "to", "projectId", "userId", "teamId"] } },
  "/api/simulator/options": { get: { summary: "Employees/devices/projects available to simulate", tag: "Simulator" } },
  "/api/simulator/runs": { post: { summary: "Start a simulation run", tag: "Simulator" } },
  "/api/simulator/runs/{id}": { get: { summary: "Run processing status", tag: "Simulator" }, patch: { summary: "Update run status", tag: "Simulator" } },
  "/api/simulator/events": { post: { summary: "Submit simulated events through the ingestion pipeline", tag: "Simulator", body: "SimulatorBatch" } },
  "/api/audit-logs": { get: { summary: "Audit trail (admin; PM for own projects)", tag: "Audit", query: ["action", "entityType", "actorId", "projectId", "from", "to", "page", "pageSize"] } },
  "/api/settings": { get: { summary: "Organization settings, profile", tag: "Settings" }, patch: { summary: "Update analytics/retention settings (admin)", tag: "Settings" } },
  "/api/settings/organization": { patch: { summary: "Update organization name/timezone (admin)", tag: "Settings" } },
  "/api/settings/profile": { patch: { summary: "Update own profile", tag: "Settings" } },
  "/api/settings/consent": { post: { summary: "Grant or withdraw tracking consent", tag: "Settings" } },
};

const schemas = {
  Error: {
    type: "object",
    properties: {
      error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, details: {} } },
      requestId: { type: "string" },
    },
  },
  LoginRequest: { type: "object", required: ["email", "password"], properties: { email: { type: "string", format: "email" }, password: { type: "string" } } },
  ForgotPasswordRequest: { type: "object", properties: { email: { type: "string", format: "email" } } },
  ResetPasswordRequest: { type: "object", properties: { token: { type: "string" }, password: { type: "string", minLength: 10 } } },
  ChangePasswordRequest: { type: "object", properties: { currentPassword: { type: "string" }, newPassword: { type: "string" } } },
  AcceptInvitationRequest: { type: "object", properties: { displayName: { type: "string" }, password: { type: "string" }, trackingConsent: { type: "boolean" } } },
  InviteRequest: { type: "object", properties: { email: { type: "string" }, displayName: { type: "string" }, role: { type: "string" }, teamId: { type: "string", format: "uuid" } } },
  TeamRequest: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, managerId: { type: "string", format: "uuid" } } },
  ProjectRequest: {
    type: "object",
    properties: {
      name: { type: "string" },
      clientName: { type: "string" },
      teamId: { type: "string", format: "uuid" },
      projectManagerId: { type: "string", format: "uuid" },
      budgetHours: { type: "number" },
      hourlyRate: { type: "number" },
      currency: { type: "string" },
      status: { type: "string", enum: ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"] },
      startDate: { type: "string", format: "date" },
      deadline: { type: "string", format: "date" },
    },
  },
  MemberRequest: { type: "object", properties: { userId: { type: "string", format: "uuid" }, assignedRole: { type: "string" } } },
  BillingConfig: {
    type: "object",
    properties: {
      billableCategories: { type: "array", items: { type: "string", enum: ["DEEP_FOCUS", "ACTIVE_WORK"] } },
      collaborationBillable: { type: "boolean" },
      administrativeBillable: { type: "boolean" },
      billableToolIds: { type: "array", items: { type: "string", format: "uuid" } },
      nonBillableToolIds: { type: "array", items: { type: "string", format: "uuid" } },
      roundingRule: { type: "string", enum: ["NONE", "UP_6_MIN", "UP_15_MIN", "NEAREST_15_MIN"] },
      requiresApproval: { type: "boolean" },
    },
  },
  ActivityEvent: {
    type: "object",
    additionalProperties: false,
    required: ["eventId", "type", "timestamp", "deviceId", "sessionId"],
    properties: {
      eventId: { type: "string", format: "uuid", description: "Collector-generated; re-sending is idempotent" },
      type: { type: "string", enum: ["APP_OPENED", "APP_CLOSED", "APPLICATION_SWITCH", "FILE_CONTEXT_CHANGED", "FOCUS_STARTED", "FOCUS_ENDED", "IDLE_STARTED", "IDLE_ENDED", "PROJECT_CHANGED", "SESSION_HEARTBEAT"] },
      timestamp: { type: "string", format: "date-time" },
      deviceId: { type: "string", format: "uuid" },
      sessionId: { type: "string", format: "uuid" },
      sequence: { type: "integer" },
      projectId: { type: ["string", "null"], format: "uuid" },
      tool: { type: "string", description: "Executable name, e.g. Figma.exe" },
      previousTool: { type: "string" },
      file: { type: ["object", "null"], properties: { name: { type: "string" }, path: { type: "string" }, type: { type: "string" } }, description: "Metadata only — never contents" },
      idleSeconds: { type: "integer" },
      simulated: { type: "boolean" },
    },
  },
  EventBatch: { type: "object", properties: { events: { type: "array", maxItems: 200, items: { $ref: "#/components/schemas/ActivityEvent" } } } },
  SimulatorBatch: {
    type: "object",
    properties: { runId: { type: "string", format: "uuid" }, userId: { type: "string", format: "uuid" }, events: { type: "array", items: { $ref: "#/components/schemas/ActivityEvent" } } },
  },
  GenerateTimesheetsRequest: {
    type: "object",
    properties: { periodStart: { type: "string", format: "date" }, periodEnd: { type: "string", format: "date" }, userId: { type: "string" }, projectId: { type: "string" } },
  },
  ReasonRequest: { type: "object", properties: { reason: { type: "string" } } },
  AdjustRequest: { type: "object", properties: { billableSeconds: { type: "integer" }, reason: { type: "string" } } },
};

export function buildOpenApi(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [path, methods] of Object.entries(ops)) {
    paths[path] = {};
    for (const [method, op] of Object.entries(methods)) {
      if (!op) continue;
      const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
      const query = (op.query ?? []).map((q) => ({ name: q, in: "query", required: false, schema: { type: "string" } }));
      paths[path][method] = {
        summary: op.summary,
        tags: [op.tag],
        security: op.auth === "none" ? [] : op.auth === "session-or-device" ? [{ sessionCookie: [] }, { deviceToken: [] }] : [{ sessionCookie: [] }],
        parameters: [...params, ...query],
        ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: { $ref: `#/components/schemas/${op.body}` } } } } } : {}),
        responses: {
          ...(op.responses
            ? Object.fromEntries(Object.entries(op.responses).map(([k, v]) => [k, { description: v }]))
            : { "200": { description: "Success — `{ data: ... }` envelope" } }),
          "401": { description: "Not authenticated", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "403": { description: "Forbidden" },
          "422": { description: "Validation error" },
        },
      };
    }
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "GraphFlow API",
      version: "1.0.0",
      description:
        "Creative workflow intelligence & billable-hour optimization. Responses use `{ data }` / `{ error, requestId }` envelopes; every response carries `x-request-id`. State-changing cookie requests must be same-origin.",
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        sessionCookie: { type: "apiKey", in: "cookie", name: "gf_session" },
        deviceToken: { type: "http", scheme: "bearer", description: "Device token (gfd_…) for native collectors" },
      },
      schemas,
    },
    paths,
  };
}
