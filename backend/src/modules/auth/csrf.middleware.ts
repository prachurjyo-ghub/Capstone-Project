import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { authCookieName, resolveAuthClient } from "./auth-client.js";

function equal(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function protectRefreshCookie(env: Env) {
  return function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
    const origin = req.header("origin");
    if (!origin || !env.CLIENT_ORIGINS.includes(origin)) {
      return next(
        new AppError("Request origin is not allowed", {
          code: "INVALID_REQUEST_ORIGIN",
          statusCode: 403,
        }),
      );
    }

    const client = resolveAuthClient(req);
    const csrfCookie = (req.cookies as Record<string, unknown> | undefined)?.[
      authCookieName(env.CSRF_COOKIE_NAME, client)
    ];
    const csrfHeader = req.header("x-csrf-token");
    if (typeof csrfCookie !== "string" || !csrfHeader || !equal(csrfCookie, csrfHeader)) {
      return next(
        new AppError("CSRF validation failed", {
          code: "CSRF_VALIDATION_FAILED",
          statusCode: 403,
        }),
      );
    }
    next();
  };
}
