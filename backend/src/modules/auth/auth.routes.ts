import { UserRole, type PrismaClient } from "@prisma/client";
import cookieParser from "cookie-parser";
import { Router } from "express";
import type { Env } from "../../config/env.js";
import {
  createAuthenticateMiddleware,
  requireActiveSupplierAccess,
  requireRoles,
} from "../../middleware/authenticate.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { sendSuccess } from "../../shared/utils/response.js";
import { createAuthController } from "./auth.controller.js";
import { createAuthRateLimits } from "./auth.rate-limit.js";
import {
  forgotPasswordSchema,
  changePasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "./auth.schemas.js";
import type { AuthService } from "./auth.service.js";
import { protectRefreshCookie } from "./csrf.middleware.js";

export function createAuthRouter(database: PrismaClient, env: Env, service: AuthService) {
  const router = Router();
  const controller = createAuthController(service, env);
  const limits = createAuthRateLimits(env);
  const authenticate = createAuthenticateMiddleware(database, env);

  router.use(cookieParser());
  router.post(
    "/register",
    limits.register,
    validateRequest({ body: registerSchema }),
    controller.register,
  );
  router.post(
    "/login",
    limits.login,
    validateRequest({ body: loginSchema }),
    controller.login,
  );
  router.post("/refresh", limits.refresh, protectRefreshCookie(env), controller.refresh);
  router.post("/logout", authenticate, controller.logout);
  router.post("/logout-all", authenticate, controller.logoutAll);
  router.get("/me", authenticate, controller.me);
  router.post(
    "/change-password",
    authenticate,
    validateRequest({ body: changePasswordSchema }),
    controller.changePassword,
  );
  router.post(
    "/forgot-password",
    limits.recovery,
    validateRequest({ body: forgotPasswordSchema }),
    controller.forgotPassword,
  );
  router.post(
    "/reset-password",
    limits.recovery,
    validateRequest({ body: resetPasswordSchema }),
    controller.resetPassword,
  );

  // Narrow Task 3 probes for integration-testing reusable permission middleware.
  router.get(
    "/access/admin",
    authenticate,
    requireRoles(database, UserRole.ADMIN, UserRole.SUPER_ADMIN),
    (req, res) => sendSuccess(res, { granted: true }, 200, req.requestId),
  );
  router.get(
    "/access/supplier",
    authenticate,
    requireRoles(database, UserRole.SUPPLIER_OWNER, UserRole.SUPPLIER_STAFF),
    requireActiveSupplierAccess(database),
    (req, res) =>
      sendSuccess(
        res,
        { granted: true, supplierAccess: req.supplierAccess },
        200,
        req.requestId,
      ),
  );

  return router;
}
