import { UserRole, type PrismaClient } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import type { Env } from "../../config/env.js";
import {
  createAuthenticateMiddleware,
  requireActiveSupplierAccess,
  requireRoles,
  requireSupplierMembership,
  requireSupplierOwnerAccess,
} from "../../middleware/authenticate.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { createSubscriptionController } from "./subscription.controller.js";
import {
  categoryDecision,
  categoryRequestInput,
  categoryRequestList,
  complimentaryGrant,
  idParams,
  invoiceParams,
  issueInvoice,
  listInvoices,
  listPlans,
  listSubscriptions,
  paymentParams,
  planInput,
  planUpdate,
  reasonInput,
  recordPayment,
  reversePayment,
} from "./subscription.schemas.js";
import type { SubscriptionService } from "./subscription.service.js";

const dashboardQuery = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    timezone: z.literal("Asia/Dhaka").default("Asia/Dhaka"),
  })
  .refine(
    (value) =>
      value.from <= value.to &&
      value.to.getTime() - value.from.getTime() <= 93 * 86_400_000,
    "Use a range of at most 93 days",
  );

export function createAdminSubscriptionRouter(
  database: PrismaClient,
  env: Env,
  service: SubscriptionService,
) {
  const router = Router();
  const c = createSubscriptionController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.ADMIN, UserRole.SUPER_ADMIN));
  router.get("/dashboard", validateRequest({ query: dashboardQuery }), c.dashboard);
  router.get("/plans", validateRequest({ query: listPlans }), c.listPlans);
  router.post("/plans", validateRequest({ body: planInput }), c.createPlan);
  router.patch(
    "/plans/:id",
    validateRequest({ params: idParams, body: planUpdate }),
    c.updatePlan,
  );
  router.get("/", validateRequest({ query: listSubscriptions }), c.listSubscriptions);
  router.post(
    "/complimentary-grants",
    requireRoles(database, UserRole.SUPER_ADMIN),
    validateRequest({ body: complimentaryGrant }),
    c.grantComplimentary,
  );
  router.post(
    "/:id/suspend",
    validateRequest({ params: idParams, body: reasonInput }),
    c.suspend,
  );
  router.post(
    "/:id/reactivate",
    validateRequest({ params: idParams, body: reasonInput }),
    c.reactivate,
  );
  router.post(
    "/:id/cancel",
    validateRequest({ params: idParams, body: reasonInput }),
    c.cancel,
  );
  router.get("/invoices", validateRequest({ query: listInvoices }), c.listInvoices);
  router.post("/invoices", validateRequest({ body: issueInvoice }), c.issueInvoice);
  router.get(
    "/invoices/:invoiceId",
    validateRequest({ params: invoiceParams }),
    c.getInvoice,
  );
  router.get(
    "/invoices/:invoiceId/pdf",
    validateRequest({ params: invoiceParams }),
    c.invoicePdf,
  );
  router.post(
    "/invoices/:invoiceId/payments",
    validateRequest({ params: invoiceParams, body: recordPayment }),
    c.recordPayment,
  );
  router.post(
    "/invoices/:invoiceId/void",
    validateRequest({ params: invoiceParams, body: reasonInput }),
    c.voidInvoice,
  );
  router.post(
    "/payments/:paymentId/reversals",
    validateRequest({ params: paymentParams, body: reversePayment }),
    c.reversePayment,
  );
  return router;
}

export function createSupplierSubscriptionRouter(
  database: PrismaClient,
  env: Env,
  service: SubscriptionService,
) {
  const router = Router();
  const c = createSubscriptionController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.SUPPLIER_OWNER, UserRole.SUPPLIER_STAFF));
  router.use(requireSupplierMembership(database));
  router.get("/current", c.supplierCurrent);
  router.get(
    "/invoices",
    requireSupplierOwnerAccess(database),
    validateRequest({ query: listInvoices }),
    c.supplierInvoices,
  );
  router.get(
    "/invoices/:invoiceId",
    requireSupplierOwnerAccess(database),
    validateRequest({ params: invoiceParams }),
    c.supplierInvoice,
  );
  router.get(
    "/invoices/:invoiceId/pdf",
    requireSupplierOwnerAccess(database),
    validateRequest({ params: invoiceParams }),
    c.supplierInvoicePdf,
  );
  router.get(
    "/category-requests",
    requireActiveSupplierAccess(database),
    validateRequest({ query: categoryRequestList }),
    c.supplierCategoryRequests,
  );
  router.post(
    "/category-requests",
    requireActiveSupplierAccess(database),
    validateRequest({ body: categoryRequestInput }),
    c.createCategoryRequest,
  );
  return router;
}

export function createAdminCategoryRequestRouter(
  database: PrismaClient,
  env: Env,
  service: SubscriptionService,
) {
  const router = Router();
  const c = createSubscriptionController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.ADMIN, UserRole.SUPER_ADMIN));
  router.get(
    "/category-requests",
    validateRequest({ query: categoryRequestList }),
    c.adminCategoryRequests,
  );
  router.post(
    "/category-requests/:id/decision",
    validateRequest({ params: idParams, body: categoryDecision }),
    c.decideCategoryRequest,
  );
  return router;
}
