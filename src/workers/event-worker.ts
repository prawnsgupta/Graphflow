import { Worker, type Job } from "bullmq";
import { createRedisConnection } from "@/lib/redis/connection";
import { EVENT_QUEUE, EVENT_JOB_OPTIONS, QUEUE_PREFIX, type EventJobData } from "@/lib/queue/queues";
import { processRawEvent, recordProcessingFailure } from "@/services/events/processor";

/**
 * Consumes event-processing jobs. Each job carries only ids; the source of
 * truth is the raw event in PostgreSQL. Retries use exponential backoff;
 * after the final attempt the event is marked FAILED (visible in the UI and
 * retryable by an administrator).
 */
export function startEventWorker(concurrency: number) {
  const connection = createRedisConnection({ maxRetriesPerRequest: null });
  const maxAttempts = EVENT_JOB_OPTIONS.attempts ?? 5;

  const worker = new Worker<EventJobData>(
    EVENT_QUEUE,
    async (job: Job<EventJobData>) => {
      const { rawEventId, organizationId } = job.data;
      try {
        const outcome = await processRawEvent(rawEventId, organizationId);
        return { outcome };
      } catch (err) {
        const final = job.attemptsMade + 1 >= maxAttempts;
        await recordProcessingFailure(rawEventId, organizationId, err, final).catch((e) =>
          console.error("[event-worker] could not record failure", e),
        );
        throw err;
      }
    },
    { connection, concurrency, autorun: true, prefix: QUEUE_PREFIX },
  );

  worker.on("failed", (job, err) => {
    console.warn(`[event-worker] job ${job?.id} attempt ${job?.attemptsMade} failed: ${err.message}`);
  });
  worker.on("error", (err) => console.warn(`[event-worker] ${err.message}`));
  return worker;
}
