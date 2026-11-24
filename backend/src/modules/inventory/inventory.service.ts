import {
  InventoryAvailability,
  InventoryImportStatus,
  ListingModerationStatus,
  ListingPublicationStatus,
  Prisma,
  ProductCondition,
  type PrismaClient,
  type SupplierListingClassification,
} from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";
import { recordAudit } from "../auth/audit.service.js";
import { parseInventoryCsv, type CsvInventoryRow } from "./inventory.csv.js";
import type {
  BulkInventoryInput,
  CreateInventoryInput,
  InventoryListQuery,
  StockAdjustmentInput,
  UpdateInventoryInput,
} from "./inventory.schemas.js";
import { listingImageUrl } from "./listing-image.service.js";

const PREVIEW_TTL_MS = 15 * 60_000;
const inventoryInclude = {
  product: {
    include: {
      category: { select: { id: true, name: true, slug: true } },
      brand: { select: { id: true, name: true, slug: true } },
      numbers: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
    },
  },
  images: { orderBy: { displayOrder: "asc" as const } },
} satisfies Prisma.SupplierInventoryInclude;

type PreviewValues = {
  productId: string;
  sku: string;
  condition: ProductCondition;
  unitPrice: string;
  stockQuantity: number;
  minimumStock: number;
  preparationTimeMin: number | null;
  isAvailable: boolean;
  notes: string | null;
};

type PreviewRow = {
  rowNumber: number;
  action: "create" | "update" | "error";
  errors: string[];
  existingInventoryId: string | null;
  expectedVersion: number | null;
  values: PreviewValues | null;
};

function inventoryNotFound() {
  return new AppError("Inventory offering was not found", {
    code: "INVENTORY_NOT_FOUND",
    statusCode: 404,
  });
}

function conflict(code: string, message: string) {
  return new AppError(message, { code, statusCode: 409 });
}

function assertClassification(
  classification: SupplierListingClassification,
  condition: ProductCondition,
) {
  if (classification === "USED" && condition === ProductCondition.NEW) {
    throw conflict(
      "LISTING_CLASSIFICATION_CONFLICT",
      "Used listings must disclose USED or RECONDITIONED condition",
    );
  }
  if (classification !== "USED" && condition !== ProductCondition.NEW) {
    throw conflict(
      "LISTING_CLASSIFICATION_CONFLICT",
      "Genuine and aftermarket listings must use NEW condition",
    );
  }
}

function availabilityFor(input: {
  stockQuantity: number;
  reservedQuantity: number;
  minimumStock: number;
  isAvailable: boolean;
  isActive: boolean;
}): InventoryAvailability {
  if (!input.isActive || !input.isAvailable) return InventoryAvailability.HIDDEN;
  const available = input.stockQuantity - input.reservedQuantity;
  if (available === 0) return InventoryAvailability.OUT_OF_STOCK;
  if (available <= input.minimumStock) return InventoryAvailability.LOW_STOCK;
  return InventoryAvailability.IN_STOCK;
}

function serializeInventory<
  T extends {
    unitPrice: Prisma.Decimal;
    stockQuantity: number;
    reservedQuantity: number;
  },
>(item: T) {
  const withImages = item as T & { images?: Array<{ id: string; version: number }> };
  return {
    ...item,
    ...(withImages.images
      ? {
          images: withImages.images.map((image) => ({
            ...image,
            url: listingImageUrl(image),
          })),
        }
      : {}),
    unitPrice: item.unitPrice.toFixed(2),
    availableQuantity: item.stockQuantity - item.reservedQuantity,
  };
}

function parseInteger(value: string, field: string, errors: string[], max: number) {
  if (!/^\d+$/.test(value)) {
    errors.push(`${field} must be a nonnegative integer`);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) {
    errors.push(`${field} is out of range`);
    return null;
  }
  return parsed;
}

function parsePrice(value: string, errors: string[]) {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(value) || Number(value) > 9_999_999_999.99) {
    errors.push("unit_price must be a nonnegative amount with at most 2 decimals");
    return null;
  }
  return new Prisma.Decimal(value).toFixed(2);
}

function parseBoolean(value: string, errors: string[]) {
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  errors.push("is_available must be true or false");
  return null;
}

function parseCondition(value: string, errors: string[]) {
  if (Object.values(ProductCondition).includes(value as ProductCondition)) {
    return value as ProductCondition;
  }
  errors.push("condition must be NEW, RECONDITIONED or USED");
  return null;
}

export class InventoryService {
  constructor(
    private readonly database: PrismaClient,
    private readonly invalidateCatalogue: () => Promise<void> = async () => undefined,
  ) {}

