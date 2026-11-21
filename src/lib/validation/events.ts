import { z } from "zod";

/**
 * Activity event contract shared by every collector (the web simulator today,
 * a native desktop agent later). The schema is STRICT: unknown fields are
 * rejected, so collectors cannot smuggle prohibited data (screenshots,
 * keystrokes, clipboard, message or page contents, file contents).
 */
export const EVENT_TYPES = [
  "APP_OPENED",
  "APP_CLOSED",
  "APPLICATION_SWITCH",
  "FILE_CONTEXT_CHANGED",
  "FOCUS_STARTED",
  "FOCUS_ENDED",
  "IDLE_STARTED",
  "IDLE_ENDED",
  "PROJECT_CHANGED",
  "SESSION_HEARTBEAT",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const fileMetadataSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    path: z.string().trim().min(1).max(1024),
    type: z.string().trim().max(50).optional(),
  })
  .strict();

export type FileMetadata = z.infer<typeof fileMetadataSchema>;

const executable = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\w .()+-]+$/, "Invalid executable name");

export const activityEventSchema = z
  .object({
    /** Collector-generated unique id; re-sending the same id is a no-op. */
    eventId: z.string().uuid(),
    type: z.enum(EVENT_TYPES),
    /** ISO-8601 timestamp with offset; normalised to UTC on ingestion. */
    timestamp: z.string().datetime({ offset: true }),
    deviceId: z.string().uuid(),
    sessionId: z.string().uuid(),
    /** Monotonic per-session counter; breaks ties between equal timestamps. */
    sequence: z.number().int().min(0).max(1_000_000_000).default(0),
    projectId: z.string().uuid().nullable().optional(),
    /** Executable name of the foreground application, e.g. "Figma.exe". */
    tool: executable.optional(),
    previousTool: executable.optional(),
    file: fileMetadataSchema.nullable().optional(),
    /** Seconds since the last input, as reported by the collector. */
    idleSeconds: z.number().int().min(0).max(86_400).optional(),
    simulated: z.boolean().default(true),
  })
  .strict();

export type ActivityEventInput = z.infer<typeof activityEventSchema>;

export const MAX_EVENTS_PER_BATCH = 200;

export const eventBatchSchema = z
  .object({
    events: z.array(activityEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
  })
  .strict();

export const simulatorBatchSchema = z
  .object({
    runId: z.string().uuid(),
    /** Target employee; defaults to the authenticated user. */
    userId: z.string().uuid().optional(),
    events: z.array(activityEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
  })
  .strict();

/** Payload persisted in raw_activity_events.payload (JSONB). */
export interface StoredEventPayload {
  type: EventType;
  timestamp: string;
  sequence: number;
  projectId: string | null | undefined;
  tool?: string;
  previousTool?: string;
  file?: FileMetadata | null;
  idleSeconds?: number;
  simulated: boolean;
  source: "simulator" | "agent" | "seed";
}

/** Accepted clock skew for live ingestion. */
export const MAX_FUTURE_SKEW_MS = 2 * 60_000;
export const MAX_EVENT_AGE_MS = 7 * 24 * 3600_000;
