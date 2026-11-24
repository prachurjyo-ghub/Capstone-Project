import {
  AccountStatus,
  NotificationChannel,
  NotificationDeliveryStatus,
  OutboxStatus,
  SupplierBusinessStatus,
  UserRole,
  type OutboxEvent,
  type PrismaClient,
} from "@prisma/client";
import type { Env } from "../../config/env.js";
import type { NotificationDeliveryProvider } from "./notification-delivery.js";

type Recipient = { id: string; email: string; phone: string | null };
type Projection = {
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  recipients: Recipient[];
};

async function activeAdmins(database: PrismaClient) {
  return database.user.findMany({
    where: {
      role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
      accountStatus: AccountStatus.ACTIVE,
    },
    select: { id: true, email: true, phone: true },
  });
}

async function businessUsers(database: PrismaClient, businessId: string) {
  const memberships = await database.supplierUser.findMany({
    where: {
      businessId,
      isActive: true,
      leftAt: null,
      business: { status: SupplierBusinessStatus.ACTIVE },
      user: { accountStatus: AccountStatus.ACTIVE },
    },
    select: { user: { select: { id: true, email: true, phone: true } } },
  });
  return memberships.map((item) => item.user);
}

async function project(
  database: PrismaClient,
  event: OutboxEvent,
): Promise<Projection | null> {
  if (event.eventType === "MESSAGE_CREATED") {
    const message = await database.message.findUnique({
      where: { id: event.aggregateId },
      include: {
        senderUser: { select: { role: true } },
        conversation: {
          include: {
            customer: {
              select: { user: { select: { id: true, email: true, phone: true } } },
            },
          },
        },
      },
    });
    if (!message) return null;
    const senderIsOperations =
      message.senderUser?.role === UserRole.ADMIN ||
      message.senderUser?.role === UserRole.SUPER_ADMIN;
    let recipients: Recipient[];
    if (senderIsOperations && message.conversation.customer) {
      recipients = [message.conversation.customer.user];
    } else if (senderIsOperations && message.conversation.businessId) {
      recipients = await businessUsers(database, message.conversation.businessId);
    } else {
      recipients = await activeAdmins(database);
    }
    return {
      title: "New operations message",
      body: "A new message is available in your PartsArc conversation.",
      entityType: "CONVERSATION",
      entityId: message.conversationId,
      recipients: recipients.filter((item) => item.id !== message.senderUserId),
    };
  }

  if (
    event.eventType === "SUPPLIER_ASSIGNMENT_CREATED" ||
    event.eventType === "SUPPLIER_ASSIGNMENT_REMINDER"
  ) {
    const assignment = await database.supplierRequestAssignment.findUnique({
      where: { id: event.aggregateId },
      select: { businessId: true },
    });
    if (!assignment) return null;
    return {
      title:
        event.eventType === "SUPPLIER_ASSIGNMENT_CREATED"
          ? "New sourcing request"
          : "Sourcing response deadline approaching",
      body:
        event.eventType === "SUPPLIER_ASSIGNMENT_CREATED"
          ? "Operations assigned a sourcing request to your business."
          : "An assigned sourcing request is awaiting your response.",
      entityType: "SUPPLIER_ASSIGNMENT",
      entityId: assignment.businessId,
      recipients: await businessUsers(database, assignment.businessId),
    };
  }

  if (
    event.eventType === "PURCHASE_REQUEST_CREATED" ||
    event.eventType === "RFQ_RECEIVED"
  ) {
    const request = await database.sourcingRequest.findUnique({
      where: { id: event.aggregateId },
      select: { targetBusinessId: true },
    });
    if (!request?.targetBusinessId) return null;
    return {
      title:
        event.eventType === "PURCHASE_REQUEST_CREATED"
          ? "New purchase request"
          : "New used-parts RFQ",
      body:
        event.eventType === "PURCHASE_REQUEST_CREATED"
          ? "A customer requested an advertised fixed-price listing. Review availability and commission-credit eligibility."
          : "A customer requested a quotation for a used-parts listing.",
      entityType: "SOURCING_REQUEST",
      entityId: event.aggregateId,
      recipients: await businessUsers(database, request.targetBusinessId),
    };
  }

  if (
    event.eventType === "WALLET_TOP_UP_SUBMITTED" ||
    event.eventType === "WALLET_TOP_UP_APPROVED" ||
    event.eventType === "WALLET_TOP_UP_REJECTED"
  ) {
    const topUp = await database.walletTopUp.findUnique({
      where: { id: event.aggregateId },
      select: { businessId: true },
    });
    if (!topUp) return null;
    const submitted = event.eventType === "WALLET_TOP_UP_SUBMITTED";
    return {
      title: submitted
        ? "Supplier top-up awaiting verification"
        : event.eventType === "WALLET_TOP_UP_APPROVED"
          ? "Credit top-up approved"
          : "Credit top-up rejected",
      body: submitted
        ? "A supplier submitted external payment evidence for wallet verification."
        : event.eventType === "WALLET_TOP_UP_APPROVED"
          ? "Verified credits are now available in your supplier wallet."
          : "Operations rejected a submitted wallet top-up. Review the decision note.",
      entityType: "WALLET_TOP_UP",
      entityId: event.aggregateId,
      recipients: submitted
        ? await activeAdmins(database)
        : await businessUsers(database, topUp.businessId),
    };
  }

  if (
    event.eventType === "SUPPLIER_CLARIFICATION_ASKED" ||
    event.eventType === "SUPPLIER_CLARIFICATION_REPLIED"
  ) {
    const clarification = await database.supplierClarification.findUnique({
      where: { id: event.aggregateId },
      select: { initiator: true, assignment: { select: { businessId: true } } },
    });
    if (!clarification) return null;
    const toSupplier =
      event.eventType === "SUPPLIER_CLARIFICATION_REPLIED" ||
      clarification.initiator === "ADMIN";
    return {
      title: toSupplier ? "Operations replied" : "Supplier clarification received",
      body: toSupplier
        ? "An operations reply is available for your assigned request."
        : "A supplier submitted a clarification question.",
      entityType: "SUPPLIER_CLARIFICATION",
      entityId: event.aggregateId,
      recipients: toSupplier
        ? await businessUsers(database, clarification.assignment.businessId)
        : await activeAdmins(database),
    };
  }

  if (
    event.eventType === "CUSTOMER_CLARIFICATION_ASKED" ||
    event.eventType === "CUSTOMER_CLARIFICATION_REPLIED"
  ) {
    const clarification = await database.customerOptionClarification.findUnique({
      where: { id: event.aggregateId },
      select: {
        customer: {
          select: { user: { select: { id: true, email: true, phone: true } } },
        },
      },
    });
    if (!clarification) return null;
    const replied = event.eventType === "CUSTOMER_CLARIFICATION_REPLIED";
    return {
      title: replied ? "Operations replied" : "Customer clarification received",
      body: replied
        ? "An operations reply is available for your sourcing option."
        : "A customer submitted a sourcing-option question.",
      entityType: "CUSTOMER_CLARIFICATION",
      entityId: event.aggregateId,
      recipients: replied ? [clarification.customer.user] : await activeAdmins(database),
    };
  }

  if (
    ["QUOTATION_SUBMITTED", "CANCELLATION_REQUESTED", "RETURN_REQUESTED"].includes(
      event.eventType,
    )
  ) {
    return {
      title:
        event.eventType === "QUOTATION_SUBMITTED"
          ? "Supplier quotation submitted"
          : event.eventType === "CUSTOMER_OPTION_ACCEPTED"
            ? "Customer accepted an option"
            : event.eventType === "CANCELLATION_REQUESTED"
              ? "Cancellation review required"
              : "Return review required",
      body: "An operations action is available in PartsArc.",
      entityType: event.aggregateType,
      entityId: event.aggregateId,
      recipients: await activeAdmins(database),
    };
  }

  if (event.eventType === "CUSTOMER_OPTION_ACCEPTED") {
    const acceptance = await database.optionAcceptance.findUnique({
      where: { id: event.aggregateId },
      select: { option: { select: { quotation: { select: { businessId: true } } } } },
    });
    return {
      title: "Customer accepted an option",
      body: "An accepted sourcing option is ready for operations processing.",
      entityType: event.aggregateType,
      entityId: event.aggregateId,
      recipients: [
        ...(await activeAdmins(database)),
        ...(acceptance
          ? await businessUsers(database, acceptance.option.quotation.businessId)
          : []),
      ],
    };
  }

  if (event.eventType === "INVOICE_ISSUED") {
    const invoice = await database.invoice.findUnique({
      where: { id: event.aggregateId },
      select: {
        customer: {
          select: { user: { select: { id: true, email: true, phone: true } } },
        },
      },
    });
    return invoice
      ? {
          title: "Invoice issued",
          body: "A new PartsArc invoice is available in your account.",
          entityType: "INVOICE",
          entityId: event.aggregateId,
          recipients: [invoice.customer.user],
        }
      : null;
  }

  if (
    event.eventType === "CUSTOMER_PAYMENT_RECORDED" ||
    event.eventType === "FINANCIAL_ENTRY_REVERSED"
  ) {
    const entry = await database.transaction.findUnique({
      where: { id: event.aggregateId },
      select: {
        businessId: true,
        customer: {
          select: { user: { select: { id: true, email: true, phone: true } } },
        },
      },
    });
    return {
      title:
        event.eventType === "CUSTOMER_PAYMENT_RECORDED"
          ? "Payment recorded"
          : "Financial record corrected",
      body:
        event.eventType === "CUSTOMER_PAYMENT_RECORDED"
          ? "An externally received payment was recorded for your PartsArc order."
          : "Operations corrected a financial record. Review your account history.",
      entityType: "TRANSACTION",
      entityId: event.aggregateId,
      recipients: entry?.customer
        ? [entry.customer.user]
        : entry?.businessId
          ? await businessUsers(database, entry.businessId)
          : await activeAdmins(database),
    };
  }

  if (
    event.eventType === "CUSTOMER_REFUND_APPROVED" ||
    event.eventType === "CUSTOMER_REFUND_COMPLETED"
  ) {
    const refund = await database.refund.findUnique({
      where: { id: event.aggregateId },
      select: {
        customer: {
          select: { user: { select: { id: true, email: true, phone: true } } },
        },
      },
    });
    return refund
      ? {
          title:
            event.eventType === "CUSTOMER_REFUND_APPROVED"
              ? "Refund approved"
              : "Refund completion recorded",
          body:
            event.eventType === "CUSTOMER_REFUND_APPROVED"
              ? "Operations approved a refund for your order. External completion remains pending."
              : "Operations recorded completion of your external refund.",
          entityType: "REFUND",
          entityId: event.aggregateId,
          recipients: [refund.customer.user],
        }
      : null;
  }

  if (
    event.eventType === "SUPPLIER_PAYABLE_CREATED" ||
    event.eventType === "SUPPLIER_PAYOUT_RECORDED"
  ) {
    const businessId =
      event.eventType === "SUPPLIER_PAYABLE_CREATED"
        ? (
            await database.supplierPayable.findUnique({
              where: { id: event.aggregateId },
              select: { businessId: true },
            })
          )?.businessId
        : (
            await database.supplierSettlement.findUnique({
              where: { id: event.aggregateId },
              select: { businessId: true },
            })
          )?.businessId;
    return businessId
      ? {
          title:
            event.eventType === "SUPPLIER_PAYABLE_CREATED"
              ? "Supplier payable available"
              : "Supplier payout recorded",
          body:
            event.eventType === "SUPPLIER_PAYABLE_CREATED"
              ? "A completed order is now reflected in your settlement statement."
              : "Operations recorded an externally completed supplier payout.",
          entityType: event.aggregateType,
          entityId: event.aggregateId,
          recipients: await businessUsers(database, businessId),
        }
      : null;
  }

  let customerUser: Recipient | null = null;
  let businessId: string | null = null;
  if (event.aggregateType === "ORDER" || event.eventType.startsWith("ORDER_")) {
    const order = await database.order.findUnique({
      where: { id: event.aggregateId },
      select: {
        businessId: true,
        customer: {
          select: { user: { select: { id: true, email: true, phone: true } } },
        },
      },
    });
    customerUser = order?.customer.user ?? null;
    businessId = order?.businessId ?? null;
  } else if (event.eventType === "SOURCING_OPTION_PUBLISHED") {
    const option = await database.sourcingOption.findUnique({
      where: { id: event.aggregateId },
      select: {
        request: {
          select: {
            customer: {
              select: { user: { select: { id: true, email: true, phone: true } } },
            },
          },
        },
      },
    });
    customerUser = option?.request.customer.user ?? null;
  }
  if (!customerUser && !businessId) return null;
  const recipients = [
    ...(customerUser ? [customerUser] : []),
    ...(businessId ? await businessUsers(database, businessId) : []),
  ];
  const wording =
    event.eventType === "SOURCING_OPTION_PUBLISHED"
      ? [
          "New sourcing option",
          "Operations published a sourcing option for your request.",
        ]
      : event.eventType === "ORDER_CREATED"
        ? [
            "Order created",
            "Your accepted sourcing option has been converted to an order.",
          ]
        : ["Order updated", "An order fulfillment update is available in PartsArc."];
  return {
    title: wording[0]!,
    body: wording[1]!,
    entityType: event.aggregateType,
    entityId: event.aggregateId,
    recipients,
  };
}

