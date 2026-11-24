import {
  InventoryAvailability,
  ListingModerationStatus,
  ListingPublicationStatus,
  ProductCondition,
  SupplierListingClassification,
} from "@prisma/client";
import { z } from "zod";

const moneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,10}(?:\.\d{1,2})?$/, "Use a nonnegative amount with at most 2 decimals")
  .refine((value) => Number(value) <= 9_999_999_999.99, "Amount is too large");
const nullableText = (max: number) =>
  z.string().trim().min(1).max(max).nullable().optional();
const skuSchema = z.string().trim().min(1).max(120);
const quantitySchema = z.number().int().min(0).max(1_000_000_000);

export const inventoryParamsSchema = z.object({ inventoryId: z.string().uuid() });
export const inventoryImageParamsSchema = inventoryParamsSchema.extend({
  imageId: z.string().uuid(),
});
export const publicListingImageParamsSchema = z.object({
  imageId: z.string().uuid(),
  version: z.string().regex(/^v[1-9]\d*$/),
});
export const imageOrderSchema = z
  .object({ imageIds: z.array(z.string().uuid()).min(1).max(4) })
  .strict();

export const inventoryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  condition: z.nativeEnum(ProductCondition).optional(),
  availability: z.nativeEnum(InventoryAvailability).optional(),
  stockState: z.enum(["available", "low_stock", "out_of_stock"]).optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  classification: z.nativeEnum(SupplierListingClassification).optional(),
  publicationStatus: z.nativeEnum(ListingPublicationStatus).optional(),
});

export const createInventorySchema = z
  .object({
    productId: z.string().uuid(),
    sku: skuSchema,
    unitPrice: moneySchema,
    condition: z.nativeEnum(ProductCondition).default(ProductCondition.NEW),
    listingClassification: z.nativeEnum(SupplierListingClassification).optional(),
    publicationStatus: z
      .nativeEnum(ListingPublicationStatus)
      .default(ListingPublicationStatus.DRAFT),
    stockQuantity: quantitySchema.default(0),
    minimumStock: quantitySchema.default(0),
    preparationTimeMin: z.number().int().min(0).max(525_600).nullable().optional(),
    isAvailable: z.boolean().default(true),
    notes: nullableText(1000),
  })
  .strict();

export const updateInventorySchema = z
  .object({
    sku: skuSchema.optional(),
    unitPrice: moneySchema.optional(),
    condition: z.nativeEnum(ProductCondition).optional(),
    listingClassification: z.nativeEnum(SupplierListingClassification).optional(),
    publicationStatus: z.nativeEnum(ListingPublicationStatus).optional(),
    minimumStock: quantitySchema.optional(),
    preparationTimeMin: z.number().int().min(0).max(525_600).nullable().optional(),
    isAvailable: z.boolean().optional(),
    notes: nullableText(1000),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const stockAdjustmentSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(120),
    quantityDelta: z.number().int().min(-1_000_000_000).max(1_000_000_000),
    reason: z.string().trim().min(3).max(300),
  })
  .strict()
  .refine((value) => value.quantityDelta !== 0, {
    message: "quantityDelta must not be zero",
    path: ["quantityDelta"],
  });

const bulkItemSchema = z
  .object({
    inventoryId: z.string().uuid(),
    version: z.number().int().min(0),
    sku: skuSchema.optional(),
    unitPrice: moneySchema.optional(),
    condition: z.nativeEnum(ProductCondition).optional(),
    stockQuantity: quantitySchema.optional(),
    stockReason: z.string().trim().min(3).max(300).optional(),
    minimumStock: quantitySchema.optional(),
    preparationTimeMin: z.number().int().min(0).max(525_600).nullable().optional(),
    isAvailable: z.boolean().optional(),
    notes: nullableText(1000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const editable = Object.keys(value).filter(
      (key) => !["inventoryId", "version", "stockReason"].includes(key),
    );
    if (editable.length === 0) {
      ctx.addIssue({ code: "custom", message: "At least one update field is required" });
    }
    if (value.stockQuantity !== undefined && !value.stockReason) {
      ctx.addIssue({
        code: "custom",
        path: ["stockReason"],
        message: "stockReason is required when setting absolute stock",
      });
    }
    if (value.stockQuantity === undefined && value.stockReason !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["stockReason"],
        message: "stockReason is only valid with stockQuantity",
      });
    }
  });

export const bulkInventorySchema = z
  .object({
    operationId: z.string().trim().min(8).max(80),
    items: z.array(bulkItemSchema).min(1).max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = value.items.map((item) => item.inventoryId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "Each inventory offering may appear only once",
      });
    }
  });

export const csvConfirmationSchema = z.object({ previewId: z.string().uuid() }).strict();

export const adminInventoryListSchema = inventoryListQuerySchema.extend({
  businessId: z.string().uuid().optional(),
  moderationStatus: z.nativeEnum(ListingModerationStatus).optional(),
});

export const moderationSchema = z
  .object({
    status: z.enum(["APPROVED", "FLAGGED", "REJECTED"]),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;
export type CreateInventoryInput = z.infer<typeof createInventorySchema>;
export type UpdateInventoryInput = z.infer<typeof updateInventorySchema>;
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
export type BulkInventoryInput = z.infer<typeof bulkInventorySchema>;
