import type { Request, Response } from "express";
import { sendSuccess } from "../../shared/utils/response.js";
import type { FulfillmentService } from "./fulfillment.service.js";

const id = (req: Request, key = "id") => {
  const value = req.params[key];
  if (typeof value !== "string") throw new Error(`Missing ${key}`);
  return value;
};
const user = (req: Request) => {
  if (!req.auth) throw new Error("Missing authentication");
  return req.auth.id;
};
const business = (req: Request) => {
  if (!req.supplierAccess) throw new Error("Missing supplier access");
  return req.supplierAccess.businessId;
};

export function createFulfillmentController(service: FulfillmentService) {
  return {
    convert: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.convertAcceptance(
          id(req, "acceptanceId"),
          req.body.idempotencyKey,
          user(req),
          req.requestId,
        ),
        201,
        req.requestId,
      ),
    listAdmin: async (req: Request, res: Response) =>
      sendSuccess(res, await service.listAdmin(req.query as never), 200, req.requestId),
    getAdmin: async (req: Request, res: Response) =>
      sendSuccess(res, await service.getAdmin(id(req)), 200, req.requestId),
    adminTransition: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.adminTransition(id(req), req.body, user(req), req.requestId),
        200,
        req.requestId,
      ),
    decideCancellation: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.decideCancellation(
          id(req),
          id(req, "cancellationId"),
          req.body.decision,
          req.body.reason,
          user(req),
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    failure: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.reportFailure(
          id(req),
          req.body.code,
          req.body.reason,
          req.body.releaseReservations,
          user(req),
          req.requestId,
        ),
        201,
        req.requestId,
      ),
    decideReturn: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.decideReturn(
          id(req),
          id(req, "returnId"),
          req.body.decision,
          req.body.reason,
          req.body.refundRequired,
          user(req),
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    receiveReturn: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.receiveReturn(
          id(req),
          id(req, "returnId"),
          req.body.note,
          user(req),
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    inspectReturn: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.inspectReturn(
          id(req),
          id(req, "returnId"),
          req.body.note,
          req.body.restock,
          req.body.refundRequired,
          user(req),
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    urgent: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.updateUrgent(id(req), req.body, user(req), req.requestId),
        200,
        req.requestId,
      ),
    listSupplier: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.listSupplier(business(req), req.query as never),
        200,
        req.requestId,
      ),
    getSupplier: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.getSupplier(business(req), id(req)),
        200,
        req.requestId,
      ),
    availability: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.supplierAvailability(
          business(req),
          id(req),
          req.body.available,
          req.body.note,
          user(req),
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    supplierTransition: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.supplierTransition(
          business(req),
          id(req),
          req.body,
          user(req),
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    listCustomer: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.listCustomer(user(req), req.query as never),
        200,
        req.requestId,
      ),
    getCustomer: async (req: Request, res: Response) =>
      sendSuccess(res, await service.getCustomer(user(req), id(req)), 200, req.requestId),
    requestCancellation: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.requestCancellation(
          user(req),
          id(req),
          req.body.reason,
          req.requestId,
        ),
        201,
        req.requestId,
      ),
    requestReturn: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.requestReturn(user(req), id(req), req.body.reason, req.requestId),
        201,
        req.requestId,
      ),
  };
}
