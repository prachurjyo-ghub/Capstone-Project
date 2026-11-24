import {
  CreditRequirementStatus,
  InventoryAvailability,
  InventoryReservationEventType,
  ListingModerationStatus,
  ListingPublicationStatus,
  OrderStatus,
  Prisma,
  SourcingRequestStatus,
  SourcingRequestType,
  SupplierAssignmentEventType,
  SupplierAssignmentStatus,
  SupplierBusinessStatus,
  SupplierListingClassification,
  type PrismaClient,
} from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";
import { recordAudit } from "../auth/audit.service.js";
import { enqueueOutbox } from "../communications/outbox.service.js";
import type { CreditService } from "../credits/credit.service.js";
import type { MatchingClock } from "../matching/matching-clock.js";
import type {
  CreatePurchaseRequestInput,
  SupplierPurchaseRequestList,
} from "./purchase-request.schemas.js";

type Tx = Prisma.TransactionClient;

const fail = (code: string, message: string, statusCode = 409) =>
  new AppError(message, { code, statusCode });

function availableStatus(stock: number, reserved: number, minimum: number) {
  const available = stock - reserved;
  if (available <= 0) return InventoryAvailability.OUT_OF_STOCK;
  if (available <= minimum) return InventoryAvailability.LOW_STOCK;
  return InventoryAvailability.IN_STOCK;
}

export class PurchaseRequestService {
  constructor(
    private readonly database: PrismaClient,
    private readonly credits: CreditService,
    private readonly clock: MatchingClock,
  ) {}

