import {
  InventoryAvailability,
  InventoryReservationEventType,
  InventoryReservationStatus,
  OrderCancellationStatus,
  OrderConversionStatus,
  OrderReturnStatus,
  OrderStatus,
  Prisma,
  RequestItemStatus,
  RequestUrgency,
  SourcingRequestStatus,
  SupplierBusinessStatus,
  UrgentEligibilityStatus,
  type PrismaClient,
} from "@prisma/client";
import { recordAudit } from "../auth/audit.service.js";
import type { MatchingClock } from "../matching/matching-clock.js";
import { AppError } from "../../shared/errors/app-error.js";
import type {
  AdminTransitionInput,
  OrderListInput,
  SupplierTransitionInput,
  UrgentEligibilityInput,
} from "./fulfillment.schemas.js";
import type { CreditService } from "../credits/credit.service.js";

type Tx = Prisma.TransactionClient;

const orderInclude = {
  items: {
    include: {
      reservation: { include: { history: { orderBy: { createdAt: "asc" as const } } } },
    },
    orderBy: { lineNumber: "asc" as const },
  },
  delivery: { include: { statusHistory: { orderBy: { createdAt: "asc" as const } } } },
  fulfillmentHistory: { orderBy: { createdAt: "asc" as const } },
  cancellations: { orderBy: { requestedAt: "desc" as const } },
  failures: { orderBy: { reportedAt: "desc" as const } },
  return: true,
  urgentHistory: { orderBy: { createdAt: "asc" as const } },
  request: { select: { requestNumber: true, urgency: true } },
  commissionReservation: true,
} satisfies Prisma.OrderInclude;

type FullOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

function fail(code: string, message: string, statusCode = 409): AppError {
  return new AppError(message, { code, statusCode });
}
function missing(): AppError {
  return fail("ORDER_NOT_FOUND", "Order was not found", 404);
}
function money(value: Prisma.Decimal): string {
  return value.toFixed(2);
}
function page(input: OrderListInput) {
  return { skip: (input.page - 1) * input.pageSize, take: input.pageSize };
}
function availability(
  stock: number,
  reserved: number,
  minimum: number,
  visible: boolean,
) {
  if (!visible) return InventoryAvailability.HIDDEN;
  const available = stock - reserved;
  if (available <= 0) return InventoryAvailability.OUT_OF_STOCK;
  if (available <= minimum) return InventoryAvailability.LOW_STOCK;
  return InventoryAvailability.IN_STOCK;
}
function snapshotObject(value: Prisma.JsonValue | null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function baseOrder(row: FullOrder, now: Date) {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    requestNumber: row.request?.requestNumber ?? null,
    status: row.status,
    currency: row.currency,
    customerTotal: money(row.customerTotal),
    deliveryCharge: money(row.deliveryCharge),
    priorityCharge: money(row.priorityCharge),
    externalSourcingRequired: row.externalSourcingRequired,
    supplierAvailabilityConfirmedAt: row.supplierAvailabilityConfirmedAt,
    commissionReservation: row.commissionReservation
      ? {
          status: row.commissionReservation.status,
          eligibleAmount: money(row.commissionReservation.eligibleAmount),
          commissionRateBps: row.commissionReservation.commissionRateBps,
          commissionAmount: money(row.commissionReservation.commissionAmount),
          reservedAt: row.commissionReservation.reservedAt,
          settledAt: row.commissionReservation.settledAt,
          releasedAt: row.commissionReservation.releasedAt,
          reversedAt: row.commissionReservation.reversedAt,
        }
      : null,
    urgent: {
      eligibility: row.urgentEligibility,
      basis: row.urgentEligibilityBasis,
      estimatedWindowStart: row.estimatedWindowStart,
      estimatedWindowEnd: row.estimatedWindowEnd,
      targetDeadlineAt: row.targetDeadlineAt,
      breached:
        !!row.targetDeadlineAt &&
        row.targetDeadlineAt <= now &&
        !(
          [
            OrderStatus.DELIVERED,
            OrderStatus.COMPLETED,
            OrderStatus.CANCELLED,
          ] as OrderStatus[]
        ).includes(row.status),
    },
    items: row.items.map((item) => ({
      id: item.id,
      lineNumber: item.lineNumber,
      description: item.description,
      brand: item.brand,
      partNumber: item.partNumber,
      condition: item.condition,
      quantity: item.quantity,
      customerUnitPrice: money(item.customerUnitPrice),
      customerLineTotal: money(item.customerLineTotal),
      compatibilityNotes: item.compatibilityNotes,
      alternativePartInfo: item.alternativePartInfo,
      isAlternative: item.isAlternative,
      fulfillmentSource: item.inventoryId ? "INVENTORY" : "EXTERNAL",
    })),
    history: row.fulfillmentHistory.map((entry) => ({
      id: entry.id,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      note: entry.note,
      at: entry.createdAt,
    })),
    cancellationRequests: row.cancellations.map((entry) => ({
      id: entry.id,
      status: entry.status,
      reason: entry.reason,
      requestedAt: entry.requestedAt,
      decisionReason: entry.decisionReason,
      decidedAt: entry.decidedAt,
    })),
    failure: row.failures[0]
      ? {
          code: row.failures[0].code,
          reason: row.failures[0].reason,
          reportedAt: row.failures[0].reportedAt,
        }
      : null,
    return: row.return
      ? {
          id: row.return.id,
          status: row.return.status,
          reason: row.return.reason,
          requestedAt: row.return.requestedAt,
          decisionReason: row.return.decisionReason,
          receivedAt: row.return.receivedAt,
          inspectionNote: row.return.inspectionNote,
          restocked: row.return.restocked,
          refundRequired: row.return.refundRequired,
        }
      : null,
    confirmedAt: row.confirmedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
  };
}

