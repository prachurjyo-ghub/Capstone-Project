import { AccountStatus, SupplierBusinessStatus, UserRole } from "@prisma/client";
import request from "supertest";
import { gzipSync } from "node:zlib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createLogger } from "../src/config/logger.js";
import { prisma } from "../src/config/prisma.js";
import { hashPassword } from "../src/modules/auth/password.js";
import { cleanupFulfillment } from "./helpers/cleanup-fulfillment.js";
import type {
  PasswordRecoveryMessage,
  RecoveryDelivery,
} from "../src/modules/auth/recovery-delivery.js";

const origin = "http://localhost:3000";
const password = "StrongPassword123";
const resetPassword = "AnotherStrong456";

class MemoryRecoveryDelivery implements RecoveryDelivery {
  messages: PasswordRecoveryMessage[] = [];

  async deliverPasswordRecovery(message: PasswordRecoveryMessage): Promise<void> {
    this.messages.push(message);
  }
}

const env = loadEnv();
const logger = createLogger();

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

function registration(email = "customer@example.com") {
  return {
    email,
    password,
    fullName: "Test Customer",
    preferredName: "Test",
    phone: "+8801700000099",
  };
}

function cookieValue(cookies: string[], name: string): string {
  const cookie = cookies.find((value) => value.startsWith(`${name}=`));
  if (!cookie) throw new Error(`Cookie ${name} was not set`);
  return cookie.split(";", 1)[0]!;
}

function responseCookies(response: request.Response): string[] {
  const value = response.headers["set-cookie"];
  return Array.isArray(value) ? value : value ? [value] : [];
}

async function provisionUser(
  email: string,
  role: UserRole,
  accountStatus = AccountStatus.ACTIVE,
) {
  return prisma.user.create({
    data: { email, passwordHash: await hashPassword(password), role, accountStatus },
  });
}

async function login(email: string) {
  return request(
    createApp(env, logger, { recoveryDelivery: new MemoryRecoveryDelivery() }),
  )
    .post(`${env.API_PREFIX}/auth/login`)
    .send({ email, password });
}

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

describe("customer registration and login", () => {
  it("rejects malformed and trailing-byte compressed JSON safely", async () => {
    const app = createApp(env, logger, {
      recoveryDelivery: new MemoryRecoveryDelivery(),
    });
    const malformed = await request(app)
      .post(`${env.API_PREFIX}/auth/login`)
      .set("content-type", "application/json")
      .send('{"email":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("INVALID_JSON");

    const compressed = Buffer.concat([
      gzipSync(Buffer.from(JSON.stringify({ email: "nobody@example.com", password }))),
      Buffer.from("unexpected trailing bytes"),
    ]);
    const trailing = await request(app)
      .post(`${env.API_PREFIX}/auth/login`)
      .set("content-type", "application/json")
      .set("content-encoding", "gzip")
      .send(compressed);
    expect(trailing.status).toBe(400);
  });

  it("atomically registers only a CUSTOMER and CustomerProfile", async () => {
    const app = createApp(env, logger, {
      recoveryDelivery: new MemoryRecoveryDelivery(),
    });
    const response = await request(app)
      .post(`${env.API_PREFIX}/auth/register`)
      .send({ ...registration(), role: UserRole.SUPER_ADMIN, accountStatus: "ACTIVE" });

    expect(response.status).toBe(400);

    const successful = await request(app)
      .post(`${env.API_PREFIX}/auth/register`)
      .send(registration());
    expect(successful.status).toBe(201);
    expect(successful.body.data.account).toMatchObject({
      email: "customer@example.com",
      role: UserRole.CUSTOMER,
      accountStatus: AccountStatus.PENDING_VERIFICATION,
      emailVerified: false,
      customerProfile: { fullName: "Test Customer" },
    });
    expect(successful.body.data.refreshToken).toBeUndefined();
    expect(
      responseCookies(successful).some((cookie) => cookie.includes("HttpOnly")),
    ).toBe(true);

    const stored = await prisma.user.findUnique({
      where: { email: "customer@example.com" },
      include: { customerProfile: true },
    });
    expect(stored?.role).toBe(UserRole.CUSTOMER);
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored?.customerProfile?.fullName).toBe("Test Customer");
  });

  it("rejects duplicate registration without creating another profile", async () => {
    const app = createApp(env, logger, {
      recoveryDelivery: new MemoryRecoveryDelivery(),
    });
    await request(app).post(`${env.API_PREFIX}/auth/register`).send(registration());
    const duplicate = await request(app)
      .post(`${env.API_PREFIX}/auth/register`)
      .send(registration());

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("EMAIL_ALREADY_REGISTERED");
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.customerProfile.count()).toBe(1);
  });

  it("accepts valid credentials and uses the same generic error for invalid credentials", async () => {
    await provisionUser("valid@example.com", UserRole.ADMIN);
    const valid = await login("valid@example.com");
    expect(valid.status).toBe(200);
    expect(valid.body.data.accessToken).toEqual(expect.any(String));

    const wrongPassword = await request(createApp(env, logger))
      .post(`${env.API_PREFIX}/auth/login`)
      .send({ email: "valid@example.com", password: "wrong" });
    const unknownAccount = await request(createApp(env, logger))
      .post(`${env.API_PREFIX}/auth/login`)
      .send({ email: "missing@example.com", password: "wrong" });
    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    expect(wrongPassword.body.error).toEqual(unknownAccount.body.error);
  });
});

