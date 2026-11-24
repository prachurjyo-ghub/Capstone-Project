import type { Request, Response } from "express";
import { sendSuccess } from "../../shared/utils/response.js";
import type { CustomerService } from "./customer.service.js";

function authenticatedUserId(req: Request): string {
  if (!req.auth) throw new Error("Authentication context is missing");
  return req.auth.id;
}

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string") throw new Error(`Route parameter ${name} is missing`);
  return value;
}

export function createCustomerController(service: CustomerService) {
  return {
    getMyProfile: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.getMyProfile(authenticatedUserId(req)),
        200,
        req.requestId,
      );
    },
    updateMyProfile: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.updateMyProfile(authenticatedUserId(req), req.body, req.requestId),
        200,
        req.requestId,
      );
    },
    listMyAddresses: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.listMyAddresses(authenticatedUserId(req)),
        200,
        req.requestId,
      );
    },
    createAddress: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.createAddress(authenticatedUserId(req), req.body, req.requestId),
        201,
        req.requestId,
      );
    },
    updateAddress: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.updateAddress(
          authenticatedUserId(req),
          routeParam(req, "addressId"),
          req.body,
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    setDefaultAddress: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.setDefaultAddress(
          authenticatedUserId(req),
          routeParam(req, "addressId"),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    deleteAddress: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.deleteAddress(
          authenticatedUserId(req),
          routeParam(req, "addressId"),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    listMyVehicles: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.listMyVehicles(authenticatedUserId(req)),
        200,
        req.requestId,
      );
    },
    createVehicle: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.createVehicle(authenticatedUserId(req), req.body, req.requestId),
        201,
        req.requestId,
      );
    },
    updateVehicle: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.updateVehicle(
          authenticatedUserId(req),
          routeParam(req, "vehicleId"),
          req.body,
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    deleteVehicle: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.deleteVehicle(
          authenticatedUserId(req),
          routeParam(req, "vehicleId"),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    listCustomers: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.listCustomers(req.query as never),
        200,
        req.requestId,
      );
    },
    getCustomer: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.getCustomer(routeParam(req, "userId")),
        200,
        req.requestId,
      );
    },
    updateCustomer: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.updateCustomer(
          routeParam(req, "userId"),
          req.body,
          authenticatedUserId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    suspendCustomer: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.suspendCustomer(
          routeParam(req, "userId"),
          req.body.reason,
          authenticatedUserId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    reactivateCustomer: async (req: Request, res: Response): Promise<void> => {
      sendSuccess(
        res,
        await service.reactivateCustomer(
          routeParam(req, "userId"),
          authenticatedUserId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
  };
}
