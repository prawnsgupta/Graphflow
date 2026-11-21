import IORedis from "ioredis";
import { config } from "dotenv";

/**
 * The suite signs in many times from 127.0.0.1. Clear the local login
 * rate-limit counters first so repeated local runs are not throttled.
 * (Only touches graphflow:rl:* keys in the local development Redis.)
 */
export default async function globalSetup() {
  config();
  const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: 1 });
  try {
    const keys = await redis.keys("graphflow:rl:login*");
    if (keys.length) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}
