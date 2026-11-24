import { UserRole, type PrismaClient } from "@prisma/client";
import { Router } from "express";
import type { Env } from "../../config/env.js";
import {
  createAuthenticateMiddleware,
  requireActiveSupplierAccess,
  requireRoles,
} from "../../middleware/authenticate.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { createFulfillmentController } from "./fulfillment.controller.js";
import {
  acceptanceParamsSchema,
  adminTransitionSchema,
  cancellationDecisionSchema,
  cancellationParamsSchema,
  cancellationRequestSchema,
  conversionSchema,
  failureSchema,
  orderIdParamsSchema,
  orderListSchema,
  returnDecisionSchema,
  returnInspectionSchema,
  returnParamsSchema,
  returnReceiptSchema,
  returnRequestSchema,
  supplierAvailabilitySchema,
  supplierTransitionSchema,
  urgentEligibilitySchema,
} from "./fulfillment.schemas.js";
import type { FulfillmentService } from "./fulfillment.service.js";

export function createAdminFulfillmentRouter(
  database: PrismaClient,
  env: Env,
  service: FulfillmentService,
) {
  const router = Router();
  const controller = createFulfillmentController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.ADMIN, UserRole.SUPER_ADMIN));
  router.post(
    "/acceptances/:acceptanceId/orders",
    validateRequest({ params: acceptanceParamsSchema, body: conversionSchema }),
    controller.convert,
  );
  router.get(
    "/orders",
    validateRequest({ query: orderListSchema }),
    controller.listAdmin,
  );
  router.get(
    "/orders/:id",
    validateRequest({ params: orderIdParamsSchema }),
    controller.getAdmin,
  );
  router.post(
    "/orders/:id/transitions",
    validateRequest({ params: orderIdParamsSchema, body: adminTransitionSchema }),
    controller.adminTransition,
  );
  router.post(
    "/orders/:id/cancellations/:cancellationId/decision",
    validateRequest({
      params: cancellationParamsSchema,
      body: cancellationDecisionSchema,
    }),
    controller.decideCancellation,
  );
  router.post(
    "/orders/:id/failures",
    validateRequest({ params: orderIdParamsSchema, body: failureSchema }),
    controller.failure,
  );
  router.post(
    "/orders/:id/returns/:returnId/decision",
    validateRequest({ params: returnParamsSchema, body: returnDecisionSchema }),
    controller.decideReturn,
  );
  router.post(
    "/orders/:id/returns/:returnId/receive",
    validateRequest({ params: returnParamsSchema, body: returnReceiptSchema }),
    controller.receiveReturn,
  );
  router.post(
    "/orders/:id/returns/:returnId/inspect",
    validateRequest({ params: returnParamsSchema, body: returnInspectionSchema }),
    controller.inspectReturn,
  );
  router.post(
    "/orders/:id/urgent-eligibility",
    validateRequest({ params: orderIdParamsSchema, body: urgentEligibilitySchema }),
    controller.urgent,
  );
  return router;
}

export function createSupplierFulfillmentRouter(
  database: PrismaClient,
  env: Env,
  service: FulfillmentService,
) {
  const router = Router();
  const controller = createFulfillmentController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.SUPPLIER_OWNER, UserRole.SUPPLIER_STAFF));
  router.use(requireActiveSupplierAccess(database));
  router.get("/", validateRequest({ query: orderListSchema }), controller.listSupplier);
  router.get(
    "/:id",
    validateRequest({ params: orderIdParamsSchema }),
    controller.getSupplier,
  );
  router.post(
    "/:id/availability",
    validateRequest({ params: orderIdParamsSchema, body: supplierAvailabilitySchema }),
    controller.availability,
  );
  router.post(
    "/:id/transitions",
    validateRequest({ params: orderIdParamsSchema, body: supplierTransitionSchema }),
    controller.supplierTransition,
  );
  return router;
}

export function createCustomerFulfillmentRouter(
  database: PrismaClient,
  env: Env,
  service: FulfillmentService,
) {
  const router = Router();
  const controller = createFulfillmentController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.CUSTOMER));
  router.get("/", validateRequest({ query: orderListSchema }), controller.listCustomer);
  router.get(
    "/:id",
    validateRequest({ params: orderIdParamsSchema }),
    controller.getCustomer,
  );
  router.post(
    "/:id/cancellations",
    validateRequest({ params: orderIdParamsSchema, body: cancellationRequestSchema }),
    controller.requestCancellation,
  );
  router.post(
    "/:id/returns",
    validateRequest({ params: orderIdParamsSchema, body: returnRequestSchema }),
    controller.requestReturn,
  );
  return router;
}
