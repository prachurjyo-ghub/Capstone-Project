import { UserRole, type PrismaClient } from "@prisma/client";
import { Router } from "express";
import type { Env } from "../../config/env.js";
import {
  createAuthenticateMiddleware,
  requireRoles,
} from "../../middleware/authenticate.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { createCustomerController } from "./customer.controller.js";
import {
  addressParamsSchema,
  adminCustomerListQuerySchema,
  adminCustomerParamsSchema,
  createAddressSchema,
  createVehicleSchema,
  suspendCustomerSchema,
  updateAddressSchema,
  updateCustomerProfileSchema,
  updateVehicleSchema,
  vehicleParamsSchema,
} from "./customer.schemas.js";
import type { CustomerService } from "./customer.service.js";

export function createCustomerRouter(
  database: PrismaClient,
  env: Env,
  service: CustomerService,
) {
  const router = Router();
  const controller = createCustomerController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.CUSTOMER));

  router.get("/me", controller.getMyProfile);
  router.patch(
    "/me",
    validateRequest({ body: updateCustomerProfileSchema }),
    controller.updateMyProfile,
  );
  router.get("/me/addresses", controller.listMyAddresses);
  router.post(
    "/me/addresses",
    validateRequest({ body: createAddressSchema }),
    controller.createAddress,
  );
  router.patch(
    "/me/addresses/:addressId",
    validateRequest({ params: addressParamsSchema, body: updateAddressSchema }),
    controller.updateAddress,
  );
  router.post(
    "/me/addresses/:addressId/default",
    validateRequest({ params: addressParamsSchema }),
    controller.setDefaultAddress,
  );
  router.delete(
    "/me/addresses/:addressId",
    validateRequest({ params: addressParamsSchema }),
    controller.deleteAddress,
  );
  router.get("/me/vehicles", controller.listMyVehicles);
  router.post(
    "/me/vehicles",
    validateRequest({ body: createVehicleSchema }),
    controller.createVehicle,
  );
  router.patch(
    "/me/vehicles/:vehicleId",
    validateRequest({ params: vehicleParamsSchema, body: updateVehicleSchema }),
    controller.updateVehicle,
  );
  router.delete(
    "/me/vehicles/:vehicleId",
    validateRequest({ params: vehicleParamsSchema }),
    controller.deleteVehicle,
  );
  return router;
}

export function createAdminCustomerRouter(
  database: PrismaClient,
  env: Env,
  service: CustomerService,
) {
  const router = Router();
  const controller = createCustomerController(service);
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.ADMIN, UserRole.SUPER_ADMIN));

  router.get(
    "/",
    validateRequest({ query: adminCustomerListQuerySchema }),
    controller.listCustomers,
  );
  router.get(
    "/:userId",
    validateRequest({ params: adminCustomerParamsSchema }),
    controller.getCustomer,
  );
  router.patch(
    "/:userId",
    validateRequest({
      params: adminCustomerParamsSchema,
      body: updateCustomerProfileSchema,
    }),
    controller.updateCustomer,
  );
  router.post(
    "/:userId/suspend",
    validateRequest({
      params: adminCustomerParamsSchema,
      body: suspendCustomerSchema,
    }),
    controller.suspendCustomer,
  );
  router.post(
    "/:userId/reactivate",
    validateRequest({ params: adminCustomerParamsSchema }),
    controller.reactivateCustomer,
  );
  return router;
}
