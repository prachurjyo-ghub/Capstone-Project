import { UserRole, type PrismaClient } from "@prisma/client";
import express, { Router } from "express";
import type { Env } from "../../config/env.js";
import {
  createAuthenticateMiddleware,
  requireRoles,
} from "../../middleware/authenticate.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { MAX_REQUEST_PHOTO_BYTES } from "./image-validation.js";
import { createRequestController } from "./request.controller.js";
import {
  adminRequestListQuerySchema,
  attachmentQuerySchema,
  cancelRequestSchema,
  createRequestSchema,
  requestAttachmentParamsSchema,
  requestItemParamsSchema,
  requestItemSchema,
  requestListQuerySchema,
  requestParamsSchema,
  submitRequestSchema,
  updateRequestItemSchema,
  updateRequestSchema,
} from "./request.schemas.js";
import type { CustomerRequestService } from "./request.service.js";

export function createCustomerRequestRouter(
  database: PrismaClient,
  env: Env,
  service: CustomerRequestService,
) {
  const router = Router();
  const controller = createRequestController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.CUSTOMER));

  router.get(
    "/",
    validateRequest({ query: requestListQuerySchema }),
    controller.listCustomer,
  );
  router.post(
    "/",
    validateRequest({ body: createRequestSchema }),
    controller.createDraft,
  );
  router.get(
    "/:requestId",
    validateRequest({ params: requestParamsSchema }),
    controller.getCustomer,
  );
  router.patch(
    "/:requestId",
    validateRequest({ params: requestParamsSchema, body: updateRequestSchema }),
    controller.updateDraft,
  );
  router.post(
    "/:requestId/items",
    validateRequest({ params: requestParamsSchema, body: requestItemSchema }),
    controller.addItem,
  );
  router.patch(
    "/:requestId/items/:itemId",
    validateRequest({ params: requestItemParamsSchema, body: updateRequestItemSchema }),
    controller.updateItem,
  );
  router.delete(
    "/:requestId/items/:itemId",
    validateRequest({ params: requestItemParamsSchema }),
    controller.removeItem,
  );
  router.post(
    "/:requestId/attachments",
    express.raw({
      type: ["image/jpeg", "image/png", "application/octet-stream"],
      limit: MAX_REQUEST_PHOTO_BYTES,
    }),
    validateRequest({ params: requestParamsSchema, query: attachmentQuerySchema }),
    controller.addAttachment,
  );
  router.get(
    "/:requestId/attachments/:attachmentId",
    validateRequest({ params: requestAttachmentParamsSchema }),
    controller.downloadCustomerAttachment,
  );
  router.delete(
    "/:requestId/attachments/:attachmentId",
    validateRequest({ params: requestAttachmentParamsSchema }),
    controller.removeAttachment,
  );
  router.post(
    "/:requestId/submit",
    validateRequest({ params: requestParamsSchema, body: submitRequestSchema }),
    controller.submit,
  );
  router.post(
    "/:requestId/cancel",
    validateRequest({ params: requestParamsSchema, body: cancelRequestSchema }),
    controller.cancel,
  );
  return router;
}

export function createAdminRequestRouter(
  database: PrismaClient,
  env: Env,
  service: CustomerRequestService,
) {
  const router = Router();
  const controller = createRequestController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.ADMIN, UserRole.SUPER_ADMIN));
  router.get(
    "/",
    validateRequest({ query: adminRequestListQuerySchema }),
    controller.listAdmin,
  );
  router.get(
    "/:requestId",
    validateRequest({ params: requestParamsSchema }),
    controller.getAdmin,
  );
  router.get(
    "/:requestId/attachments/:attachmentId",
    validateRequest({ params: requestAttachmentParamsSchema }),
    controller.downloadAdminAttachment,
  );
  return router;
}