export class OutboxProcessor {
  constructor(
    private readonly database: PrismaClient,
    private readonly env: Env,
    private readonly delivery: NotificationDeliveryProvider,
  ) {}

  private async processDeliveries(limit: number) {
    const due = await this.database.notificationDelivery.findMany({
      where: {
        status: {
          in: [NotificationDeliveryStatus.PENDING, NotificationDeliveryStatus.FAILED],
        },
        nextAttemptAt: { lte: new Date() },
        attempts: { lt: 8 },
      },
      include: {
        notification: { select: { title: true, body: true, eventKey: true } },
        user: { select: { email: true, phone: true } },
      },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      take: limit,
    });
    let delivered = 0;
    for (const item of due) {
      const recipient =
        item.channel === NotificationChannel.EMAIL ? item.user.email : item.user.phone;
      if (!recipient) {
        await this.database.notificationDelivery.update({
          where: { id: item.id },
          data: { status: NotificationDeliveryStatus.SKIPPED },
        });
        continue;
      }
      try {
        await this.delivery.deliver({
          channel: item.channel,
          recipient,
          title: item.notification.title,
          body: item.notification.body,
          eventKey: item.notification.eventKey,
        });
        await this.database.notificationDelivery.update({
          where: { id: item.id },
          data: {
            status: NotificationDeliveryStatus.DELIVERED,
            deliveredAt: new Date(),
            attempts: { increment: 1 },
            lastErrorCode: null,
          },
        });
        delivered += 1;
      } catch {
        const delay = Math.min(3_600_000, 2 ** item.attempts * 5_000);
        await this.database.notificationDelivery.update({
          where: { id: item.id },
          data: {
            status: NotificationDeliveryStatus.FAILED,
            attempts: { increment: 1 },
            nextAttemptAt: new Date(Date.now() + delay),
            lastErrorCode: "PROVIDER_ERROR",
          },
        });
      }
    }
    return delivered;
  }

