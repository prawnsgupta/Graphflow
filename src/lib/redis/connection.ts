import IORedis, { type Redis, type RedisOptions } from "ioredis";

const globalForRedis = globalThis as unknown as { __graphflowRedis?: Redis };

function redisUrl() {
  return process.env.REDIS_URL ?? "redis://localhost:6379";
}

/**
 * Create a new Redis connection. BullMQ workers require
 * `maxRetriesPerRequest: null`; producers should fail fast instead.
 */
export function createRedisConnection(opts: RedisOptions = {}): Redis {
  const conn = new IORedis(redisUrl(), {
    lazyConnect: false,
    enableReadyCheck: true,
    retryStrategy: (times) => Math.min(times * 500, 5_000),
    ...opts,
  });
  conn.on("error", (err) => {
    // Logged once per distinct message to avoid flooding logs while Redis is down.
    const key = `__gf_last_err`;
    const holder = conn as unknown as Record<string, string>;
    if (holder[key] !== err.message) {
      holder[key] = err.message;
      console.warn(`[redis] ${err.message}`);
    }
  });
  conn.on("ready", () => {
    (conn as unknown as Record<string, string>)["__gf_last_err"] = "";
  });
  return conn;
}

/** Shared connection for the web process (queue producer, rate limiting, health). */
export function getRedis(): Redis {
  if (!globalForRedis.__graphflowRedis) {
    globalForRedis.__graphflowRedis = createRedisConnection({ maxRetriesPerRequest: 1 });
  }
  return globalForRedis.__graphflowRedis;
}

export function isRedisReady(conn: Redis = getRedis()): boolean {
  return conn.status === "ready";
}

/** Wait briefly for a connection that is still being established. Never throws. */
export async function waitForRedis(timeoutMs = 1000, conn: Redis = getRedis()): Promise<boolean> {
  if (conn.status === "ready") return true;
  if (conn.status === "end") return false;
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      clearTimeout(t);
      conn.off("ready", onReady);
      resolve(v);
    };
    const onReady = () => done(true);
    const t = setTimeout(() => done(conn.status === "ready"), timeoutMs);
    conn.once("ready", onReady);
  });
}
