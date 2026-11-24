import {
  RequestUrgency,
  SourcingRequestStatus,
  SourcingRequestType,
} from "@prisma/client";
import { z } from "zod";

const nullableText = (max: number) =>
  z.string().trim().min(1).max(max).nullable().optional();
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Phone must use international E.164 format");
const currentYear = new Date().getUTCFullYear();

export const requestParamsSchema = z.object({ requestId: z.string().uuid() });
export const requestItemParamsSchema = z.object({
  requestId: z.string().uuid(),
  itemId: z.string().uuid(),
});
export const requestAttachmentParamsSchema = z.object({
  requestId: z.string().uuid(),
  attachmentId: z.string().uuid(),
});

export const manualVehicleSchema = z
  .object({
    make: z.string().trim().max(80).default(""),
    model: z.string().trim().max(100).default(""),
    year: z
      .number()
      .int()
      .min(1900)
      .max(currentYear + 1)
      .nullable()
      .optional(),
    variant: nullableText(120),
    registrationNumber: nullableText(80),
    chassisVin: nullableText(100),
    engineInfo: nullableText(160),
  })
  .strict();

export const manualDeliverySchema = z
  .object({
    recipientName: z.string().trim().max(120).default(""),
    phone: z.union([phoneSchema, z.literal("")]).default(""),
    addressLine: z.string().trim().max(250).default(""),
    addressLine2: nullableText(250),
    area: z.string().trim().max(100).default(""),
    city: z.string().trim().max(100).default(""),
    postalCode: nullableText(20),
    landmark: nullableText(180),
    deliveryInstructions: nullableText(500),
  })
  .strict();

export const requestItemSchema = z
  .object({
    description: z.string().trim().max(600).default(""),
    partNumber: nullableText(120),
    productId: z.string().uuid().nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    quantity: z.number().int().min(1).max(999).default(1),
    customerNotes: nullableText(600),
  })
  .strict();

const requestFields = {
  title: nullableText(180),
  customerNotes: nullableText(1000),
  urgency: z.nativeEnum(RequestUrgency).default(RequestUrgency.STANDARD),
  neededByAt: z.coerce.date().nullable().optional(),
  vehicleId: z.string().uuid().nullable().optional(),
  manualVehicle: manualVehicleSchema.nullable().optional(),
  deliveryAddressId: z.string().uuid().nullable().optional(),
  manualDelivery: manualDeliverySchema.nullable().optional(),
} as const;

function exclusiveReferences(
  value: {
    vehicleId?: string | null;
    manualVehicle?: unknown;
    deliveryAddressId?: string | null;
    manualDelivery?: unknown;
  },
  ctx: z.RefinementCtx,
) {
  if (value.vehicleId && value.manualVehicle) {
    ctx.addIssue({
      code: "custom",
      path: ["manualVehicle"],
      message: "Choose a saved vehicle or manual vehicle details, not both",
    });
  }
  if (value.deliveryAddressId && value.manualDelivery) {
    ctx.addIssue({
      code: "custom",
      path: ["manualDelivery"],
      message: "Choose a saved address or manual delivery details, not both",
    });
  }
}

export const createRequestSchema = z
  .object({
    ...requestFields,
    requestType: z
      .enum([SourcingRequestType.CUSTOM_SOURCING, SourcingRequestType.USED_PART_RFQ])
      .default(SourcingRequestType.CUSTOM_SOURCING),
    listingId: z.string().uuid().nullable().optional(),
    items: z.array(requestItemSchema).max(50).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    exclusiveReferences(value, ctx);
    if (value.listingId && value.requestType !== SourcingRequestType.USED_PART_RFQ) {
      ctx.addIssue({
        code: "custom",
        path: ["listingId"],
        message: "A listing can be targeted only by a used-parts RFQ",
      });
    }
  });

export const updateRequestSchema = z
  .object(requestFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required")
  .superRefine(exclusiveReferences);

export const updateRequestItemSchema = requestItemSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const requestListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(SourcingRequestStatus).optional(),
  urgency: z.nativeEnum(RequestUrgency).optional(),
  requestType: z.nativeEnum(SourcingRequestType).optional(),
});

export const adminRequestListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z.nativeEnum(SourcingRequestStatus).optional(),
    urgency: z.nativeEnum(RequestUrgency).optional(),
    requestType: z.nativeEnum(SourcingRequestType).optional(),
    createdFrom: z.coerce.date().optional(),
    createdTo: z.coerce.date().optional(),
  })
  .refine((value) => value.status !== SourcingRequestStatus.DRAFT, {
    path: ["status"],
    message: "Admin operational lists do not include drafts",
  })
  .refine(
    (value) =>
      !value.createdFrom || !value.createdTo || value.createdFrom <= value.createdTo,
    { path: ["createdTo"], message: "createdTo must not be before createdFrom" },
  );

export const submitRequestSchema = z
  .object({ idempotencyKey: z.string().trim().min(8).max(120) })
  .strict();

export const cancelRequestSchema = z
  .object({ reason: z.string().trim().min(3).max(500).optional() })
  .strict();

export const attachmentQuerySchema = z.object({
  requestItemId: z.string().uuid().optional(),
});

export type CreateRequestInput = z.infer<typeof createRequestSchema>;
export type UpdateRequestInput = z.infer<typeof updateRequestSchema>;
export type RequestItemInput = z.infer<typeof requestItemSchema>;
export type UpdateRequestItemInput = z.infer<typeof updateRequestItemSchema>;
export type RequestListQuery = z.infer<typeof requestListQuerySchema>;
export type AdminRequestListQuery = z.infer<typeof adminRequestListQuerySchema>;
