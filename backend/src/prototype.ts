import type { Server } from "node:http";
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { prisma } from "./config/prisma.js";
import {
  closeAuthRateLimitStore,
  initializeAuthRateLimitStore,
} from "./modules/auth/auth.rate-limit.js";
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
import { SystemMatchingClock } from "./modules/matching/matching-clock.js";
import { startProcessMetrics } from "./observability/process-metrics.js";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger();
  const stopProcessMetrics = startProcessMetrics(logger);
  const connection = redisConnection(env);
  if (!connection) throw new Error("REDIS_URL is required for the prototype runtime");

  await connection.connect();
  await initializeAuthRateLimitStore(env);
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

  const app = createApp(env, logger);
  const server: Server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, environment: env.NODE_ENV, apiPrefix: env.API_PREFIX },
      "PartsArc prototype API and worker started",
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Prototype runtime shutdown started");

    const forceExit = setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 15_000);
    forceExit.unref();

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await heartbeat.close();
    stopProcessMetrics();
    await worker.close();
    await queue.close();
    await closeAuthRateLimitStore();
    await connection.quit();
    await prisma.$disconnect();
    clearTimeout(forceExit);
    logger.info("Prototype API, worker and shared connections closed cleanly");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection");
  });
  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "Uncaught exception");
    void shutdown("uncaughtException");
  });
}

bootstrap().catch((error: unknown) => {
  console.error("Failed to start PartsArc prototype runtime:", error);
  process.exit(1);
});
