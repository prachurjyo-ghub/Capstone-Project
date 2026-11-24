import { UserRole, type PrismaClient } from "@prisma/client";
import { Router } from "express";
import type { Env } from "../../config/env.js";
import {
  createAuthenticateMiddleware,
  requireActiveSupplierAccess,
  requireRoles,
} from "../../middleware/authenticate.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { createCommerceController } from "./commerce.controller.js";
import {
  acceptOptionSchema,
  clarificationReplySchema,
  clarificationSchema,
  customerOptionBatchSchema,
  customerOptionListSchema,
  idParamsSchema,
  optionClarificationParamsSchema,
  prepareOptionSchema,
  publishOptionSchema,
  quotationClarificationParamsSchema,
  quotationListSchema,
  quotationUpdateSchema,
  quotationWriteSchema,
  rejectionSchema,
  requestIdParamsSchema,
  submitQuotationSchema,
  withdrawSchema,
} from "./commerce.schemas.js";
import type { CommerceService } from "./commerce.service.js";

export function createSupplierCommerceRouter(
  database: PrismaClient,
  env: Env,
  service: CommerceService,
) {
  const r = Router();
  const c = createCommerceController(service);
  r.use(createAuthenticateMiddleware(database, env));
  r.use(requireRoles(database, UserRole.SUPPLIER_OWNER, UserRole.SUPPLIER_STAFF));
  r.use(requireActiveSupplierAccess(database));
  r.get("/", validateRequest({ query: quotationListSchema }), c.listQuotes);
  r.post("/", validateRequest({ body: quotationWriteSchema }), c.createQuote);
  r.get("/:id", validateRequest({ params: idParamsSchema }), c.getQuote);
  r.patch(
    "/:id",
    validateRequest({ params: idParamsSchema, body: quotationUpdateSchema }),
    c.updateQuote,
  );
  r.post(
    "/:id/submit",
    validateRequest({ params: idParamsSchema, body: submitQuotationSchema }),
    c.submitQuote,
  );
  r.post("/:id/revisions", validateRequest({ params: idParamsSchema }), c.reviseQuote);
  r.post(
    "/:id/withdraw",
    validateRequest({ params: idParamsSchema, body: withdrawSchema }),
    c.withdrawQuote,
  );
  r.post(
    "/:id/clarifications/:clarificationId/reply",
    validateRequest({
      params: quotationClarificationParamsSchema,
      body: clarificationReplySchema,
    }),
    c.replySupplierClarification,
  );
  return r;
}

export function createAdminCommerceRouter(
  database: PrismaClient,
  env: Env,
  service: CommerceService,
) {
  const r = Router();
  const c = createCommerceController(service);
  r.use(createAuthenticateMiddleware(database, env));
  r.use(requireRoles(database, UserRole.ADMIN, UserRole.SUPER_ADMIN));
  r.get(
    "/requests/:requestId/quotation-comparison",
    validateRequest({ params: requestIdParamsSchema }),
    c.comparison,
  );
  r.post(
    "/requests/:requestId/options",
    validateRequest({ params: requestIdParamsSchema, body: prepareOptionSchema }),
    c.prepareOption,
  );
  r.get("/quotations/:id", validateRequest({ params: idParamsSchema }), c.adminQuote);
  r.post(
    "/quotations/:id/clarifications",
    validateRequest({ params: idParamsSchema, body: clarificationSchema }),
    c.askSupplier,
  );
  r.post(
    "/quotations/:id/reject",
    validateRequest({ params: idParamsSchema, body: rejectionSchema }),
    c.rejectQuote,
  );
  r.get("/options/:id", validateRequest({ params: idParamsSchema }), c.adminOption);
  r.post(
    "/options/:id/publish",
    validateRequest({ params: idParamsSchema, body: publishOptionSchema }),
    c.publishOption,
  );
  r.post(
    "/options/:id/withdraw",
    validateRequest({ params: idParamsSchema, body: withdrawSchema }),
    c.withdrawOption,
  );
  r.post(
    "/options/:id/clarifications/:clarificationId/reply",
    validateRequest({
      params: optionClarificationParamsSchema,
      body: clarificationReplySchema,
    }),
    c.replyCustomer,
  );
  return r;
}

export function createCustomerCommerceRouter(
  database: PrismaClient,
  env: Env,
  service: CommerceService,
) {
  const r = Router();
  const c = createCommerceController(service);
  r.use(createAuthenticateMiddleware(database, env));
  r.use(requireRoles(database, UserRole.CUSTOMER));
  r.get(
    "/requests/:requestId/options",
    validateRequest({ params: requestIdParamsSchema, query: customerOptionListSchema }),
    c.listCustomerOptions,
  );
  r.get(
    "/options",
    validateRequest({ query: customerOptionBatchSchema }),
    c.listCustomerOptionsBatch,
  );
  r.get("/options/:id", validateRequest({ params: idParamsSchema }), c.customerOption);
  r.post(
    "/options/:id/clarifications",
    validateRequest({ params: idParamsSchema, body: clarificationSchema }),
    c.askCustomer,
  );
  r.post(
    "/options/:id/reject",
    validateRequest({ params: idParamsSchema, body: rejectionSchema }),
    c.rejectOption,
  );
  r.post(
    "/options/:id/accept",
    validateRequest({ params: idParamsSchema, body: acceptOptionSchema }),
    c.acceptOption,
  );
  return r;
}
