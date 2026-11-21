/**
 * GraphFlow background worker — a separate Node.js process from the web app.
 *
 *   npm run worker
 *
 * Runs the event-processing worker, the maintenance scheduler, a PostgreSQL
 * recovery loop that keeps working while Redis is down, and a small HTTP
 * health endpoint (GET /health on WORKER_HEALTH_PORT).
 */
import "dotenv/config";
import http from "node:http";
import type { Worker } from "bullmq";
import { prisma } from "@/lib/db/prisma";
import { createRedisConnection } from "@/lib/redis/connection";
import { WORKER_HEARTBEAT_KEY } from "@/lib/queue/queues";
import { startEventWorker } from "./event-worker";
import { startAggregationWorker, sweepStaleSessions } from "./aggregation-worker";
import { recoverUnprocessedEvents } from "@/services/events/recovery";

const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 4);
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 9100);
const recoveryInterval = Number(process.env.RECOVERY_SCAN_INTERVAL_SECONDS ?? 30);

const state = { startedAt: new Date(), lastHeartbeat: null as Date | null, redis: "connecting", db: "unknown" };

async function main() {
  console.log(`[worker] starting (concurrency=${concurrency})`);
  await prisma.$queryRaw`SELECT 1`;
  state.db = "ok";

  const eventWorker: Worker = startEventWorker(concurrency);
  let maintenance: Awaited<ReturnType<typeof startAggregationWorker>> | null = null;
  const startMaintenance = async () => {
    if (maintenance) return;
    try {
      maintenance = await startAggregationWorker(recoveryInterval);
      console.log("[worker] maintenance scheduler running");
    } catch (e) {
      console.warn(`[worker] maintenance scheduler not started yet: ${(e as Error).message}`);
    }
  };
  await startMaintenance();

  // Heartbeat for /api/health (Redis key) and the local health endpoint.
  const hbConn = createRedisConnection({ maxRetriesPerRequest: 1 });
  const heartbeat = setInterval(async () => {
    state.redis = hbConn.status;
    try {
      await prisma.$queryRaw`SELECT 1`;
      state.db = "ok";
    } catch {
      state.db = "down";
    }
    if (hbConn.status === "ready") {
      state.lastHeartbeat = new Date();
      await hbConn.set(WORKER_HEARTBEAT_KEY, state.lastHeartbeat.toISOString(), "EX", 60).catch(() => undefined);
      if (!maintenance) await startMaintenance();
    }
  }, 5_000);

  // Redis-independent fallback: when Redis is down the maintenance queue
  // cannot run, so keep closing stale sessions directly from PostgreSQL.
  // Events stay durably PENDING and are re-enqueued once Redis returns.
  const fallback = setInterval(async () => {
    if (hbConn.status === "ready") return;
    await sweepStaleSessions().catch(() => undefined);
  }, 60_000);

  // Recover anything left over from a previous crash at startup.
  recoverUnprocessedEvents({ staleSeconds: 0 })
    .then((r) => r.found && console.log(`[worker] startup recovery re-enqueued ${r.enqueued}/${r.found} events`))
    .catch(() => undefined);

  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      const healthy = state.db === "ok" && hbConn.status === "ready";
      res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: healthy ? "ok" : "degraded", ...state, redis: hbConn.status }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(healthPort, () => console.log(`[worker] health endpoint on :${healthPort}/health`));
  server.on("error", (e) => console.warn(`[worker] health server: ${e.message}`));

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received, shutting down gracefully`);
    clearInterval(heartbeat);
    clearInterval(fallback);
    server.close();
    await eventWorker.close().catch(() => undefined);
    if (maintenance) {
      await maintenance.worker.close().catch(() => undefined);
      await maintenance.queue.close().catch(() => undefined);
    }
    hbConn.disconnect();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
