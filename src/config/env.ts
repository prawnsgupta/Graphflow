import { z } from "zod";

/**
 * Server-side environment, validated once at startup.
 * Never import this module from client components.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  DEMO_MODE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  WORKER_HEALTH_PORT: z.coerce.number().int().default(9100),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  RECOVERY_SCAN_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.DEMO_MODE) {
    // Demo mode in production would advertise demo credentials. Refuse loudly.
    console.warn("[graphflow] WARNING: DEMO_MODE=true in production. Demo hints are disabled.");
    parsed.data.DEMO_MODE = false;
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = () => env().NODE_ENV === "production";
