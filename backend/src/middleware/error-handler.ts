import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import type { Logger } from "../config/logger.js";
import { getEnv } from "../config/env.js";
import { AppError, isAppError } from "../shared/errors/app-error.js";
import { sendError } from "../shared/utils/response.js";

function mapError(error: unknown): {
  statusCode: number;
  code: string;
  message: string;
  details: unknown[];
  isOperational: boolean;
} {
  if (isAppError(error)) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      details: error.details,
      isOperational: error.isOperational,
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
      isOperational: true,
    };
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    (error as { type?: string }).type === "entity.parse.failed"
  ) {
    return {
      statusCode: 400,
      code: "INVALID_JSON",
      message: "Malformed JSON in request body",
      details: [],
      isOperational: true,
    };
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    ((error as { type?: string }).type === "entity.too.large" ||
      (error as { status?: number }).status === 413)
  ) {
    return {
      statusCode: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "Request payload is too large",
      details: [],
      isOperational: true,
    };
  }

  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    return {
      statusCode: 400,
      code: "INVALID_JSON",
      message: "Malformed JSON in request body",
      details: [],
      isOperational: true,
    };
  }

  if (
    typeof error === "object" &&
    error !== null &&
    (("status" in error && (error as { status?: number }).status === 400) ||
      ("code" in error && (error as { code?: string }).code === "Z_DATA_ERROR"))
  ) {
    return {
      statusCode: 400,
      code: "INVALID_REQUEST_BODY",
      message: "Request body encoding is invalid",
      details: [],
      isOperational: true,
    };
  }

  return {
    statusCode: 500,
    code: "INTERNAL_SERVER_ERROR",
    message: "An unexpected error occurred",
    details: [],
    isOperational: false,
  };
}

export function createErrorHandler(logger: Logger) {
  return function errorHandler(
    error: unknown,
    req: Request,
    res: Response,
    _next: NextFunction,
  ): void {
    const env = getEnv();
    const mapped = mapError(error);
    const requestId = req.requestId ?? "unknown";

    const logPayload = {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: mapped.statusCode,
      code: mapped.code,
      err: error,
    };

    if (mapped.statusCode >= 500) {
      logger.error(logPayload, mapped.message);
    } else {
      logger.warn(logPayload, mapped.message);
    }

    const publicMessage =
      env.NODE_ENV === "production" && !mapped.isOperational
        ? "An unexpected error occurred"
        : mapped.message;

    const details =
      env.NODE_ENV === "production" && mapped.statusCode >= 500 ? [] : mapped.details;

    sendError(res, mapped.statusCode, mapped.code, publicMessage, requestId, details);
  };
}

export function createAppError(
  message: string,
  options?: ConstructorParameters<typeof AppError>[1],
): AppError {
  return new AppError(message, options);
}
