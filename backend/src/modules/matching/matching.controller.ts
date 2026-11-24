import type { Request, Response } from "express";
import { sendSuccess } from "../../shared/utils/response.js";
import { streamAttachment } from "../../shared/utils/stream-attachment.js";
import type { MatchingService } from "./matching.service.js";

function userId(req: Request) {
  if (!req.auth) throw new Error("Authentication context is missing");
  return req.auth.id;
}

function supplierAccess(req: Request) {
  if (!req.supplierAccess) throw new Error("Supplier access context is missing");
  return req.supplierAccess;
}

function param(req: Request, name: string) {
  const value = req.params[name];
  if (typeof value !== "string") throw new Error(`Route parameter ${name} is missing`);
  return value;
}

export function createMatchingController(service: MatchingService) {
  return {
    suggestions: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.suggestSuppliers(param(req, "requestId")),
        200,
        req.requestId,
      );
    },
    distribute: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.distribute(
          param(req, "requestId"),
          req.body,
          userId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    listAssignments: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.listAdminAssignments(param(req, "requestId")),
        200,
        req.requestId,
      );
    },
    changeDeadline: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.changeDeadline(
          param(req, "requestId"),
          req.body.responseDeadlineAt,
          userId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    withdraw: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.withdrawAssignment(
          param(req, "requestId"),
          param(req, "assignmentId"),
          req.body.reason,
          userId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    replyClarification: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.replyClarification(
          param(req, "requestId"),
          param(req, "assignmentId"),
          param(req, "clarificationId"),
          req.body.reply,
          userId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    listInbox: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.listSupplierInbox(
          supplierAccess(req).businessId,
          req.query as never,
        ),
        200,
        req.requestId,
      );
    },
    getAssignment: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.getSupplierAssignment(
          supplierAccess(req).businessId,
          param(req, "assignmentId"),
        ),
        200,
        req.requestId,
      );
    },
    markViewed: async (req: Request, res: Response) => {
      const access = supplierAccess(req);
      sendSuccess(
        res,
        await service.markViewed(
          userId(req),
          access.membershipId,
          access.businessId,
          param(req, "assignmentId"),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    skip: async (req: Request, res: Response) => {
      const access = supplierAccess(req);
      sendSuccess(
        res,
        await service.skipAssignment(
          userId(req),
          access.membershipId,
          access.businessId,
          param(req, "assignmentId"),
          req.body.reason,
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    askClarification: async (req: Request, res: Response) => {
      const access = supplierAccess(req);
      sendSuccess(
        res,
        await service.askClarification(
          userId(req),
          access.membershipId,
          access.businessId,
          param(req, "assignmentId"),
          req.body.question,
          req.requestId,
        ),
        201,
        req.requestId,
      );
    },
    downloadAttachment: async (req: Request, res: Response) => {
      await streamAttachment(
        res,
        await service.readSupplierAttachment(
          supplierAccess(req).businessId,
          param(req, "assignmentId"),
          param(req, "attachmentId"),
        ),
      );
    },
  };
}
