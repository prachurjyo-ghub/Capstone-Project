export type AppErrorOptions = {
  code?: string;
  statusCode?: number;
  details?: unknown[];
  isOperational?: boolean;
  cause?: unknown;
};

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: unknown[];
  readonly isOperational: boolean;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = "AppError";
    this.code = options.code ?? "APP_ERROR";
    this.statusCode = options.statusCode ?? 500;
    this.details = options.details ?? [];
    this.isOperational = options.isOperational ?? true;

    if (options.cause !== undefined) {
      this.cause = options.cause;
    }

    Error.captureStackTrace?.(this, this.constructor);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
