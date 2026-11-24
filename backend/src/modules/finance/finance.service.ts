import {
  InvoiceStatus,
  OperationalCaseStatus,
  OrderCancellationStatus,
  OrderReturnStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  RefundStatus,
  SettlementStatus,
  SupplierPayableStatus,
  TransactionType,
  type PrismaClient,
} from "@prisma/client";
import type { Env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { recordAudit } from "../auth/audit.service.js";
import { enqueueOutbox } from "../communications/outbox.service.js";
import type {
  AuditQueryInput,
  CaseListInput,
  CreateCaseInput,
  DashboardQueryInput,
  FinanceListInput,
  InvoiceListInput,
  PaymentInput,
  QueueQueryInput,
  RefundApprovalInput,
  RefundCompletionInput,
  SettlementInput,
  UpdateCaseInput,
} from "./finance.schemas.js";
import { textPdf } from "./pdf.js";

type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;
const ZERO = new D(0);

function fail(code: string, message: string, statusCode = 409) {
  return new AppError(message, { code, statusCode });
}
function money(value: Prisma.Decimal | string | number) {
  return new D(value).toDecimalPlaces(2).toFixed(2);
}
function pagination(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
function range(from?: Date, to?: Date) {
  if (from && to && to <= from)
    throw fail("INVALID_DATE_RANGE", "to must be after from", 400);
  return from || to ? { gte: from, lt: to } : undefined;
}
async function lock(tx: Tx, scope: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0)) IS NULL AS "locked"`;
}
async function nextReference(
  tx: Tx,
  sequence:
    | "invoice_number_seq"
    | "financial_reference_seq"
    | "settlement_reference_seq"
    | "operational_case_number_seq",
  prefix: string,
  now: Date,
) {
  const rows = await tx.$queryRawUnsafe<Array<{ value: bigint }>>(
    `SELECT nextval('${sequence}') AS "value"`,
  );
  return `${prefix}-${now.getUTCFullYear()}-${String(rows[0]?.value ?? 0).padStart(6, "0")}`;
}
function externalKey(scope: string, method: string, reference: string) {
  return `${scope}:${method.trim().toLowerCase()}:${reference.trim().toLowerCase()}`;
}
function safeTransaction(row: {
  id: string;
  reference: string;
  type: TransactionType;
  status: PaymentStatus;
  amount: Prisma.Decimal;
  currency: string;
  method: string | null;
  occurredAt: Date | null;
  orderId: string | null;
  invoiceId: string | null;
  settlementId: string | null;
  refundId: string | null;
  reversalOfId: string | null;
  createdAt: Date;
}) {
  return { ...row, amount: money(row.amount) };
}

const invoiceInclude = {
  items: { orderBy: { createdAt: "asc" as const } },
  order: { select: { orderNumber: true } },
  transactions: {
    where: { type: { in: [TransactionType.CUSTOMER_PAYMENT, TransactionType.REFUND] } },
    include: { reversal: { select: { id: true } } },
    orderBy: { occurredAt: "asc" as const },
  },
} satisfies Prisma.InvoiceInclude;

type FullInvoice = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

function invoiceView(row: FullInvoice) {
  const receipts = row.transactions
    .filter((entry) => entry.type === TransactionType.CUSTOMER_PAYMENT && !entry.reversal)
    .reduce((sum, entry) => sum.plus(entry.amount), ZERO);
  const refunds = row.transactions
    .filter((entry) => entry.type === TransactionType.REFUND && !entry.reversal)
    .reduce((sum, entry) => sum.plus(entry.amount), ZERO);
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    orderId: row.orderId,
    orderNumber: row.order?.orderNumber ?? null,
    status: row.status,
    currency: row.currency,
    subtotal: money(row.subtotal),
    deliveryCharge: money(row.deliveryCharge),
    priorityCharge: money(row.priorityCharge),
    total: money(row.total),
    received: money(receipts),
    refunded: money(refunds),
    outstanding: money(Prisma.Decimal.max(ZERO, row.total.minus(receipts))),
    issuedAt: row.issuedAt,
    dueAt: row.dueAt,
    paidAt: row.paidAt,
    voidedAt: row.voidedAt,
    items: row.items.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unitPrice: money(item.unitPrice),
      lineTotal: money(item.lineTotal),
    })),
  };
}

export class FinanceService {
  constructor(
    private readonly database: PrismaClient,
    private readonly env: Env,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async config(tx: Tx) {
    const config = await tx.platformBusinessConfig.upsert({
      where: { configKey: "default" },
      update: {},
      create: {
        legalName: "PartsArc DEVELOPMENT BUSINESS",
        tradingName: "PartsArc (DEVELOPMENT PLACEHOLDER)",
        address: "Development placeholder — configure before production issuance",
        isPlaceholder: true,
      },
    });
    if (this.env.NODE_ENV === "production" && config.isPlaceholder)
      throw fail(
        "BUSINESS_IDENTITY_REQUIRED",
        "Production invoice issuance requires configured business identity",
      );
    return config;
  }

  async issueInvoice(
    orderId: string,
    dueAt: Date | null | undefined,
    actor: string,
    requestId: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await lock(tx, `finance:invoice:${orderId}`);
      const existing = await tx.invoice.findUnique({
        where: { orderId },
        include: invoiceInclude,
      });
      if (existing) return { invoice: invoiceView(existing), duplicate: true };
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: { orderBy: { lineNumber: "asc" } },
          customer: { include: { user: true } },
        },
      });
      if (!order) throw fail("ORDER_NOT_FOUND", "Order was not found", 404);
      if (
        ([OrderStatus.CANCELLED, OrderStatus.FAILED] as OrderStatus[]).includes(
          order.status,
        )
      )
        throw fail(
          "ORDER_NOT_INVOICEABLE",
          "Cancelled or failed orders cannot be invoiced",
        );
      const config = await this.config(tx);
      const at = this.now();
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber: await nextReference(tx, "invoice_number_seq", "INV", at),
          customerId: order.customerId,
          orderId: order.id,
          status: InvoiceStatus.ISSUED,
          subtotal: order.items.reduce(
            (sum, item) => sum.plus(item.customerLineTotal),
            ZERO,
          ),
          deliveryCharge: order.deliveryCharge,
          priorityCharge: order.priorityCharge,
          total: order.customerTotal,
          currency: "BDT",
          issuedAt: at,
          dueAt: dueAt ?? null,
          issuedByUserId: actor,
          sellerSnapshot: {
            legalName: config.legalName,
            tradingName: config.tradingName,
            address: config.address,
            phone: config.phone,
            email: config.email,
            taxIdentifier: config.taxIdentifier,
            developmentPlaceholder: config.isPlaceholder,
          },
          customerSnapshot: {
            name: order.customer.fullName,
            email: order.customer.user.email,
            phone: order.customer.user.phone,
          },
          deliverySnapshot: order.deliverySnapshot ?? Prisma.JsonNull,
          items: {
            create: order.items.map((item) => ({
              orderItemId: item.id,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.customerUnitPrice,
              lineTotal: item.customerLineTotal,
            })),
          },
        },
        include: invoiceInclude,
      });
      const components: Array<[TransactionType, Prisma.Decimal, string]> = [
        [
          TransactionType.PLATFORM_MARGIN,
          order.platformMargin,
          "Commercial platform margin",
        ],
        [
          TransactionType.DELIVERY_CHARGE,
          order.deliveryCharge,
          "Accepted delivery charge",
        ],
        [
          TransactionType.PRIORITY_CHARGE,
          order.priorityCharge,
          "Accepted priority charge",
        ],
      ];
      for (const [type, amount, description] of components) {
        if (amount.lte(0)) continue;
        await tx.transaction.create({
          data: {
            reference: await nextReference(tx, "financial_reference_seq", "FIN", at),
            type,
            status: PaymentStatus.CAPTURED,
            customerId: order.customerId,
            orderId: order.id,
            invoiceId: invoice.id,
            recordedByUserId: actor,
            idempotencyKey: `invoice-component:${invoice.id}:${type}`,
            amount,
            currency: "BDT",
            description,
            occurredAt: at,
            processedAt: at,
          },
        });
      }
      await enqueueOutbox(tx, {
        eventType: "INVOICE_ISSUED",
        aggregateType: "INVOICE",
        aggregateId: invoice.id,
        eventKey: `invoice:${invoice.id}:issued`,
      });
      await recordAudit(tx, {
        actorUserId: actor,
        action: "FINANCE_INVOICE_ISSUED",
        entityType: "INVOICE",
        entityId: invoice.id,
        requestId,
        metadata: { orderId: order.id, currency: "BDT" },
      });
      return { invoice: invoiceView(invoice), duplicate: false };
    });
  }

  async recordPayment(
    orderId: string,
    input: PaymentInput,
    actor: string,
    requestId: string,
  ) {
    try {
      return await this.database.$transaction(async (tx) => {
        await lock(tx, `finance:order:${orderId}`);
        const duplicate = await tx.transaction.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (duplicate)
          return { transaction: safeTransaction(duplicate), duplicate: true };
        const invoice = await tx.invoice.findUnique({
          where: { orderId },
          include: invoiceInclude,
        });
        if (!invoice || invoice.status === InvoiceStatus.VOID)
          throw fail("INVOICE_NOT_PAYABLE", "An issued invoice is required");
        const amount = new D(input.amount);
        const received = invoice.transactions
          .filter(
            (entry) => entry.type === TransactionType.CUSTOMER_PAYMENT && !entry.reversal,
          )
          .reduce((sum, entry) => sum.plus(entry.amount), ZERO);
        if (received.plus(amount).gt(invoice.total))
          throw fail(
            "OVERPAYMENT_NOT_ALLOWED",
            "Payment exceeds the invoice outstanding balance",
          );
        const at = this.now();
        const transaction = await tx.transaction.create({
          data: {
            reference: await nextReference(tx, "financial_reference_seq", "PAY", at),
            type: TransactionType.CUSTOMER_PAYMENT,
            status: PaymentStatus.CAPTURED,
            customerId: invoice.customerId,
            orderId,
            invoiceId: invoice.id,
            amount,
            currency: "BDT",
            method: input.method,
            externalReference: input.externalReference,
            externalReferenceKey: externalKey(
              "customer-payment",
              input.method,
              input.externalReference,
            ),
            occurredAt: input.occurredAt,
            processedAt: at,
            recordedByUserId: actor,
            idempotencyKey: input.idempotencyKey,
            safeNote: input.note,
            description: "Externally received customer payment",
          },
        });
        const paid = received.plus(amount).eq(invoice.total);
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: paid ? InvoiceStatus.PAID : InvoiceStatus.ISSUED,
            paidAt: paid ? at : null,
          },
        });
        await enqueueOutbox(tx, {
          eventType: "CUSTOMER_PAYMENT_RECORDED",
          aggregateType: "TRANSACTION",
          aggregateId: transaction.id,
          eventKey: `transaction:${transaction.id}:posted`,
        });
        await recordAudit(tx, {
          actorUserId: actor,
          action: "FINANCE_CUSTOMER_PAYMENT_RECORDED",
          entityType: "TRANSACTION",
          entityId: transaction.id,
          requestId,
          metadata: { orderId, invoiceId: invoice.id, currency: "BDT" },
        });
        return { transaction: safeTransaction(transaction), duplicate: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw fail(
          "DUPLICATE_FINANCIAL_REFERENCE",
          "This financial reference was already recorded",
        );
      throw error;
    }
  }

  async approveRefund(
    orderId: string,
    input: RefundApprovalInput,
    actor: string,
    requestId: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await lock(tx, `finance:order:${orderId}`);
      const prior = await tx.refund.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (prior) return { refund: this.refundView(prior), duplicate: true };
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          cancellations: true,
          return: true,
          payable: { include: { allocations: true } },
        },
      });
      if (!order) throw fail("ORDER_NOT_FOUND", "Order was not found", 404);
      const eligible =
        order.status === OrderStatus.CANCELLED ||
        order.cancellations.some(
          (item) => item.status === OrderCancellationStatus.APPROVED,
        ) ||
        (order.return?.status === OrderReturnStatus.INSPECTED &&
          order.return.refundRequired);
      if (!eligible)
        throw fail("REFUND_NOT_ELIGIBLE", "The order is not eligible for a refund");
      const receipts = await tx.transaction.findMany({
        where: { orderId, type: TransactionType.CUSTOMER_PAYMENT },
        include: { reversal: { select: { id: true } } },
      });
      const received = receipts
        .filter((item) => !item.reversal)
        .reduce((sum, item) => sum.plus(item.amount), ZERO);
      const committed = await tx.refund.aggregate({
        where: {
          orderId,
          status: { in: [RefundStatus.APPROVED, RefundStatus.PROCESSED] },
        },
        _sum: { amount: true },
      });
      const amount = new D(input.amount);
      if (amount.gt(received.minus(committed._sum.amount ?? ZERO)))
        throw fail(
          "REFUND_LIMIT_EXCEEDED",
          "Refund exceeds eligible net customer receipts",
        );
      const at = this.now();
      const refund = await tx.refund.create({
        data: {
          customerId: order.customerId,
          orderId,
          status: RefundStatus.APPROVED,
          amount,
          currency: "BDT",
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
          approvedByUserId: actor,
          approvedAt: at,
        },
      });
      if (order.return?.status === OrderReturnStatus.INSPECTED && order.payable) {
        await tx.supplierRecovery.upsert({
          where: { orderReturnId: order.return.id },
          update: {},
          create: {
            payableId: order.payable.id,
            orderReturnId: order.return.id,
            amount: order.payable.originalAmount,
            reason: "Inspected return requires supplier recovery",
          },
        });
        const paid = order.payable.allocations.reduce(
          (sum, row) => sum.plus(row.amount),
          ZERO,
        );
        await tx.supplierPayable.update({
          where: { id: order.payable.id },
          data: {
            recoveryAmount: order.payable.originalAmount,
            status: paid.gt(0)
              ? SupplierPayableStatus.RECOVERY_DUE
              : SupplierPayableStatus.PAID,
          },
        });
      }
      await enqueueOutbox(tx, {
        eventType: "CUSTOMER_REFUND_APPROVED",
        aggregateType: "REFUND",
        aggregateId: refund.id,
        eventKey: `refund:${refund.id}:approved`,
      });
      await recordAudit(tx, {
        actorUserId: actor,
        action: "FINANCE_REFUND_APPROVED",
        entityType: "REFUND",
        entityId: refund.id,
        requestId,
        metadata: { orderId, currency: "BDT" },
      });
      return { refund: this.refundView(refund), duplicate: false };
    });
  }

  async completeRefund(
    refundId: string,
    input: RefundCompletionInput,
    actor: string,
    requestId: string,
  ) {
    try {
      return await this.database.$transaction(async (tx) => {
        await lock(tx, `finance:refund:${refundId}`);
        const prior = await tx.transaction.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (prior) return { transaction: safeTransaction(prior), duplicate: true };
        const refund = await tx.refund.findUnique({ where: { id: refundId } });
        if (!refund) throw fail("REFUND_NOT_FOUND", "Refund was not found", 404);
        if (refund.status === RefundStatus.PROCESSED) {
          const transaction = await tx.transaction.findFirst({
            where: { refundId, type: TransactionType.REFUND },
          });
          if (!transaction)
            throw fail("REFUND_ACCOUNTING_ERROR", "Processed refund entry is missing");
          return { transaction: safeTransaction(transaction), duplicate: true };
        }
        if (refund.status !== RefundStatus.APPROVED)
          throw fail("REFUND_NOT_APPROVED", "Only approved refunds can be completed");
        const order = refund.orderId
          ? await tx.order.findUnique({
              where: { id: refund.orderId },
              select: { customerId: true },
            })
          : null;
        const invoice = refund.orderId
          ? await tx.invoice.findUnique({ where: { orderId: refund.orderId } })
          : null;
        const at = this.now();
        const transaction = await tx.transaction.create({
          data: {
            reference: await nextReference(tx, "financial_reference_seq", "RFD", at),
            type: TransactionType.REFUND,
            status: PaymentStatus.CAPTURED,
            customerId: order?.customerId ?? refund.customerId,
            orderId: refund.orderId,
            invoiceId: invoice?.id,
            refundId: refund.id,
            amount: refund.amount,
            currency: "BDT",
            method: input.method,
            externalReference: input.externalReference,
            externalReferenceKey: externalKey(
              "customer-refund",
              input.method,
              input.externalReference,
            ),
            occurredAt: input.occurredAt,
            processedAt: at,
            recordedByUserId: actor,
            idempotencyKey: input.idempotencyKey,
            safeNote: input.note,
            description: "Externally completed customer refund",
          },
        });
        await tx.refund.update({
          where: { id: refund.id },
          data: {
            status: RefundStatus.PROCESSED,
            processedAt: input.occurredAt,
            processedByUserId: actor,
            method: input.method,
            externalReference: input.externalReference,
            externalReferenceKey: externalKey(
              "customer-refund",
              input.method,
              input.externalReference,
            ),
          },
        });
        if (invoice) {
          const processed = await tx.refund.aggregate({
            where: { orderId: refund.orderId, status: RefundStatus.PROCESSED },
            _sum: { amount: true },
          });
          await tx.invoice.update({
            where: { id: invoice.id },
            data: {
              status: (processed._sum.amount ?? ZERO).gte(invoice.total)
                ? InvoiceStatus.REFUNDED
                : invoice.status,
            },
          });
        }
        await enqueueOutbox(tx, {
          eventType: "CUSTOMER_REFUND_COMPLETED",
          aggregateType: "REFUND",
          aggregateId: refund.id,
          eventKey: `refund:${refund.id}:processed`,
        });
        await recordAudit(tx, {
          actorUserId: actor,
          action: "FINANCE_REFUND_COMPLETED_EXTERNALLY",
          entityType: "REFUND",
          entityId: refund.id,
          requestId,
          metadata: { orderId: refund.orderId, currency: "BDT" },
        });
        return { transaction: safeTransaction(transaction), duplicate: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw fail(
          "DUPLICATE_FINANCIAL_REFERENCE",
          "This financial reference was already recorded",
        );
      throw error;
    }
  }

  async createPayable(orderId: string, actor: string, requestId: string) {
    return this.database.$transaction(async (tx) => {
      await lock(tx, `finance:payable:${orderId}`);
      const existing = await tx.supplierPayable.findUnique({ where: { orderId } });
      if (existing) return { payable: this.payableView(existing, ZERO), duplicate: true };
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw fail("ORDER_NOT_FOUND", "Order was not found", 404);
      if (order.status !== OrderStatus.COMPLETED)
        throw fail(
          "PAYABLE_NOT_ELIGIBLE",
          "Supplier payable becomes eligible only after order completion",
        );
      const at = this.now();
      const payable = await tx.supplierPayable.create({
        data: {
          orderId,
          businessId: order.businessId,
          originalAmount: order.supplierPayable,
          eligibleAt: order.completedAt ?? at,
        },
      });
      const entry = await tx.transaction.create({
        data: {
          reference: await nextReference(tx, "financial_reference_seq", "PAYABLE", at),
          type: TransactionType.SUPPLIER_PAYABLE,
          status: PaymentStatus.CAPTURED,
          orderId,
          businessId: order.businessId,
          amount: order.supplierPayable,
          currency: "BDT",
          occurredAt: order.completedAt ?? at,
          processedAt: at,
          recordedByUserId: actor,
          idempotencyKey: `supplier-payable:${orderId}`,
          description: "Supplier liability recognized after completion",
        },
      });
      await enqueueOutbox(tx, {
        eventType: "SUPPLIER_PAYABLE_CREATED",
        aggregateType: "SUPPLIER_PAYABLE",
        aggregateId: payable.id,
        eventKey: `payable:${payable.id}:created`,
      });
      await recordAudit(tx, {
        actorUserId: actor,
        action: "FINANCE_SUPPLIER_PAYABLE_CREATED",
        entityType: "SUPPLIER_PAYABLE",
        entityId: payable.id,
        requestId,
        metadata: { orderId, transactionId: entry.id, currency: "BDT" },
      });
      return { payable: this.payableView(payable, ZERO), duplicate: false };
    });
  }

  async recordSettlement(input: SettlementInput, actor: string, requestId: string) {
    try {
      return await this.database.$transaction(async (tx) => {
        await lock(tx, `finance:settlement:${input.businessId}`);
        const existing = await tx.supplierSettlement.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: { allocations: true },
        });
        if (existing)
          return { settlement: this.settlementView(existing), duplicate: true };
        const ids = input.allocations.map((row) => row.payableId).sort();
        for (const id of ids) await lock(tx, `finance:payable-id:${id}`);
        const payables = await tx.supplierPayable.findMany({
          where: { id: { in: ids }, businessId: input.businessId },
          include: {
            allocations: {
              include: {
                settlement: {
                  include: { transactions: { include: { reversal: true } } },
                },
              },
            },
          },
        });
        if (payables.length !== ids.length)
          throw fail(
            "PAYABLE_NOT_FOUND",
            "One or more supplier payables were not found",
            404,
          );
        const amounts = new Map(
          input.allocations.map((row) => [row.payableId, new D(row.amount)]),
        );
        for (const payable of payables) {
          const paid = this.activeAllocated(payable.allocations);
          const outstanding = Prisma.Decimal.max(
            ZERO,
            payable.originalAmount.minus(payable.recoveryAmount).minus(paid),
          );
          if ((amounts.get(payable.id) ?? ZERO).gt(outstanding))
            throw fail(
              "SETTLEMENT_LIMIT_EXCEEDED",
              "Allocation exceeds a payable outstanding balance",
            );
        }
        const total = [...amounts.values()].reduce(
          (sum, amount) => sum.plus(amount),
          ZERO,
        );
        const at = this.now();
        const settlement = await tx.supplierSettlement.create({
          data: {
            reference: await nextReference(tx, "settlement_reference_seq", "SET", at),
            businessId: input.businessId,
            status: SettlementStatus.PAID,
            grossAmount: total,
            platformFee: ZERO,
            netPayable: total,
            currency: "BDT",
            paidAt: input.occurredAt,
            occurredAt: input.occurredAt,
            method: input.method,
            externalReference: input.externalReference,
            externalReferenceKey: externalKey(
              `supplier-payout:${input.businessId}`,
              input.method,
              input.externalReference,
            ),
            idempotencyKey: input.idempotencyKey,
            recordedByUserId: actor,
            notes: input.note,
            allocations: {
              create: input.allocations.map((row) => ({
                payableId: row.payableId,
                amount: new D(row.amount),
              })),
            },
          },
          include: { allocations: true },
        });
        const transaction = await tx.transaction.create({
          data: {
            reference: await nextReference(tx, "financial_reference_seq", "PAYOUT", at),
            type: TransactionType.SUPPLIER_PAYOUT,
            status: PaymentStatus.CAPTURED,
            businessId: input.businessId,
            settlementId: settlement.id,
            amount: total,
            currency: "BDT",
            method: input.method,
            externalReference: input.externalReference,
            externalReferenceKey: externalKey(
              `supplier-payout:${input.businessId}`,
              input.method,
              input.externalReference,
            ),
            occurredAt: input.occurredAt,
            processedAt: at,
            recordedByUserId: actor,
            idempotencyKey: `payout:${input.idempotencyKey}`,
            safeNote: input.note,
            description: "Externally completed supplier payout",
          },
        });
        for (const payable of payables) {
          const paid = this.activeAllocated(payable.allocations).plus(
            amounts.get(payable.id) ?? ZERO,
          );
          const effective = Prisma.Decimal.max(
            ZERO,
            payable.originalAmount.minus(payable.recoveryAmount),
          );
          await tx.supplierPayable.update({
            where: { id: payable.id },
            data: {
              status: paid.gte(effective)
                ? SupplierPayableStatus.PAID
                : SupplierPayableStatus.PARTIALLY_PAID,
            },
          });
        }
        await enqueueOutbox(tx, {
          eventType: "SUPPLIER_PAYOUT_RECORDED",
          aggregateType: "SUPPLIER_SETTLEMENT",
          aggregateId: settlement.id,
          eventKey: `settlement:${settlement.id}:paid`,
        });
        await recordAudit(tx, {
          actorUserId: actor,
          action: "FINANCE_SUPPLIER_PAYOUT_RECORDED",
          entityType: "SUPPLIER_SETTLEMENT",
          entityId: settlement.id,
          requestId,
          metadata: {
            businessId: input.businessId,
            transactionId: transaction.id,
            allocationCount: input.allocations.length,
            currency: "BDT",
          },
        });
        return { settlement: this.settlementView(settlement), duplicate: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw fail(
          "DUPLICATE_FINANCIAL_REFERENCE",
          "This payout reference was already recorded",
        );
      throw error;
    }
  }

  private activeAllocated(
    allocations: Array<{
      amount: Prisma.Decimal;
      settlement: { transactions: Array<{ reversal: unknown }> };
    }>,
  ) {
    return allocations
      .filter((allocation) =>
        allocation.settlement.transactions.some((entry) => !entry.reversal),
      )
      .reduce((sum, allocation) => sum.plus(allocation.amount), ZERO);
  }

  async reverseTransaction(
    id: string,
    reason: string,
    idempotencyKey: string,
    actor: string,
    requestId: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await lock(tx, `finance:transaction:${id}`);
      const duplicate = await tx.transaction.findUnique({ where: { idempotencyKey } });
      if (duplicate) return { transaction: safeTransaction(duplicate), duplicate: true };
      const original = await tx.transaction.findUnique({
        where: { id },
        include: { reversal: true },
      });
      if (!original)
        throw fail("TRANSACTION_NOT_FOUND", "Transaction was not found", 404);
      if (original.type === TransactionType.REVERSAL || original.reversal)
        throw fail("TRANSACTION_ALREADY_REVERSED", "Transaction is already reversed");
      const at = this.now();
      const reversal = await tx.transaction.create({
        data: {
          reference: await nextReference(tx, "financial_reference_seq", "REV", at),
          type: TransactionType.REVERSAL,
          status: PaymentStatus.CAPTURED,
          customerId: original.customerId,
          businessId: original.businessId,
          orderId: original.orderId,
          invoiceId: original.invoiceId,
          settlementId: original.settlementId,
          refundId: original.refundId,
          reversalOfId: original.id,
          amount: original.amount,
          currency: "BDT",
          occurredAt: at,
          processedAt: at,
          recordedByUserId: actor,
          idempotencyKey,
          description: `Correction of ${original.reference}`,
          safeNote: reason,
        },
      });
      if (original.invoiceId && original.type === TransactionType.CUSTOMER_PAYMENT) {
        await tx.invoice.update({
          where: { id: original.invoiceId },
          data: { status: InvoiceStatus.ISSUED, paidAt: null },
        });
      }
      if (original.refundId && original.type === TransactionType.REFUND) {
        await tx.refund.update({
          where: { id: original.refundId },
          data: { status: RefundStatus.APPROVED },
        });
      }
      if (original.settlementId && original.type === TransactionType.SUPPLIER_PAYOUT) {
        const allocations = await tx.settlementAllocation.findMany({
          where: { settlementId: original.settlementId },
          select: { payableId: true },
        });
        for (const allocation of allocations) {
          const payable = await tx.supplierPayable.findUniqueOrThrow({
            where: { id: allocation.payableId },
            include: {
              allocations: {
                include: {
                  settlement: {
                    include: {
                      transactions: { include: { reversal: true } },
                    },
                  },
                },
              },
            },
          });
          const paid = this.activeAllocated(payable.allocations);
          const effective = Prisma.Decimal.max(
            ZERO,
            payable.originalAmount.minus(payable.recoveryAmount),
          );
          await tx.supplierPayable.update({
            where: { id: payable.id },
            data: {
              status: payable.recoveryAmount.gt(0)
                ? SupplierPayableStatus.RECOVERY_DUE
                : paid.eq(0)
                  ? SupplierPayableStatus.OPEN
                  : paid.gte(effective)
                    ? SupplierPayableStatus.PAID
                    : SupplierPayableStatus.PARTIALLY_PAID,
            },
          });
        }
      }
      await enqueueOutbox(tx, {
        eventType: "FINANCIAL_ENTRY_REVERSED",
        aggregateType: "TRANSACTION",
        aggregateId: reversal.id,
        eventKey: `transaction:${original.id}:reversed`,
      });
      await recordAudit(tx, {
        actorUserId: actor,
        action: "FINANCE_TRANSACTION_REVERSED",
        entityType: "TRANSACTION",
        entityId: reversal.id,
        requestId,
        metadata: {
          originalTransactionId: original.id,
          originalType: original.type,
          currency: "BDT",
        },
      });
      return { transaction: safeTransaction(reversal), duplicate: false };
    });
  }

  async voidInvoice(id: string, reason: string, actor: string, requestId: string) {
    return this.database.$transaction(async (tx) => {
      await lock(tx, `finance:invoice-id:${id}`);
      const invoice = await tx.invoice.findUnique({
        where: { id },
        include: invoiceInclude,
      });
      if (!invoice) throw fail("INVOICE_NOT_FOUND", "Invoice was not found", 404);
      if (invoice.status === InvoiceStatus.VOID) return invoiceView(invoice);
      if (
        invoice.transactions.some(
          (entry) => entry.type === TransactionType.CUSTOMER_PAYMENT && !entry.reversal,
        )
      )
        throw fail(
          "INVOICE_HAS_RECEIPTS",
          "An invoice with receipts cannot be voided; use refunds or reversals",
        );
      const updated = await tx.invoice.update({
        where: { id },
        data: {
          status: InvoiceStatus.VOID,
          voidedAt: this.now(),
          voidedByUserId: actor,
          voidReason: reason,
        },
        include: invoiceInclude,
      });
      await recordAudit(tx, {
        actorUserId: actor,
        action: "FINANCE_INVOICE_VOIDED",
        entityType: "INVOICE",
        entityId: id,
        requestId,
        metadata: { orderId: invoice.orderId },
      });
      return invoiceView(updated);
    });
  }

  async listInvoices(input: InvoiceListInput, customerId?: string) {
    const where: Prisma.InvoiceWhereInput = {
      customerId,
      status: input.status,
      issuedAt: range(input.from, input.to),
    };
    const [rows, total] = await this.database.$transaction([
      this.database.invoice.findMany({
        where,
        include: invoiceInclude,
        orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
        ...pagination(input.page, input.pageSize),
      }),
      this.database.invoice.count({ where }),
    ]);
    return {
      items: rows.map(invoiceView),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async customerInvoices(userId: string, input: InvoiceListInput) {
    const customer = await this.database.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer)
      throw fail("CUSTOMER_NOT_FOUND", "Customer profile was not found", 404);
    return this.listInvoices(input, customer.id);
  }

  async getInvoice(id: string, userId?: string) {
    const row = await this.database.invoice.findFirst({
      where: { id, ...(userId ? { customer: { userId } } : {}) },
      include: invoiceInclude,
    });
    if (!row) throw fail("INVOICE_NOT_FOUND", "Invoice was not found", 404);
    return invoiceView(row);
  }

  async invoicePdf(id: string, userId?: string) {
    const row = await this.database.invoice.findFirst({
      where: { id, ...(userId ? { customer: { userId } } : {}) },
      include: invoiceInclude,
    });
    if (!row) throw fail("INVOICE_NOT_FOUND", "Invoice was not found", 404);
    const seller =
      row.sellerSnapshot &&
      typeof row.sellerSnapshot === "object" &&
      !Array.isArray(row.sellerSnapshot)
        ? (row.sellerSnapshot as Record<string, unknown>)
        : {};
    const lines = [
      String(seller.tradingName ?? seller.legalName ?? "PartsArc"),
      String(seller.address ?? ""),
      `Invoice: ${row.invoiceNumber}`,
      `Order: ${row.order?.orderNumber ?? "-"}`,
      `Issued: ${row.issuedAt?.toISOString() ?? "-"}`,
      "",
      ...row.items.map(
        (item) =>
          `${item.quantity} x ${item.description} @ BDT ${money(item.unitPrice)} = BDT ${money(item.lineTotal)}`,
      ),
      "",
      `Subtotal: BDT ${money(row.subtotal)}`,
      `Delivery: BDT ${money(row.deliveryCharge)}`,
      `Priority: BDT ${money(row.priorityCharge)}`,
      `Total: BDT ${money(row.total)}`,
      `Status: ${row.status}`,
      seller.developmentPlaceholder ? "DEVELOPMENT PLACEHOLDER BUSINESS IDENTITY" : "",
    ].filter(Boolean);
    return {
      filename: `${row.invoiceNumber}.pdf`,
      bytes: textPdf(`PartsArc INVOICE ${row.invoiceNumber}`, lines),
    };
  }

  async customerHistory(userId: string, input: FinanceListInput) {
    const customer = await this.database.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer)
      throw fail("CUSTOMER_NOT_FOUND", "Customer profile was not found", 404);
    return this.listTransactions(input, {
      customerId: customer.id,
      type: {
        in: [
          TransactionType.CUSTOMER_PAYMENT,
          TransactionType.REFUND,
          TransactionType.REVERSAL,
        ],
      },
    });
  }

  async listTransactions(
    input: FinanceListInput,
    extra: Prisma.TransactionWhereInput = {},
  ) {
    const where: Prisma.TransactionWhereInput = {
      ...extra,
      type: input.type ?? extra.type,
      status: input.status,
      orderId: input.orderId,
      businessId: input.businessId ?? extra.businessId,
      occurredAt: range(input.from, input.to),
    };
    const [rows, total] = await this.database.$transaction([
      this.database.transaction.findMany({
        where,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        ...pagination(input.page, input.pageSize),
      }),
      this.database.transaction.count({ where }),
    ]);
    return {
      items: rows.map(safeTransaction),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  private refundView(row: {
    id: string;
    orderId: string | null;
    status: RefundStatus;
    amount: Prisma.Decimal;
    currency: string;
    reason: string | null;
    approvedAt: Date | null;
    processedAt: Date | null;
    createdAt: Date;
  }) {
    return { ...row, amount: money(row.amount) };
  }

  private payableView(
    row: {
      id: string;
      orderId: string;
      businessId: string;
      status: SupplierPayableStatus;
      originalAmount: Prisma.Decimal;
      recoveryAmount: Prisma.Decimal;
      eligibleAt: Date;
    },
    paid: Prisma.Decimal,
  ) {
    return {
      id: row.id,
      orderId: row.orderId,
      businessId: row.businessId,
      status: row.status,
      originalAmount: money(row.originalAmount),
      recoveryAmount: money(row.recoveryAmount),
      paid: money(paid),
      outstanding: money(
        Prisma.Decimal.max(
          ZERO,
          row.originalAmount.minus(row.recoveryAmount).minus(paid),
        ),
      ),
      eligibleAt: row.eligibleAt,
    };
  }

  private settlementView(row: {
    id: string;
    reference: string | null;
    businessId: string;
    status: SettlementStatus;
    netPayable: Prisma.Decimal;
    currency: string;
    method: string | null;
    occurredAt: Date | null;
    paidAt: Date | null;
    allocations: Array<{ payableId: string; amount: Prisma.Decimal }>;
  }) {
    return {
      id: row.id,
      reference: row.reference,
      businessId: row.businessId,
      status: row.status,
      amount: money(row.netPayable),
      currency: row.currency,
      method: row.method,
      occurredAt: row.occurredAt,
      paidAt: row.paidAt,
      allocations: row.allocations.map((item) => ({
        payableId: item.payableId,
        amount: money(item.amount),
      })),
    };
  }

  async supplierStatement(businessId: string, from?: Date, to?: Date) {
    const payables = await this.database.supplierPayable.findMany({
      where: { businessId, eligibleAt: range(from, to) },
      include: {
        order: { select: { orderNumber: true } },
        allocations: {
          include: {
            settlement: { include: { transactions: { include: { reversal: true } } } },
          },
        },
      },
      orderBy: [{ eligibleAt: "desc" }, { id: "desc" }],
    });
    const rows = payables.map((row) => {
      const paid = this.activeAllocated(row.allocations);
      return { ...this.payableView(row, paid), orderNumber: row.order.orderNumber };
    });
    const totalPayable = rows.reduce(
      (sum, row) => sum.plus(row.originalAmount).minus(row.recoveryAmount),
      ZERO,
    );
    const totalPaid = rows.reduce((sum, row) => sum.plus(row.paid), ZERO);
    return {
      currency: "BDT",
      from: from ?? null,
      to: to ?? null,
      totalPayable: money(totalPayable),
      paid: money(totalPaid),
      outstanding: money(Prisma.Decimal.max(ZERO, totalPayable.minus(totalPaid))),
      items: rows,
    };
  }

  async supplierStatementPdf(businessId: string, from?: Date, to?: Date) {
    const business = await this.database.supplierBusiness.findUnique({
      where: { id: businessId },
      select: { displayName: true, businessCode: true },
    });
    if (!business)
      throw fail("BUSINESS_NOT_FOUND", "Supplier business was not found", 404);
    const statement = await this.supplierStatement(businessId, from, to);
    const lines = [
      business.displayName,
      `Business: ${business.businessCode ?? businessId}`,
      `Period: ${from?.toISOString() ?? "beginning"} to ${to?.toISOString() ?? "now"}`,
      ...statement.items.map(
        (item) =>
          `${item.orderNumber}: payable BDT ${item.originalAmount}, paid BDT ${item.paid}, outstanding BDT ${item.outstanding}`,
      ),
      `Total payable: BDT ${statement.totalPayable}`,
      `Paid: BDT ${statement.paid}`,
      `Outstanding: BDT ${statement.outstanding}`,
    ];
    return {
      filename: `statement-${business.businessCode ?? businessId}.pdf`,
      bytes: textPdf("PartsArc SUPPLIER STATEMENT", lines),
    };
  }

  async listRefunds(input: { page: number; pageSize: number }) {
    const [rows, total] = await this.database.$transaction([
      this.database.refund.findMany({
        select: {
          id: true,
          orderId: true,
          status: true,
          amount: true,
          currency: true,
          reason: true,
          approvedAt: true,
          processedAt: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...pagination(input.page, input.pageSize),
      }),
      this.database.refund.count(),
    ]);
    return {
      items: rows.map((row) => ({ ...row, amount: money(row.amount) })),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async listSettlements(input: { page: number; pageSize: number }) {
    const [rows, total] = await this.database.$transaction([
      this.database.supplierSettlement.findMany({
        include: { allocations: true },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        ...pagination(input.page, input.pageSize),
      }),
      this.database.supplierSettlement.count(),
    ]);
    return {
      items: rows.map((row) => this.settlementView(row)),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async supplierOverview(input: { page: number; pageSize: number; businessId?: string }) {
    const businessWhere = input.businessId ? { id: input.businessId } : undefined;
    const [businesses, total] = await this.database.$transaction([
      this.database.supplierBusiness.findMany({
        where: businessWhere,
        select: { id: true, businessCode: true, displayName: true },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
        ...pagination(input.page, input.pageSize),
      }),
      this.database.supplierBusiness.count({ where: businessWhere }),
    ]);
    return {
      items: await Promise.all(
        businesses.map(async (business) => ({
          business,
          ...(await this.supplierStatement(business.id)),
        })),
      ),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async updateConfig(
    input: {
      legalName: string;
      tradingName: string;
      address: string;
      phone?: string | null;
      email?: string | null;
      taxIdentifier?: string | null;
      isPlaceholder: boolean;
    },
    actor: string,
    requestId: string,
  ) {
    const config = await this.database.$transaction(async (tx) => {
      const row = await tx.platformBusinessConfig.upsert({
        where: { configKey: "default" },
        update: { ...input, updatedByUserId: actor },
        create: { ...input, updatedByUserId: actor },
      });
      await recordAudit(tx, {
        actorUserId: actor,
        action: "OPERATIONS_BUSINESS_CONFIG_UPDATED",
        entityType: "PLATFORM_BUSINESS_CONFIG",
        entityId: row.id,
        requestId,
        metadata: { placeholder: row.isPlaceholder },
      });
      return row;
    });
    return { ...config, updatedByUserId: undefined };
  }

  async getConfig() {
    return this.database.platformBusinessConfig.findUnique({
      where: { configKey: "default" },
      select: {
        legalName: true,
        tradingName: true,
        address: true,
        phone: true,
        email: true,
        taxIdentifier: true,
        isPlaceholder: true,
        updatedAt: true,
      },
    });
  }

  async dashboard(input: DashboardQueryInput) {
    const createdAt = range(input.from, input.to);
    const [
      requests,
      quotations,
      orders,
      openCancellations,
      openReturns,
      approvedRefunds,
      openCases,
      receipts,
      payouts,
      pendingPurchaseRequests,
      pendingRfqs,
      ordersAwaitingConfirmation,
      activeFulfillment,
      pendingWalletTopUps,
      creditBlockedRequests,
    ] = await this.database.$transaction([
      this.database.sourcingRequest.count({ where: { createdAt } }),
      this.database.quotation.count({ where: { createdAt } }),
      this.database.order.count({ where: { createdAt } }),
      this.database.orderCancellationRequest.count({
        where: { status: OrderCancellationStatus.PENDING, createdAt },
      }),
      this.database.orderReturn.count({
        where: {
          status: {
            in: [
              OrderReturnStatus.REQUESTED,
              OrderReturnStatus.APPROVED,
              OrderReturnStatus.RECEIVED,
            ],
          },
          createdAt,
        },
      }),
      this.database.refund.count({ where: { status: RefundStatus.APPROVED, createdAt } }),
      this.database.operationalCase.count({
        where: { status: { not: OperationalCaseStatus.RESOLVED }, createdAt },
      }),
      this.database.transaction.aggregate({
        where: {
          type: TransactionType.CUSTOMER_PAYMENT,
          occurredAt: createdAt,
          reversal: null,
        },
        _sum: { amount: true },
      }),
      this.database.transaction.aggregate({
        where: {
          type: TransactionType.SUPPLIER_PAYOUT,
          occurredAt: createdAt,
          reversal: null,
        },
        _sum: { amount: true },
      }),
      this.database.sourcingRequest.count({
        where: {
          requestType: "FIXED_PRICE_PURCHASE",
          status: { in: ["SUBMITTED", "MATCHING", "QUOTING", "AWAITING_CUSTOMER"] },
        },
      }),
      this.database.sourcingRequest.count({
        where: {
          requestType: "USED_PART_RFQ",
          status: { in: ["SUBMITTED", "MATCHING", "QUOTING", "AWAITING_CUSTOMER"] },
        },
      }),
      this.database.order.count({
        where: { status: OrderStatus.PENDING_SUPPLIER_CONFIRMATION },
      }),
      this.database.order.count({
        where: {
          status: {
            in: [
              OrderStatus.CONFIRMED,
              OrderStatus.SUPPLIER_PREPARING,
              OrderStatus.READY_FOR_PICKUP,
              OrderStatus.PICKED_UP,
              OrderStatus.IN_DELIVERY,
              OrderStatus.DELIVERED,
            ],
          },
        },
      }),
      this.database.walletTopUp.count({ where: { status: "PENDING" } }),
      this.database.sourcingRequest.count({
        where: { creditStatus: "AWAITING_CREDITS" },
      }),
    ]);
    return {
      range: { from: input.from, to: input.to, timezone: input.timezone },
      counts: {
        requests,
        quotations,
        orders,
        openCancellations,
        openReturns,
        approvedRefunds,
        openCases,
      },
      financial: {
        currency: "BDT",
        customerReceipts: money(receipts._sum.amount ?? ZERO),
        supplierPayouts: money(payouts._sum.amount ?? ZERO),
      },
      commerce: {
        pendingPurchaseRequests,
        pendingRfqs,
        ordersAwaitingConfirmation,
        activeFulfillment,
        pendingWalletTopUps,
        creditBlockedRequests,
        openDisputes: openCases,
      },
    };
  }

  async queue(input: QueueQueryInput) {
    const paging = pagination(input.page, input.pageSize);
    if (input.queue === "cancellations") {
      const where = { status: OrderCancellationStatus.PENDING };
      const [items, total] = await this.database.$transaction([
        this.database.orderCancellationRequest.findMany({
          where,
          select: { id: true, orderId: true, status: true, requestedAt: true },
          orderBy: { requestedAt: "asc" },
          ...paging,
        }),
        this.database.orderCancellationRequest.count({ where }),
      ]);
      return { items, total, page: input.page, pageSize: input.pageSize };
    }
    if (input.queue === "returns") {
      const where = {
        status: {
          in: [
            OrderReturnStatus.REQUESTED,
            OrderReturnStatus.APPROVED,
            OrderReturnStatus.RECEIVED,
          ],
        },
      };
      const [items, total] = await this.database.$transaction([
        this.database.orderReturn.findMany({
          where,
          select: {
            id: true,
            orderId: true,
            status: true,
            requestedAt: true,
            refundRequired: true,
          },
          orderBy: { requestedAt: "asc" },
          ...paging,
        }),
        this.database.orderReturn.count({ where }),
      ]);
      return { items, total, page: input.page, pageSize: input.pageSize };
    }
    if (input.queue === "refunds") {
      const where = {
        status: {
          in: [RefundStatus.REQUESTED, RefundStatus.APPROVED, RefundStatus.FAILED],
        },
      };
      const [items, total] = await this.database.$transaction([
        this.database.refund.findMany({
          where,
          select: {
            id: true,
            orderId: true,
            status: true,
            amount: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
          ...paging,
        }),
        this.database.refund.count({ where }),
      ]);
      return {
        items: items.map((item) => ({ ...item, amount: money(item.amount) })),
        total,
        page: input.page,
        pageSize: input.pageSize,
      };
    }
    if (input.queue === "deliveries") {
      const where = { status: { in: ["FAILED", "RETURNED"] as never[] } };
      const [items, total] = await this.database.$transaction([
        this.database.delivery.findMany({
          where,
          select: {
            id: true,
            orderId: true,
            status: true,
            failureReason: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "asc" },
          ...paging,
        }),
        this.database.delivery.count({ where }),
      ]);
      return { items, total, page: input.page, pageSize: input.pageSize };
    }
    if (input.queue === "orders") {
      const where = {
        status: { in: [OrderStatus.PENDING_SUPPLIER_CONFIRMATION, OrderStatus.FAILED] },
      };
      const [items, total] = await this.database.$transaction([
        this.database.order.findMany({
          where,
          select: { id: true, orderNumber: true, status: true, createdAt: true },
          orderBy: { createdAt: "asc" },
          ...paging,
        }),
        this.database.order.count({ where }),
      ]);
      return { items, total, page: input.page, pageSize: input.pageSize };
    }
    if (input.queue === "quotations") {
      const where: Prisma.QuotationWhereInput = {
        adminReviewStatus: "PENDING",
        status: "SUBMITTED",
      };
      const [items, total] = await this.database.$transaction([
        this.database.quotation.findMany({
          where,
          select: { id: true, quotationNumber: true, status: true, submittedAt: true },
          orderBy: { submittedAt: "asc" },
          ...paging,
        }),
        this.database.quotation.count({ where }),
      ]);
      return { items, total, page: input.page, pageSize: input.pageSize };
    }
    const where: Prisma.SourcingRequestWhereInput = { status: "SUBMITTED" };
    const [items, total] = await this.database.$transaction([
      this.database.sourcingRequest.findMany({
        where,
        select: { id: true, requestNumber: true, status: true, submittedAt: true },
        orderBy: { submittedAt: "asc" },
        ...paging,
      }),
      this.database.sourcingRequest.count({ where }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }

  async audits(input: AuditQueryInput) {
    const where: Prisma.AuditLogWhereInput = {
      action: input.action ? { contains: input.action, mode: "insensitive" } : undefined,
      entityType: input.entityType,
      actorUserId: input.actorUserId,
      entityId: input.entityId,
      createdAt: range(input.from, input.to),
    };
    const [items, total] = await this.database.$transaction([
      this.database.auditLog.findMany({
        where,
        select: {
          id: true,
          actorUserId: true,
          action: true,
          entityType: true,
          entityId: true,
          metadata: true,
          requestId: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...pagination(input.page, input.pageSize),
      }),
      this.database.auditLog.count({ where }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }

  async createCase(input: CreateCaseInput, actor: string, requestId: string) {
    return this.database.$transaction(async (tx) => {
      if (input.assignedToUserId) {
        const assignee = await tx.user.findFirst({
          where: {
            id: input.assignedToUserId,
            role: { in: ["ADMIN", "SUPER_ADMIN"] },
            accountStatus: "ACTIVE",
          },
          select: { id: true },
        });
        if (!assignee)
          throw fail(
            "INVALID_CASE_ASSIGNEE",
            "Case assignee must be an active administrator",
            400,
          );
      }
      const at = this.now();
      const row = await tx.operationalCase.create({
        data: {
          caseNumber: await nextReference(tx, "operational_case_number_seq", "CASE", at),
          type: input.type,
          title: input.title,
          orderId: input.orderId,
          businessId: input.businessId,
          assignedToUserId: input.assignedToUserId,
          history: {
            create: {
              toStatus: OperationalCaseStatus.OPEN,
              note: input.note,
              actorUserId: actor,
            },
          },
        },
        include: { history: true },
      });
      await recordAudit(tx, {
        actorUserId: actor,
        action: "OPERATIONS_CASE_CREATED",
        entityType: "OPERATIONAL_CASE",
        entityId: row.id,
        requestId,
        metadata: { type: row.type, orderId: row.orderId, businessId: row.businessId },
      });
      return row;
    });
  }

  async updateCase(id: string, input: UpdateCaseInput, actor: string, requestId: string) {
    return this.database.$transaction(async (tx) => {
      await lock(tx, `operations:case:${id}`);
      const row = await tx.operationalCase.findUnique({ where: { id } });
      if (!row) throw fail("CASE_NOT_FOUND", "Operational case was not found", 404);
      if (input.status === OperationalCaseStatus.RESOLVED && !input.resolution)
        throw fail(
          "CASE_RESOLUTION_REQUIRED",
          "A resolution is required to resolve a case",
          400,
        );
      const updated = await tx.operationalCase.update({
        where: { id },
        data: {
          status: input.status,
          assignedToUserId: input.assignedToUserId,
          resolution:
            input.status === OperationalCaseStatus.RESOLVED
              ? input.resolution
              : row.resolution,
          resolvedAt: input.status === OperationalCaseStatus.RESOLVED ? this.now() : null,
          history: {
            create: {
              fromStatus: row.status,
              toStatus: input.status,
              note: input.note,
              actorUserId: actor,
            },
          },
        },
        include: { history: { orderBy: { createdAt: "asc" } } },
      });
      await recordAudit(tx, {
        actorUserId: actor,
        action: "OPERATIONS_CASE_UPDATED",
        entityType: "OPERATIONAL_CASE",
        entityId: id,
        requestId,
        metadata: { fromStatus: row.status, toStatus: input.status },
      });
      return updated;
    });
  }

  async listCases(input: CaseListInput) {
    const where = { status: input.status, type: input.type };
    const [items, total] = await this.database.$transaction([
      this.database.operationalCase.findMany({
        where,
        include: { history: { orderBy: { createdAt: "asc" } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...pagination(input.page, input.pageSize),
      }),
      this.database.operationalCase.count({ where }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }

  async getCase(id: string) {
    const row = await this.database.operationalCase.findUnique({
      where: { id },
      include: {
        history: {
          include: {
            actorUser: { select: { id: true, fullName: true, role: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        assignedTo: { select: { id: true, fullName: true, role: true } },
        order: { select: { id: true, orderNumber: true, status: true } },
        business: { select: { id: true, businessCode: true, displayName: true } },
      },
    });
    if (!row) throw fail("CASE_NOT_FOUND", "Operational case was not found", 404);
    return row;
  }
}
