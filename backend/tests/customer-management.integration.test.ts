import { AccountStatus, UserRole } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createLogger } from "../src/config/logger.js";
import { prisma } from "../src/config/prisma.js";
import { hashPassword } from "../src/modules/auth/password.js";
import { cleanupFulfillment } from "./helpers/cleanup-fulfillment.js";

const env = loadEnv();
const logger = createLogger();
const password = "StrongPassword123";

async function cleanDatabase(): Promise<void> {
  await cleanupFulfillment(prisma);
  await prisma.auditLog.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.refreshSession.deleteMany();
  await prisma.accountInvitation.deleteMany();
  await prisma.sourcingRequest.deleteMany();
  await prisma.inventoryCsvPreview.deleteMany();
  await prisma.inventoryStockAdjustment.deleteMany();
  await prisma.supplierInventory.deleteMany();
  await prisma.supplierUser.deleteMany();
  await prisma.supplierBusiness.deleteMany();
  await prisma.productCompatibility.deleteMany();
  await prisma.productNumber.deleteMany();
  await prisma.product.deleteMany();
  await prisma.brand.deleteMany();
  await prisma.partCategory.deleteMany();
  await prisma.customerProfile.deleteMany();
  await prisma.user.deleteMany();
}

async function provisionUser(
  email: string,
  role: UserRole,
  withCustomerProfile = role === UserRole.CUSTOMER,
) {
  return prisma.user.create({
    data: {
      email,
      fullName: withCustomerProfile ? "Original Customer" : "Provisioned User",
      phone: withCustomerProfile ? "+8801700000001" : null,
      passwordHash: await hashPassword(password),
      role,
      accountStatus: AccountStatus.ACTIVE,
      customerProfile: withCustomerProfile
        ? { create: { fullName: "Original Customer", preferredName: "Original" } }
        : undefined,
    },
    include: { customerProfile: true },
  });
}

async function login(app: ReturnType<typeof createApp>, email: string) {
  return request(app).post(`${env.API_PREFIX}/auth/login`).send({ email, password });
}

async function authorizedUser(
  app: ReturnType<typeof createApp>,
  email: string,
  role: UserRole,
) {
  const user = await provisionUser(email, role);
  if (role === UserRole.SUPPLIER_OWNER || role === UserRole.SUPPLIER_STAFF) {
    await prisma.supplierBusiness.create({
      data: {
        legalName: `${email} Test Business`,
        displayName: email,
        status: "ACTIVE",
        subscriptionGraceEndsAt: new Date("2099-01-01T00:00:00.000Z"),
        members: {
          create: { userId: user.id, isPrimary: role === UserRole.SUPPLIER_OWNER },
        },
      },
    });
  }
  const authenticated = await login(app, email);
  expect(authenticated.status).toBe(200);
  return {
    user,
    authorization: `Bearer ${authenticated.body.data.accessToken as string}`,
  };
}

function addressPayload(recipientName: string, isDefault = false) {
  return {
    label: "Home",
    recipientName,
    phone: "+8801700000099",
    addressLine: "12 Test Road",
    addressLine2: "Floor 3",
    area: "Dhanmondi",
    city: "Dhaka",
    postalCode: "1209",
    landmark: "Near the lake",
    deliveryInstructions: "Call on arrival",
    isDefault,
  };
}

beforeEach(cleanDatabase);

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

