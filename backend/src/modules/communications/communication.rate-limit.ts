import { rateLimit } from "express-rate-limit";
import type { Env } from "../../config/env.js";

export function createCommunicationRateLimits(env: Env) {
  const build = (limit: number) =>
    rateLimit({
      windowMs: 60_000,
      limit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      skip: () => !env.RATE_LIMIT_ENABLED,
      handler: (req, res) =>
        res.status(429).json({
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many communication requests. Please try again shortly.",
            details: [],
          },
          requestId: req.requestId,
        }),
    });
  return { send: build(30), upload: build(10) };
}
