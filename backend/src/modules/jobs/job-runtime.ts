import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import type { Logger } from "pino";
import type { Env } from "../../config/env.js";
import type { PrismaClient } from "@prisma/client";
import type { MatchingClock } from "../matching/matching-clock.js";
import { BackgroundService } from "./background.service.js";
import { OutboxProcessor } from "../communications/outbox-processor.js";
import type { NotificationDeliveryProvider } from "../communications/notification-delivery.js";

export const PHASE3_QUEUE = "phase3-background";

export function redisConnection(env: Env) {
  if (!env.REDIS_URL) return null;
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });
}

export function startWorkerHeartbeat(env: Env, connection: IORedis, logger: Logger) {
  const key = `${env.REDIS_KEY_PREFIX}:worker:heartbeat`;
  const write = () =>
    connection.set(key, new Date().toISOString(), "EX", env.WORKER_HEARTBEAT_TTL_SECONDS);
  const timer = setInterval(
    () =>
      void write().catch((error) =>
        logger.error({ err: error }, "Worker heartbeat failed"),
      ),
    env.WORKER_HEARTBEAT_INTERVAL_SECONDS * 1_000,
  );
  timer.unref();
  return {
    key,
    ready: write(),
    async close() {
      clearInterval(timer);
      await connection.del(key);
    },
  };
}

export async function configureRecurringJobs(env: Env, connection: IORedis) {
  const queue = new Queue(PHASE3_QUEUE, {
    connection,
    prefix: env.REDIS_KEY_PREFIX,
  });
  await queue.upsertJobScheduler(
    "lifecycle-every-minute",
    { every: 60_000 },
    {
      name: "lifecycle",
      data: {},
      opts: {
        attempts: 5,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    },
  );
  await queue.upsertJobScheduler(
    "outbox-every-15-seconds",
    { every: 15_000 },
    {
      name: "outbox",
      data: {},
      opts: {
        attempts: 5,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    },
  );
  await queue.upsertJobScheduler(
    "reminders-every-15-minutes",
    { every: 15 * 60_000 },
    {
      name: "reminders",
      data: {},
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    },
  );
  return queue;
}

export function startJobWorker(
  database: PrismaClient,
  env: Env,
  clock: MatchingClock,
  delivery: NotificationDeliveryProvider,
  connection: IORedis,
  logger: Logger,
) {
  const background = new BackgroundService(database, clock, env.JOB_BATCH_SIZE);
  const outbox = new OutboxProcessor(database, env, delivery);
  return new Worker(
    PHASE3_QUEUE,
    async (job: Job) => {
      const startedAt = Date.now();
      const lagMs = Math.max(0, startedAt - job.timestamp);
      try {
        if (job.name === "lifecycle") return await background.reconcileLifecycle();
        if (job.name === "reminders") return await background.enqueueReminders();
        if (job.name === "outbox") return await outbox.processBatch();
        throw new Error(`Unsupported job type: ${job.name}`);
      } finally {
        logger.info(
          { jobId: job.id, jobName: job.name, lagMs, durationMs: Date.now() - startedAt },
          "Background job completed",
        );
      }
    },
    { connection, concurrency: env.WORKER_CONCURRENCY, prefix: env.REDIS_KEY_PREFIX },
  ).on("failed", (job, error) => {
    logger.error(
      { jobId: job?.id, jobName: job?.name, err: error },
      "Background job failed",
    );
  });
}