describe("customer profile", () => {
  it("returns the authenticated profile and updates only approved fields", async () => {
    const app = createApp(env, logger);
    const { user, authorization } = await authorizedUser(
      app,
      "profile@autopro.test",
      UserRole.CUSTOMER,
    );

    const viewed = await request(app)
      .get(`${env.API_PREFIX}/customers/me`)
      .set("authorization", authorization);
    expect(viewed.status).toBe(200);
    expect(viewed.body.data).toMatchObject({
      id: user.id,
      email: user.email,
      role: UserRole.CUSTOMER,
      profile: { fullName: "Original Customer", preferredName: "Original" },
    });

    const updated = await request(app)
      .patch(`${env.API_PREFIX}/customers/me`)
      .set("authorization", authorization)
      .send({
        fullName: "Updated Customer",
        preferredName: "Updated",
        companyName: "Example Garage",
      });
    expect(updated.status).toBe(200);
    expect(updated.body.data.profile).toMatchObject({
      fullName: "Updated Customer",
      preferredName: "Updated",
      companyName: "Example Garage",
    });
    expect(updated.body.data.email).toBe(user.email);

    const serialized = JSON.stringify(updated.body);
    for (const forbidden of ["passwordHash", "tokenHash", "suspendedReason", "notes"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("rejects protected profile fields without changing the account", async () => {
    const app = createApp(env, logger);
    const { user, authorization } = await authorizedUser(
      app,
      "protected@autopro.test",
      UserRole.CUSTOMER,
    );
    const rejected = await request(app)
      .patch(`${env.API_PREFIX}/customers/me`)
      .set("authorization", authorization)
      .send({
        fullName: "Attempted Update",
        email: "changed@autopro.test",
        role: UserRole.SUPER_ADMIN,
        accountStatus: AccountStatus.ACTIVE,
        password: "ChangedPassword123",
        emailVerifiedAt: new Date().toISOString(),
        supplierMemberships: [],
      });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe("VALIDATION_ERROR");

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { customerProfile: true },
    });
    expect(stored).toMatchObject({
      email: "protected@autopro.test",
      role: UserRole.CUSTOMER,
      fullName: "Original Customer",
    });
    expect(stored.customerProfile?.fullName).toBe("Original Customer");
  });
});

describe("saved addresses", () => {
  it("supports CRUD and promotes the oldest remaining address when the default is deleted", async () => {
    const app = createApp(env, logger);
    const { authorization } = await authorizedUser(
      app,
      "addresses@autopro.test",
      UserRole.CUSTOMER,
    );
    const first = await request(app)
      .post(`${env.API_PREFIX}/customers/me/addresses`)
      .set("authorization", authorization)
      .send(addressPayload("First Recipient"));
    const second = await request(app)
      .post(`${env.API_PREFIX}/customers/me/addresses`)
      .set("authorization", authorization)
      .send(addressPayload("Second Recipient", true));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const updated = await request(app)
      .patch(`${env.API_PREFIX}/customers/me/addresses/${first.body.data.id}`)
      .set("authorization", authorization)
      .send({ label: "Office", deliveryInstructions: null });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      label: "Office",
      deliveryInstructions: null,
    });

    const deleted = await request(app)
      .delete(`${env.API_PREFIX}/customers/me/addresses/${second.body.data.id}`)
      .set("authorization", authorization);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.promotedDefaultAddressId).toBe(first.body.data.id);

    const listed = await request(app)
      .get(`${env.API_PREFIX}/customers/me/addresses`)
      .set("authorization", authorization);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]).toMatchObject({
      id: first.body.data.id,
      isDefault: true,
    });

    const softDeleted = await prisma.customerAddress.findUniqueOrThrow({
      where: { id: second.body.data.id },
    });
    expect(softDeleted.isActive).toBe(false);
    expect(softDeleted.deletedAt).toBeInstanceOf(Date);
  });

  it("serializes concurrent default selection so exactly one address remains default", async () => {
    const app = createApp(env, logger);
    const { user, authorization } = await authorizedUser(
      app,
      "concurrent@autopro.test",
      UserRole.CUSTOMER,
    );
    const first = await request(app)
      .post(`${env.API_PREFIX}/customers/me/addresses`)
      .set("authorization", authorization)
      .send(addressPayload("First Recipient"));
    const second = await request(app)
      .post(`${env.API_PREFIX}/customers/me/addresses`)
      .set("authorization", authorization)
      .send(addressPayload("Second Recipient"));

    const results = await Promise.all([
      request(app)
        .post(`${env.API_PREFIX}/customers/me/addresses/${first.body.data.id}/default`)
        .set("authorization", authorization),
      request(app)
        .post(`${env.API_PREFIX}/customers/me/addresses/${second.body.data.id}/default`)
        .set("authorization", authorization),
    ]);
    expect(results.map((response) => response.status)).toEqual([200, 200]);

    const customer = await prisma.customerProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(
      await prisma.customerAddress.count({
        where: {
          customerId: customer.id,
          isDefault: true,
          isActive: true,
          deletedAt: null,
        },
      }),
    ).toBe(1);
  });

  it("hides another customer's addresses behind the same not-found response", async () => {
    const app = createApp(env, logger);
    const first = await authorizedUser(app, "owner@autopro.test", UserRole.CUSTOMER);
    const other = await authorizedUser(app, "other@autopro.test", UserRole.CUSTOMER);
    const created = await request(app)
      .post(`${env.API_PREFIX}/customers/me/addresses`)
      .set("authorization", first.authorization)
      .send(addressPayload("Owner Recipient"));

    for (const action of [
      request(app)
        .patch(`${env.API_PREFIX}/customers/me/addresses/${created.body.data.id}`)
        .set("authorization", other.authorization)
        .send({ label: "Stolen" }),
      request(app)
        .post(`${env.API_PREFIX}/customers/me/addresses/${created.body.data.id}/default`)
        .set("authorization", other.authorization),
      request(app)
        .delete(`${env.API_PREFIX}/customers/me/addresses/${created.body.data.id}`)
        .set("authorization", other.authorization),
    ]) {
      const response = await action;
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("CUSTOMER_ADDRESS_NOT_FOUND");
    }
  });
});

