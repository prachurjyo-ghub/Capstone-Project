import {
  OrderCancellationStatus,
  OrderReturnStatus,
  OrderStatus,
  UrgentEligibilityStatus,
} from "@prisma/client";
import { z } from "zod";

const id = z.string().uuid();
const reason = z.string().trim().min(3).max(500);
const optionalNote = z.string().trim().min(1).max(500).nullable().optional();
const date = z.coerce.date();

export const orderIdParamsSchema = z.object({ id });
export const acceptanceParamsSchema = z.object({ acceptanceId: id });
export const cancellationParamsSchema = z.object({ id, cancellationId: id });
export const returnParamsSchema = z.object({ id, returnId: id });

export const orderListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(OrderStatus).optional(),
  workflow: z
    .enum(["PENDING_CONFIRMATION", "IN_PROGRESS", "COMPLETED", "EXCEPTIONS"])
    .optional(),
  urgent: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export const conversionSchema = z
  .object({ idempotencyKey: z.string().trim().min(8).max(120) })
  .strict();

export const supplierAvailabilitySchema = z
  .object({ available: z.boolean(), note: optionalNote })
  .strict();

export const supplierTransitionSchema = z
  .object({
    toStatus: z.enum([OrderStatus.SUPPLIER_PREPARING, OrderStatus.READY_FOR_PICKUP]),
    note: optionalNote,
  })
  .strict();

export const adminTransitionSchema = z
  .object({
    toStatus: z.enum([
      OrderStatus.PICKED_UP,
      OrderStatus.IN_DELIVERY,
      OrderStatus.DELIVERED,
      OrderStatus.COMPLETED,
    ]),
    note: optionalNote,
    courierName: z.string().trim().min(2).max(120).nullable().optional(),
    courierPhone: z.string().trim().min(7).max(30).nullable().optional(),
    trackingReference: z.string().trim().min(2).max(120).nullable().optional(),
    pickupLocationId: id.nullable().optional(),
    scheduledPickupAt: date.nullable().optional(),
  })
  .strict();

export const cancellationRequestSchema = z.object({ reason }).strict();
export const cancellationDecisionSchema = z
  .object({
    decision: z.enum([
      OrderCancellationStatus.APPROVED,
      OrderCancellationStatus.REJECTED,
    ]),
    reason,
  })
  .strict();

export const failureSchema = z
  .object({
    code: z.string().trim().min(2).max(80),
    reason,
    releaseReservations: z.boolean().default(false),
  })
  .strict();

export const returnRequestSchema = z.object({ reason }).strict();
export const returnDecisionSchema = z
  .object({
    decision: z.enum([OrderReturnStatus.APPROVED, OrderReturnStatus.REJECTED]),
    reason,
    refundRequired: z.boolean().default(false),
  })
  .strict();
export const returnReceiptSchema = z.object({ note: optionalNote }).strict();
export const returnInspectionSchema = z
  .object({ note: reason, restock: z.boolean(), refundRequired: z.boolean() })
  .strict();

export const urgentEligibilitySchema = z
  .object({
    eligibility: z.enum([
      UrgentEligibilityStatus.ELIGIBLE,
      UrgentEligibilityStatus.UNAVAILABLE,
      UrgentEligibilityStatus.PENDING,
    ]),
    basis: reason,
    estimatedWindowStart: date.nullable().optional(),
    estimatedWindowEnd: date.nullable().optional(),
    targetDeadlineAt: date.nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.eligibility === UrgentEligibilityStatus.ELIGIBLE) {
      if (
        !value.estimatedWindowStart ||
        !value.estimatedWindowEnd ||
        !value.targetDeadlineAt
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Eligible urgent orders require an estimate window and target deadline",
        });
      if (
        value.estimatedWindowStart &&
        value.estimatedWindowEnd &&
        value.estimatedWindowEnd <= value.estimatedWindowStart
      )
        ctx.addIssue({
          code: "custom",
          path: ["estimatedWindowEnd"],
          message: "Estimate end must be after its start",
        });
    }
  });

export type OrderListInput = z.infer<typeof orderListSchema>;
export type AdminTransitionInput = z.infer<typeof adminTransitionSchema>;
export type SupplierTransitionInput = z.infer<typeof supplierTransitionSchema>;
export type UrgentEligibilityInput = z.infer<typeof urgentEligibilitySchema>;
