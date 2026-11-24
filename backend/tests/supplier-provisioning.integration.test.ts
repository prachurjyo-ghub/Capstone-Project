import {
  AccountStatus,
  InvitationStatus,
  SupplierBusinessStatus,
  UserRole,
} from "@prisma/client";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createLogger } from "../src/config/logger.js";
import { prisma } from "../src/config/prisma.js";
import { hashPassword } from "../src/modules/auth/password.js";
import { cleanupFulfillment } from "./helpers/cleanup-fulfillment.js";
import type {
  SupplierInvitationDelivery,
  SupplierInvitationMessage,
} from "../src/modules/suppliers/supplier-invitation-delivery.js";

const env = loadEnv();
const logger = createLogger();
const password = "StrongPassword123";
const ownerPassword = "SupplierPassword456";

class MemoryInvitationDelivery implements SupplierInvitationDelivery {
  messages: SupplierInvitationMessage[] = [];

  async deliverSupplierInvitation(message: SupplierInvitationMessage): Promise<void> {
    this.messages.push(message);
  }
}

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
  await prisma.customerProfile.deleteMany();
  await prisma.user.deleteMany();
  await prisma.partCategory.deleteMany();
}

async function provisionUser(email: string, role: UserRole) {
  const user = await prisma.user.create({
    data: {
      email,
      fullName: "Provisioned User",
      passwordHash: await hashPassword(password),
      role,
      accountStatus: AccountStatus.ACTIVE,
    },
  });
  if (role === UserRole.SUPPLIER_OWNER || role === UserRole.SUPPLIER_STAFF) {
    await prisma.supplierBusiness.create({
      data: {
        legalName: `${email} Test Business`,
        displayName: email,
        status: SupplierBusinessStatus.ACTIVE,
        subscriptionGraceEndsAt: new Date("2099-01-01T00:00:00.000Z"),
        members: {
          create: { userId: user.id, isPrimary: role === UserRole.SUPPLIER_OWNER },
        },
      },
    });
  }
  return user;
}

async function login(app: ReturnType<typeof createApp>, email: string, value = password) {
  return request(app)
    .post(`${env.API_PREFIX}/auth/login`)
    .send({ email, password: value });
}

async function adminContext() {
  const delivery = new MemoryInvitationDelivery();
  const app = createApp(env, logger, { supplierInvitationDelivery: delivery });
  const admin = await provisionUser("admin@autopro.test", UserRole.ADMIN);
  const authenticated = await login(app, admin.email);
  return {
    app,
    delivery,
    admin,
    authorization: `Bearer ${authenticated.body.data.accessToken as string}`,
  };
}

async function createBusiness(
  app: ReturnType<typeof createApp>,
  authorization: string,
  displayName = "Dhaka Auto Supply",
) {
  return request(app)
    .post(`${env.API_PREFIX}/admin/suppliers`)
    .set("authorization", authorization)
    .send({
      legalName: `${displayName} Limited`,
      displayName,
      email: "operations@supplier.test",
      phone: "+8801700000088",
      serviceAreas: ["Dhaka"],
    });
}

async function inviteOwner(
  app: ReturnType<typeof createApp>,
  authorization: string,
  businessId: string,
  email: string,
) {
  return request(app)
    .post(`${env.API_PREFIX}/admin/suppliers/${businessId}/invitations/owner`)
    .set("authorization", authorization)
    .send({ email });
}

function invitationToken(message: SupplierInvitationMessage): string {
  const token = new URL(message.activationUrl).searchParams.get("token");
  if (!token) throw new Error("Invitation delivery did not contain a token");
  return token;
}

beforeEach(cleanDatabase);

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

