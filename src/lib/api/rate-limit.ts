import { getRedis, isRedisReady } from "@/lib/redis/connection";

/**
 * Fixed-window rate limiter. Uses Redis when available so limits hold across
 * multiple web instances; falls back to process memory when Redis is down
 * (fail-safe: limiting still applies, just per instance).
 */
const memory = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const fullKey = `graphflow:rl:${key}`;
  if (isRedisReady()) {
    try {
      const redis = getRedis();
      const count = await redis.incr(fullKey);
      if (count === 1) await redis.expire(fullKey, windowSeconds);
      const ttl = await redis.ttl(fullKey);
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetSeconds: ttl > 0 ? ttl : windowSeconds };
    } catch {
      // fall through to memory
    }
  }
  const now = Date.now();
  const entry = memory.get(fullKey);
  if (!entry || entry.resetAt <= now) {
    memory.set(fullKey, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: limit - 1, resetSeconds: windowSeconds };
  }
  entry.count += 1;
  if (memory.size > 10_000) {
    for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
  }
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    resetSeconds: Math.ceil((entry.resetAt - now) / 1000),
  };
}
