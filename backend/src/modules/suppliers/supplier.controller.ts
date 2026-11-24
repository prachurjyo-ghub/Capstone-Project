import type { Request, Response } from "express";
import { sendSuccess } from "../../shared/utils/response.js";
import type { SupplierService } from "./supplier.service.js";

function adminId(req: Request): string {
  if (!req.auth) throw new Error("Authentication context is missing");
  return req.auth.id;
}

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string") throw new Error(`Route parameter ${name} is missing`);
  return value;
}

export function createSupplierController(service: SupplierService) {
  return {
    createBusiness: async (req: Request, res: Response): Promise<void> => {
      const business = await service.createBusiness(
        req.body,
        adminId(req),
        req.requestId,
      );
      sendSuccess(res, business, 201, req.requestId);
    },
    createOwnerAccount: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.createOwnerAccount(
          routeParam(req, "businessId"),
          req.body,
          adminId(req),
          req.requestId,
        ),
        201,
        req.requestId,
      );
    },
    updateMemberAccountStatus: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.updateMemberAccountStatus(
          routeParam(req, "businessId"),
          routeParam(req, "membershipId"),
          req.body,
          adminId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    resetMemberTemporaryPassword: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.resetMemberTemporaryPassword(
          routeParam(req, "businessId"),
          routeParam(req, "membershipId"),
          req.body,
          adminId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    listBusinesses: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.listBusinesses(req.query as never),
        200,
        req.requestId,
      );
    },
    getBusiness: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.getBusiness(routeParam(req, "businessId")),
        200,
        req.requestId,
      );
    },
    getOwnBusiness: async (req: Request, res: Response): Promise<void> => {
      if (!req.supplierAccess) throw new Error("Supplier context is missing");
      sendSuccess(
        res,
        await service.getBusiness(req.supplierAccess.businessId),
        200,
        req.requestId,
      );
    },
    updateBusiness: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.updateBusiness(
          routeParam(req, "businessId"),
          req.body,
          adminId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    setSupportedCategories: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.setSupportedCategories(
          routeParam(req, "businessId"),
          req.body,
          adminId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    createLocation: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.createLocation(
          routeParam(req, "businessId"),
          req.body,
          adminId(req),
          req.requestId,
        ),
        201,
        req.requestId,
      );
    },
    updateLocation: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.updateLocation(
          routeParam(req, "businessId"),
          routeParam(req, "locationId"),
          req.body,
          adminId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    deactivateLocation: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.deactivateLocation(
          routeParam(req, "businessId"),
          routeParam(req, "locationId"),
          adminId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    inviteOwner: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.inviteInitialOwner(
          routeParam(req, "businessId"),
          req.body,
          adminId(req),
          req.requestId,
        ),
        201,
        req.requestId,
      );
    },
    listInvitations: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.listInvitations(routeParam(req, "businessId")),
        200,
        req.requestId,
      );
    },
    getInvitation: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.getInvitation(
          routeParam(req, "businessId"),
          routeParam(req, "invitationId"),
        ),
        200,
        req.requestId,
      );
    },
    resendInvitation: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.resendInvitation(
          routeParam(req, "businessId"),
          routeParam(req, "invitationId"),
          adminId(req),
          req.requestId,
        ),
        201,
        req.requestId,
      );
    },
    revokeInvitation: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.revokeInvitation(
          routeParam(req, "businessId"),
          routeParam(req, "invitationId"),
          adminId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    acceptInvitation: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.acceptInvitation(req.body, req.requestId),
        201,
        req.requestId,
      );
    },
    submitForReview: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.submitForReview(
          routeParam(req, "businessId"),
          adminId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    activateBusiness: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.activateBusiness(
          routeParam(req, "businessId"),
          adminId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    suspendBusiness: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.suspendBusiness(
          routeParam(req, "businessId"),
          req.body.reason,
          adminId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    disableBusiness: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.disableBusiness(
          routeParam(req, "businessId"),
          req.body.reason,
          adminId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
  };
}
