import {
  ConversationType,
  MessageSenderType,
  ParticipantType,
  Prisma,
  SupplierBusinessStatus,
  UserRole,
  type PrismaClient,
} from "@prisma/client";
import type { RequestAttachmentStorage } from "../requests/attachment-storage.js";
import { validateRequestImage } from "../requests/image-validation.js";
import { AppError } from "../../shared/errors/app-error.js";
import { enqueueOutbox } from "./outbox.service.js";
import type {
  ConversationListQuery,
  CreateConversationInput,
  MessageListQuery,
  NotificationListQuery,
  SendMessageInput,
} from "./communication.schemas.js";

type Actor = { id: string; role: UserRole; businessId?: string };
type ConversationSummary = {
  id: string;
  type: ConversationType;
  subject: string | null;
  isClosed: boolean;
  lastMessageAt: Date | null;
  createdAt: Date;
  request: { requestNumber: string } | null;
  quotation: { quotationNumber: string } | null;
  order: { orderNumber: string } | null;
  messages?: Array<{ body: string; sentAt: Date }>;
};
const notFound = () =>
  new AppError("Conversation was not found", { code: "NOT_FOUND", statusCode: 404 });

function participantType(role: UserRole): ParticipantType {
  if (role === UserRole.CUSTOMER) return ParticipantType.CUSTOMER;
  if (role === UserRole.SUPPLIER_OWNER || role === UserRole.SUPPLIER_STAFF)
    return ParticipantType.SUPPLIER;
  return ParticipantType.ADMIN;
}

function senderType(role: UserRole): MessageSenderType {
  if (role === UserRole.CUSTOMER) return MessageSenderType.CUSTOMER;
  if (role === UserRole.SUPPLIER_OWNER || role === UserRole.SUPPLIER_STAFF)
    return MessageSenderType.SUPPLIER;
  return MessageSenderType.ADMIN;
}

export class CommunicationService {
  constructor(
    private readonly database: PrismaClient,
    private readonly storage: RequestAttachmentStorage,
  ) {}

  private async resolveActor(userId: string, role: UserRole, businessId?: string) {
    if (role === UserRole.SUPPLIER_OWNER || role === UserRole.SUPPLIER_STAFF) {
      const memberships = await this.database.supplierUser.findMany({
        where: {
          userId,
          isActive: true,
          leftAt: null,
          business: { status: SupplierBusinessStatus.ACTIVE },
        },
        select: { businessId: true },
      });
      const selected = businessId
        ? memberships.find((item) => item.businessId === businessId)
        : memberships.length === 1
          ? memberships[0]
          : undefined;
      if (!selected)
        throw new AppError("Active supplier membership is required", {
          code: "SUPPLIER_ACCESS_RESTRICTED",
          statusCode: 403,
        });
      return { id: userId, role, businessId: selected.businessId } satisfies Actor;
    }
    return { id: userId, role } satisfies Actor;
  }

  private whereFor(actor: Actor): Prisma.ConversationWhereInput {
    if (actor.role === UserRole.CUSTOMER) return { customer: { userId: actor.id } };
    if (actor.role === UserRole.SUPPLIER_OWNER || actor.role === UserRole.SUPPLIER_STAFF)
      return { businessId: actor.businessId };
    return {};
  }

