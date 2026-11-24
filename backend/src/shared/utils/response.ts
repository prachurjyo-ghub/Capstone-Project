import type { Response } from "express";
import type { ApiErrorResponse, ApiSuccessResponse } from "../types/api.js";

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  requestId: string,
): Response {
  const body: ApiSuccessResponse<T> = {
    success: true,
    data,
    requestId,
  };
  return res.status(statusCode).json(body);
}

export function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  requestId: string,
  details: unknown[] = [],
): Response {
  const body: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
      details,
    },
    requestId,
  };
  return res.status(statusCode).json(body);
}