describe("supplier administration permissions", () => {
  it("allows ADMIN and rejects unauthenticated, customer, and supplier users", async () => {
    const { app, authorization } = await adminContext();
    const payload = {
      legalName: "Permission Supplier Ltd",
      displayName: "Permission Supplier",
      serviceAreas: [],
    };

    expect(
      (await request(app).post(`${env.API_PREFIX}/admin/suppliers`).send(payload)).status,
    ).toBe(401);

    for (const [email, role] of [
      ["customer@autopro.test", UserRole.CUSTOMER],
      ["supplier@autopro.test", UserRole.SUPPLIER_OWNER],
    ] as const) {
      await provisionUser(email, role);
      const authenticated = await login(app, email);
      const denied = await request(app)
        .post(`${env.API_PREFIX}/admin/suppliers`)
        .set("authorization", `Bearer ${authenticated.body.data.accessToken as string}`)
        .send(payload);
      expect(denied.status).toBe(403);
    }

    const allowed = await request(app)
      .post(`${env.API_PREFIX}/admin/suppliers`)
      .set("authorization", authorization)
      .send(payload);
    expect(allowed.status).toBe(201);
    expect(allowed.body.data.status).toBe(SupplierBusinessStatus.DRAFT);
  });
});

describe("business profile, categories, and locations", () => {
  it("creates, lists, views, and updates business-owned configuration", async () => {
    const { app, authorization } = await adminContext();
    await prisma.partCategory.createMany({
      data: [
        { name: "Braking", slug: "braking", isActive: true },
        { name: "Engine", slug: "engine", isActive: true },
      ],
    });
    const created = await createBusiness(app, authorization);
    expect(created.status).toBe(201);
    const businessId = created.body.data.id as string;
    expect(created.body.data.businessCode).toMatch(/^SUP-[A-F0-9]{10}$/);

    const updated = await request(app)
      .patch(`${env.API_PREFIX}/admin/suppliers/${businessId}`)
      .set("authorization", authorization)
      .send({ displayName: "Updated Auto Supply", serviceAreas: ["Dhaka", "Savar"] });
    expect(updated.status).toBe(200);
    expect(updated.body.data.displayName).toBe("Updated Auto Supply");

    const categories = await request(app)
      .put(`${env.API_PREFIX}/admin/suppliers/${businessId}/supported-categories`)
      .set("authorization", authorization)
      .send({ categories: ["braking", "engine", "braking"] });
    expect(categories.status).toBe(200);
    expect(categories.body.data.supportedCategories).toEqual(["braking", "engine"]);

    const firstLocation = await request(app)
      .post(`${env.API_PREFIX}/admin/suppliers/${businessId}/locations`)
      .set("authorization", authorization)
      .send({
        label: "Warehouse",
        addressLine: "100 Tejgaon Industrial Area",
        city: "Dhaka",
        isPrimary: true,
      });
    expect(firstLocation.status).toBe(201);
    expect(firstLocation.body.data.isPrimary).toBe(true);

    const secondBusiness = await createBusiness(app, authorization, "Chattogram Parts");
    const wrongOwnerUpdate = await request(app)
      .patch(
        `${env.API_PREFIX}/admin/suppliers/${secondBusiness.body.data.id}/locations/${firstLocation.body.data.id}`,
      )
      .set("authorization", authorization)
      .send({ label: "Wrong business" });
    expect(wrongOwnerUpdate.status).toBe(404);

    const deactivated = await request(app)
      .delete(
        `${env.API_PREFIX}/admin/suppliers/${businessId}/locations/${firstLocation.body.data.id}`,
      )
      .set("authorization", authorization);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data).toMatchObject({ isActive: false, isPrimary: false });

    const listed = await request(app)
      .get(`${env.API_PREFIX}/admin/suppliers?search=Updated&page=1&pageSize=10`)
      .set("authorization", authorization);
    expect(listed.status).toBe(200);
    expect(listed.body.data.total).toBe(1);

    const viewed = await request(app)
      .get(`${env.API_PREFIX}/admin/suppliers/${businessId}`)
      .set("authorization", authorization);
    expect(viewed.status).toBe(200);
    expect(viewed.body.data.locations).toHaveLength(1);
    const serialized = JSON.stringify(viewed.body);
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("tokenHash");
  });
});

