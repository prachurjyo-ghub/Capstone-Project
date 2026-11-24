import {
  InvoiceStatus,
  OperationalCaseStatus,
  OperationalCaseType,
  OrderStatus,
  PaymentStatus,
  RefundStatus,
  SettlementStatus,
  TransactionType,
} from "@prisma/client";
import { z } from "zod";

const id = z.string().uuid();
const text = z.string().trim().min(1).max(500);
const reason = z.string().trim().min(3).max(500);
const money = z
  .string()
  .trim()
  .regex(
    /^\d{1,10}(?:\.\d{1,2})?$/,
    "Use a positive BDT amount with at most two decimals",
  )
  .refine((value) => Number(value) > 0, "Amount must be greater than zero");
const date = z.coerce.date();

export const idParams = z.object({ id });
export const orderParams = z.object({ orderId: id });
export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const financeList = pagination.extend({
  type: z.nativeEnum(TransactionType).optional(),
  status: z.nativeEnum(PaymentStatus).optional(),
  orderId: id.optional(),
  businessId: id.optional(),
  from: date.optional(),
  to: date.optional(),
});
export const invoiceList = pagination.extend({
  status: z.nativeEnum(InvoiceStatus).optional(),
  from: date.optional(),
  to: date.optional(),
});
export const issueInvoice = z.object({ dueAt: date.nullable().optional() }).strict();
export const paymentInput = z
  .object({
    amount: money,
    method: z.string().trim().min(2).max(80),
    externalReference: z.string().trim().min(2).max(160),
    occurredAt: date,
    idempotencyKey: z.string().trim().min(8).max(160),
    note: text.nullable().optional(),
  })
  .strict();
export const reversalInput = z
  .object({ reason, idempotencyKey: z.string().trim().min(8).max(160) })
  .strict();
export const refundApproval = z
  .object({
    amount: money,
    reason,
    idempotencyKey: z.string().trim().min(8).max(160),
  })
  .strict();
export const refundCompletion = z
  .object({
    method: z.string().trim().min(2).max(80),
    externalReference: z.string().trim().min(2).max(160),
    occurredAt: date,
    idempotencyKey: z.string().trim().min(8).max(160),
    note: text.nullable().optional(),
  })
  .strict();
export const voidInvoice = z.object({ reason }).strict();
export const settlementInput = z
  .object({
    businessId: id,
    allocations: z
      .array(z.object({ payableId: id, amount: money }).strict())
      .min(1)
      .max(100)
      .superRefine((rows, ctx) => {
        const ids = new Set<string>();
        rows.forEach((row, index) => {
          if (ids.has(row.payableId))
            ctx.addIssue({
              code: "custom",
              path: [index, "payableId"],
              message: "Duplicate payable allocation",
            });
          ids.add(row.payableId);
        });
      }),
    method: z.string().trim().min(2).max(80),
    externalReference: z.string().trim().min(2).max(160),
    occurredAt: date,
    idempotencyKey: z.string().trim().min(8).max(160),
    note: text.nullable().optional(),
  })
  .strict();
export const statementQuery = z.object({ from: date.optional(), to: date.optional() });
export const supplierOverviewQuery = pagination.extend({ businessId: id.optional() });
export const configInput = z
  .object({
    legalName: z.string().trim().min(2).max(160),
    tradingName: z.string().trim().min(2).max(160),
    address: z.string().trim().min(5).max(500),
    phone: z.string().trim().min(7).max(30).nullable().optional(),
    email: z.string().email().nullable().optional(),
    taxIdentifier: z.string().trim().min(2).max(80).nullable().optional(),
    isPlaceholder: z.boolean().default(false),
  })
  .strict();
export const auditQuery = pagination.extend({
  action: z.string().trim().max(120).optional(),
  entityType: z.string().trim().max(120).optional(),
  actorUserId: id.optional(),
  entityId: id.optional(),
  from: date.optional(),
  to: date.optional(),
});
export const dashboardQuery = z.object({
  from: date,
  to: date,
  timezone: z.string().trim().min(1).max(80),
});
export const queueQuery = pagination.extend({
  queue: z.enum([
    "requests",
    "quotations",
    "orders",
    "deliveries",
    "cancellations",
    "returns",
    "refunds",
  ]),
});
export const caseList = pagination.extend({
  status: z.nativeEnum(OperationalCaseStatus).optional(),
  type: z.nativeEnum(OperationalCaseType).optional(),
});
export const createCase = z
  .object({
    type: z.nativeEnum(OperationalCaseType),
    title: z.string().trim().min(3).max(200),
    orderId: id.optional(),
    businessId: id.optional(),
    assignedToUserId: id.optional(),
    note: reason,
  })
  .strict();
export const updateCase = z
  .object({
    status: z.nativeEnum(OperationalCaseStatus),
    assignedToUserId: id.nullable().optional(),
    note: reason,
    resolution: reason.nullable().optional(),
  })
  .strict();

export type PaymentInput = z.infer<typeof paymentInput>;
export type RefundApprovalInput = z.infer<typeof refundApproval>;
export type RefundCompletionInput = z.infer<typeof refundCompletion>;
export type SettlementInput = z.infer<typeof settlementInput>;
export type FinanceListInput = z.infer<typeof financeList>;
export type InvoiceListInput = z.infer<typeof invoiceList>;
export type AuditQueryInput = z.infer<typeof auditQuery>;
export type DashboardQueryInput = z.infer<typeof dashboardQuery>;
export type QueueQueryInput = z.infer<typeof queueQuery>;
export type CaseListInput = z.infer<typeof caseList>;
export type CreateCaseInput = z.infer<typeof createCase>;
export type UpdateCaseInput = z.infer<typeof updateCase>;

void OrderStatus;
void RefundStatus;
void SettlementStatus;
