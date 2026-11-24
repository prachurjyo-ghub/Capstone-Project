import { loadEnv } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { prisma } from "./config/prisma.js";
import { SystemMatchingClock } from "./modules/matching/matching-clock.js";
import {
  DisabledNotificationDelivery,
  LocalNotificationDelivery,
} from "./modules/communications/notification-delivery.js";
import {
  configureRecurringJobs,
  redisConnection,
  startJobWorker,
  startWorkerHeartbeat,
} from "./modules/jobs/job-runtime.js";

async function bootstrap() {
  const env = loadEnv();
  const logger = createLogger();
  const connection = redisConnection(env);
  if (!connection)
    throw new Error("REDIS_URL is required to start the background worker");
  await connection.connect();
  const delivery =
    env.NODE_ENV === "development"
      ? new LocalNotificationDelivery(env.NOTIFICATION_OUTBOX_DIR)
      : new DisabledNotificationDelivery();
  const queue = await configureRecurringJobs(env, connection);
  const worker = startJobWorker(
    prisma,
    env,
    new SystemMatchingClock(),
    delivery,
    connection,
    logger,
  );
  const heartbeat = startWorkerHeartbeat(env, connection, logger);
  await heartbeat.ready;
  logger.info("PartsArc background worker started");
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Background worker shutdown started");
    await heartbeat.close();
    await worker.close();
    await queue.close();
    await connection.quit();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

bootstrap().catch((error: unknown) => {
  console.error("Failed to start PartsArc background worker:", error);
  process.exit(1);
});
