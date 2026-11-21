import { randomUUID } from "node:crypto";
import { PrismaClient, type UserRole } from "@prisma/client";
import type { Actor } from "@/lib/db/context";
import type { ActivityEventInput, EventType } from "@/lib/validation/events";

/** Privileged client for building fixtures (bypasses RLS like the trusted seed). */
export const owner = new PrismaClient({ datasources: { db: { url: process.env.TEST_MIGRATION_DATABASE_URL } } });

export interface Fixture {
  orgId: string;
  teams: Record<string, string>;
  users: Record<string, Actor & { deviceId: string; email: string }>;
  projects: Record<string, string>;
  tools: Record<string, string>;
}

const TOOLS = [
  { name: "Figma", exe: "Figma.exe", category: "DESIGN" as const, billable: true },
  { name: "Visual Studio Code", exe: "Code.exe", category: "DEVELOPMENT" as const, billable: true },
  { name: "Google Chrome", exe: "chrome.exe", category: "BROWSER" as const, billable: false },
  { name: "Microsoft Teams", exe: "ms-teams.exe", category: "COMMUNICATION" as const, billable: false },
  { name: "Notion", exe: "Notion.exe", category: "DOCUMENTATION" as const, billable: false },
];

/**
 * Organization with two teams, two PMs, two team leads and employees:
 *   team A: leadA, empA1, empA2       team B: leadB, empB1
 *   projectA (PM pmA, team A): empA1, empA2      projectB (PM pmB, team B): empB1
 */
export async function createFixture(label: string, opts: { consent?: boolean } = {}): Promise<Fixture> {
  const slug = `${label}-${randomUUID().slice(0, 8)}`;
  const org = await owner.organization.create({ data: { name: `Test ${label}`, slug, timezone: "UTC" } });
  await owner.organizationSettings.create({ data: { organizationId: org.id } });
  const tools: Record<string, string> = {};
  for (const t of TOOLS) {
    const row = await owner.tool.create({ data: { organizationId: org.id, name: t.name, executableName: t.exe, category: t.category, defaultBillableStatus: t.billable } });
    tools[t.exe] = row.id;
  }
  const teamA = await owner.team.create({ data: { organizationId: org.id, name: "Team A" } });
  const teamB = await owner.team.create({ data: { organizationId: org.id, name: "Team B" } });
  const specs: [string, UserRole, string | null][] = [
    ["admin", "ORG_ADMIN", null],
    ["pmA", "PROJECT_MANAGER", null],
    ["pmB", "PROJECT_MANAGER", null],
    ["leadA", "TEAM_LEAD", teamA.id],
    ["leadB", "TEAM_LEAD", teamB.id],
    ["empA1", "EMPLOYEE", teamA.id],
    ["empA2", "EMPLOYEE", teamA.id],
    ["empB1", "EMPLOYEE", teamB.id],
  ];
  const users: Fixture["users"] = {};
  for (const [key, role, teamId] of specs) {
    const email = `${key.toLowerCase()}-${slug}@test.local`;
    const u = await owner.user.create({
      data: { organizationId: org.id, displayName: key, email, role, teamId, trackingConsent: opts.consent ?? true, consentUpdatedAt: new Date(Date.now() - 86_400_000), passwordHash: null },
    });
    const d = await owner.device.create({ data: { organizationId: org.id, userId: u.id, name: "Sim", isSimulated: true } });
    users[key] = { userId: u.id, organizationId: org.id, role, teamId, deviceId: d.id, email };
  }
  const projectA = await owner.project.create({
    data: { organizationId: org.id, name: "Project A", teamId: teamA.id, projectManagerId: users.pmA.userId, budgetHours: "10.00", hourlyRate: "120.00", status: "ACTIVE" },
  });
  const projectB = await owner.project.create({
    data: { organizationId: org.id, name: "Project B", teamId: teamB.id, projectManagerId: users.pmB.userId, budgetHours: "10.00", hourlyRate: "100.00", status: "ACTIVE" },
  });
  await owner.projectMember.createMany({
    data: [
      { projectId: projectA.id, userId: users.empA1.userId },
      { projectId: projectA.id, userId: users.empA2.userId },
      { projectId: projectB.id, userId: users.empB1.userId },
    ],
  });
  return { orgId: org.id, teams: { A: teamA.id, B: teamB.id }, users, projects: { A: projectA.id, B: projectB.id }, tools };
}

export async function destroyFixture(f: Fixture | undefined) {
  if (f) await owner.organization.delete({ where: { id: f.orgId } }).catch(() => undefined);
}

/** Build a schema-valid event. `minute` is relative to `base`. */
export function makeEvent(
  user: { deviceId: string },
  sessionId: string,
  type: EventType,
  minute: number,
  extra: Partial<ActivityEventInput> = {},
  base = Date.now() - 3 * 3600_000,
): ActivityEventInput {
  return {
    eventId: randomUUID(),
    type,
    timestamp: new Date(base + minute * 60_000).toISOString(),
    deviceId: user.deviceId,
    sessionId,
    sequence: Math.round(minute * 100),
    simulated: true,
    ...extra,
  };
}

/** A focused session: start, heartbeats every minute, end. */
export function focusSession(
  user: { deviceId: string },
  projectId: string | null,
  minutes: number,
  opts: { tool?: string; base?: number; sessionId?: string } = {},
): { sessionId: string; events: ActivityEventInput[] } {
  const sessionId = opts.sessionId ?? randomUUID();
  const tool = opts.tool ?? "Figma.exe";
  const events = [makeEvent(user, sessionId, "FOCUS_STARTED", 0, { tool, projectId }, opts.base)];
  for (let m = 1; m < minutes; m++) events.push(makeEvent(user, sessionId, "SESSION_HEARTBEAT", m, { tool, projectId }, opts.base));
  events.push(makeEvent(user, sessionId, "FOCUS_ENDED", minutes, {}, opts.base));
  return { sessionId, events };
}
