import { z } from "zod";

const uuid = z.string().uuid();

export const conversationIdSchema = z.object({ id: uuid }).strict();
export const messageParamsSchema = z.object({ id: uuid, messageId: uuid }).strict();
export const attachmentParamsSchema = z
  .object({ id: uuid, messageId: uuid, attachmentId: uuid })
  .strict();

export const conversationListSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    type: z.enum(["REQUEST", "QUOTATION", "ORDER", "SUPPORT", "GENERAL"]).optional(),
  })
  .strict();

export const messageListSchema = z
  .object({
    cursor: uuid.optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();

export const createConversationSchema = z
  .object({
    requestId: uuid.optional(),
    quotationId: uuid.optional(),
    orderId: uuid.optional(),
    subject: z.string().trim().min(3).max(160).optional(),
    audience: z.enum(["CUSTOMER", "SUPPLIER"]).optional(),
    businessId: uuid.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const references = [value.requestId, value.quotationId, value.orderId].filter(
      Boolean,
    );
    if (references.length !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["requestId"],
        message: "Provide exactly one requestId, quotationId, or orderId",
      });
    }
  });

export const sendMessageSchema = z
  .object({
    body: z.string().trim().min(1).max(4000),
    idempotencyKey: z.string().trim().min(8).max(120),
  })
  .strict();

export const markReadSchema = z.object({ messageId: uuid.optional() }).strict();

export const notificationListSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    unreadOnly: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
  })
  .strict();

export type ConversationListQuery = z.infer<typeof conversationListSchema>;
export type MessageListQuery = z.infer<typeof messageListSchema>;
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type NotificationListQuery = z.infer<typeof notificationListSchema>;
