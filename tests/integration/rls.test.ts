/**
 * Row-Level Security tests. Every query here runs through the restricted
 * `graphflow_app` role (DATABASE_URL) with only the transaction-scoped
 * context set — exactly how the application queries the database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { withRls } from "@/lib/db/context";
import { prisma } from "@/lib/db/prisma";
import { ingestEvents } from "@/services/events/ingestion-service";
import { processRawEvent } from "@/services/events/processor";
import { createFixture, destroyFixture, focusSession, owner, type Fixture } from "./helpers";

let f: Fixture; // organization 1
let g: Fixture; // organization 2

async function seedActivity(fx: Fixture, key: string, projectId: string) {
  const u = fx.users[key];
  const { events } = focusSession(u, projectId, 10, { base: Date.now() - 4 * 3600_000 });
  const res = await ingestEvents(u, u.userId, events, { source: "agent" });
  for (const r of res.results) await processRawEvent(r.rawEventId!, fx.orgId);
}

beforeAll(async () => {
  f = await createFixture("rls1");
  g = await createFixture("rls2");
  await seedActivity(f, "empA1", f.projects.A);
  await seedActivity(f, "empA2", f.projects.A);
  await seedActivity(f, "empB1", f.projects.B);
  await seedActivity(g, "empA1", g.projects.A);
});
afterAll(async () => {
  await destroyFixture(f);
  await destroyFixture(g);
  await owner.$disconnect();
  await prisma.$disconnect();
});

const visibleFocusUsers = (actor: Fixture["users"][string]) =>
  withRls(actor, async (tx) => [...new Set((await tx.focusEvent.findMany({ select: { userId: true } })).map((r) => r.userId))]);

describe("application database role", () => {
  it("is not a superuser and cannot bypass RLS", async () => {
    const [r] = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean; current_user: string }[]>`
      SELECT rolsuper, rolbypassrls, current_user FROM pg_roles WHERE rolname = current_user`;
    expect(r.current_user).toBe("graphflow_app");
    expect(r.rolsuper).toBe(false);
    expect(r.rolbypassrls).toBe(false);
  });

  it("sees nothing without a request context", async () => {
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    try {
      for (const t of ["organizations", "users", "projects", "focus_events", "raw_activity_events", "timesheets", "audit_logs"]) {
        const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${t}`);
        expect(rows[0].n, t).toBe(0);
      }
      // FORCE RLS: even an explicit SET of another org only shows that org.
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.organization_id', $1, true), set_config('app.user_role', 'EMPLOYEE', true), set_config('app.user_id', $2, true)", [f.orgId, f.users.empA1.userId]);
      const { rows } = await client.query("SELECT DISTINCT organization_id FROM users");
      expect(rows.map((r) => r.organization_id)).toEqual([f.orgId]);
      await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
  });

  it("cannot read or alter migration history", async () => {
    await expect(prisma.$queryRaw`SELECT * FROM _prisma_migrations`).rejects.toThrow(/permission denied/);
  });
});

describe("activity isolation", () => {
  it("Employee A cannot access Employee B's activity", async () => {
    expect(await visibleFocusUsers(f.users.empA1)).toEqual([f.users.empA1.userId]);
    const raw = await withRls(f.users.empA1, (tx) => tx.rawActivityEvent.findMany({ where: { userId: f.users.empA2.userId } }));
    expect(raw).toHaveLength(0);
  });

  it("Project Manager A cannot access Project B or its activity", async () => {
    const projects = await withRls(f.users.pmA, (tx) => tx.project.findMany({ select: { id: true } }));
    expect(projects.map((p) => p.id)).toEqual([f.projects.A]);
    const users = await visibleFocusUsers(f.users.pmA);
    expect(users.sort()).toEqual([f.users.empA1.userId, f.users.empA2.userId].sort());
    expect(await withRls(f.users.pmA, (tx) => tx.focusEvent.count({ where: { projectId: f.projects.B } }))).toBe(0);
  });

  it("Team Lead A cannot access another team's restricted records", async () => {
    const users = await visibleFocusUsers(f.users.leadA);
    expect(users).not.toContain(f.users.empB1.userId);
    expect(users.sort()).toEqual([f.users.empA1.userId, f.users.empA2.userId].sort());
    expect(await withRls(f.users.leadA, (tx) => tx.timesheet.count({ where: { userId: f.users.empB1.userId } }))).toBe(0);
  });

  it("Organization A cannot access Organization B", async () => {
    const asAdmin = (fx: Fixture) =>
      withRls(fx.users.admin, async (tx) => ({
        users: await tx.user.count({ where: { organizationId: g.orgId } }),
        projects: await tx.project.count({ where: { id: g.projects.A } }),
        focus: await tx.focusEvent.count({ where: { organizationId: g.orgId } }),
        orgs: await tx.organization.count(),
      }));
    expect(await asAdmin(f)).toEqual({ users: 0, projects: 0, focus: 0, orgs: 1 });
  });

  it("admins see the whole organization", async () => {
    const users = await visibleFocusUsers(f.users.admin);
    expect(users).toHaveLength(3);
  });
});

describe("write protection", () => {
  it("employees cannot escalate their own role", async () => {
    await expect(withRls(f.users.empA1, (tx) => tx.user.update({ where: { id: f.users.empA1.userId }, data: { role: "ORG_ADMIN" } }))).rejects.toThrow(/insufficient privilege/);
  });

  it("users cannot write normalized activity directly", async () => {
    await expect(
      withRls(f.users.empA1, (tx) =>
        tx.focusEvent.create({
          data: {
            organizationId: f.orgId,
            userId: f.users.empA1.userId,
            deviceId: f.users.empA1.deviceId,
            sessionId: "00000000-0000-4000-8000-000000000000",
            sourceEventId: "00000000-0000-4000-8000-000000000000",
            startedAt: new Date(Date.now() - 3600_000),
            endedAt: new Date(),
            durationSeconds: 3600,
            activityCategory: "DEEP_FOCUS",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("users cannot insert rows into another organization", async () => {
    await expect(
      withRls(f.users.admin, (tx) => tx.team.create({ data: { organizationId: g.orgId, name: "Intruder" } })),
    ).rejects.toThrow(/row-level security/);
  });
});
