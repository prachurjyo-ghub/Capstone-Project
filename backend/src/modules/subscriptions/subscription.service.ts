import {
  CategoryRequestStatus,
  Prisma,
  SupplierBusinessStatus,
  SupplierSubscriptionStatus,
  SubscriptionInvoiceStatus,
  SubscriptionPaymentKind,
  type PrismaClient,
} from "@prisma/client";
import type { Env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { recordAudit } from "../auth/audit.service.js";
import { enqueueOutbox } from "../communications/outbox.service.js";
import { textPdf } from "../finance/pdf.js";
import type {
  CategoryDecisionInput,
  CategoryRequestInput,
  ComplimentaryGrantInput,
  IssueInvoiceInput,
  PaymentInput,
  PlanInput,
  PlanUpdate,
} from "./subscription.schemas.js";

type Tx = Prisma.TransactionClient;
const includeInvoice = {
  business: { select: { id: true, businessCode: true, displayName: true } },
  plan: { select: { id: true, name: true, durationMonths: true } },
  subscription: { include: { history: { orderBy: { createdAt: "asc" } } } },
  payments: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.SubscriptionInvoiceInclude;

function fail(code: string, message: string, statusCode = 400) {
  return new AppError(message, { code, statusCode });
}

function decimal(value: number | string | Prisma.Decimal) {
  return new Prisma.Decimal(value);
}

export function addCalendarMonths(value: Date, months: number): Date {
  const result = new Date(value);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

async function lock(tx: Tx, scope: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))`;
}

function derivedStatus(
  subscription: { status: SupplierSubscriptionStatus; startsAt: Date; endsAt: Date },
  now: Date,
) {
  if (
    subscription.status === SupplierSubscriptionStatus.CANCELLED ||
    subscription.status === SupplierSubscriptionStatus.SUSPENDED
  )
    return subscription.status;
  if (now >= subscription.endsAt) return SupplierSubscriptionStatus.EXPIRED;
  if (now < subscription.startsAt) return SupplierSubscriptionStatus.SCHEDULED;
  return SupplierSubscriptionStatus.ACTIVE;
}

export class SubscriptionService {
  constructor(
    private readonly database: PrismaClient,
    private readonly env: Env,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createPlan(input: PlanInput, actorUserId: string, requestId: string) {
    try {
      return await this.database.$transaction(async (tx) => {
        const plan = await tx.subscriptionPlan.create({
          data: { ...input, price: decimal(input.price), currency: "BDT" },
        });
        await recordAudit(tx, {
          actorUserId,
          action: "SUBSCRIPTION_PLAN_CREATED",
          entityType: "SUBSCRIPTION_PLAN",
          entityId: plan.id,
          requestId,
          metadata: { durationMonths: plan.durationMonths, isActive: plan.isActive },
        });
        return plan;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw fail(
          "SUBSCRIPTION_PLAN_CONFLICT",
          "A plan with this name already exists",
          409,
        );
      throw error;
    }
  }

  listPlans(query: { page: number; pageSize: number; isActive?: boolean }) {
    const where = { isActive: query.isActive };
    return this.database.$transaction(async (tx) => {
      const [items, total] = await Promise.all([
        tx.subscriptionPlan.findMany({
          where,
          orderBy: [{ durationMonths: "asc" }, { name: "asc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.subscriptionPlan.count({ where }),
      ]);
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  async updatePlan(
    id: string,
    input: PlanUpdate,
    actorUserId: string,
    requestId: string,
  ) {
    const current = await this.database.subscriptionPlan.findUnique({ where: { id } });
    if (!current)
      throw fail("SUBSCRIPTION_PLAN_NOT_FOUND", "Subscription plan was not found", 404);
    return this.database.$transaction(async (tx) => {
      const plan = await tx.subscriptionPlan.update({
        where: { id },
        data: {
          ...input,
          price: input.price === undefined ? undefined : decimal(input.price),
          archivedAt:
            input.isActive === false ? this.now() : input.isActive ? null : undefined,
        },
      });
      await recordAudit(tx, {
        actorUserId,
        action: "SUBSCRIPTION_PLAN_UPDATED",
        entityType: "SUBSCRIPTION_PLAN",
        entityId: id,
        requestId,
        metadata: { fields: Object.keys(input) },
      });
      return plan;
    });
  }

  private async nextPeriod(tx: Tx, businessId: string, months: number) {
    await lock(tx, `subscription:${businessId}`);
    const now = this.now();
    const latest = await tx.supplierSubscription.findFirst({
      where: {
        businessId,
        status: {
          in: [SupplierSubscriptionStatus.ACTIVE, SupplierSubscriptionStatus.SCHEDULED],
        },
        endsAt: { gt: now },
      },
      orderBy: { endsAt: "desc" },
      select: { endsAt: true },
    });
    const pending = await tx.subscriptionInvoice.findFirst({
      where: {
        businessId,
        status: {
          in: [
            SubscriptionInvoiceStatus.ISSUED,
            SubscriptionInvoiceStatus.PARTIALLY_PAID,
          ],
        },
      },
      orderBy: { periodEndsAt: "desc" },
      select: { periodEndsAt: true },
    });
    const startsAt =
      [latest?.endsAt, pending?.periodEndsAt]
        .filter((date): date is Date => Boolean(date && date > now))
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? now;
    return { startsAt, endsAt: addCalendarMonths(startsAt, months) };
  }

  async issueInvoice(input: IssueInvoiceInput, actorUserId: string, requestId: string) {
    const existing = await this.database.subscriptionInvoice.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: includeInvoice,
    });
    if (existing) return this.withBalance(existing);
    const now = this.now();
    if (input.dueAt < now)
      throw fail("INVALID_DUE_DATE", "Due date cannot be in the past");

    return this.database.$transaction(async (tx) => {
      await lock(tx, `subscription-invoice-key:${input.idempotencyKey}`);
      const duplicate = await tx.subscriptionInvoice.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: includeInvoice,
      });
      if (duplicate) return this.withBalance(duplicate);
      const [business, plan, seller] = await Promise.all([
        tx.supplierBusiness.findUnique({ where: { id: input.businessId } }),
        tx.subscriptionPlan.findUnique({ where: { id: input.planId } }),
        tx.platformBusinessConfig.findUnique({ where: { configKey: "default" } }),
      ]);
      if (!business)
        throw fail("SUPPLIER_BUSINESS_NOT_FOUND", "Supplier business was not found", 404);
      if (!plan || !plan.isActive)
        throw fail(
          "SUBSCRIPTION_PLAN_UNAVAILABLE",
          "Subscription plan is not active",
          409,
        );
      if (!seller)
        throw fail(
          "BUSINESS_IDENTITY_REQUIRED",
          "Invoice business identity is not configured",
          409,
        );
      if (this.env.NODE_ENV === "production" && seller.isPlaceholder)
        throw fail(
          "BUSINESS_IDENTITY_PLACEHOLDER",
          "Production invoice identity must be configured",
          409,
        );
      const period = await this.nextPeriod(tx, business.id, plan.durationMonths);
      const seq = await tx.$queryRaw<Array<{ value: bigint }>>`
        SELECT nextval('subscription_invoice_number_seq') AS value
      `;
      const invoiceNumber = `SUB-${now.getUTCFullYear()}-${String(seq[0]?.value ?? 0).padStart(6, "0")}`;
      const subscription = await tx.supplierSubscription.create({
        data: {
          businessId: business.id,
          planId: plan.id,
          status: SupplierSubscriptionStatus.PENDING,
          planNameSnapshot: plan.name,
          durationMonthsSnapshot: plan.durationMonths,
          priceSnapshot: plan.price,
          startsAt: period.startsAt,
          endsAt: period.endsAt,
          createdByUserId: actorUserId,
          idempotencyKey: `invoice:${input.idempotencyKey}`,
        },
      });
      const invoice = await tx.subscriptionInvoice.create({
        data: {
          invoiceNumber,
          businessId: business.id,
          planId: plan.id,
          subscriptionId: subscription.id,
          planNameSnapshot: plan.name,
          durationMonthsSnapshot: plan.durationMonths,
          amount: plan.price,
          periodStartsAt: period.startsAt,
          periodEndsAt: period.endsAt,
          issuedAt: now,
          dueAt: input.dueAt,
          sellerSnapshot: {
            legalName: seller.legalName,
            tradingName: seller.tradingName,
            address: seller.address,
            phone: seller.phone,
            email: seller.email,
            taxIdentifier: seller.taxIdentifier,
          },
          supplierSnapshot: {
            businessCode: business.businessCode,
            legalName: business.legalName,
            displayName: business.displayName,
            email: business.email,
            phone: business.phone,
          },
          issuedByUserId: actorUserId,
          idempotencyKey: input.idempotencyKey,
        },
        include: includeInvoice,
      });
      await recordAudit(tx, {
        actorUserId,
        action: "SUBSCRIPTION_INVOICE_ISSUED",
        entityType: "SUBSCRIPTION_INVOICE",
        entityId: invoice.id,
        requestId,
        metadata: { businessId: business.id, planId: plan.id, invoiceNumber },
      });
      return this.withBalance(invoice);
    });
  }

  private withBalance<
    T extends {
      amount: Prisma.Decimal;
      payments: Array<{ kind: SubscriptionPaymentKind; amount: Prisma.Decimal }>;
    },
  >(invoice: T) {
    const paid = invoice.payments.reduce(
      (sum, entry) =>
        entry.kind === SubscriptionPaymentKind.PAYMENT
          ? sum.plus(entry.amount)
          : sum.minus(entry.amount),
      decimal(0),
    );
    return {
      ...invoice,
      paidAmount: paid,
      outstandingAmount: invoice.amount.minus(paid),
    };
  }

  async recordPayment(
    invoiceId: string,
    input: PaymentInput,
    actorUserId: string,
    requestId: string,
  ) {
    const existing = await this.database.subscriptionPayment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { invoice: { include: includeInvoice } },
    });
    if (existing) return this.withBalance(existing.invoice);
    try {
      return await this.database.$transaction(async (tx) => {
        await lock(tx, `subscription-invoice:${invoiceId}`);
        const duplicate = await tx.subscriptionPayment.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: { invoice: { include: includeInvoice } },
        });
        if (duplicate) return this.withBalance(duplicate.invoice);
        const invoice = await tx.subscriptionInvoice.findUnique({
          where: { id: invoiceId },
          include: includeInvoice,
        });
        if (!invoice)
          throw fail(
            "SUBSCRIPTION_INVOICE_NOT_FOUND",
            "Subscription invoice was not found",
            404,
          );
        if (invoice.status === SubscriptionInvoiceStatus.VOID)
          throw fail(
            "SUBSCRIPTION_INVOICE_VOID",
            "A void invoice cannot receive payment",
            409,
          );
        const current = this.withBalance(invoice);
        const amount = decimal(input.amount);
        if (amount.gt(current.outstandingAmount))
          throw fail(
            "SUBSCRIPTION_OVERPAYMENT",
            "Payment cannot exceed the outstanding balance",
            409,
          );
        const externalReferenceKey = input.externalReference
          ? `${input.method.toLowerCase()}:${input.externalReference.toLowerCase()}`
          : undefined;
        await tx.subscriptionPayment.create({
          data: {
            invoiceId,
            amount,
            method: input.method,
            externalReference: input.externalReference,
            externalReferenceKey,
            occurredAt: input.occurredAt,
            safeNote: input.safeNote,
            recordedByUserId: actorUserId,
            idempotencyKey: input.idempotencyKey,
          },
        });
        const fullyPaid = amount.equals(current.outstandingAmount);
        const status = fullyPaid
          ? SubscriptionInvoiceStatus.PAID
          : SubscriptionInvoiceStatus.PARTIALLY_PAID;
        await tx.subscriptionInvoice.update({
          where: { id: invoiceId },
          data: { status, paidAt: fullyPaid ? input.occurredAt : null },
        });
        if (fullyPaid && invoice.subscription) {
          const nextStatus =
            this.now() < invoice.subscription.startsAt
              ? SupplierSubscriptionStatus.SCHEDULED
              : SupplierSubscriptionStatus.ACTIVE;
          await tx.supplierSubscription.update({
            where: { id: invoice.subscription.id },
            data: { status: nextStatus, activatedAt: this.now(), statusReason: null },
          });
          await tx.supplierSubscriptionEvent.create({
            data: {
              subscriptionId: invoice.subscription.id,
              fromStatus: SupplierSubscriptionStatus.PENDING,
              toStatus: nextStatus,
              reason: "Invoice paid in full",
              actorUserId,
            },
          });
          await enqueueOutbox(tx, {
            eventType: "SUPPLIER_SUBSCRIPTION_ACTIVATED",
            aggregateType: "SUPPLIER_SUBSCRIPTION",
            aggregateId: invoice.subscription.id,
            eventKey: `subscription-activated:${invoice.subscription.id}`,
            payload: {
              businessId: invoice.businessId,
              endsAt: invoice.periodEndsAt.toISOString(),
            },
          });
        }
        await recordAudit(tx, {
          actorUserId,
          action: "SUBSCRIPTION_PAYMENT_RECORDED",
          entityType: "SUBSCRIPTION_INVOICE",
          entityId: invoiceId,
          requestId,
          metadata: { businessId: invoice.businessId, fullyPaid },
        });
        const updated = await tx.subscriptionInvoice.findUniqueOrThrow({
          where: { id: invoiceId },
          include: includeInvoice,
        });
        return this.withBalance(updated);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw fail(
          "SUBSCRIPTION_PAYMENT_DUPLICATE_REFERENCE",
          "This external payment reference or idempotency key has already been recorded",
          409,
        );
      throw error;
    }
  }

  async grantComplimentary(
    input: ComplimentaryGrantInput,
    actorUserId: string,
    requestId: string,
  ) {
    const existing = await this.database.supplierSubscription.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { history: true },
    });
    if (existing) return existing;
    return this.database.$transaction(async (tx) => {
      await lock(tx, `subscription-grant-key:${input.idempotencyKey}`);
      const duplicate = await tx.supplierSubscription.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { history: true },
      });
      if (duplicate) return duplicate;
      const [business, plan] = await Promise.all([
        tx.supplierBusiness.findUnique({ where: { id: input.businessId } }),
        tx.subscriptionPlan.findUnique({ where: { id: input.planId } }),
      ]);
      if (!business)
        throw fail("SUPPLIER_BUSINESS_NOT_FOUND", "Supplier business was not found", 404);
      if (!plan || !plan.isActive)
        throw fail(
          "SUBSCRIPTION_PLAN_UNAVAILABLE",
          "Subscription plan is not active",
          409,
        );
      const period = await this.nextPeriod(tx, business.id, plan.durationMonths);
      const status =
        period.startsAt > this.now()
          ? SupplierSubscriptionStatus.SCHEDULED
          : SupplierSubscriptionStatus.ACTIVE;
      const subscription = await tx.supplierSubscription.create({
        data: {
          businessId: business.id,
          planId: plan.id,
          status,
          planNameSnapshot: plan.name,
          durationMonthsSnapshot: plan.durationMonths,
          priceSnapshot: decimal(0),
          startsAt: period.startsAt,
          endsAt: period.endsAt,
          activatedAt: this.now(),
          complimentaryReason: input.reason,
          createdByUserId: actorUserId,
          idempotencyKey: input.idempotencyKey,
          history: {
            create: { toStatus: status, reason: input.reason, actorUserId },
          },
        },
        include: { history: true },
      });
      await recordAudit(tx, {
        actorUserId,
        action: "SUBSCRIPTION_COMPLIMENTARY_GRANTED",
        entityType: "SUPPLIER_SUBSCRIPTION",
        entityId: subscription.id,
        requestId,
        metadata: { businessId: business.id, durationMonths: plan.durationMonths },
      });
      return subscription;
    });
  }

  async changeStatus(
    id: string,
    action: "suspend" | "reactivate" | "cancel",
    reason: string,
    actorUserId: string,
    requestId: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await lock(tx, `subscription-record:${id}`);
      const current = await tx.supplierSubscription.findUnique({ where: { id } });
      if (!current)
        throw fail("SUBSCRIPTION_NOT_FOUND", "Subscription was not found", 404);
      const now = this.now();
      let status: SupplierSubscriptionStatus;
      if (action === "suspend") {
        if (
          current.status !== SupplierSubscriptionStatus.ACTIVE &&
          current.status !== SupplierSubscriptionStatus.SCHEDULED
        )
          throw fail(
            "INVALID_SUBSCRIPTION_TRANSITION",
            "Only active or scheduled subscriptions can be suspended",
            409,
          );
        status = SupplierSubscriptionStatus.SUSPENDED;
      } else if (action === "cancel") {
        if (current.status === SupplierSubscriptionStatus.CANCELLED) return current;
        if (current.status === SupplierSubscriptionStatus.EXPIRED)
          throw fail(
            "INVALID_SUBSCRIPTION_TRANSITION",
            "Expired subscriptions are historical records",
            409,
          );
        status = SupplierSubscriptionStatus.CANCELLED;
      } else {
        if (current.status !== SupplierSubscriptionStatus.SUSPENDED)
          throw fail(
            "INVALID_SUBSCRIPTION_TRANSITION",
            "Only suspended subscriptions can be reactivated",
            409,
          );
        if (now >= current.endsAt)
          throw fail(
            "SUBSCRIPTION_EXPIRED",
            "An expired subscription must be renewed",
            409,
          );
        status =
          now < current.startsAt
            ? SupplierSubscriptionStatus.SCHEDULED
            : SupplierSubscriptionStatus.ACTIVE;
      }
      if (current.status === status) return current;
      const updated = await tx.supplierSubscription.update({
        where: { id },
        data: {
          status,
          statusReason: reason,
          suspendedAt: status === SupplierSubscriptionStatus.SUSPENDED ? now : null,
          cancelledAt: status === SupplierSubscriptionStatus.CANCELLED ? now : null,
        },
      });
      await tx.supplierSubscriptionEvent.create({
        data: {
          subscriptionId: id,
          fromStatus: current.status,
          toStatus: status,
          reason,
          actorUserId,
        },
      });
      await recordAudit(tx, {
        actorUserId,
        action: `SUBSCRIPTION_${action.toUpperCase()}`,
        entityType: "SUPPLIER_SUBSCRIPTION",
        entityId: id,
        requestId,
        metadata: { businessId: current.businessId },
      });
      return updated;
    });
  }

  async getSupplierCurrent(businessId: string) {
    const now = this.now();
    const subscription = await this.database.supplierSubscription.findFirst({
      where: { businessId },
      include: {
        invoice: { select: { id: true, invoiceNumber: true, status: true } },
      },
      orderBy: [{ endsAt: "desc" }, { createdAt: "desc" }],
    });
    if (!subscription) return null;
    return {
      id: subscription.id,
      planName: subscription.planNameSnapshot,
      status: subscription.status,
      effectiveStatus: derivedStatus(subscription, now),
      startsAt: subscription.startsAt,
      endsAt: subscription.endsAt,
      durationMonths: subscription.durationMonthsSnapshot,
      currency: subscription.currency,
      price: subscription.priceSnapshot.toFixed(2),
      complimentary: !!subscription.complimentaryReason,
      invoice: subscription.invoice,
    };
  }

  async listSubscriptions(query: {
    page: number;
    pageSize: number;
    businessId?: string;
    status?: SupplierSubscriptionStatus;
    expiringBefore?: Date;
  }) {
    const now = this.now();
    const where: Prisma.SupplierSubscriptionWhereInput = {
      businessId: query.businessId,
      status:
        query.status === SupplierSubscriptionStatus.EXPIRED
          ? {
              notIn: [
                SupplierSubscriptionStatus.CANCELLED,
                SupplierSubscriptionStatus.SUSPENDED,
              ],
            }
          : query.status === SupplierSubscriptionStatus.ACTIVE
            ? {
                in: [
                  SupplierSubscriptionStatus.ACTIVE,
                  SupplierSubscriptionStatus.SCHEDULED,
                ],
              }
            : (query.status ??
              (query.expiringBefore
                ? {
                    in: [
                      SupplierSubscriptionStatus.ACTIVE,
                      SupplierSubscriptionStatus.SCHEDULED,
                    ],
                  }
                : undefined)),
      startsAt:
        query.status === SupplierSubscriptionStatus.ACTIVE ? { lte: now } : undefined,
      endsAt:
        query.status === SupplierSubscriptionStatus.EXPIRED
          ? { lte: now }
          : query.status === SupplierSubscriptionStatus.ACTIVE
            ? { gt: now }
            : query.expiringBefore
              ? { gt: now, lte: query.expiringBefore }
              : undefined,
    };
    const [rows, total] = await this.database.$transaction([
      this.database.supplierSubscription.findMany({
        where,
        include: {
          business: { select: { id: true, displayName: true, status: true } },
          history: { orderBy: { createdAt: "asc" } },
          invoice: { select: { id: true, invoiceNumber: true, status: true } },
        },
        orderBy: { endsAt: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.supplierSubscription.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({ ...row, effectiveStatus: derivedStatus(row, now) })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listInvoices(
    query: {
      page: number;
      pageSize: number;
      businessId?: string;
      status?: SubscriptionInvoiceStatus;
    },
    supplierBusinessId?: string,
  ) {
    const where = {
      businessId: supplierBusinessId ?? query.businessId,
      status: query.status,
    };
    const [rows, total] = await this.database.$transaction([
      this.database.subscriptionInvoice.findMany({
        where,
        include: includeInvoice,
        orderBy: { issuedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.subscriptionInvoice.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.withBalance(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getInvoice(id: string, supplierBusinessId?: string) {
    const invoice = await this.database.subscriptionInvoice.findFirst({
      where: { id, businessId: supplierBusinessId },
      include: includeInvoice,
    });
    if (!invoice)
      throw fail(
        "SUBSCRIPTION_INVOICE_NOT_FOUND",
        "Subscription invoice was not found",
        404,
      );
    return this.withBalance(invoice);
  }

  async invoicePdf(id: string, supplierBusinessId?: string) {
    const invoice = await this.getInvoice(id, supplierBusinessId);
    const seller = invoice.sellerSnapshot as Record<string, unknown>;
    const supplier = invoice.supplierSnapshot as Record<string, unknown>;
    return {
      filename: `${invoice.invoiceNumber}.pdf`,
      bytes: textPdf(`PartsArc Subscription Invoice ${invoice.invoiceNumber}`, [
        `Seller: ${String(seller.legalName ?? "")}`,
        `Supplier: ${String(supplier.legalName ?? supplier.displayName ?? "")}`,
        `Plan: ${invoice.planNameSnapshot} (${invoice.durationMonthsSnapshot} calendar month(s))`,
        `Period: ${invoice.periodStartsAt.toISOString()} to ${invoice.periodEndsAt.toISOString()}`,
        `Amount: BDT ${invoice.amount.toFixed(2)}`,
        `Paid: BDT ${invoice.paidAmount.toFixed(2)}`,
        `Outstanding: BDT ${invoice.outstandingAmount.toFixed(2)}`,
        `Status: ${invoice.status}`,
        "Payments shown here record externally performed activity only.",
      ]),
    };
  }

  async voidInvoice(id: string, reason: string, actorUserId: string, requestId: string) {
    return this.database.$transaction(async (tx) => {
      await lock(tx, `subscription-invoice:${id}`);
      const invoice = await tx.subscriptionInvoice.findUnique({
        where: { id },
        include: { payments: true, subscription: true },
      });
      if (!invoice)
        throw fail(
          "SUBSCRIPTION_INVOICE_NOT_FOUND",
          "Subscription invoice was not found",
          404,
        );
      if (invoice.status === SubscriptionInvoiceStatus.VOID) return invoice;
      if (invoice.payments.length)
        throw fail(
          "SUBSCRIPTION_INVOICE_HAS_PAYMENT",
          "Reverse recorded payments before voiding this invoice",
          409,
        );
      const updated = await tx.subscriptionInvoice.update({
        where: { id },
        data: {
          status: SubscriptionInvoiceStatus.VOID,
          voidedAt: this.now(),
          voidReason: reason,
          voidedByUserId: actorUserId,
        },
      });
      if (invoice.subscription)
        await tx.supplierSubscription.update({
          where: { id: invoice.subscription.id },
          data: {
            status: SupplierSubscriptionStatus.CANCELLED,
            cancelledAt: this.now(),
            statusReason: reason,
          },
        });
      await recordAudit(tx, {
        actorUserId,
        action: "SUBSCRIPTION_INVOICE_VOIDED",
        entityType: "SUBSCRIPTION_INVOICE",
        entityId: id,
        requestId,
        metadata: { businessId: invoice.businessId },
      });
      return updated;
    });
  }

  async reversePayment(
    paymentId: string,
    reason: string,
    idempotencyKey: string,
    actorUserId: string,
    requestId: string,
  ) {
    const existing = await this.database.subscriptionPayment.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return existing;
    return this.database.$transaction(async (tx) => {
      await lock(tx, `subscription-payment:${paymentId}`);
      const duplicate = await tx.subscriptionPayment.findUnique({
        where: { idempotencyKey },
      });
      if (duplicate) return duplicate;
      const payment = await tx.subscriptionPayment.findUnique({
        where: { id: paymentId },
        include: { invoice: true, reversal: true },
      });
      if (!payment || payment.kind !== SubscriptionPaymentKind.PAYMENT)
        throw fail(
          "SUBSCRIPTION_PAYMENT_NOT_FOUND",
          "Subscription payment was not found",
          404,
        );
      if (payment.reversal) return payment.reversal;
      const reversal = await tx.subscriptionPayment.create({
        data: {
          invoiceId: payment.invoiceId,
          kind: SubscriptionPaymentKind.REVERSAL,
          amount: payment.amount,
          method: payment.method,
          occurredAt: this.now(),
          safeNote: reason,
          reversalOfId: payment.id,
          recordedByUserId: actorUserId,
          idempotencyKey,
        },
      });
      const entries = await tx.subscriptionPayment.findMany({
        where: { invoiceId: payment.invoiceId },
        select: { kind: true, amount: true },
      });
      const remaining = entries.reduce(
        (sum, entry) =>
          entry.kind === SubscriptionPaymentKind.PAYMENT
            ? sum.plus(entry.amount)
            : sum.minus(entry.amount),
        decimal(0),
      );
      const invoiceStatus = remaining.gt(0)
        ? SubscriptionInvoiceStatus.PARTIALLY_PAID
        : SubscriptionInvoiceStatus.ISSUED;
      await tx.subscriptionInvoice.update({
        where: { id: payment.invoiceId },
        data: { status: invoiceStatus, paidAt: null },
      });
      if (payment.invoice.subscriptionId) {
        const subscription = await tx.supplierSubscription.findUniqueOrThrow({
          where: { id: payment.invoice.subscriptionId },
        });
        await tx.supplierSubscription.update({
          where: { id: subscription.id },
          data: {
            status: SupplierSubscriptionStatus.SUSPENDED,
            suspendedAt: this.now(),
            statusReason: "Subscription payment reversed",
          },
        });
        await tx.supplierSubscriptionEvent.create({
          data: {
            subscriptionId: subscription.id,
            fromStatus: subscription.status,
            toStatus: SupplierSubscriptionStatus.SUSPENDED,
            reason,
            actorUserId,
          },
        });
      }
      await recordAudit(tx, {
        actorUserId,
        action: "SUBSCRIPTION_PAYMENT_REVERSED",
        entityType: "SUBSCRIPTION_PAYMENT",
        entityId: payment.id,
        requestId,
        metadata: { invoiceId: payment.invoiceId },
      });
      return reversal;
    });
  }

  async createCategoryRequest(
    businessId: string,
    input: CategoryRequestInput,
    actorUserId: string,
    requestId: string,
  ) {
    const normalizedName = input.proposedName.trim().toLocaleLowerCase("en");
    try {
      return await this.database.$transaction(async (tx) => {
        if (
          input.proposedParentId &&
          !(await tx.partCategory.findUnique({ where: { id: input.proposedParentId } }))
        )
          throw fail(
            "CATEGORY_PARENT_NOT_FOUND",
            "Proposed parent category was not found",
            404,
          );
        const request = await tx.supplierCategoryRequest.create({
          data: { businessId, normalizedName, ...input, createdByUserId: actorUserId },
        });
        await recordAudit(tx, {
          actorUserId,
          action: "SUPPLIER_CATEGORY_REQUESTED",
          entityType: "SUPPLIER_CATEGORY_REQUEST",
          entityId: request.id,
          requestId,
          metadata: { businessId },
        });
        return request;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw fail(
          "CATEGORY_REQUEST_DUPLICATE",
          "An equivalent request already has this status",
          409,
        );
      throw error;
    }
  }

  async listCategoryRequests(
    query: {
      page: number;
      pageSize: number;
      status?: CategoryRequestStatus;
      businessId?: string;
    },
    supplierBusinessId?: string,
  ) {
    const where = {
      businessId: supplierBusinessId ?? query.businessId,
      status: query.status,
    };
    const [items, total] = await this.database.$transaction([
      this.database.supplierCategoryRequest.findMany({
        where,
        include: {
          business: { select: { id: true, displayName: true } },
          proposedParent: { select: { id: true, name: true } },
          approvedCategory: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.supplierCategoryRequest.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async decideCategoryRequest(
    id: string,
    input: CategoryDecisionInput,
    actorUserId: string,
    requestId: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await lock(tx, `category-request:${id}`);
      const request = await tx.supplierCategoryRequest.findUnique({ where: { id } });
      if (!request)
        throw fail("CATEGORY_REQUEST_NOT_FOUND", "Category request was not found", 404);
      if (request.status !== CategoryRequestStatus.PENDING)
        throw fail(
          "CATEGORY_REQUEST_DECIDED",
          "Category request has already been decided",
          409,
        );
      let categoryId: string | undefined;
      if (input.decision === "APPROVE_EXISTING") {
        const category = await tx.partCategory.findUnique({
          where: { id: input.existingCategoryId! },
        });
        if (!category)
          throw fail("CATEGORY_NOT_FOUND", "Selected category was not found", 404);
        categoryId = category.id;
      } else if (input.decision === "APPROVE_CREATE") {
        const duplicate = await tx.partCategory.findFirst({
          where: {
            OR: [
              { name: { equals: request.proposedName, mode: "insensitive" } },
              { slug: input.slug },
            ],
          },
        });
        if (duplicate)
          throw fail(
            "CATEGORY_ALREADY_EXISTS",
            "Use the existing-category approval option",
            409,
          );
        const category = await tx.partCategory.create({
          data: {
            name: request.proposedName,
            slug: input.slug!,
            description: request.description,
            parentId: request.proposedParentId,
            isActive: true,
          },
        });
        categoryId = category.id;
      }
      const status =
        input.decision === "REJECT"
          ? CategoryRequestStatus.REJECTED
          : CategoryRequestStatus.APPROVED;
      const updated = await tx.supplierCategoryRequest.update({
        where: { id },
        data: {
          status,
          approvedCategoryId: categoryId,
          decisionReason: input.reason,
          reviewedByUserId: actorUserId,
          reviewedAt: this.now(),
        },
      });
      await enqueueOutbox(tx, {
        eventType: "SUPPLIER_CATEGORY_REQUEST_DECIDED",
        aggregateType: "SUPPLIER_CATEGORY_REQUEST",
        aggregateId: id,
        eventKey: `supplier-category-request:${id}:${status}`,
        payload: {
          businessId: request.businessId,
          status,
          categoryId: categoryId ?? null,
        },
      });
      await recordAudit(tx, {
        actorUserId,
        action: `SUPPLIER_CATEGORY_REQUEST_${status}`,
        entityType: "SUPPLIER_CATEGORY_REQUEST",
        entityId: id,
        requestId,
        metadata: { businessId: request.businessId, categoryId: categoryId ?? null },
      });
      return updated;
    });
  }

  async dashboard(from: Date, to: Date, _timezone = "Asia/Dhaka") {
    const now = this.now();
    const soon = new Date(now.getTime() + 30 * 86_400_000);
    const [
      active,
      expiring,
      expired,
      suspended,
      requests,
      quotations,
      orders,
      activityRows,
    ] = await Promise.all([
      this.database.supplierBusiness.count({
        where: {
          status: SupplierBusinessStatus.ACTIVE,
          subscriptions: {
            some: {
              status: {
                in: [
                  SupplierSubscriptionStatus.ACTIVE,
                  SupplierSubscriptionStatus.SCHEDULED,
                ],
              },
              startsAt: { lte: now },
              endsAt: { gt: now },
            },
          },
        },
      }),
      this.database.supplierBusiness.count({
        where: {
          status: SupplierBusinessStatus.ACTIVE,
          subscriptions: {
            some: {
              status: {
                in: [
                  SupplierSubscriptionStatus.ACTIVE,
                  SupplierSubscriptionStatus.SCHEDULED,
                ],
              },
              startsAt: { lte: now },
              endsAt: { gt: now, lte: soon },
            },
          },
        },
      }),
      this.database.supplierBusiness.count({
        where: {
          status: SupplierBusinessStatus.ACTIVE,
          OR: [
            { subscriptionGraceEndsAt: null },
            { subscriptionGraceEndsAt: { lte: now } },
          ],
          subscriptions: {
            none: {
              OR: [
                { status: SupplierSubscriptionStatus.SUSPENDED },
                {
                  status: {
                    in: [
                      SupplierSubscriptionStatus.ACTIVE,
                      SupplierSubscriptionStatus.SCHEDULED,
                    ],
                  },
                  startsAt: { lte: now },
                  endsAt: { gt: now },
                },
              ],
            },
          },
        },
      }),
      this.database.supplierBusiness.count({
        where: {
          status: SupplierBusinessStatus.ACTIVE,
          subscriptions: {
            some: { status: SupplierSubscriptionStatus.SUSPENDED },
          },
          NOT: {
            subscriptions: {
              some: {
                status: {
                  in: [
                    SupplierSubscriptionStatus.ACTIVE,
                    SupplierSubscriptionStatus.SCHEDULED,
                  ],
                },
                startsAt: { lte: now },
                endsAt: { gt: now },
              },
            },
          },
        },
      }),
      this.database.sourcingRequest.count({ where: { status: "SUBMITTED" } }),
      this.database.quotation.count({
        where: { status: { in: ["SUBMITTED", "ADMIN_REVIEW"] } },
      }),
      this.database.order.count({
        where: {
          status: { in: ["PENDING_SUPPLIER_CONFIRMATION", "READY_FOR_PICKUP", "FAILED"] },
        },
      }),
      this.database.$queryRaw<Array<{ date: string; requests: bigint; orders: bigint }>>`
        WITH days AS (
          SELECT generate_series(
            date_trunc('day', ${from}::timestamp + interval '6 hours'),
            date_trunc('day', ${to}::timestamp + interval '6 hours'),
            interval '1 day'
          ) AS day
        ), request_counts AS (
          SELECT date_trunc('day', "createdAt" + interval '6 hours') AS day,
                 count(*)::bigint AS count
          FROM "sourcing_requests"
          WHERE "createdAt" >= ${from}
            AND "createdAt" <= ${to}
            AND "status" <> 'DRAFT'
          GROUP BY 1
        ), order_counts AS (
          SELECT date_trunc('day', "createdAt" + interval '6 hours') AS day,
                 count(*)::bigint AS count
          FROM "orders"
          WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
          GROUP BY 1
        )
        SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
               coalesce(request_counts.count, 0)::bigint AS requests,
               coalesce(order_counts.count, 0)::bigint AS orders
        FROM days
        LEFT JOIN request_counts USING (day)
        LEFT JOIN order_counts USING (day)
        ORDER BY days.day
      `,
    ]);
    return {
      kpis: {
        activeSubscribedSuppliers: active,
        subscriptionsExpiringSoon: expiring,
        requestsAwaitingAssignment: requests,
        quotationsAwaitingReview: quotations,
        ordersRequiringAction: orders,
      },
      subscriptions: { active, expiring, expired, suspended },
      activity: activityRows.map((row) => ({
        date: row.date,
        requests: Number(row.requests),
        orders: Number(row.orders),
      })),
    };
  }
}
