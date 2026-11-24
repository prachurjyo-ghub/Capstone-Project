import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { AppError } from "../shared/errors/app-error.js";

type RequestSchemas = {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
};

/**
 * Reserved for Task 2+ route validation.
 * Parses request segments with Zod and throws AppError on failure.
 */
export function validateRequest(schemas: RequestSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        Object.defineProperty(req, "query", {
          value: schemas.query.parse(req.query) as Request["query"],
          configurable: true,
          enumerable: true,
        });
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as Request["params"];
      }
      next();
    } catch (error) {
      const details =
        error instanceof Error && "issues" in error
          ? (
              error as { issues: Array<{ path: PropertyKey[]; message: string }> }
            ).issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            }))
          : [];
      next(
        new AppError("Request validation failed", {
          code: "VALIDATION_ERROR",
          statusCode: 400,
          details,
          cause: error,
        }),
      );
    }
  };
}
