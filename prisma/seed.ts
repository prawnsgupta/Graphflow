/**
 * GraphFlow DEMO seed — deterministic and safely re-runnable.
 *
 *   npm run db:seed
 *
 * TRUSTED SEED PROCESS (documented in docs/EVENT_PIPELINE.md):
 *  - Runs with the privileged MIGRATION_DATABASE_URL owner role.
 *  - Deletes and recreates the demo organizations (slug-based), so re-running
 *    always produces the same structure.
 *  - Historical activity is generated with the SAME scenario library used by
 *    the simulator, stored as raw JSONB events with ledger rows, and then
 *    normalized by the SAME `rebuildSession` code the worker runs. Nothing is
 *    written to FocusEvent directly. Events are flagged simulated + source=seed.
 *  - Timesheets are generated / submitted / approved through the timesheet
 *    service, producing real audit records.
 *  - Dates are anchored to the current week in the organization timezone; the
 *    PRNG seed is fixed, so the same day always yields identical data.
 *
 * Refuses to run when NODE_ENV=production.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaClient, type Prisma, type UserRole } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { withSystem } from "../src/lib/db/context";
import { rebuildSession } from "../src/services/events/processor";
import { expandScenario, getScenario, mulberry32, type ScenarioId } from "../src/lib/simulator/scenarios";
import { addDaysToKey, dateKeyInTz, isoWeekday, localRangeToUtc, startOfWeekKey, zonedTimeUtc } from "../src/lib/utils/time";
import { generateTimesheets, submitTimesheet, approveTimesheet, rejectTimesheet } from "../src/services/billing/timesheet-service";
import { computeBillableAudit } from "../src/services/billing/billable-audit-service";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data in production.");
  process.exit(1);
}

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is required for the trusted seed");
const db = new PrismaClient({ datasources: { db: { url } } });

export const DEMO_PASSWORD = "GraphFlow!2026";
const TZ = "Asia/Kolkata";
const rand = mulberry32(20261102);

/** Deterministic UUID (v5-style) from a name. */
function uid(name: string): string {
  const h = createHash("sha1").update(`graphflow-demo:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

const TOOLS: { name: string; category: Prisma.ToolCreateManyInput["category"]; exe: string; billable: boolean }[] = [
  { name: "Figma", category: "DESIGN", exe: "Figma.exe", billable: true },
  { name: "Adobe Photoshop", category: "DESIGN", exe: "Photoshop.exe", billable: true },
  { name: "Adobe Illustrator", category: "DESIGN", exe: "Illustrator.exe", billable: true },
  { name: "Visual Studio Code", category: "DEVELOPMENT", exe: "Code.exe", billable: true },
  { name: "Blender", category: "THREE_D", exe: "blender.exe", billable: true },
  { name: "Slack", category: "COMMUNICATION", exe: "slack.exe", billable: false },
  { name: "Microsoft Teams", category: "COMMUNICATION", exe: "ms-teams.exe", billable: false },
  { name: "Google Chrome", category: "BROWSER", exe: "chrome.exe", billable: false },
  { name: "Microsoft Excel", category: "PRODUCTIVITY", exe: "EXCEL.EXE", billable: false },
  { name: "Notion", category: "DOCUMENTATION", exe: "Notion.exe", billable: false },
];

interface SeedUser {
  key: string;
  name: string;
  email: string;
  role: UserRole;
  team?: "design" | "eng" | "marketing";
  title: string;
  consent?: boolean;
}

const USERS: SeedUser[] = [
  { key: "admin", name: "Avery Morgan", email: "admin@graphflow.demo", role: "ORG_ADMIN", title: "Operations Director" },
  { key: "pm-olivia", name: "Olivia Park", email: "olivia.pm@graphflow.demo", role: "PROJECT_MANAGER", title: "Senior Project Manager" },
  { key: "pm-marcus", name: "Marcus Chen", email: "marcus.pm@graphflow.demo", role: "PROJECT_MANAGER", title: "Delivery Manager" },
  { key: "pm-sofia", name: "Sofia Rossi", email: "sofia.pm@graphflow.demo", role: "PROJECT_MANAGER", title: "Account Manager" },
  { key: "lead-priya", name: "Priya Nair", email: "priya.lead@graphflow.demo", role: "TEAM_LEAD", team: "design", title: "Design Lead" },
  { key: "lead-daniel", name: "Daniel Kim", email: "daniel.lead@graphflow.demo", role: "TEAM_LEAD", team: "eng", title: "Engineering Lead" },
  { key: "lead-hana", name: "Hana Sato", email: "hana.lead@graphflow.demo", role: "TEAM_LEAD", team: "marketing", title: "Content Lead" },
  { key: "liam", name: "Liam Walker", email: "liam@graphflow.demo", role: "EMPLOYEE", team: "design", title: "Product Designer" },
  { key: "emma", name: "Emma Johnson", email: "emma@graphflow.demo", role: "EMPLOYEE", team: "design", title: "Brand Designer" },
  { key: "noah", name: "Noah Garcia", email: "noah@graphflow.demo", role: "EMPLOYEE", team: "design", title: "3D Artist" },
  { key: "ava", name: "Ava Martinez", email: "ava@graphflow.demo", role: "EMPLOYEE", team: "eng", title: "Frontend Engineer" },
  { key: "ethan", name: "Ethan Brown", email: "ethan@graphflow.demo", role: "EMPLOYEE", team: "eng", title: "Backend Engineer" },
  { key: "mia", name: "Mia Davis", email: "mia@graphflow.demo", role: "EMPLOYEE", team: "eng", title: "Mobile Engineer" },
  { key: "lucas", name: "Lucas Wilson", email: "lucas@graphflow.demo", role: "EMPLOYEE", team: "marketing", title: "Copywriter" },
  { key: "zoe", name: "Zoe Thompson", email: "zoe@graphflow.demo", role: "EMPLOYEE", team: "marketing", title: "Campaign Designer" },
  { key: "arjun", name: "Arjun Mehta", email: "arjun@graphflow.demo", role: "EMPLOYEE", team: "marketing", title: "Marketing Analyst" },
  { key: "chloe", name: "Chloe Lee", email: "chloe@graphflow.demo", role: "EMPLOYEE", team: "marketing", title: "Social Producer", consent: false },
];

const TEAMS = {
  design: { name: "Design Studio", description: "Brand, product and 3D design", lead: "lead-priya" },
  eng: { name: "Engineering", description: "Web, mobile and platform engineering", lead: "lead-daniel" },
  marketing: { name: "Marketing & Content", description: "Campaigns, copy and social", lead: "lead-hana" },
} as const;

interface SeedProject {
  key: string;
  name: string;
  client: string | null;
  team: keyof typeof TEAMS;
  pm: string;
  budget: number;
  rate: number;
  status: Prisma.ProjectCreateManyInput["status"];
  members: string[];
  config?: Partial<Prisma.ProjectBillingConfigCreateManyInput>;
}

const PROJECTS: SeedProject[] = [
  { key: "aurora", name: "Aurora Rebrand", client: "Aurora Hotels", team: "design", pm: "pm-olivia", budget: 320, rate: 140, status: "ACTIVE", members: ["lead-priya", "liam", "emma", "zoe"] },
  { key: "atlas", name: "Atlas Launch Film", client: "Atlas Robotics", team: "design", pm: "pm-olivia", budget: 24, rate: 155, status: "ACTIVE", members: ["noah", "liam", "emma"], config: { roundingRule: "UP_6_MIN" } },
  { key: "nimbus", name: "Nimbus Mobile App", client: "Nimbus Fintech", team: "eng", pm: "pm-marcus", budget: 600, rate: 165, status: "ACTIVE", members: ["lead-daniel", "ava", "mia", "liam"] },
  { key: "helix", name: "Helix Commerce Platform", client: "Helix Retail", team: "eng", pm: "pm-marcus", budget: 450, rate: 150, status: "ACTIVE", members: ["ethan", "ava", "lead-daniel"], config: { roundingRule: "UP_15_MIN" } },
  { key: "solstice", name: "Solstice Q4 Campaign", client: "Solstice Beverages", team: "marketing", pm: "pm-sofia", budget: 180, rate: 120, status: "ACTIVE", members: ["lead-hana", "lucas", "zoe", "arjun", "chloe"], config: { administrativeBillable: true } },
  { key: "internal", name: "Internal Ops & Tooling", client: null, team: "eng", pm: "pm-sofia", budget: 0, rate: 0, status: "ACTIVE", members: ["arjun", "ethan", "mia", "lucas"], config: { requiresApproval: false, collaborationBillable: false } },
  { key: "orion", name: "Orion Website", client: "Orion Labs", team: "design", pm: "pm-olivia", budget: 200, rate: 135, status: "COMPLETED", members: ["emma"] },
];

const SCENARIOS_BY_TEAM: Record<keyof typeof TEAMS, ScenarioId[]> = {
  design: ["DEEP_DESIGN", "DEEP_DESIGN", "IDLE_PERIOD", "MIXED_ADMIN"],
  eng: ["INTERRUPTED_DEV", "INTERRUPTED_DEV", "IDLE_PERIOD", "DEEP_DESIGN"],
  marketing: ["MIXED_ADMIN", "DEEP_DESIGN", "IDLE_PERIOD", "MIXED_ADMIN"],
};

async function resetDemo() {
  for (const slug of ["lumen-demo", "northwind-demo"]) {
    const org = await db.organization.findUnique({ where: { slug }, select: { id: true } });
    if (org) await db.organization.delete({ where: { id: org.id } }); // cascades to all tenant rows
  }
}

async function main() {
  const started = Date.now();
  console.log("Seeding GraphFlow DEMO data…");
  await resetDemo();
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // --- Organization -----------------------------------------------------------
  const orgId = uid("org:lumen");
  await db.organization.create({ data: { id: orgId, name: "Lumen & Co. Creative (DEMO)", slug: "lumen-demo", timezone: TZ, isDemo: true } });
  await db.organizationSettings.create({ data: { organizationId: orgId } });
  await db.tool.createMany({
    data: TOOLS.map((t) => ({ id: uid(`tool:${t.exe}`), organizationId: orgId, name: t.name, category: t.category, executableName: t.exe, defaultBillableStatus: t.billable })),
  });

  // --- Users & teams ------------------------------------------------------------
  const userId = (key: string) => uid(`user:${key}`);
  await db.user.createMany({
    data: USERS.map((u) => ({
      id: userId(u.key),
      organizationId: orgId,
      displayName: u.name,
      email: u.email,
      passwordHash,
      role: u.role,
      title: u.title,
      trackingConsent: u.consent ?? true,
      consentUpdatedAt: new Date(Date.now() - 60 * 86_400_000),
    })),
  });
  for (const [key, t] of Object.entries(TEAMS)) {
    await db.team.create({ data: { id: uid(`team:${key}`), organizationId: orgId, name: t.name, description: t.description, managerId: userId(t.lead) } });
  }
  for (const u of USERS.filter((x) => x.team)) {
    await db.user.update({ where: { id: userId(u.key) }, data: { teamId: uid(`team:${u.team}`) } });
  }
  await db.device.createMany({
    data: USERS.flatMap((u) => [
      { id: uid(`device:${u.key}:ws`), organizationId: orgId, userId: userId(u.key), name: "Simulated Workstation", platform: "web-simulator", isSimulated: true },
      { id: uid(`device:${u.key}:laptop`), organizationId: orgId, userId: userId(u.key), name: "Simulated Laptop", platform: "web-simulator", isSimulated: true },
    ]),
  });

  // --- Projects -------------------------------------------------------------------
  const today = dateKeyInTz(new Date(), TZ);
  const thisMonday = startOfWeekKey(today);
  for (const p of PROJECTS) {
    const id = uid(`project:${p.key}`);
    await db.project.create({
      data: {
        id,
        organizationId: orgId,
        name: p.name,
        clientName: p.client,
        description: `${p.name}${p.client ? ` for ${p.client}` : ""}. Demo project.`,
        teamId: uid(`team:${p.team}`),
        projectManagerId: userId(p.pm),
        budgetHours: p.budget.toFixed(2),
        hourlyRate: p.rate.toFixed(2),
        currency: "USD",
        status: p.status,
        startDate: new Date(`${addDaysToKey(thisMonday, -42)}T00:00:00Z`),
        deadline: new Date(`${addDaysToKey(thisMonday, 60)}T00:00:00Z`),
      },
    });
    await db.projectBillingConfig.create({ data: { projectId: id, organizationId: orgId, ...p.config } });
    await db.projectMember.createMany({
      data: p.members.map((m) => ({ projectId: id, userId: userId(m), assignedRole: m.startsWith("lead") ? "Lead" : "Contributor" })),
    });
  }

  // --- Historical activity through the pipeline ---------------------------------
  const memberships = new Map<string, string[]>();
  for (const p of PROJECTS.filter((x) => x.status === "ACTIVE")) {
    for (const m of p.members) memberships.set(m, [...(memberships.get(m) ?? []), uid(`project:${p.key}`)]);
  }
  const workers = USERS.filter((u) => u.team && (u.consent ?? true));
  const rawEvents: Prisma.RawActivityEventCreateManyInput[] = [];
  const sessions: Prisma.ActivitySessionCreateManyInput[] = [];

  const addScenario = (u: SeedUser, scenario: ScenarioId, projectId: string, startUtc: Date, device: "ws" | "laptop", partner?: SeedUser) => {
    const def = getScenario(scenario);
    const steps = def.build({ projectKey: projectId.slice(0, 8), rand, scale: 0.75 + rand() * 0.5 });
    const events = expandScenario(steps, { projectId, heartbeatSeconds: 60, idleTimeoutSeconds: 300 });
    const actors = partner ? (["primary", "partner"] as const) : (["primary"] as const);
    for (const actor of actors) {
      const who = actor === "primary" ? u : partner!;
      const sessionId = uid(`session:${who.key}:${startUtc.toISOString()}:${scenario}:${actor}`);
      const deviceId = uid(`device:${who.key}:${device}`);
      const mine = events.filter((e) => e.actor === actor);
      if (mine.length === 0) continue;
      sessions.push({
        id: sessionId,
        organizationId: orgId,
        userId: userId(who.key),
        deviceId,
        projectId,
        isSimulated: true,
        status: "OPEN",
        startedAt: new Date(startUtc.getTime() + mine[0].offsetMs),
        lastEventAt: new Date(startUtc.getTime() + mine[mine.length - 1].offsetMs),
      });
      mine.forEach((e, i) => {
        const ts = new Date(startUtc.getTime() + e.offsetMs);
        rawEvents.push({
          id: uid(`raw:${sessionId}:${i}`),
          organizationId: orgId,
          clientEventId: uid(`client:${sessionId}:${i}`),
          userId: userId(who.key),
          deviceId,
          sessionId,
          eventType: e.type,
          eventTimestamp: ts,
          sequence: e.sequence,
          isSimulated: true,
          processingStatus: "PENDING",
          receivedAt: ts,
          payload: {
            type: e.type,
            timestamp: ts.toISOString(),
            sequence: e.sequence,
            projectId: e.projectId,
            tool: e.tool,
            file: e.file,
            idleSeconds: e.idleSeconds,
            simulated: true,
            source: "seed",
          } as Prisma.InputJsonValue,
        });
      });
    }
  };

  for (let d = 14; d >= 1; d--) {
    const day = addDaysToKey(today, -d);
    if (isoWeekday(day) >= 6) continue; // weekdays only
    const recentWeek = d <= 7;
    for (const u of workers) {
      const projects = memberships.get(u.key) ?? [];
      if (projects.length === 0 || rand() < 0.08) continue; // occasional day off
      const pool = SCENARIOS_BY_TEAM[u.team!];
      // Slightly more fragmented work in the most recent week (drives the
      // week-over-week context-switching insight from real reconstructed data).
      const morning: ScenarioId = recentWeek && rand() < 0.35 ? "INTERRUPTED_DEV" : pick(pool);
      addScenario(u, morning, pick(projects), zonedTimeUtc(day, 9, 20 + Math.floor(rand() * 40), TZ), "ws");
      addScenario(u, pick(pool), pick(projects), zonedTimeUtc(day, 13, 45 + Math.floor(rand() * 30), TZ), "ws");
      if (rand() < 0.45) addScenario(u, recentWeek ? "MIXED_ADMIN" : pick(pool), pick(projects), zonedTimeUtc(day, 16, 30, TZ), "laptop");
    }
    // Collaboration sessions: pairs on shared projects, twice a week.
    if (isoWeekday(day) === 2 || isoWeekday(day) === 4) {
      const pairs: [string, string, string][] = [
        ["liam", "emma", "aurora"],
        ["ava", "mia", "nimbus"],
        ["lucas", "zoe", "solstice"],
      ];
      for (const [a, b, p] of pairs) {
        addScenario(USERS.find((x) => x.key === a)!, "COLLABORATION", uid(`project:${p}`), zonedTimeUtc(day, 11, 30, TZ), "laptop", USERS.find((x) => x.key === b)!);
      }
    }
  }

  console.log(`  ${sessions.length} sessions, ${rawEvents.length} raw events → ingest`);
  await db.activitySession.createMany({ data: sessions });
  for (let i = 0; i < rawEvents.length; i += 2000) {
    const chunk = rawEvents.slice(i, i + 2000);
    await db.rawActivityEvent.createMany({ data: chunk });
    await db.activityEventInbox.createMany({
      data: chunk.map((e) => ({ organizationId: orgId, sourceEventId: e.id!, processingStatus: "PENDING" as const, receivedAt: e.receivedAt as Date })),
    });
  }

  console.log("  normalizing sessions with the worker's rebuildSession()…");
  const sessionOrder = [...sessions].sort((a, b) => (a.startedAt as Date).getTime() - (b.startedAt as Date).getTime());
  let n = 0;
  for (const s of sessionOrder) {
    await withSystem(orgId, (tx) => rebuildSession(tx, s.id!), { client: db, timeoutMs: 120_000 });
    if (++n % 100 === 0) console.log(`    ${n}/${sessions.length}`);
  }
  // Collaboration links are discovered when the later session of a pair is
  // rebuilt (sessions are rebuilt in start order, so both sides exist by then).
  const now = new Date();
  await db.rawActivityEvent.updateMany({ where: { organizationId: orgId }, data: { processingStatus: "PROCESSED", processedAt: now, attempts: 1 } });
  await db.activityEventInbox.updateMany({ where: { organizationId: orgId }, data: { processingStatus: "PROCESSED", processedAt: now, attempts: 1, enqueuedAt: now } });

  // --- Timesheets through the timesheet service ------------------------------------
  const actorOf = (key: string) => {
    const u = USERS.find((x) => x.key === key)!;
    return { userId: userId(key), organizationId: orgId, role: u.role, teamId: u.team ? uid(`team:${u.team}`) : null };
  };
  const twoWeeksAgo = addDaysToKey(thisMonday, -14);
  const lastWeek = addDaysToKey(thisMonday, -7);
  const pmOf = new Map(PROJECTS.map((p) => [uid(`project:${p.key}`), p.pm]));

  let rejectedOne = false;
  for (const u of workers) {
    // Two weeks ago: generated, submitted and (mostly) approved.
    const older = await withSystem(orgId, (tx) => generateTimesheets({ tx, actor: actorOf(u.key) }, { periodStart: twoWeeksAgo }), { client: db, timeoutMs: 120_000 });
    for (const id of older.timesheetIds) {
      await withSystem(orgId, async (tx) => {
        const ts = await submitTimesheet({ tx, actor: actorOf(u.key) }, id);
        const pm = pmOf.get(ts.projectId)!;
        if (ts.status !== "SUBMITTED") return; // auto-approved project
        if (!rejectedOne && u.key === "zoe") {
          rejectedOne = true;
          await rejectTimesheet({ tx, actor: actorOf(pm) }, id, "Please split the Aurora and Solstice design time correctly.");
        } else {
          await approveTimesheet({ tx, actor: actorOf(pm) }, id, "Looks good");
        }
      }, { client: db });
    }
    // Last week: generated; most submitted (pending review), some still draft.
    const recent = await withSystem(orgId, (tx) => generateTimesheets({ tx, actor: actorOf(u.key) }, { periodStart: lastWeek }), { client: db, timeoutMs: 120_000 });
    for (const id of recent.timesheetIds) {
      if (rand() < 0.7) await withSystem(orgId, (tx) => submitTimesheet({ tx, actor: actorOf(u.key) }, id), { client: db });
    }
  }

  // --- Billable audit snapshots ------------------------------------------------------
  const { start, end } = localRangeToUtc(twoWeeksAgo, addDaysToKey(today, -1), TZ);
  await withSystem(orgId, async (tx) => {
    for (const p of PROJECTS.filter((x) => x.status === "ACTIVE")) {
      await tx.billableAudit.create({ data: await computeBillableAudit(tx, orgId, uid(`project:${p.key}`), start, end) });
    }
    await tx.auditLog.create({
      data: { organizationId: orgId, actorId: null, action: "seed.completed", entityType: "Organization", entityId: orgId, metadata: { sessions: sessions.length, rawEvents: rawEvents.length, demo: true } },
    });
  }, { client: db, timeoutMs: 120_000 });

  // --- Second tenant (isolation demo) -----------------------------------------------
  const nwId = uid("org:northwind");
  await db.organization.create({ data: { id: nwId, name: "Northwind Studio (DEMO)", slug: "northwind-demo", timezone: "Europe/London", isDemo: true } });
  await db.organizationSettings.create({ data: { organizationId: nwId } });
  await db.user.createMany({
    data: [
      { id: uid("nw:admin"), organizationId: nwId, displayName: "Nora West", email: "admin@northwind.demo", passwordHash, role: "ORG_ADMIN", trackingConsent: true, consentUpdatedAt: new Date() },
      { id: uid("nw:emp"), organizationId: nwId, displayName: "Oscar Reed", email: "oscar@northwind.demo", passwordHash, role: "EMPLOYEE", trackingConsent: true, consentUpdatedAt: new Date() },
    ],
  });
  await db.project.create({ data: { id: uid("nw:project"), organizationId: nwId, name: "Confidential Northwind Project", budgetHours: "100.00", hourlyRate: "200.00", status: "ACTIVE", projectManagerId: uid("nw:admin") } });
  await db.projectMember.create({ data: { projectId: uid("nw:project"), userId: uid("nw:emp") } });
  await db.device.create({ data: { id: uid("nw:device"), organizationId: nwId, userId: uid("nw:emp"), name: "Simulated Workstation" } });
  await db.tool.createMany({ data: TOOLS.map((t) => ({ organizationId: nwId, name: t.name, category: t.category, executableName: t.exe, defaultBillableStatus: t.billable })) });

  const [fe, ts, links] = await Promise.all([
    db.focusEvent.count({ where: { organizationId: orgId } }),
    db.timesheet.groupBy({ by: ["status"], where: { organizationId: orgId }, _count: { _all: true } }),
    db.collaborationLink.count({ where: { organizationId: orgId } }),
  ]);
  console.log(`  ${fe} focus events, ${links} collaboration links, timesheets: ${ts.map((t) => `${t.status}=${t._count._all}`).join(", ")}`);
  console.log(`Done in ${Math.round((Date.now() - started) / 1000)}s. Demo password for all accounts: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
