import { UserRole, type PrismaClient } from "@prisma/client";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import type { Env } from "../../config/env.js";
import {
  createAuthenticateMiddleware,
  requireActiveSupplierAccess,
  requireRoles,
} from "../../middleware/authenticate.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { createSupplierController } from "./supplier.controller.js";
import {
  acceptInvitationSchema,
  businessIdParamsSchema,
  createBusinessSchema,
  createLocationSchema,
  createOwnerAccountSchema,
  disableBusinessSchema,
  invitationParamsSchema,
  inviteOwnerSchema,
  listBusinessQuerySchema,
  locationParamsSchema,
  memberParamsSchema,
  resetMemberTemporaryPasswordSchema,
  supportedCategoriesSchema,
  suspendBusinessSchema,
  updateBusinessSchema,
  updateLocationSchema,
  updateMemberAccountStatusSchema,
} from "./supplier.schemas.js";
import type { SupplierService } from "./supplier.service.js";

function acceptanceRateLimit(env: Env) {
  return rateLimit({
    windowMs: 30 * 60_000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => !env.RATE_LIMIT_ENABLED,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests. Please try again later.",
          details: [],
        },
        requestId: req.requestId,
      });
    },
  });
}

export function createSupplierAdminRouter(
  database: PrismaClient,
  env: Env,
  service: SupplierService,
) {
  const router = Router();
  const controller = createSupplierController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.ADMIN, UserRole.SUPER_ADMIN));

  router.post(
    "/",
    validateRequest({ body: createBusinessSchema }),
    controller.createBusiness,
  );
  router.get(
    "/",
    validateRequest({ query: listBusinessQuerySchema }),
    controller.listBusinesses,
  );
  router.get(
    "/:businessId",
    validateRequest({ params: businessIdParamsSchema }),
    controller.getBusiness,
  );
  router.patch(
    "/:businessId",
    validateRequest({ params: businessIdParamsSchema, body: updateBusinessSchema }),
    controller.updateBusiness,
  );
  router.post(
    "/:businessId/owner-account",
    validateRequest({
      params: businessIdParamsSchema,
      body: createOwnerAccountSchema,
    }),
    controller.createOwnerAccount,
  );
  router.post(
    "/:businessId/members/:membershipId/account-status",
    validateRequest({
      params: memberParamsSchema,
      body: updateMemberAccountStatusSchema,
    }),
    controller.updateMemberAccountStatus,
  );
  router.post(
    "/:businessId/members/:membershipId/temporary-password",
    validateRequest({
      params: memberParamsSchema,
      body: resetMemberTemporaryPasswordSchema,
    }),
    controller.resetMemberTemporaryPassword,
  );
  router.put(
    "/:businessId/supported-categories",
    validateRequest({
      params: businessIdParamsSchema,
      body: supportedCategoriesSchema,
    }),
    controller.setSupportedCategories,
  );
  router.post(
    "/:businessId/locations",
    validateRequest({ params: businessIdParamsSchema, body: createLocationSchema }),
    controller.createLocation,
  );
  router.patch(
    "/:businessId/locations/:locationId",
    validateRequest({ params: locationParamsSchema, body: updateLocationSchema }),
    controller.updateLocation,
  );
  router.delete(
    "/:businessId/locations/:locationId",
    validateRequest({ params: locationParamsSchema }),
    controller.deactivateLocation,
  );
  router.post(
    "/:businessId/invitations/owner",
    validateRequest({ params: businessIdParamsSchema, body: inviteOwnerSchema }),
    controller.inviteOwner,
  );
  router.get(
    "/:businessId/invitations",
    validateRequest({ params: businessIdParamsSchema }),
    controller.listInvitations,
  );
  router.get(
    "/:businessId/invitations/:invitationId",
    validateRequest({ params: invitationParamsSchema }),
    controller.getInvitation,
  );
  router.post(
    "/:businessId/invitations/:invitationId/resend",
    validateRequest({ params: invitationParamsSchema }),
    controller.resendInvitation,
  );
  router.post(
    "/:businessId/invitations/:invitationId/revoke",
    validateRequest({ params: invitationParamsSchema }),
    controller.revokeInvitation,
  );
  router.post(
    "/:businessId/status/submit-review",
    validateRequest({ params: businessIdParamsSchema }),
    controller.submitForReview,
  );
  router.post(
    "/:businessId/status/activate",
    validateRequest({ params: businessIdParamsSchema }),
    controller.activateBusiness,
  );
  router.post(
    "/:businessId/status/suspend",
    validateRequest({ params: businessIdParamsSchema, body: suspendBusinessSchema }),
    controller.suspendBusiness,
  );
  router.post(
    "/:businessId/status/disable",
    validateRequest({ params: businessIdParamsSchema, body: disableBusinessSchema }),
    controller.disableBusiness,
  );
  return router;
}

export function createSupplierSelfRouter(
  database: PrismaClient,
  env: Env,
  service: SupplierService,
) {
  const router = Router();
  const controller = createSupplierController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.SUPPLIER_OWNER, UserRole.SUPPLIER_STAFF));
  router.use(requireActiveSupplierAccess(database));
  router.get("/", controller.getOwnBusiness);
  return router;
}

export function createSupplierInvitationRouter(env: Env, service: SupplierService) {
  const router = Router();
  const controller = createSupplierController(service);
  router.post(
    "/accept",
    acceptanceRateLimit(env),
    validateRequest({ body: acceptInvitationSchema }),
    controller.acceptInvitation,
  );
  return router;
}