  private async customer(userId: string) {
    const customer = await this.database.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer)
      throw fail("CUSTOMER_NOT_FOUND", "Customer profile was not found", 404);
    return customer;
  }

  private async requestNumber(tx: Tx) {
    const rows = await tx.$queryRaw<Array<{ value: bigint }>>`
      SELECT nextval('sourcing_request_number_seq') AS "value"
    `;
    return `RFQ-${this.clock.now().getUTCFullYear()}-${String(rows[0]!.value).padStart(6, "0")}`;
  }

  private async orderNumber(tx: Tx) {
    const rows = await tx.$queryRaw<Array<{ value: bigint }>>`
      SELECT nextval('order_number_seq') AS "value"
    `;
    return `ORD-${this.clock.now().getUTCFullYear()}-${String(rows[0]!.value).padStart(6, "0")}`;
  }

  async create(userId: string, input: CreatePurchaseRequestInput, requestId: string) {
    const customer = await this.customer(userId);
    const existing = await this.database.sourcingRequest.findUnique({
      where: {
        customerId_submissionKey: {
          customerId: customer.id,
          submissionKey: input.idempotencyKey,
        },
      },
      include: { items: true },
    });
    if (existing) return existing;

    const listing = await this.database.supplierInventory.findFirst({
      where: {
        id: input.listingId,
        isActive: true,
        isAvailable: true,
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        moderationStatus: { not: ListingModerationStatus.REJECTED },
        listingClassification: {
          in: [
            SupplierListingClassification.NEW_GENUINE,
            SupplierListingClassification.NEW_AFTERMARKET,
          ],
        },
        availabilityStatus: { in: ["IN_STOCK", "LOW_STOCK"] },
        business: {
          status: SupplierBusinessStatus.ACTIVE,
          members: { some: { isActive: true, leftAt: null } },
          OR: [
            { subscriptionGraceEndsAt: { gt: this.clock.now() } },
            {
              subscriptions: {
                some: {
                  status: "ACTIVE",
                  startsAt: { lte: this.clock.now() },
                  endsAt: { gt: this.clock.now() },
                },
              },
            },
          ],
        },
        product: {
          isActive: true,
          deletedAt: null,
          category: { isActive: true },
          AND: [{ OR: [{ brandId: null }, { brand: { isActive: true } }] }],
        },
      },
      include: {
        product: {
          include: { brand: { select: { name: true } }, numbers: true },
        },
      },
    });
    if (!listing)
      throw fail(
        "FIXED_PRICE_LISTING_NOT_FOUND",
        "This fixed-price listing is not available for purchase requests",
        404,
      );
    if (listing.stockQuantity - listing.reservedQuantity < input.quantity)
      throw fail(
        "LISTING_QUANTITY_UNAVAILABLE",
        "The requested quantity is not currently available",
      );
    const address = await this.database.customerAddress.findFirst({
      where: {
        id: input.deliveryAddressId,
        customerId: customer.id,
        isActive: true,
        deletedAt: null,
      },
    });
    if (!address)
      throw fail("DELIVERY_ADDRESS_NOT_FOUND", "Delivery address was not found", 404);

    const eligibility = await this.credits.listingEligibility(
      listing.businessId,
      listing.unitPrice,
      input.quantity,
    );
    const creditStatus = eligibility.eligible
      ? CreditRequirementStatus.ELIGIBLE
      : CreditRequirementStatus.AWAITING_CREDITS;
    return this.database.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`purchase-request:${customer.id}:${input.idempotencyKey}`}, 0)
        )
      `;
      const duplicate = await tx.sourcingRequest.findUnique({
        where: {
          customerId_submissionKey: {
            customerId: customer.id,
            submissionKey: input.idempotencyKey,
          },
        },
        include: { items: true },
      });
      if (duplicate) return duplicate;
      const created = await tx.sourcingRequest.create({
        data: {
          customerId: customer.id,
          requestNumber: await this.requestNumber(tx),
          requestType: SourcingRequestType.FIXED_PRICE_PURCHASE,
          status: SourcingRequestStatus.SUBMITTED,
          listingId: listing.id,
          targetBusinessId: listing.businessId,
          creditStatus,
          title: `Purchase request: ${listing.product.name}`,
          customerNotes: input.customerNote,
          deliveryAddressId: address.id,
          deliverySnapshot: {
            source: "SAVED",
            savedAddressId: address.id,
            recipientName: address.recipientName ?? "",
            phone: address.phone ?? "",
            addressLine: address.addressLine,
            addressLine2: address.addressLine2,
            area: address.area ?? "",
            city: address.city,
            postalCode: address.postalCode,
            landmark: address.landmark,
            deliveryInstructions: address.deliveryInstructions,
          },
          submissionKey: input.idempotencyKey,
          submittedAt: this.clock.now(),
          items: {
            create: {
              lineNumber: 1,
              productId: listing.productId,
              categoryId: listing.product.categoryId,
              description: listing.product.name,
              partNumber:
                listing.product.numbers.find((number) => number.isPrimary)?.partNumber ??
                listing.product.numbers[0]?.partNumber,
              quantity: input.quantity,
              customerNotes: input.customerNote,
            },
          },
          assignments: {
            create: {
              businessId: listing.businessId,
              history: {
                create: {
                  eventType: SupplierAssignmentEventType.ASSIGNED,
                  actorUserId: userId,
                  reason: "Fixed-price purchase request routed to listing supplier",
                },
              },
            },
          },
          statusHistory: {
            create: {
              toStatus: SourcingRequestStatus.SUBMITTED,
              actorUserId: userId,
              note: "Fixed-price purchase request submitted",
            },
          },
        },
        include: { items: true },
      });
      await recordAudit(tx, {
        actorUserId: userId,
        action: "PURCHASE_REQUEST_CREATED",
        entityType: "SOURCING_REQUEST",
        entityId: created.id,
        requestId,
        metadata: {
          listingId: listing.id,
          businessId: listing.businessId,
          quantity: input.quantity,
          creditStatus,
        },
      });
      await enqueueOutbox(tx, {
        eventType: "PURCHASE_REQUEST_CREATED",
        aggregateType: "SOURCING_REQUEST",
        aggregateId: created.id,
        eventKey: `purchase-request:${created.id}:created`,
        payload: { businessId: listing.businessId, requestId: created.id },
      });
      return created;
    });
  }

  async listSupplier(businessId: string, input: SupplierPurchaseRequestList) {
    const where: Prisma.SourcingRequestWhereInput = {
      requestType: SourcingRequestType.FIXED_PRICE_PURCHASE,
      targetBusinessId: businessId,
      status: input.status,
      creditStatus: input.creditStatus,
    };
    const [items, total, policy, wallet] = await this.database.$transaction([
      this.database.sourcingRequest.findMany({
        where,
        select: {
          id: true,
          requestNumber: true,
          status: true,
          creditStatus: true,
          submittedAt: true,
          customerNotes: true,
          items: {
            select: {
              description: true,
              partNumber: true,
              quantity: true,
              product: { select: { id: true, name: true, catalogueCode: true } },
            },
          },
          listing: {
            select: {
              id: true,
              sku: true,
              unitPrice: true,
              listingClassification: true,
            },
          },
          orders: {
            select: { id: true, orderNumber: true, status: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.database.sourcingRequest.count({ where }),
      this.database.commissionPolicy.findFirst({
        where: { isActive: true, effectiveFrom: { lte: this.clock.now() } },
        orderBy: { effectiveFrom: "desc" },
        select: { rateBps: true },
      }),
      this.database.supplierWallet.findUnique({
        where: { businessId },
        select: { availableCredit: true },
      }),
    ]);
    return {
      items: items.map((item) => {
        const quantity = item.items.reduce((sum, line) => sum + line.quantity, 0);
        const required =
          item.listing && policy
            ? item.listing.unitPrice
                .mul(quantity)
                .mul(policy.rateBps)
                .div(10_000)
                .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
            : null;
        const available = wallet?.availableCredit ?? new Prisma.Decimal(0);
        return {
          ...item,
          commissionRequirement: {
            requiredCredit: required?.toFixed(2) ?? null,
            availableCredit: available.toFixed(2),
            additionalCreditNeeded: required
              ? (required.greaterThan(available)
                  ? required.minus(available)
                  : new Prisma.Decimal(0)
                ).toFixed(2)
              : null,
            rateBps: policy?.rateBps ?? null,
          },
        };
      }),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async confirm(
    businessId: string,
    sourcingRequestId: string,
    actorUserId: string,
    requestId: string,
    note?: string,
  ) {
    const result = await this.database.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`fixed-purchase-confirm:${sourcingRequestId}`}, 0)
        )
      `;
      const request = await tx.sourcingRequest.findFirst({
        where: {
          id: sourcingRequestId,
          requestType: SourcingRequestType.FIXED_PRICE_PURCHASE,
          targetBusinessId: businessId,
        },
        include: {
          items: true,
          listing: { include: { product: { include: { brand: true } } } },
          orders: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      });
      if (!request || !request.listing)
        throw fail("PURCHASE_REQUEST_NOT_FOUND", "Purchase request was not found", 404);
      if (
        !(
          [
            SourcingRequestStatus.SUBMITTED,
            SourcingRequestStatus.MATCHING,
            SourcingRequestStatus.QUOTING,
            SourcingRequestStatus.AWAITING_CUSTOMER,
            SourcingRequestStatus.ORDERED,
          ] as SourcingRequestStatus[]
        ).includes(request.status)
      )
        throw fail(
          "PURCHASE_REQUEST_NOT_CONFIRMABLE",
          "Purchase request cannot be confirmed",
        );
      const listing = request.listing;
      const item = request.items[0];
      if (!item)
        throw fail("PURCHASE_REQUEST_INVALID", "Purchase request has no line item");
      await tx.$queryRaw`
        SELECT id FROM "supplier_inventory"
        WHERE id = ${listing.id}::uuid FOR UPDATE
      `;
      const currentListing = await tx.supplierInventory.findUniqueOrThrow({
        where: { id: listing.id },
      });
      const existingOrder = request.orders[0];
      if (existingOrder?.status === OrderStatus.CONFIRMED) {
        return { order: existingOrder, shortage: null };
      }
      if (currentListing.stockQuantity - currentListing.reservedQuantity < item.quantity)
        throw fail("LISTING_QUANTITY_UNAVAILABLE", "Listing stock is insufficient");

      let orderId = existingOrder?.id;
      if (!orderId) {
        const lineTotal = currentListing.unitPrice.mul(item.quantity);
        const order = await tx.order.create({
          data: {
            orderNumber: await this.orderNumber(tx),
            customerId: request.customerId,
            businessId,
            requestId: request.id,
            deliveryAddressId: request.deliveryAddressId,
            status: OrderStatus.PENDING_SUPPLIER_CONFIRMATION,
            supplierSubtotal: lineTotal,
            customerTotal: lineTotal,
            supplierPayable: lineTotal,
            deliverySnapshot: request.deliverySnapshot ?? Prisma.JsonNull,
            externalSourcingRequired: false,
            items: {
              create: {
                requestItemId: item.id,
                productId: currentListing.productId,
                inventoryId: currentListing.id,
                lineNumber: 1,
                description: item.description,
                brand: request.listing.product.brand?.name,
                partNumber: item.partNumber,
                condition: currentListing.condition,
                quantity: item.quantity,
                supplierUnitPrice: currentListing.unitPrice,
                customerUnitPrice: currentListing.unitPrice,
                supplierLineTotal: lineTotal,
                customerLineTotal: lineTotal,
              },
            },
            delivery: {
              create: {
                recipientSnapshot: request.deliverySnapshot ?? Prisma.JsonNull,
              },
            },
            fulfillmentHistory: {
              create: {
                toStatus: OrderStatus.PENDING_SUPPLIER_CONFIRMATION,
                actorUserId,
                note: "Fixed-price request awaiting credit reservation",
              },
            },
          },
        });
        orderId = order.id;
      }
      const commission = await this.credits.reserveOrderInTransaction(
        tx,
        orderId,
        actorUserId,
        requestId,
      );
      if (commission.shortage) {
        return {
          order: await tx.order.findUniqueOrThrow({ where: { id: orderId } }),
          shortage: commission,
        };
      }

      const updatedListing = await tx.supplierInventory.update({
        where: { id: currentListing.id },
        data: {
          reservedQuantity: { increment: item.quantity },
          availabilityStatus: availableStatus(
            currentListing.stockQuantity,
            currentListing.reservedQuantity + item.quantity,
            currentListing.minimumStock,
          ),
          version: { increment: 1 },
        },
      });
      const orderItem = await tx.orderItem.findFirstOrThrow({
        where: { orderId, inventoryId: currentListing.id },
      });
      await tx.inventoryReservation.upsert({
        where: { orderItemId: orderItem.id },
        update: {},
        create: {
          orderItemId: orderItem.id,
          businessId,
          inventoryId: updatedListing.id,
          quantity: item.quantity,
          history: {
            create: {
              eventType: InventoryReservationEventType.RESERVED,
              quantity: item.quantity,
              reason: "Fixed-price purchase request confirmed",
              actorUserId,
            },
          },
        },
      });
      const confirmed = await tx.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.CONFIRMED,
          confirmedAt: this.clock.now(),
          supplierAvailabilityConfirmedAt: this.clock.now(),
          supplierAvailabilityConfirmedBy: actorUserId,
          version: { increment: 1 },
        },
      });
      await tx.fulfillmentStatusHistory.create({
        data: {
          orderId,
          fromStatus: OrderStatus.PENDING_SUPPLIER_CONFIRMATION,
          toStatus: OrderStatus.CONFIRMED,
          actorUserId,
          note: note ?? "Supplier confirmed fixed-price purchase request",
        },
      });
      await tx.sourcingRequest.update({
        where: { id: request.id },
        data: {
          status: SourcingRequestStatus.ORDERED,
          creditStatus: CreditRequirementStatus.RESERVED,
          version: { increment: 1 },
        },
      });
      await tx.requestStatusHistory.create({
        data: {
          requestId: request.id,
          fromStatus: request.status,
          toStatus: SourcingRequestStatus.ORDERED,
          actorUserId,
          note: "Supplier confirmed and commission credits were reserved",
        },
      });
      await tx.supplierRequestAssignment.updateMany({
        where: { requestId: request.id, businessId },
        data: {
          status: SupplierAssignmentStatus.VIEWED,
          viewedAt: this.clock.now(),
        },
      });
      await recordAudit(tx, {
        actorUserId,
        action: "PURCHASE_REQUEST_CONFIRMED",
        entityType: "ORDER",
        entityId: confirmed.id,
        requestId,
        metadata: { sourcingRequestId: request.id, businessId },
      });
      await enqueueOutbox(tx, {
        eventType: "ORDER_CONFIRMED",
        aggregateType: "ORDER",
        aggregateId: confirmed.id,
        eventKey: `order:${confirmed.id}:confirmed`,
        payload: { businessId, requestId: request.id },
      });
      return { order: confirmed, shortage: null };
    });
    if (result.shortage) {
      throw fail(
        "INSUFFICIENT_COMMISSION_CREDITS",
        `Supplier needs BDT ${result.shortage.requiredCredit.toFixed(2)} available credits; the request remains pending`,
      );
    }
    return result.order;
  }
}