describe("authentication and permissions", () => {
  it("authenticates /me, excludes security fields, and enforces role middleware", async () => {
    const app = createApp(env, logger);
    const registered = await request(app)
      .post(`${env.API_PREFIX}/auth/register`)
      .send(registration());
    const token = registered.body.data.accessToken as string;

    const me = await request(app)
      .get(`${env.API_PREFIX}/auth/me`)
      .set("authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    const serialized = JSON.stringify(me.body);
    for (const forbidden of [
      "passwordHash",
      "tokenHash",
      "csrfTokenHash",
      "replacedByTokenHash",
      "suspendedReason",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    const denied = await request(app)
      .get(`${env.API_PREFIX}/auth/access/admin`)
      .set("authorization", `Bearer ${token}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");

    await provisionUser("admin@example.com", UserRole.ADMIN);
    const adminLogin = await request(app)
      .post(`${env.API_PREFIX}/auth/login`)
      .send({ email: "admin@example.com", password });
    const granted = await request(app)
      .get(`${env.API_PREFIX}/auth/access/admin`)
      .set("authorization", `Bearer ${adminLogin.body.data.accessToken}`);
    expect(granted.status).toBe(200);
  });

  it("invalidates access immediately when an account is suspended", async () => {
    const user = await provisionUser("suspended@example.com", UserRole.CUSTOMER);
    const authenticated = await login(user.email);
    await prisma.user.update({
      where: { id: user.id },
      data: { accountStatus: AccountStatus.SUSPENDED, suspendedAt: new Date() },
    });

    const response = await request(createApp(env, logger))
      .get(`${env.API_PREFIX}/auth/me`)
      .set("authorization", `Bearer ${authenticated.body.data.accessToken}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ACCOUNT_RESTRICTED");
  });

  it("derives supplier access from an active membership and active business", async () => {
    const supplier = await provisionUser("supplier@example.com", UserRole.SUPPLIER_STAFF);
    const business = await prisma.supplierBusiness.create({
      data: {
        legalName: "Supplier Ltd",
        displayName: "Supplier",
        status: SupplierBusinessStatus.ACTIVE,
        subscriptionGraceEndsAt: new Date("2099-01-01T00:00:00.000Z"),
      },
    });
    const membership = await prisma.supplierUser.create({
      data: { userId: supplier.id, businessId: business.id, isActive: true },
    });
    const authenticated = await login(supplier.email);
    const authHeader = `Bearer ${authenticated.body.data.accessToken}`;

    await prisma.supplierUser.update({
      where: { id: membership.id },
      data: { isActive: false },
    });

    const inactive = await request(createApp(env, logger))
      .get(`${env.API_PREFIX}/auth/access/supplier`)
      .set("authorization", authHeader)
      .set("x-business-id", business.id);
    expect(inactive.status).toBe(403);

    await prisma.supplierUser.update({
      where: { id: membership.id },
      data: { isActive: true },
    });
    const active = await request(createApp(env, logger))
      .get(`${env.API_PREFIX}/auth/access/supplier`)
      .set("authorization", authHeader)
      .set("x-business-id", business.id);
    expect(active.status).toBe(200);
    expect(active.body.data.supplierAccess.businessId).toBe(business.id);

    await prisma.supplierBusiness.update({
      where: { id: business.id },
      data: { status: SupplierBusinessStatus.SUSPENDED },
    });
    const suspended = await request(createApp(env, logger))
      .get(`${env.API_PREFIX}/auth/access/supplier`)
      .set("authorization", authHeader)
      .set("x-business-id", business.id);
    expect(suspended.status).toBe(403);
  });
});

describe("refresh rotation and revocation", () => {
  it("keeps customer and supplier browser sessions in separate cookie namespaces", async () => {
    const app = createApp(env, logger);
    const customer = await provisionUser(
      "namespaced-customer@example.com",
      UserRole.CUSTOMER,
    );
    const supplier = await provisionUser(
      "namespaced-supplier@example.com",
      UserRole.SUPPLIER_OWNER,
    );
    await prisma.supplierBusiness.create({
      data: {
        legalName: "Namespaced Supplier Ltd",
        displayName: "Namespaced Supplier",
        status: SupplierBusinessStatus.ACTIVE,
        subscriptionGraceEndsAt: new Date("2099-01-01T00:00:00.000Z"),
        members: { create: { userId: supplier.id, isPrimary: true } },
      },
    });
    const customerLogin = await request(app)
      .post(`${env.API_PREFIX}/auth/login`)
      .set("x-auth-client", "customer")
      .send({ email: customer.email, password });
    const supplierLogin = await request(app)
      .post(`${env.API_PREFIX}/auth/login`)
      .set("x-auth-client", "supplier")
      .send({ email: supplier.email, password });

    const customerRefreshName = `${env.REFRESH_COOKIE_NAME}_customer`;
    const customerCsrfName = `${env.CSRF_COOKIE_NAME}_customer`;
    const supplierRefreshName = `${env.REFRESH_COOKIE_NAME}_supplier`;
    const supplierCsrfName = `${env.CSRF_COOKIE_NAME}_supplier`;
    const browserCookies = [
      cookieValue(responseCookies(customerLogin), customerRefreshName),
      cookieValue(responseCookies(customerLogin), customerCsrfName),
      cookieValue(responseCookies(supplierLogin), supplierRefreshName),
      cookieValue(responseCookies(supplierLogin), supplierCsrfName),
    ];

    const refreshedCustomer = await request(app)
      .post(`${env.API_PREFIX}/auth/refresh`)
      .set("origin", origin)
      .set("x-auth-client", "customer")
      .set("x-csrf-token", customerLogin.body.data.csrfToken)
      .set("Cookie", browserCookies);
    const refreshedSupplier = await request(app)
      .post(`${env.API_PREFIX}/auth/refresh`)
      .set("origin", origin)
      .set("x-auth-client", "supplier")
      .set("x-csrf-token", supplierLogin.body.data.csrfToken)
      .set("Cookie", browserCookies);

    expect(refreshedCustomer.status).toBe(200);
    expect(refreshedCustomer.body.data.account.email).toBe(customer.email);
    expect(refreshedSupplier.status).toBe(200);
    expect(refreshedSupplier.body.data.account.email).toBe(supplier.email);
  });

  it("rotates tokens, detects replay, and revokes the affected family", async () => {
    const app = createApp(env, logger);
    const registered = await request(app)
      .post(`${env.API_PREFIX}/auth/register`)
      .send(registration());
    const oldCookies = responseCookies(registered);
    const oldRefresh = cookieValue(oldCookies, env.REFRESH_COOKIE_NAME);
    const oldCsrfCookie = cookieValue(oldCookies, env.CSRF_COOKIE_NAME);
    const oldCsrf = registered.body.data.csrfToken as string;

    const rotated = await request(app)
      .post(`${env.API_PREFIX}/auth/refresh`)
      .set("origin", origin)
      .set("x-csrf-token", oldCsrf)
      .set("Cookie", [oldRefresh, oldCsrfCookie]);
    expect(rotated.status).toBe(200);

    const replay = await request(app)
      .post(`${env.API_PREFIX}/auth/refresh`)
      .set("origin", origin)
      .set("x-csrf-token", oldCsrf)
      .set("Cookie", [oldRefresh, oldCsrfCookie]);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("REFRESH_TOKEN_REUSE_DETECTED");

    const newCookies = responseCookies(rotated);
    const revokedReplacement = await request(app)
      .post(`${env.API_PREFIX}/auth/refresh`)
      .set("origin", origin)
      .set("x-csrf-token", rotated.body.data.csrfToken)
      .set("Cookie", [
        cookieValue(newCookies, env.REFRESH_COOKIE_NAME),
        cookieValue(newCookies, env.CSRF_COOKIE_NAME),
      ]);
    expect(revokedReplacement.status).toBe(401);
  });

  it("allows at most one concurrent refresh and leaves no usable family after replay", async () => {
    const app = createApp(env, logger);
    const registered = await request(app)
      .post(`${env.API_PREFIX}/auth/register`)
      .send(registration());
    const cookies = responseCookies(registered);
    const cookie = [
      cookieValue(cookies, env.REFRESH_COOKIE_NAME),
      cookieValue(cookies, env.CSRF_COOKIE_NAME),
    ];
    const makeRefresh = () =>
      request(app)
        .post(`${env.API_PREFIX}/auth/refresh`)
        .set("origin", origin)
        .set("x-csrf-token", registered.body.data.csrfToken)
        .set("Cookie", cookie);

    const results = await Promise.all([makeRefresh(), makeRefresh()]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
    const activeSessions = await prisma.refreshSession.count({
      where: { revokedAt: null },
    });
    expect(activeSessions).toBe(0);
  });

  it("revokes only the current device on logout and every device on logout-all", async () => {
    const user = await provisionUser("devices@example.com", UserRole.CUSTOMER);
    const first = await login(user.email);
    const second = await login(user.email);
    const app = createApp(env, logger);

    const logoutCurrent = await request(app)
      .post(`${env.API_PREFIX}/auth/logout`)
      .set("authorization", `Bearer ${first.body.data.accessToken}`);
    expect(logoutCurrent.status).toBe(200);

    expect(
      (
        await request(app)
          .get(`${env.API_PREFIX}/auth/me`)
          .set("authorization", `Bearer ${first.body.data.accessToken}`)
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .get(`${env.API_PREFIX}/auth/me`)
          .set("authorization", `Bearer ${second.body.data.accessToken}`)
      ).status,
    ).toBe(200);

    const logoutAll = await request(app)
      .post(`${env.API_PREFIX}/auth/logout-all`)
      .set("authorization", `Bearer ${second.body.data.accessToken}`);
    expect(logoutAll.status).toBe(200);
    expect(
      (
        await request(app)
          .get(`${env.API_PREFIX}/auth/me`)
          .set("authorization", `Bearer ${second.body.data.accessToken}`)
      ).status,
    ).toBe(401);
  });
});

describe("password recovery", () => {
  it("keeps forgot-password enumeration-safe and resets once while revoking sessions", async () => {
    const delivery = new MemoryRecoveryDelivery();
    const app = createApp(env, logger, { recoveryDelivery: delivery });
    const registered = await request(app)
      .post(`${env.API_PREFIX}/auth/register`)
      .send(registration());

    const known = await request(app)
      .post(`${env.API_PREFIX}/auth/forgot-password`)
      .send({ email: registration().email });
    const unknown = await request(app)
      .post(`${env.API_PREFIX}/auth/forgot-password`)
      .send({ email: "unknown@example.com" });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body.data).toEqual(unknown.body.data);
    expect(delivery.messages).toHaveLength(1);

    const token = new URL(delivery.messages[0]!.resetUrl).searchParams.get("token");
    expect(token).toBeTruthy();
    const reset = await request(app)
      .post(`${env.API_PREFIX}/auth/reset-password`)
      .send({ token, newPassword: resetPassword });
    expect(reset.status).toBe(200);

    const reuse = await request(app)
      .post(`${env.API_PREFIX}/auth/reset-password`)
      .send({ token, newPassword: "ThirdStrongPassword789" });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe("INVALID_PASSWORD_RESET_TOKEN");

    const oldSession = await request(app)
      .get(`${env.API_PREFIX}/auth/me`)
      .set("authorization", `Bearer ${registered.body.data.accessToken}`);
    expect(oldSession.status).toBe(401);
    const newLogin = await request(app)
      .post(`${env.API_PREFIX}/auth/login`)
      .send({ email: registration().email, password: resetPassword });
    expect(newLogin.status).toBe(200);
  });

  it("rejects expired reset tokens", async () => {
    const delivery = new MemoryRecoveryDelivery();
    const app = createApp(env, logger, { recoveryDelivery: delivery });
    await request(app).post(`${env.API_PREFIX}/auth/register`).send(registration());
    await request(app)
      .post(`${env.API_PREFIX}/auth/forgot-password`)
      .send({ email: registration().email });
    await prisma.passwordResetToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const token = new URL(delivery.messages[0]!.resetUrl).searchParams.get("token");
    const response = await request(app)
      .post(`${env.API_PREFIX}/auth/reset-password`)
      .send({ token, newPassword: resetPassword });
    expect(response.status).toBe(400);
  });
});
