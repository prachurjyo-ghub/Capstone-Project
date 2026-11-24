import {
  CommissionReservationStatus,
  Prisma,
  SupplierBusinessStatus,
  SupplierWalletStatus,
  WalletEntryType,
  WalletTopUpStatus,
  type PrismaClient,
} from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";
import { recordAudit } from "../auth/audit.service.js";
import { enqueueOutbox } from "../communications/outbox.service.js";
import type {
  AdjustmentInput,
  PolicyInput,
  TopUpDecision,
  TopUpInput,
} from "./credit.schemas.js";

type Tx = Prisma.TransactionClient;
const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const page = (pageNumber: number, pageSize: number) => ({
  skip: (pageNumber - 1) * pageSize,
  take: pageSize,
});
const fail = (code: string, message: string, statusCode = 400) =>
  new AppError(message, { code, statusCode });

export class CreditService {
  constructor(
    private readonly database: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async lock(tx: Tx, scope: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))`;
  }

  private async wallet(tx: Tx, businessId: string) {
    await this.lock(tx, `supplier-wallet:${businessId}`);
    return tx.supplierWallet.upsert({
      where: { businessId },
      update: {},
      create: { businessId },
    });
  }

  private async activePolicy(tx: Tx) {
    const policy = await tx.commissionPolicy.findFirst({
      where: { isActive: true, effectiveFrom: { lte: this.now() } },
      orderBy: { effectiveFrom: "desc" },
    });
    if (!policy)
      throw fail(
        "COMMISSION_POLICY_REQUIRED",
        "Configure the global commission rate before confirming supplier sales",
        409,
      );
    return policy;
  }

  calculateCommission(amount: Prisma.Decimal.Value, rateBps: number) {
    return decimal(amount)
      .mul(rateBps)
      .div(10_000)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  async listingEligibility(
    businessId: string,
    unitPrice: Prisma.Decimal.Value,
    quantity = 1,
  ) {
    const [policy, wallet] = await Promise.all([
      this.database.commissionPolicy.findFirst({
        where: { isActive: true, effectiveFrom: { lte: this.now() } },
        orderBy: { effectiveFrom: "desc" },
      }),
      this.database.supplierWallet.findUnique({ where: { businessId } }),
    ]);
    if (!policy) {
      return {
        eligible: false,
        reason: "COMMISSION_POLICY_REQUIRED" as const,
        requiredCredit: null,
      };
    }
    const requiredCredit = this.calculateCommission(
      decimal(unitPrice).mul(quantity),
      policy.rateBps,
    );
    const active = wallet?.status === SupplierWalletStatus.ACTIVE;
    const sufficient =
      active && wallet.availableCredit.greaterThanOrEqualTo(requiredCredit);
    return {
      eligible: sufficient,
      reason: !active
        ? ("WALLET_NOT_ACTIVE" as const)
        : !sufficient
          ? ("INSUFFICIENT_CREDITS" as const)
          : null,
      requiredCredit,
    };
  }

  async getPolicy() {
    const [current, history] = await Promise.all([
      this.database.commissionPolicy.findFirst({
        where: { isActive: true },
        include: { createdBy: { select: { id: true, fullName: true, email: true } } },
        orderBy: { effectiveFrom: "desc" },
      }),
      this.database.commissionPolicy.findMany({
        include: { createdBy: { select: { id: true, fullName: true, email: true } } },
        orderBy: { effectiveFrom: "desc" },
        take: 50,
      }),
    ]);
    return { current, history };
  }

  async setPolicy(input: PolicyInput, actorUserId: string, requestId: string) {
    const rateBps = decimal(input.ratePercent.toString())
      .mul(100)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
      .toNumber();
    return this.database.$transaction(async (tx) => {
      await this.lock(tx, "global-commission-policy");
      const now = this.now();
      await tx.commissionPolicy.updateMany({
        where: { isActive: true },
        data: { isActive: false, endedAt: now },
      });
      const policy = await tx.commissionPolicy.create({
        data: {
          rateBps,
          reason: input.reason,
          effectiveFrom: now,
          createdByUserId: actorUserId,
        },
      });
      await recordAudit(tx, {
        actorUserId,
        action: "COMMISSION_POLICY_CHANGED",
        entityType: "COMMISSION_POLICY",
        entityId: policy.id,
        requestId,
        metadata: { rateBps },
      });
      return policy;
    });
  }

  async supplierWallet(businessId: string) {
    return this.database.$transaction(async (tx) => {
      const wallet = await this.wallet(tx, businessId);
      const [business, topUps, entries, reservations, commissionPolicy] =
        await Promise.all([
          tx.supplierBusiness.findUnique({
            where: { id: businessId },
            select: {
              id: true,
              businessCode: true,
              displayName: true,
              legalName: true,
              status: true,
            },
          }),
          tx.walletTopUp.findMany({
            where: { businessId },
            orderBy: { requestedAt: "desc" },
            take: 50,
          }),
          tx.walletLedgerEntry.findMany({
            where: { businessId },
            orderBy: { createdAt: "desc" },
            take: 100,
          }),
          tx.commissionReservation.findMany({
            where: { businessId },
            include: { order: { select: { id: true, orderNumber: true, status: true } } },
            orderBy: { createdAt: "desc" },
            take: 50,
          }),
          tx.commissionPolicy.findFirst({
            where: { isActive: true, effectiveFrom: { lte: this.now() } },
            orderBy: { effectiveFrom: "desc" },
            select: { id: true, rateBps: true, effectiveFrom: true },
          }),
        ]);
      return {
        ...wallet,
        business,
        totalPrepaidBalance: wallet.availableCredit.plus(wallet.reservedCredit),
        topUps,
        entries,
        reservations,
        commissionPolicy: commissionPolicy
          ? {
              ...commissionPolicy,
              ratePercent: commissionPolicy.rateBps / 100,
            }
          : null,
      };
    });
  }

  async submitTopUp(
    businessId: string,
    actorUserId: string,
    input: TopUpInput,
    requestId: string,
  ) {
    const normalizedReference = input.externalReference.trim().toUpperCase();
    const existing = await this.database.walletTopUp.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (existing.businessId !== businessId)
        throw fail(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key belongs to another supplier",
          409,
        );
      return existing;
    }
    const samePayment = await this.database.walletTopUp.findUnique({
      where: {
        businessId_externalReference: {
          businessId,
          externalReference: normalizedReference,
        },
      },
    });
    if (samePayment) {
      if (!samePayment.amount.equals(decimal(input.amount))) {
        throw fail(
          "PAYMENT_REFERENCE_CONFLICT",
          "This payment reference was already submitted with a different amount",
          409,
        );
      }
      return samePayment;
    }
    return this.database.$transaction(async (tx) => {
      const wallet = await this.wallet(tx, businessId);
      const duplicatePayment = await tx.walletTopUp.findUnique({
        where: {
          businessId_externalReference: {
            businessId,
            externalReference: normalizedReference,
          },
        },
      });
      if (duplicatePayment) {
        if (!duplicatePayment.amount.equals(decimal(input.amount))) {
          throw fail(
            "PAYMENT_REFERENCE_CONFLICT",
            "This payment reference was already submitted with a different amount",
            409,
          );
        }
        return duplicatePayment;
      }
      const topUp = await tx.walletTopUp.create({
        data: {
          walletId: wallet.id,
          businessId,
          amount: decimal(input.amount),
          paymentMethod: input.paymentMethod,
          externalReference: normalizedReference,
          evidenceReference: input.evidenceReference,
          supplierNote: input.supplierNote,
          requestedByUserId: actorUserId,
          idempotencyKey: input.idempotencyKey,
        },
      });
      await recordAudit(tx, {
        actorUserId,
        action: "WALLET_TOP_UP_SUBMITTED",
        entityType: "WALLET_TOP_UP",
        entityId: topUp.id,
        requestId,
        metadata: { businessId, amount: topUp.amount.toFixed(2) },
      });
      await enqueueOutbox(tx, {
        eventType: "WALLET_TOP_UP_SUBMITTED",
        aggregateType: "WALLET_TOP_UP",
        aggregateId: topUp.id,
        eventKey: `wallet-top-up:${topUp.id}:submitted`,
        payload: { businessId, topUpId: topUp.id },
      });
      return topUp;
    });
  }

  async decideTopUp(
    topUpId: string,
    input: TopUpDecision,
    actorUserId: string,
    requestId: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await this.lock(tx, `wallet-top-up:${topUpId}`);
      const topUp = await tx.walletTopUp.findUnique({ where: { id: topUpId } });
      if (!topUp) throw fail("TOP_UP_NOT_FOUND", "Wallet top-up was not found", 404);
      if (topUp.status !== WalletTopUpStatus.PENDING) return topUp;
      const wallet = await this.wallet(tx, topUp.businessId);
      const approved = input.decision === "APPROVE";
      let updatedWallet = wallet;
      if (approved) {
        updatedWallet = await tx.supplierWallet.update({
          where: { id: wallet.id },
          data: {
            availableCredit: { increment: topUp.amount },
            version: { increment: 1 },
          },
        });
        await tx.walletLedgerEntry.create({
          data: {
            walletId: wallet.id,
            businessId: topUp.businessId,
            type: WalletEntryType.TOP_UP,
            availableDelta: topUp.amount,
            availableBalance: updatedWallet.availableCredit,
            reservedBalance: updatedWallet.reservedCredit,
            topUpId: topUp.id,
            actorUserId,
            idempotencyKey: input.idempotencyKey,
            reason: input.reason,
          },
        });
      }
      const decided = await tx.walletTopUp.update({
        where: { id: topUp.id },
        data: {
          status: approved ? WalletTopUpStatus.APPROVED : WalletTopUpStatus.REJECTED,
          decisionReason: input.reason,
          reviewedByUserId: actorUserId,
          reviewedAt: this.now(),
        },
      });
      await recordAudit(tx, {
        actorUserId,
        action: approved ? "WALLET_TOP_UP_APPROVED" : "WALLET_TOP_UP_REJECTED",
        entityType: "WALLET_TOP_UP",
        entityId: topUp.id,
        requestId,
        metadata: { businessId: topUp.businessId, amount: topUp.amount.toFixed(2) },
      });
      await enqueueOutbox(tx, {
        eventType: approved ? "WALLET_TOP_UP_APPROVED" : "WALLET_TOP_UP_REJECTED",
        aggregateType: "WALLET_TOP_UP",
        aggregateId: topUp.id,
        eventKey: `wallet-top-up:${topUp.id}:${approved ? "approved" : "rejected"}`,
        payload: { businessId: topUp.businessId, topUpId: topUp.id },
      });
      return { ...decided, wallet: updatedWallet };
    });
  }

  async adjust(
    businessId: string,
    input: AdjustmentInput,
    actorUserId: string,
    requestId: string,
  ) {
    const existing = await this.database.walletLedgerEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return existing;
    return this.database.$transaction(async (tx) => {
      const wallet = await this.wallet(tx, businessId);
      const delta = decimal(input.amount);
      const next = wallet.availableCredit.plus(delta);
      if (next.isNegative())
        throw fail(
          "INSUFFICIENT_CREDITS",
          "Adjustment would make available credits negative",
          409,
        );
      const updated = await tx.supplierWallet.update({
        where: { id: wallet.id },
        data: { availableCredit: next, version: { increment: 1 } },
      });
      const entry = await tx.walletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          businessId,
          type: WalletEntryType.ADJUSTMENT,
          availableDelta: delta,
          availableBalance: updated.availableCredit,
          reservedBalance: updated.reservedCredit,
          actorUserId,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
        },
      });
      await recordAudit(tx, {
        actorUserId,
        action: "WALLET_ADJUSTED",
        entityType: "SUPPLIER_WALLET",
        entityId: wallet.id,
        requestId,
        metadata: { businessId, delta: delta.toFixed(2) },
      });
      return entry;
    });
  }

  async reserveOrderInTransaction(
    tx: Tx,
    orderId: string,
    actorUserId: string,
    requestId: string,
  ) {
    await this.lock(tx, `commission-order:${orderId}`);
    const duplicate = await tx.commissionReservation.findUnique({ where: { orderId } });
    if (duplicate) return { reservation: duplicate, shortage: false as const };
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        business: { select: { status: true } },
        items: { select: { customerLineTotal: true } },
      },
    });
    if (!order) throw fail("ORDER_NOT_FOUND", "Order was not found", 404);
    if (order.business.status !== SupplierBusinessStatus.ACTIVE)
      throw fail(
        "SUPPLIER_NOT_ACTIVE",
        "Commission cannot be reserved for an inactive supplier",
        409,
      );
    const wallet = await this.wallet(tx, order.businessId);
    if (wallet.status !== SupplierWalletStatus.ACTIVE)
      throw fail("WALLET_NOT_ACTIVE", "Supplier wallet is not active", 409);
    const policy = await this.activePolicy(tx);
    const eligibleAmount = order.items.reduce(
      (sum, item) => sum.plus(item.customerLineTotal),
      decimal(0),
    );
    const commissionAmount = this.calculateCommission(eligibleAmount, policy.rateBps);
    if (wallet.availableCredit.lessThan(commissionAmount)) {
      if (order.requestId)
        await tx.sourcingRequest.update({
          where: { id: order.requestId },
          data: { creditStatus: "AWAITING_CREDITS" },
        });
      await enqueueOutbox(tx, {
        eventType: "REQUEST_AWAITING_CREDITS",
        aggregateType: "ORDER",
        aggregateId: orderId,
        eventKey: `order:${orderId}:awaiting-credits:${wallet.version}`,
        payload: {
          businessId: order.businessId,
          orderId,
          requiredCredit: commissionAmount.toFixed(2),
        },
      });
      return {
        reservation: null,
        shortage: true as const,
        requiredCredit: commissionAmount,
        availableCredit: wallet.availableCredit,
      };
    }
    const updatedWallet = await tx.supplierWallet.update({
      where: { id: wallet.id },
      data: {
        availableCredit: { decrement: commissionAmount },
        reservedCredit: { increment: commissionAmount },
        version: { increment: 1 },
      },
    });
    const reservation = await tx.commissionReservation.create({
      data: {
        walletId: wallet.id,
        businessId: order.businessId,
        orderId,
        policyId: policy.id,
        eligibleAmount,
        commissionRateBps: policy.rateBps,
        commissionAmount,
        idempotencyKey: `commission-reservation:${orderId}`,
      },
    });
    await tx.walletLedgerEntry.create({
      data: {
        walletId: wallet.id,
        businessId: order.businessId,
        type: WalletEntryType.CREDIT_RESERVATION,
        availableDelta: commissionAmount.negated(),
        reservedDelta: commissionAmount,
        availableBalance: updatedWallet.availableCredit,
        reservedBalance: updatedWallet.reservedCredit,
        reservationId: reservation.id,
        orderId,
        actorUserId,
        idempotencyKey: `commission-reservation:${orderId}:ledger`,
        reason: "Commission reserved for confirmed order",
        metadata: { eligibleAmount: eligibleAmount.toFixed(2), rateBps: policy.rateBps },
      },
    });
    if (order.requestId)
      await tx.sourcingRequest.update({
        where: { id: order.requestId },
        data: { creditStatus: "RESERVED" },
      });
    await recordAudit(tx, {
      actorUserId,
      action: "COMMISSION_RESERVED",
      entityType: "COMMISSION_RESERVATION",
      entityId: reservation.id,
      requestId,
      metadata: {
        orderId,
        businessId: order.businessId,
        amount: commissionAmount.toFixed(2),
        rateBps: policy.rateBps,
      },
    });
    await enqueueOutbox(tx, {
      eventType: "COMMISSION_RESERVED",
      aggregateType: "ORDER",
      aggregateId: orderId,
      eventKey: `order:${orderId}:commission-reserved`,
      payload: { businessId: order.businessId, reservationId: reservation.id },
    });
    return { reservation, shortage: false as const };
  }

  async reserveOrder(orderId: string, actorUserId: string, requestId: string) {
    const result = await this.database.$transaction((tx) =>
      this.reserveOrderInTransaction(tx, orderId, actorUserId, requestId),
    );
    if (result.shortage) {
      throw fail(
        "INSUFFICIENT_COMMISSION_CREDITS",
        `Supplier needs BDT ${result.requiredCredit.toFixed(2)} available credits`,
        409,
      );
    }
    return result.reservation;
  }

  async settleOrderInTransaction(
    tx: Tx,
    orderId: string,
    actorUserId: string,
    requestId: string,
    reference?: string,
  ) {
    return this.changeReservationInTransaction(
      tx,
      orderId,
      "SETTLE",
      actorUserId,
      requestId,
      reference ?? `order-completion:${orderId}`,
    );
  }

  async releaseOrderInTransaction(
    tx: Tx,
    orderId: string,
    actorUserId: string,
    requestId: string,
    reason: string,
  ) {
    return this.changeReservationInTransaction(
      tx,
      orderId,
      "RELEASE",
      actorUserId,
      requestId,
      reason,
    );
  }

  async settleOrder(
    orderId: string,
    actorUserId: string,
    requestId: string,
    reference?: string,
  ) {
    return this.database.$transaction((tx) =>
      this.settleOrderInTransaction(tx, orderId, actorUserId, requestId, reference),
    );
  }

  async releaseOrder(
    orderId: string,
    actorUserId: string,
    requestId: string,
    reason: string,
  ) {
    return this.database.$transaction((tx) =>
      this.releaseOrderInTransaction(tx, orderId, actorUserId, requestId, reason),
    );
  }

  async reverseSettlement(
    orderId: string,
    actorUserId: string,
    requestId: string,
    reason: string,
  ) {
    return this.database.$transaction((tx) =>
      this.changeReservationInTransaction(
        tx,
        orderId,
        "REVERSE",
        actorUserId,
        requestId,
        reason,
      ),
    );
  }

  private async changeReservationInTransaction(
    tx: Tx,
    orderId: string,
    action: "SETTLE" | "RELEASE" | "REVERSE",
    actorUserId: string,
    requestId: string,
    reason: string,
  ) {
    await this.lock(tx, `commission-order:${orderId}`);
    const reservation = await tx.commissionReservation.findUnique({ where: { orderId } });
    if (!reservation)
      throw fail(
        "COMMISSION_RESERVATION_NOT_FOUND",
        "Order has no commission reservation",
        404,
      );
    const wallet = await this.wallet(tx, reservation.businessId);
    const amount = reservation.commissionAmount;
    if (action === "SETTLE") {
      if (reservation.status === CommissionReservationStatus.SETTLED) return reservation;
      if (reservation.status !== CommissionReservationStatus.RESERVED)
        throw fail(
          "INVALID_COMMISSION_STATE",
          "Only reserved commission can be settled",
          409,
        );
      const updatedWallet = await tx.supplierWallet.update({
        where: { id: wallet.id },
        data: { reservedCredit: { decrement: amount }, version: { increment: 1 } },
      });
      const updated = await tx.commissionReservation.update({
        where: { id: reservation.id },
        data: {
          status: CommissionReservationStatus.SETTLED,
          settledAt: this.now(),
          settlementReference: reason,
        },
      });
      await tx.walletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          businessId: reservation.businessId,
          type: WalletEntryType.COMMISSION_SETTLEMENT,
          reservedDelta: amount.negated(),
          availableBalance: updatedWallet.availableCredit,
          reservedBalance: updatedWallet.reservedCredit,
          reservationId: reservation.id,
          orderId,
          actorUserId,
          idempotencyKey: `commission-settlement:${orderId}`,
          reason,
        },
      });
      await recordAudit(tx, {
        actorUserId,
        action: "COMMISSION_SETTLED",
        entityType: "COMMISSION_RESERVATION",
        entityId: reservation.id,
        requestId,
        metadata: { orderId, amount: amount.toFixed(2) },
      });
      await enqueueOutbox(tx, {
        eventType: "COMMISSION_SETTLED",
        aggregateType: "ORDER",
        aggregateId: orderId,
        eventKey: `order:${orderId}:commission-settled`,
        payload: { businessId: reservation.businessId, reservationId: reservation.id },
      });
      return updated;
    }
    if (action === "RELEASE") {
      if (reservation.status === CommissionReservationStatus.RELEASED) return reservation;
      if (reservation.status !== CommissionReservationStatus.RESERVED)
        throw fail(
          "INVALID_COMMISSION_STATE",
          "Only reserved commission can be released",
          409,
        );
      const updatedWallet = await tx.supplierWallet.update({
        where: { id: wallet.id },
        data: {
          availableCredit: { increment: amount },
          reservedCredit: { decrement: amount },
          version: { increment: 1 },
        },
      });
      const updated = await tx.commissionReservation.update({
        where: { id: reservation.id },
        data: {
          status: CommissionReservationStatus.RELEASED,
          releasedAt: this.now(),
          releaseReason: reason,
        },
      });
      await tx.walletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          businessId: reservation.businessId,
          type: WalletEntryType.RESERVATION_RELEASE,
          availableDelta: amount,
          reservedDelta: amount.negated(),
          availableBalance: updatedWallet.availableCredit,
          reservedBalance: updatedWallet.reservedCredit,
          reservationId: reservation.id,
          orderId,
          actorUserId,
          idempotencyKey: `commission-release:${orderId}`,
          reason,
        },
      });
      await recordAudit(tx, {
        actorUserId,
        action: "COMMISSION_RESERVATION_RELEASED",
        entityType: "COMMISSION_RESERVATION",
        entityId: reservation.id,
        requestId,
        metadata: { orderId, amount: amount.toFixed(2) },
      });
      await enqueueOutbox(tx, {
        eventType: "COMMISSION_RESERVATION_RELEASED",
        aggregateType: "ORDER",
        aggregateId: orderId,
        eventKey: `order:${orderId}:commission-released`,
        payload: { businessId: reservation.businessId, reservationId: reservation.id },
      });
      return updated;
    }
    if (reservation.status === CommissionReservationStatus.REVERSED) return reservation;
    if (reservation.status !== CommissionReservationStatus.SETTLED)
      throw fail(
        "INVALID_COMMISSION_STATE",
        "Only settled commission can be reversed",
        409,
      );
    const updatedWallet = await tx.supplierWallet.update({
      where: { id: wallet.id },
      data: { availableCredit: { increment: amount }, version: { increment: 1 } },
    });
    const updated = await tx.commissionReservation.update({
      where: { id: reservation.id },
      data: {
        status: CommissionReservationStatus.REVERSED,
        reversedAt: this.now(),
        releaseReason: reason,
      },
    });
    await tx.walletLedgerEntry.create({
      data: {
        walletId: wallet.id,
        businessId: reservation.businessId,
        type: WalletEntryType.REVERSAL,
        availableDelta: amount,
        availableBalance: updatedWallet.availableCredit,
        reservedBalance: updatedWallet.reservedCredit,
        reservationId: reservation.id,
        orderId,
        actorUserId,
        idempotencyKey: `commission-reversal:${orderId}`,
        reason,
      },
    });
    await recordAudit(tx, {
      actorUserId,
      action: "COMMISSION_SETTLEMENT_REVERSED",
      entityType: "COMMISSION_RESERVATION",
      entityId: reservation.id,
      requestId,
      metadata: { orderId, amount: amount.toFixed(2) },
    });
    return updated;
  }

  async listWallets(input: {
    page: number;
    pageSize: number;
    status?: SupplierWalletStatus;
    search?: string;
  }) {
    const where: Prisma.SupplierBusinessWhereInput = {
      ...(input.search
        ? {
            OR: [
              { displayName: { contains: input.search, mode: "insensitive" } },
              { legalName: { contains: input.search, mode: "insensitive" } },
              { businessCode: { contains: input.search, mode: "insensitive" } },
            ],
          }
        : {}),
      wallet: input.status ? { status: input.status } : undefined,
    };
    const [businesses, total] = await this.database.$transaction([
      this.database.supplierBusiness.findMany({
        where,
        select: {
          id: true,
          businessCode: true,
          displayName: true,
          status: true,
          wallet: true,
        },
        orderBy: { displayName: "asc" },
        ...page(input.page, input.pageSize),
      }),
      this.database.supplierBusiness.count({ where }),
    ]);
    return {
      items: businesses.map((business) => ({
        ...business,
        wallet: business.wallet ?? {
          status: "ACTIVE",
          availableCredit: decimal(0),
          reservedCredit: decimal(0),
        },
      })),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async listTopUps(input: {
    page: number;
    pageSize: number;
    status?: WalletTopUpStatus;
    businessId?: string;
  }) {
    const where = { status: input.status, businessId: input.businessId };
    const [items, total] = await this.database.$transaction([
      this.database.walletTopUp.findMany({
        where,
        include: {
          business: { select: { id: true, businessCode: true, displayName: true } },
          requestedBy: { select: { fullName: true, email: true } },
          reviewedBy: { select: { fullName: true, email: true } },
        },
        orderBy: { requestedAt: "desc" },
        ...page(input.page, input.pageSize),
      }),
      this.database.walletTopUp.count({ where }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }

  async listReservations(input: {
    page: number;
    pageSize: number;
    status?: CommissionReservationStatus;
    businessId?: string;
  }) {
    const where = { status: input.status, businessId: input.businessId };
    const [items, total] = await this.database.$transaction([
      this.database.commissionReservation.findMany({
        where,
        include: {
          business: { select: { id: true, businessCode: true, displayName: true } },
          order: { select: { id: true, orderNumber: true, status: true } },
          policy: true,
        },
        orderBy: { createdAt: "desc" },
        ...page(input.page, input.pageSize),
      }),
      this.database.commissionReservation.count({ where }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }

  async overview() {
    const [wallets, pendingTopUps, reservations, settled] = await Promise.all([
      this.database.supplierWallet.aggregate({
        _sum: { availableCredit: true, reservedCredit: true },
        _count: true,
      }),
      this.database.walletTopUp.aggregate({
        where: { status: WalletTopUpStatus.PENDING },
        _sum: { amount: true },
        _count: true,
      }),
      this.database.commissionReservation.aggregate({
        where: { status: CommissionReservationStatus.RESERVED },
        _sum: { commissionAmount: true },
        _count: true,
      }),
      this.database.commissionReservation.aggregate({
        where: { status: CommissionReservationStatus.SETTLED },
        _sum: { commissionAmount: true },
        _count: true,
      }),
    ]);
    return { wallets, pendingTopUps, reservations, settledCommission: settled };
  }

  async reconcileWallets(input: { page: number; pageSize: number }) {
    const [wallets, totalWallets] = await this.database.$transaction([
      this.database.supplierWallet.findMany({
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        ...page(input.page, input.pageSize),
        include: {
          business: { select: { id: true, businessCode: true, displayName: true } },
          entries: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: {
              id: true,
              availableBalance: true,
              reservedBalance: true,
              createdAt: true,
            },
          },
          reservations: {
            select: { status: true, commissionAmount: true },
          },
        },
      }),
      this.database.supplierWallet.count(),
    ]);
    const walletIds = wallets.map((wallet) => wallet.id);
    const [ledgerTotals, reservationTotals] = walletIds.length
      ? await Promise.all([
          this.database.walletLedgerEntry.groupBy({
            by: ["walletId"],
            where: { walletId: { in: walletIds } },
            _count: true,
            _sum: { availableDelta: true, reservedDelta: true },
          }),
          this.database.commissionReservation.groupBy({
            by: ["walletId", "status"],
            where: { walletId: { in: walletIds } },
            _count: true,
            _sum: { commissionAmount: true },
          }),
        ])
      : [[], []];
    const summaries = wallets.map((wallet) => {
      const expectedReserved = wallet.reservations.reduce(
        (sum, reservation) =>
          reservation.status === CommissionReservationStatus.RESERVED
            ? sum.plus(reservation.commissionAmount)
            : sum,
        decimal(0),
      );
      const latest = wallet.entries[0];
      const ledger = ledgerTotals.find((total) => total.walletId === wallet.id);
      const issues: string[] = [];
      if (wallet.availableCredit.isNegative()) issues.push("NEGATIVE_AVAILABLE_BALANCE");
      if (wallet.reservedCredit.isNegative()) issues.push("NEGATIVE_RESERVED_BALANCE");
      if (!wallet.reservedCredit.equals(expectedReserved))
        issues.push("RESERVATION_BALANCE_MISMATCH");
      if (
        latest &&
        (!wallet.availableCredit.equals(latest.availableBalance) ||
          !wallet.reservedCredit.equals(latest.reservedBalance))
      )
        issues.push("LEDGER_BALANCE_MISMATCH");
      if (
        !latest &&
        (!wallet.availableCredit.isZero() || !wallet.reservedCredit.isZero())
      )
        issues.push("LEDGER_ENTRY_MISSING");
      const reservationLifecycle = reservationTotals
        .filter((total) => total.walletId === wallet.id)
        .map((total) => ({
          status: total.status,
          count: total._count,
          commissionAmount: (total._sum.commissionAmount ?? decimal(0)).toFixed(2),
        }));
      return {
        walletId: wallet.id,
        business: wallet.business,
        issues,
        actual: {
          availableCredit: wallet.availableCredit.toFixed(2),
          reservedCredit: wallet.reservedCredit.toFixed(2),
        },
        expectedReservedCredit: expectedReserved.toFixed(2),
        ledgerTotals: {
          entries: ledger?._count ?? 0,
          availableDelta: (ledger?._sum.availableDelta ?? decimal(0)).toFixed(2),
          reservedDelta: (ledger?._sum.reservedDelta ?? decimal(0)).toFixed(2),
        },
        reservationLifecycle,
        latestLedger: latest
          ? {
              id: latest.id,
              availableBalance: latest.availableBalance.toFixed(2),
              reservedBalance: latest.reservedBalance.toFixed(2),
              createdAt: latest.createdAt,
            }
          : null,
      };
    });
    const discrepancies = summaries.filter((summary) => summary.issues.length);
    return {
      readOnly: true,
      checked: wallets.length,
      discrepancyCount: discrepancies.length,
      discrepancies,
      summaries,
      totalWallets,
      page: input.page,
      pageSize: input.pageSize,
    };
  }
}
