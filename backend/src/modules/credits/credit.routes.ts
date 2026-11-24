import { UserRole, type PrismaClient } from "@prisma/client";
import { Router } from "express";
import type { Env } from "../../config/env.js";
import {
  createAuthenticateMiddleware,
  requireActiveSupplierAccess,
  requireRoles,
  requireSupplierOwnerAccess,
} from "../../middleware/authenticate.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { createCreditController } from "./credit.controller.js";
import {
  adjustmentInput,
  businessParams,
  idParams,
  orderParams,
  pagination,
  policyInput,
  reservationList,
  reversalInput,
  topUpDecision,
  topUpInput,
  topUpList,
  walletList,
} from "./credit.schemas.js";
import type { CreditService } from "./credit.service.js";

export function createAdminCreditRouter(
  database: PrismaClient,
  env: Env,
  service: CreditService,
) {
  const router = Router();
  const controller = createCreditController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.ADMIN, UserRole.SUPER_ADMIN));
  router.get("/overview", controller.overview);
  router.get(
    "/reconciliation",
    requireRoles(database, UserRole.SUPER_ADMIN),
    validateRequest({ query: pagination }),
    controller.reconciliation,
  );
  router.get("/policy", controller.policy);
  router.post(
    "/policy",
    requireRoles(database, UserRole.SUPER_ADMIN),
    validateRequest({ body: policyInput }),
    controller.setPolicy,
  );
  router.get("/wallets", validateRequest({ query: walletList }), controller.wallets);
  router.get(
    "/wallets/:businessId",
    validateRequest({ params: businessParams }),
    controller.wallet,
  );
  router.post(
    "/wallets/:businessId/adjustments",
    requireRoles(database, UserRole.SUPER_ADMIN),
    validateRequest({ params: businessParams, body: adjustmentInput }),
    controller.adjust,
  );
  router.get("/top-ups", validateRequest({ query: topUpList }), controller.topUps);
  router.post(
    "/top-ups/:id/decision",
    validateRequest({ params: idParams, body: topUpDecision }),
    controller.decideTopUp,
  );
  router.get(
    "/reservations",
    validateRequest({ query: reservationList }),
    controller.reservations,
  );
  router.post(
    "/orders/:orderId/commission-reversal",
    requireRoles(database, UserRole.SUPER_ADMIN),
    validateRequest({ params: orderParams, body: reversalInput }),
    controller.reverse,
  );
  return router;
}

export function createSupplierCreditRouter(
  database: PrismaClient,
  env: Env,
  service: CreditService,
) {
  const router = Router();
  const controller = createCreditController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.SUPPLIER_OWNER, UserRole.SUPPLIER_STAFF));
  router.use(requireActiveSupplierAccess(database));
  router.get("/wallet", controller.supplierWallet);
  router.post(
    "/top-ups",
    requireSupplierOwnerAccess(database),
    validateRequest({ body: topUpInput }),
    controller.submitTopUp,
  );
  return router;
}
