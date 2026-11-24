import { z } from "zod";

const nullableText = (max: number) =>
  z.string().trim().min(1).max(max).nullable().optional();
const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase URL-safe slug");
const yearSchema = z.number().int().min(1900).max(2200);
const imagePathSchema = z
  .string()
  .trim()
  .regex(
    /^\/assets\/[a-zA-Z0-9/_-]+\.(?:avif|jpe?g|png|webp)$/,
    "Use a local raster image path below /assets",
  );

export const idParamsSchema = z.object({ id: z.string().uuid() });
export const productParamsSchema = z.object({ productId: z.string().uuid() });
export const productChildParamsSchema = z.object({
  productId: z.string().uuid(),
  childId: z.string().uuid(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export const catalogueProductQuerySchema = paginationSchema.extend({
  categoryId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  classification: z.enum(["NEW_GENUINE", "NEW_AFTERMARKET", "USED"]).optional(),
  make: z.string().trim().max(100).optional(),
  model: z.string().trim().max(100).optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
});

export const createCategorySchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: slugSchema,
    description: nullableText(1000),
    imagePath: imagePathSchema.nullable().optional(),
    parentId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .strict();

export const updateCategorySchema = createCategorySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const createBrandSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: slugSchema,
    isActive: z.boolean().default(true),
  })
  .strict();

export const updateBrandSchema = createBrandSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const productNumberSchema = z
  .object({
    partNumber: z.string().trim().min(1).max(120),
    isPrimary: z.boolean().default(false),
    manufacturer: nullableText(120),
    notes: nullableText(500),
  })
  .strict();

const compatibilityObjectSchema = z
  .object({
    make: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(100),
    yearFrom: yearSchema.nullable().optional(),
    yearTo: yearSchema.nullable().optional(),
    variant: nullableText(120),
    notes: nullableText(500),
  })
  .strict();

export const compatibilitySchema = compatibilityObjectSchema.refine(
  (value) =>
    value.yearFrom == null || value.yearTo == null || value.yearFrom <= value.yearTo,
  { message: "yearFrom must not be later than yearTo", path: ["yearTo"] },
);

export const createProductSchema = z
  .object({
    catalogueCode: z.string().trim().min(2).max(80).nullable().optional(),
    name: z.string().trim().min(2).max(200),
    description: nullableText(3000),
    imagePath: imagePathSchema.nullable().optional(),
    categoryId: z.string().uuid(),
    brandId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().default(true),
    numbers: z.array(productNumberSchema).min(1).max(50),
    compatibility: z.array(compatibilitySchema).max(100).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const normalized = value.numbers.map((item) => item.partNumber.toUpperCase());
    if (new Set(normalized).size !== normalized.length) {
      ctx.addIssue({
        code: "custom",
        path: ["numbers"],
        message: "Part numbers must be unique within a product",
      });
    }
    if (value.numbers.filter((item) => item.isPrimary).length !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["numbers"],
        message: "Exactly one primary part number is required",
      });
    }
  });

export const updateProductSchema = z
  .object({
    catalogueCode: z.string().trim().min(2).max(80).nullable().optional(),
    name: z.string().trim().min(2).max(200).optional(),
    description: nullableText(3000),
    imagePath: imagePathSchema.nullable().optional(),
    categoryId: z.string().uuid().optional(),
    brandId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const updateProductNumberSchema = productNumberSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");
export const updateCompatibilitySchema = compatibilityObjectSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export type PaginationQuery = z.infer<typeof paginationSchema>;
export type CatalogueProductQuery = z.infer<typeof catalogueProductQuerySchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateBrandInput = z.infer<typeof createBrandSchema>;
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductNumberInput = z.infer<typeof productNumberSchema>;
export type UpdateProductNumberInput = z.infer<typeof updateProductNumberSchema>;
export type CompatibilityInput = z.infer<typeof compatibilitySchema>;
export type UpdateCompatibilityInput = z.infer<typeof updateCompatibilitySchema>;
