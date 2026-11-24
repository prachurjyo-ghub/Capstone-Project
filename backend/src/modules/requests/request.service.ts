import {
  AttachmentKind,
  Prisma,
  QuotationStatus,
  SourcingRequestStatus,
  UserRole,
  SupplierAssignmentEventType,
  SourcingRequestType,
  type PrismaClient,
} from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";
import { recordAudit } from "../auth/audit.service.js";
import { enqueueOutbox } from "../communications/outbox.service.js";
import type { RequestAttachmentStorage } from "./attachment-storage.js";
import { MAX_REQUEST_PHOTOS, validateRequestImage } from "./image-validation.js";
import type {
  AdminRequestListQuery,
  CreateRequestInput,
  RequestItemInput,
  RequestListQuery,
  UpdateRequestInput,
  UpdateRequestItemInput,
} from "./request.schemas.js";

const customerRequestSelect = {
  id: true,
  requestNumber: true,
  status: true,
  urgency: true,
  requestType: true,
  creditStatus: true,
  title: true,
  customerNotes: true,
  neededByAt: true,
  vehicleId: true,
  deliveryAddressId: true,
  vehicleSnapshot: true,
  deliverySnapshot: true,
  submittedAt: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  updatedAt: true,
  listing: {
    select: {
      id: true,
      sku: true,
      unitPrice: true,
      listingClassification: true,
      product: { select: { id: true, name: true, catalogueCode: true } },
    },
  },
  targetBusiness: {
    select: { id: true, businessCode: true, displayName: true },
  },
  items: {
    select: {
      id: true,
      lineNumber: true,
      description: true,
      partNumber: true,
      quantity: true,
      customerNotes: true,
      product: {
        select: { id: true, catalogueCode: true, name: true, isActive: true },
      },
      category: { select: { id: true, name: true, slug: true, isActive: true } },
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { lineNumber: "asc" },
  },
  attachments: {
    select: {
      id: true,
      requestItemId: true,
      kind: true,
      fileName: true,
      mimeType: true,
      byteSize: true,
      width: true,
      height: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  statusHistory: {
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.SourcingRequestSelect;

const adminRequestSelect = {
  ...customerRequestSelect,
  statusHistory: {
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      note: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  customer: {
    select: {
      id: true,
      fullName: true,
      user: { select: { id: true, email: true, phone: true } },
    },
  },
} satisfies Prisma.SourcingRequestSelect;

type CustomerRequest = Prisma.SourcingRequestGetPayload<{
  select: typeof customerRequestSelect;
}>;
type AdminRequest = Prisma.SourcingRequestGetPayload<{
  select: typeof adminRequestSelect;
}>;

export type AttachmentViewer =
  { kind: "CUSTOMER"; userId: string } | { kind: "ADMIN"; userId: string };

type VehicleSnapshot = {
  source: "SAVED" | "MANUAL";
  savedVehicleId: string | null;
  make: string;
  model: string;
  year: number | null;
  variant: string | null;
  registrationNumber: string | null;
  chassisVin: string | null;
  engineInfo: string | null;
};

type DeliverySnapshot = {
  source: "SAVED" | "MANUAL";
  savedAddressId: string | null;
  recipientName: string;
  phone: string;
  addressLine: string;
  addressLine2: string | null;
  area: string;
  city: string;
  postalCode: string | null;
  landmark: string | null;
  deliveryInstructions: string | null;
};

const cancellableStatuses: SourcingRequestStatus[] = [
  SourcingRequestStatus.DRAFT,
  SourcingRequestStatus.SUBMITTED,
  SourcingRequestStatus.MATCHING,
  SourcingRequestStatus.QUOTING,
  SourcingRequestStatus.AWAITING_CUSTOMER,
];

function requestNotFound(): AppError {
  return new AppError("Sourcing request was not found", {
    code: "SOURCING_REQUEST_NOT_FOUND",
    statusCode: 404,
  });
}

function draftRequired(): AppError {
  return new AppError("Only draft requests can be changed", {
    code: "REQUEST_NOT_EDITABLE",
    statusCode: 409,
  });
}

function validation(message: string, details: unknown[] = []): AppError {
  return new AppError(message, {
    code: "REQUEST_SUBMISSION_INVALID",
    statusCode: 400,
    details,
  });
}

function serializeCustomerRequest(request: CustomerRequest) {
  const listing = request.listing
    ? (({ sku: _sku, unitPrice, ...safeListing }) => ({
        ...safeListing,
        fixedPrice:
          safeListing.listingClassification === "USED" ? null : unitPrice.toFixed(2),
      }))(request.listing)
    : null;
  return {
    ...request,
    listing,
    targetBusiness: request.targetBusiness
      ? { displayName: request.targetBusiness.displayName }
      : null,
  };
}

function serializeAdminRequest(request: AdminRequest) {
  return request;
}

export class CustomerRequestService {
  constructor(
    private readonly database: PrismaClient,
    private readonly attachmentStorage: RequestAttachmentStorage,
  ) {}

  private async customerId(userId: string): Promise<string> {
    const customer = await this.database.user.findFirst({
      where: { id: userId, role: UserRole.CUSTOMER },
      select: { customerProfile: { select: { id: true } } },
    });
    if (!customer?.customerProfile) throw requestNotFound();
    return customer.customerProfile.id;
  }

  private async lockRequest(tx: Prisma.TransactionClient, requestId: string) {
    await tx.$queryRaw`
      SELECT "id"
      FROM "sourcing_requests"
      WHERE "id" = ${requestId}::uuid
      FOR UPDATE
    `;
  }

  private async lockedOwnedDraft(
    tx: Prisma.TransactionClient,
    requestId: string,
    customerId: string,
  ) {
    await this.lockRequest(tx, requestId);
    const request = await tx.sourcingRequest.findFirst({
      where: { id: requestId, customerId },
    });
    if (!request) throw requestNotFound();
    if (request.status !== SourcingRequestStatus.DRAFT) throw draftRequired();
    return request;
  }

  private async nextRequestNumber(tx: Prisma.TransactionClient): Promise<string> {
    const rows = await tx.$queryRaw<Array<{ value: bigint }>>`
      SELECT nextval('sourcing_request_number_seq') AS "value"
    `;
    const value = rows[0]?.value;
    if (value === undefined) throw new Error("Could not allocate request number");
    const year = new Date().getUTCFullYear();
    return `RFQ-${year}-${value.toString().padStart(6, "0")}`;
  }

  private async validateSavedReferences(
    tx: Prisma.TransactionClient,
    customerId: string,
    input: Pick<CreateRequestInput, "vehicleId" | "deliveryAddressId">,
  ) {
    if (input.vehicleId) {
      const vehicle = await tx.vehicle.findFirst({
        where: {
          id: input.vehicleId,
          customerId,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!vehicle) throw requestNotFound();
    }
    if (input.deliveryAddressId) {
      const address = await tx.customerAddress.findFirst({
        where: {
          id: input.deliveryAddressId,
          customerId,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!address) throw requestNotFound();
    }
  }

  private async validateCatalogueReferences(
    tx: Prisma.TransactionClient,
    items: Array<Pick<RequestItemInput, "productId" | "categoryId">>,
  ) {
    for (const item of items) {
      if (item.productId) {
        const product = await tx.product.findFirst({
          where: { id: item.productId, isActive: true, deletedAt: null },
          select: { id: true },
        });
        if (!product) {
          throw new AppError("Catalogue product was not found", {
            code: "CATALOGUE_PRODUCT_NOT_FOUND",
            statusCode: 400,
          });
        }
      }
      if (item.categoryId) {
        const category = await tx.partCategory.findFirst({
          where: { id: item.categoryId, isActive: true },
          select: { id: true },
        });
        if (!category) {
          throw new AppError("Part category was not found", {
            code: "PART_CATEGORY_NOT_FOUND",
            statusCode: 400,
          });
        }
      }
    }
  }

  private manualVehicle(input: CreateRequestInput | UpdateRequestInput) {
    return input.manualVehicle === undefined
      ? undefined
      : input.manualVehicle === null
        ? Prisma.JsonNull
        : ({
            source: "MANUAL",
            savedVehicleId: null,
            make: input.manualVehicle.make,
            model: input.manualVehicle.model,
            year: input.manualVehicle.year ?? null,
            variant: input.manualVehicle.variant ?? null,
            registrationNumber: input.manualVehicle.registrationNumber ?? null,
            chassisVin: input.manualVehicle.chassisVin ?? null,
            engineInfo: input.manualVehicle.engineInfo ?? null,
          } satisfies VehicleSnapshot);
  }

  private manualDelivery(input: CreateRequestInput | UpdateRequestInput) {
    return input.manualDelivery === undefined
      ? undefined
      : input.manualDelivery === null
        ? Prisma.JsonNull
        : ({
            source: "MANUAL",
            savedAddressId: null,
            recipientName: input.manualDelivery.recipientName,
            phone: input.manualDelivery.phone,
            addressLine: input.manualDelivery.addressLine,
            addressLine2: input.manualDelivery.addressLine2 ?? null,
            area: input.manualDelivery.area,
            city: input.manualDelivery.city,
            postalCode: input.manualDelivery.postalCode ?? null,
            landmark: input.manualDelivery.landmark ?? null,
            deliveryInstructions: input.manualDelivery.deliveryInstructions ?? null,
          } satisfies DeliverySnapshot);
  }

  private requestData(input: CreateRequestInput | UpdateRequestInput) {
    return {
      title: input.title,
      customerNotes: input.customerNotes,
      urgency: input.urgency,
      neededByAt: input.neededByAt,
      vehicleId: input.vehicleId,
      deliveryAddressId: input.deliveryAddressId,
      vehicleSnapshot: this.manualVehicle(input),
      deliverySnapshot: this.manualDelivery(input),
      ...(input.vehicleId ? { vehicleSnapshot: Prisma.JsonNull } : {}),
      ...(input.manualVehicle ? { vehicleId: null } : {}),
      ...(input.deliveryAddressId ? { deliverySnapshot: Prisma.JsonNull } : {}),
      ...(input.manualDelivery ? { deliveryAddressId: null } : {}),
    };
  }

  async createDraft(userId: string, input: CreateRequestInput, requestId: string) {
    const customerId = await this.customerId(userId);
    return this.database.$transaction(async (tx) => {
      await this.validateSavedReferences(tx, customerId, input);
      const targetListing = input.listingId
        ? await tx.supplierInventory.findFirst({
            where: {
              id: input.listingId,
              listingClassification: "USED",
              isActive: true,
              isAvailable: true,
              publicationStatus: "PUBLISHED",
              moderationStatus: { not: "REJECTED" },
              availabilityStatus: { in: ["IN_STOCK", "LOW_STOCK"] },
              stockQuantity: { gt: 0 },
              product: {
                isActive: true,
                deletedAt: null,
                category: { isActive: true },
                AND: [{ OR: [{ brandId: null }, { brand: { isActive: true } }] }],
              },
              business: {
                status: "ACTIVE",
                members: { some: { isActive: true, leftAt: null } },
                OR: [
                  { subscriptionGraceEndsAt: { gt: new Date() } },
                  {
                    subscriptions: {
                      some: {
                        status: "ACTIVE",
                        startsAt: { lte: new Date() },
                        endsAt: { gt: new Date() },
                      },
                    },
                  },
                ],
              },
            },
            include: {
              product: {
                include: {
                  numbers: { orderBy: { isPrimary: "desc" } },
                },
              },
            },
          })
        : null;
      if (input.listingId && !targetListing) {
        throw new AppError("Used listing was not found or is not RFQ eligible", {
          code: "USED_LISTING_NOT_RFQ_ELIGIBLE",
          statusCode: 400,
        });
      }
      const items =
        targetListing && input.items.length === 0
          ? [
              {
                description: targetListing.product.name,
                partNumber: targetListing.product.numbers[0]?.partNumber ?? null,
                productId: targetListing.productId,
                categoryId: targetListing.product.categoryId,
                quantity: 1,
                customerNotes: null,
              },
            ]
          : input.items;
      await this.validateCatalogueReferences(tx, items);
      const request = await tx.sourcingRequest.create({
        data: {
          customerId,
          requestNumber: await this.nextRequestNumber(tx),
          status: SourcingRequestStatus.DRAFT,
          requestType: input.requestType,
          listingId: targetListing?.id,
          targetBusinessId: targetListing?.businessId,
          ...this.requestData(input),
          items: {
            create: items.map((item, index) => ({
              ...item,
              lineNumber: index + 1,
            })),
          },
          statusHistory: {
            create: {
              fromStatus: null,
              toStatus: SourcingRequestStatus.DRAFT,
              actorUserId: userId,
            },
          },
        },
        select: customerRequestSelect,
      });
      await recordAudit(tx, {
        actorUserId: userId,
        action: "CUSTOMER_REQUEST_DRAFT_CREATED",
        entityType: "SOURCING_REQUEST",
        entityId: request.id,
        requestId,
        metadata: { itemCount: items.length, urgency: request.urgency },
      });
      return serializeCustomerRequest(request);
    });
  }

  async listCustomerRequests(userId: string, query: RequestListQuery) {
    const customerId = await this.customerId(userId);
    const where: Prisma.SourcingRequestWhereInput = {
      customerId,
      status: query.status,
      urgency: query.urgency,
      requestType: query.requestType,
    };
    const [rows, total] = await this.database.$transaction([
      this.database.sourcingRequest.findMany({
        where,
        select: customerRequestSelect,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.sourcingRequest.count({ where }),
    ]);
    return {
      items: rows.map(serializeCustomerRequest),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getCustomerRequest(userId: string, sourcingRequestId: string) {
    const customerId = await this.customerId(userId);
    const request = await this.database.sourcingRequest.findFirst({
      where: { id: sourcingRequestId, customerId },
      select: customerRequestSelect,
    });
    if (!request) throw requestNotFound();
    return serializeCustomerRequest(request);
  }

  async updateDraft(
    userId: string,
    sourcingRequestId: string,
    input: UpdateRequestInput,
    requestId: string,
  ) {
    const customerId = await this.customerId(userId);
    await this.database.$transaction(async (tx) => {
      await this.lockedOwnedDraft(tx, sourcingRequestId, customerId);
      await this.validateSavedReferences(tx, customerId, input);
      const request = await tx.sourcingRequest.update({
        where: { id: sourcingRequestId },
        data: { ...this.requestData(input), version: { increment: 1 } },
        select: customerRequestSelect,
      });
      await recordAudit(tx, {
        actorUserId: userId,
        action: "CUSTOMER_REQUEST_DRAFT_UPDATED",
        entityType: "SOURCING_REQUEST",
        entityId: sourcingRequestId,
        requestId,
        metadata: { fields: Object.keys(input) },
      });
      return serializeCustomerRequest(request);
    });
    return this.getCustomerRequest(userId, sourcingRequestId);
  }

  async addItem(
    userId: string,
    sourcingRequestId: string,
    input: RequestItemInput,
    requestId: string,
  ) {
    const customerId = await this.customerId(userId);
    return this.database.$transaction(async (tx) => {
      await this.lockedOwnedDraft(tx, sourcingRequestId, customerId);
      await this.validateCatalogueReferences(tx, [input]);
      const count = await tx.sourcingRequestItem.count({
        where: { requestId: sourcingRequestId },
      });
      if (count >= 50) {
        throw new AppError("A request may contain at most 50 items", {
          code: "REQUEST_ITEM_LIMIT_EXCEEDED",
          statusCode: 400,
        });
      }
      const item = await tx.sourcingRequestItem.create({
        data: { requestId: sourcingRequestId, lineNumber: count + 1, ...input },
      });
      await tx.sourcingRequest.update({
        where: { id: sourcingRequestId },
        data: { version: { increment: 1 } },
      });
      await recordAudit(tx, {
        actorUserId: userId,
        action: "CUSTOMER_REQUEST_ITEM_ADDED",
        entityType: "SOURCING_REQUEST_ITEM",
        entityId: item.id,
        requestId,
        metadata: { requestId: sourcingRequestId, quantity: item.quantity },
      });
    });
    return this.getCustomerRequest(userId, sourcingRequestId);
  }

  async updateItem(
    userId: string,
    sourcingRequestId: string,
    itemId: string,
    input: UpdateRequestItemInput,
    requestId: string,
  ) {
    const customerId = await this.customerId(userId);
    await this.database.$transaction(async (tx) => {
      await this.lockedOwnedDraft(tx, sourcingRequestId, customerId);
      await this.validateCatalogueReferences(tx, [input]);
      const updated = await tx.sourcingRequestItem.updateMany({
        where: { id: itemId, requestId: sourcingRequestId },
        data: input,
      });
      if (updated.count !== 1) throw requestNotFound();
      await tx.sourcingRequest.update({
        where: { id: sourcingRequestId },
        data: { version: { increment: 1 } },
      });
      await recordAudit(tx, {
        actorUserId: userId,
        action: "CUSTOMER_REQUEST_ITEM_UPDATED",
        entityType: "SOURCING_REQUEST_ITEM",
        entityId: itemId,
        requestId,
        metadata: { requestId: sourcingRequestId, fields: Object.keys(input) },
      });
    });
    return this.getCustomerRequest(userId, sourcingRequestId);
  }

  private async cleanupFiles(
    storageKeys: string[],
    actorUserId: string,
    sourcingRequestId: string,
    requestId: string,
  ) {
    for (const storageKey of storageKeys) {
      try {
        await this.attachmentStorage.delete(storageKey);
      } catch {
        try {
          await recordAudit(this.database, {
            actorUserId,
            action: "REQUEST_ATTACHMENT_CLEANUP_PENDING",
            entityType: "SOURCING_REQUEST",
            entityId: sourcingRequestId,
            requestId,
          });
        } catch {
          // Cleanup and its safe audit are best-effort after the database mutation commits.
        }
      }
    }
  }

  async removeItem(
    userId: string,
    sourcingRequestId: string,
    itemId: string,
    requestId: string,
  ) {
    const customerId = await this.customerId(userId);
    const storageKeys = await this.database.$transaction(async (tx) => {
      await this.lockedOwnedDraft(tx, sourcingRequestId, customerId);
      const item = await tx.sourcingRequestItem.findFirst({
        where: { id: itemId, requestId: sourcingRequestId },
        select: {
          id: true,
          attachments: { select: { id: true, storageKey: true } },
        },
      });
      if (!item) throw requestNotFound();
      await tx.requestAttachment.deleteMany({ where: { requestItemId: itemId } });
      await tx.sourcingRequestItem.delete({ where: { id: itemId } });
      const remaining = await tx.sourcingRequestItem.findMany({
        where: { requestId: sourcingRequestId },
        orderBy: { lineNumber: "asc" },
        select: { id: true },
      });
      for (const [index, current] of remaining.entries()) {
        await tx.sourcingRequestItem.update({
          where: { id: current.id },
          data: { lineNumber: -(index + 1) },
        });
      }
      for (const [index, current] of remaining.entries()) {
        await tx.sourcingRequestItem.update({
          where: { id: current.id },
          data: { lineNumber: index + 1 },
        });
      }
      await tx.sourcingRequest.update({
        where: { id: sourcingRequestId },
        data: { version: { increment: 1 } },
      });
      await recordAudit(tx, {
        actorUserId: userId,
        action: "CUSTOMER_REQUEST_ITEM_REMOVED",
        entityType: "SOURCING_REQUEST_ITEM",
        entityId: itemId,
        requestId,
        metadata: { requestId: sourcingRequestId },
      });
      return item.attachments.map((attachment) => attachment.storageKey);
    });
    await this.cleanupFiles(storageKeys, userId, sourcingRequestId, requestId);
    return this.getCustomerRequest(userId, sourcingRequestId);
  }

  async addAttachment(
    userId: string,
    sourcingRequestId: string,
    requestItemId: string | undefined,
    data: Buffer,
    originalName: string | undefined,
    requestId: string,
  ) {
    const customerId = await this.customerId(userId);
    const image = validateRequestImage(data, originalName);
    await this.attachmentStorage.put(image);
    try {
      return await this.database.$transaction(async (tx) => {
        await this.lockedOwnedDraft(tx, sourcingRequestId, customerId);
        const count = await tx.requestAttachment.count({
          where: { requestId: sourcingRequestId },
        });
        if (count >= MAX_REQUEST_PHOTOS) {
          throw new AppError(
            `A request may contain at most ${MAX_REQUEST_PHOTOS} photos`,
            {
              code: "REQUEST_PHOTO_LIMIT_EXCEEDED",
              statusCode: 400,
            },
          );
        }
        if (requestItemId) {
          const item = await tx.sourcingRequestItem.findFirst({
            where: { id: requestItemId, requestId: sourcingRequestId },
            select: { id: true },
          });
          if (!item) throw requestNotFound();
        }
        const attachment = await tx.requestAttachment.create({
          data: {
            requestId: sourcingRequestId,
            requestItemId,
            kind: AttachmentKind.PHOTO,
            fileName: image.fileName,
            mimeType: image.mimeType,
            storageKey: image.storageKey,
            byteSize: image.byteSize,
            width: image.width,
            height: image.height,
            contentSha256: image.contentSha256,
          },
          select: {
            id: true,
            requestItemId: true,
            kind: true,
            fileName: true,
            mimeType: true,
            byteSize: true,
            width: true,
            height: true,
            createdAt: true,
          },
        });
        await tx.sourcingRequest.update({
          where: { id: sourcingRequestId },
          data: { version: { increment: 1 } },
        });
        await recordAudit(tx, {
          actorUserId: userId,
          action: "CUSTOMER_REQUEST_PHOTO_ADDED",
          entityType: "REQUEST_ATTACHMENT",
          entityId: attachment.id,
          requestId,
          metadata: {
            requestId: sourcingRequestId,
            requestItemId: requestItemId ?? null,
            byteSize: image.byteSize,
            mimeType: image.mimeType,
          },
        });
        return attachment;
      });
    } catch (error) {
      await this.cleanupFiles([image.storageKey], userId, sourcingRequestId, requestId);
      throw error;
    }
  }

  async removeAttachment(
    userId: string,
    sourcingRequestId: string,
    attachmentId: string,
    requestId: string,
  ) {
    const customerId = await this.customerId(userId);
    const storageKey = await this.database.$transaction(async (tx) => {
      await this.lockedOwnedDraft(tx, sourcingRequestId, customerId);
      const attachment = await tx.requestAttachment.findFirst({
        where: { id: attachmentId, requestId: sourcingRequestId },
        select: { storageKey: true },
      });
      if (!attachment) throw requestNotFound();
      await tx.requestAttachment.delete({ where: { id: attachmentId } });
      await tx.sourcingRequest.update({
        where: { id: sourcingRequestId },
        data: { version: { increment: 1 } },
      });
      await recordAudit(tx, {
        actorUserId: userId,
        action: "CUSTOMER_REQUEST_PHOTO_REMOVED",
        entityType: "REQUEST_ATTACHMENT",
        entityId: attachmentId,
        requestId,
        metadata: { requestId: sourcingRequestId },
      });
      return attachment.storageKey;
    });
    await this.cleanupFiles([storageKey], userId, sourcingRequestId, requestId);
    return { id: attachmentId, deleted: true };
  }

  private async savedVehicleSnapshot(
    tx: Prisma.TransactionClient,
    customerId: string,
    vehicleId: string,
  ): Promise<VehicleSnapshot> {
    const vehicle = await tx.vehicle.findFirst({
      where: { id: vehicleId, customerId, isActive: true, deletedAt: null },
    });
    if (!vehicle) throw validation("A current saved vehicle is required");
    return {
      source: "SAVED",
      savedVehicleId: vehicle.id,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      variant: vehicle.variant,
      registrationNumber: vehicle.registrationNumber,
      chassisVin: vehicle.chassisVin,
      engineInfo: vehicle.engineInfo,
    };
  }

  private async savedDeliverySnapshot(
    tx: Prisma.TransactionClient,
    customerId: string,
    addressId: string,
  ): Promise<DeliverySnapshot> {
    const address = await tx.customerAddress.findFirst({
      where: { id: addressId, customerId, isActive: true, deletedAt: null },
    });
    if (!address) throw validation("A current saved delivery address is required");
    if (!address.recipientName || !address.phone || !address.area) {
      throw validation("Saved delivery address is missing required delivery information");
    }
    return {
      source: "SAVED",
      savedAddressId: address.id,
      recipientName: address.recipientName,
      phone: address.phone,
      addressLine: address.addressLine,
      addressLine2: address.addressLine2,
      area: address.area,
      city: address.city,
      postalCode: address.postalCode,
      landmark: address.landmark,
      deliveryInstructions: address.deliveryInstructions,
    };
  }

  private validateManualVehicle(value: unknown): VehicleSnapshot {
    const snapshot = value as VehicleSnapshot | null;
    if (!snapshot?.make.trim() || !snapshot.model.trim()) {
      throw validation("Vehicle make and model are required before submission");
    }
    return snapshot;
  }

  private validateManualDelivery(value: unknown): DeliverySnapshot {
    const snapshot = value as DeliverySnapshot | null;
    if (
      !snapshot?.recipientName.trim() ||
      !snapshot.phone.trim() ||
      !snapshot.addressLine.trim() ||
      !snapshot.area.trim() ||
      !snapshot.city.trim()
    ) {
      throw validation("Complete delivery information is required before submission");
    }
    return snapshot;
  }

  async submit(
    userId: string,
    sourcingRequestId: string,
    idempotencyKey: string,
    requestId: string,
  ) {
    const customerId = await this.customerId(userId);
    await this.database.$transaction(async (tx) => {
      await this.lockRequest(tx, sourcingRequestId);
      const request = await tx.sourcingRequest.findFirst({
        where: { id: sourcingRequestId, customerId },
        include: { items: true, attachments: true },
      });
      if (!request) throw requestNotFound();
      if (request.status !== SourcingRequestStatus.DRAFT) {
        if (request.submissionKey === idempotencyKey) return;
        throw new AppError("Request has already left draft status", {
          code: "REQUEST_ALREADY_SUBMITTED",
          statusCode: 409,
        });
      }
      if (request.items.length === 0) {
        throw validation("At least one request item is required");
      }
      if (request.neededByAt && request.neededByAt <= new Date()) {
        throw validation("neededByAt must be in the future");
      }
      const requestLevelPhotos = request.attachments.filter(
        (attachment) => !attachment.requestItemId,
      ).length;
      const missingItems = request.items.filter((item) => {
        const itemPhotos = request.attachments.some(
          (attachment) => attachment.requestItemId === item.id,
        );
        const singleItemRequestPhoto =
          request.items.length === 1 && requestLevelPhotos > 0;
        return (
          !item.description.trim() &&
          !item.partNumber?.trim() &&
          !itemPhotos &&
          !singleItemRequestPhoto
        );
      });
      if (missingItems.length > 0) {
        throw validation(
          "Every item needs a description, part number, or associated photo",
          missingItems.map((item) => ({ itemId: item.id })),
        );
      }
      await this.validateCatalogueReferences(tx, request.items);
      const vehicleSnapshot = request.vehicleId
        ? await this.savedVehicleSnapshot(tx, customerId, request.vehicleId)
        : this.validateManualVehicle(request.vehicleSnapshot);
      const deliverySnapshot = request.deliveryAddressId
        ? await this.savedDeliverySnapshot(tx, customerId, request.deliveryAddressId)
        : this.validateManualDelivery(request.deliverySnapshot);
      const now = new Date();
      const targetedUsedRfq =
        request.requestType === SourcingRequestType.USED_PART_RFQ &&
        !!request.targetBusinessId;
      const submittedStatus = targetedUsedRfq
        ? SourcingRequestStatus.MATCHING
        : SourcingRequestStatus.SUBMITTED;
      const responseDeadlineAt = targetedUsedRfq
        ? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        : undefined;
      try {
        await tx.sourcingRequest.update({
          where: { id: sourcingRequestId },
          data: {
            status: submittedStatus,
            submissionKey: idempotencyKey,
            submittedAt: now,
            vehicleSnapshot: vehicleSnapshot as Prisma.InputJsonObject,
            deliverySnapshot: deliverySnapshot as Prisma.InputJsonObject,
            serviceAreaEligible: null,
            responseDeadlineAt,
            version: { increment: 1 },
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new AppError("Submission idempotency key was already used", {
            code: "SUBMISSION_KEY_REUSED",
            statusCode: 409,
          });
        }
        throw error;
      }
      await tx.requestStatusHistory.create({
        data: {
          requestId: sourcingRequestId,
          fromStatus: SourcingRequestStatus.DRAFT,
          toStatus: submittedStatus,
          actorUserId: userId,
          note: targetedUsedRfq
            ? "Used-parts RFQ routed to the listing supplier"
            : undefined,
        },
      });
      if (targetedUsedRfq && request.targetBusinessId) {
        await tx.supplierRequestAssignment.create({
          data: {
            requestId: request.id,
            businessId: request.targetBusinessId,
            history: {
              create: {
                eventType: SupplierAssignmentEventType.ASSIGNED,
                actorUserId: userId,
                deadlineAt: responseDeadlineAt,
                reason: "Customer requested a quotation for this used listing",
              },
            },
          },
        });
        await enqueueOutbox(tx, {
          eventType: "RFQ_RECEIVED",
          aggregateType: "SOURCING_REQUEST",
          aggregateId: request.id,
          eventKey: `used-rfq:${request.id}:received`,
          payload: {
            businessId: request.targetBusinessId,
            requestId: request.id,
          },
        });
      }
      await recordAudit(tx, {
        actorUserId: userId,
        action: targetedUsedRfq
          ? "CUSTOMER_USED_RFQ_SUBMITTED"
          : "CUSTOMER_REQUEST_SUBMITTED",
        entityType: "SOURCING_REQUEST",
        entityId: sourcingRequestId,
        requestId,
        metadata: {
          itemCount: request.items.length,
          attachmentCount: request.attachments.length,
          urgency: request.urgency,
        },
      });
    });
    return this.getCustomerRequest(userId, sourcingRequestId);
  }

  async cancel(
    userId: string,
    sourcingRequestId: string,
    reason: string | undefined,
    requestId: string,
  ) {
    const customerId = await this.customerId(userId);
    await this.database.$transaction(async (tx) => {
      await this.lockRequest(tx, sourcingRequestId);
      const request = await tx.sourcingRequest.findFirst({
        where: { id: sourcingRequestId, customerId },
        select: { id: true, status: true },
      });
      if (!request) throw requestNotFound();
      if (request.status === SourcingRequestStatus.CANCELLED) return;
      if (!cancellableStatuses.includes(request.status)) {
        throw new AppError("Request cannot be cancelled from its current status", {
          code: "REQUEST_CANCELLATION_NOT_ALLOWED",
          statusCode: 409,
        });
      }
      const [acceptedQuotation, order] = await Promise.all([
        tx.quotation.findFirst({
          where: {
            requestId: sourcingRequestId,
            OR: [{ status: QuotationStatus.ACCEPTED }, { acceptedAt: { not: null } }],
          },
          select: { id: true },
        }),
        tx.order.findFirst({
          where: { requestId: sourcingRequestId },
          select: { id: true },
        }),
      ]);
      if (acceptedQuotation || order) {
        throw new AppError(
          "Request cannot be cancelled after quotation acceptance or order creation",
          { code: "REQUEST_CANCELLATION_NOT_ALLOWED", statusCode: 409 },
        );
      }
      await tx.sourcingRequest.update({
        where: { id: sourcingRequestId },
        data: {
          status: SourcingRequestStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: reason,
          version: { increment: 1 },
        },
      });
      await tx.requestStatusHistory.create({
        data: {
          requestId: sourcingRequestId,
          fromStatus: request.status,
          toStatus: SourcingRequestStatus.CANCELLED,
          note: reason,
          actorUserId: userId,
        },
      });
      await recordAudit(tx, {
        actorUserId: userId,
        action: "CUSTOMER_REQUEST_CANCELLED",
        entityType: "SOURCING_REQUEST",
        entityId: sourcingRequestId,
        requestId,
        metadata: { fromStatus: request.status },
      });
    });
    return this.getCustomerRequest(userId, sourcingRequestId);
  }

  async listAdminRequests(query: AdminRequestListQuery) {
    const where: Prisma.SourcingRequestWhereInput = {
      status: query.status ?? { not: SourcingRequestStatus.DRAFT },
      urgency: query.urgency,
      requestType: query.requestType,
      createdAt:
        query.createdFrom || query.createdTo
          ? { gte: query.createdFrom, lte: query.createdTo }
          : undefined,
    };
    const [items, total] = await this.database.$transaction([
      this.database.sourcingRequest.findMany({
        where,
        select: adminRequestSelect,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.sourcingRequest.count({ where }),
    ]);
    return {
      items: items.map(serializeAdminRequest),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getAdminRequest(sourcingRequestId: string) {
    const request = await this.database.sourcingRequest.findFirst({
      where: { id: sourcingRequestId, status: { not: SourcingRequestStatus.DRAFT } },
      select: adminRequestSelect,
    });
    if (!request) throw requestNotFound();
    return serializeAdminRequest(request);
  }

  // This union is the authorization extension point for a future assigned-supplier viewer.
  // No supplier variant exists in Task 7, so supplier membership alone cannot read photos.
  async readAttachment(
    viewer: AttachmentViewer,
    sourcingRequestId: string,
    attachmentId: string,
  ) {
    const where: Prisma.RequestAttachmentWhereInput = {
      id: attachmentId,
      requestId: sourcingRequestId,
      request:
        viewer.kind === "CUSTOMER"
          ? { customer: { userId: viewer.userId } }
          : { status: { not: SourcingRequestStatus.DRAFT } },
    };
    const attachment = await this.database.requestAttachment.findFirst({
      where,
      select: {
        fileName: true,
        mimeType: true,
        storageKey: true,
        byteSize: true,
      },
    });
    if (!attachment) throw requestNotFound();
    try {
      const opened = await this.attachmentStorage.open(attachment.storageKey);
      return {
        ...attachment,
        stream: opened.stream,
        byteSize: opened.contentLength ?? attachment.byteSize,
      };
    } catch {
      throw new AppError("Request photo content was not found", {
        code: "REQUEST_PHOTO_NOT_FOUND",
        statusCode: 404,
      });
    }
  }
}
