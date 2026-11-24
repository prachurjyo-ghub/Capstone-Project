import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/utils/response.js";
import { streamAttachment } from "../../shared/utils/stream-attachment.js";
import type { CustomerRequestService } from "./request.service.js";

function userId(req: Request): string {
  if (!req.auth) throw new Error("Authentication context is missing");
  return req.auth.id;
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string") throw new Error(`Route parameter ${name} is missing`);
  return value;
}

export function createRequestController(service: CustomerRequestService) {
  return {
    createDraft: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.createDraft(userId(req), req.body, req.requestId),
        201,
        req.requestId,
      );
    },
    listCustomer: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.listCustomerRequests(userId(req), req.query as never),
        200,
        req.requestId,
      );
    },
    getCustomer: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.getCustomerRequest(userId(req), param(req, "requestId")),
        200,
        req.requestId,
      );
    },
    updateDraft: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.updateDraft(
          userId(req),
          param(req, "requestId"),
          req.body,
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    addItem: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.addItem(
          userId(req),
          param(req, "requestId"),
          req.body,
          req.requestId,
        ),
        201,
        req.requestId,
      );
    },
    updateItem: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.updateItem(
          userId(req),
          param(req, "requestId"),
          param(req, "itemId"),
          req.body,
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    removeItem: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.removeItem(
          userId(req),
          param(req, "requestId"),
          param(req, "itemId"),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    addAttachment: async (req: Request, res: Response) => {
      if (!Buffer.isBuffer(req.body)) {
        throw new AppError("An image request body is required", {
          code: "INVALID_REQUEST_PHOTO",
          statusCode: 400,
        });
      }
      sendSuccess(
        res,
        await service.addAttachment(
          userId(req),
          param(req, "requestId"),
          (req.query as { requestItemId?: string }).requestItemId,
          req.body,
          req.header("x-file-name"),
          req.requestId,
        ),
        201,
        req.requestId,
      );
    },
    removeAttachment: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.removeAttachment(
          userId(req),
          param(req, "requestId"),
          param(req, "attachmentId"),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    downloadCustomerAttachment: async (req: Request, res: Response) => {
      await streamAttachment(
        res,
        await service.readAttachment(
          { kind: "CUSTOMER", userId: userId(req) },
          param(req, "requestId"),
          param(req, "attachmentId"),
        ),
      );
    },
    submit: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.submit(
          userId(req),
          param(req, "requestId"),
          req.body.idempotencyKey,
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    cancel: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.cancel(
          userId(req),
          param(req, "requestId"),
          req.body.reason,
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    listAdmin: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.listAdminRequests(req.query as never),
        200,
        req.requestId,
      );
    },
    getAdmin: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.getAdminRequest(param(req, "requestId")),
        200,
        req.requestId,
      );
    },
    downloadAdminAttachment: async (req: Request, res: Response) => {
      await streamAttachment(
        res,
        await service.readAttachment(
          { kind: "ADMIN", userId: userId(req) },
          param(req, "requestId"),
          param(req, "attachmentId"),
        ),
      );
    },
  };
}
