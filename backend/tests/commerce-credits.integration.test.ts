import {
  AccountStatus,
  CreditRequirementStatus,
  OrderStatus,
  SourcingRequestType,
  SupplierBusinessStatus,
  UserRole,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/prisma.js";
import { CreditService } from "../src/modules/credits/credit.service.js";
import { cleanupFulfillment } from "./helpers/cleanup-fulfillment.js";

const now = () => new Date("2026-10-30T08:00:00.000Z");
const credits = new CreditService(prisma, now);

async function clean() {
  await cleanupFulfillment(prisma);
  await prisma.supplierAssignmentHistory.deleteMany();
  await prisma.supplierRequestAssignment.deleteMany();
  await prisma.requestStatusHistory.deleteMany();
  await prisma.sourcingRequestItem.deleteMany();
  await prisma.sourcingRequest.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.supplierUser.deleteMany();
  await prisma.supplierBusiness.deleteMany();
  await prisma.customerAddress.deleteMany();
  await prisma.customerProfile.deleteMany();
  await prisma.user.deleteMany();
}

async function fixture(availableCredit = "100.00") {
  const [admin, supplier] = await Promise.all([
    prisma.user.create({
      data: {
        email: `credit-admin-${randomUUID()}@test.local`,
        role: UserRole.SUPER_ADMIN,
        accountStatus: AccountStatus.ACTIVE,
        passwordHash: "not-used-by-service-tests",
      },
    }),
    prisma.user.create({
      data: {
        email: `credit-supplier-${randomUUID()}@test.local`,
        role: UserRole.SUPPLIER_OWNER,
        accountStatus: AccountStatus.ACTIVE,
        passwordHash: "not-used-by-service-tests",
      },
    }),
  ]);
  const customerUser = await prisma.user.create({
    data: {
      email: `credit-customer-${randomUUID()}@test.local`,
      role: UserRole.CUSTOMER,
      accountStatus: AccountStatus.ACTIVE,
      passwordHash: "not-used-by-service-tests",
      customerProfile: { create: { fullName: "Credit Customer" } },
    },
    include: { customerProfile: true },
  });
  const business = await prisma.supplierBusiness.create({
    data: {
      legalName: "Credit Supplier Ltd",
      displayName: "Credit Supplier",
      status: SupplierBusinessStatus.ACTIVE,
      members: { create: { userId: supplier.id, isPrimary: true } },
      wallet: { create: { availableCredit } },
    },
    include: { wallet: true },
  });
  const policy = await prisma.commissionPolicy.create({
    data: {
      rateBps: 1000,
      effectiveFrom: now(),
      createdByUserId: admin.id,
      reason: "Integration test policy",
    },
  });
  return { admin, supplier, customerUser, business, policy };
}

async function commercialOrder(
  f: Awaited<ReturnType<typeof fixture>>,
  lineTotal: string,
) {
  const request = await prisma.sourcingRequest.create({
    data: {
      requestNumber: `RFQ-CREDIT-${randomUUID()}`,
      customerId: f.customerUser.customerProfile!.id,
      requestType: SourcingRequestType.FIXED_PRICE_PURCHASE,
      targetBusinessId: f.business.id,
      status: "SUBMITTED",
      creditStatus: CreditRequirementStatus.ELIGIBLE,
    },
  });
  const order = await prisma.order.create({
    data: {
      orderNumber: `ORD-CREDIT-${randomUUID()}`,
      customerId: f.customerUser.customerProfile!.id,
      businessId: f.business.id,
      requestId: request.id,
      status: OrderStatus.PENDING_SUPPLIER_CONFIRMATION,
      supplierSubtotal: lineTotal,
      supplierPayable: lineTotal,
      customerTotal: lineTotal,
      items: {
        create: {
          lineNumber: 1,
          description: "Eligible part",
          quantity: 1,
          supplierUnitPrice: lineTotal,
          supplierLineTotal: lineTotal,
          customerUnitPrice: lineTotal,
          customerLineTotal: lineTotal,
        },
      },
    },
  });
  return { request, order };
}

beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("prepaid commission accounting", () => {
  it("serializes concurrent reservations so a wallet cannot overspend", async () => {
    const f = await fixture("100.00");
    const [first, second] = await Promise.all([
      commercialOrder(f, "600.00"),
      commercialOrder(f, "600.00"),
    ]);
    const results = await Promise.allSettled([
      credits.reserveOrder(first.order.id, f.supplier.id, "reserve-first"),
      credits.reserveOrder(second.order.id, f.supplier.id, "reserve-second"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const wallet = await prisma.supplierWallet.findUniqueOrThrow({
      where: { businessId: f.business.id },
    });
    expect(wallet.availableCredit.toFixed(2)).toBe("40.00");
    expect(wallet.reservedCredit.toFixed(2)).toBe("60.00");
    expect(
      await prisma.commissionReservation.count({
        where: { businessId: f.business.id },
      }),
    ).toBe(1);
    expect(
      await prisma.sourcingRequest.count({
        where: {
          id: { in: [first.request.id, second.request.id] },
          creditStatus: CreditRequirementStatus.AWAITING_CREDITS,
        },
      }),
    ).toBe(1);
  });

  it("settles and releases exactly once while preserving immutable entries", async () => {
    const f = await fixture("200.00");
    const settled = await commercialOrder(f, "500.00");
    const released = await commercialOrder(f, "400.00");
    await credits.reserveOrder(settled.order.id, f.supplier.id, "reserve-settle");
    await credits.reserveOrder(released.order.id, f.supplier.id, "reserve-release");
    await Promise.all([
      credits.settleOrder(
        settled.order.id,
        f.admin.id,
        "settle-one",
        "verified-delivery-123",
      ),
      credits.settleOrder(
        settled.order.id,
        f.admin.id,
        "settle-two",
        "verified-delivery-123",
      ),
    ]);
    await Promise.all([
      credits.releaseOrder(
        released.order.id,
        f.admin.id,
        "release-one",
        "Customer cancellation",
      ),
      credits.releaseOrder(
        released.order.id,
        f.admin.id,
        "release-two",
        "Customer cancellation",
      ),
    ]);
    expect(
      await prisma.walletLedgerEntry.count({
        where: { orderId: settled.order.id, type: "COMMISSION_SETTLEMENT" },
      }),
    ).toBe(1);
    expect(
      await prisma.walletLedgerEntry.count({
        where: { orderId: released.order.id, type: "RESERVATION_RELEASE" },
      }),
    ).toBe(1);
    const wallet = await prisma.supplierWallet.findUniqueOrThrow({
      where: { businessId: f.business.id },
    });
    expect(wallet.availableCredit.toFixed(2)).toBe("150.00");
    expect(wallet.reservedCredit.toFixed(2)).toBe("0.00");
  });

  it("credits a verified top-up once for duplicate submissions and decisions", async () => {
    const f = await fixture("0.00");
    const input = {
      amount: "75.25",
      paymentMethod: "bank",
      externalReference: "BANK-CREDIT-001",
      evidenceReference: "evidence://credit-001",
      idempotencyKey: "top-up-credit-001",
    };
    const first = await credits.submitTopUp(
      f.business.id,
      f.supplier.id,
      input,
      "top-up-submit-one",
    );
    const duplicate = await credits.submitTopUp(
      f.business.id,
      f.supplier.id,
      input,
      "top-up-submit-two",
    );
    expect(duplicate.id).toBe(first.id);
    const decision = {
      decision: "APPROVE" as const,
      reason: "Bank evidence verified",
      idempotencyKey: "top-up-decision-001",
    };
    await credits.decideTopUp(first.id, decision, f.admin.id, "decision-one");
    await credits.decideTopUp(first.id, decision, f.admin.id, "decision-two");
    const wallet = await prisma.supplierWallet.findUniqueOrThrow({
      where: { businessId: f.business.id },
    });
    expect(wallet.availableCredit.toFixed(2)).toBe("75.25");
    expect(
      await prisma.walletLedgerEntry.count({
        where: { topUpId: first.id, type: "TOP_UP" },
      }),
    ).toBe(1);
  });

  it("reports wallet, ledger, and reservation drift without mutating balances", async () => {
    const f = await fixture("100.00");
    const order = await commercialOrder(f, "600.00");
    await credits.reserveOrder(order.order.id, f.supplier.id, "reconcile-reserve");
    const healthy = await credits.reconcileWallets({ page: 1, pageSize: 20 });
    expect(healthy).toMatchObject({
      readOnly: true,
      checked: 1,
      discrepancyCount: 0,
      discrepancies: [],
    });

    await prisma.supplierWallet.update({
      where: { businessId: f.business.id },
      data: { reservedCredit: "55.00" },
    });
    const before = await prisma.supplierWallet.findUniqueOrThrow({
      where: { businessId: f.business.id },
    });
    const drift = await credits.reconcileWallets({ page: 1, pageSize: 20 });
    const after = await prisma.supplierWallet.findUniqueOrThrow({
      where: { businessId: f.business.id },
    });

    expect(drift.discrepancies).toEqual([
      expect.objectContaining({
        walletId: before.id,
        issues: ["RESERVATION_BALANCE_MISMATCH", "LEDGER_BALANCE_MISMATCH"],
        actual: { availableCredit: "40.00", reservedCredit: "55.00" },
        expectedReservedCredit: "60.00",
      }),
    ]);
    expect(after.availableCredit.equals(before.availableCredit)).toBe(true);
    expect(after.reservedCredit.equals(before.reservedCredit)).toBe(true);
    expect(after.version).toBe(before.version);
  });

  it("serializes settlement against cancellation release", async () => {
    const f = await fixture("100.00");
    const value = await commercialOrder(f, "500.00");
    await credits.reserveOrder(value.order.id, f.supplier.id, "race-reserve");

    const results = await Promise.allSettled([
      credits.settleOrder(value.order.id, f.admin.id, "race-settle"),
      credits.releaseOrder(
        value.order.id,
        f.admin.id,
        "race-release",
        "Cancellation approved",
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const reservation = await prisma.commissionReservation.findUniqueOrThrow({
      where: { orderId: value.order.id },
    });
    expect(["SETTLED", "RELEASED"]).toContain(reservation.status);
    expect(
      await prisma.walletLedgerEntry.count({
        where: {
          orderId: value.order.id,
          type: { in: ["COMMISSION_SETTLEMENT", "RESERVATION_RELEASE"] },
        },
      }),
    ).toBe(1);
    expect(
      (await credits.reconcileWallets({ page: 1, pageSize: 20 })).discrepancies,
    ).toEqual([]);
  });

  it("makes repeated commission reversal and concurrent adjustments idempotent", async () => {
    const f = await fixture("100.00");
    const value = await commercialOrder(f, "500.00");
    await credits.reserveOrder(value.order.id, f.supplier.id, "reverse-reserve");
    await credits.settleOrder(value.order.id, f.admin.id, "reverse-settle");

    const reversals = await Promise.all([
      credits.reverseSettlement(
        value.order.id,
        f.admin.id,
        "reverse-one",
        "Approved refund",
      ),
      credits.reverseSettlement(
        value.order.id,
        f.admin.id,
        "reverse-two",
        "Approved refund",
      ),
    ]);
    expect(reversals.every((reservation) => reservation.status === "REVERSED")).toBe(
      true,
    );
    expect(
      await prisma.walletLedgerEntry.count({
        where: { orderId: value.order.id, type: "REVERSAL" },
      }),
    ).toBe(1);

    await Promise.all([
      credits.adjust(
        f.business.id,
        { amount: "25.00", reason: "Verified correction", idempotencyKey: "adjust-plus" },
        f.admin.id,
        "adjust-plus-request",
      ),
      credits.adjust(
        f.business.id,
        {
          amount: "-30.00",
          reason: "Verified correction",
          idempotencyKey: "adjust-minus",
        },
        f.admin.id,
        "adjust-minus-request",
      ),
    ]);
    const wallet = await prisma.supplierWallet.findUniqueOrThrow({
      where: { businessId: f.business.id },
    });
    expect(wallet.availableCredit.toFixed(2)).toBe("95.00");
    expect(
      await prisma.walletLedgerEntry.count({
        where: { businessId: f.business.id, type: "ADJUSTMENT" },
      }),
    ).toBe(2);
    expect(
      (await credits.reconcileWallets({ page: 1, pageSize: 20 })).discrepancies,
    ).toEqual([]);
  });

  it("rejects a pending reservation after the supplier is suspended", async () => {
    const f = await fixture("100.00");
    const value = await commercialOrder(f, "500.00");
    await prisma.supplierBusiness.update({
      where: { id: f.business.id },
      data: { status: SupplierBusinessStatus.SUSPENDED },
    });

    await expect(
      credits.reserveOrder(value.order.id, f.supplier.id, "suspended-reserve"),
    ).rejects.toMatchObject({ code: "SUPPLIER_NOT_ACTIVE", statusCode: 409 });
    expect(
      await prisma.commissionReservation.count({ where: { orderId: value.order.id } }),
    ).toBe(0);
    const wallet = await prisma.supplierWallet.findUniqueOrThrow({
      where: { businessId: f.business.id },
    });
    expect(wallet.availableCredit.toFixed(2)).toBe("100.00");
    expect(wallet.reservedCredit.toFixed(2)).toBe("0.00");
  });
});
