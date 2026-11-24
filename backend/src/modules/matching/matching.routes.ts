import { UserRole, type PrismaClient } from "@prisma/client";
import { Router } from "express";
import type { Env } from "../../config/env.js";
import {
  createAuthenticateMiddleware,
  requireActiveSupplierAccess,
  requireRoles,
} from "../../middleware/authenticate.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { createMatchingController } from "./matching.controller.js";
import {
  askClarificationSchema,
  assignmentParamsSchema,
  changeDeadlineSchema,
  clarificationParamsSchema,
  distributeRequestSchema,
  matchingRequestParamsSchema,
  replyClarificationSchema,
  skipAssignmentSchema,
  supplierAssignmentParamsSchema,
  supplierAttachmentParamsSchema,
  supplierInboxQuerySchema,
  withdrawAssignmentSchema,
} from "./matching.schemas.js";
import type { MatchingService } from "./matching.service.js";

export function createAdminMatchingRouter(
  database: PrismaClient,
  env: Env,
  service: MatchingService,
) {
  const router = Router();
  const controller = createMatchingController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.ADMIN, UserRole.SUPER_ADMIN));
  router.get(
    "/:requestId/suggestions",
    validateRequest({ params: matchingRequestParamsSchema }),
    controller.suggestions,
  );
  router.post(
    "/:requestId/assignments",
    validateRequest({
      params: matchingRequestParamsSchema,
      body: distributeRequestSchema,
    }),
    controller.distribute,
  );
  router.get(
    "/:requestId/assignments",
    validateRequest({ params: matchingRequestParamsSchema }),
    controller.listAssignments,
  );
  router.patch(
    "/:requestId/response-deadline",
    validateRequest({
      params: matchingRequestParamsSchema,
      body: changeDeadlineSchema,
    }),
    controller.changeDeadline,
  );
  router.post(
    "/:requestId/assignments/:assignmentId/withdraw",
    validateRequest({
      params: assignmentParamsSchema,
      body: withdrawAssignmentSchema,
    }),
    controller.withdraw,
  );
  router.post(
    "/:requestId/assignments/:assignmentId/clarifications/:clarificationId/reply",
    validateRequest({
      params: clarificationParamsSchema,
      body: replyClarificationSchema,
    }),
    controller.replyClarification,
  );
  return router;
}

export function createSupplierInboxRouter(
  database: PrismaClient,
  env: Env,
  service: MatchingService,
) {
  const router = Router();
  const controller = createMatchingController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.SUPPLIER_OWNER, UserRole.SUPPLIER_STAFF));
  router.use(requireActiveSupplierAccess(database));
  router.get(
    "/",
    validateRequest({ query: supplierInboxQuerySchema }),
    controller.listInbox,
  );
  router.get(
    "/:assignmentId",
    validateRequest({ params: supplierAssignmentParamsSchema }),
    controller.getAssignment,
  );
  router.post(
    "/:assignmentId/view",
    validateRequest({ params: supplierAssignmentParamsSchema }),
    controller.markViewed,
  );
  router.post(
    "/:assignmentId/skip",
    validateRequest({
      params: supplierAssignmentParamsSchema,
      body: skipAssignmentSchema,
    }),
    controller.skip,
  );
  router.post(
    "/:assignmentId/clarifications",
    validateRequest({
      params: supplierAssignmentParamsSchema,
      body: askClarificationSchema,
    }),
    controller.askClarification,
  );
  router.get(
    "/:assignmentId/attachments/:attachmentId",
    validateRequest({ params: supplierAttachmentParamsSchema }),
    controller.downloadAttachment,
  );
  return router;
}
