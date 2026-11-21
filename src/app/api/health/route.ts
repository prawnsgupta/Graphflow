import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getRedis, waitForRedis } from "@/lib/redis/connection";
import { WORKER_HEARTBEAT_KEY } from "@/lib/queue/queues";

export const dynamic = "force-dynamic";

/** Health of the application, PostgreSQL, Redis and the background worker. */
export async function GET() {
  const checks: Record<string, { status: "ok" | "degraded" | "down"; detail?: string }> = { app: { status: "ok" } };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = { status: "ok" };
  } catch (e) {
    checks.postgres = { status: "down", detail: (e as Error).message.slice(0, 120) };
  }
  let backlog: number | null = null;
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM app_unprocessed_events(0, 5000)`;
    backlog = rows.length;
  } catch {
    backlog = null;
  }
  if (await waitForRedis(1500)) {
    try {
      await getRedis().ping();
      checks.redis = { status: "ok" };
      const hb = await getRedis().get(WORKER_HEARTBEAT_KEY);
      const age = hb ? (Date.now() - new Date(hb).getTime()) / 1000 : null;
      checks.worker = age !== null && age < 30 ? { status: "ok", detail: `heartbeat ${Math.round(age)}s ago` } : { status: "down", detail: "no recent heartbeat" };
    } catch (e) {
      checks.redis = { status: "down", detail: (e as Error).message };
      checks.worker = { status: "degraded", detail: "unknown (Redis unavailable)" };
    }
  } else {
    checks.redis = { status: "down", detail: "not connected — events are stored and will be processed when Redis returns" };
    checks.worker = { status: "degraded", detail: "unknown (Redis unavailable)" };
  }
  const overall = checks.postgres.status !== "ok" ? "down" : Object.values(checks).every((c) => c.status === "ok") ? "ok" : "degraded";
  return NextResponse.json(
    { status: overall, checks, eventBacklog: backlog, time: new Date().toISOString() },
    { status: overall === "down" ? 503 : 200 },
  );
}
