import express, { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Env } from "../../config/env.js";
import { createAuthenticateMiddleware } from "../../middleware/authenticate.js";
import { validateRequest } from "../../middleware/validate-request.js";
import type { RequestAttachmentStorage } from "../requests/attachment-storage.js";
import { MAX_REQUEST_PHOTO_BYTES } from "../requests/image-validation.js";
import { createCommunicationController } from "./communication.controller.js";
import { createCommunicationRateLimits } from "./communication.rate-limit.js";
import {
  attachmentParamsSchema,
  conversationIdSchema,
  conversationListSchema,
  createConversationSchema,
  markReadSchema,
  messageListSchema,
  messageParamsSchema,
  notificationListSchema,
  sendMessageSchema,
} from "./communication.schemas.js";
import { CommunicationService } from "./communication.service.js";

export function createCommunicationRouter(
  database: PrismaClient,
  env: Env,
  storage: RequestAttachmentStorage,
) {
  const router = Router();
  const controller = createCommunicationController(
    new CommunicationService(database, storage),
  );
  const limits = createCommunicationRateLimits(env);
  router.use(createAuthenticateMiddleware(database, env));
  router.get(
    "/conversations",
    validateRequest({ query: conversationListSchema }),
    controller.list,
  );
  router.post(
    "/conversations",
    validateRequest({ body: createConversationSchema }),
    controller.ensure,
  );
  router.get(
    "/conversations/:id",
    validateRequest({ params: conversationIdSchema }),
    controller.get,
  );
  router.get(
    "/conversations/:id/messages",
    validateRequest({ params: conversationIdSchema, query: messageListSchema }),
    controller.messages,
  );
  router.post(
    "/conversations/:id/messages",
    limits.send,
    validateRequest({ params: conversationIdSchema, body: sendMessageSchema }),
    controller.send,
  );
  router.post(
    "/conversations/:id/read",
    validateRequest({ params: conversationIdSchema, body: markReadSchema }),
    controller.read,
  );
  router.post(
    "/conversations/:id/messages/:messageId/attachments",
    limits.upload,
    express.raw({
      type: ["image/jpeg", "image/png", "application/octet-stream"],
      limit: MAX_REQUEST_PHOTO_BYTES,
    }),
    validateRequest({ params: messageParamsSchema }),
    controller.upload,
  );
  router.get(
    "/conversations/:id/messages/:messageId/attachments/:attachmentId",
    validateRequest({ params: attachmentParamsSchema }),
    controller.download,
  );
  router.get(
    "/notifications",
    validateRequest({ query: notificationListSchema }),
    controller.notifications,
  );
  router.post(
    "/notifications/read-all",
    validateRequest({ body: markReadSchema }),
    controller.readAllNotifications,
  );
  router.post(
    "/notifications/:id/read",
    validateRequest({ params: conversationIdSchema, body: markReadSchema }),
    controller.readNotification,
  );
  return router;
}