  async processBatch(limit = this.env.JOB_BATCH_SIZE) {
    const ids = await this.database.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM outbox_events
      WHERE status IN ('PENDING', 'FAILED')
        AND "availableAt" <= NOW()
        AND attempts < "maxAttempts"
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;
    let processed = 0;
    for (const { id } of ids) {
      const claimed = await this.database.outboxEvent.updateMany({
        where: { id, status: { in: [OutboxStatus.PENDING, OutboxStatus.FAILED] } },
        data: {
          status: OutboxStatus.PROCESSING,
          lockedAt: new Date(),
          attempts: { increment: 1 },
        },
      });
      if (!claimed.count) continue;
      const event = await this.database.outboxEvent.findUniqueOrThrow({ where: { id } });
      try {
        const projection = await project(this.database, event);
        if (projection) {
          for (const recipient of projection.recipients) {
            const notification = await this.database.notification.upsert({
              where: {
                userId_channel_eventKey: {
                  userId: recipient.id,
                  channel: NotificationChannel.IN_APP,
                  eventKey: event.eventKey,
                },
              },
              update: {},
              create: {
                userId: recipient.id,
                channel: NotificationChannel.IN_APP,
                eventKey: event.eventKey,
                title: projection.title,
                body: projection.body,
                entityType: projection.entityType,
                entityId: projection.entityId,
              },
            });
            const external: Array<{
              channel: NotificationChannel;
              recipient: string | null;
            }> = [
              {
                channel: NotificationChannel.EMAIL,
                recipient: this.env.NOTIFICATION_EMAIL_ENABLED ? recipient.email : null,
              },
              {
                channel: NotificationChannel.SMS,
                recipient: this.env.NOTIFICATION_SMS_ENABLED ? recipient.phone : null,
              },
            ];
            for (const target of external) {
              if (!target.recipient) continue;
              const delivery = await this.database.notificationDelivery.upsert({
                where: {
                  notificationId_channel: {
                    notificationId: notification.id,
                    channel: target.channel,
                  },
                },
                update: {},
                create: {
                  notificationId: notification.id,
                  userId: recipient.id,
                  channel: target.channel,
                },
              });
              if (delivery.status === NotificationDeliveryStatus.DELIVERED) continue;
              try {
                await this.delivery.deliver({
                  channel: target.channel,
                  recipient: target.recipient,
                  title: projection.title,
                  body: projection.body,
                  eventKey: event.eventKey,
                });
                await this.database.notificationDelivery.update({
                  where: { id: delivery.id },
                  data: {
                    status: NotificationDeliveryStatus.DELIVERED,
                    deliveredAt: new Date(),
                    attempts: { increment: 1 },
                    lastErrorCode: null,
                  },
                });
              } catch {
                await this.database.notificationDelivery.update({
                  where: { id: delivery.id },
                  data: {
                    status: NotificationDeliveryStatus.FAILED,
                    attempts: { increment: 1 },
                    lastErrorCode: "PROVIDER_ERROR",
                    nextAttemptAt: new Date(Date.now() + 60_000),
                  },
                });
              }
            }
          }
        }
        await this.database.outboxEvent.update({
          where: { id },
          data: {
            status: OutboxStatus.PROCESSED,
            processedAt: new Date(),
            lockedAt: null,
            lastErrorCode: null,
          },
        });
        processed += 1;
      } catch {
        const delay = Math.min(3_600_000, 2 ** event.attempts * 5_000);
        await this.database.outboxEvent.update({
          where: { id },
          data: {
            status: OutboxStatus.FAILED,
            availableAt: new Date(Date.now() + delay),
            lockedAt: null,
            lastErrorCode: "PROJECTION_ERROR",
          },
        });
      }
    }
    const deliveriesProcessed = await this.processDeliveries(limit);
    return { claimed: ids.length, processed, deliveriesProcessed };
  }

  async retryFailed(id: string) {
    return this.database.outboxEvent.updateMany({
      where: { id, status: OutboxStatus.FAILED },
      data: {
        status: OutboxStatus.PENDING,
        attempts: 0,
        availableAt: new Date(),
        lastErrorCode: null,
      },
    });
  }
}
