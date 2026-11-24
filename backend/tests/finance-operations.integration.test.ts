import {
  AccountStatus,
  OrderStatus,
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
import { cleanupFulfillment } from "./helpers/cleanup-fulfillment.js";

const env = loadEnv();
const logger = createLogger();
const password = "StrongPassword123";
class FixedClock implements MatchingClock {
  now() {
    return new Date("2026-10-19T12:00:00Z");
  }
}
const app = createApp(env, logger, { matchingClock: new FixedClock() });

async function clean() {
  await cleanupFulfillment(prisma);
  await prisma.platformBusinessConfig.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.refreshSession.deleteMany();
  await prisma.supplierUser.deleteMany();
  await prisma.supplierBusiness.deleteMany();
  await prisma.customerProfile.deleteMany();
  await prisma.user.deleteMany();
}

async function user(email: string, role: UserRole) {
  return prisma.user.create({
    data: {
      email,
      fullName: role,
      role,
      accountStatus: AccountStatus.ACTIVE,
      passwordHash: await hashPassword(password),
      customerProfile:
        role === UserRole.CUSTOMER
          ? { create: { fullName: "Finance Customer" } }
          : undefined,
    },
    include: { customerProfile: true },
  });
}

async function auth(email: string) {
  const result = await request(app)
    .post(`${env.API_PREFIX}/auth/login`)
    .send({ email, password });
  expect(result.status).toBe(200);
  return `Bearer ${result.body.data.accessToken}`;
}

async function fixture(status: OrderStatus = OrderStatus.CONFIRMED) {
  const [admin, customer, supplier, otherCustomer] = await Promise.all([
    user(`finance-admin-${randomUUID()}@test.local`, UserRole.ADMIN),
    user(`finance-customer-${randomUUID()}@test.local`, UserRole.CUSTOMER),
    user(`finance-supplier-${randomUUID()}@test.local`, UserRole.SUPPLIER_OWNER),
    user(`finance-other-${randomUUID()}@test.local`, UserRole.CUSTOMER),
  ]);
  const business = await prisma.supplierBusiness.create({
    data: {
      legalName: "Finance Supplier Ltd",
      displayName: "Finance Supplier",
      status: SupplierBusinessStatus.ACTIVE,
      subscriptionGraceEndsAt: new Date("2099-01-01T00:00:00.000Z"),
      members: { create: { userId: supplier.id, isPrimary: true } },
    },
  });
  const order = await prisma.order.create({
    data: {
      orderNumber: `ORD-FIN-${randomUUID()}`,
      customerId: customer.customerProfile!.id,
      businessId: business.id,
      status,
      currency: "BDT",
      supplierSubtotal: "700.00",
      supplierPayable: "700.00",
      platformMargin: "200.00",
      deliveryCharge: "60.00",
      priorityCharge: "40.00",
      customerTotal: "1000.00",
      completedAt:
        status === OrderStatus.COMPLETED ? new Date("2026-10-19T11:00:00Z") : null,
      deliverySnapshot: {
        recipientName: "Finance Customer",
        phone: "+8801700000000",
        addressLine: "Private invoice address",
        city: "Dhaka",
      },
      items: {
        create: {
          lineNumber: 1,
          description: "Brake kit",
          quantity: 2,
          supplierUnitPrice: "350.00",
          supplierLineTotal: "700.00",
          customerUnitPrice: "450.00",
          customerLineTotal: "900.00",
        },
      },
    },
  });
  return { admin, customer, supplier, otherCustomer, business, order };
}

beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("Phase 4 invoices and customer receipts", () => {
  it("issues an immutable private invoice, records partial payments and rejects overpayment", async () => {
    const f = await fixture();
    const [admin, customer, other] = await Promise.all([
      auth(f.admin.email),
      auth(f.customer.email),
      auth(f.otherCustomer.email),
    ]);
    expect(
      (
        await request(app)
          .post(`${env.API_PREFIX}/admin/finance/orders/${f.order.id}/invoices`)
          .set("authorization", customer)
          .send({})
      ).status,
    ).toBe(403);
    const issued = await request(app)
      .post(`${env.API_PREFIX}/admin/finance/orders/${f.order.id}/invoices`)
      .set("authorization", admin)
      .send({ dueAt: "2026-10-25T00:00:00Z" });
    expect(issued.status).toBe(201);
    expect(issued.body.data.invoice.total).toBe("1000.00");
    expect(JSON.stringify(issued.body)).not.toContain("supplierSubtotal");
    const payment = await request(app)
      .post(`${env.API_PREFIX}/admin/finance/orders/${f.order.id}/payments`)
      .set("authorization", admin)
      .send({
        amount: "400.00",
        method: "bank",
        externalReference: "BANK-001",
        occurredAt: "2026-10-19T11:30:00Z",
        idempotencyKey: "payment-finance-001",
      });
    expect(payment.status).toBe(201);
    const list = await request(app)
      .get(`${env.API_PREFIX}/customers/me/finance/invoices`)
      .set("authorization", customer);
    expect(list.body.data.items[0]).toMatchObject({
      received: "400.00",
      outstanding: "600.00",
      status: "ISSUED",
    });
    const overpay = await request(app)
      .post(`${env.API_PREFIX}/admin/finance/orders/${f.order.id}/payments`)
      .set("authorization", admin)
      .send({
        amount: "700.00",
        method: "bank",
        externalReference: "BANK-002",
        occurredAt: "2026-10-19T11:40:00Z",
        idempotencyKey: "payment-finance-002",
      });
    expect(overpay.status).toBe(409);
    const pdf = await request(app)
      .get(
        `${env.API_PREFIX}/customers/me/finance/invoices/${issued.body.data.invoice.id}/pdf`,
      )
      .set("authorization", customer)
      .buffer(true);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(Buffer.from(pdf.body).subarray(0, 4).toString()).toBe("%PDF");
    expect(
      (
        await request(app)
          .get(
            `${env.API_PREFIX}/customers/me/finance/invoices/${issued.body.data.invoice.id}`,
          )
          .set("authorization", other)
      ).status,
    ).toBe(404);
  });

  it("deduplicates concurrent payment retries and duplicate external references", async () => {
    const f = await fixture();
    const admin = await auth(f.admin.email);
    await request(app)
      .post(`${env.API_PREFIX}/admin/finance/orders/${f.order.id}/invoices`)
      .set("authorization", admin)
      .send({});
    const body = {
      amount: "500.00",
      method: "cash",
      externalReference: "CASH-55",
      occurredAt: "2026-10-19T11:30:00Z",
      idempotencyKey: "payment-concurrent-001",
    };
    const results = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post(`${env.API_PREFIX}/admin/finance/orders/${f.order.id}/payments`)
          .set("authorization", admin)
          .send(body),
      ),
    );
    expect(results.every((result) => result.status === 201)).toBe(true);
    expect(await prisma.transaction.count({ where: { type: "CUSTOMER_PAYMENT" } })).toBe(
      1,
    );
    const duplicateReference = await request(app)
      .post(`${env.API_PREFIX}/admin/finance/orders/${f.order.id}/payments`)
      .set("authorization", admin)
      .send({ ...body, idempotencyKey: "payment-concurrent-002", amount: "100.00" });
    expect(duplicateReference.status).toBe(409);
  });

  it("corrects posted receipts only through one linked reversal", async () => {
    const f = await fixture();
    const admin = await auth(f.admin.email);
    await request(app)
      .post(`${env.API_PREFIX}/admin/finance/orders/${f.order.id}/invoices`)
      .set("authorization", admin)
      .send({});
    const payment = await request(app)
      .post(`${env.API_PREFIX}/admin/finance/orders/${f.order.id}/payments`)
      .set("authorization", admin)
      .send({
        amount: "400.00",
        method: "bank",
        externalReference: "REVERSIBLE-1",
        occurredAt: "2026-10-19T11:00:00Z",
        idempotencyKey: "reversible-payment-001",
      });
    const reversed = await request(app)
      .post(
        `${env.API_PREFIX}/admin/finance/transactions/${payment.body.data.transaction.id}/reversals`,
      )
      .set("authorization", admin)
      .send({
        reason: "External receipt was recorded against the wrong order",
        idempotencyKey: "reversal-payment-001",
      });
    expect(reversed.status).toBe(201);
    expect(reversed.body.data.transaction.reversalOfId).toBe(
      payment.body.data.transaction.id,
    );
    expect(
      await prisma.transaction.count({
        where: { reversalOfId: payment.body.data.transaction.id },
      }),
    ).toBe(1);
  });
});

