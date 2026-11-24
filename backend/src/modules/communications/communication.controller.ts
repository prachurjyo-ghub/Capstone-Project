import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/utils/response.js";
import { streamAttachment } from "../../shared/utils/stream-attachment.js";
import type { CommunicationService } from "./communication.service.js";

function auth(req: Request) {
  if (!req.auth) throw new Error("Authentication context is missing");
  return req.auth;
}
const param = (req: Request, key: string) => {
  const value = req.params[key];
  if (typeof value !== "string") throw new Error(`${key} is missing`);
  return value;
};
const business = (req: Request) => req.header("x-business-id") ?? undefined;

export function createCommunicationController(service: CommunicationService) {
  return {
    ensure: async (req: Request, res: Response) => {
      const actor = auth(req);
      sendSuccess(
        res,
        await service.ensureConversation(actor.id, actor.role, business(req), req.body),
        200,
        req.requestId,
      );
    },
    list: async (req: Request, res: Response) => {
      const actor = auth(req);
      sendSuccess(
        res,
        await service.listConversations(
          actor.id,
          actor.role,
          business(req),
          req.query as never,
        ),
        200,
        req.requestId,
      );
    },
    get: async (req: Request, res: Response) => {
      const actor = auth(req);
      sendSuccess(
        res,
        await service.getConversation(
          actor.id,
          actor.role,
          business(req),
          param(req, "id"),
        ),
        200,
        req.requestId,
      );
    },
    messages: async (req: Request, res: Response) => {
      const actor = auth(req);
      sendSuccess(
        res,
        await service.listMessages(
          actor.id,
          actor.role,
          business(req),
          param(req, "id"),
          req.query as never,
        ),
        200,
        req.requestId,
      );
    },
    send: async (req: Request, res: Response) => {
      const actor = auth(req);
      sendSuccess(
        res,
        await service.sendMessage(
          actor.id,
          actor.role,
          business(req),
          param(req, "id"),
          req.body,
        ),
        201,
        req.requestId,
      );
    },
    read: async (req: Request, res: Response) => {
      const actor = auth(req);
      sendSuccess(
        res,
        await service.markRead(
          actor.id,
          actor.role,
          business(req),
          param(req, "id"),
          req.body.messageId,
        ),
        200,
        req.requestId,
      );
    },
    upload: async (req: Request, res: Response) => {
      if (!Buffer.isBuffer(req.body))
        throw new AppError("An image request body is required", {
          code: "INVALID_MESSAGE_ATTACHMENT",
          statusCode: 400,
        });
      const actor = auth(req);
      sendSuccess(
        res,
        await service.uploadAttachment(
          actor.id,
          actor.role,
          business(req),
          param(req, "id"),
          param(req, "messageId"),
          req.body,
          req.header("x-file-name"),
        ),
        201,
        req.requestId,
      );
    },
    download: async (req: Request, res: Response) => {
      const actor = auth(req);
      const attachment = await service.readAttachment(
        actor.id,
        actor.role,
        business(req),
        param(req, "id"),
        param(req, "messageId"),
        param(req, "attachmentId"),
      );
      await streamAttachment(res, attachment);
    },
    notifications: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.listNotifications(auth(req).id, req.query as never),
        200,
        req.requestId,
      );
    },
    readNotification: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.markNotificationRead(auth(req).id, param(req, "id")),
        200,
        req.requestId,
      );
    },
    readAllNotifications: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.markAllNotificationsRead(auth(req).id),
        200,
        req.requestId,
      );
    },
  };
}