describe("saved vehicles", () => {
  it("supports optional details, flexible chassis identifiers, validation, CRUD, and ownership", async () => {
    const app = createApp(env, logger);
    const owner = await authorizedUser(app, "vehicle@autopro.test", UserRole.CUSTOMER);
    const other = await authorizedUser(
      app,
      "vehicle-other@autopro.test",
      UserRole.CUSTOMER,
    );
    const minimal = await request(app)
      .post(`${env.API_PREFIX}/customers/me/vehicles`)
      .set("authorization", owner.authorization)
      .send({ make: "Toyota", model: "Corolla" });
    expect(minimal.status).toBe(201);
    expect(minimal.body.data).toMatchObject({
      make: "Toyota",
      model: "Corolla",
      year: null,
    });

    const flexibleChassis = await request(app)
      .post(`${env.API_PREFIX}/customers/me/vehicles`)
      .set("authorization", owner.authorization)
      .send({
        make: "Honda",
        model: "Vezel",
        year: 2021,
        variant: "Hybrid Z",
        registrationNumber: "DHAKA-METRO-11",
        chassisVin: "RU3-1234567",
        engineInfo: "1.5L hybrid",
        notes: "Imported vehicle",
      });
    expect(flexibleChassis.status).toBe(201);
    expect(flexibleChassis.body.data.chassisVin).toBe("RU3-1234567");

    const invalid = await request(app)
      .post(`${env.API_PREFIX}/customers/me/vehicles`)
      .set("authorization", owner.authorization)
      .send({ make: "Toyota", model: "Corolla", year: 1800 });
    expect(invalid.status).toBe(400);

    const crossCustomer = await request(app)
      .patch(`${env.API_PREFIX}/customers/me/vehicles/${minimal.body.data.id}`)
      .set("authorization", other.authorization)
      .send({ notes: "Not mine" });
    expect(crossCustomer.status).toBe(404);
    expect(crossCustomer.body.error.code).toBe("CUSTOMER_VEHICLE_NOT_FOUND");

    const updated = await request(app)
      .patch(`${env.API_PREFIX}/customers/me/vehicles/${minimal.body.data.id}`)
      .set("authorization", owner.authorization)
      .send({ year: 2020, notes: "Family car" });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ year: 2020, notes: "Family car" });

    const listed = await request(app)
      .get(`${env.API_PREFIX}/customers/me/vehicles`)
      .set("authorization", owner.authorization);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(2);

    const deleted = await request(app)
      .delete(`${env.API_PREFIX}/customers/me/vehicles/${minimal.body.data.id}`)
      .set("authorization", owner.authorization);
    expect(deleted.status).toBe(200);
    const stored = await prisma.vehicle.findUniqueOrThrow({
      where: { id: minimal.body.data.id },
    });
    expect(stored).toMatchObject({ isActive: false });
    expect(stored.deletedAt).toBeInstanceOf(Date);
  });
});

