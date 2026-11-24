import type { PrismaClient } from "@prisma/client";
import type { Request, Response } from "express";
import IORedis from "ioredis";
import { getEnv } from "../../config/env.js";
import { sendSuccess } from "../../shared/utils/response.js";

export function getHealth(req: Request, res: Response): void {
  const env = getEnv();

  sendSuccess(
    res,
    {
      status: "ok",
      service: "partsarc-backend",
      environment: env.NODE_ENV,
      uptime: Math.floor(process.uptime()),
    },
    200,
    req.requestId,
  );
}

export async function getReadiness(
  database: PrismaClient,
  req: Request,
  res: Response,
): Promise<void> {
  const env = getEnv();
  let databaseReady = false;
  try {
    await database.$queryRaw`SELECT 1`;
    databaseReady = true;
  } catch {
    databaseReady = false;
  }
  let redis: "ready" | "unavailable" | "not_configured" = "not_configured";
  let workerHeartbeat: string | null = null;
  if (env.REDIS_URL) {
    const client = new IORedis(env.REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 750,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    client.on("error", () => undefined);
    try {
      await client.connect();
      redis = (await client.ping()) === "PONG" ? "ready" : "unavailable";
      if (redis === "ready")
        workerHeartbeat = await client.get(`${env.REDIS_KEY_PREFIX}:worker:heartbeat`);
    } catch {
      redis = "unavailable";
    } finally {
      client.disconnect();
    }
  }
  const pendingOutbox = databaseReady
    ? await database.outboxEvent.count({
        where: { status: { in: ["PENDING", "FAILED"] } },
      })
    : null;
  sendSuccess(
    res,
    {
      status: databaseReady ? (redis === "ready" ? "ready" : "degraded") : "not_ready",
      database: databaseReady ? "ready" : "unavailable",
      redis,
      backgroundWorker: workerHeartbeat ? "ready" : "not_available",
      workerHeartbeat,
      durableOutbox: { pending: pendingOutbox },
      catalogueFallback: "available",
    },
    databaseReady ? 200 : 503,
    req.requestId,
  );
}