  private async authorize(actor: Actor, conversationId: string) {
    const conversation = await this.database.conversation.findFirst({
      where: { id: conversationId, ...this.whereFor(actor) },
      include: {
        request: { select: { requestNumber: true } },
        quotation: { select: { quotationNumber: true } },
        order: { select: { orderNumber: true } },
      },
    });
    if (!conversation) throw notFound();
    await this.database.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId, userId: actor.id } },
      update: { leftAt: null },
      create: {
        conversationId,
        userId: actor.id,
        participantType: participantType(actor.role),
      },
    });
    return conversation;
  }

  private async reference(input: CreateConversationInput) {
    if (input.requestId) {
      const request = await this.database.sourcingRequest.findUnique({
        where: { id: input.requestId },
        select: {
          id: true,
          requestNumber: true,
          customerId: true,
          customer: { select: { userId: true } },
          assignments: { select: { businessId: true } },
        },
      });
      if (!request) throw notFound();
      return {
        type: ConversationType.REQUEST,
        id: request.id,
        number: request.requestNumber,
        customerId: request.customerId,
        customerUserId: request.customer.userId,
        allowedBusinesses: request.assignments.map((item) => item.businessId),
      };
    }
    if (input.quotationId) {
      const quotation = await this.database.quotation.findUnique({
        where: { id: input.quotationId },
        select: {
          id: true,
          quotationNumber: true,
          businessId: true,
          request: {
            select: { customerId: true, customer: { select: { userId: true } } },
          },
        },
      });
      if (!quotation) throw notFound();
      return {
        type: ConversationType.QUOTATION,
        id: quotation.id,
        number: quotation.quotationNumber,
        customerId: quotation.request.customerId,
        customerUserId: quotation.request.customer.userId,
        allowedBusinesses: [quotation.businessId],
      };
    }
    const order = await this.database.order.findUnique({
      where: { id: input.orderId! },
      select: {
        id: true,
        orderNumber: true,
        customerId: true,
        businessId: true,
        customer: { select: { userId: true } },
      },
    });
    if (!order) throw notFound();
    return {
      type: ConversationType.ORDER,
      id: order.id,
      number: order.orderNumber,
      customerId: order.customerId,
      customerUserId: order.customer.userId,
      allowedBusinesses: [order.businessId],
    };
  }

  async ensureConversation(
    userId: string,
    role: UserRole,
    businessId: string | undefined,
    input: CreateConversationInput,
  ) {
    const actor = await this.resolveActor(userId, role, businessId);
    const reference = await this.reference(input);
    let audience: "CUSTOMER" | "SUPPLIER";
    let selectedBusiness: string | undefined;
    if (role === UserRole.CUSTOMER) {
      if (reference.customerUserId !== userId) throw notFound();
      audience = "CUSTOMER";
    } else if (role === UserRole.SUPPLIER_OWNER || role === UserRole.SUPPLIER_STAFF) {
      if (!actor.businessId || !reference.allowedBusinesses.includes(actor.businessId))
        throw notFound();
      audience = "SUPPLIER";
      selectedBusiness = actor.businessId;
    } else {
      audience = input.audience ?? "CUSTOMER";
      if (audience === "SUPPLIER") {
        selectedBusiness = input.businessId;
        if (!selectedBusiness || !reference.allowedBusinesses.includes(selectedBusiness))
          throw new AppError("A related supplier business is required", {
            code: "INVALID_CONVERSATION_SCOPE",
            statusCode: 400,
          });
      }
    }
    const scopeId = audience === "CUSTOMER" ? reference.customerId : selectedBusiness!;
    const scopeKey = `${reference.type}:${reference.id}:${audience}:${scopeId}`;
    const data = {
      scopeKey,
      type: reference.type,
      subject: input.subject ?? `${reference.number} support`,
      requestId: reference.type === ConversationType.REQUEST ? reference.id : undefined,
      quotationId:
        reference.type === ConversationType.QUOTATION ? reference.id : undefined,
      orderId: reference.type === ConversationType.ORDER ? reference.id : undefined,
      customerId: audience === "CUSTOMER" ? reference.customerId : undefined,
      businessId: audience === "SUPPLIER" ? selectedBusiness : undefined,
    };
    const conversation = await this.database.conversation.upsert({
      where: { scopeKey },
      update: {},
      create: data,
    });
    await this.database.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId: conversation.id, userId } },
      update: { leftAt: null },
      create: {
        conversationId: conversation.id,
        userId,
        participantType: participantType(role),
      },
    });
    return this.getConversation(userId, role, businessId, conversation.id);
  }

  async listConversations(
    userId: string,
    role: UserRole,
    businessId: string | undefined,
    query: ConversationListQuery,
  ) {
    const actor = await this.resolveActor(userId, role, businessId);
    const where = { ...this.whereFor(actor), type: query.type };
    const [items, total] = await this.database.$transaction([
      this.database.conversation.findMany({
        where,
        include: {
          request: { select: { requestNumber: true } },
          quotation: { select: { quotationNumber: true } },
          order: { select: { orderNumber: true } },
          messages: {
            where: { deletedAt: null },
            orderBy: [{ sentAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { body: true, sentAt: true },
          },
          participants: { where: { userId }, select: { lastReadAt: true } },
        },
        orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.conversation.count({ where }),
    ]);
    const serialized = await Promise.all(
      items.map(async (item) => {
        const lastReadAt = item.participants[0]?.lastReadAt;
        const unread = await this.database.message.count({
          where: {
            conversationId: item.id,
            deletedAt: null,
            senderUserId: { not: userId },
            ...(lastReadAt ? { sentAt: { gt: lastReadAt } } : {}),
          },
        });
        return this.serializeConversation(item, unread);
      }),
    );
    return { items: serialized, page: query.page, pageSize: query.pageSize, total };
  }

  private serializeConversation(item: ConversationSummary, unread = 0) {
    const reference =
      item.request?.requestNumber ??
      item.quotation?.quotationNumber ??
      item.order?.orderNumber;
    return {
      id: item.id,
      type: item.type,
      subject: item.subject,
      reference: reference ?? null,
      isClosed: item.isClosed,
      unreadCount: unread,
      preview: item.messages?.[0]?.body ?? null,
      lastMessageAt: item.lastMessageAt,
      createdAt: item.createdAt,
    };
  }

  async getConversation(
    userId: string,
    role: UserRole,
    businessId: string | undefined,
    id: string,
  ) {
    const actor = await this.resolveActor(userId, role, businessId);
    const item = await this.authorize(actor, id);
    return this.serializeConversation(item);
  }

  async listMessages(
    userId: string,
    role: UserRole,
    businessId: string | undefined,
    id: string,
    query: MessageListQuery,
  ) {
    const actor = await this.resolveActor(userId, role, businessId);
    await this.authorize(actor, id);
    let cursor: { sentAt: Date; id: string } | undefined;
    if (query.cursor) {
      const found = await this.database.message.findFirst({
        where: { id: query.cursor, conversationId: id },
        select: { sentAt: true, id: true },
      });
      if (!found) throw notFound();
      cursor = found;
    }
    const rows = await this.database.message.findMany({
      where: {
        conversationId: id,
        deletedAt: null,
        ...(cursor
          ? {
              OR: [
                { sentAt: { lt: cursor.sentAt } },
                { sentAt: cursor.sentAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: { attachments: { orderBy: { createdAt: "asc" } } },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take: query.pageSize + 1,
    });
    const hasMore = rows.length > query.pageSize;
    const items = rows.slice(0, query.pageSize).map((message) => ({
      id: message.id,
      senderType: message.senderType,
      mine: message.senderUserId === userId,
      body: message.body,
      sentAt: message.sentAt,
      attachments: message.attachments.map((attachment, index) => ({
        id: attachment.id,
        fileName:
          role === UserRole.CUSTOMER
            ? `attachment-${index + 1}.${attachment.mimeType === "image/png" ? "png" : "jpg"}`
            : attachment.fileName,
        mimeType: attachment.mimeType,
        byteSize: attachment.byteSize,
      })),
    }));
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  async sendMessage(
    userId: string,
    role: UserRole,
    businessId: string | undefined,
    id: string,
    input: SendMessageInput,
  ) {
    const actor = await this.resolveActor(userId, role, businessId);
    const conversation = await this.authorize(actor, id);
    if (conversation.isClosed)
      throw new AppError("Conversation is closed", {
        code: "CONVERSATION_CLOSED",
        statusCode: 409,
      });
    const existing = await this.database.message.findFirst({
      where: {
        conversationId: id,
        senderUserId: userId,
        idempotencyKey: input.idempotencyKey,
      },
      include: { attachments: true },
    });
    if (existing) return existing;
    try {
      return await this.database.$transaction(async (tx) => {
        const message = await tx.message.create({
          data: {
            conversationId: id,
            senderUserId: userId,
            senderType: senderType(role),
            idempotencyKey: input.idempotencyKey,
            body: input.body,
          },
          include: { attachments: true },
        });
        await tx.conversation.update({
          where: { id },
          data: { lastMessageAt: message.sentAt },
        });
        await tx.conversationParticipant.update({
          where: { conversationId_userId: { conversationId: id, userId } },
          data: { lastReadAt: message.sentAt, lastReadMessageId: message.id },
        });
        await enqueueOutbox(tx, {
          eventType: "MESSAGE_CREATED",
          aggregateType: "MESSAGE",
          aggregateId: message.id,
          eventKey: `message:${message.id}`,
          payload: { conversationId: id, senderUserId: userId },
        });
        return message;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const replay = await this.database.message.findFirst({
          where: {
            conversationId: id,
            senderUserId: userId,
            idempotencyKey: input.idempotencyKey,
          },
          include: { attachments: true },
        });
        if (replay) return replay;
      }
      throw error;
    }
  }

  async markRead(
    userId: string,
    role: UserRole,
    businessId: string | undefined,
    id: string,
    messageId?: string,
  ) {
    const actor = await this.resolveActor(userId, role, businessId);
    await this.authorize(actor, id);
    const message = messageId
      ? await this.database.message.findFirst({
          where: { id: messageId, conversationId: id },
        })
      : await this.database.message.findFirst({
          where: { conversationId: id },
          orderBy: [{ sentAt: "desc" }, { id: "desc" }],
        });
    if (messageId && !message) throw notFound();
    if (!message) return { readAt: null, messageId: null };
    await this.database.$executeRaw`
      UPDATE conversation_participants
      SET "lastReadAt" = GREATEST(COALESCE("lastReadAt", ${message.sentAt}), ${message.sentAt}),
          "lastReadMessageId" = CASE WHEN "lastReadAt" IS NULL OR "lastReadAt" <= ${message.sentAt} THEN ${message.id}::uuid ELSE "lastReadMessageId" END,
          "updatedAt" = NOW()
      WHERE "conversationId" = ${id}::uuid AND "userId" = ${userId}::uuid
    `;
    return { readAt: message.sentAt, messageId: message.id };
  }

  async uploadAttachment(
    userId: string,
    role: UserRole,
    businessId: string | undefined,
    conversationId: string,
    messageId: string,
    data: Buffer,
    fileName?: string,
  ) {
    const actor = await this.resolveActor(userId, role, businessId);
    await this.authorize(actor, conversationId);
    const message = await this.database.message.findFirst({
      where: { id: messageId, conversationId, senderUserId: userId, deletedAt: null },
      include: { _count: { select: { attachments: true } } },
    });
    if (!message) throw notFound();
    if (message._count.attachments >= 3)
      throw new AppError("A message may have at most 3 images", {
        code: "MESSAGE_ATTACHMENT_LIMIT",
        statusCode: 409,
      });
    const image = validateRequestImage(data, fileName);
    await this.storage.put(image);
    try {
      return await this.database.messageAttachment.create({
        data: {
          messageId,
          kind: "PHOTO",
          fileName: image.fileName,
          mimeType: image.mimeType,
          storageKey: image.storageKey,
          byteSize: image.byteSize,
          width: image.width,
          height: image.height,
          contentSha256: image.contentSha256,
        },
        select: { id: true, fileName: true, mimeType: true, byteSize: true },
      });
    } catch (error) {
      await this.storage.delete(image.storageKey);
      throw error;
    }
  }

  async readAttachment(
    userId: string,
    role: UserRole,
    businessId: string | undefined,
    conversationId: string,
    messageId: string,
    attachmentId: string,
  ) {
    const actor = await this.resolveActor(userId, role, businessId);
    await this.authorize(actor, conversationId);
    const attachment = await this.database.messageAttachment.findFirst({
      where: {
        id: attachmentId,
        messageId,
        message: { conversationId, deletedAt: null },
      },
    });
    if (!attachment) throw notFound();
    const opened = await this.storage.open(attachment.storageKey);
    return {
      ...attachment,
      fileName:
        role === UserRole.CUSTOMER
          ? `attachment.${attachment.mimeType === "image/png" ? "png" : "jpg"}`
          : attachment.fileName,
      stream: opened.stream,
      byteSize: opened.contentLength ?? attachment.byteSize,
    };
  }

  async listNotifications(userId: string, query: NotificationListQuery) {
    const where = {
      userId,
      channel: "IN_APP" as const,
      isRead: query.unreadOnly ? false : undefined,
    };
    const [items, total, unreadCount] = await this.database.$transaction([
      this.database.notification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          title: true,
          body: true,
          entityType: true,
          entityId: true,
          isRead: true,
          readAt: true,
          createdAt: true,
        },
      }),
      this.database.notification.count({ where }),
      this.database.notification.count({
        where: { userId, channel: "IN_APP", isRead: false },
      }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total, unreadCount };
  }

  async markNotificationRead(userId: string, id: string) {
    const result = await this.database.notification.updateMany({
      where: { id, userId, channel: "IN_APP" },
      data: { isRead: true, readAt: new Date() },
    });
    if (!result.count)
      throw new AppError("Notification was not found", {
        code: "NOT_FOUND",
        statusCode: 404,
      });
    return { id, isRead: true };
  }

  async markAllNotificationsRead(userId: string) {
    const now = new Date();
    const result = await this.database.notification.updateMany({
      where: { userId, channel: "IN_APP", isRead: false },
      data: { isRead: true, readAt: now },
    });
    return { updated: result.count, readAt: now };
  }
}
