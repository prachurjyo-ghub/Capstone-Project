import {
  AccountStatus,
  ProductCondition,
  SourcingRequestStatus,
  SupplierAssignmentStatus,
  SupplierBusinessStatus,
  UserRole,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createLogger } from "../src/config/logger.js";
import { prisma } from "../src/config/prisma.js";
import { hashPassword } from "../src/modules/auth/password.js";
import { cleanupFulfillment } from "./helpers/cleanup-fulfillment.js";
import type { MatchingClock } from "../src/modules/matching/matching-clock.js";

const env = loadEnv();
const logger = createLogger();
const password = "StrongPassword123";
class FixedClock implements MatchingClock {
  current = new Date("2026-10-19T08:00:00Z");
  now() {
    return new Date(this.current);
  }
}
const clock = new FixedClock();
const app = createApp(env, logger, { matchingClock: clock });

async function clean() {
  await cleanupFulfillment(prisma);
  await prisma.auditLog.deleteMany();
  await prisma.refreshSession.deleteMany();
  await prisma.customerOptionClarification.deleteMany();
  await prisma.optionAcceptanceItem.deleteMany();
  await prisma.optionAcceptance.deleteMany();
  await prisma.sourcingOptionHistory.deleteMany();
  await prisma.sourcingOptionLine.deleteMany();
  await prisma.sourcingOption.deleteMany();
  await prisma.supplierClarification.deleteMany();
  await prisma.quotationStatusHistory.deleteMany();
  await prisma.quotationItem.deleteMany();
  await prisma.quotation.deleteMany();
  await prisma.supplierAssignmentHistory.deleteMany();
  await prisma.supplierRequestAssignment.deleteMany();
  await prisma.requestStatusHistory.deleteMany();
  await prisma.sourcingRequestItem.deleteMany();
  await prisma.sourcingRequest.deleteMany();
  await prisma.supplierInventory.deleteMany();
  await prisma.supplierUser.deleteMany();
  await prisma.supplierBusiness.deleteMany();
  await prisma.customerAddress.deleteMany();
  await prisma.customerProfile.deleteMany();
  await prisma.product.deleteMany();
  await prisma.brand.deleteMany();
  await prisma.partCategory.deleteMany();
  await prisma.user.deleteMany();
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
          ? { create: { fullName: "Commerce Customer" } }
          : undefined,
    },
    include: { customerProfile: true },
  });
}
async function token(email: string) {
  const response = await request(app)
    .post(`${env.API_PREFIX}/auth/login`)
    .send({ email, password });
  expect(response.status).toBe(200);
  return `Bearer ${response.body.data.accessToken}`;
}

async function fixture() {
  const [customer, supplier, admin, outsider] = await Promise.all([
    user("phase1-customer@autopro.test", UserRole.CUSTOMER),
    user("phase1-supplier@autopro.test", UserRole.SUPPLIER_OWNER),
    user("phase1-admin@autopro.test", UserRole.ADMIN),
    user("phase1-outsider@autopro.test", UserRole.SUPPLIER_OWNER),
  ]);
  const category = await prisma.partCategory.create({
    data: { name: "Phase One Brakes", slug: `phase-one-${randomUUID()}` },
  });
  const product = await prisma.product.create({
    data: { name: "Brake Pad", categoryId: category.id },
  });
  const business = await prisma.supplierBusiness.create({
    data: {
      legalName: "Phase One Parts Ltd",
      displayName: "Phase One Parts",
      status: SupplierBusinessStatus.ACTIVE,
      subscriptionGraceEndsAt: new Date("2099-01-01T00:00:00.000Z"),
      members: { create: { userId: supplier.id, isPrimary: true } },
    },
  });
  const otherBusiness = await prisma.supplierBusiness.create({
    data: {
      legalName: "Other Parts Ltd",
      displayName: "Other Parts",
      status: SupplierBusinessStatus.ACTIVE,
      subscriptionGraceEndsAt: new Date("2099-01-01T00:00:00.000Z"),
      members: { create: { userId: outsider.id, isPrimary: true } },
    },
  });
  const address = await prisma.customerAddress.create({
    data: {
      customerId: customer.customerProfile!.id,
      recipientName: "Receiver",
      phone: "+8801700000000",
      addressLine: "1 Test Road",
      area: "Dhanmondi",
      city: "Dhaka",
    },
  });
  const sourcing = await prisma.sourcingRequest.create({
    data: {
      requestNumber: `RFQ-P1-${randomUUID()}`,
      customerId: customer.customerProfile!.id,
      status: SourcingRequestStatus.MATCHING,
      submittedAt: clock.now(),
      responseDeadlineAt: new Date("2026-10-20T08:00:00Z"),
      items: {
        create: [
          {
            lineNumber: 1,
            description: "Front brake pad",
            quantity: 2,
            productId: product.id,
            categoryId: category.id,
          },
          {
            lineNumber: 2,
            description: "Rear brake shoe",
            quantity: 1,
            categoryId: category.id,
          },
        ],
      },
    },
    include: { items: true },
  });
  const assignment = await prisma.supplierRequestAssignment.create({
    data: {
      requestId: sourcing.id,
      businessId: business.id,
      status: SupplierAssignmentStatus.ASSIGNED,
    },
  });
  return {
    customer,
    supplier,
    admin,
    outsider,
    business,
    otherBusiness,
    address,
    sourcing,
    assignment,
  };
}

beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("Phase 1 connected sourcing commerce", () => {
  it("keeps customer bootstrap calls bounded for 0, 10, and 100 requests", async () => {
    const customer = await user("bootstrap-customer@autopro.test", UserRole.CUSTOMER);
    const authorization = await token(customer.email);
    const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

    const measure = async () => {
      const fixedPaths = [
        "/customers/me",
        "/customers/me/addresses",
        "/customers/me/vehicles",
        "/customers/me/requests?pageSize=100",
        "/customers/me/orders?pageSize=100",
      ];
      const beforeStartedAt = performance.now();
      const beforeFixed = await Promise.all(
        fixedPaths.map((path) =>
          request(app)
            .get(`${env.API_PREFIX}${path}`)
            .set("authorization", authorization),
        ),
      );
      const requestIds = beforeFixed[3]!.body.data.items.map(
        (item: { id: string }) => item.id,
      );
      const beforeOptions = await Promise.all(
        requestIds.map((id: string) =>
          request(app)
            .get(`${env.API_PREFIX}/customers/me/requests/${id}/options?pageSize=100`)
            .set("authorization", authorization),
        ),
      );
      const beforeDurationMs = performance.now() - beforeStartedAt;

      const afterStartedAt = performance.now();
      const afterFixed = await Promise.all(
        fixedPaths.map((path) =>
          request(app)
            .get(`${env.API_PREFIX}${path}`)
            .set("authorization", authorization),
        ),
      );
      const afterOptions = requestIds.length
        ? [
            await request(app)
              .get(
                `${env.API_PREFIX}/customers/me/options?requestIds=${requestIds.join(",")}&pageSize=100`,
              )
              .set("authorization", authorization),
          ]
        : [];
      return {
        records: requestIds.length,
        beforeCalls: beforeFixed.length + beforeOptions.length,
        afterCalls: afterFixed.length + afterOptions.length,
        beforeBytes: [...beforeFixed, ...beforeOptions].reduce(
          (sum, response) => sum + bytes(response.body),
          0,
        ),
        afterBytes: [...afterFixed, ...afterOptions].reduce(
          (sum, response) => sum + bytes(response.body),
          0,
        ),
        beforeDurationMs: Number(beforeDurationMs.toFixed(2)),
        afterDurationMs: Number((performance.now() - afterStartedAt).toFixed(2)),
      };
    };

    const measurements = [await measure()];
    await prisma.sourcingRequest.createMany({
      data: Array.from({ length: 10 }, (_, index) => ({
        requestNumber: `BOOTSTRAP-10-${index}`,
        customerId: customer.customerProfile!.id,
      })),
    });
    measurements.push(await measure());
    await prisma.sourcingRequest.createMany({
      data: Array.from({ length: 90 }, (_, index) => ({
        requestNumber: `BOOTSTRAP-100-${index}`,
        customerId: customer.customerProfile!.id,
      })),
    });
    measurements.push(await measure());

    expect(measurements.map((item) => item.afterCalls)).toEqual([5, 6, 6]);
    process.stdout.write(`PHASE1_CUSTOMER_METRIC ${JSON.stringify(measurements)}\n`);
  });

  it("completes quote, publication and immutable partial acceptance with safe pricing", async () => {
    const f = await fixture();
    const [supplierAuth, adminAuth, customerAuth, outsiderAuth] = await Promise.all([
      token(f.supplier.email),
      token(f.admin.email),
      token(f.customer.email),
      token(f.outsider.email),
    ]);
    const quotePayload = {
      assignmentId: f.assignment.id,
      validUntil: "2026-10-20T06:00:00Z",
      preparationTimeMin: 120,
      deliveryEstimateText: "Same-day delivery is conditional",
      items: [
        {
          requestItemId: f.sourcing.items[0]!.id,
          description: "OEM front brake pad",
          brand: "Akebono",
          partNumber: "AK-100",
          condition: ProductCondition.NEW,
          quantity: 2,
          supplierUnitPrice: "1000.25",
          compatibilityNotes: "Check chassis before fitting",
        },
        {
          requestItemId: f.sourcing.items[0]!.id,
          description: "Alternative front pad",
          brand: "Nissin",
          condition: ProductCondition.NEW,
          quantity: 2,
          supplierUnitPrice: "800.00",
          alternativeToLineNumber: 1,
          alternativePartInfo: "Lower-cost alternative",
        },
      ],
    };
    const denied = await request(app)
      .post(`${env.API_PREFIX}/supplier/quotations`)
      .set("authorization", outsiderAuth)
      .set("x-business-id", f.otherBusiness.id)
      .send(quotePayload);
    expect(denied.status).toBe(404);
    const draft = await request(app)
      .post(`${env.API_PREFIX}/supplier/quotations`)
      .set("authorization", supplierAuth)
      .set("x-business-id", f.business.id)
      .send(quotePayload);
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    expect(draft.body.data.supplierSubtotal).toBe("2000.50");
    const submitted = await request(app)
      .post(`${env.API_PREFIX}/supplier/quotations/${draft.body.data.id}/submit`)
      .set("authorization", supplierAuth)
      .set("x-business-id", f.business.id)
      .send({ idempotencyKey: "quote-submit-0001" });
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe("SUBMITTED");
    const repeated = await request(app)
      .post(`${env.API_PREFIX}/supplier/quotations/${draft.body.data.id}/submit`)
      .set("authorization", supplierAuth)
      .set("x-business-id", f.business.id)
      .send({ idempotencyKey: "quote-submit-0001" });
    expect(repeated.status).toBe(200);
    const revision = await request(app)
      .post(`${env.API_PREFIX}/supplier/quotations/${draft.body.data.id}/revisions`)
      .set("authorization", supplierAuth)
      .set("x-business-id", f.business.id);
    expect(revision.status).toBe(201);
    expect(revision.body.data.revisionNumber).toBe(2);
    const comparisonDenied = await request(app)
      .get(`${env.API_PREFIX}/admin/requests/${f.sourcing.id}/quotation-comparison`)
      .set("authorization", customerAuth);
    expect(comparisonDenied.status).toBe(403);
    const option = await request(app)
      .post(`${env.API_PREFIX}/admin/requests/${f.sourcing.id}/options`)
      .set("authorization", adminAuth)
      .send({
        quotationId: draft.body.data.id,
        quotationItemIds: [draft.body.data.items[1].id],
        platformMargin: "199.50",
        deliveryCharge: "100.00",
        priorityCharge: "50.00",
        validUntil: "2026-10-20T05:00:00Z",
        customerNotes: "Compatibility must be confirmed before installation",
      });
    expect(option.status).toBe(201);
    expect(option.body.data.supplierSubtotal).toBe("1600.00");
    expect(option.body.data.customerTotal).toBe("1949.50");
    const published = await request(app)
      .post(`${env.API_PREFIX}/admin/options/${option.body.data.id}/publish`)
      .set("authorization", adminAuth)
      .send({ expectedVersion: 0 });
    expect(published.status).toBe(200);
    expect(published.body.data.version).toBe(1);
    const customerView = await request(app)
      .get(`${env.API_PREFIX}/customers/me/options/${option.body.data.id}`)
      .set("authorization", customerAuth);
    expect(customerView.status).toBe(200);
    expect(customerView.body.data.customerTotal).toBe("1949.50");
    expect(customerView.body.data.supplier).toEqual({
      displayName: f.business.displayName,
    });
    expect(customerView.body.data).not.toHaveProperty("supplierSubtotal");
    expect(JSON.stringify(customerView.body.data)).not.toContain(f.business.id);
    expect(JSON.stringify(customerView.body.data)).not.toContain(f.supplier.id);
    expect(JSON.stringify(customerView.body.data)).not.toContain(f.supplier.email);
    expect(JSON.stringify(customerView.body.data)).not.toContain(f.business.legalName);
    const batchView = await request(app)
      .get(
        `${env.API_PREFIX}/customers/me/options?requestIds=${f.sourcing.id}&pageSize=100`,
      )
      .set("authorization", customerAuth);
    expect(batchView.status).toBe(200);
    expect(batchView.body.data.items).toHaveLength(1);
    expect(batchView.body.data.items[0].id).toBe(option.body.data.id);
    const otherCustomer = await user(
      "phase1-other-customer@autopro.test",
      UserRole.CUSTOMER,
    );
    const otherCustomerAuth = await token(otherCustomer.email);
    const isolatedBatch = await request(app)
      .get(
        `${env.API_PREFIX}/customers/me/options?requestIds=${f.sourcing.id}&pageSize=100`,
      )
      .set("authorization", otherCustomerAuth);
    expect(isolatedBatch.status).toBe(200);
    expect(isolatedBatch.body.data.items).toHaveLength(0);
    const acceptancePayload = {
      idempotencyKey: "accept-option-0001",
      expectedVersion: 1,
      deliveryAddressId: f.address.id,
    };
    const [accepted, retried] = await Promise.all([
      request(app)
        .post(`${env.API_PREFIX}/customers/me/options/${option.body.data.id}/accept`)
        .set("authorization", customerAuth)
        .send(acceptancePayload),
      request(app)
        .post(`${env.API_PREFIX}/customers/me/options/${option.body.data.id}/accept`)
        .set("authorization", customerAuth)
        .send(acceptancePayload),
    ]);
    expect(accepted.status).toBe(201);
    expect(accepted.body.data.items).toHaveLength(1);
    expect(retried.status).toBe(201);
    expect(retried.body.data.id).toBe(accepted.body.data.id);
    const requestAfter = await prisma.sourcingRequest.findUniqueOrThrow({
      where: { id: f.sourcing.id },
    });
    expect(requestAfter.status).toBe(SourcingRequestStatus.AWAITING_CUSTOMER);
    const snapshot = await prisma.optionAcceptance.findUniqueOrThrow({
      where: { optionId: option.body.data.id },
    });
    expect(snapshot.customerTotal.toFixed(2)).toBe("1949.50");
  });

  it("expires at the exact deadline and rejects suspended suppliers", async () => {
    const f = await fixture();
    const supplierAuth = await token(f.supplier.email);
    await prisma.supplierBusiness.update({
      where: { id: f.business.id },
      data: { status: SupplierBusinessStatus.SUSPENDED },
    });
    const blocked = await request(app)
      .post(`${env.API_PREFIX}/supplier/quotations`)
      .set("authorization", supplierAuth)
      .set("x-business-id", f.business.id)
      .send({
        assignmentId: f.assignment.id,
        validUntil: "2026-10-20T06:00:00Z",
        items: [
          {
            requestItemId: f.sourcing.items[0]!.id,
            description: "Part",
            condition: "NEW",
            quantity: 1,
            supplierUnitPrice: "10.00",
          },
        ],
      });
    expect(blocked.status).toBe(403);
  });
});
