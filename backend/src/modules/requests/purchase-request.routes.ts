import { UserRole, type PrismaClient } from "@prisma/client";
import { Router } from "express";
import type { Env } from "../../config/env.js";
import {
  createAuthenticateMiddleware,
  requireActiveSupplierAccess,
  requireRoles,
} from "../../middleware/authenticate.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { createPurchaseRequestController } from "./purchase-request.controller.js";
import {
  confirmPurchaseRequestSchema,
  createPurchaseRequestSchema,
  purchaseRequestParamsSchema,
  supplierPurchaseRequestListSchema,
} from "./purchase-request.schemas.js";
import type { PurchaseRequestService } from "./purchase-request.service.js";

export function createCustomerPurchaseRequestRouter(
  database: PrismaClient,
  env: Env,
  service: PurchaseRequestService,
) {
  const router = Router();
  const controller = createPurchaseRequestController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.CUSTOMER));
  router.post(
    "/",
    validateRequest({ body: createPurchaseRequestSchema }),
    controller.create,
  );
  return router;
}

export function createSupplierPurchaseRequestRouter(
  database: PrismaClient,
  env: Env,
  service: PurchaseRequestService,
) {
  const router = Router();
  const controller = createPurchaseRequestController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.SUPPLIER_OWNER, UserRole.SUPPLIER_STAFF));
  router.use(requireActiveSupplierAccess(database));
  router.get(
    "/",
    validateRequest({ query: supplierPurchaseRequestListSchema }),
    controller.listSupplier,
  );
  router.post(
    "/:requestId/confirm",
    validateRequest({
      params: purchaseRequestParamsSchema,
      body: confirmPurchaseRequestSchema,
    }),
    controller.confirm,
  );
  return router;
}
