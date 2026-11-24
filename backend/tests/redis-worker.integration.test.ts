import { randomUUID } from "node:crypto";
import { QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";
import { createLogger } from "../src/config/logger.js";
import { prisma } from "../src/config/prisma.js";
import { CatalogueCache } from "../src/modules/catalogue/catalogue.cache.js";
import { DisabledNotificationDelivery } from "../src/modules/communications/notification-delivery.js";
import { enqueueOutbox } from "../src/modules/communications/outbox.service.js";
import {
  PHASE3_QUEUE,
  configureRecurringJobs,
  redisConnection,
  startJobWorker,
  startWorkerHeartbeat,
} from "../src/modules/jobs/job-runtime.js";
import type { MatchingClock } from "../src/modules/matching/matching-clock.js";

const baseEnv = loadEnv();
const hasRedis = Boolean(baseEnv.REDIS_URL);
const suite = hasRedis ? describe : describe.skip;
const prefix = `autopro:test:redis:${randomUUID()}`;
const env = { ...baseEnv, REDIS_KEY_PREFIX: prefix, JOB_BATCH_SIZE: 20 };
const clock: MatchingClock = { now: () => new Date() };
const logger = createLogger();
let control: IORedis;

async function removeOwnKeys() {
  let cursor = "0";
  do {
    const [next, keys] = await control.scan(cursor, "MATCH", `${prefix}:*`, "COUNT", 100);
    cursor = next;
    if (keys.length) await control.del(...keys);
  } while (cursor !== "0");
}

suite("live Redis and BullMQ integration", () => {
  beforeAll(async () => {
    control = new IORedis(env.REDIS_URL!, { maxRetriesPerRequest: 1 });
    await control.ping();
    await removeOwnKeys();
  });

  afterAll(async () => {
    if (!hasRedis) return;
    await removeOwnKeys();
    control.disconnect();
    await prisma.$disconnect();
  });

  it("shares and invalidates catalogue cache values across instances", async () => {
    const first = new CatalogueCache(env);
    const second = new CatalogueCache(env);
    await first.set("product:redis", { id: "redis" });
    await expect(second.get("product:redis")).resolves.toEqual({ id: "redis" });
    await second.invalidate();
    await expect(first.get("product:redis")).resolves.toBeNull();
    await Promise.all([first.close(), second.close()]);
  });

  it("processes a durable outbox event once and recovers a delayed job after restart", async () => {
    await prisma.outboxEvent.deleteMany({ where: { eventKey: { startsWith: prefix } } });
    const aggregateId = randomUUID();
    const eventKey = `${prefix}:outbox`;
    await Promise.all([
      enqueueOutbox(prisma, {
        eventType: "INTEGRATION_PROBE",
        aggregateType: "IntegrationProbe",
        aggregateId,
        eventKey,
      }),
      enqueueOutbox(prisma, {
        eventType: "INTEGRATION_PROBE",
        aggregateType: "IntegrationProbe",
        aggregateId,
        eventKey,
      }),
    ]);

    const queueConnection = redisConnection(env)!;
    const workerConnection = redisConnection(env)!;
    const eventsConnection = redisConnection(env)!;
    const queue = await configureRecurringJobs(env, queueConnection);
    const events = new QueueEvents(PHASE3_QUEUE, {
      connection: eventsConnection,
      prefix,
    });
    await events.waitUntilReady();
    let worker = startJobWorker(
      prisma,
      env,
      clock,
      new DisabledNotificationDelivery(),
      workerConnection,
      logger,
    );
    await worker.waitUntilReady();
    await worker.close();

    const delayed = await queue.add("outbox", {}, { delay: 150, removeOnComplete: true });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const restartedConnection = redisConnection(env)!;
    worker = startJobWorker(
      prisma,
      env,
      clock,
      new DisabledNotificationDelivery(),
      restartedConnection,
      logger,
    );
    await delayed.waitUntilFinished(events, 10_000);
    expect(await prisma.outboxEvent.count({ where: { eventKey } })).toBe(1);
    expect(
      (await prisma.outboxEvent.findUniqueOrThrow({ where: { eventKey } })).status,
    ).toBe("PROCESSED");

    const failed = await queue.add(
      "unsupported-integration-probe",
      {},
      { attempts: 2, backoff: { type: "fixed", delay: 50 } },
    );
    await expect(failed.waitUntilFinished(events, 10_000)).rejects.toThrow(
      "Unsupported job type",
    );
    expect((await queue.getJob(failed.id!))?.attemptsMade).toBe(2);

    await worker.close();
    await queue.close();
    await events.close();
    queueConnection.disconnect();
    workerConnection.disconnect();
    restartedConnection.disconnect();
    eventsConnection.disconnect();
  });

  it("publishes and removes a worker heartbeat and reconnects safely", async () => {
    const connection = redisConnection(env)!;
    await connection.connect();
    const heartbeat = startWorkerHeartbeat(env, connection, logger);
    await heartbeat.ready;
    expect(await control.get(heartbeat.key)).not.toBeNull();
    await heartbeat.close();
    expect(await control.get(heartbeat.key)).toBeNull();
    connection.disconnect();
    const reconnected = redisConnection(env)!;
    await reconnected.connect();
    await expect(reconnected.ping()).resolves.toBe("PONG");
    reconnected.disconnect();
  });
});
