import {
  AccountStatus,
  AdminReviewStatus,
  OrderStatus,
  ProductCondition,
  QuotationStatus,
  RequestUrgency,
  SourcingOptionStatus,
  SourcingRequestStatus,
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
  await prisma.notificationDelivery.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.outboxEvent.deleteMany();
  await prisma.operationalCaseHistory.deleteMany();
  await prisma.operationalCase.deleteMany();
  await prisma.supplierRecovery.deleteMany();
  await prisma.settlementAllocation.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.supplierSettlement.deleteMany();
  await prisma.supplierPayable.deleteMany();
  await prisma.refund.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.messageAttachment.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversationParticipant.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.refreshSession.deleteMany();
  await prisma.urgentFulfillmentHistory.deleteMany();
  await prisma.orderReturn.deleteMany();
  await prisma.orderFailure.deleteMany();
  await prisma.orderCancellationRequest.deleteMany();
  await prisma.inventoryReservationEvent.deleteMany();
  await prisma.inventoryReservation.deleteMany();
  await prisma.deliveryStatusHistory.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.fulfillmentStatusHistory.deleteMany();
  await prisma.orderConversionAttempt.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.optionAcceptanceItem.deleteMany();
  await prisma.optionAcceptance.deleteMany();
  await prisma.sourcingOptionHistory.deleteMany();
  await prisma.sourcingOptionLine.deleteMany();
  await prisma.sourcingOption.deleteMany();
  await prisma.quotationStatusHistory.deleteMany();
  await prisma.quotationItem.deleteMany();
  await prisma.quotation.deleteMany();
  await prisma.supplierAssignmentHistory.deleteMany();
  await prisma.supplierRequestAssignment.deleteMany();
  await prisma.requestStatusHistory.deleteMany();
  await prisma.sourcingRequestItem.deleteMany();
  await prisma.sourcingRequest.deleteMany();
  await prisma.inventoryStockAdjustment.deleteMany();
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

async function createUser(email: string, role: UserRole) {
  return prisma.user.create({
    data: {
      email,
      fullName: role,
      passwordHash: await hashPassword(password),
      role,
      accountStatus: AccountStatus.ACTIVE,
      customerProfile:
        role === UserRole.CUSTOMER
          ? { create: { fullName: "Phase Two Customer" } }
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

async function baseFixture() {
  const [customer, supplier, otherSupplier, admin] = await Promise.all([
    createUser("phase2-customer@autopro.test", UserRole.CUSTOMER),
    createUser("phase2-supplier@autopro.test", UserRole.SUPPLIER_OWNER),
    createUser("phase2-other@autopro.test", UserRole.SUPPLIER_OWNER),
    createUser("phase2-admin@autopro.test", UserRole.ADMIN),
  ]);
  const category = await prisma.partCategory.create({
    data: { name: "Phase Two Parts", slug: `phase-two-${randomUUID()}` },
  });
  const product = await prisma.product.create({
    data: { name: "Phase Two Brake Pad", categoryId: category.id },
  });
  const business = await prisma.supplierBusiness.create({
    data: {
      legalName: "Phase Two Supplier Ltd",
      displayName: "Phase Two Supplier",
      status: SupplierBusinessStatus.ACTIVE,
      subscriptionGraceEndsAt: new Date("2099-01-01T00:00:00.000Z"),
      members: { create: { userId: supplier.id, isPrimary: true } },
    },
  });
  const otherBusiness = await prisma.supplierBusiness.create({
    data: {
      legalName: "Other Supplier Ltd",
      displayName: "Other Supplier",
      status: SupplierBusinessStatus.ACTIVE,
      subscriptionGraceEndsAt: new Date("2099-01-01T00:00:00.000Z"),
      members: { create: { userId: otherSupplier.id, isPrimary: true } },
    },
  });
  const inventory = await prisma.supplierInventory.create({
    data: {
      businessId: business.id,
      productId: product.id,
      sku: "PHASE2-PAD",
      stockQuantity: 4,
      unitPrice: "100.00",
      isAvailable: true,
      availabilityStatus: "IN_STOCK",
    },
  });
  return {
    customer,
    supplier,
    otherSupplier,
    admin,
    category,
    product,
    business,
    otherBusiness,
    inventory,
  };
}

async function acceptance(
  fixture: Awaited<ReturnType<typeof baseFixture>>,
  input: {
    quantity?: number;
    inventory?: boolean;
    externalLine?: boolean;
    urgent?: boolean;
  } = {},
) {
  const quantity = input.quantity ?? 2;
  const sourcing = await prisma.sourcingRequest.create({
    data: {
      requestNumber: `RFQ-P2-${randomUUID()}`,
      customerId: fixture.customer.customerProfile!.id,
      status: SourcingRequestStatus.ACCEPTED,
      urgency: input.urgent ? RequestUrgency.URGENT : RequestUrgency.STANDARD,
      submittedAt: clock.now(),
      items: {
        create: [
          {
            lineNumber: 1,
            description: "Inventory brake pad",
            quantity,
            productId: fixture.product.id,
            categoryId: fixture.category.id,
            status: "ACCEPTED",
          },
          ...(input.externalLine
            ? [
                {
                  lineNumber: 2,
                  description: "Externally sourced clip",
                  quantity: 1,
                  categoryId: fixture.category.id,
                  status: "ACCEPTED" as const,
                },
              ]
            : []),
        ],
      },
    },
    include: { items: true },
  });
  const quotation = await prisma.quotation.create({
    data: {
      quotationNumber: `QT-P2-${randomUUID()}`,
      requestId: sourcing.id,
      businessId: fixture.business.id,
      revisionGroupId: randomUUID(),
      status: QuotationStatus.SENT_TO_CUSTOMER,
      adminReviewStatus: AdminReviewStatus.APPROVED,
      supplierSubtotal: input.externalLine ? "250.00" : `${quantity * 100}.00`,
      customerTotal: input.externalLine ? "330.00" : `${quantity * 125 + 30}.00`,
      items: {
        create: [
          {
            lineNumber: 1,
            requestItemId: sourcing.items[0]!.id,
            productId: fixture.product.id,
            inventoryId: input.inventory === false ? null : fixture.inventory.id,
            description: "Inventory brake pad",
            condition: ProductCondition.NEW,
            quantity,
            supplierUnitPrice: "100.00",
            supplierLineTotal: `${quantity * 100}.00`,
          },
          ...(input.externalLine
            ? [
                {
                  lineNumber: 2,
                  requestItemId: sourcing.items[1]!.id,
                  description: "Externally sourced clip",
                  condition: ProductCondition.NEW,
                  quantity: 1,
                  supplierUnitPrice: "50.00",
                  supplierLineTotal: "50.00",
                },
              ]
            : []),
        ],
      },
    },
    include: { items: { orderBy: { lineNumber: "asc" } } },
  });
  const option = await prisma.sourcingOption.create({
    data: {
      optionNumber: `OPT-P2-${randomUUID()}`,
      requestId: sourcing.id,
      quotationId: quotation.id,
      versionGroupId: randomUUID(),
      status: SourcingOptionStatus.ACCEPTED,
      currency: "BDT",
      supplierSubtotal: quotation.supplierSubtotal,
      platformMargin: input.externalLine ? "50.00" : `${quantity * 25}.00`,
      deliveryCharge: "20.00",
      priorityCharge: "10.00",
      customerItemsTotal: input.externalLine ? "300.00" : `${quantity * 125}.00`,
      customerTotal: input.externalLine ? "330.00" : `${quantity * 125 + 30}.00`,
      validUntil: new Date("2026-10-20T08:00:00Z"),
      publishedAt: clock.now(),
      lines: {
        create: quotation.items.map((item, index) => ({
          requestItemId: item.requestItemId!,
          quotationItemId: item.id,
          lineNumber: index + 1,
          description: item.description,
          condition: item.condition,
          quantity: item.quantity,
          supplierUnitPrice: item.supplierUnitPrice,
          supplierLineTotal: item.supplierLineTotal,
          customerUnitPrice: index === 0 ? "125.00" : "50.00",
          customerLineTotal: index === 0 ? `${quantity * 125}.00` : "50.00",
        })),
      },
    },
    include: { lines: { orderBy: { lineNumber: "asc" } } },
  });
  return prisma.optionAcceptance.create({
    data: {
      optionId: option.id,
      requestId: sourcing.id,
      customerId: fixture.customer.customerProfile!.id,
      idempotencyKey: randomUUID(),
      optionRevision: 1,
      currency: "BDT",
      customerItemsTotal: option.customerItemsTotal,
      deliveryCharge: option.deliveryCharge,
      priorityCharge: option.priorityCharge,
      customerTotal: option.customerTotal,
      deliverySnapshot: {
        recipientName: "Customer",
        phone: "+8801700000000",
        addressLine: "Private Road",
        area: "Dhanmondi",
        city: "Dhaka",
      },
      items: {
        create: option.lines.map((line) => ({
          requestItemId: line.requestItemId,
          optionLineId: line.id,
          quotationItemId: line.quotationItemId,
          description: line.description,
          condition: line.condition,
          quantity: line.quantity,
          customerUnitPrice: line.customerUnitPrice,
          customerLineTotal: line.customerLineTotal,
          isAlternative: false,
        })),
      },
    },
  });
}

beforeEach(async () => {
  clock.current = new Date("2026-10-19T08:00:00Z");
  await clean();
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("Phase 2 order conversion and reservation accounting", () => {
  it("converts exactly once, preserves prices, reserves atomically and enforces tenant privacy", async () => {
    const fixture = await baseFixture();
    const accepted = await acceptance(fixture);
    const [adminAuth, customerAuth, supplierAuth, otherAuth] = await Promise.all([
      token(fixture.admin.email),
      token(fixture.customer.email),
      token(fixture.supplier.email),
      token(fixture.otherSupplier.email),
    ]);
    const path = `${env.API_PREFIX}/admin/acceptances/${accepted.id}/orders`;
    const [first, second] = await Promise.all([
      request(app)
        .post(path)
        .set("authorization", adminAuth)
        .send({ idempotencyKey: "convert-order-0001" }),
      request(app)
        .post(path)
        .set("authorization", adminAuth)
        .send({ idempotencyKey: "convert-order-0001" }),
    ]);
    expect(
      [first.status, second.status],
      JSON.stringify([first.body, second.body]),
    ).toEqual([201, 201]);
    expect(first.body.data.order.id).toBe(second.body.data.order.id);
    expect(await prisma.order.count({ where: { acceptanceId: accepted.id } })).toBe(1);
    expect(
      (
        await prisma.supplierInventory.findUniqueOrThrow({
          where: { id: fixture.inventory.id },
        })
      ).reservedQuantity,
    ).toBe(2);
    expect(first.body.data.order.customerTotal).toBe("280.00");
    expect(first.body.data.order.supplierSubtotal).toBe("200.00");
    const protectedAdjustment = await request(app)
      .post(
        `${env.API_PREFIX}/supplier/inventory/${fixture.inventory.id}/stock-adjustments`,
      )
      .set("authorization", supplierAuth)
      .set("x-business-id", fixture.business.id)
      .send({
        idempotencyKey: "reserved-stock-protection",
        quantityDelta: -3,
        reason: "Attempt below real reservation",
      });
    expect(protectedAdjustment.status).toBe(409);
    const currentInventory = await prisma.supplierInventory.findUniqueOrThrow({
      where: { id: fixture.inventory.id },
    });
    const protectedBulk = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/bulk`)
      .set("authorization", supplierAuth)
      .set("x-business-id", fixture.business.id)
      .send({
        operationId: "reserved-bulk-protection",
        items: [
          {
            inventoryId: fixture.inventory.id,
            version: currentInventory.version,
            stockQuantity: 1,
            stockReason: "Attempt below reservation",
          },
        ],
      });
    expect(protectedBulk.status).toBe(409);

    const customerView = await request(app)
      .get(`${env.API_PREFIX}/customers/me/orders/${first.body.data.order.id}`)
      .set("authorization", customerAuth);
    expect(customerView.status).toBe(200);
    expect(customerView.body.data.supplierSubtotal).toBeUndefined();
    expect(customerView.body.data.platformMargin).toBeUndefined();
    const supplierView = await request(app)
      .get(`${env.API_PREFIX}/supplier/fulfillment/${first.body.data.order.id}`)
      .set("authorization", supplierAuth)
      .set("x-business-id", fixture.business.id);
    expect(supplierView.status).toBe(200);
    expect(supplierView.body.data.deliveryArea).toEqual({
      area: "Dhanmondi",
      city: "Dhaka",
    });
    expect(JSON.stringify(supplierView.body)).not.toContain("Private Road");
    expect(JSON.stringify(supplierView.body)).not.toContain("+8801700000000");
    const isolated = await request(app)
      .get(`${env.API_PREFIX}/supplier/fulfillment/${first.body.data.order.id}`)
      .set("authorization", otherAuth)
      .set("x-business-id", fixture.otherBusiness.id);
    expect(isolated.status).toBe(404);
  });

  it("allows only one competing reservation and records the failed conversion without partial writes", async () => {
    const fixture = await baseFixture();
    await prisma.supplierInventory.update({
      where: { id: fixture.inventory.id },
      data: { stockQuantity: 3 },
    });
    const [one, two] = await Promise.all([acceptance(fixture), acceptance(fixture)]);
    const adminAuth = await token(fixture.admin.email);
    const responses = await Promise.all([
      request(app)
        .post(`${env.API_PREFIX}/admin/acceptances/${one.id}/orders`)
        .set("authorization", adminAuth)
        .send({ idempotencyKey: "competing-order-one" }),
      request(app)
        .post(`${env.API_PREFIX}/admin/acceptances/${two.id}/orders`)
        .set("authorization", adminAuth)
        .send({ idempotencyKey: "competing-order-two" }),
    ]);
    expect(
      responses.map((item) => item.status).sort(),
      JSON.stringify(responses.map((item) => item.body)),
    ).toEqual([201, 409]);
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.inventoryReservation.count()).toBe(1);
    expect(
      (
        await prisma.supplierInventory.findUniqueOrThrow({
          where: { id: fixture.inventory.id },
        })
      ).reservedQuantity,
    ).toBe(2);
    expect(
      await prisma.orderConversionAttempt.count({ where: { status: "EXCEPTION" } }),
    ).toBe(1);
  });
});

describe("Phase 2 fulfillment, cancellation, returns and urgency", () => {
  it("runs mixed sourcing through confirmation, pickup consumption, delivery and inspected return", async () => {
    const fixture = await baseFixture();
    const accepted = await acceptance(fixture, { externalLine: true, urgent: true });
    const [adminAuth, supplierAuth, customerAuth] = await Promise.all([
      token(fixture.admin.email),
      token(fixture.supplier.email),
      token(fixture.customer.email),
    ]);
    const converted = await request(app)
      .post(`${env.API_PREFIX}/admin/acceptances/${accepted.id}/orders`)
      .set("authorization", adminAuth)
      .send({ idempotencyKey: "mixed-order-0001" });
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);
    const orderId = converted.body.data.order.id;
    expect(converted.body.data.order.status).toBe(
      OrderStatus.PENDING_SUPPLIER_CONFIRMATION,
    );
    const supplierHeaders = {
      authorization: supplierAuth,
      "x-business-id": fixture.business.id,
    };
    expect(
      (
        await request(app)
          .post(`${env.API_PREFIX}/supplier/fulfillment/${orderId}/availability`)
          .set(supplierHeaders)
          .send({ available: true, note: "External clip confirmed" })
      ).body.data.status,
    ).toBe(OrderStatus.CONFIRMED);
    for (const toStatus of [
      OrderStatus.SUPPLIER_PREPARING,
      OrderStatus.READY_FOR_PICKUP,
    ]) {
      const response = await request(app)
        .post(`${env.API_PREFIX}/supplier/fulfillment/${orderId}/transitions`)
        .set(supplierHeaders)
        .send({ toStatus });
      expect(response.body.data.status).toBe(toStatus);
    }
    const urgent = await request(app)
      .post(`${env.API_PREFIX}/admin/orders/${orderId}/urgent-eligibility`)
      .set("authorization", adminAuth)
      .send({
        eligibility: "ELIGIBLE",
        basis: "Dhaka service area and supplier confirmation",
        estimatedWindowStart: "2026-10-19T08:30:00Z",
        estimatedWindowEnd: "2026-10-19T10:00:00Z",
        targetDeadlineAt: "2026-10-19T10:00:00Z",
      });
    expect(urgent.status).toBe(200);
    clock.current = new Date("2026-10-19T10:00:00Z");
    const boundary = await request(app)
      .get(`${env.API_PREFIX}/admin/orders/${orderId}`)
      .set("authorization", adminAuth);
    expect(boundary.body.data.urgent.breached).toBe(true);
    clock.current = new Date("2026-10-19T08:00:00Z");
    for (const toStatus of [
      OrderStatus.PICKED_UP,
      OrderStatus.IN_DELIVERY,
      OrderStatus.DELIVERED,
      OrderStatus.COMPLETED,
    ]) {
      const response = await request(app)
        .post(`${env.API_PREFIX}/admin/orders/${orderId}/transitions`)
        .set("authorization", adminAuth)
        .send({
          toStatus,
          ...(toStatus === OrderStatus.PICKED_UP
            ? { courierName: "Manual Courier", trackingReference: "LOCAL-101" }
            : {}),
        });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
    }
    const inventory = await prisma.supplierInventory.findUniqueOrThrow({
      where: { id: fixture.inventory.id },
    });
    expect(inventory.stockQuantity).toBe(2);
    expect(inventory.reservedQuantity).toBe(0);
    expect((await prisma.inventoryReservation.findFirstOrThrow()).status).toBe(
      "CONSUMED",
    );
    const returnRequest = await request(app)
      .post(`${env.API_PREFIX}/customers/me/orders/${orderId}/returns`)
      .set("authorization", customerAuth)
      .send({ reason: "Part was not needed" });
    const returnId = returnRequest.body.data.id;
    await request(app)
      .post(`${env.API_PREFIX}/admin/orders/${orderId}/returns/${returnId}/decision`)
      .set("authorization", adminAuth)
      .send({ decision: "APPROVED", reason: "Return authorized", refundRequired: true });
    await request(app)
      .post(`${env.API_PREFIX}/admin/orders/${orderId}/returns/${returnId}/receive`)
      .set("authorization", adminAuth)
      .send({ note: "Package received" });
    const inspected = await request(app)
      .post(`${env.API_PREFIX}/admin/orders/${orderId}/returns/${returnId}/inspect`)
      .set("authorization", adminAuth)
      .send({ note: "Unused and saleable", restock: true, refundRequired: true });
    expect(inspected.body.data.status).toBe(OrderStatus.RETURNED);
    expect(
      (
        await prisma.supplierInventory.findUniqueOrThrow({
          where: { id: fixture.inventory.id },
        })
      ).stockQuantity,
    ).toBe(4);
    expect((await prisma.inventoryReservation.findFirstOrThrow()).status).toBe(
      "RESTORED",
    );
  });

  it("releases reservations and accepted allocation exactly once on approved pre-pickup cancellation", async () => {
    const fixture = await baseFixture();
    const accepted = await acceptance(fixture);
    const [adminAuth, customerAuth] = await Promise.all([
      token(fixture.admin.email),
      token(fixture.customer.email),
    ]);
    const converted = await request(app)
      .post(`${env.API_PREFIX}/admin/acceptances/${accepted.id}/orders`)
      .set("authorization", adminAuth)
      .send({ idempotencyKey: "cancel-order-0001" });
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);
    const orderId = converted.body.data.order.id;
    const cancellation = await request(app)
      .post(`${env.API_PREFIX}/customers/me/orders/${orderId}/cancellations`)
      .set("authorization", customerAuth)
      .send({ reason: "Ordered by mistake" });
    const path = `${env.API_PREFIX}/admin/orders/${orderId}/cancellations/${cancellation.body.data.id}/decision`;
    const first = await request(app)
      .post(path)
      .set("authorization", adminAuth)
      .send({ decision: "APPROVED", reason: "Approved before pickup" });
    const repeated = await request(app)
      .post(path)
      .set("authorization", adminAuth)
      .send({ decision: "APPROVED", reason: "Approved before pickup" });
    expect(first.body.data.status).toBe(OrderStatus.CANCELLED);
    expect(repeated.body.data.status).toBe(OrderStatus.CANCELLED);
    expect(
      (
        await prisma.supplierInventory.findUniqueOrThrow({
          where: { id: fixture.inventory.id },
        })
      ).reservedQuantity,
    ).toBe(0);
    expect((await prisma.inventoryReservation.findFirstOrThrow()).status).toBe(
      "RELEASED",
    );
    expect(
      (await prisma.optionAcceptance.findUniqueOrThrow({ where: { id: accepted.id } }))
        .allocationReleasedAt,
    ).not.toBeNull();
    expect(
      await prisma.inventoryReservationEvent.count({ where: { eventType: "RELEASED" } }),
    ).toBe(1);
  });
});
