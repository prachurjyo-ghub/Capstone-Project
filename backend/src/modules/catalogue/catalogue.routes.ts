import { UserRole, type PrismaClient } from "@prisma/client";
import { Router } from "express";
import type { Env } from "../../config/env.js";
import {
  createAuthenticateMiddleware,
  requireActiveSupplierAccess,
  requireRoles,
} from "../../middleware/authenticate.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { createCatalogueController } from "./catalogue.controller.js";
import {
  catalogueProductQuerySchema,
  compatibilitySchema,
  createBrandSchema,
  createCategorySchema,
  createProductSchema,
  idParamsSchema,
  paginationSchema,
  productParamsSchema,
  productChildParamsSchema,
  productNumberSchema,
  updateBrandSchema,
  updateCategorySchema,
  updateCompatibilitySchema,
  updateProductNumberSchema,
  updateProductSchema,
} from "./catalogue.schemas.js";
import type { CatalogueService } from "./catalogue.service.js";

export function createPublicCatalogueRouter(service: CatalogueService) {
  const router = Router();
  const controller = createCatalogueController(service);
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    next();
  });
  router.get(
    "/categories",
    validateRequest({ query: paginationSchema }),
    controller.listPublicCategories,
  );
  router.get(
    "/products",
    validateRequest({ query: catalogueProductQuerySchema }),
    controller.listPublicProducts,
  );
  router.get(
    "/products/:id",
    validateRequest({ params: idParamsSchema }),
    controller.getPublicProduct,
  );
  return router;
}

export function createAdminCatalogueRouter(
  database: PrismaClient,
  env: Env,
  service: CatalogueService,
) {
  const router = Router();
  const controller = createCatalogueController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.ADMIN, UserRole.SUPER_ADMIN));
  router.use((req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      res.on("finish", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          void service.invalidateCache();
        }
      });
    }
    next();
  });

  router.post(
    "/categories",
    validateRequest({ body: createCategorySchema }),
    controller.createCategory,
  );
  router.get(
    "/categories",
    validateRequest({ query: paginationSchema }),
    controller.listCategories,
  );
  router.get(
    "/categories/:id",
    validateRequest({ params: idParamsSchema }),
    controller.getCategory,
  );
  router.patch(
    "/categories/:id",
    validateRequest({ params: idParamsSchema, body: updateCategorySchema }),
    controller.updateCategory,
  );
  router.post(
    "/brands",
    validateRequest({ body: createBrandSchema }),
    controller.createBrand,
  );
  router.get(
    "/brands",
    validateRequest({ query: paginationSchema }),
    controller.listBrands,
  );
  router.get(
    "/brands/:id",
    validateRequest({ params: idParamsSchema }),
    controller.getBrand,
  );
  router.patch(
    "/brands/:id",
    validateRequest({ params: idParamsSchema, body: updateBrandSchema }),
    controller.updateBrand,
  );
  router.post(
    "/products",
    validateRequest({ body: createProductSchema }),
    controller.createProduct,
  );
  router.get(
    "/products",
    validateRequest({ query: catalogueProductQuerySchema }),
    controller.listProducts,
  );
  router.get(
    "/products/:id",
    validateRequest({ params: idParamsSchema }),
    controller.getProduct,
  );
  router.patch(
    "/products/:id",
    validateRequest({ params: idParamsSchema, body: updateProductSchema }),
    controller.updateProduct,
  );
  router.post(
    "/products/:productId/numbers",
    validateRequest({ params: productParamsSchema, body: productNumberSchema }),
    controller.addProductNumber,
  );
  router.patch(
    "/products/:productId/numbers/:childId",
    validateRequest({
      params: productChildParamsSchema,
      body: updateProductNumberSchema,
    }),
    controller.updateProductNumber,
  );
  router.delete(
    "/products/:productId/numbers/:childId",
    validateRequest({ params: productChildParamsSchema }),
    controller.deleteProductNumber,
  );
  router.post(
    "/products/:productId/compatibilities",
    validateRequest({ params: productParamsSchema, body: compatibilitySchema }),
    controller.addCompatibility,
  );
  router.patch(
    "/products/:productId/compatibilities/:childId",
    validateRequest({
      params: productChildParamsSchema,
      body: updateCompatibilitySchema,
    }),
    controller.updateCompatibility,
  );
  router.delete(
    "/products/:productId/compatibilities/:childId",
    validateRequest({ params: productChildParamsSchema }),
    controller.deleteCompatibility,
  );
  return router;
}

export function createSupplierCatalogueRouter(
  database: PrismaClient,
  env: Env,
  service: CatalogueService,
) {
  const router = Router();
  const controller = createCatalogueController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.SUPPLIER_OWNER, UserRole.SUPPLIER_STAFF));
  router.use(requireActiveSupplierAccess(database));
  router.get(
    "/products",
    validateRequest({ query: catalogueProductQuerySchema }),
    controller.listSupplierProducts,
  );
  router.get(
    "/products/:id",
    validateRequest({ params: idParamsSchema }),
    controller.getSupplierProduct,
  );
  return router;
}
