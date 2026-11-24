import { rateLimit } from "express-rate-limit";
import IORedis from "ioredis";
import { RedisStore } from "rate-limit-redis";
import type { Env } from "../../config/env.js";

let redisClient: IORedis | undefined;

function rateLimitRedisClient(env: Env) {
  redisClient ??= new IORedis(env.REDIS_URL!, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
  });
  return redisClient;
}

function store(env: Env, name: string) {
  if (env.AUTH_RATE_LIMIT_STORE !== "redis") return undefined;
  const client = rateLimitRedisClient(env);
  return new RedisStore({
    prefix: `${env.REDIS_KEY_PREFIX}:auth-rate:${name}:`,
    sendCommand: (...args: string[]) =>
      client.call(args[0]!, ...args.slice(1)) as Promise<
        string | number | boolean | Array<string | number | boolean>
      >,
  });
}

export async function initializeAuthRateLimitStore(env: Env) {
  if (env.AUTH_RATE_LIMIT_STORE !== "redis") return;
  const client = rateLimitRedisClient(env);
  if (client.status === "wait") await client.connect();
  if (client.status !== "ready") {
    await new Promise<void>((resolve, reject) => {
      client.once("ready", resolve);
      client.once("error", reject);
    });
  }
  await client.ping();
}

function createLimiter(env: Env, name: string, windowMs: number, limit: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => !env.RATE_LIMIT_ENABLED,
    store: store(env, name),
    passOnStoreError: false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests. Please try again later.",
          details: [],
        },
        requestId: req.requestId,
      });
    },
  });
}

export function createAuthRateLimits(env: Env) {
  return {
    register: createLimiter(env, "register", 15 * 60_000, 10),
    login: createLimiter(env, "login", 15 * 60_000, 10),
    refresh: createLimiter(env, "refresh", 5 * 60_000, 30),
    recovery: createLimiter(env, "recovery", 30 * 60_000, 10),
  };
}

export async function closeAuthRateLimitStore() {
  if (!redisClient) return;
  const client = redisClient;
  redisClient = undefined;
  client.disconnect();
}
