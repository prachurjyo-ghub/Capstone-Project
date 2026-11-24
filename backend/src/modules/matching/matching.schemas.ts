import { RequestUrgency, SupplierAssignmentStatus } from "@prisma/client";
import { z } from "zod";

export const matchingRequestParamsSchema = z.object({
  requestId: z.string().uuid(),
});

export const assignmentParamsSchema = z.object({
  requestId: z.string().uuid(),
  assignmentId: z.string().uuid(),
});

export const clarificationParamsSchema = z.object({
  requestId: z.string().uuid(),
  assignmentId: z.string().uuid(),
  clarificationId: z.string().uuid(),
});

export const supplierAssignmentParamsSchema = z.object({
  assignmentId: z.string().uuid(),
});

export const supplierAttachmentParamsSchema = z.object({
  assignmentId: z.string().uuid(),
  attachmentId: z.string().uuid(),
});

const assignmentTargetSchema = z
  .object({
    businessId: z.string().uuid(),
    overrideReason: z.string().trim().min(3).max(500).optional(),
  })
  .strict();

export const distributeRequestSchema = z
  .object({
    responseDeadlineAt: z.coerce.date(),
    suppliers: z.array(assignmentTargetSchema).min(1).max(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.suppliers.forEach((supplier, index) => {
      if (seen.has(supplier.businessId)) {
        ctx.addIssue({
          code: "custom",
          path: ["suppliers", index, "businessId"],
          message: "Each supplier business may appear only once",
        });
      }
      seen.add(supplier.businessId);
    });
  });

export const changeDeadlineSchema = z
  .object({ responseDeadlineAt: z.coerce.date() })
  .strict();

export const withdrawAssignmentSchema = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();

export const supplierInboxQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(SupplierAssignmentStatus).optional(),
  urgency: z.nativeEnum(RequestUrgency).optional(),
});

export const skipAssignmentSchema = z
  .object({ reason: z.string().trim().min(3).max(500).optional() })
  .strict();

export const askClarificationSchema = z
  .object({ question: z.string().trim().min(3).max(1000) })
  .strict();

export const replyClarificationSchema = z
  .object({ reply: z.string().trim().min(1).max(2000) })
  .strict();

export type DistributeRequestInput = z.infer<typeof distributeRequestSchema>;
export type SupplierInboxQuery = z.infer<typeof supplierInboxQuerySchema>;
