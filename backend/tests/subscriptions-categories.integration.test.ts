import { AccountStatus, UserRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createLogger } from "../src/config/logger.js";
import { prisma } from "../src/config/prisma.js";
import { hashPassword } from "../src/modules/auth/password.js";
import { hasCurrentSupplierEntitlement } from "../src/modules/subscriptions/subscription-access.js";
import { addCalendarMonths } from "../src/modules/subscriptions/subscription.service.js";
import { cleanupFulfillment } from "./helpers/cleanup-fulfillment.js";

const env = loadEnv();
const app = createApp(env, createLogger());
const adminPassword = "StrongAdminPassword123";
const temporaryPassword = "TemporaryOwner123";
const replacementTemporaryPassword = "ReplacementTemporary456";
const ownerPassword = "PermanentOwnerPassword123";

async function clean() {
  await cleanupFulfillment(prisma);
  await prisma.notificationDelivery.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.outboxEvent.deleteMany();
  await prisma.supplierCategoryRequest.deleteMany();
  await prisma.subscriptionPayment.deleteMany();
  await prisma.subscriptionInvoice.deleteMany();
  await prisma.supplierSubscriptionEvent.deleteMany();
  await prisma.supplierSubscription.deleteMany();
  await prisma.subscriptionPlan.deleteMany();
  await prisma.platformBusinessConfig.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.refreshSession.deleteMany();
  await prisma.accountInvitation.deleteMany();
  await prisma.supplierUser.deleteMany();
  await prisma.supplierBusiness.deleteMany();
  await prisma.partCategory.deleteMany();
  await prisma.user.deleteMany();
}

async function login(email: string, password: string) {
  return request(app).post(`${env.API_PREFIX}/auth/login`).send({ email, password });
}

async function setup() {
  const admin = await prisma.user.create({
    data: {
      email: `admin-${randomUUID()}@test.local`,
      fullName: "Subscription Admin",
      passwordHash: await hashPassword(adminPassword),
      role: UserRole.SUPER_ADMIN,
      accountStatus: AccountStatus.ACTIVE,
    },
  });
  const authenticated = await login(admin.email, adminPassword);
  const authorization = `Bearer ${authenticated.body.data.accessToken as string}`;
  await prisma.platformBusinessConfig.create({
    data: {
      legalName: "PartsArc Test Ltd",
      tradingName: "PartsArc",
      address: "Dhaka",
      isPlaceholder: false,
    },
  });
  const businessResponse = await request(app)
    .post(`${env.API_PREFIX}/admin/suppliers`)
    .set("authorization", authorization)
    .send({
      legalName: "Subscription Supplier Ltd",
      displayName: "Subscription Supplier",
      serviceAreas: ["Dhaka"],
    });
  expect(businessResponse.status, JSON.stringify(businessResponse.body)).toBe(201);
  const businessId = businessResponse.body.data.id as string;
  const owner = await request(app)
    .post(`${env.API_PREFIX}/admin/suppliers/${businessId}/owner-account`)
    .set("authorization", authorization)
    .send({
      email: `owner-${randomUUID()}@test.local`,
      fullName: "Supplier Owner",
      temporaryPassword,
    });
  expect(owner.status, JSON.stringify(owner.body)).toBe(201);
  const review = await request(app)
    .post(`${env.API_PREFIX}/admin/suppliers/${businessId}/status/submit-review`)
    .set("authorization", authorization)
    .send({});
  expect(review.status, JSON.stringify(review.body)).toBe(200);
  const activated = await request(app)
    .post(`${env.API_PREFIX}/admin/suppliers/${businessId}/status/activate`)
    .set("authorization", authorization)
    .send({});
  expect(activated.status, JSON.stringify(activated.body)).toBe(200);
  const business = await prisma.supplierBusiness.findUniqueOrThrow({
    where: { id: businessId },
    include: { ownerUser: true },
  });
  const planResponse = await request(app)
    .post(`${env.API_PREFIX}/admin/subscriptions/plans`)
    .set("authorization", authorization)
    .send({ name: "Four Month Test", durationMonths: 4, price: 4000, isActive: true });
  expect(planResponse.status, JSON.stringify(planResponse.body)).toBe(201);
  return { authorization, business, planId: planResponse.body.data.id as string };
}

beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("supplier onboarding and paid subscription access", () => {
  it("uses clamped calendar-month arithmetic at month-end and leap-year boundaries", () => {
    expect(addCalendarMonths(new Date("2025-01-31T12:00:00.000Z"), 1).toISOString()).toBe(
      "2025-02-28T12:00:00.000Z",
    );
    expect(addCalendarMonths(new Date("2024-01-31T12:00:00.000Z"), 1).toISOString()).toBe(
      "2024-02-29T12:00:00.000Z",
    );
    expect(
      addCalendarMonths(new Date("2024-02-29T12:00:00.000Z"), 12).toISOString(),
    ).toBe("2025-02-28T12:00:00.000Z");
  });
  it("requires a temporary-password change and full invoice payment before operational access", async () => {
    const fixture = await setup();
    const temporaryLogin = await login(
      fixture.business.ownerUser!.email,
      temporaryPassword,
    );
    expect(temporaryLogin.status).toBe(200);
    expect(temporaryLogin.body.data.account.mustChangePassword).toBe(true);
    const temporaryAuth = `Bearer ${temporaryLogin.body.data.accessToken as string}`;
    expect(
      (
        await request(app)
          .get(`${env.API_PREFIX}/auth/access/supplier`)
          .set("authorization", temporaryAuth)
          .set("x-business-id", fixture.business.id)
      ).body.error.code,
    ).toBe("PASSWORD_CHANGE_REQUIRED");
    const changed = await request(app)
      .post(`${env.API_PREFIX}/auth/change-password`)
      .set("authorization", temporaryAuth)
      .send({ currentPassword: temporaryPassword, newPassword: ownerPassword });
    expect(changed.status).toBe(200);
    expect(changed.body.data.mustChangePassword).toBe(false);
    expect(
      (await login(fixture.business.ownerUser!.email, ownerPassword)).body.error.code,
    ).toBe("SUPPLIER_SUBSCRIPTION_REQUIRED");

    const invoice = await request(app)
      .post(`${env.API_PREFIX}/admin/subscriptions/invoices`)
      .set("authorization", fixture.authorization)
      .send({
        businessId: fixture.business.id,
        planId: fixture.planId,
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        idempotencyKey: `invoice-${randomUUID()}`,
      });
    expect(invoice.status).toBe(201);
    const invoiceId = invoice.body.data.id as string;
    const partial = await request(app)
      .post(`${env.API_PREFIX}/admin/subscriptions/invoices/${invoiceId}/payments`)
      .set("authorization", fixture.authorization)
      .send({
        amount: 1000,
        method: "BANK",
        externalReference: `partial-${randomUUID()}`,
        occurredAt: new Date().toISOString(),
        idempotencyKey: `pay-${randomUUID()}`,
      });
    expect(partial.body.data.status).toBe("PARTIALLY_PAID");
    expect((await login(fixture.business.ownerUser!.email, ownerPassword)).status).toBe(
      403,
    );
    const paid = await request(app)
      .post(`${env.API_PREFIX}/admin/subscriptions/invoices/${invoiceId}/payments`)
      .set("authorization", fixture.authorization)
      .send({
        amount: 3000,
        method: "BANK",
        externalReference: `final-${randomUUID()}`,
        occurredAt: new Date().toISOString(),
        idempotencyKey: `pay-${randomUUID()}`,
      });
    expect(paid.body.data.status).toBe("PAID");
    const operationalLogin = await login(
      fixture.business.ownerUser!.email,
      ownerPassword,
    );
    expect(operationalLogin.status).toBe(200);
    const currentSubscription = await request(app)
      .get(`${env.API_PREFIX}/supplier/subscriptions/current`)
      .set("authorization", `Bearer ${operationalLogin.body.data.accessToken as string}`)
      .set("x-business-id", fixture.business.id);
    expect(currentSubscription.status).toBe(200);
    expect(currentSubscription.body.data).toMatchObject({
      planName: "Four Month Test",
      effectiveStatus: "ACTIVE",
      durationMonths: 4,
      currency: "BDT",
      price: "4000.00",
    });
    const endsAt = new Date(paid.body.data.periodEndsAt as string);
    expect(
      await hasCurrentSupplierEntitlement(prisma, fixture.business.id, endsAt),
    ).toBeNull();
    const membership = await prisma.supplierUser.findFirstOrThrow({
      where: {
        businessId: fixture.business.id,
        userId: fixture.business.ownerUser!.id,
      },
    });
    const suspended = await request(app)
      .post(
        `${env.API_PREFIX}/admin/suppliers/${fixture.business.id}/members/${membership.id}/account-status`,
      )
      .set("authorization", fixture.authorization)
      .send({ status: "SUSPENDED", reason: "Credential review" });
    expect(suspended.status).toBe(200);
    expect(
      (await login(fixture.business.ownerUser!.email, ownerPassword)).body.error.code,
    ).toBe("ACCOUNT_RESTRICTED");
    const reactivated = await request(app)
      .post(
        `${env.API_PREFIX}/admin/suppliers/${fixture.business.id}/members/${membership.id}/account-status`,
      )
      .set("authorization", fixture.authorization)
      .send({ status: "ACTIVE", reason: "Credential review completed" });
    expect(reactivated.status).toBe(200);
    expect((await login(fixture.business.ownerUser!.email, ownerPassword)).status).toBe(
      200,
    );
  });

  it("lets an admin reset a member temporary password and revokes existing sessions", async () => {
    const fixture = await setup();
    const membership = await prisma.supplierUser.findFirstOrThrow({
      where: {
        businessId: fixture.business.id,
        userId: fixture.business.ownerUser!.id,
      },
    });
    const existingLogin = await login(
      fixture.business.ownerUser!.email,
      temporaryPassword,
    );
    expect(existingLogin.status).toBe(200);
    const existingAuthorization = `Bearer ${existingLogin.body.data.accessToken as string}`;

    const reset = await request(app)
      .post(
        `${env.API_PREFIX}/admin/suppliers/${fixture.business.id}/members/${membership.id}/temporary-password`,
      )
      .set("authorization", fixture.authorization)
      .send({
        temporaryPassword: replacementTemporaryPassword,
        reason: "Owner lost the original temporary password",
      });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    expect(reset.body.data.user.mustChangePassword).toBe(true);
    expect(JSON.stringify(reset.body)).not.toContain(replacementTemporaryPassword);

    expect(
      (
        await request(app)
          .get(`${env.API_PREFIX}/auth/me`)
          .set("authorization", existingAuthorization)
      ).status,
    ).toBe(401);
    expect(
      (await login(fixture.business.ownerUser!.email, temporaryPassword)).status,
    ).toBe(401);
    const replacementLogin = await login(
      fixture.business.ownerUser!.email,
      replacementTemporaryPassword,
    );
    expect(replacementLogin.status).toBe(200);
    expect(replacementLogin.body.data.account.mustChangePassword).toBe(true);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "SUPPLIER_MEMBER_TEMPORARY_PASSWORD_RESET",
        entityId: fixture.business.ownerUser!.id,
      },
    });
    expect(audit.metadata).toMatchObject({
      businessId: fixture.business.id,
      membershipId: membership.id,
      reason: "Owner lost the original temporary password",
    });
    expect(JSON.stringify(audit)).not.toContain(replacementTemporaryPassword);
  });

  it("makes invoice creation and payment retries idempotent and rejects overpayment", async () => {
    const fixture = await setup();
    const key = `invoice-${randomUUID()}`;
    const payload = {
      businessId: fixture.business.id,
      planId: fixture.planId,
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      idempotencyKey: key,
    };
    const [first, retry] = await Promise.all([
      request(app)
        .post(`${env.API_PREFIX}/admin/subscriptions/invoices`)
        .set("authorization", fixture.authorization)
        .send(payload),
      request(app)
        .post(`${env.API_PREFIX}/admin/subscriptions/invoices`)
        .set("authorization", fixture.authorization)
        .send(payload),
    ]);
    expect(first.body.data.id).toBe(retry.body.data.id);
    const paymentKey = `pay-${randomUUID()}`;
    const paymentPayload = {
      amount: 4000,
      method: "BANK",
      externalReference: `receipt-${randomUUID()}`,
      occurredAt: new Date().toISOString(),
      idempotencyKey: paymentKey,
    };
    const [payment, paymentRetry] = await Promise.all([
      request(app)
        .post(
          `${env.API_PREFIX}/admin/subscriptions/invoices/${first.body.data.id}/payments`,
        )
        .set("authorization", fixture.authorization)
        .send(paymentPayload),
      request(app)
        .post(
          `${env.API_PREFIX}/admin/subscriptions/invoices/${first.body.data.id}/payments`,
        )
        .set("authorization", fixture.authorization)
        .send(paymentPayload),
    ]);
    expect(payment.body.data.id).toBe(paymentRetry.body.data.id);
    expect(
      await prisma.subscriptionPayment.count({ where: { idempotencyKey: paymentKey } }),
    ).toBe(1);
    const renewal = await request(app)
      .post(`${env.API_PREFIX}/admin/subscriptions/invoices`)
      .set("authorization", fixture.authorization)
      .send({ ...payload, idempotencyKey: `invoice-${randomUUID()}` });
    expect(renewal.status).toBe(201);
    expect(renewal.body.data.periodStartsAt).toBe(first.body.data.periodEndsAt);
    const duplicateReference = await request(app)
      .post(
        `${env.API_PREFIX}/admin/subscriptions/invoices/${renewal.body.data.id}/payments`,
      )
      .set("authorization", fixture.authorization)
      .send({ ...paymentPayload, idempotencyKey: `pay-${randomUUID()}` });
    expect(duplicateReference.status).toBe(409);
    expect(duplicateReference.body.error.code).toBe(
      "SUBSCRIPTION_PAYMENT_DUPLICATE_REFERENCE",
    );
    const over = await request(app)
      .post(
        `${env.API_PREFIX}/admin/subscriptions/invoices/${first.body.data.id}/payments`,
      )
      .set("authorization", fixture.authorization)
      .send({
        amount: 5000,
        method: "BANK",
        occurredAt: new Date().toISOString(),
        idempotencyKey: `pay-${randomUUID()}`,
      });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("SUBSCRIPTION_OVERPAYMENT");
  });
});