describe("Phase 4 refunds, settlements and operations", () => {
  it("counts approved pending refunds against the receipt limit and records completion", async () => {
    const f = await fixture();
    const admin = await auth(f.admin.email);
    await request(app)
      .post(`${env.API_PREFIX}/admin/finance/orders/${f.order.id}/invoices`)
      .set("authorization", admin)
      .send({});
    await request(app)
      .post(`${env.API_PREFIX}/admin/finance/orders/${f.order.id}/payments`)
      .set("authorization", admin)
      .send({
        amount: "1000.00",
        method: "bank",
        externalReference: "FULL-PAY",
        occurredAt: "2026-10-19T11:00:00Z",
        idempotencyKey: "full-payment-001",
      });
    await prisma.order.update({
      where: { id: f.order.id },
      data: {
        status: OrderStatus.CANCELLED,
        cancelledAt: new Date("2026-10-19T11:30:00Z"),
      },
    });
    const first = await request(app)
      .post(`${env.API_PREFIX}/admin/finance/orders/${f.order.id}/refunds`)
      .set("authorization", admin)
      .send({
        amount: "700.00",
        reason: "Cancelled before pickup",
        idempotencyKey: "refund-approval-001",
      });
    expect(first.status).toBe(201);
    const excessive = await request(app)
      .post(`${env.API_PREFIX}/admin/finance/orders/${f.order.id}/refunds`)
      .set("authorization", admin)
      .send({
        amount: "400.00",
        reason: "Duplicate refund attempt",
        idempotencyKey: "refund-approval-002",
      });
    expect(excessive.status).toBe(409);
    const completed = await request(app)
      .post(
        `${env.API_PREFIX}/admin/finance/refunds/${first.body.data.refund.id}/complete`,
      )
      .set("authorization", admin)
      .send({
        method: "bank",
        externalReference: "REFUND-OUT-1",
        occurredAt: "2026-10-19T12:00:00Z",
        idempotencyKey: "refund-complete-001",
      });
    expect(completed.status).toBe(201);
    expect(completed.body.data.transaction.amount).toBe("700.00");
  });

  it("recognizes completed-order payables and prevents duplicate settlement allocation", async () => {
    const f = await fixture(OrderStatus.COMPLETED);
    const [admin, supplier] = await Promise.all([
      auth(f.admin.email),
      auth(f.supplier.email),
    ]);
    const payable = await request(app)
      .post(`${env.API_PREFIX}/admin/finance/orders/${f.order.id}/payables`)
      .set("authorization", admin)
      .send({});
    expect(payable.status).toBe(201);
    const settlement = await request(app)
      .post(`${env.API_PREFIX}/admin/finance/settlements`)
      .set("authorization", admin)
      .send({
        businessId: f.business.id,
        allocations: [{ payableId: payable.body.data.payable.id, amount: "700.00" }],
        method: "bank",
        externalReference: "SUPPLIER-PAYOUT-1",
        occurredAt: "2026-10-19T12:00:00Z",
        idempotencyKey: "settlement-001",
      });
    expect(settlement.status).toBe(201);
    const again = await request(app)
      .post(`${env.API_PREFIX}/admin/finance/settlements`)
      .set("authorization", admin)
      .send({
        businessId: f.business.id,
        allocations: [{ payableId: payable.body.data.payable.id, amount: "1.00" }],
        method: "bank",
        externalReference: "SUPPLIER-PAYOUT-2",
        occurredAt: "2026-10-19T12:05:00Z",
        idempotencyKey: "settlement-002",
      });
    expect(again.status).toBe(409);
    const summary = await request(app)
      .get(`${env.API_PREFIX}/supplier/finance/summary`)
      .set("authorization", supplier)
      .set("x-business-id", f.business.id);
    expect(summary.body.data).toMatchObject({
      totalPayable: "700.00",
      paid: "700.00",
      outstanding: "0.00",
    });
    expect(JSON.stringify(summary.body)).not.toContain("platformMargin");
    const otherSupplier = await user(
      `finance-other-supplier-${randomUUID()}@test.local`,
      UserRole.SUPPLIER_OWNER,
    );
    const otherBusiness = await prisma.supplierBusiness.create({
      data: {
        legalName: "Other Finance Supplier",
        displayName: "Other Finance Supplier",
        status: SupplierBusinessStatus.ACTIVE,
        subscriptionGraceEndsAt: new Date("2099-01-01T00:00:00.000Z"),
        members: { create: { userId: otherSupplier.id, isPrimary: true } },
      },
    });
    const otherAuth = await auth(otherSupplier.email);
    expect(
      (
        await request(app)
          .get(`${env.API_PREFIX}/supplier/finance/summary`)
          .set("authorization", otherAuth)
          .set("x-business-id", f.business.id)
      ).status,
    ).toBe(403);
    expect(otherBusiness.id).not.toBe(f.business.id);
  });

  it("preserves a supplier recovery when a return follows an external payout", async () => {
    const f = await fixture(OrderStatus.COMPLETED);
    const admin = await auth(f.admin.email);
    await request(app)
      .post(`${env.API_PREFIX}/admin/finance/orders/${f.order.id}/invoices`)
      .set("authorization", admin)
      .send({});
    await request(app)
      .post(`${env.API_PREFIX}/admin/finance/orders/${f.order.id}/payments`)
      .set("authorization", admin)
      .send({
        amount: "1000.00",
        method: "bank",
        externalReference: "RETURN-PAID-1",
        occurredAt: "2026-10-19T11:00:00Z",
        idempotencyKey: "return-payment-001",
      });
    const payable = await request(app)
      .post(`${env.API_PREFIX}/admin/finance/orders/${f.order.id}/payables`)
      .set("authorization", admin)
      .send({});
    await request(app)
      .post(`${env.API_PREFIX}/admin/finance/settlements`)
      .set("authorization", admin)
      .send({
        businessId: f.business.id,
        allocations: [{ payableId: payable.body.data.payable.id, amount: "700.00" }],
        method: "bank",
        externalReference: "RETURN-PAYOUT-1",
        occurredAt: "2026-10-19T11:30:00Z",
        idempotencyKey: "return-settlement-001",
      });
    const returned = await prisma.orderReturn.create({
      data: {
        orderId: f.order.id,
        customerId: f.customer.customerProfile!.id,
        status: "INSPECTED",
        reason: "Returned after delivery",
        requestedByUserId: f.customer.id,
        inspectedAt: new Date("2026-10-19T11:45:00Z"),
        refundRequired: true,
      },
    });
    const refund = await request(app)
      .post(`${env.API_PREFIX}/admin/finance/orders/${f.order.id}/refunds`)
      .set("authorization", admin)
      .send({
        amount: "1000.00",
        reason: "Inspected full return",
        idempotencyKey: "return-refund-001",
      });
    expect(refund.status).toBe(201);
    const recovery = await prisma.supplierRecovery.findUnique({
      where: { orderReturnId: returned.id },
      include: { payable: true },
    });
    expect(recovery?.amount.toFixed(2)).toBe("700.00");
    expect(recovery?.payable.status).toBe("RECOVERY_DUE");
  });

  it("returns bounded real summaries, safe audits and deduplicated financial events", async () => {
    const f = await fixture();
    const admin = await auth(f.admin.email);
    await request(app)
      .post(`${env.API_PREFIX}/admin/finance/orders/${f.order.id}/invoices`)
      .set("authorization", admin)
      .send({});
    const dashboard = await request(app)
      .get(
        `${env.API_PREFIX}/admin/operations/dashboard?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z&timezone=Asia%2FDhaka`,
      )
      .set("authorization", admin);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.financial.currency).toBe("BDT");
    const audits = await request(app)
      .get(`${env.API_PREFIX}/admin/operations/audit-logs?pageSize=10`)
      .set("authorization", admin);
    expect(audits.status).toBe(200);
    expect(
      audits.body.data.items.some(
        (row: { action: string }) => row.action === "FINANCE_INVOICE_ISSUED",
      ),
    ).toBe(true);
    expect(
      await prisma.outboxEvent.count({ where: { eventType: "INVOICE_ISSUED" } }),
    ).toBe(1);
  });
});
