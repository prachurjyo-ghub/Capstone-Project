import { UserRole, type PrismaClient } from "@prisma/client";
import express, { Router } from "express";
import type { Env } from "../../config/env.js";
import {
  createAuthenticateMiddleware,
  requireActiveSupplierAccess,
  requireRoles,
  requireSupplierOwnerAccess,
} from "../../middleware/authenticate.js";
import { validateRequest } from "../../middleware/validate-request.js";
import {
  createInventoryController,
  createListingImageController,
} from "./inventory.controller.js";
import {
  bulkInventorySchema,
  adminInventoryListSchema,
  createInventorySchema,
  csvConfirmationSchema,
  inventoryListQuerySchema,
  inventoryParamsSchema,
  stockAdjustmentSchema,
  moderationSchema,
  updateInventorySchema,
  inventoryImageParamsSchema,
  imageOrderSchema,
  publicListingImageParamsSchema,
} from "./inventory.schemas.js";
import type { InventoryService } from "./inventory.service.js";
import type { ListingImageService } from "./listing-image.service.js";

export function createAdminInventoryRouter(
  database: PrismaClient,
  env: Env,
  service: InventoryService,
) {
  const router = Router();
  const controller = createInventoryController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.ADMIN, UserRole.SUPER_ADMIN));
  router.use((req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
      res.on("finish", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) void service.invalidateCache();
      });
    next();
  });
  router.get(
    "/",
    validateRequest({ query: adminInventoryListSchema }),
    controller.adminList,
  );
  router.post(
    "/:inventoryId/moderation",
    validateRequest({ params: inventoryParamsSchema, body: moderationSchema }),
    controller.moderate,
  );
  return router;
}

export function createInventoryRouter(
  database: PrismaClient,
  env: Env,
  service: InventoryService,
  imageService: ListingImageService,
) {
  const router = Router();
  const controller = createInventoryController(service);
  const images = createListingImageController(imageService);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.SUPPLIER_OWNER, UserRole.SUPPLIER_STAFF));
  router.use(requireActiveSupplierAccess(database));
  router.use((req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
      res.on("finish", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) void service.invalidateCache();
      });
    next();
  });

  router.get("/csv-template", controller.template);
  router.post(
    "/csv/preview",
    express.raw({
      type: ["text/csv", "application/csv", "application/octet-stream"],
      limit: "512kb",
    }),
    controller.previewCsv,
  );
  router.post(
    "/csv/confirm",
    validateRequest({ body: csvConfirmationSchema }),
    controller.confirmCsv,
  );
  router.post(
    "/bulk",
    validateRequest({ body: bulkInventorySchema }),
    controller.bulkUpdate,
  );
  router.post(
    "/:inventoryId/images",
    validateRequest({ params: inventoryParamsSchema }),
    express.raw({
      type: ["image/jpeg", "image/png", "image/webp", "application/octet-stream"],
      limit: "2mb",
    }),
    images.upload,
  );
  router.put(
    "/:inventoryId/images/:imageId",
    validateRequest({ params: inventoryImageParamsSchema }),
    express.raw({
      type: ["image/jpeg", "image/png", "image/webp", "application/octet-stream"],
      limit: "2mb",
    }),
    images.replace,
  );
  router.patch(
    "/:inventoryId/images",
    validateRequest({ params: inventoryParamsSchema, body: imageOrderSchema }),
    images.reorder,
  );
  router.delete(
    "/:inventoryId/images/:imageId",
    validateRequest({ params: inventoryImageParamsSchema }),
    images.remove,
  );
  router.get("/", validateRequest({ query: inventoryListQuerySchema }), controller.list);
  router.post("/", validateRequest({ body: createInventorySchema }), controller.create);
  router.get(
    "/:inventoryId",
    validateRequest({ params: inventoryParamsSchema }),
    controller.get,
  );
  router.patch(
    "/:inventoryId",
    validateRequest({ params: inventoryParamsSchema, body: updateInventorySchema }),
    controller.update,
  );
  router.post(
    "/:inventoryId/stock-adjustments",
    validateRequest({ params: inventoryParamsSchema, body: stockAdjustmentSchema }),
    controller.adjustStock,
  );
  router.get(
    "/:inventoryId/stock-adjustments",
    validateRequest({ params: inventoryParamsSchema }),
    controller.listAdjustments,
  );
  router.post(
    "/:inventoryId/deactivate",
    requireSupplierOwnerAccess(database),
    validateRequest({ params: inventoryParamsSchema }),
    controller.deactivate,
  );
  return router;
}

export function createPublicListingImageRouter(service: ListingImageService) {
  const router = Router();
  const controller = createListingImageController(service);
  router.get(
    "/:imageId/:version",
    validateRequest({ params: publicListingImageParamsSchema }),
    controller.publicImage,
  );
  return router;
}
