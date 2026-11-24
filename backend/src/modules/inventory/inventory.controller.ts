import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/utils/response.js";
import { CSV_TEMPLATE } from "./inventory.csv.js";
import type { InventoryService } from "./inventory.service.js";
import type { ListingImageService } from "./listing-image.service.js";

function context(req: Request) {
  if (!req.auth || !req.supplierAccess) {
    throw new Error("Supplier authentication context is missing");
  }
  return { userId: req.auth.id, businessId: req.supplierAccess.businessId };
}

function imageId(req: Request): string {
  const value = req.params.imageId;
  if (typeof value !== "string") throw new Error("Image route parameter is missing");
  return value;
}

export function createListingImageController(service: ListingImageService) {
  const imageBody = (req: Request) => {
    if (!Buffer.isBuffer(req.body))
      throw new AppError("An image request body is required", {
        code: "INVALID_LISTING_IMAGE",
        statusCode: 400,
      });
    return req.body;
  };
  return {
    upload: async (req: Request, res: Response) => {
      const { businessId, userId } = context(req);
      sendSuccess(
        res,
        await service.upload(
          businessId,
          inventoryId(req),
          imageBody(req),
          userId,
          req.requestId,
        ),
        201,
        req.requestId,
      );
    },
    replace: async (req: Request, res: Response) => {
      const { businessId, userId } = context(req);
      sendSuccess(
        res,
        await service.replace(
          businessId,
          inventoryId(req),
          imageId(req),
          imageBody(req),
          userId,
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    reorder: async (req: Request, res: Response) => {
      const { businessId, userId } = context(req);
      sendSuccess(
        res,
        await service.reorder(
          businessId,
          inventoryId(req),
          req.body.imageIds,
          userId,
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    remove: async (req: Request, res: Response) => {
      const { businessId, userId } = context(req);
      await service.remove(
        businessId,
        inventoryId(req),
        imageId(req),
        userId,
        req.requestId,
      );
      res.status(204).send();
    },
    publicImage: async (req: Request, res: Response) => {
      const rawVersion = typeof req.params.version === "string" ? req.params.version : "";
      const version = Number(rawVersion.replace(/^v/, ""));
      if (!Number.isSafeInteger(version) || version < 1)
        throw new AppError("Listing image was not found", {
          code: "LISTING_IMAGE_NOT_FOUND",
          statusCode: 404,
        });
      const image = await service.openPublic(imageId(req), version);
      res
        .status(200)
        .type(image.mimeType)
        .set({
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Length": String(image.contentLength ?? image.byteSize),
          "X-Content-Type-Options": "nosniff",
        });
      image.stream.pipe(res);
    },
  };
}

function inventoryId(req: Request): string {
  const value = req.params.inventoryId;
  if (typeof value !== "string") throw new Error("Inventory route parameter is missing");
  return value;
}

export function createInventoryController(service: InventoryService) {
  return {
    adminList: async (req: Request, res: Response) => {
      sendSuccess(res, await service.listAdmin(req.query as never), 200, req.requestId);
    },
    moderate: async (req: Request, res: Response) => {
      if (!req.auth) throw new Error("Admin authentication context is missing");
      sendSuccess(
        res,
        await service.moderate(inventoryId(req), req.body, req.auth.id, req.requestId),
        200,
        req.requestId,
      );
    },
    list: async (req: Request, res: Response) => {
      const { businessId } = context(req);
      sendSuccess(
        res,
        await service.listInventory(businessId, req.query as never),
        200,
        req.requestId,
      );
    },
    get: async (req: Request, res: Response) => {
      const { businessId } = context(req);
      sendSuccess(
        res,
        await service.getInventory(businessId, inventoryId(req)),
        200,
        req.requestId,
      );
    },
    create: async (req: Request, res: Response) => {
      const { businessId, userId } = context(req);
      sendSuccess(
        res,
        await service.createInventory(businessId, req.body, userId, req.requestId),
        201,
        req.requestId,
      );
    },
    update: async (req: Request, res: Response) => {
      const { businessId, userId } = context(req);
      sendSuccess(
        res,
        await service.updateInventory(
          businessId,
          inventoryId(req),
          req.body,
          userId,
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    adjustStock: async (req: Request, res: Response) => {
      const { businessId, userId } = context(req);
      sendSuccess(
        res,
        await service.adjustStock(
          businessId,
          inventoryId(req),
          req.body,
          userId,
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    listAdjustments: async (req: Request, res: Response) => {
      const { businessId } = context(req);
      sendSuccess(
        res,
        await service.listStockAdjustments(businessId, inventoryId(req)),
        200,
        req.requestId,
      );
    },
    deactivate: async (req: Request, res: Response) => {
      const { businessId, userId } = context(req);
      sendSuccess(
        res,
        await service.deactivateInventory(
          businessId,
          inventoryId(req),
          userId,
          req.requestId,
        ),
        200,
        req.requestId,
      );
    },
    bulkUpdate: async (req: Request, res: Response) => {
      const { businessId, userId } = context(req);
      sendSuccess(
        res,
        await service.bulkUpdate(businessId, req.body, userId, req.requestId),
        200,
        req.requestId,
      );
    },
    template: async (_req: Request, res: Response) => {
      res
        .status(200)
        .type("text/csv")
        .setHeader("Content-Disposition", 'attachment; filename="partsarc-inventory.csv"')
        .send(CSV_TEMPLATE);
    },
    previewCsv: async (req: Request, res: Response) => {
      const { businessId, userId } = context(req);
      if (!Buffer.isBuffer(req.body)) {
        throw new AppError("A CSV request body is required", {
          code: "INVALID_INVENTORY_CSV",
          statusCode: 400,
        });
      }
      sendSuccess(
        res,
        await service.previewCsv(businessId, userId, req.body, req.requestId),
        201,
        req.requestId,
      );
    },
    confirmCsv: async (req: Request, res: Response) => {
      const { businessId, userId } = context(req);
      sendSuccess(
        res,
        await service.confirmCsv(businessId, userId, req.body.previewId, req.requestId),
        200,
        req.requestId,
      );
    },
  };
}