describe("supplier category governance", () => {
  it("atomically approves a request into a global category and prevents repeat decisions", async () => {
    const fixture = await setup();
    await prisma.supplierSubscription.create({
      data: {
        businessId: fixture.business.id,
        planId: fixture.planId,
        status: "ACTIVE",
        planNameSnapshot: "Four Month Test",
        durationMonthsSnapshot: 4,
        priceSnapshot: 0,
        startsAt: new Date(Date.now() - 1000),
        endsAt: new Date(Date.now() + 86400000),
        activatedAt: new Date(),
        complimentaryReason: "Test fixture",
        createdByUserId: fixture.business.ownerUser!.id,
        idempotencyKey: `grant-${randomUUID()}`,
      },
    });
    const supplierLogin = await login(
      fixture.business.ownerUser!.email,
      temporaryPassword,
    );
    const supplierAuth = `Bearer ${supplierLogin.body.data.accessToken as string}`;
    await request(app)
      .post(`${env.API_PREFIX}/auth/change-password`)
      .set("authorization", supplierAuth)
      .send({ currentPassword: temporaryPassword, newPassword: ownerPassword });
    const requested = await request(app)
      .post(`${env.API_PREFIX}/supplier/subscriptions/category-requests`)
      .set("authorization", supplierAuth)
      .set("x-business-id", fixture.business.id)
      .send({
        proposedName: "Exhaust",
        description: "Exhaust-system components",
        justification: "Needed for current catalogue offers",
      });
    expect(requested.status).toBe(201);
    const decision = {
      decision: "APPROVE_CREATE",
      slug: "exhaust",
      reason: "Validated new global category",
    };
    const approved = await request(app)
      .post(
        `${env.API_PREFIX}/admin/catalogue/category-requests/${requested.body.data.id}/decision`,
      )
      .set("authorization", fixture.authorization)
      .send(decision);
    expect(approved.body.data.status).toBe("APPROVED");
    expect(await prisma.partCategory.count({ where: { slug: "exhaust" } })).toBe(1);
    expect(
      (
        await request(app)
          .post(
            `${env.API_PREFIX}/admin/catalogue/category-requests/${requested.body.data.id}/decision`,
          )
          .set("authorization", fixture.authorization)
          .send(decision)
      ).status,
    ).toBe(409);
  });
});
