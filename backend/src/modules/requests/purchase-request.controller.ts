import type { Request, Response } from "express";
import { sendSuccess } from "../../shared/utils/response.js";
import type { PurchaseRequestService } from "./purchase-request.service.js";

const userId = (req: Request) => {
  if (!req.auth) throw new Error("Authentication context is missing");
  return req.auth.id;
};
const businessId = (req: Request) => {
  if (!req.supplierAccess) throw new Error("Supplier access context is missing");
  return req.supplierAccess.businessId;
};
const requestParam = (req: Request) => {
  const value = req.params.requestId;
  if (typeof value !== "string") throw new Error("Request ID is missing");
  return value;
};

export function createPurchaseRequestController(service: PurchaseRequestService) {
  return {
    create: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.create(userId(req), req.body, req.requestId),
        201,
        req.requestId,
      ),
    listSupplier: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.listSupplier(businessId(req), req.query as never),
        200,
        req.requestId,
      ),
    confirm: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.confirm(
          businessId(req),
          requestParam(req),
          userId(req),
          req.requestId,
          req.body.note,
        ),
        200,
        req.requestId,
      ),
  };
}
