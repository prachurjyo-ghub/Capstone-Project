import {
  CategoryRequestStatus,
  SupplierSubscriptionStatus,
  SubscriptionInvoiceStatus,
} from "@prisma/client";
import { z } from "zod";

const money = z.coerce.number().finite().min(0).max(100_000_000);
const page = z.coerce.number().int().min(1).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(20);
const idempotencyKey = z.string().trim().min(8).max(160);

export const idParams = z.object({ id: z.string().uuid() });
export const businessParams = z.object({ businessId: z.string().uuid() });
export const invoiceParams = z.object({ invoiceId: z.string().uuid() });
export const paymentParams = z.object({ paymentId: z.string().uuid() });

export const planInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    durationMonths: z.union([z.literal(1), z.literal(4), z.literal(12)]),
    price: money,
    isActive: z.boolean().default(true),
  })
  .strict();
export const planUpdate = planInput
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const listPlans = z.object({
  page,
  pageSize,
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});
export const listSubscriptions = z.object({
  page,
  pageSize,
  businessId: z.string().uuid().optional(),
  status: z.nativeEnum(SupplierSubscriptionStatus).optional(),
  expiringBefore: z.coerce.date().optional(),
});
export const listInvoices = z.object({
  page,
  pageSize,
  businessId: z.string().uuid().optional(),
  status: z.nativeEnum(SubscriptionInvoiceStatus).optional(),
});

export const issueInvoice = z
  .object({
    businessId: z.string().uuid(),
    planId: z.string().uuid(),
    dueAt: z.coerce.date(),
    idempotencyKey,
  })
  .strict();
export const recordPayment = z
  .object({
    amount: money.refine((value) => value > 0, "Amount must be positive"),
    method: z.string().trim().min(2).max(80),
    externalReference: z.string().trim().min(1).max(160).optional(),
    occurredAt: z.coerce.date(),
    safeNote: z.string().trim().min(1).max(500).optional(),
    idempotencyKey,
  })
  .strict();
export const reversePayment = z
  .object({ reason: z.string().trim().min(3).max(500), idempotencyKey })
  .strict();
export const reasonInput = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();
export const complimentaryGrant = z
  .object({
    businessId: z.string().uuid(),
    planId: z.string().uuid(),
    reason: z.string().trim().min(10).max(500),
    idempotencyKey,
  })
  .strict();

export const categoryRequestInput = z
  .object({
    proposedName: z.string().trim().min(2).max(120),
    proposedParentId: z.string().uuid().nullable().optional(),
    description: z.string().trim().min(2).max(1000).optional(),
    justification: z.string().trim().min(5).max(1000),
  })
  .strict();
export const categoryRequestList = z.object({
  page,
  pageSize,
  status: z.nativeEnum(CategoryRequestStatus).optional(),
  businessId: z.string().uuid().optional(),
});
export const categoryDecision = z
  .object({
    decision: z.enum(["APPROVE_CREATE", "APPROVE_EXISTING", "REJECT"]),
    existingCategoryId: z.string().uuid().optional(),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision === "APPROVE_EXISTING" && !value.existingCategoryId) {
      ctx.addIssue({
        code: "custom",
        path: ["existingCategoryId"],
        message: "Existing category is required",
      });
    }
    if (value.decision === "APPROVE_CREATE" && !value.slug) {
      ctx.addIssue({ code: "custom", path: ["slug"], message: "Slug is required" });
    }
  });

export type PlanInput = z.infer<typeof planInput>;
export type PlanUpdate = z.infer<typeof planUpdate>;
export type IssueInvoiceInput = z.infer<typeof issueInvoice>;
export type PaymentInput = z.infer<typeof recordPayment>;
export type ComplimentaryGrantInput = z.infer<typeof complimentaryGrant>;
export type CategoryRequestInput = z.infer<typeof categoryRequestInput>;
export type CategoryDecisionInput = z.infer<typeof categoryDecision>;