function customerOrder(row: FullOrder, now: Date) {
  const snapshot = snapshotObject(row.deliverySnapshot);
  return {
    ...baseOrder(row, now),
    customerItemsTotal: money(
      row.customerTotal.minus(row.deliveryCharge).minus(row.priorityCharge),
    ),
    delivery: {
      recipient: snapshot.recipientName ?? null,
      phone: snapshot.phone ?? null,
      addressLine: snapshot.addressLine ?? null,
      addressLine2: snapshot.addressLine2 ?? null,
      area: snapshot.area ?? null,
      city: snapshot.city ?? null,
      postalCode: snapshot.postalCode ?? null,
      instructions: snapshot.deliveryInstructions ?? null,
      status: row.delivery?.status ?? null,
      courierName: row.delivery?.courierName ?? null,
      trackingReference: row.delivery?.trackingReference ?? null,
      pickedUpAt: row.delivery?.pickedUpAt ?? null,
      deliveredAt: row.delivery?.deliveredAt ?? null,
    },
  };
}

function supplierOrder(row: FullOrder, now: Date) {
  const snapshot = snapshotObject(row.deliverySnapshot);
  return {
    ...baseOrder(row, now),
    supplierSubtotal: money(row.supplierSubtotal),
    supplierPayable: money(row.supplierPayable),
    deliveryArea: { area: snapshot.area ?? null, city: snapshot.city ?? null },
    items: row.items.map((item) => ({
      id: item.id,
      lineNumber: item.lineNumber,
      description: item.description,
      brand: item.brand,
      partNumber: item.partNumber,
      condition: item.condition,
      quantity: item.quantity,
      supplierUnitPrice: money(item.supplierUnitPrice),
      supplierLineTotal: money(item.supplierLineTotal),
      fulfillmentSource: item.inventoryId ? "INVENTORY" : "EXTERNAL",
      reservationStatus: item.reservation?.status ?? null,
    })),
  };
}

function adminOrder(row: FullOrder, now: Date) {
  return {
    ...customerOrder(row, now),
    businessId: row.businessId,
    customerId: row.customerId,
    acceptanceId: row.acceptanceId,
    supplierSubtotal: money(row.supplierSubtotal),
    platformMargin: money(row.platformMargin),
    supplierPayable: money(row.supplierPayable),
    items: row.items.map((item) => ({
      ...baseOrder(row, now).items.find((entry) => entry.id === item.id)!,
      supplierUnitPrice: money(item.supplierUnitPrice),
      supplierLineTotal: money(item.supplierLineTotal),
      inventoryId: item.inventoryId,
      reservation: item.reservation
        ? {
            id: item.reservation.id,
            quantity: item.reservation.quantity,
            status: item.reservation.status,
          }
        : null,
    })),
  };
}

async function lockOrder(tx: Tx, orderId: string) {
  await tx.$queryRaw`SELECT id FROM "orders" WHERE id = ${orderId}::uuid FOR UPDATE`;
}
async function lockInventory(tx: Tx, inventoryId: string) {
  await tx.$queryRaw`SELECT id FROM "supplier_inventory" WHERE id = ${inventoryId}::uuid FOR UPDATE`;
}

export class FulfillmentService {
  constructor(
    private readonly database: PrismaClient,
    private readonly clock: MatchingClock,
    private readonly credits: CreditService,
  ) {}

  private async fullOrder(tx: Tx | PrismaClient, id: string) {
    const row = await tx.order.findUnique({ where: { id }, include: orderInclude });
    if (!row) throw missing();
    return row;
  }

