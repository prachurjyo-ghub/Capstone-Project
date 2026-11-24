import { SupplierBusinessStatus } from "@prisma/client";
import { z } from "zod";
import { strongPasswordSchema } from "../auth/auth.schemas.js";

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Phone must use international E.164 format");
const optionalText = (max: number) =>
  z.string().trim().min(1).max(max).nullable().optional();
const uniqueTextList = z
  .array(z.string().trim().min(1).max(100))
  .max(100)
  .transform((values) => [...new Set(values)]);

export const businessIdParamsSchema = z.object({
  businessId: z.string().uuid(),
});

export const locationParamsSchema = z.object({
  businessId: z.string().uuid(),
  locationId: z.string().uuid(),
});

export const invitationParamsSchema = z.object({
  businessId: z.string().uuid(),
  invitationId: z.string().uuid(),
});

export const memberParamsSchema = z.object({
  businessId: z.string().uuid(),
  membershipId: z.string().uuid(),
});

export const createBusinessSchema = z
  .object({
    legalName: z.string().trim().min(2).max(200),
    displayName: z.string().trim().min(2).max(160),
    tradeLicense: optionalText(120),
    vatNumber: optionalText(120),
    email: emailSchema.nullable().optional(),
    phone: phoneSchema.nullable().optional(),
    serviceAreas: uniqueTextList.default([]),
  })
  .strict();

export const updateBusinessSchema = createBusinessSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const listBusinessQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(SupplierBusinessStatus).optional(),
  search: z.string().trim().max(120).optional(),
});

export const supportedCategoriesSchema = z
  .object({ categories: uniqueTextList })
  .strict();

export const createLocationSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    addressLine: z.string().trim().min(3).max(300),
    city: z.string().trim().min(2).max(100),
    area: optionalText(100),
    postalCode: optionalText(30),
    phone: phoneSchema.nullable().optional(),
    isPrimary: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .strict();

export const updateLocationSchema = createLocationSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const inviteOwnerSchema = z.object({ email: emailSchema }).strict();

export const createOwnerAccountSchema = z
  .object({
    email: emailSchema,
    fullName: z.string().trim().min(2).max(120),
    temporaryPassword: strongPasswordSchema,
    phone: phoneSchema.optional(),
  })
  .strict();

export const acceptInvitationSchema = z
  .object({
    token: z.string().min(32).max(512),
    fullName: z.string().trim().min(2).max(120),
    password: strongPasswordSchema,
  })
  .strict();

export const suspendBusinessSchema = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();

export const disableBusinessSchema = z
  .object({ reason: z.string().trim().min(3).max(500).optional() })
  .strict();

export const updateMemberAccountStatusSchema = z
  .object({
    status: z.enum(["ACTIVE", "SUSPENDED"]),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export const resetMemberTemporaryPasswordSchema = z
  .object({
    temporaryPassword: strongPasswordSchema,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;
export type ListBusinessQuery = z.infer<typeof listBusinessQuerySchema>;
export type SupportedCategoriesInput = z.infer<typeof supportedCategoriesSchema>;
export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type InviteOwnerInput = z.infer<typeof inviteOwnerSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
export type CreateOwnerAccountInput = z.infer<typeof createOwnerAccountSchema>;
export type UpdateMemberAccountStatusInput = z.infer<
  typeof updateMemberAccountStatusSchema
>;
export type ResetMemberTemporaryPasswordInput = z.infer<
  typeof resetMemberTemporaryPasswordSchema
>;
