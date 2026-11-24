import type { Request, Response } from "express";
import { sendSuccess } from "../../shared/utils/response.js";
import type { CreditService } from "./credit.service.js";

const userId = (req: Request) => {
  if (!req.auth) throw new Error("Authentication context is missing");
  return req.auth.id;
};
const businessId = (req: Request) => {
  if (!req.supplierAccess) throw new Error("Supplier access context is missing");
  return req.supplierAccess.businessId;
};
const param = (req: Request, key = "id") => {
  const value = req.params[key];
  if (typeof value !== "string") throw new Error(`Missing ${key}`);
  return value;
};

export function createCreditController(service: CreditService) {
  return {
    policy: async (_req: Request, res: Response) =>
      sendSuccess(res, await service.getPolicy(), 200, _req.requestId),
    setPolicy: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.setPolicy(req.body, userId(req), req.requestId),
        201,
        req.requestId,
      ),
    overview: async (req: Request, res: Response) =>
      sendSuccess(res, await service.overview(), 200, req.requestId),
    reconciliation: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.reconcileWallets(req.query as never),
        200,
        req.requestId,
      ),
    wallets: async (req: Request, res: Response) =>
      sendSuccess(res, await service.listWallets(req.query as never), 200, req.requestId),
    wallet: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.supplierWallet(param(req, "businessId")),
        200,
        req.requestId,
      ),
    supplierWallet: async (req: Request, res: Response) =>
      sendSuccess(res, await service.supplierWallet(businessId(req)), 200, req.requestId),
    submitTopUp: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.submitTopUp(businessId(req), userId(req), req.body, req.requestId),
        201,
        req.requestId,
      ),
    topUps: async (req: Request, res: Response) =>
      sendSuccess(res, await service.listTopUps(req.query as never), 200, req.requestId),
    decideTopUp: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.decideTopUp(param(req), req.body, userId(req), req.requestId),
        200,
        req.requestId,
      ),
    adjust: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.adjust(
          param(req, "businessId"),
          req.body,
          userId(req),
          req.requestId,
        ),
        201,
        req.requestId,
      ),
    reservations: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.listReservations(req.query as never),
        200,
        req.requestId,
      ),
    reverse: async (req: Request, res: Response) =>
      sendSuccess(
        res,
        await service.reverseSettlement(
          param(req, "orderId"),
          userId(req),
          req.requestId,
          req.body.reason,
        ),
        200,
        req.requestId,
      ),
  };
}