describe("initial owner invitations", () => {
  it("accepts an invitation atomically, remains DRAFT, then supports login and explicit activation", async () => {
    const { app, delivery, authorization } = await adminContext();
    const created = await createBusiness(app, authorization);
    const businessId = created.body.data.id as string;
    const invited = await inviteOwner(
      app,
      authorization,
      businessId,
      "owner@supplier.test",
    );
    expect(invited.status).toBe(201);
    expect(JSON.stringify(invited.body)).not.toContain("tokenHash");
    expect(delivery.messages).toHaveLength(1);

    const accepted = await request(app)
      .post(`${env.API_PREFIX}/supplier-invitations/accept`)
      .send({
        token: invitationToken(delivery.messages[0]!),
        fullName: "Supplier Owner",
        password: ownerPassword,
      });
    expect(accepted.status).toBe(201);
    expect(accepted.body.data.accessToken).toBeUndefined();

    const businessAfterAcceptance = await prisma.supplierBusiness.findUniqueOrThrow({
      where: { id: businessId },
      include: { members: true, ownerUser: true },
    });
    expect(businessAfterAcceptance.status).toBe(SupplierBusinessStatus.DRAFT);
    expect(businessAfterAcceptance.ownerUser).toMatchObject({
      email: "owner@supplier.test",
      fullName: "Supplier Owner",
      role: UserRole.SUPPLIER_OWNER,
    });
    expect(businessAfterAcceptance.members).toHaveLength(1);
    expect(businessAfterAcceptance.members[0]).toMatchObject({
      isPrimary: true,
      isActive: true,
    });

    const ownerLogin = await login(app, "owner@supplier.test", ownerPassword);
    expect(ownerLogin.status).toBe(403);

    expect(
      (
        await request(app)
          .post(`${env.API_PREFIX}/admin/suppliers/${businessId}/status/submit-review`)
          .set("authorization", authorization)
      ).body.data.status,
    ).toBe(SupplierBusinessStatus.PENDING_REVIEW);
    expect(
      (
        await request(app)
          .post(`${env.API_PREFIX}/admin/suppliers/${businessId}/status/activate`)
          .set("authorization", authorization)
      ).body.data.status,
    ).toBe(SupplierBusinessStatus.ACTIVE);

    await prisma.supplierBusiness.update({
      where: { id: businessId },
      data: { subscriptionGraceEndsAt: new Date("2099-01-01T00:00:00.000Z") },
    });
    const activatedLogin = await login(app, "owner@supplier.test", ownerPassword);
    expect(activatedLogin.status).toBe(200);
    const ownerAuthorization = `Bearer ${activatedLogin.body.data.accessToken as string}`;

    const afterActivation = await request(app)
      .get(`${env.API_PREFIX}/auth/access/supplier`)
      .set("authorization", ownerAuthorization)
      .set("x-business-id", businessId);
    expect(afterActivation.status).toBe(200);
  });

  it("returns safe failures for invalid, expired, revoked, and used invitations", async () => {
    const { app, delivery, authorization } = await adminContext();

    const invalid = await request(app)
      .post(`${env.API_PREFIX}/supplier-invitations/accept`)
      .send({
        token: "x".repeat(64),
        fullName: "Invalid Person",
        password: ownerPassword,
      });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("INVALID_SUPPLIER_INVITATION");

    const expiredBusiness = await createBusiness(app, authorization, "Expired Supplier");
    await inviteOwner(
      app,
      authorization,
      expiredBusiness.body.data.id,
      "expired@supplier.test",
    );
    const expiredMessage = delivery.messages.at(-1)!;
    await prisma.accountInvitation.updateMany({
      where: { businessId: expiredBusiness.body.data.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const expired = await request(app)
      .post(`${env.API_PREFIX}/supplier-invitations/accept`)
      .send({
        token: invitationToken(expiredMessage),
        fullName: "Expired Person",
        password: ownerPassword,
      });
    expect(expired.status).toBe(400);

    const revokedBusiness = await createBusiness(app, authorization, "Revoked Supplier");
    const revokedInvite = await inviteOwner(
      app,
      authorization,
      revokedBusiness.body.data.id,
      "revoked@supplier.test",
    );
    const revokedMessage = delivery.messages.at(-1)!;
    await request(app)
      .post(
        `${env.API_PREFIX}/admin/suppliers/${revokedBusiness.body.data.id}/invitations/${revokedInvite.body.data.id}/revoke`,
      )
      .set("authorization", authorization);
    const revoked = await request(app)
      .post(`${env.API_PREFIX}/supplier-invitations/accept`)
      .send({
        token: invitationToken(revokedMessage),
        fullName: "Revoked Person",
        password: ownerPassword,
      });
    expect(revoked.status).toBe(400);

    const usedBusiness = await createBusiness(app, authorization, "Used Supplier");
    await inviteOwner(
      app,
      authorization,
      usedBusiness.body.data.id,
      "used@supplier.test",
    );
    const usedToken = invitationToken(delivery.messages.at(-1)!);
    const payload = {
      token: usedToken,
      fullName: "Used Person",
      password: ownerPassword,
    };
    expect(
      (
        await request(app)
          .post(`${env.API_PREFIX}/supplier-invitations/accept`)
          .send(payload)
      ).status,
    ).toBe(201);
    const usedAgain = await request(app)
      .post(`${env.API_PREFIX}/supplier-invitations/accept`)
      .send(payload);
    expect(usedAgain.status).toBe(400);
    expect(usedAgain.body.error.code).toBe("INVALID_SUPPLIER_INVITATION");
  });

  it("resending revokes the previous token and delivers a usable replacement", async () => {
    const { app, delivery, authorization } = await adminContext();
    const created = await createBusiness(app, authorization);
    const businessId = created.body.data.id as string;
    const invited = await inviteOwner(
      app,
      authorization,
      businessId,
      "resend@supplier.test",
    );
    const oldToken = invitationToken(delivery.messages[0]!);

    const resent = await request(app)
      .post(
        `${env.API_PREFIX}/admin/suppliers/${businessId}/invitations/${invited.body.data.id}/resend`,
      )
      .set("authorization", authorization);
    expect(resent.status).toBe(201);
    expect(delivery.messages).toHaveLength(2);
    const newToken = invitationToken(delivery.messages[1]!);

    const oldResponse = await request(app)
      .post(`${env.API_PREFIX}/supplier-invitations/accept`)
      .send({ token: oldToken, fullName: "Old Link", password: ownerPassword });
    expect(oldResponse.status).toBe(400);

    const replacement = await request(app)
      .post(`${env.API_PREFIX}/supplier-invitations/accept`)
      .send({ token: newToken, fullName: "New Link", password: ownerPassword });
    expect(replacement.status).toBe(201);
    expect(
      await prisma.accountInvitation.count({
        where: { businessId, status: InvitationStatus.REVOKED },
      }),
    ).toBe(1);
  });

  it("does not overwrite or link an existing account through public acceptance", async () => {
    const { app, delivery, authorization } = await adminContext();
    const existing = await provisionUser("existing@autopro.test", UserRole.CUSTOMER);
    const created = await createBusiness(app, authorization);
    await inviteOwner(app, authorization, created.body.data.id, existing.email);
    const response = await request(app)
      .post(`${env.API_PREFIX}/supplier-invitations/accept`)
      .send({
        token: invitationToken(delivery.messages[0]!),
        fullName: "Attempted Replacement",
        password: ownerPassword,
      });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVITED_EMAIL_ALREADY_REGISTERED");
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: existing.id } }),
    ).toMatchObject({
      role: UserRole.CUSTOMER,
      fullName: "Provisioned User",
    });
    expect(await prisma.supplierUser.count()).toBe(0);
  });

  it("allows exactly one concurrent acceptance and one primary membership", async () => {
    const { app, delivery, authorization } = await adminContext();
    const created = await createBusiness(app, authorization);
    const businessId = created.body.data.id as string;
    await inviteOwner(app, authorization, businessId, "race@supplier.test");
    const payload = {
      token: invitationToken(delivery.messages[0]!),
      fullName: "Concurrent Owner",
      password: ownerPassword,
    };

    const results = await Promise.all([
      request(app).post(`${env.API_PREFIX}/supplier-invitations/accept`).send(payload),
      request(app).post(`${env.API_PREFIX}/supplier-invitations/accept`).send(payload),
    ]);
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(results.filter((result) => result.status !== 201)).toHaveLength(1);
    expect(await prisma.user.count({ where: { email: "race@supplier.test" } })).toBe(1);
    expect(
      await prisma.supplierUser.count({
        where: { businessId, isPrimary: true, leftAt: null },
      }),
    ).toBe(1);
  });
});

