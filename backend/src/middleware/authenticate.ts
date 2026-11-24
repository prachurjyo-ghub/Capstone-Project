import {
  AccountStatus,
  SupplierBusinessStatus,
  UserRole,
  type PrismaClient,
} from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import type { Env } from "../config/env.js";
import { recordAuthAudit } from "../modules/auth/audit.service.js";
import { verifyAccessToken } from "../modules/auth/token.service.js";
import { AppError } from "../shared/errors/app-error.js";
import { hasCurrentSupplierEntitlement } from "../modules/subscriptions/subscription-access.js";

function authError(
  code = "AUTHENTICATION_REQUIRED",
  message = "Authentication is required",
) {
  return new AppError(message, { code, statusCode: 401 });
}

export function createAuthenticateMiddleware(database: PrismaClient, env: Env) {
  return async function authenticate(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const authorization = req.header("authorization");
      const match = authorization?.match(/^Bearer\s+(.+)$/i);
      if (!match?.[1]) throw authError();

      let claims;
      try {
        claims = await verifyAccessToken(match[1], env);
      } catch {
        throw authError("INVALID_ACCESS_TOKEN", "Access token is invalid or expired");
      }

      const session = await database.refreshSession.findFirst({
        where: { id: claims.sessionId, userId: claims.userId },
        include: {
          user: {
            select: {
              email: true,
              role: true,
              accountStatus: true,
              mustChangePassword: true,
            },
          },
        },
      });

      if (!session || session.revokedAt || session.expiresAt <= new Date()) {
        throw authError("SESSION_REVOKED", "Session is invalid or revoked");
      }
      if (session.user.role !== claims.role) {
        throw authError("INVALID_ACCESS_TOKEN", "Access token is invalid or expired");
      }
      if (
        session.user.accountStatus === AccountStatus.SUSPENDED ||
        session.user.accountStatus === AccountStatus.DISABLED
      ) {
        await recordAuthAudit(database, {
          actorUserId: claims.userId,
          entityId: claims.userId,
          action: "AUTH_ACCESS_RESTRICTED",
          requestId: req.requestId,
          metadata: { accountStatus: session.user.accountStatus },
        });
        throw new AppError("Account access is restricted", {
          code: "ACCOUNT_RESTRICTED",
          statusCode: 403,
        });
      }

      req.auth = {
        id: claims.userId,
        email: session.user.email,
        role: session.user.role,
        accountStatus: session.user.accountStatus,
        sessionId: session.id,
        sessionFamilyId: session.familyId,
        mustChangePassword: session.user.mustChangePassword,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireRoles(database: PrismaClient, ...allowedRoles: UserRole[]) {
  return async function rolePermission(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!req.auth) return next(authError());
    if (allowedRoles.includes(req.auth.role)) return next();

    try {
      await recordAuthAudit(database, {
        actorUserId: req.auth.id,
        entityId: req.auth.id,
        action: "AUTH_ROLE_ACCESS_DENIED",
        requestId: req.requestId,
        metadata: { requiredRoles: allowedRoles, actualRole: req.auth.role },
      });
      next(
        new AppError("You do not have permission to access this resource", {
          code: "FORBIDDEN",
          statusCode: 403,
        }),
      );
    } catch (error) {
      next(error);
    }
  };
}

export function requireActiveSupplierAccess(database: PrismaClient) {
  return async function supplierPermission(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!req.auth) return next(authError());

    try {
      const requestedBusinessId = req.header("x-business-id");
      const memberships = await database.supplierUser.findMany({
        where: {
          userId: req.auth.id,
          isActive: true,
          leftAt: null,
          business: { status: SupplierBusinessStatus.ACTIVE },
        },
        select: {
          id: true,
          businessId: true,
          isPrimary: true,
          business: { select: { status: true } },
        },
      });

      const membership = requestedBusinessId
        ? memberships.find((item) => item.businessId === requestedBusinessId)
        : memberships.length === 1
          ? memberships[0]
          : undefined;

      if (!membership) {
        await recordAuthAudit(database, {
          actorUserId: req.auth.id,
          entityId: req.auth.id,
          action: "AUTH_SUPPLIER_ACCESS_DENIED",
          requestId: req.requestId,
          metadata: {
            reason:
              memberships.length > 1 && !requestedBusinessId
                ? "business_selection_required"
                : "no_active_membership",
          },
        });
        throw new AppError(
          memberships.length > 1 && !requestedBusinessId
            ? "An active supplier business must be selected"
            : "Active supplier membership is required",
          {
            code:
              memberships.length > 1 && !requestedBusinessId
                ? "SUPPLIER_BUSINESS_REQUIRED"
                : "SUPPLIER_ACCESS_RESTRICTED",
            statusCode: 403,
          },
        );
      }

      if (req.auth.mustChangePassword) {
        throw new AppError("Password change is required before supplier operations", {
          code: "PASSWORD_CHANGE_REQUIRED",
          statusCode: 403,
        });
      }

      const entitlement = await hasCurrentSupplierEntitlement(
        database,
        membership.businessId,
      );
      if (!entitlement) {
        await recordAuthAudit(database, {
          actorUserId: req.auth.id,
          entityId: membership.businessId,
          action: "AUTH_SUPPLIER_ACCESS_DENIED",
          requestId: req.requestId,
          metadata: { reason: "subscription_inactive" },
        });
        throw new AppError(
          "Supplier subscription is expired or inactive. Contact PartsArc operations.",
          {
            code: "SUPPLIER_SUBSCRIPTION_REQUIRED",
            statusCode: 403,
          },
        );
      }

      req.supplierAccess = {
        membershipId: membership.id,
        businessId: membership.businessId,
        businessStatus: membership.business.status,
        isPrimary: membership.isPrimary,
        entitlementEndsAt: entitlement.endsAt,
        entitlementSource: entitlement.source,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireSupplierMembership(database: PrismaClient) {
  return async function supplierMembership(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!req.auth) return next(authError());
    try {
      if (req.auth.mustChangePassword) {
        throw new AppError("Password change is required before supplier access", {
          code: "PASSWORD_CHANGE_REQUIRED",
          statusCode: 403,
        });
      }
      const requestedBusinessId = req.header("x-business-id");
      const memberships = await database.supplierUser.findMany({
        where: {
          userId: req.auth.id,
          isActive: true,
          leftAt: null,
          business: { status: { not: SupplierBusinessStatus.CLOSED } },
        },
        select: {
          id: true,
          businessId: true,
          isPrimary: true,
          business: {
            select: {
              status: true,
              subscriptionGraceEndsAt: true,
            },
          },
        },
      });
      const membership = requestedBusinessId
        ? memberships.find((item) => item.businessId === requestedBusinessId)
        : memberships.length === 1
          ? memberships[0]
          : undefined;
      if (!membership) {
        throw new AppError("Supplier membership is required", {
          code: "SUPPLIER_MEMBERSHIP_REQUIRED",
          statusCode: 403,
        });
      }
      const entitlement = await hasCurrentSupplierEntitlement(
        database,
        membership.businessId,
      );
      req.supplierAccess = {
        membershipId: membership.id,
        businessId: membership.businessId,
        businessStatus: membership.business.status,
        isPrimary: membership.isPrimary,
        entitlementEndsAt:
          entitlement?.endsAt ??
          membership.business.subscriptionGraceEndsAt ??
          new Date(0),
        entitlementSource: entitlement?.source ?? "MIGRATION_GRACE",
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireSupplierOwnerAccess(database: PrismaClient) {
  return async function supplierOwnerPermission(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!req.auth || !req.supplierAccess) return next(authError());
    if (req.auth.role === UserRole.SUPPLIER_OWNER && req.supplierAccess.isPrimary) {
      return next();
    }
    try {
      await recordAuthAudit(database, {
        actorUserId: req.auth.id,
        entityId: req.auth.id,
        action: "AUTH_SUPPLIER_OWNER_ACCESS_DENIED",
        requestId: req.requestId,
        metadata: { businessId: req.supplierAccess.businessId },
      });
      next(
        new AppError("Primary supplier owner permission is required", {
          code: "SUPPLIER_OWNER_REQUIRED",
          statusCode: 403,
        }),
      );
    } catch (error) {
      next(error);
    }
  };
}
