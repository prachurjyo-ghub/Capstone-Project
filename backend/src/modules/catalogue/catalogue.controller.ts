import type { Request, Response } from "express";
import { sendSuccess } from "../../shared/utils/response.js";
import type { CatalogueService } from "./catalogue.service.js";

function actorId(req: Request): string {
  if (!req.auth) throw new Error("Authentication context is missing");
  return req.auth.id;
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string") throw new Error(`Route parameter ${name} is missing`);
  return value;
}

export function createCatalogueController(service: CatalogueService) {
  return {
    createCategory: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.createCategory(req.body, actorId(req), req.requestId),
        201,
        req.requestId,
      );
    },
    listCategories: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.listCategories(req.query as never),
        200,
        req.requestId,
      );
    },
    listPublicCategories: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.listPublicCategories(req.query as never),
        200,
        req.requestId,
      );
    },
    listPublicProducts: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.listPublicProducts(req.query as never),
        200,
        req.requestId,
      );
    },
    getPublicProduct: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.getPublicProduct(param(req, "id")),
        200,
        req.requestId,
      );
    },
    getCategory: async (req: Request, res: Response) => {
      sendSuccess(res, await service.getCategory(param(req, "id")), 200, req.requestId);
    },
    updateCategory: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.updateCategory(
          param(req, "id"),
          req.body,
          actorId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    createBrand: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.createBrand(req.body, actorId(req), req.requestId),
        201,
        req.requestId,
      );
    },
    listBrands: async (req: Request, res: Response) => {
      sendSuccess(res, await service.listBrands(req.query as never), 200, req.requestId);
    },
    getBrand: async (req: Request, res: Response) => {
      sendSuccess(res, await service.getBrand(param(req, "id")), 200, req.requestId);
    },
    updateBrand: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.updateBrand(
          param(req, "id"),
          req.body,
          actorId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    createProduct: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.createProduct(req.body, actorId(req), req.requestId),
        201,
        req.requestId,
      );
    },
    listProducts: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.listProducts(req.query as never),
        200,
        req.requestId,
      );
    },
    listSupplierProducts: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.listProducts(req.query as never, true),
        200,
        req.requestId,
      );
    },
    getProduct: async (req: Request, res: Response) => {
      sendSuccess(res, await service.getProduct(param(req, "id")), 200, req.requestId);
    },
    getSupplierProduct: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.getProduct(param(req, "id"), true),
        200,
        req.requestId,
      );
    },
    updateProduct: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.updateProduct(
          param(req, "id"),
          req.body,
          actorId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    addProductNumber: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.addProductNumber(
          param(req, "productId"),
          req.body,
          actorId(req),
          req.requestId,
        ),
        201,
        req.requestId,
      );
    },
    updateProductNumber: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.updateProductNumber(
          param(req, "productId"),
          param(req, "childId"),
          req.body,
          actorId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    deleteProductNumber: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.deleteProductNumber(
          param(req, "productId"),
          param(req, "childId"),
          actorId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    addCompatibility: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.addCompatibility(
          param(req, "productId"),
          req.body,
          actorId(req),
          req.requestId,
        ),
        201,
        req.requestId,
      );
    },
    updateCompatibility: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.updateCompatibility(
          param(req, "productId"),
          param(req, "childId"),
          req.body,
          actorId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    deleteCompatibility: async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await service.deleteCompatibility(
          param(req, "productId"),
          param(req, "childId"),
          actorId(req),
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
  };
}
