import { AccountStatus } from "@prisma/client";
import { z } from "zod";

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Phone must use international E.164 format");

const editableProfileFields = {
  fullName: z.string().trim().min(2).max(120),
  preferredName: nullableText(80),
  companyName: nullableText(160),
} as const;

export const updateCustomerProfileSchema = z
  .object(editableProfileFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const addressParamsSchema = z.object({ addressId: z.string().uuid() });
export const vehicleParamsSchema = z.object({ vehicleId: z.string().uuid() });
export const adminCustomerParamsSchema = z.object({ userId: z.string().uuid() });

const addressFields = {
  label: nullableText(80).optional(),
  recipientName: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  addressLine: z.string().trim().min(5).max(250),
  addressLine2: nullableText(250).optional(),
  area: z.string().trim().min(2).max(100),
  city: z.string().trim().min(2).max(100),
  postalCode: nullableText(20).optional(),
  landmark: nullableText(180).optional(),
  deliveryInstructions: nullableText(500).optional(),
} as const;

export const createAddressSchema = z
  .object({ ...addressFields, isDefault: z.boolean().default(false) })
  .strict();

export const updateAddressSchema = z
  .object(addressFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const currentYear = new Date().getUTCFullYear();
const vehicleFields = {
  make: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(100),
  year: z
    .number()
    .int()
    .min(1900)
    .max(currentYear + 1)
    .nullable()
    .optional(),
  variant: nullableText(120).optional(),
  registrationNumber: nullableText(80).optional(),
  chassisVin: nullableText(100).optional(),
  engineInfo: nullableText(160).optional(),
  notes: nullableText(500).optional(),
} as const;

export const createVehicleSchema = z.object(vehicleFields).strict();
export const updateVehicleSchema = createVehicleSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const adminCustomerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.nativeEnum(AccountStatus).optional(),
});

export const suspendCustomerSchema = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();

export type UpdateCustomerProfileInput = z.infer<typeof updateCustomerProfileSchema>;
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
export type AdminCustomerListQuery = z.infer<typeof adminCustomerListQuerySchema>;
