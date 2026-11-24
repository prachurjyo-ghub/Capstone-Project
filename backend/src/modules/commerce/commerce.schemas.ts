import { ProductCondition, QuotationStatus, SourcingOptionStatus } from "@prisma/client";
import { z } from "zod";

const money = z
  .union([z.string(), z.number()])
  .transform(String)
  .pipe(
    z
      .string()
      .regex(
        /^\d{1,10}(\.\d{1,2})?$/,
        "Use a nonnegative amount with at most two decimals",
      ),
  );
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const idParamsSchema = z.object({ id: z.string().uuid() });
export const requestIdParamsSchema = z.object({ requestId: z.string().uuid() });
export const quotationClarificationParamsSchema = z.object({
  id: z.string().uuid(),
  clarificationId: z.string().uuid(),
});
export const optionClarificationParamsSchema = z.object({
  id: z.string().uuid(),
  clarificationId: z.string().uuid(),
});

export const quotationLineSchema = z
  .object({
    requestItemId: z.string().uuid(),
    productId: z.string().uuid().nullable().optional(),
    inventoryId: z.string().uuid().nullable().optional(),
    alternativeToLineNumber: z.number().int().positive().nullable().optional(),
    description: text(2, 500),
    brand: optionalText(120),
    partNumber: optionalText(120),
    condition: z.nativeEnum(ProductCondition),
    quantity: z.number().int().positive().max(100000),
    supplierUnitPrice: money,
    compatibilityNotes: optionalText(1000),
    alternativePartInfo: optionalText(1000),
  })
  .strict();

const quotationFields = {
  preparationTimeMin: z.number().int().min(0).max(525600).nullable().optional(),
  deliveryEstimateText: optionalText(500),
  compatibilityNotes: optionalText(2000),
  supplierNotes: optionalText(2000),
  validUntil: z.coerce.date(),
  items: z.array(quotationLineSchema).min(1).max(100),
};
const refineAlternatives = (
  value: { items: Array<{ alternativeToLineNumber?: number | null }> },
  ctx: z.RefinementCtx,
) => {
  value.items.forEach((item, index) => {
    if (
      item.alternativeToLineNumber &&
      item.alternativeToLineNumber > value.items.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["items", index, "alternativeToLineNumber"],
        message: "Primary line does not exist",
      });
    }
    if (item.alternativeToLineNumber === index + 1) {
      ctx.addIssue({
        code: "custom",
        path: ["items", index, "alternativeToLineNumber"],
        message: "A line cannot be its own alternative",
      });
    }
  });
};

export const quotationWriteSchema = z
  .object({ assignmentId: z.string().uuid(), ...quotationFields })
  .strict()
  .superRefine(refineAlternatives);
export const quotationUpdateSchema = z
  .object(quotationFields)
  .strict()
  .superRefine(refineAlternatives);
export const submitQuotationSchema = z.object({ idempotencyKey: text(8, 100) }).strict();
export const withdrawSchema = z.object({ reason: text(3, 500) }).strict();
export const clarificationSchema = z.object({ question: text(3, 1000) }).strict();
export const clarificationReplySchema = z.object({ reply: text(1, 2000) }).strict();
export const rejectionSchema = z.object({ reason: text(3, 1000) }).strict();

export const quotationListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(QuotationStatus).optional(),
});

export const prepareOptionSchema = z
  .object({
    quotationId: z.string().uuid(),
    quotationItemIds: z.array(z.string().uuid()).min(1).max(100),
    platformMargin: money,
    deliveryCharge: money.default("0"),
    priorityCharge: money.default("0"),
    validUntil: z.coerce.date(),
    customerNotes: optionalText(1000),
    internalNotes: optionalText(2000),
    supersedesOptionId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.quotationItemIds).size !== value.quotationItemIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["quotationItemIds"],
        message: "Quotation items must be unique",
      });
    }
  });

export const publishOptionSchema = z
  .object({ expectedVersion: z.number().int().min(0) })
  .strict();
export const customerOptionListSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z.nativeEnum(SourcingOptionStatus).optional(),
  })
  .refine((value) => value.status !== SourcingOptionStatus.DRAFT, {
    path: ["status"],
    message: "Draft options are not customer-visible",
  });
export const customerOptionBatchSchema = z
  .object({
    requestIds: z
      .string()
      .min(1)
      .transform((value) => value.split(",").filter(Boolean))
      .pipe(z.array(z.string().uuid()).min(1).max(100)),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(100),
  })
  .strict();
const manualDeliverySchema = z
  .object({
    recipientName: text(2, 120),
    phone: text(5, 30),
    addressLine: text(3, 250),
    addressLine2: optionalText(250),
    area: text(2, 120),
    city: text(2, 120),
    postalCode: optionalText(30),
    landmark: optionalText(250),
    deliveryInstructions: optionalText(500),
  })
  .strict();
export const acceptOptionSchema = z
  .object({
    idempotencyKey: text(8, 100),
    expectedVersion: z.number().int().min(0),
    deliveryAddressId: z.string().uuid().optional(),
    manualDelivery: manualDeliverySchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      Number(Boolean(value.deliveryAddressId)) + Number(Boolean(value.manualDelivery)) ===
      1,
    {
      message: "Provide exactly one saved or manual delivery address",
    },
  );

export type QuotationWriteInput = z.infer<typeof quotationWriteSchema>;
export type PrepareOptionInput = z.infer<typeof prepareOptionSchema>;
export type AcceptOptionInput = z.infer<typeof acceptOptionSchema>;
