import { CreditRequirementStatus, SourcingRequestStatus } from "@prisma/client";
import { z } from "zod";

const id = z.string().uuid();

export const createPurchaseRequestSchema = z
  .object({
    listingId: id,
    quantity: z.number().int().min(1).max(999),
    deliveryAddressId: id,
    customerNote: z.string().trim().min(1).max(600).optional(),
    idempotencyKey: z.string().trim().min(8).max(120),
  })
  .strict();

export const purchaseRequestParamsSchema = z.object({ requestId: id });

export const supplierPurchaseRequestListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(SourcingRequestStatus).optional(),
  creditStatus: z.nativeEnum(CreditRequirementStatus).optional(),
});

export const confirmPurchaseRequestSchema = z
  .object({
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export type CreatePurchaseRequestInput = z.infer<typeof createPurchaseRequestSchema>;
export type SupplierPurchaseRequestList = z.infer<
  typeof supplierPurchaseRequestListSchema
>;
