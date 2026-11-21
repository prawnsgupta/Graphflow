import { z } from "zod";
import { dateKey } from "./common";

const ROLE = z.enum(["SUPER_ADMIN", "ORG_ADMIN", "PROJECT_MANAGER", "TEAM_LEAD", "EMPLOYEE"]);
const PROJECT_STATUS = z.enum(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"]);
const CATEGORY = z.enum(["DEEP_FOCUS", "ACTIVE_WORK", "COLLABORATION", "ADMINISTRATIVE", "IDLE", "UNASSIGNED"]);
const TOOL_CATEGORY = z.enum(["DESIGN", "DEVELOPMENT", "THREE_D", "BROWSER", "COMMUNICATION", "PRODUCTIVITY", "DOCUMENTATION", "OTHER"]);

const nullableUuid = z
  .union([z.string().uuid(), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v === "" ? null : v));

export const password = z
  .string()
  .min(10, "At least 10 characters")
  .max(200)
  .regex(/[A-Za-z]/, "Include a letter")
  .regex(/\d/, "Include a number");

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required").max(200),
});

export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email() });
export const resetPasswordSchema = z.object({ token: z.string().min(10).max(200), password });
export const acceptInvitationSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  password,
  trackingConsent: z.boolean().default(false),
});
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  displayName: z.string().trim().min(2).max(100).optional(),
  role: ROLE.default("EMPLOYEE"),
  teamId: nullableUuid,
});

export const updateEmployeeSchema = z
  .object({
    displayName: z.string().trim().min(2).max(100).optional(),
    title: z.string().trim().max(100).nullable().optional(),
    role: ROLE.optional(),
    teamId: nullableUuid,
    isActive: z.boolean().optional(),
  })
  .strict();

export const teamSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  managerId: nullableUuid,
});

const money = z.coerce.number().min(0).max(1_000_000);

export const projectSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2000).nullable().optional(),
    clientName: z.string().trim().max(120).nullable().optional(),
    teamId: nullableUuid,
    projectManagerId: nullableUuid,
    budgetHours: z.coerce.number().min(0).max(1_000_000),
    hourlyRate: money,
    currency: z.string().trim().length(3).toUpperCase().default("USD"),
    status: PROJECT_STATUS.default("PLANNING"),
    startDate: dateKey.nullable().optional(),
    deadline: dateKey.nullable().optional(),
  })
  .refine((p) => !p.startDate || !p.deadline || p.deadline >= p.startDate, {
    message: "Deadline must be on or after the start date",
    path: ["deadline"],
  });

export const projectUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    clientName: z.string().trim().max(120).nullable().optional(),
    teamId: nullableUuid,
    projectManagerId: nullableUuid,
    budgetHours: z.coerce.number().min(0).max(1_000_000).optional(),
    hourlyRate: money.optional(),
    currency: z.string().trim().length(3).toUpperCase().optional(),
    status: PROJECT_STATUS.optional(),
    startDate: dateKey.nullable().optional(),
    deadline: dateKey.nullable().optional(),
  })
  .strict();

export const memberSchema = z.object({
  userId: z.string().uuid(),
  assignedRole: z.string().trim().min(2).max(60).default("Contributor"),
});

export const billingConfigSchema = z.object({
  billableCategories: z.array(CATEGORY.extract(["DEEP_FOCUS", "ACTIVE_WORK"])).default(["DEEP_FOCUS", "ACTIVE_WORK"]),
  collaborationBillable: z.boolean(),
  administrativeBillable: z.boolean(),
  billableToolIds: z.array(z.string().uuid()).max(100).default([]),
  nonBillableToolIds: z.array(z.string().uuid()).max(100).default([]),
  roundingRule: z.enum(["NONE", "UP_6_MIN", "UP_15_MIN", "NEAREST_15_MIN"]),
  requiresApproval: z.boolean(),
});

export const toolSchema = z.object({
  name: z.string().trim().min(2).max(80),
  category: TOOL_CATEGORY,
  executableName: z.string().trim().min(1).max(100).regex(/^[\w .()+-]+$/),
  defaultBillableStatus: z.boolean(),
});
export const toolUpdateSchema = z.object({ defaultBillableStatus: z.boolean().optional(), category: TOOL_CATEGORY.optional() });

export const deviceSchema = z.object({
  name: z.string().trim().min(2).max(80),
  userId: z.string().uuid().optional(),
  platform: z.string().trim().max(40).default("web-simulator"),
  isSimulated: z.boolean().default(true),
});

export const organizationSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});

export const orgSettingsSchema = z
  .object({
    deepFocusMinMinutes: z.coerce.number().int().min(1).max(480),
    deepFocusMaxGapMinutes: z.coerce.number().int().min(0).max(60),
    idleTimeoutMinutes: z.coerce.number().int().min(1).max(120),
    heartbeatTimeoutMinutes: z.coerce.number().int().min(1).max(120),
    contextSwitchThresholdPerHour: z.coerce.number().int().min(0).max(600),
    contextSwitchCostSeconds: z.coerce.number().int().min(0).max(3600),
    fragmentThresholdSeconds: z.coerce.number().int().min(0).max(3600),
    fragmentMinCountPerHour: z.coerce.number().int().min(1).max(600),
    budgetAlertThresholdPct: z.coerce.number().int().min(1).max(100),
    rawEventRetentionDays: z.coerce.number().int().min(1).max(3650),
    auditLogRetentionDays: z.coerce.number().int().min(30).max(3650),
    defaultCurrency: z.string().trim().length(3).toUpperCase(),
  })
  .partial();

export const profileSchema = z.object({ displayName: z.string().trim().min(2).max(100), title: z.string().trim().max(100).nullable().optional() });
export const consentSchema = z.object({ trackingConsent: z.boolean() });

export const generateTimesheetsSchema = z.object({
  periodStart: dateKey,
  periodEnd: dateKey.optional(),
  userId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
});
export const reasonSchema = z.object({ reason: z.string().trim().min(3, "Please give a reason").max(1000) });
export const approveSchema = z.object({ note: z.string().trim().max(1000).optional() });
export const submitSchema = z.object({ notes: z.string().trim().max(1000).optional() });
export const adjustSchema = z.object({
  billableSeconds: z.coerce.number().int().min(0).max(31 * 24 * 3600),
  reason: z.string().trim().min(3).max(1000),
});

export const startSimulationSchema = z.object({
  userId: z.string().uuid(),
  deviceId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  scenario: z.enum(["DEEP_DESIGN", "INTERRUPTED_DEV", "IDLE_PERIOD", "COLLABORATION", "MIXED_ADMIN"]),
  speed: z.coerce.number().int().min(1).max(600),
  partnerUserId: z.string().uuid().optional(),
  partnerDeviceId: z.string().uuid().optional(),
  /** Planned simulated duration, used to find a free back-dated time window. */
  durationMs: z.coerce.number().int().min(0).max(24 * 3600_000).default(0),
});
export const updateSimulationSchema = z.object({ status: z.enum(["RUNNING", "PAUSED", "STOPPED", "COMPLETED"]) });