  private async setStatus(
    tx: Tx,
    orderId: string,
    fromStatus: OrderStatus,
    toStatus: OrderStatus,
    actorUserId: string,
    note: string | null | undefined,
    metadata?: Prisma.InputJsonObject,
  ) {
    const now = this.clock.now();
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: toStatus,
        version: { increment: 1 },
        confirmedAt: toStatus === OrderStatus.CONFIRMED ? now : undefined,
        completedAt: toStatus === OrderStatus.COMPLETED ? now : undefined,
        cancelledAt: toStatus === OrderStatus.CANCELLED ? now : undefined,
      },
    });
    await tx.fulfillmentStatusHistory.create({
      data: { orderId, fromStatus, toStatus, actorUserId, note, metadata },
    });
  }

  private async releaseReservations(
    tx: Tx,
    orderId: string,
    actorUserId: string,
    reason: string,
  ) {
    const reservations = await tx.inventoryReservation.findMany({
      where: { orderItem: { orderId }, status: InventoryReservationStatus.ACTIVE },
      orderBy: { inventoryId: "asc" },
    });
    for (const row of reservations) await lockInventory(tx, row.inventoryId);
    for (const row of reservations) {
      const inventory = await tx.supplierInventory.findUniqueOrThrow({
        where: { id: row.inventoryId },
      });
      const reservedQuantity = inventory.reservedQuantity - row.quantity;
      if (reservedQuantity < 0)
        throw fail("RESERVATION_ACCOUNTING_ERROR", "Reservation accounting is invalid");
      await tx.supplierInventory.update({
        where: { id: inventory.id },
        data: {
          reservedQuantity,
          availabilityStatus: availability(
            inventory.stockQuantity,
            reservedQuantity,
            inventory.minimumStock,
            inventory.isAvailable && inventory.isActive,
          ),
          version: { increment: 1 },
        },
      });
      await tx.inventoryReservation.update({
        where: { id: row.id },
        data: {
          status: InventoryReservationStatus.RELEASED,
          releasedAt: this.clock.now(),
        },
      });
      await tx.inventoryReservationEvent.create({
        data: {
          reservationId: row.id,
          eventType: InventoryReservationEventType.RELEASED,
          quantity: row.quantity,
          reason,
          actorUserId,
        },
      });
    }
  }

  private async consumeReservations(tx: Tx, orderId: string, actorUserId: string) {
    const reservations = await tx.inventoryReservation.findMany({
      where: { orderItem: { orderId }, status: InventoryReservationStatus.ACTIVE },
      orderBy: { inventoryId: "asc" },
    });
    for (const row of reservations) await lockInventory(tx, row.inventoryId);
    for (const row of reservations) {
      const inventory = await tx.supplierInventory.findUniqueOrThrow({
        where: { id: row.inventoryId },
      });
      const stockQuantity = inventory.stockQuantity - row.quantity;
      const reservedQuantity = inventory.reservedQuantity - row.quantity;
      if (stockQuantity < 0 || reservedQuantity < 0)
        throw fail("RESERVATION_ACCOUNTING_ERROR", "Reserved stock cannot be consumed");
      await tx.supplierInventory.update({
        where: { id: inventory.id },
        data: {
          stockQuantity,
          reservedQuantity,
          availabilityStatus: availability(
            stockQuantity,
            reservedQuantity,
            inventory.minimumStock,
            inventory.isAvailable && inventory.isActive,
          ),
          lastStockUpdateAt: this.clock.now(),
          version: { increment: 1 },
        },
      });
      await tx.inventoryStockAdjustment.create({
        data: {
          businessId: inventory.businessId,
          inventoryId: inventory.id,
          actorUserId,
          idempotencyKey: `order-consume:${row.id}`,
          reason: "Order pickup consumed reserved stock",
          quantityDelta: -row.quantity,
          previousQuantity: inventory.stockQuantity,
          resultingQuantity: stockQuantity,
        },
      });
      await tx.inventoryReservation.update({
        where: { id: row.id },
        data: {
          status: InventoryReservationStatus.CONSUMED,
          consumedAt: this.clock.now(),
        },
      });
      await tx.inventoryReservationEvent.create({
        data: {
          reservationId: row.id,
          eventType: InventoryReservationEventType.CONSUMED,
          quantity: row.quantity,
          reason: "Verified pickup",
          actorUserId,
        },
      });
    }
  }

  async convertAcceptance(
    acceptanceId: string,
    idempotencyKey: string,
    actorUserId: string,
    requestId: string,
  ) {
    try {
      return await this.database.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`acceptance:${acceptanceId}`}, 0)
          ) IS NULL AS "locked"
        `;
        const prior = await tx.order.findUnique({
          where: { acceptanceId },
          include: orderInclude,
        });
        if (prior) return { order: adminOrder(prior, this.clock.now()), duplicate: true };

        const acceptance = await tx.optionAcceptance.findUnique({
          where: { id: acceptanceId },
          include: {
            request: { include: { items: true } },
            option: {
              include: {
                quotation: {
                  include: {
                    business: {
                      include: {
                        members: {
                          where: { isActive: true, leftAt: null },
                          select: { id: true },
                        },
                      },
                    },
                  },
                },
              },
            },
            items: {
              include: {
                quotationItem: true,
              },
              orderBy: { createdAt: "asc" },
            },
          },
        });
        if (!acceptance)
          throw fail("ACCEPTANCE_NOT_FOUND", "Acceptance was not found", 404);
        if (acceptance.allocationReleasedAt)
          throw fail("ACCEPTANCE_RELEASED", "This acceptance allocation was released");
        const business = acceptance.option.quotation.business;
        if (
          business.status !== SupplierBusinessStatus.ACTIVE ||
          business.members.length === 0
        )
          throw fail("SUPPLIER_INELIGIBLE", "Supplier is not eligible for fulfillment");

        const inventoryIds = [
          ...new Set(
            acceptance.items
              .map((item) => item.quotationItem.inventoryId)
              .filter((value): value is string => !!value),
          ),
        ].sort();
        for (const inventoryId of inventoryIds) await lockInventory(tx, inventoryId);
        const inventories = inventoryIds.length
          ? await tx.supplierInventory.findMany({ where: { id: { in: inventoryIds } } })
          : [];
        const inventoryMap = new Map(inventories.map((item) => [item.id, item]));
        const requiredByInventory = new Map<string, number>();
        for (const item of acceptance.items) {
          const inventoryId = item.quotationItem.inventoryId;
          if (inventoryId)
            requiredByInventory.set(
              inventoryId,
              (requiredByInventory.get(inventoryId) ?? 0) + item.quantity,
            );
        }
        for (const [inventoryId, quantity] of requiredByInventory) {
          const inventory = inventoryMap.get(inventoryId);
          if (
            !inventory ||
            inventory.businessId !== business.id ||
            !inventory.isActive ||
            !inventory.isAvailable
          )
            throw fail(
              "INVENTORY_UNAVAILABLE",
              "Accepted inventory is no longer available",
            );
          if (inventory.stockQuantity - inventory.reservedQuantity < quantity)
            throw fail("INSUFFICIENT_STOCK", "Accepted inventory has insufficient stock");
        }

        const supplierSubtotal = acceptance.items.reduce(
          (sum, item) =>
            sum.plus(item.quotationItem.supplierUnitPrice.mul(item.quantity)),
          new Prisma.Decimal(0),
        );
        const platformMargin = acceptance.customerItemsTotal.minus(supplierSubtotal);
        if (platformMargin.isNegative())
          throw fail("INVALID_ACCEPTANCE_PRICING", "Acceptance pricing is inconsistent");
        const external = acceptance.items.some((item) => !item.quotationItem.inventoryId);
        // Customer acceptance is not a completed sale. Every new commercial order
        // waits for an explicit supplier confirmation and atomic commission reserve.
        const initialStatus = OrderStatus.PENDING_SUPPLIER_CONFIRMATION;
        const sequence = await tx.$queryRaw<Array<{ value: bigint }>>`
          SELECT nextval('order_number_seq') AS "value"
        `;
        const orderNumber = `ORD-${this.clock.now().getUTCFullYear()}-${String(sequence[0]!.value).padStart(6, "0")}`;
        const order = await tx.order.create({
          data: {
            orderNumber,
            acceptanceId: acceptance.id,
            customerId: acceptance.customerId,
            businessId: business.id,
            requestId: acceptance.requestId,
            quotationId: acceptance.option.quotationId,
            status: initialStatus,
            currency: acceptance.currency,
            supplierSubtotal,
            platformMargin,
            deliveryCharge: acceptance.deliveryCharge,
            priorityCharge: acceptance.priorityCharge,
            customerTotal: acceptance.customerTotal,
            supplierPayable: supplierSubtotal,
            deliverySnapshot: acceptance.deliverySnapshot as Prisma.InputJsonValue,
            externalSourcingRequired: external,
            confirmedAt: null,
            urgentEligibility:
              acceptance.request.urgency === RequestUrgency.URGENT
                ? UrgentEligibilityStatus.PENDING
                : UrgentEligibilityStatus.NOT_APPLICABLE,
          },
        });
        await tx.delivery.create({
          data: {
            orderId: order.id,
            recipientSnapshot: acceptance.deliverySnapshot as Prisma.InputJsonValue,
          },
        });
        for (const [index, accepted] of acceptance.items.entries()) {
          const quote = accepted.quotationItem;
          const supplierLineTotal = quote.supplierUnitPrice.mul(accepted.quantity);
          const orderItem = await tx.orderItem.create({
            data: {
              orderId: order.id,
              acceptanceItemId: accepted.id,
              requestItemId: accepted.requestItemId,
              quotationItemId: accepted.quotationItemId,
              productId: quote.productId,
              inventoryId: quote.inventoryId,
              lineNumber: index + 1,
              description: accepted.description,
              brand: accepted.brand,
              partNumber: accepted.partNumber,
              condition: accepted.condition,
              compatibilityNotes: accepted.compatibilityNotes,
              alternativePartInfo: accepted.alternativePartInfo,
              isAlternative: accepted.isAlternative,
              quantity: accepted.quantity,
              supplierUnitPrice: quote.supplierUnitPrice,
              customerUnitPrice: accepted.customerUnitPrice,
              supplierLineTotal,
              customerLineTotal: accepted.customerLineTotal,
            },
          });
          if (quote.inventoryId) {
            const inventory = inventoryMap.get(quote.inventoryId)!;
            const reservedQuantity = inventory.reservedQuantity + accepted.quantity;
            inventory.reservedQuantity = reservedQuantity;
            await tx.supplierInventory.update({
              where: { id: inventory.id },
              data: {
                reservedQuantity,
                availabilityStatus: availability(
                  inventory.stockQuantity,
                  reservedQuantity,
                  inventory.minimumStock,
                  inventory.isAvailable && inventory.isActive,
                ),
                version: { increment: 1 },
              },
            });
            await tx.inventoryReservation.create({
              data: {
                orderItemId: orderItem.id,
                businessId: business.id,
                inventoryId: inventory.id,
                quantity: accepted.quantity,
                history: {
                  create: {
                    eventType: InventoryReservationEventType.RESERVED,
                    quantity: accepted.quantity,
                    reason: "Acceptance converted to order",
                    actorUserId,
                  },
                },
              },
            });
          }
        }
        await tx.fulfillmentStatusHistory.create({
          data: {
            orderId: order.id,
            toStatus: initialStatus,
            actorUserId,
            note: external
              ? "Order created pending external-source availability and commission reserve"
              : "Order created pending supplier confirmation and commission reserve",
          },
        });
        await tx.orderConversionAttempt.upsert({
          where: { acceptanceId },
          create: {
            acceptanceId,
            orderId: order.id,
            idempotencyKey,
            status: OrderConversionStatus.ORDER_CREATED,
          },
          update: {
            orderId: order.id,
            idempotencyKey,
            status: OrderConversionStatus.ORDER_CREATED,
            exceptionCode: null,
            exceptionNote: null,
            attemptedAt: this.clock.now(),
          },
        });
        await this.recalculateRequestAllocation(tx, acceptance.requestId, actorUserId);
        await recordAudit(tx, {
          actorUserId,
          action: "ACCEPTANCE_CONVERTED_TO_ORDER",
          entityType: "ORDER",
          entityId: order.id,
          requestId,
          metadata: { acceptanceId, externalSourcingRequired: external },
        });
        return {
          order: adminOrder(await this.fullOrder(tx, order.id), this.clock.now()),
          duplicate: false,
        };
      });
    } catch (error) {
      if (!(error instanceof AppError) || error.statusCode !== 409) throw error;
      const existing = await this.database.order.findUnique({
        where: { acceptanceId },
        include: orderInclude,
      });
      if (existing)
        return { order: adminOrder(existing, this.clock.now()), duplicate: true };
      await this.database.$transaction(async (tx) => {
        await tx.orderConversionAttempt.upsert({
          where: { acceptanceId },
          create: {
            acceptanceId,
            idempotencyKey,
            status: OrderConversionStatus.EXCEPTION,
            exceptionCode: error.code,
            exceptionNote: error.message,
            attemptedAt: this.clock.now(),
          },
          update: {
            idempotencyKey,
            status: OrderConversionStatus.EXCEPTION,
            exceptionCode: error.code,
            exceptionNote: error.message,
            attemptedAt: this.clock.now(),
          },
        });
        await recordAudit(tx, {
          actorUserId,
          action: "ORDER_CONVERSION_EXCEPTION",
          entityType: "OPTION_ACCEPTANCE",
          entityId: acceptanceId,
          requestId,
          metadata: { code: error.code },
        });
      });
      throw error;
    }
  }

  async listAdmin(input: OrderListInput) {
    const workflowStatuses: Record<
      NonNullable<OrderListInput["workflow"]>,
      OrderStatus[]
    > = {
      PENDING_CONFIRMATION: [OrderStatus.PENDING_SUPPLIER_CONFIRMATION],
      IN_PROGRESS: [
        OrderStatus.CONFIRMED,
        OrderStatus.SUPPLIER_PREPARING,
        OrderStatus.READY_FOR_PICKUP,
        OrderStatus.PICKED_UP,
        OrderStatus.IN_DELIVERY,
        OrderStatus.DELIVERED,
      ],
      COMPLETED: [OrderStatus.COMPLETED],
      EXCEPTIONS: [OrderStatus.CANCELLED, OrderStatus.FAILED, OrderStatus.RETURNED],
    };
    const where: Prisma.OrderWhereInput = {
      status:
        input.status ??
        (input.workflow && input.workflow !== "EXCEPTIONS"
          ? { in: workflowStatuses[input.workflow] }
          : undefined),
      OR:
        input.workflow === "EXCEPTIONS"
          ? [
              { status: { in: workflowStatuses.EXCEPTIONS } },
              {
                cancellations: {
                  some: { status: OrderCancellationStatus.PENDING },
                },
              },
              {
                return: {
                  is: {
                    status: {
                      in: [
                        OrderReturnStatus.REQUESTED,
                        OrderReturnStatus.APPROVED,
                        OrderReturnStatus.RECEIVED,
                      ],
                    },
                  },
                },
              },
            ]
          : undefined,
      request:
        input.urgent === undefined
          ? undefined
          : { urgency: input.urgent ? "URGENT" : "STANDARD" },
    };
    const [items, total] = await Promise.all([
      this.database.order.findMany({
        where,
        include: orderInclude,
        orderBy: { createdAt: "desc" },
        ...page(input),
      }),
      this.database.order.count({ where }),
    ]);
    return {
      items: items.map((row) => adminOrder(row, this.clock.now())),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async getAdmin(id: string) {
    return adminOrder(await this.fullOrder(this.database, id), this.clock.now());
  }

  async listCustomer(userId: string, input: OrderListInput) {
    const customer = await this.database.customerProfile.findUnique({
      where: { userId },
    });
    if (!customer) throw missing();
    const where: Prisma.OrderWhereInput = {
      customerId: customer.id,
      status: input.status,
    };
    const [items, total] = await Promise.all([
      this.database.order.findMany({
        where,
        include: orderInclude,
        orderBy: { createdAt: "desc" },
        ...page(input),
      }),
      this.database.order.count({ where }),
    ]);
    return {
      items: items.map((row) => customerOrder(row, this.clock.now())),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async getCustomer(userId: string, id: string) {
    const customer = await this.database.customerProfile.findUnique({
      where: { userId },
    });
    if (!customer) throw missing();
    const row = await this.database.order.findFirst({
      where: { id, customerId: customer.id },
      include: orderInclude,
    });
    if (!row) throw missing();
    return customerOrder(row, this.clock.now());
  }

  async listSupplier(businessId: string, input: OrderListInput) {
    const where: Prisma.OrderWhereInput = { businessId, status: input.status };
    const [items, total] = await Promise.all([
      this.database.order.findMany({
        where,
        include: orderInclude,
        orderBy: { createdAt: "desc" },
        ...page(input),
      }),
      this.database.order.count({ where }),
    ]);
    return {
      items: items.map((row) => supplierOrder(row, this.clock.now())),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async getSupplier(businessId: string, id: string) {
    const row = await this.database.order.findFirst({
      where: { id, businessId },
      include: orderInclude,
    });
    if (!row) throw missing();
    return supplierOrder(row, this.clock.now());
  }

  async supplierAvailability(
    businessId: string,
    id: string,
    available: boolean,
    note: string | null | undefined,
    actorUserId: string,
    requestId: string,
  ) {
    const result = await this.database.$transaction(async (tx) => {
      await lockOrder(tx, id);
      const row = await tx.order.findFirst({
        where: { id, businessId },
        include: { request: { select: { requestType: true } } },
      });
      if (!row) throw missing();
      if (row.status !== OrderStatus.PENDING_SUPPLIER_CONFIRMATION) {
        if (available && row.supplierAvailabilityConfirmedAt)
          return {
            order: supplierOrder(await this.fullOrder(tx, id), this.clock.now()),
            shortage: null,
          };
        throw fail("INVALID_ORDER_TRANSITION", "Availability can no longer be changed");
      }
      if (!available) {
        await this.releaseReservations(
          tx,
          id,
          actorUserId,
          "External sourcing unavailable",
        );
        await this.setStatus(
          tx,
          id,
          row.status,
          OrderStatus.FAILED,
          actorUserId,
          note ?? "Supplier could not confirm external availability",
        );
        await tx.orderFailure.create({
          data: {
            orderId: id,
            code: "EXTERNAL_UNAVAILABLE",
            reason: note ?? "Supplier could not confirm external availability",
            releaseReservations: true,
            reportedByUserId: actorUserId,
          },
        });
      } else {
        if (
          row.request?.requestType === "FIXED_PRICE_PURCHASE" ||
          row.request?.requestType === "USED_PART_RFQ"
        ) {
          const commission = await this.credits.reserveOrderInTransaction(
            tx,
            id,
            actorUserId,
            requestId,
          );
          if (commission.shortage) {
            return {
              order: supplierOrder(await this.fullOrder(tx, id), this.clock.now()),
              shortage: commission,
            };
          }
        }
        await tx.order.update({
          where: { id },
          data: {
            supplierAvailabilityConfirmedAt: this.clock.now(),
            supplierAvailabilityConfirmedBy: actorUserId,
          },
        });
        await this.setStatus(
          tx,
          id,
          row.status,
          OrderStatus.CONFIRMED,
          actorUserId,
          note ?? "Supplier confirmed external availability",
        );
      }
      await recordAudit(tx, {
        actorUserId,
        action: available
          ? "ORDER_AVAILABILITY_CONFIRMED"
          : "ORDER_AVAILABILITY_DECLINED",
        entityType: "ORDER",
        entityId: id,
        requestId,
      });
      return {
        order: supplierOrder(await this.fullOrder(tx, id), this.clock.now()),
        shortage: null,
      };
    });
    if (result.shortage) {
      throw fail(
        "INSUFFICIENT_COMMISSION_CREDITS",
        `Supplier needs BDT ${result.shortage.requiredCredit.toFixed(2)} available credits`,
      );
    }
    return result.order;
  }

  async supplierTransition(
    businessId: string,
    id: string,
    input: SupplierTransitionInput,
    actorUserId: string,
    requestId: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await lockOrder(tx, id);
      const row = await tx.order.findFirst({ where: { id, businessId } });
      if (!row) throw missing();
      const allowed =
        (row.status === OrderStatus.CONFIRMED &&
          input.toStatus === OrderStatus.SUPPLIER_PREPARING) ||
        (row.status === OrderStatus.SUPPLIER_PREPARING &&
          input.toStatus === OrderStatus.READY_FOR_PICKUP);
      if (!allowed) {
        if (row.status === input.toStatus)
          return supplierOrder(await this.fullOrder(tx, id), this.clock.now());
        throw fail("INVALID_ORDER_TRANSITION", "Supplier transition is not allowed");
      }
      await this.setStatus(tx, id, row.status, input.toStatus, actorUserId, input.note);
      await recordAudit(tx, {
        actorUserId,
        action: "SUPPLIER_ORDER_STATUS_CHANGED",
        entityType: "ORDER",
        entityId: id,
        requestId,
        metadata: { toStatus: input.toStatus },
      });
      return supplierOrder(await this.fullOrder(tx, id), this.clock.now());
    });
  }

  async adminTransition(
    id: string,
    input: AdminTransitionInput,
    actorUserId: string,
    requestId: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await lockOrder(tx, id);
      const row = await tx.order.findUnique({
        where: { id },
        include: { delivery: true },
      });
      if (!row) throw missing();
      const next = new Map<OrderStatus, OrderStatus>([
        [OrderStatus.READY_FOR_PICKUP, OrderStatus.PICKED_UP],
        [OrderStatus.PICKED_UP, OrderStatus.IN_DELIVERY],
        [OrderStatus.IN_DELIVERY, OrderStatus.DELIVERED],
        [OrderStatus.DELIVERED, OrderStatus.COMPLETED],
      ]).get(row.status);
      if (next !== input.toStatus) {
        if (row.status === input.toStatus)
          return adminOrder(await this.fullOrder(tx, id), this.clock.now());
        throw fail("INVALID_ORDER_TRANSITION", "Operations transition is not allowed");
      }
      if (input.toStatus === OrderStatus.PICKED_UP)
        await this.consumeReservations(tx, id, actorUserId);
      if (input.toStatus === OrderStatus.COMPLETED) {
        const reservation = await tx.commissionReservation.findUnique({
          where: { orderId: id },
          select: { id: true },
        });
        if (reservation) {
          if (!input.note) {
            throw fail(
              "COMPLETION_EVIDENCE_REQUIRED",
              "A completion evidence or verification reference is required",
            );
          }
          await this.credits.settleOrderInTransaction(
            tx,
            id,
            actorUserId,
            requestId,
            input.note ?? `verified-completion:${id}`,
          );
        }
      }
      await this.setStatus(tx, id, row.status, input.toStatus, actorUserId, input.note);
      const deliveryStatus =
        input.toStatus === OrderStatus.PICKED_UP
          ? "PICKED_UP"
          : input.toStatus === OrderStatus.IN_DELIVERY
            ? "IN_TRANSIT"
            : input.toStatus === OrderStatus.DELIVERED
              ? "DELIVERED"
              : null;
      if (row.delivery && deliveryStatus) {
        await tx.delivery.update({
          where: { id: row.delivery.id },
          data: {
            status: deliveryStatus,
            courierName: input.courierName,
            courierPhone: input.courierPhone,
            trackingReference: input.trackingReference,
            pickupLocationId: input.pickupLocationId,
            scheduledPickupAt: input.scheduledPickupAt,
            pickedUpAt:
              input.toStatus === OrderStatus.PICKED_UP ? this.clock.now() : undefined,
            deliveredAt:
              input.toStatus === OrderStatus.DELIVERED ? this.clock.now() : undefined,
            statusHistory: {
              create: {
                fromStatus: row.delivery.status,
                toStatus: deliveryStatus,
                actorUserId,
                note: input.note,
              },
            },
          },
        });
      }
      await recordAudit(tx, {
        actorUserId,
        action: "OPERATIONS_ORDER_STATUS_CHANGED",
        entityType: "ORDER",
        entityId: id,
        requestId,
        metadata: { toStatus: input.toStatus },
      });
      return adminOrder(await this.fullOrder(tx, id), this.clock.now());
    });
  }

  async requestCancellation(
    userId: string,
    id: string,
    reason: string,
    requestId: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await lockOrder(tx, id);
      const customer = await tx.customerProfile.findUnique({ where: { userId } });
      if (!customer) throw missing();
      const order = await tx.order.findFirst({ where: { id, customerId: customer.id } });
      if (!order) throw missing();
      if (
        !(
          [
            OrderStatus.PENDING_SUPPLIER_CONFIRMATION,
            OrderStatus.CONFIRMED,
            OrderStatus.SUPPLIER_PREPARING,
            OrderStatus.READY_FOR_PICKUP,
          ] as OrderStatus[]
        ).includes(order.status)
      )
        throw fail(
          "CANCELLATION_NOT_ELIGIBLE",
          "Cancellation can only be requested before pickup",
        );
      const prior = await tx.orderCancellationRequest.findFirst({
        where: { orderId: id, status: OrderCancellationStatus.PENDING },
      });
      if (prior) return prior;
      const created = await tx.orderCancellationRequest.create({
        data: { orderId: id, customerId: customer.id, reason, requestedByUserId: userId },
      });
      await recordAudit(tx, {
        actorUserId: userId,
        action: "ORDER_CANCELLATION_REQUESTED",
        entityType: "ORDER",
        entityId: id,
        requestId,
      });
      return created;
    });
  }

  private async recalculateRequestAllocation(
    tx: Tx,
    requestId: string,
    actorUserId: string,
  ) {
    const request = await tx.sourcingRequest.findUnique({
      where: { id: requestId },
      include: { items: true },
    });
    if (!request) return;
    const accepted = await tx.optionAcceptanceItem.groupBy({
      by: ["requestItemId"],
      where: { acceptance: { requestId, allocationReleasedAt: null } },
      _sum: { quantity: true },
    });
    const totals = new Map(
      accepted.map((item) => [item.requestItemId, item._sum.quantity ?? 0]),
    );
    for (const item of request.items) {
      const next =
        (totals.get(item.id) ?? 0) >= item.quantity
          ? RequestItemStatus.ACCEPTED
          : RequestItemStatus.OPEN;
      if (item.status !== next)
        await tx.sourcingRequestItem.update({
          where: { id: item.id },
          data: { status: next },
        });
    }
    const complete = request.items.every(
      (item) => (totals.get(item.id) ?? 0) >= item.quantity,
    );
    const ordered = await tx.orderItem.groupBy({
      by: ["requestItemId"],
      where: {
        order: { requestId, status: { not: OrderStatus.CANCELLED } },
        acceptanceItem: { acceptance: { allocationReleasedAt: null } },
      },
      _sum: { quantity: true },
    });
    const orderedTotals = new Map(
      ordered
        .filter(
          (item): item is typeof item & { requestItemId: string } => !!item.requestItemId,
        )
        .map((item) => [item.requestItemId, item._sum.quantity ?? 0]),
    );
    const fullyOrdered =
      complete &&
      request.items.every((item) => (orderedTotals.get(item.id) ?? 0) >= item.quantity);
    const toStatus = fullyOrdered
      ? SourcingRequestStatus.ORDERED
      : complete
        ? SourcingRequestStatus.ACCEPTED
        : SourcingRequestStatus.AWAITING_CUSTOMER;
    if (request.status !== toStatus) {
      await tx.sourcingRequest.update({
        where: { id: requestId },
        data: { status: toStatus, version: { increment: 1 } },
      });
      await tx.requestStatusHistory.create({
        data: {
          requestId,
          fromStatus: request.status,
          toStatus,
          actorUserId,
          note: "Order cancellation changed accepted allocation",
        },
      });
    }
  }

  async decideCancellation(
    id: string,
    cancellationId: string,
    decision: OrderCancellationStatus,
    reason: string,
    actorUserId: string,
    requestId: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await lockOrder(tx, id);
      const order = await tx.order.findUnique({ where: { id } });
      const cancellation = await tx.orderCancellationRequest.findFirst({
        where: { id: cancellationId, orderId: id },
      });
      if (!order || !cancellation) throw missing();
      if (cancellation.status !== OrderCancellationStatus.PENDING)
        return adminOrder(await this.fullOrder(tx, id), this.clock.now());
      if (decision === OrderCancellationStatus.APPROVED) {
        if (
          (
            [
              OrderStatus.PICKED_UP,
              OrderStatus.IN_DELIVERY,
              OrderStatus.DELIVERED,
              OrderStatus.COMPLETED,
            ] as OrderStatus[]
          ).includes(order.status)
        )
          throw fail("CANCELLATION_NOT_ELIGIBLE", "The order has already been picked up");
        await this.releaseReservations(tx, id, actorUserId, "Cancellation approved");
        const commission = await tx.commissionReservation.findUnique({
          where: { orderId: id },
          select: { id: true },
        });
        if (commission) {
          await this.credits.releaseOrderInTransaction(
            tx,
            id,
            actorUserId,
            requestId,
            reason,
          );
        }
        await this.setStatus(
          tx,
          id,
          order.status,
          OrderStatus.CANCELLED,
          actorUserId,
          reason,
        );
        if (order.acceptanceId) {
          await tx.optionAcceptance.update({
            where: { id: order.acceptanceId },
            data: {
              allocationReleasedAt: this.clock.now(),
              allocationReleaseReason: reason,
            },
          });
          if (order.requestId)
            await this.recalculateRequestAllocation(tx, order.requestId, actorUserId);
        }
      }
      await tx.orderCancellationRequest.update({
        where: { id: cancellationId },
        data: {
          status: decision,
          decisionReason: reason,
          decidedByUserId: actorUserId,
          decidedAt: this.clock.now(),
        },
      });
      await recordAudit(tx, {
        actorUserId,
        action: `ORDER_CANCELLATION_${decision}`,
        entityType: "ORDER",
        entityId: id,
        requestId,
      });
      return adminOrder(await this.fullOrder(tx, id), this.clock.now());
    });
  }

  async reportFailure(
    id: string,
    code: string,
    reason: string,
    release: boolean,
    actorUserId: string,
    requestId: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await lockOrder(tx, id);
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw missing();
      if (
        (
          [
            OrderStatus.COMPLETED,
            OrderStatus.CANCELLED,
            OrderStatus.RETURNED,
          ] as OrderStatus[]
        ).includes(order.status)
      )
        throw fail("FAILURE_NOT_ALLOWED", "Failure cannot be recorded in this state");
      if (release)
        await this.releaseReservations(tx, id, actorUserId, "Operational failure");
      const commission = await tx.commissionReservation.findUnique({
        where: { orderId: id },
        select: { status: true },
      });
      if (commission?.status === "RESERVED") {
        await this.credits.releaseOrderInTransaction(
          tx,
          id,
          actorUserId,
          requestId,
          `Operational failure: ${reason}`,
        );
      }
      await tx.orderFailure.create({
        data: {
          orderId: id,
          code,
          reason,
          releaseReservations: release,
          reportedByUserId: actorUserId,
        },
      });
      await this.setStatus(tx, id, order.status, OrderStatus.FAILED, actorUserId, reason);
      await recordAudit(tx, {
        actorUserId,
        action: "ORDER_FAILURE_REPORTED",
        entityType: "ORDER",
        entityId: id,
        requestId,
        metadata: { code, releaseReservations: release },
      });
      return adminOrder(await this.fullOrder(tx, id), this.clock.now());
    });
  }

  async requestReturn(userId: string, id: string, reason: string, requestId: string) {
    return this.database.$transaction(async (tx) => {
      await lockOrder(tx, id);
      const customer = await tx.customerProfile.findUnique({ where: { userId } });
      if (!customer) throw missing();
      const order = await tx.order.findFirst({ where: { id, customerId: customer.id } });
      if (!order) throw missing();
      if (
        !([OrderStatus.DELIVERED, OrderStatus.COMPLETED] as OrderStatus[]).includes(
          order.status,
        )
      )
        throw fail("RETURN_NOT_ELIGIBLE", "Returns can be requested only after delivery");
      const prior = await tx.orderReturn.findUnique({ where: { orderId: id } });
      if (prior) return prior;
      const created = await tx.orderReturn.create({
        data: { orderId: id, customerId: customer.id, reason, requestedByUserId: userId },
      });
      await recordAudit(tx, {
        actorUserId: userId,
        action: "ORDER_RETURN_REQUESTED",
        entityType: "ORDER",
        entityId: id,
        requestId,
      });
      return created;
    });
  }

  async decideReturn(
    id: string,
    returnId: string,
    decision: OrderReturnStatus,
    reason: string,
    refundRequired: boolean,
    actorUserId: string,
    requestId: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await lockOrder(tx, id);
      const row = await tx.orderReturn.findFirst({
        where: { id: returnId, orderId: id },
      });
      if (!row) throw missing();
      if (row.status !== OrderReturnStatus.REQUESTED)
        throw fail("RETURN_ALREADY_DECIDED", "Return was already decided");
      await tx.orderReturn.update({
        where: { id: returnId },
        data: {
          status: decision,
          decisionReason: reason,
          refundRequired,
          decidedByUserId: actorUserId,
          decidedAt: this.clock.now(),
        },
      });
      await recordAudit(tx, {
        actorUserId,
        action: `ORDER_RETURN_${decision}`,
        entityType: "ORDER",
        entityId: id,
        requestId,
      });
      return adminOrder(await this.fullOrder(tx, id), this.clock.now());
    });
  }

  async receiveReturn(
    id: string,
    returnId: string,
    note: string | null | undefined,
    actorUserId: string,
    requestId: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await lockOrder(tx, id);
      const row = await tx.orderReturn.findFirst({
        where: { id: returnId, orderId: id },
      });
      if (!row) throw missing();
      if (
        row.status === OrderReturnStatus.RECEIVED ||
        row.status === OrderReturnStatus.INSPECTED
      )
        return adminOrder(await this.fullOrder(tx, id), this.clock.now());
      if (row.status !== OrderReturnStatus.APPROVED)
        throw fail("RETURN_NOT_APPROVED", "Return is not approved");
      await tx.orderReturn.update({
        where: { id: returnId },
        data: {
          status: OrderReturnStatus.RECEIVED,
          receivedByUserId: actorUserId,
          receivedAt: this.clock.now(),
          inspectionNote: note,
        },
      });
      await recordAudit(tx, {
        actorUserId,
        action: "ORDER_RETURN_RECEIVED",
        entityType: "ORDER",
        entityId: id,
        requestId,
      });
      return adminOrder(await this.fullOrder(tx, id), this.clock.now());
    });
  }

  async inspectReturn(
    id: string,
    returnId: string,
    note: string,
    restock: boolean,
    refundRequired: boolean,
    actorUserId: string,
    requestId: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await lockOrder(tx, id);
      const returned = await tx.orderReturn.findFirst({
        where: { id: returnId, orderId: id },
      });
      const order = await tx.order.findUnique({ where: { id } });
      if (!returned || !order) throw missing();
      if (returned.status === OrderReturnStatus.INSPECTED)
        return adminOrder(await this.fullOrder(tx, id), this.clock.now());
      if (returned.status !== OrderReturnStatus.RECEIVED)
        throw fail("RETURN_NOT_RECEIVED", "Return must be received before inspection");
      const reservations = restock
        ? await tx.inventoryReservation.findMany({
            where: {
              orderItem: { orderId: id },
              status: InventoryReservationStatus.CONSUMED,
            },
            orderBy: { inventoryId: "asc" },
          })
        : [];
      for (const row of reservations) await lockInventory(tx, row.inventoryId);
      for (const row of reservations) {
        const inventory = await tx.supplierInventory.findUniqueOrThrow({
          where: { id: row.inventoryId },
        });
        const stockQuantity = inventory.stockQuantity + row.quantity;
        await tx.supplierInventory.update({
          where: { id: inventory.id },
          data: {
            stockQuantity,
            availabilityStatus: availability(
              stockQuantity,
              inventory.reservedQuantity,
              inventory.minimumStock,
              inventory.isAvailable && inventory.isActive,
            ),
            lastStockUpdateAt: this.clock.now(),
            version: { increment: 1 },
          },
        });
        await tx.inventoryStockAdjustment.create({
          data: {
            businessId: inventory.businessId,
            inventoryId: inventory.id,
            actorUserId,
            idempotencyKey: `order-return:${row.id}`,
            reason: "Inspected return restored to stock",
            quantityDelta: row.quantity,
            previousQuantity: inventory.stockQuantity,
            resultingQuantity: stockQuantity,
          },
        });
        await tx.inventoryReservation.update({
          where: { id: row.id },
          data: {
            status: InventoryReservationStatus.RESTORED,
            restoredAt: this.clock.now(),
          },
        });
        await tx.inventoryReservationEvent.create({
          data: {
            reservationId: row.id,
            eventType: InventoryReservationEventType.RESTORED,
            quantity: row.quantity,
            reason: note,
            actorUserId,
          },
        });
      }
      await tx.orderReturn.update({
        where: { id: returnId },
        data: {
          status: OrderReturnStatus.INSPECTED,
          inspectionNote: note,
          restocked: restock,
          refundRequired,
          inspectedAt: this.clock.now(),
        },
      });
      await this.setStatus(
        tx,
        id,
        order.status,
        OrderStatus.RETURNED,
        actorUserId,
        "Return inspected",
      );
      await recordAudit(tx, {
        actorUserId,
        action: "ORDER_RETURN_INSPECTED",
        entityType: "ORDER",
        entityId: id,
        requestId,
        metadata: { restocked: restock, refundRequired },
      });
      return adminOrder(await this.fullOrder(tx, id), this.clock.now());
    });
  }

  async updateUrgent(
    id: string,
    input: UrgentEligibilityInput,
    actorUserId: string,
    requestId: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await lockOrder(tx, id);
      const order = await tx.order.findUnique({
        where: { id },
        include: { request: true },
      });
      if (!order) throw missing();
      if (order.request?.urgency !== RequestUrgency.URGENT)
        throw fail(
          "ORDER_NOT_URGENT",
          "Urgent eligibility applies only to urgent orders",
        );
      const now = this.clock.now();
      if (
        input.eligibility === UrgentEligibilityStatus.ELIGIBLE &&
        (!input.targetDeadlineAt ||
          input.targetDeadlineAt <= now ||
          !input.estimatedWindowStart ||
          input.estimatedWindowStart < now)
      )
        throw fail(
          "INVALID_URGENT_ESTIMATE",
          "Urgent estimates and deadline must be in the future",
          400,
        );
      await tx.order.update({
        where: { id },
        data: {
          urgentEligibility: input.eligibility,
          urgentEligibilityBasis: input.basis,
          estimatedWindowStart: input.estimatedWindowStart,
          estimatedWindowEnd: input.estimatedWindowEnd,
          targetDeadlineAt: input.targetDeadlineAt,
          delivery: {
            update: {
              estimatedWindowStart: input.estimatedWindowStart,
              estimatedWindowEnd: input.estimatedWindowEnd,
            },
          },
          version: { increment: 1 },
        },
      });
      await tx.urgentFulfillmentHistory.create({
        data: {
          orderId: id,
          fromEligibility: order.urgentEligibility,
          toEligibility: input.eligibility,
          basis: input.basis,
          estimatedWindowStart: input.estimatedWindowStart,
          estimatedWindowEnd: input.estimatedWindowEnd,
          targetDeadlineAt: input.targetDeadlineAt,
          actorUserId,
        },
      });
      await recordAudit(tx, {
        actorUserId,
        action: "URGENT_FULFILLMENT_UPDATED",
        entityType: "ORDER",
        entityId: id,
        requestId,
        metadata: { eligibility: input.eligibility },
      });
      return adminOrder(await this.fullOrder(tx, id), this.clock.now());
    });
  }
}
