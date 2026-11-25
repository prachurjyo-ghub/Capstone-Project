import type { NextFunction, Request, Response } from "express";
import type { Env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/utils/response.js";
import type { AuthService, RequestMetadata } from "./auth.service.js";
import { clearAuthCookies, setAuthCookies } from "./auth.cookies.js";
import { authCookieName, resolveAuthClient } from "./auth-client.js";

export function requestMetadata(req: Request): RequestMetadata {
  return {
    requestId: req.requestId,
    ipAddress: req.ip,
    userAgent: req.header("user-agent"),
  };
}

export function publicSession(session: Awaited<ReturnType<AuthService["login"]>>) {
  return {
    accessToken: session.accessToken,
    tokenType: "Bearer" as const,
    expiresIn: session.accessTokenExpiresIn,
    csrfToken: session.csrfToken,
    account: session.account,
  };
}

export function createAuthController(service: AuthService, env: Env) {
  return {
    register: async (req: Request, res: Response): Promise<void> => {
      const client = resolveAuthClient(req);
      const session = await service.register(req.body, requestMetadata(req));
      setAuthCookies(res, session.refreshToken, session.csrfToken, env, client);
      sendSuccess(res, publicSession(session), 201, req.requestId);
    },

    login: async (req: Request, res: Response): Promise<void> => {
      const client = resolveAuthClient(req);
      const session = await service.login(req.body, requestMetadata(req));
      setAuthCookies(res, session.refreshToken, session.csrfToken, env, client);
      sendSuccess(res, publicSession(session), 200, req.requestId);
    },

    refresh: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const client = resolveAuthClient(req);
      try {
        const refreshToken = (req.cookies as Record<string, unknown> | undefined)?.[
          authCookieName(env.REFRESH_COOKIE_NAME, client)
        ];
        const csrfToken = req.header("x-csrf-token");
        if (typeof refreshToken !== "string" || !csrfToken) {
          throw new AppError("Refresh session is required", {
            code: "INVALID_REFRESH_SESSION",
            statusCode: 401,
          });
        }
        const session = await service.refresh(
          refreshToken,
          csrfToken,
          requestMetadata(req),
          client === "garage",
        );
        setAuthCookies(res, session.refreshToken, session.csrfToken, env, client);
        sendSuccess(res, publicSession(session), 200, req.requestId);
      } catch (error) {
        clearAuthCookies(res, env, client);
        next(error);
      }
    },

    logout: async (req: Request, res: Response): Promise<void> => {
      const client = resolveAuthClient(req);
      if (!req.auth) throw new Error("Authentication context is missing");
      await service.logoutCurrent(req.auth.id, req.auth.sessionFamilyId, req.requestId);
      clearAuthCookies(res, env, client);
      sendSuccess(res, { message: "Current session revoked" }, 200, req.requestId);
    },

    logoutAll: async (req: Request, res: Response): Promise<void> => {
      const client = resolveAuthClient(req);
      if (!req.auth) throw new Error("Authentication context is missing");
      await service.logoutAll(req.auth.id, req.requestId);
      clearAuthCookies(res, env, client);
      sendSuccess(res, { message: "All sessions revoked" }, 200, req.requestId);
    },

    me: async (req: Request, res: Response): Promise<void> => {
      if (!req.auth) throw new Error("Authentication context is missing");
      sendSuccess(res, await service.getMe(req.auth.id), 200, req.requestId);
    },

    changePassword: async (req: Request, res: Response): Promise<void> => {
      if (!req.auth) throw new Error("Authentication context is missing");
      sendSuccess(
        res,
        await service.changePassword(
          req.auth.id,
          req.auth.sessionFamilyId,
          req.body,
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },

    forgotPassword: async (req: Request, res: Response): Promise<void> => {
      await service.forgotPassword(req.body, requestMetadata(req));
      sendSuccess(
        res,
        {
          message: "If an eligible account exists, password reset instructions were sent",
        },
        200,
        req.requestId,
      );
    },

    resetPassword: async (req: Request, res: Response): Promise<void> => {
      const client = resolveAuthClient(req);
      await service.resetPassword(req.body, requestMetadata(req));
      clearAuthCookies(res, env, client);
      sendSuccess(res, { message: "Password reset completed" }, 200, req.requestId);
    },
  };
}
