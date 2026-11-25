import type { Request } from "express";
import { AppError } from "../../shared/errors/app-error.js";

const authClients = ["customer", "supplier", "admin", "garage"] as const;
export type AuthClient = (typeof authClients)[number];

export function resolveAuthClient(req: Request): AuthClient | undefined {
  const value = req.header("x-auth-client");
  if (!value) return undefined;
  if ((authClients as readonly string[]).includes(value)) return value as AuthClient;
  throw new AppError("Authentication client is invalid", {
    code: "INVALID_AUTH_CLIENT",
    statusCode: 400,
  });
}

export function authCookieName(baseName: string, client?: AuthClient): string {
  return client ? `${baseName}_${client}` : baseName;
}
