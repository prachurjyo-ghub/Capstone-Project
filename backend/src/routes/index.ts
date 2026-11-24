import type { PrismaClient } from "@prisma/client";
import { Router } from "express";
import type { Env } from "../config/env.js";
import type { RecoveryDelivery } from "../modules/auth/recovery-delivery.js";
import { AuthService } from "../modules/auth/auth.service.js";
import { createAuthRouter } from "../modules/auth/auth.routes.js";
import {
  createAdminCatalogueRouter,
  createPublicCatalogueRouter,
  createSupplierCatalogueRouter,
} from "../modules/catalogue/catalogue.routes.js";
import { CatalogueService } from "../modules/catalogue/catalogue.service.js";
import {
  createAdminCustomerRouter,
  createCustomerRouter,
} from "../modules/customers/customer.routes.js";
import { CustomerService } from "../modules/customers/customer.service.js";
import { createHealthRouter } from "../modules/health/health.routes.js";
import { createCommunicationRouter } from "../modules/communications/communication.routes.js";
import { CatalogueCache } from "../modules/catalogue/catalogue.cache.js";
import { createAdminJobRouter } from "../modules/jobs/job.routes.js";
import {
  createAdminInventoryRouter,
  createInventoryRouter,
  createPublicListingImageRouter,
} from "../modules/inventory/inventory.routes.js";
import { InventoryService } from "../modules/inventory/inventory.service.js";
import { ListingImageService } from "../modules/inventory/listing-image.service.js";
import type { ListingImageStorage } from "../modules/inventory/listing-image-storage.js";
import {
  createSupplierAdminRouter,
  createSupplierInvitationRouter,
  createSupplierSelfRouter,
} from "../modules/suppliers/supplier.routes.js";
import { SupplierService } from "../modules/suppliers/supplier.service.js";
import type { SupplierInvitationDelivery } from "../modules/suppliers/supplier-invitation-delivery.js";
import type { RequestAttachmentStorage } from "../modules/requests/attachment-storage.js";
import {
  createAdminRequestRouter,
  createCustomerRequestRouter,
} from "../modules/requests/request.routes.js";
import { CustomerRequestService } from "../modules/requests/request.service.js";
import type { MatchingClock } from "../modules/matching/matching-clock.js";
import {
  createAdminMatchingRouter,
  createSupplierInboxRouter,
} from "../modules/matching/matching.routes.js";
import { MatchingService } from "../modules/matching/matching.service.js";
import {
  createAdminCommerceRouter,
  createCustomerCommerceRouter,
  createSupplierCommerceRouter,
} from "../modules/commerce/commerce.routes.js";
import { CommerceService } from "../modules/commerce/commerce.service.js";
import {
  createAdminFulfillmentRouter,
  createCustomerFulfillmentRouter,
  createSupplierFulfillmentRouter,
} from "../modules/fulfillment/fulfillment.routes.js";
import { FulfillmentService } from "../modules/fulfillment/fulfillment.service.js";
import {
  createAdminFinanceRouter,
  createAdminOperationsRouter,
  createCustomerFinanceRouter,
  createSupplierFinanceRouter,
} from "../modules/finance/finance.routes.js";
import { FinanceService } from "../modules/finance/finance.service.js";
import {
  createAdminCategoryRequestRouter,
  createAdminSubscriptionRouter,
  createSupplierSubscriptionRouter,
} from "../modules/subscriptions/subscription.routes.js";
import { SubscriptionService } from "../modules/subscriptions/subscription.service.js";
import {
  createAdminCreditRouter,
  createSupplierCreditRouter,
} from "../modules/credits/credit.routes.js";
import { CreditService } from "../modules/credits/credit.service.js";
import {
  createCustomerPurchaseRequestRouter,
  createSupplierPurchaseRequestRouter,
} from "../modules/requests/purchase-request.routes.js";
import { PurchaseRequestService } from "../modules/requests/purchase-request.service.js";

