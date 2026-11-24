import type { Server } from "node:http";
import { loadEnv } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { prisma } from "./config/prisma.js";
import { createApp } from "./app.js";
import {
  closeAuthRateLimitStore,
  initializeAuthRateLimitStore,
} from "./modules/auth/auth.rate-limit.js";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger();
  await initializeAuthRateLimitStore(env);
  const app = createApp(env, logger);

  const server: Server = app.listen(env.PORT, "127.0.0.1", () => {
    logger.info(
      {
        port: env.PORT,
        environment: env.NODE_ENV,
        apiPrefix: env.API_PREFIX,
      },
      "PartsArc backend listening",
    );
  });

  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info({ signal }, "Graceful shutdown started");

    server.close(async (closeError) => {
      if (closeError) {
        logger.error({ err: closeError }, "Error while closing HTTP server");
        process.exit(1);
      }

      await closeAuthRateLimitStore();
      await prisma.$disconnect();
      logger.info("HTTP server and database connections closed cleanly");
      process.exit(0);
    });

    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection");
  });

  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "Uncaught exception");
    shutdown("uncaughtException");
  });
}

bootstrap().catch((error: unknown) => {
  console.error("Failed to start PartsArc backend:", error);
  process.exit(1);
});
