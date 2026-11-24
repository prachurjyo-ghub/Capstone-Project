import pino from "pino";
import { getEnv } from "./env.js";

export function createLogger() {
  const env = getEnv();

  return pino({
    name: "partsarc-backend",
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        "password",
        "newPassword",
        "token",
        "refreshToken",
        "csrfToken",
        "req.body.password",
        "req.body.newPassword",
        "req.body.token",
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-csrf-token",
        "headers.authorization",
        "headers.cookie",
        "headers.set-cookie",
        "res.headers.set-cookie",
      ],
      censor: "[REDACTED]",
    },
    ...(env.NODE_ENV === "development"
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:standard",
              ignore: "pid,hostname",
            },
          },
        }
      : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;
