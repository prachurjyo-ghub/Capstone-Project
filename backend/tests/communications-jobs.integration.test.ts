import {
  AccountStatus,
  SourcingRequestStatus,
  SupplierBusinessStatus,
  UserRole,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createLogger } from "../src/config/logger.js";
import { prisma } from "../src/config/prisma.js";
import { hashPassword } from "../src/modules/auth/password.js";
import { CatalogueCache } from "../src/modules/catalogue/catalogue.cache.js";
import type {
  NotificationDeliveryMessage,
  NotificationDeliveryProvider,
} from "../src/modules/communications/notification-delivery.js";
import { OutboxProcessor } from "../src/modules/communications/outbox-processor.js";
import { BackgroundService } from "../src/modules/jobs/background.service.js";
import type { MatchingClock } from "../src/modules/matching/matching-clock.js";
import { LocalRequestAttachmentStorage } from "../src/modules/requests/attachment-storage.js";
import { cleanupFulfillment } from "./helpers/cleanup-fulfillment.js";

const env = loadEnv();
const password = "StrongPassword123";
const directory = mkdtempSync(join(tmpdir(), "autopro-message-tests-"));
const storage = new LocalRequestAttachmentStorage(directory);
class FixedClock implements MatchingClock {
  current = new Date("2026-10-19T12:00:00.000Z");
  now() {
    return new Date(this.current);
  }
}
const clock = new FixedClock();
const app = createApp(env, createLogger(), {
  requestAttachmentStorage: storage,
  matchingClock: clock,
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
class FlakyDelivery implements NotificationDeliveryProvider {
  attempts = 0;
  async deliver(message: NotificationDeliveryMessage) {
    void message;
    this.attempts += 1;
    if (this.attempts === 1) throw new Error("temporary provider failure");
  }
}

async function clean() {
  await cleanupFulfillment(prisma);
  await prisma.auditLog.deleteMany();
  await prisma.refreshSession.deleteMany();
  await prisma.quotation.deleteMany();
  await prisma.supplierAssignmentHistory.deleteMany();
  await prisma.supplierRequestAssignment.deleteMany();
  await prisma.requestStatusHistory.deleteMany();
  await prisma.sourcingRequestItem.deleteMany();
  await prisma.sourcingRequest.deleteMany();
  await prisma.inventoryCsvPreview.deleteMany();
  await prisma.supplierUser.deleteMany();
  await prisma.supplierBusiness.deleteMany();
  await prisma.customerProfile.deleteMany();
  await prisma.user.deleteMany();
  const files = await readdir(directory);
  await Promise.all(files.map((file) => rm(join(directory, file))));
}

async function user(email: string, role: UserRole) {
  return prisma.user.create({
    data: {
      email,
      fullName: role,
      passwordHash: await hashPassword(password),
      role,
      accountStatus: AccountStatus.ACTIVE,
      customerProfile:
        role === UserRole.CUSTOMER
          ? { create: { fullName: "Communication Customer" } }
          : undefined,
    },
    include: { customerProfile: true },
  });
}

async function auth(email: string) {
  const response = await request(app)
    .post(`${env.API_PREFIX}/auth/login`)
    .send({ email, password });
  expect(response.status).toBe(200);
  return `Bearer ${response.body.data.accessToken as string}`;
}

async function fixture() {
  const [customer, supplier, outsider, admin, superAdmin] = await Promise.all([
    user("messages-customer@autopro.test", UserRole.CUSTOMER),
    user("messages-supplier@autopro.test", UserRole.SUPPLIER_OWNER),
    user("messages-outsider@autopro.test", UserRole.SUPPLIER_OWNER),
    user("messages-admin@autopro.test", UserRole.ADMIN),
    user("messages-super-admin@autopro.test", UserRole.SUPER_ADMIN),
  ]);
  const business = await prisma.supplierBusiness.create({
    data: {
      legalName: "Message Supplier Ltd",
      displayName: "Message Supplier",
      status: SupplierBusinessStatus.ACTIVE,
      subscriptionGraceEndsAt: new Date("2099-01-01T00:00:00.000Z"),
      members: { create: { userId: supplier.id, isPrimary: true } },
    },
  });
  const outsiderBusiness = await prisma.supplierBusiness.create({
    data: {
      legalName: "Other Message Supplier Ltd",
      displayName: "Other Message Supplier",
      status: SupplierBusinessStatus.ACTIVE,
      subscriptionGraceEndsAt: new Date("2099-01-01T00:00:00.000Z"),
      members: { create: { userId: outsider.id, isPrimary: true } },
    },
  });
  const sourcing = await prisma.sourcingRequest.create({
    data: {
      requestNumber: `RFQ-MSG-${randomUUID()}`,
      customerId: customer.customerProfile!.id,
      status: SourcingRequestStatus.SUBMITTED,
      submittedAt: clock.now(),
      responseDeadlineAt: new Date(clock.now().getTime() + 60_000),
      assignments: { create: { businessId: business.id } },
    },
  });
  return {
    customer,
    supplier,
    outsider,
    admin,
    superAdmin,
    business,
    outsiderBusiness,
    sourcing,
    customerAuth: await auth(customer.email),
    supplierAuth: await auth(supplier.email),
    outsiderAuth: await auth(outsider.email),
    adminAuth: await auth(admin.email),
    superAdminAuth: await auth(superAdmin.email),
  };
}

beforeEach(clean);
afterAll(async () => {
  await clean();
  await rm(directory, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("Phase 3 communications, notifications and jobs", () => {
  it("restricts destructive reconciliation controls to super administrators", async () => {
    const value = await fixture();
    const customerDenied = await request(app)
      .post(`${env.API_PREFIX}/admin/jobs/listing-images/reconcile`)
      .set("authorization", value.customerAuth)
      .send({ dryRun: true, limit: 10 });
    const adminDenied = await request(app)
      .post(`${env.API_PREFIX}/admin/jobs/listing-images/reconcile`)
      .set("authorization", value.adminAuth)
      .send({ dryRun: false, limit: 10 });
    const superAdminDryRun = await request(app)
      .post(`${env.API_PREFIX}/admin/jobs/listing-images/reconcile`)
      .set("authorization", value.superAdminAuth)
      .send({ dryRun: true, limit: 10 });
    const adminFinancialDenied = await request(app)
      .get(`${env.API_PREFIX}/admin/credits/reconciliation?page=1&pageSize=10`)
      .set("authorization", value.adminAuth);
    const superAdminFinancial = await request(app)
      .get(`${env.API_PREFIX}/admin/credits/reconciliation?page=1&pageSize=10`)
      .set("authorization", value.superAdminAuth);

    expect(customerDenied.status).toBe(403);
    expect(adminDenied.status).toBe(403);
    expect(superAdminDryRun.status).toBe(200);
    expect(superAdminDryRun.body.data.dryRun).toBe(true);
    expect(adminFinancialDenied.status).toBe(403);
    expect(superAdminFinancial.status).toBe(200);
    expect(superAdminFinancial.body.data.readOnly).toBe(true);
  });

  it("keeps shared catalogue data available while Redis is unavailable", async () => {
    const cache = new CatalogueCache({
      ...env,
      REDIS_URL: "redis://127.0.0.1:1",
      REDIS_KEY_PREFIX: "autopro:test:isolated-cache",
      CATALOGUE_CACHE_TTL_SECONDS: 30,
    });
    await cache.set("product:example", { id: "example", name: "Brake pad" });
    await expect(cache.get("product:example")).resolves.toEqual({
      id: "example",
      name: "Brake pad",
    });
    cache.invalidate();
    await expect(cache.get("product:example")).resolves.toBeNull();
  });

  it("isolates customer and supplier conversations and sends idempotently", async () => {
    const value = await fixture();
    const customerConversation = await request(app)
      .post(`${env.API_PREFIX}/communications/conversations`)
      .set("authorization", value.customerAuth)
      .send({ requestId: value.sourcing.id });
    expect(customerConversation.status).toBe(200);
    const supplierConversation = await request(app)
      .post(`${env.API_PREFIX}/communications/conversations`)
      .set("authorization", value.supplierAuth)
      .set("x-business-id", value.business.id)
      .send({ requestId: value.sourcing.id });
    expect(supplierConversation.status).toBe(200);
    expect(supplierConversation.body.data.id).not.toBe(customerConversation.body.data.id);

    const key = randomUUID();
    const send = () =>
      request(app)
        .post(
          `${env.API_PREFIX}/communications/conversations/${customerConversation.body.data.id}/messages`,
        )
        .set("authorization", value.customerAuth)
        .send({
          body: "Please confirm whether another photo is needed.",
          idempotencyKey: key,
        });
    const [first, retry] = await Promise.all([send(), send()]);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(first.body.data.id).toBe(retry.body.data.id);
    expect(await prisma.message.count()).toBe(1);

    const denied = await request(app)
      .get(
        `${env.API_PREFIX}/communications/conversations/${supplierConversation.body.data.id}/messages`,
      )
      .set("authorization", value.outsiderAuth)
      .set("x-business-id", value.outsiderBusiness.id);
    expect(denied.status).toBe(404);
  });

  it("authorizes private attachments and keeps read markers monotonic", async () => {
    const value = await fixture();
    const conversation = await request(app)
      .post(`${env.API_PREFIX}/communications/conversations`)
      .set("authorization", value.customerAuth)
      .send({ requestId: value.sourcing.id });
    const sent = await request(app)
      .post(
        `${env.API_PREFIX}/communications/conversations/${conversation.body.data.id}/messages`,
      )
      .set("authorization", value.customerAuth)
      .send({ body: "Image attached", idempotencyKey: randomUUID() });
    const uploaded = await request(app)
      .post(
        `${env.API_PREFIX}/communications/conversations/${conversation.body.data.id}/messages/${sent.body.data.id}/attachments`,
      )
      .set("authorization", value.customerAuth)
      .set("content-type", "image/png")
      .set("x-file-name", "part.png")
      .send(png);
    expect(uploaded.status).toBe(201);
    const own = await request(app)
      .get(
        `${env.API_PREFIX}/communications/conversations/${conversation.body.data.id}/messages/${sent.body.data.id}/attachments/${uploaded.body.data.id}`,
      )
      .set("authorization", value.customerAuth);
    expect(own.status).toBe(200);
    const denied = await request(app)
      .get(
        `${env.API_PREFIX}/communications/conversations/${conversation.body.data.id}/messages/${sent.body.data.id}/attachments/${uploaded.body.data.id}`,
      )
      .set("authorization", value.outsiderAuth)
      .set("x-business-id", value.outsiderBusiness.id);
    expect(denied.status).toBe(404);

    await Promise.all([
      request(app)
        .post(
          `${env.API_PREFIX}/communications/conversations/${conversation.body.data.id}/read`,
        )
        .set("authorization", value.customerAuth)
        .send({ messageId: sent.body.data.id }),
      request(app)
        .post(
          `${env.API_PREFIX}/communications/conversations/${conversation.body.data.id}/read`,
        )
        .set("authorization", value.customerAuth)
        .send({}),
    ]);
    const marker = await prisma.conversationParticipant.findUniqueOrThrow({
      where: {
        conversationId_userId: {
          conversationId: conversation.body.data.id,
          userId: value.customer.id,
        },
      },
    });
    expect(marker.lastReadAt).not.toBeNull();
  });

  it("recovers durable outbox events without duplicate notifications", async () => {
    const value = await fixture();
    const conversation = await request(app)
      .post(`${env.API_PREFIX}/communications/conversations`)
      .set("authorization", value.customerAuth)
      .send({ requestId: value.sourcing.id });
    await request(app)
      .post(
        `${env.API_PREFIX}/communications/conversations/${conversation.body.data.id}/messages`,
      )
      .set("authorization", value.customerAuth)
      .send({ body: "Notify operations", idempotencyKey: randomUUID() });
    const delivery = new FlakyDelivery();
    const processor = new OutboxProcessor(
      prisma,
      { ...env, NOTIFICATION_EMAIL_ENABLED: true, NOTIFICATION_SMS_ENABLED: false },
      delivery,
    );
    await processor.processBatch();
    await prisma.notificationDelivery.updateMany({
      where: { status: "FAILED" },
      data: { nextAttemptAt: new Date(0) },
    });
    await processor.processBatch();
    expect(
      await prisma.notification.count({ where: { userId: value.admin.id } }),
    ).toBeGreaterThanOrEqual(1);
    const keys = await prisma.notification.findMany({
      select: { userId: true, eventKey: true },
    });
    expect(new Set(keys.map((item) => `${item.userId}:${item.eventKey}`)).size).toBe(
      keys.length,
    );
    expect(delivery.attempts).toBeGreaterThanOrEqual(2);
    expect(
      await prisma.notificationDelivery.count({ where: { status: "DELIVERED" } }),
    ).toBeGreaterThanOrEqual(1);
  });

  it("expires stale work in bounded reconciliation and keeps reminders idempotent", async () => {
    const value = await fixture();
    clock.current = new Date(clock.current.getTime() + 120_000);
    const jobs = new BackgroundService(prisma, clock, 50);
    const result = await jobs.reconcileLifecycle();
    expect(result.assignmentsExpired).toBe(1);
    await jobs.enqueueReminders();
    await jobs.enqueueReminders();
    const events = await prisma.outboxEvent.findMany({ select: { eventKey: true } });
    expect(new Set(events.map((item) => item.eventKey)).size).toBe(events.length);
    expect(value.sourcing.id).toBeTruthy();
  });
});