export function createApiRouter(
  database: PrismaClient,
  env: Env,
  recoveryDelivery: RecoveryDelivery,
  supplierInvitationDelivery: SupplierInvitationDelivery,
  requestAttachmentStorage: RequestAttachmentStorage,
  listingImageStorage: ListingImageStorage,
  matchingClock: MatchingClock,
) {
  const router = Router();
  const authService = new AuthService(database, env, recoveryDelivery);
  const supplierService = new SupplierService(database, env, supplierInvitationDelivery);
  const customerService = new CustomerService(database);
  const catalogueCache = new CatalogueCache(env);
  const catalogueService = new CatalogueService(database, catalogueCache);
  const inventoryService = new InventoryService(database, () =>
    catalogueCache.invalidate(),
  );
  const listingImageService = new ListingImageService(database, listingImageStorage, {
    maxCount: env.SUPPLIER_IMAGE_MAX_COUNT,
    maxBytes: env.SUPPLIER_IMAGE_MAX_BYTES,
  });
  const requestService = new CustomerRequestService(database, requestAttachmentStorage);
  const matchingService = new MatchingService(
    database,
    requestAttachmentStorage,
    matchingClock,
  );
  const commerceService = new CommerceService(database, matchingClock);
  const creditService = new CreditService(database, () => matchingClock.now());
  const fulfillmentService = new FulfillmentService(
    database,
    matchingClock,
    creditService,
  );
  const purchaseRequestService = new PurchaseRequestService(
    database,
    creditService,
    matchingClock,
  );
  const financeService = new FinanceService(database, env, () => matchingClock.now());
  const subscriptionService = new SubscriptionService(database, env, () =>
    matchingClock.now(),
  );
  router.use("/health", createHealthRouter(database));
  router.use(
    "/communications",
    createCommunicationRouter(database, env, requestAttachmentStorage),
  );
  router.use(
    "/admin/jobs",
    createAdminJobRouter(database, env, matchingClock, listingImageStorage),
  );
  router.use("/auth", createAuthRouter(database, env, authService));
  router.use("/customers", createCustomerRouter(database, env, customerService));
  router.use(
    "/customers/me/requests",
    createCustomerRequestRouter(database, env, requestService),
  );
  router.use(
    "/customers/me/purchase-requests",
    createCustomerPurchaseRequestRouter(database, env, purchaseRequestService),
  );
  router.use(
    "/admin/customers",
    createAdminCustomerRouter(database, env, customerService),
  );
  router.use("/admin/requests", createAdminRequestRouter(database, env, requestService));
  router.use(
    "/admin/requests",
    createAdminMatchingRouter(database, env, matchingService),
  );
  router.use(
    "/admin/suppliers",
    createSupplierAdminRouter(database, env, supplierService),
  );
  router.use(
    "/supplier-invitations",
    createSupplierInvitationRouter(env, supplierService),
  );
  router.use(
    "/supplier/profile",
    createSupplierSelfRouter(database, env, supplierService),
  );
  router.use(
    "/admin/catalogue",
    createAdminCatalogueRouter(database, env, catalogueService),
  );
  router.use("/catalogue", createPublicCatalogueRouter(catalogueService));
  router.use(
    "/catalogue/listing-images",
    createPublicListingImageRouter(listingImageService),
  );
  router.use(
    "/admin/catalogue",
    createAdminCategoryRequestRouter(database, env, subscriptionService),
  );
  router.use(
    "/supplier/catalogue",
    createSupplierCatalogueRouter(database, env, catalogueService),
  );
  router.use(
    "/supplier/subscriptions",
    createSupplierSubscriptionRouter(database, env, subscriptionService),
  );
  router.use(
    "/admin/subscriptions",
    createAdminSubscriptionRouter(database, env, subscriptionService),
  );
  router.use("/admin/credits", createAdminCreditRouter(database, env, creditService));
  router.use(
    "/supplier/credits",
    createSupplierCreditRouter(database, env, creditService),
  );
  router.use(
    "/supplier/inventory",
    createInventoryRouter(database, env, inventoryService, listingImageService),
  );
  router.use(
    "/admin/listings",
    createAdminInventoryRouter(database, env, inventoryService),
  );
  router.use(
    "/supplier/requests",
    createSupplierInboxRouter(database, env, matchingService),
  );
  router.use(
    "/supplier/commerce/purchase-requests",
    createSupplierPurchaseRequestRouter(database, env, purchaseRequestService),
  );
  router.use(
    "/supplier/quotations",
    createSupplierCommerceRouter(database, env, commerceService),
  );
  router.use("/admin", createAdminCommerceRouter(database, env, commerceService));
  router.use(
    "/customers/me",
    createCustomerCommerceRouter(database, env, commerceService),
  );
  router.use("/admin", createAdminFulfillmentRouter(database, env, fulfillmentService));
  router.use(
    "/supplier/fulfillment",
    createSupplierFulfillmentRouter(database, env, fulfillmentService),
  );
  router.use(
    "/customers/me/orders",
    createCustomerFulfillmentRouter(database, env, fulfillmentService),
  );
  router.use("/admin/finance", createAdminFinanceRouter(database, env, financeService));
  router.use(
    "/admin/operations",
    createAdminOperationsRouter(database, env, financeService),
  );
  router.use(
    "/customers/me/finance",
    createCustomerFinanceRouter(database, env, financeService),
  );
  router.use(
    "/supplier/finance",
    createSupplierFinanceRouter(database, env, financeService),
  );
  return router;
}