describe("admin customer management", () => {
  it("enforces admin roles, supports bounded listing/details/updates, and excludes non-customers", async () => {
    const app = createApp(env, logger);
    const admin = await authorizedUser(app, "admin@autopro.test", UserRole.ADMIN);
    const customer = await authorizedUser(
      app,
      "searchable@autopro.test",
      UserRole.CUSTOMER,
    );
    const supplier = await authorizedUser(
      app,
      "supplier@autopro.test",
      UserRole.SUPPLIER_STAFF,
    );

    const deniedCustomer = await request(app)
      .get(`${env.API_PREFIX}/admin/customers`)
      .set("authorization", customer.authorization);
    const deniedSupplier = await request(app)
      .get(`${env.API_PREFIX}/admin/customers`)
      .set("authorization", supplier.authorization);
    expect(deniedCustomer.status).toBe(403);
    expect(deniedSupplier.status).toBe(403);

    const listed = await request(app)
      .get(
        `${env.API_PREFIX}/admin/customers?search=searchable&page=1&pageSize=10&status=ACTIVE`,
      )
      .set("authorization", admin.authorization);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(listed.body.data.items[0].id).toBe(customer.user.id);
    expect(JSON.stringify(listed.body)).not.toContain(supplier.user.id);

    const oversized = await request(app)
      .get(`${env.API_PREFIX}/admin/customers?pageSize=101`)
      .set("authorization", admin.authorization);
    expect(oversized.status).toBe(400);

    const updated = await request(app)
      .patch(`${env.API_PREFIX}/admin/customers/${customer.user.id}`)
      .set("authorization", admin.authorization)
      .send({ preferredName: "Admin Approved" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.profile.preferredName).toBe("Admin Approved");

    const protectedUpdate = await request(app)
      .patch(`${env.API_PREFIX}/admin/customers/${customer.user.id}`)
      .set("authorization", admin.authorization)
      .send({ role: UserRole.ADMIN });
    expect(protectedUpdate.status).toBe(400);

    const supplierDetail = await request(app)
      .get(`${env.API_PREFIX}/admin/customers/${supplier.user.id}`)
      .set("authorization", admin.authorization);
    expect(supplierDetail.status).toBe(404);
  });

  it("requires a reason, revokes sessions on suspension, and reactivates without restoring them", async () => {
    const app = createApp(env, logger);
    const admin = await authorizedUser(
      app,
      "suspending-admin@autopro.test",
      UserRole.ADMIN,
    );
    const customer = await authorizedUser(
      app,
      "suspended-customer@autopro.test",
      UserRole.CUSTOMER,
    );

    const missingReason = await request(app)
      .post(`${env.API_PREFIX}/admin/customers/${customer.user.id}/suspend`)
      .set("authorization", admin.authorization)
      .send({});
    expect(missingReason.status).toBe(400);

    const suspended = await request(app)
      .post(`${env.API_PREFIX}/admin/customers/${customer.user.id}/suspend`)
      .set("authorization", admin.authorization)
      .send({ reason: "Repeated policy violations" });
    expect(suspended.status).toBe(200);
    expect(suspended.body.data.accountStatus).toBe(AccountStatus.SUSPENDED);

    const oldSession = await request(app)
      .get(`${env.API_PREFIX}/customers/me`)
      .set("authorization", customer.authorization);
    expect(oldSession.status).toBe(401);
    expect(oldSession.body.error.code).toBe("SESSION_REVOKED");
    expect((await login(app, customer.user.email)).status).toBe(403);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "ADMIN_CUSTOMER_SUSPENDED", entityId: customer.user.id },
    });
    expect(audit.metadata).toMatchObject({ reason: "Repeated policy violations" });

    const reactivated = await request(app)
      .post(`${env.API_PREFIX}/admin/customers/${customer.user.id}/reactivate`)
      .set("authorization", admin.authorization);
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.data.accountStatus).toBe(AccountStatus.ACTIVE);
    expect(
      (
        await request(app)
          .get(`${env.API_PREFIX}/customers/me`)
          .set("authorization", customer.authorization)
      ).status,
    ).toBe(401);
    expect((await login(app, customer.user.email)).status).toBe(200);
  });
});

