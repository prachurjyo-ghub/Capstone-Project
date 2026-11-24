import type { Request, Response } from "express";
import { sendSuccess } from "../../shared/utils/response.js";
import type { CommerceService } from "./commerce.service.js";

const param = (req: Request, key: string) => {
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

export function createCommerceController(service: CommerceService) {
  return {
    createQuote: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.createQuotation(user(req), business(req), req.body, req.requestId),
        201,
        req.requestId,
      ),
    listQuotes: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.listSupplierQuotations(business(req), req.query as never),
        200,
        req.requestId,
      ),
    getQuote: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.getSupplierQuotation(business(req), param(req, "id")),
        200,
        req.requestId,
      ),
    updateQuote: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.updateQuotation(
          user(req),
          business(req),
          param(req, "id"),
          req.body,
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    submitQuote: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.submitQuotation(
          user(req),
          business(req),
          param(req, "id"),
          req.body.idempotencyKey,
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    reviseQuote: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.createRevision(
          user(req),
          business(req),
          param(req, "id"),
          req.requestId,
        ),
        201,
        req.requestId,
      ),
    withdrawQuote: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.withdrawQuotation(
          user(req),
          business(req),
          param(req, "id"),
          req.body.reason,
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    replySupplierClarification: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.replySupplierClarification(
          user(req),
          business(req),
          param(req, "id"),
          param(req, "clarificationId"),
          req.body.reply,
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    comparison: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.getAdminComparison(param(req, "requestId")),
        200,
        req.requestId,
      ),
    adminQuote: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.getAdminQuotation(param(req, "id")),
        200,
        req.requestId,
      ),
    askSupplier: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.askSupplierClarification(
          user(req),
          param(req, "id"),
          req.body.question,
          req.requestId,
        ),
        201,
        req.requestId,
      ),
    rejectQuote: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.rejectQuotation(
          user(req),
          param(req, "id"),
          req.body.reason,
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    prepareOption: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.prepareOption(
          user(req),
          param(req, "requestId"),
          req.body,
          req.requestId,
        ),
        201,
        req.requestId,
      ),
    adminOption: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.getAdminOption(param(req, "id")),
        200,
        req.requestId,
      ),
    publishOption: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.publishOption(
          user(req),
          param(req, "id"),
          req.body.expectedVersion,
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    withdrawOption: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.withdrawOption(
          user(req),
          param(req, "id"),
          req.body.reason,
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    replyCustomer: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.replyCustomerClarification(
          user(req),
          param(req, "id"),
          param(req, "clarificationId"),
          req.body.reply,
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    listCustomerOptions: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.listCustomerOptions(
          user(req),
          param(req, "requestId"),
          req.query as never,
        ),
        200,
        req.requestId,
      ),
    listCustomerOptionsBatch: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.listCustomerOptionsBatch(user(req), req.query as never),
        200,
        req.requestId,
      ),
    customerOption: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.getCustomerOption(user(req), param(req, "id")),
        200,
        req.requestId,
      ),
    askCustomer: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.askCustomerClarification(
          user(req),
          param(req, "id"),
          req.body.question,
          req.requestId,
        ),
        201,
        req.requestId,
      ),
    rejectOption: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.rejectCustomerOption(
          user(req),
          param(req, "id"),
          req.body.reason,
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    acceptOption: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.acceptOption(user(req), param(req, "id"), req.body, req.requestId),
        201,
        req.requestId,
      ),
  };
}