describe("business suspension and disablement", () => {
  it("revokes sessions on suspension and immediately blocks new supplier access", async () => {
    const { app, delivery, authorization } = await adminContext();
    const created = await createBusiness(app, authorization);
    const businessId = created.body.data.id as string;
    await inviteOwner(app, authorization, businessId, "status-owner@supplier.test");
    await request(app)
      .post(`${env.API_PREFIX}/supplier-invitations/accept`)
      .send({
        token: invitationToken(delivery.messages[0]!),
        fullName: "Status Owner",
        password: ownerPassword,
      });
    await request(app)
      .post(`${env.API_PREFIX}/admin/suppliers/${businessId}/status/submit-review`)
      .set("authorization", authorization);
    await request(app)
      .post(`${env.API_PREFIX}/admin/suppliers/${businessId}/status/activate`)
      .set("authorization", authorization);
    await prisma.supplierBusiness.update({
      where: { id: businessId },
      data: { subscriptionGraceEndsAt: new Date("2099-01-01T00:00:00.000Z") },
    });

    const before = await login(app, "status-owner@supplier.test", ownerPassword);
    const oldAuthorization = `Bearer ${before.body.data.accessToken as string}`;
    expect(
      (
        await request(app)
          .get(`${env.API_PREFIX}/auth/access/supplier`)
          .set("authorization", oldAuthorization)
          .set("x-business-id", businessId)
      ).status,
    ).toBe(200);

    const suspended = await request(app)
      .post(`${env.API_PREFIX}/admin/suppliers/${businessId}/status/suspend`)
      .set("authorization", authorization)
      .send({ reason: "Compliance review" });
    expect(suspended.status).toBe(200);
    expect(suspended.body.data.status).toBe(SupplierBusinessStatus.SUSPENDED);
    expect(
      (
        await request(app)
          .get(`${env.API_PREFIX}/auth/access/supplier`)
          .set("authorization", oldAuthorization)
          .set("x-business-id", businessId)
      ).status,
    ).toBe(401);

    const afterSuspensionLogin = await login(
      app,
      "status-owner@supplier.test",
      ownerPassword,
    );
    expect(afterSuspensionLogin.status).toBe(403);
    expect(afterSuspensionLogin.body.error.code).toBe("SUPPLIER_BUSINESS_SUSPENDED");

    await request(app)
      .post(`${env.API_PREFIX}/admin/suppliers/${businessId}/status/activate`)
      .set("authorization", authorization);
    const disabled = await request(app)
      .post(`${env.API_PREFIX}/admin/suppliers/${businessId}/status/disable`)
      .set("authorization", authorization)
      .send({ reason: "Business closed" });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.status).toBe(SupplierBusinessStatus.CLOSED);
    expect(
      await prisma.supplierUser.count({
        where: { businessId, isActive: true },
      }),
    ).toBe(0);
  });
});
