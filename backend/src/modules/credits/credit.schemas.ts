import {
  CommissionReservationStatus,
  SupplierWalletStatus,
  WalletTopUpStatus,
} from "@prisma/client";
import { z } from "zod";

const id = z.string().uuid();
const idempotencyKey = z.string().trim().min(8).max(160);
const reason = z.string().trim().min(3).max(500);
const positiveMoney = z
  .string()
  .trim()
  .regex(
    /^\d{1,10}(?:\.\d{1,2})?$/,
    "Use a positive BDT amount with at most two decimals",
  )
  .refine((value) => Number(value) > 0, "Amount must be greater than zero");

export const idParams = z.object({ id });
export const businessParams = z.object({ businessId: id });
export const orderParams = z.object({ orderId: id });
export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const walletList = pagination.extend({
  status: z.nativeEnum(SupplierWalletStatus).optional(),
  search: z.string().trim().max(120).optional(),
});
export const topUpList = pagination.extend({
  status: z.nativeEnum(WalletTopUpStatus).optional(),
  businessId: id.optional(),
});
export const reservationList = pagination.extend({
  status: z.nativeEnum(CommissionReservationStatus).optional(),
  businessId: id.optional(),
});
export const policyInput = z
  .object({
    ratePercent: z.coerce.number().finite().min(0).max(100),
    reason,
  })
  .strict();
export const topUpInput = z
  .object({
    amount: positiveMoney,
    paymentMethod: z.string().trim().min(2).max(80),
    externalReference: z.string().trim().min(2).max(160),
    evidenceReference: z.string().trim().min(2).max(500).optional(),
    supplierNote: z.string().trim().min(1).max(500).optional(),
    idempotencyKey,
  })
  .strict();
export const topUpDecision = z
  .object({ decision: z.enum(["APPROVE", "REJECT"]), reason, idempotencyKey })
  .strict();
export const adjustmentInput = z
  .object({
    amount: z
      .string()
      .trim()
      .regex(
        /^-?\d{1,10}(?:\.\d{1,2})?$/,
        "Use a signed BDT amount with at most two decimals",
      )
      .refine((value) => Number(value) !== 0, "Adjustment cannot be zero"),
    reason,
    idempotencyKey,
  })
  .strict();
export const reversalInput = z.object({ reason, idempotencyKey }).strict();

export type PolicyInput = z.infer<typeof policyInput>;
export type TopUpInput = z.infer<typeof topUpInput>;
export type TopUpDecision = z.infer<typeof topUpDecision>;
export type AdjustmentInput = z.infer<typeof adjustmentInput>;