  async invalidateCache() {
    await this.invalidateCatalogue();
  }

  private async lockInventory(tx: Prisma.TransactionClient, inventoryId: string) {
    await tx.$queryRaw`
      SELECT "id"
      FROM "supplier_inventory"
      WHERE "id" = ${inventoryId}::uuid
      FOR UPDATE
    `;
  }

  private async requireInventory(businessId: string, inventoryId: string) {
    const inventory = await this.database.supplierInventory.findFirst({
      where: { id: inventoryId, businessId },
      include: inventoryInclude,
    });
    if (!inventory) throw inventoryNotFound();
    return inventory;
  }

  private async requireActiveProduct(productId: string) {
    const product = await this.database.product.findFirst({
      where: {
        id: productId,
        isActive: true,
        deletedAt: null,
        category: { isActive: true },
        OR: [{ brandId: null }, { brand: { isActive: true } }],
      },
      select: { id: true },
    });
    if (!product) {
      throw new AppError("Active catalogue product was not found", {
        code: "ACTIVE_CATALOGUE_PRODUCT_NOT_FOUND",
        statusCode: 400,
      });
    }
  }

  private translateWriteError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw conflict(
        "INVENTORY_CONFLICT",
        "An offering already uses that SKU or product and condition",
      );
    }
    throw error;
  }

  async listInventory(businessId: string, query: InventoryListQuery) {
    const availability =
      query.stockState === "low_stock"
        ? InventoryAvailability.LOW_STOCK
        : query.stockState === "out_of_stock"
          ? InventoryAvailability.OUT_OF_STOCK
          : query.availability;
    const where: Prisma.SupplierInventoryWhereInput = {
      businessId,
      isActive: query.isActive ?? true,
      condition: query.condition,
      listingClassification: query.classification,
      publicationStatus: query.publicationStatus,
      availabilityStatus: availability,
      ...(query.stockState === "available"
        ? {
            availabilityStatus: {
              in: [InventoryAvailability.IN_STOCK, InventoryAvailability.LOW_STOCK],
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { sku: { contains: query.search, mode: "insensitive" } },
              { product: { name: { contains: query.search, mode: "insensitive" } } },
              {
                product: {
                  numbers: {
                    some: { partNumber: { contains: query.search, mode: "insensitive" } },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total, policy, wallet] = await this.database.$transaction([
      this.database.supplierInventory.findMany({
        where,
        include: inventoryInclude,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.supplierInventory.count({ where }),
      this.database.commissionPolicy.findFirst({
        where: { isActive: true, effectiveFrom: { lte: new Date() } },
        orderBy: { effectiveFrom: "desc" },
        select: { id: true, rateBps: true, effectiveFrom: true },
      }),
      this.database.supplierWallet.findUnique({
        where: { businessId },
        select: { status: true, availableCredit: true },
      }),
    ]);
    return {
      items: items.map((item) => {
        const isFixedPrice =
          item.listingClassification === "NEW_GENUINE" ||
          item.listingClassification === "NEW_AFTERMARKET";
        const requiredCredit =
          isFixedPrice && policy
            ? item.unitPrice
                .mul(policy.rateBps)
                .div(10_000)
                .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
            : null;
        const eligible =
          !!requiredCredit &&
          item.publicationStatus === ListingPublicationStatus.PUBLISHED &&
          item.moderationStatus !== ListingModerationStatus.REJECTED &&
          item.isActive &&
          item.isAvailable &&
          item.stockQuantity > item.reservedQuantity &&
          wallet?.status === "ACTIVE" &&
          wallet.availableCredit.greaterThanOrEqualTo(requiredCredit);
        const reason = !isFixedPrice
          ? "QUOTE_BASED"
          : item.publicationStatus !== ListingPublicationStatus.PUBLISHED
            ? "NOT_PUBLISHED"
            : item.moderationStatus === ListingModerationStatus.REJECTED
              ? "MODERATION_REJECTED"
              : !item.isActive ||
                  !item.isAvailable ||
                  item.stockQuantity <= item.reservedQuantity
                ? "UNAVAILABLE"
                : !policy
                  ? "COMMISSION_POLICY_REQUIRED"
                  : wallet?.status !== "ACTIVE"
                    ? "WALLET_NOT_ACTIVE"
                    : wallet.availableCredit.lessThan(requiredCredit!)
                      ? "INSUFFICIENT_CREDITS"
                      : null;
        return {
          ...serializeInventory(item),
          commissionEligibility: {
            eligible,
            requiredCredit: requiredCredit?.toFixed(2) ?? null,
            rateBps: policy?.rateBps ?? null,
            reason,
          },
        };
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getInventory(businessId: string, inventoryId: string) {
    return serializeInventory(await this.requireInventory(businessId, inventoryId));
  }

  async createInventory(
    businessId: string,
    input: CreateInventoryInput,
    actorUserId: string,
    requestId: string,
  ) {
    if (input.publicationStatus === ListingPublicationStatus.PUBLISHED) {
      throw conflict(
        "LISTING_IMAGE_REQUIRED",
        "Create the listing as a draft, add at least one image, then publish it",
      );
    }
    await this.requireActiveProduct(input.productId);
    const listingClassification =
      input.listingClassification ??
      (input.condition === ProductCondition.NEW ? "NEW_AFTERMARKET" : "USED");
    assertClassification(listingClassification, input.condition);
    try {
      const created = await this.database.$transaction(async (tx) => {
        const availabilityStatus = availabilityFor({
          stockQuantity: input.stockQuantity,
          reservedQuantity: 0,
          minimumStock: input.minimumStock,
          isAvailable: input.isAvailable,
          isActive: true,
        });
        const inventory = await tx.supplierInventory.create({
          data: {
            ...input,
            listingClassification,
            businessId,
            sku: input.sku.toUpperCase(),
            unitPrice: new Prisma.Decimal(input.unitPrice),
            availabilityStatus,
            lastStockUpdateAt: input.stockQuantity > 0 ? new Date() : null,
          },
          include: inventoryInclude,
        });
        await tx.inventoryStockAdjustment.create({
          data: {
            businessId,
            inventoryId: inventory.id,
            actorUserId,
            idempotencyKey: `create:${inventory.id}`,
            reason: "Initial stock",
            quantityDelta: input.stockQuantity,
            previousQuantity: 0,
            resultingQuantity: input.stockQuantity,
          },
        });
        await recordAudit(tx, {
          actorUserId,
          action: "SUPPLIER_INVENTORY_CREATED",
          entityType: "SUPPLIER_INVENTORY",
          entityId: inventory.id,
          requestId,
          metadata: { businessId, productId: inventory.productId },
        });
        return serializeInventory(inventory);
      });
      return created;
    } catch (error) {
      return this.translateWriteError(error);
    }
  }

  async updateInventory(
    businessId: string,
    inventoryId: string,
    input: UpdateInventoryInput,
    actorUserId: string,
    requestId: string,
  ) {
    try {
      const updated = await this.database.$transaction(async (tx) => {
        await this.lockInventory(tx, inventoryId);
        const current = await tx.supplierInventory.findFirst({
          where: { id: inventoryId, businessId, isActive: true },
        });
        if (!current) throw inventoryNotFound();
        const nextCondition = input.condition ?? current.condition;
        const nextClassification =
          input.listingClassification ??
          current.listingClassification ??
          (nextCondition === ProductCondition.NEW ? "NEW_AFTERMARKET" : "USED");
        assertClassification(nextClassification, nextCondition);
        if (
          input.publicationStatus === ListingPublicationStatus.PUBLISHED &&
          current.moderationStatus === ListingModerationStatus.REJECTED
        )
          throw conflict(
            "LISTING_MODERATION_BLOCKED",
            "A rejected listing cannot be published",
          );
        if (input.publicationStatus === ListingPublicationStatus.PUBLISHED) {
          const images = await tx.supplierListingImage.findMany({
            where: { inventoryId },
            select: { isPrimary: true },
          });
          if (
            images.length < 1 ||
            images.length > 4 ||
            images.filter((image) => image.isPrimary).length !== 1
          )
            throw conflict(
              "LISTING_IMAGE_REQUIRED",
              "A published listing needs one to four images and exactly one primary image",
            );
        }
        const availabilityStatus = availabilityFor({
          stockQuantity: current.stockQuantity,
          reservedQuantity: current.reservedQuantity,
          minimumStock: input.minimumStock ?? current.minimumStock,
          isAvailable: input.isAvailable ?? current.isAvailable,
          isActive: current.isActive,
        });
        const inventory = await tx.supplierInventory.update({
          where: { id: inventoryId },
          data: {
            ...input,
            sku: input.sku?.toUpperCase(),
            unitPrice:
              input.unitPrice === undefined
                ? undefined
                : new Prisma.Decimal(input.unitPrice),
            availabilityStatus,
            publishedAt:
              input.publicationStatus === ListingPublicationStatus.PUBLISHED
                ? new Date()
                : input.publicationStatus
                  ? null
                  : undefined,
            version: { increment: 1 },
          },
          include: inventoryInclude,
        });
        await recordAudit(tx, {
          actorUserId,
          action: "SUPPLIER_INVENTORY_UPDATED",
          entityType: "SUPPLIER_INVENTORY",
          entityId: inventoryId,
          requestId,
          metadata: { businessId, fields: Object.keys(input) },
        });
        return serializeInventory(inventory);
      });
      return updated;
    } catch (error) {
      return this.translateWriteError(error);
    }
  }

  async listAdmin(input: {
    page: number;
    pageSize: number;
    search?: string;
    businessId?: string;
    condition?: ProductCondition;
    classification?: CreateInventoryInput["listingClassification"];
    publicationStatus?: ListingPublicationStatus;
    moderationStatus?: ListingModerationStatus;
    isActive?: boolean;
  }) {
    const where: Prisma.SupplierInventoryWhereInput = {
      businessId: input.businessId,
      condition: input.condition,
      listingClassification: input.classification,
      publicationStatus: input.publicationStatus,
      moderationStatus: input.moderationStatus,
      isActive: input.isActive,
      ...(input.search
        ? {
            OR: [
              { sku: { contains: input.search, mode: "insensitive" } },
              { product: { name: { contains: input.search, mode: "insensitive" } } },
              {
                business: {
                  displayName: { contains: input.search, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total, policy] = await this.database.$transaction([
      this.database.supplierInventory.findMany({
        where,
        include: {
          ...inventoryInclude,
          business: {
            select: {
              id: true,
              businessCode: true,
              displayName: true,
              status: true,
              wallet: {
                select: { status: true, availableCredit: true, reservedCredit: true },
              },
            },
          },
          moderatedBy: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.database.supplierInventory.count({ where }),
      this.database.commissionPolicy.findFirst({
        where: { isActive: true, effectiveFrom: { lte: new Date() } },
        orderBy: { effectiveFrom: "desc" },
      }),
    ]);
    return {
      items: items.map((item) => {
        const requiredCredit = policy
          ? item.unitPrice
              .mul(policy.rateBps)
              .div(10_000)
              .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
          : null;
        return {
          ...serializeInventory(item),
          commissionEligibility: {
            eligible:
              !!requiredCredit &&
              item.business.wallet?.status === "ACTIVE" &&
              item.business.wallet.availableCredit.greaterThanOrEqualTo(requiredCredit),
            requiredCredit: requiredCredit?.toFixed(2) ?? null,
            reason: !policy
              ? "COMMISSION_POLICY_REQUIRED"
              : item.business.wallet?.status !== "ACTIVE"
                ? "WALLET_NOT_ACTIVE"
                : item.business.wallet.availableCredit.lessThan(requiredCredit!)
                  ? "INSUFFICIENT_CREDITS"
                  : null,
          },
        };
      }),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async moderate(
    inventoryId: string,
    input: { status: "APPROVED" | "FLAGGED" | "REJECTED"; reason: string },
    actorUserId: string,
    requestId: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await this.lockInventory(tx, inventoryId);
      const current = await tx.supplierInventory.findUnique({
        where: { id: inventoryId },
      });
      if (!current) throw inventoryNotFound();
      const rejected = input.status === "REJECTED";
      const listing = await tx.supplierInventory.update({
        where: { id: inventoryId },
        data: {
          moderationStatus: input.status,
          moderatedByUserId: actorUserId,
          moderatedAt: new Date(),
          publicationStatus: rejected
            ? ListingPublicationStatus.SUSPENDED
            : current.publicationStatus,
          notes: current.notes
            ? `${current.notes}\nModeration: ${input.reason}`
            : `Moderation: ${input.reason}`,
          version: { increment: 1 },
        },
        include: inventoryInclude,
      });
      await recordAudit(tx, {
        actorUserId,
        action: `SUPPLIER_LISTING_${input.status}`,
        entityType: "SUPPLIER_INVENTORY",
        entityId: inventoryId,
        requestId,
        metadata: { businessId: current.businessId, reason: input.reason },
      });
      return serializeInventory(listing);
    });
  }

  async adjustStock(
    businessId: string,
    inventoryId: string,
    input: StockAdjustmentInput,
    actorUserId: string,
    requestId: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`${businessId}:${input.idempotencyKey}`}, 0)
        ) IS NULL AS "locked"
      `;
      const previousAdjustment = await tx.inventoryStockAdjustment.findUnique({
        where: {
          businessId_idempotencyKey: {
            businessId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (previousAdjustment) {
        if (
          previousAdjustment.inventoryId !== inventoryId ||
          previousAdjustment.quantityDelta !== input.quantityDelta ||
          previousAdjustment.reason !== input.reason
        ) {
          throw conflict(
            "IDEMPOTENCY_KEY_REUSED",
            "Idempotency key was already used for a different stock adjustment",
          );
        }
        const inventory = await tx.supplierInventory.findFirst({
          where: { id: inventoryId, businessId },
          include: inventoryInclude,
        });
        if (!inventory) throw inventoryNotFound();
        return {
          inventory: serializeInventory(inventory),
          adjustment: previousAdjustment,
          duplicate: true,
        };
      }

      await this.lockInventory(tx, inventoryId);
      const current = await tx.supplierInventory.findFirst({
        where: { id: inventoryId, businessId, isActive: true },
      });
      if (!current) throw inventoryNotFound();
      const resultingQuantity = current.stockQuantity + input.quantityDelta;
      if (resultingQuantity < current.reservedQuantity) {
        throw conflict(
          "STOCK_BELOW_RESERVED",
          "Stock cannot be reduced below the reserved quantity",
        );
      }
      if (resultingQuantity < 0) {
        throw conflict("NEGATIVE_STOCK", "Stock quantity cannot be negative");
      }
      const availabilityStatus = availabilityFor({
        ...current,
        stockQuantity: resultingQuantity,
      });
      const inventory = await tx.supplierInventory.update({
        where: { id: inventoryId },
        data: {
          stockQuantity: resultingQuantity,
          availabilityStatus,
          lastStockUpdateAt: new Date(),
          version: { increment: 1 },
        },
        include: inventoryInclude,
      });
      const adjustment = await tx.inventoryStockAdjustment.create({
        data: {
          businessId,
          inventoryId,
          actorUserId,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          quantityDelta: input.quantityDelta,
          previousQuantity: current.stockQuantity,
          resultingQuantity,
        },
      });
      await recordAudit(tx, {
        actorUserId,
        action: "SUPPLIER_STOCK_ADJUSTED",
        entityType: "SUPPLIER_INVENTORY",
        entityId: inventoryId,
        requestId,
        metadata: {
          businessId,
          adjustmentId: adjustment.id,
          quantityDelta: input.quantityDelta,
        },
      });
      return { inventory: serializeInventory(inventory), adjustment, duplicate: false };
    });
  }

  async listStockAdjustments(businessId: string, inventoryId: string) {
    await this.requireInventory(businessId, inventoryId);
    return this.database.inventoryStockAdjustment.findMany({
      where: { businessId, inventoryId },
      select: {
        id: true,
        reason: true,
        quantityDelta: true,
        previousQuantity: true,
        resultingQuantity: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async deactivateInventory(
    businessId: string,
    inventoryId: string,
    actorUserId: string,
    requestId: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await this.lockInventory(tx, inventoryId);
      const updated = await tx.supplierInventory.updateMany({
        where: { id: inventoryId, businessId, isActive: true },
        data: {
          isActive: false,
          isAvailable: false,
          availabilityStatus: InventoryAvailability.HIDDEN,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw inventoryNotFound();
      await recordAudit(tx, {
        actorUserId,
        action: "SUPPLIER_INVENTORY_DEACTIVATED",
        entityType: "SUPPLIER_INVENTORY",
        entityId: inventoryId,
        requestId,
        metadata: { businessId },
      });
      const inventory = await tx.supplierInventory.findUniqueOrThrow({
        where: { id: inventoryId },
        include: inventoryInclude,
      });
      return serializeInventory(inventory);
    });
  }

  async bulkUpdate(
    businessId: string,
    input: BulkInventoryInput,
    actorUserId: string,
    requestId: string,
  ) {
    try {
      return await this.database.$transaction(async (tx) => {
        const sorted = [...input.items].sort((left, right) =>
          left.inventoryId.localeCompare(right.inventoryId),
        );
        for (const item of sorted) await this.lockInventory(tx, item.inventoryId);

        const updatedItems = [];
        for (const item of input.items) {
          const current = await tx.supplierInventory.findFirst({
            where: { id: item.inventoryId, businessId, isActive: true },
          });
          if (!current) throw inventoryNotFound();
          if (current.version !== item.version) {
            throw conflict(
              "STALE_INVENTORY_VERSION",
              "Inventory changed after it was loaded; reload before retrying",
            );
          }
          const stockQuantity = item.stockQuantity ?? current.stockQuantity;
          if (stockQuantity < current.reservedQuantity) {
            throw conflict(
              "STOCK_BELOW_RESERVED",
              "Stock cannot be reduced below the reserved quantity",
            );
          }
          const minimumStock = item.minimumStock ?? current.minimumStock;
          const isAvailable = item.isAvailable ?? current.isAvailable;
          const availabilityStatus = availabilityFor({
            ...current,
            stockQuantity,
            minimumStock,
            isAvailable,
          });
          const inventory = await tx.supplierInventory.update({
            where: { id: item.inventoryId },
            data: {
              sku: item.sku?.toUpperCase(),
              unitPrice:
                item.unitPrice === undefined
                  ? undefined
                  : new Prisma.Decimal(item.unitPrice),
              condition: item.condition,
              stockQuantity: item.stockQuantity,
              minimumStock: item.minimumStock,
              preparationTimeMin: item.preparationTimeMin,
              isAvailable: item.isAvailable,
              notes: item.notes,
              availabilityStatus,
              lastStockUpdateAt:
                item.stockQuantity === undefined ? undefined : new Date(),
              version: { increment: 1 },
            },
            include: inventoryInclude,
          });
          if (item.stockQuantity !== undefined) {
            await tx.inventoryStockAdjustment.create({
              data: {
                businessId,
                inventoryId: item.inventoryId,
                actorUserId,
                idempotencyKey: `bulk:${input.operationId}:${item.inventoryId}`,
                reason: item.stockReason!,
                quantityDelta: item.stockQuantity - current.stockQuantity,
                previousQuantity: current.stockQuantity,
                resultingQuantity: item.stockQuantity,
              },
            });
          }
          updatedItems.push(serializeInventory(inventory));
        }
        await recordAudit(tx, {
          actorUserId,
          action: "SUPPLIER_INVENTORY_BULK_UPDATED",
          entityType: "SUPPLIER_BUSINESS",
          entityId: businessId,
          requestId,
          metadata: { offeringCount: input.items.length },
        });
        return { items: updatedItems, count: updatedItems.length };
      });
    } catch (error) {
      return this.translateWriteError(error);
    }
  }

  private validateCsvBasics(row: CsvInventoryRow, errors: string[]) {
    if (!row.product_id && !row.part_number) {
      errors.push("product_id or part_number is required");
    }
    if (row.product_id && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(row.product_id)) {
      errors.push("product_id must be a UUID");
    }
    if (!row.sku || row.sku.length > 120)
      errors.push("sku is required (maximum 120 characters)");
    if (!row.unit_price) errors.push("unit_price is required");
    if (!row.stock_quantity) errors.push("stock_quantity is required");
    if (!row.minimum_stock) errors.push("minimum_stock is required");
    if (!row.is_available) errors.push("is_available is required");
    if (row.notes.length > 1000) errors.push("notes exceeds 1000 characters");
  }

  private async resolveCsvProduct(row: CsvInventoryRow, errors: string[]) {
    let byId: { id: string } | null = null;
    if (row.product_id && !errors.some((error) => error.startsWith("product_id"))) {
      byId = await this.database.product.findFirst({
        where: {
          id: row.product_id,
          isActive: true,
          deletedAt: null,
          category: { isActive: true },
          OR: [{ brandId: null }, { brand: { isActive: true } }],
        },
        select: { id: true },
      });
      if (!byId) errors.push("product_id does not reference an active catalogue product");
    }
    let byNumber: Array<{ productId: string }> = [];
    if (row.part_number) {
      byNumber = await this.database.productNumber.findMany({
        where: {
          partNumber: { equals: row.part_number, mode: "insensitive" },
          product: {
            isActive: true,
            deletedAt: null,
            category: { isActive: true },
            OR: [{ brandId: null }, { brand: { isActive: true } }],
          },
        },
        distinct: ["productId"],
        select: { productId: true },
        take: 2,
      });
      if (byNumber.length === 0)
        errors.push("part_number does not match a catalogue product");
      if (byNumber.length > 1) errors.push("part_number is ambiguous; use product_id");
    }
    const numberProductId = byNumber.length === 1 ? byNumber[0]!.productId : null;
    if (byId && numberProductId && byId.id !== numberProductId) {
      errors.push("product_id and part_number refer to different products");
    }
    return byId?.id ?? numberProductId;
  }

  async previewCsv(
    businessId: string,
    actorUserId: string,
    file: Buffer,
    requestId: string,
  ) {
    const parsed = parseInventoryCsv(file);
    const seenSkus = new Set<string>();
    const seenOfferings = new Set<string>();
    const rows: PreviewRow[] = [];

    for (const row of parsed.rows) {
      const errors: string[] = [];
      this.validateCsvBasics(row, errors);
      const condition = parseCondition(row.condition, errors);
      const unitPrice = row.unit_price ? parsePrice(row.unit_price, errors) : null;
      const stockQuantity = row.stock_quantity
        ? parseInteger(row.stock_quantity, "stock_quantity", errors, 1_000_000_000)
        : null;
      const minimumStock = row.minimum_stock
        ? parseInteger(row.minimum_stock, "minimum_stock", errors, 1_000_000_000)
        : null;
      const preparationTimeMin = row.preparation_time_minutes
        ? parseInteger(
            row.preparation_time_minutes,
            "preparation_time_minutes",
            errors,
            525_600,
          )
        : null;
      const isAvailable = row.is_available
        ? parseBoolean(row.is_available, errors)
        : null;
      const productId = await this.resolveCsvProduct(row, errors);
      const sku = row.sku.toUpperCase();
      if (sku && seenSkus.has(sku)) errors.push("duplicate sku in file");
      if (sku) seenSkus.add(sku);
      if (productId && condition) {
        const offeringKey = `${productId}:${condition}`;
        if (seenOfferings.has(offeringKey)) {
          errors.push("duplicate product and condition in file");
        }
        seenOfferings.add(offeringKey);
      }

      let existing = null;
      if (productId && condition && sku) {
        const candidates = await this.database.supplierInventory.findMany({
          where: {
            businessId,
            OR: [{ sku }, { productId, condition }],
          },
        });
        if (candidates.length > 1) {
          errors.push("sku and product/condition match different existing offerings");
        } else {
          existing = candidates[0] ?? null;
          if (
            existing &&
            (existing.productId !== productId || existing.condition !== condition)
          ) {
            errors.push("existing sku is bound to a different product or condition");
          }
          if (existing && !existing.isActive) {
            errors.push("matching offering is deactivated and cannot be imported");
          }
          if (
            existing &&
            stockQuantity !== null &&
            stockQuantity < existing.reservedQuantity
          ) {
            errors.push("stock_quantity is below the reserved quantity");
          }
        }
      }

      const validValues =
        productId &&
        condition &&
        unitPrice !== null &&
        stockQuantity !== null &&
        minimumStock !== null &&
        isAvailable !== null
          ? {
              productId,
              sku,
              condition,
              unitPrice,
              stockQuantity,
              minimumStock,
              preparationTimeMin,
              isAvailable,
              notes: row.notes || null,
            }
          : null;
      rows.push({
        rowNumber: row.rowNumber,
        action: errors.length > 0 ? "error" : existing ? "update" : "create",
        errors,
        existingInventoryId: existing?.id ?? null,
        expectedVersion: existing?.version ?? null,
        values: validValues,
      });
    }

    const summary = {
      total: rows.length,
      creates: rows.filter((row) => row.action === "create").length,
      updates: rows.filter((row) => row.action === "update").length,
      errors: rows.filter((row) => row.action === "error").length,
    };
    const preview = await this.database.inventoryCsvPreview.create({
      data: {
        businessId,
        createdByUserId: actorUserId,
        sourceHash: parsed.sourceHash,
        rows: rows as unknown as Prisma.InputJsonValue,
        summary,
        expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
      },
    });
    await recordAudit(this.database, {
      actorUserId,
      action: "SUPPLIER_INVENTORY_CSV_PREVIEWED",
      entityType: "INVENTORY_CSV_PREVIEW",
      entityId: preview.id,
      requestId,
      metadata: { businessId, ...summary },
    });
    return {
      id: preview.id,
      status: preview.status,
      expiresAt: preview.expiresAt,
      summary,
      rows,
    };
  }

  async confirmCsv(
    businessId: string,
    actorUserId: string,
    previewId: string,
    requestId: string,
  ) {
    try {
      return await this.database.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT "id"
            FROM "inventory_csv_previews"
            WHERE "id" = ${previewId}::uuid
            FOR UPDATE
          `;
          const preview = await tx.inventoryCsvPreview.findFirst({
            where: { id: previewId, businessId, createdByUserId: actorUserId },
          });
          if (!preview) {
            throw new AppError("CSV preview was not found", {
              code: "INVENTORY_CSV_PREVIEW_NOT_FOUND",
              statusCode: 404,
            });
          }
          if (preview.status === InventoryImportStatus.CONFIRMED) {
            return { ...(preview.result as object), duplicate: true };
          }
          if (preview.expiresAt <= new Date()) {
            await tx.inventoryCsvPreview.update({
              where: { id: previewId },
              data: { status: InventoryImportStatus.EXPIRED },
            });
            throw conflict("INVENTORY_CSV_PREVIEW_EXPIRED", "CSV preview has expired");
          }
          const summary = preview.summary as {
            total: number;
            creates: number;
            updates: number;
            errors: number;
          };
          if (summary.errors > 0) {
            throw conflict(
              "INVENTORY_CSV_HAS_ERRORS",
              "CSV preview errors must be corrected before confirmation",
            );
          }
          const rows = preview.rows as unknown as PreviewRow[];
          const existingIds = rows
            .flatMap((row) => (row.existingInventoryId ? [row.existingInventoryId] : []))
            .sort();
          for (const inventoryId of existingIds)
            await this.lockInventory(tx, inventoryId);

          const inventoryIds: string[] = [];
          for (const row of rows) {
            if (!row.values || row.action === "error") {
              throw conflict(
                "INVENTORY_CSV_STALE",
                "CSV preview data is no longer valid",
              );
            }
            const product = await tx.product.findFirst({
              where: {
                id: row.values.productId,
                isActive: true,
                deletedAt: null,
                category: { isActive: true },
                OR: [{ brandId: null }, { brand: { isActive: true } }],
              },
              select: { id: true },
            });
            if (!product) {
              throw conflict(
                "INVENTORY_CSV_STALE",
                "A catalogue product changed after preview",
              );
            }
            if (row.action === "create") {
              const availabilityStatus = availabilityFor({
                stockQuantity: row.values.stockQuantity,
                reservedQuantity: 0,
                minimumStock: row.values.minimumStock,
                isAvailable: row.values.isAvailable,
                isActive: true,
              });
              const created = await tx.supplierInventory.create({
                data: {
                  businessId,
                  ...row.values,
                  unitPrice: new Prisma.Decimal(row.values.unitPrice),
                  availabilityStatus,
                  lastStockUpdateAt: new Date(),
                },
              });
              await tx.inventoryStockAdjustment.create({
                data: {
                  businessId,
                  inventoryId: created.id,
                  actorUserId,
                  idempotencyKey: `csv:${previewId}:${row.rowNumber}`,
                  reason: `CSV import row ${row.rowNumber}`,
                  quantityDelta: row.values.stockQuantity,
                  previousQuantity: 0,
                  resultingQuantity: row.values.stockQuantity,
                },
              });
              inventoryIds.push(created.id);
              continue;
            }
            const current = await tx.supplierInventory.findFirst({
              where: { id: row.existingInventoryId!, businessId, isActive: true },
            });
            if (!current || current.version !== row.expectedVersion) {
              throw conflict(
                "INVENTORY_CSV_STALE",
                "Inventory changed after preview; create a new preview",
              );
            }
            if (row.values.stockQuantity < current.reservedQuantity) {
              throw conflict(
                "STOCK_BELOW_RESERVED",
                "Stock cannot be reduced below the reserved quantity",
              );
            }
            const availabilityStatus = availabilityFor({
              stockQuantity: row.values.stockQuantity,
              reservedQuantity: current.reservedQuantity,
              minimumStock: row.values.minimumStock,
              isAvailable: row.values.isAvailable,
              isActive: true,
            });
            const updated = await tx.supplierInventory.update({
              where: { id: current.id },
              data: {
                ...row.values,
                unitPrice: new Prisma.Decimal(row.values.unitPrice),
                availabilityStatus,
                lastStockUpdateAt: new Date(),
                version: { increment: 1 },
              },
            });
            await tx.inventoryStockAdjustment.create({
              data: {
                businessId,
                inventoryId: current.id,
                actorUserId,
                idempotencyKey: `csv:${previewId}:${row.rowNumber}`,
                reason: `CSV import row ${row.rowNumber}`,
                quantityDelta: row.values.stockQuantity - current.stockQuantity,
                previousQuantity: current.stockQuantity,
                resultingQuantity: row.values.stockQuantity,
              },
            });
            inventoryIds.push(updated.id);
          }
          const result = {
            previewId,
            created: summary.creates,
            updated: summary.updates,
            inventoryIds,
            duplicate: false,
          };
          await tx.inventoryCsvPreview.update({
            where: { id: previewId },
            data: {
              status: InventoryImportStatus.CONFIRMED,
              confirmedAt: new Date(),
              result: result as Prisma.InputJsonObject,
            },
          });
          await recordAudit(tx, {
            actorUserId,
            action: "SUPPLIER_INVENTORY_CSV_CONFIRMED",
            entityType: "INVENTORY_CSV_PREVIEW",
            entityId: previewId,
            requestId,
            metadata: { businessId, created: summary.creates, updated: summary.updates },
          });
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2034"].includes(error.code)
      ) {
        throw conflict(
          "INVENTORY_CSV_STALE",
          "Inventory changed during confirmation; create a new preview",
        );
      }
      throw error;
    }
  }
}
