import type { Request, Response } from "express";
import { sendSuccess } from "../../shared/utils/response.js";
import type { SubscriptionService } from "./subscription.service.js";

const user = (req: Request) => {
  if (!req.auth) throw new Error("Authentication context is missing");
  return req.auth.id;
};
const business = (req: Request) => {
  if (!req.supplierAccess) throw new Error("Supplier access context is missing");
  return req.supplierAccess.businessId;
};
const param = (req: Request, key: string) => {
  const value = req.params[key];
  if (typeof value !== "string") throw new Error(`Missing ${key}`);
  return value;
};
const download = (res: Response, document: { filename: string; bytes: Buffer }) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${document.filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).send(document.bytes);
};

export function createSubscriptionController(service: SubscriptionService) {
  return {
    createPlan: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.createPlan(req.body, user(req), req.requestId),
        201,
        req.requestId,
      ),
    listPlans: async (req: Request, res: Response) =>
      sendSuccess(res, await service.listPlans(req.query as never), 200, req.requestId),
    updatePlan: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.updatePlan(param(req, "id"), req.body, user(req), req.requestId),
        200,
        req.requestId,
      ),
    issueInvoice: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.issueInvoice(req.body, user(req), req.requestId),
        201,
        req.requestId,
      ),
    listInvoices: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.listInvoices(req.query as never),
        200,
        req.requestId,
      ),
    supplierInvoices: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.listInvoices(req.query as never, business(req)),
        200,
        req.requestId,
      ),
    supplierCurrent: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.getSupplierCurrent(business(req)),
        200,
        req.requestId,
      ),
    getInvoice: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.getInvoice(param(req, "invoiceId")),
        200,
        req.requestId,
      ),
    supplierInvoice: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.getInvoice(param(req, "invoiceId"), business(req)),
        200,
        req.requestId,
      ),
    invoicePdf: async (req: Request, res: Response) =>
      download(res, await service.invoicePdf(param(req, "invoiceId"))),
    supplierInvoicePdf: async (req: Request, res: Response) =>
      download(res, await service.invoicePdf(param(req, "invoiceId"), business(req))),
    recordPayment: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.recordPayment(
          param(req, "invoiceId"),
          req.body,
          user(req),
          req.requestId,
        ),
        201,
        req.requestId,
      ),
    reversePayment: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.reversePayment(
          param(req, "paymentId"),
          req.body.reason,
          req.body.idempotencyKey,
          user(req),
          req.requestId,
        ),
        201,
        req.requestId,
      ),
    voidInvoice: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.voidInvoice(
          param(req, "invoiceId"),
          req.body.reason,
          user(req),
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    grantComplimentary: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.grantComplimentary(req.body, user(req), req.requestId),
        201,
        req.requestId,
      ),
    listSubscriptions: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.listSubscriptions(req.query as never),
        200,
        req.requestId,
      ),
    suspend: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.changeStatus(
          param(req, "id"),
          "suspend",
          req.body.reason,
          user(req),
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    reactivate: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.changeStatus(
          param(req, "id"),
          "reactivate",
          req.body.reason,
          user(req),
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    cancel: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.changeStatus(
          param(req, "id"),
          "cancel",
          req.body.reason,
          user(req),
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    createCategoryRequest: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.createCategoryRequest(
          business(req),
          req.body,
          user(req),
          req.requestId,
        ),
        201,
        req.requestId,
      ),
    supplierCategoryRequests: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.listCategoryRequests(req.query as never, business(req)),
        200,
        req.requestId,
      ),
    adminCategoryRequests: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.listCategoryRequests(req.query as never),
        200,
        req.requestId,
      ),
    decideCategoryRequest: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.decideCategoryRequest(
          param(req, "id"),
          req.body,
          user(req),
          req.requestId,
        ),
        200,
        req.requestId,
      ),
    dashboard: async (req: Request, res: Response) => {
      const query = req.query as unknown as {
        from: Date;
        to: Date;
        timezone: "Asia/Dhaka";
      };
      sendSuccess(
        res,
        await service.dashboard(query.from, query.to, query.timezone),
        200,
        req.requestId,
      );
    },
  };
}