describe("historical references", () => {
  it("preserves saved address and vehicle rows referenced by a sourcing request", async () => {
    const app = createApp(env, logger);
    const { user, authorization } = await authorizedUser(
      app,
      "history@autopro.test",
      UserRole.CUSTOMER,
    );
    const address = await request(app)
      .post(`${env.API_PREFIX}/customers/me/addresses`)
      .set("authorization", authorization)
      .send(addressPayload("Historical Recipient", true));
    const vehicle = await request(app)
      .post(`${env.API_PREFIX}/customers/me/vehicles`)
      .set("authorization", authorization)
      .send({ make: "Toyota", model: "Premio", chassisVin: "NZT260-12345" });
    const profile = await prisma.customerProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    const sourcingRequest = await prisma.sourcingRequest.create({
      data: {
        requestNumber: "RFQ-TASK5-HISTORY",
        customerId: profile.id,
        deliveryAddressId: address.body.data.id,
        vehicleId: vehicle.body.data.id,
        title: "Historical reference fixture",
      },
    });

    const replacementAddress = await request(app)
      .patch(`${env.API_PREFIX}/customers/me/addresses/${address.body.data.id}`)
      .set("authorization", authorization)
      .send({ recipientName: "Current Recipient" });
    const replacementVehicle = await request(app)
      .patch(`${env.API_PREFIX}/customers/me/vehicles/${vehicle.body.data.id}`)
      .set("authorization", authorization)
      .send({ make: "Honda" });
    expect(replacementAddress.status).toBe(200);
    expect(replacementVehicle.status).toBe(200);
    expect(replacementAddress.body.data.id).not.toBe(address.body.data.id);
    expect(replacementVehicle.body.data.id).not.toBe(vehicle.body.data.id);

    expect(
      (
        await request(app)
          .delete(
            `${env.API_PREFIX}/customers/me/addresses/${replacementAddress.body.data.id}`,
          )
          .set("authorization", authorization)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .delete(
            `${env.API_PREFIX}/customers/me/vehicles/${replacementVehicle.body.data.id}`,
          )
          .set("authorization", authorization)
      ).status,
    ).toBe(200);

    const retained = await prisma.sourcingRequest.findUniqueOrThrow({
      where: { id: sourcingRequest.id },
      include: { deliveryAddress: true, vehicle: true },
    });
    expect(retained.deliveryAddressId).toBe(address.body.data.id);
    expect(retained.vehicleId).toBe(vehicle.body.data.id);
    expect(retained.deliveryAddress).toMatchObject({
      recipientName: "Historical Recipient",
      isActive: false,
    });
    expect(retained.vehicle).toMatchObject({ make: "Toyota", isActive: false });
  });
});
