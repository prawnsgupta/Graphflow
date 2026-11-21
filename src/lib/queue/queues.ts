import { Queue, type JobsOptions } from "bullmq";
import { getRedis, waitForRedis } from "@/lib/redis/connection";

export const EVENT_QUEUE = "graphflow-events";
export const MAINTENANCE_QUEUE = "graphflow-maintenance";
export const WORKER_HEARTBEAT_KEY = "graphflow:worker:heartbeat";
/** BullMQ key prefix; tests use a separate prefix so they never share queues with a dev worker. */
export const QUEUE_PREFIX = process.env.BULLMQ_PREFIX ?? "bull";

export interface EventJobData {
  rawEventId: string;
  organizationId: string;
}

export const EVENT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: { age: 3600, count: 5_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

const globalForQueues = globalThis as unknown as { __graphflowEventQueue?: Queue<EventJobData> };

export function getEventQueue(): Queue<EventJobData> {
  if (!globalForQueues.__graphflowEventQueue) {
    globalForQueues.__graphflowEventQueue = new Queue<EventJobData>(EVENT_QUEUE, {
      connection: getRedis(),
      prefix: QUEUE_PREFIX,
      defaultJobOptions: EVENT_JOB_OPTIONS,
    });
    globalForQueues.__graphflowEventQueue.on("error", () => {
      /* connection errors are logged by the shared connection */
    });
  }
  return globalForQueues.__graphflowEventQueue;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("redis enqueue timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Enqueue processing jobs for durably-stored raw events.
 * The job id equals the raw event id, so BullMQ itself dedupes repeated
 * enqueues of the same event. Returns false (never throws) when Redis is
 * unavailable — the PostgreSQL recovery scanner re-enqueues those events.
 */
export async function enqueueEventJobs(jobs: EventJobData[]): Promise<boolean> {
  if (jobs.length === 0) return true;
  if (!(await waitForRedis(1000))) return false;
  try {
    await withTimeout(
      getEventQueue().addBulk(
        jobs.map((data) => ({ name: "process-event", data, opts: { ...EVENT_JOB_OPTIONS, jobId: data.rawEventId } })),
      ),
      2_000,
    );
    return true;
  } catch (err) {
    console.warn(`[queue] enqueue failed, recovery scanner will retry: ${(err as Error).message}`);
    return false;
  }
}
