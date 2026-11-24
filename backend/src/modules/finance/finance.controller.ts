import type { Request, Response } from "express";
import { sendSuccess } from "../../shared/utils/response.js";
import type { FinanceService } from "./finance.service.js";

const param = (req: Request, key = "id") => {
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
function pdf(res: Response, document: { filename: string; bytes: Buffer }) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${document.filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).send(document.bytes);
}

export function createFinanceController(service: FinanceService) {
  return {
    issueInvoice: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.issueInvoice(
          param(req, "orderId"),
          req.body.dueAt,
          user(req),
          req.requestId,
        ),
        201,
        req.requestId,
      ),
    recordPayment: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.recordPayment(
          param(req, "orderId"),
          req.body,
          user(req),
          req.requestId,
        ),
        201,
        req.requestId,
      ),
    approveRefund: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.approveRefund(
          param(req, "orderId"),
          req.body,
          user(req),
          req.requestId,
        ),
        201,
        req.requestId,
      ),
    completeRefund: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.completeRefund(param(req), req.body, user(req), req.requestId),
        201,
        req.requestId,
      ),
    createPayable: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.createPayable(param(req, "orderId"), user(req), req.requestId),
        201,
        req.requestId,
      ),
    settlement: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.recordSettlement(req.body, user(req), req.requestId),
        201,
        req.requestId,
      ),
    reverse: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.reverseTransaction(
          param(req),
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
        await service.voidInvoice(param(req), req.body.reason, user(req), req.requestId),
        200,
        req.requestId,
      ),
    listAdminInvoices: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.listInvoices(req.query as never),
        200,
        req.requestId,
      ),
    listAdminTransactions: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.listTransactions(req.query as never),
        200,
        req.requestId,
      ),
    listRefunds: async (req: Request, res: Response) =>
      sendSuccess(res, await service.listRefunds(req.query as never), 200, req.requestId),
    listSettlements: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.listSettlements(req.query as never),
        200,
        req.requestId,
      ),
    supplierOverview: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.supplierOverview(req.query as never),
        200,
        req.requestId,
      ),
    getAdminInvoice: async (req: Request, res: Response) =>
      sendSuccess(res, await service.getInvoice(param(req)), 200, req.requestId),
    adminInvoicePdf: async (req: Request, res: Response) =>
      pdf(res, await service.invoicePdf(param(req))),
    customerInvoices: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.customerInvoices(user(req), req.query as never),
        200,
        req.requestId,
      ),
    customerInvoice: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.getInvoice(param(req), user(req)),
        200,
        req.requestId,
      ),
    customerInvoicePdf: async (req: Request, res: Response) =>
      pdf(res, await service.invoicePdf(param(req), user(req))),
    customerHistory: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.customerHistory(user(req), req.query as never),
        200,
        req.requestId,
      ),
    supplierStatement: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.supplierStatement(
          business(req),
          req.query.from as Date | undefined,
          req.query.to as Date | undefined,
        ),
        200,
        req.requestId,
      ),
    supplierStatementPdf: async (req: Request, res: Response) =>
      pdf(
        res,
        await service.supplierStatementPdf(
          business(req),
          req.query.from as Date | undefined,
          req.query.to as Date | undefined,
        ),
      ),
    supplierTransactions: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.listTransactions(req.query as never, { businessId: business(req) }),
        200,
        req.requestId,
      ),
    getConfig: async (req: Request, res: Response) =>
      sendSuccess(res, await service.getConfig(), 200, req.requestId),
    updateConfig: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.updateConfig(req.body, user(req), req.requestId),
        200,
        req.requestId,
      ),
    dashboard: async (req: Request, res: Response) =>
      sendSuccess(res, await service.dashboard(req.query as never), 200, req.requestId),
    queue: async (req: Request, res: Response) =>
      sendSuccess(res, await service.queue(req.query as never), 200, req.requestId),
    audits: async (req: Request, res: Response) =>
      sendSuccess(res, await service.audits(req.query as never), 200, req.requestId),
    createCase: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.createCase(req.body, user(req), req.requestId),
        201,
        req.requestId,
      ),
    updateCase: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.updateCase(param(req), req.body, user(req), req.requestId),
        200,
        req.requestId,
      ),
    listCases: async (req: Request, res: Response) =>
      sendSuccess(res, await service.listCases(req.query as never), 200, req.requestId),
    getCase: async (req: Request, res: Response) =>
      sendSuccess(res, await service.getCase(param(req)), 200, req.requestId),
  };
}
