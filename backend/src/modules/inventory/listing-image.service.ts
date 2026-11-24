import { randomUUID } from "node:crypto";
import { ListingPublicationStatus, type PrismaClient, type Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";
import { recordAudit } from "../auth/audit.service.js";
import { inspectListingImage } from "./listing-image-file.js";
import type { ListingImageStorage } from "./listing-image-storage.js";

const MAX_IMAGES_PER_LISTING = 4;

const notFound = () =>
  new AppError("Listing image was not found", {
    code: "LISTING_IMAGE_NOT_FOUND",
    statusCode: 404,
  });
const conflict = (code: string, message: string) =>
  new AppError(message, { code, statusCode: 409 });
export const listingImageUrl = (image: { id: string; version: number }) =>
  `/api/v1/catalogue/listing-images/${image.id}/v${image.version}`;

export class ListingImageService {
  constructor(
    private readonly database: PrismaClient,
    private readonly storage: ListingImageStorage,
    private readonly limits: { maxCount: number; maxBytes: number },
  ) {}

  private lockSupplierQuota(tx: Prisma.TransactionClient, businessId: string) {
    return tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`listing-image-quota:${businessId}`}, 0))::text AS "lock"`;
  }

  private requireNormalizedWebp(info: { mimeType: string }) {
    if (info.mimeType !== "image/webp") {
      throw new AppError("Listing images must be browser-normalized WebP files", {
        code: "LISTING_IMAGE_NORMALIZATION_REQUIRED",
        statusCode: 415,
      });
    }
  }

  private async ownedListing(businessId: string, inventoryId: string) {
    const listing = await this.database.supplierInventory.findFirst({
      where: { id: inventoryId, businessId, isActive: true },
      select: { id: true },
    });
    if (!listing)
      throw new AppError("Inventory offering was not found", {
        code: "INVENTORY_NOT_FOUND",
        statusCode: 404,
      });
    return listing;
  }

  private serialize<T extends { id: string; version: number }>(image: T) {
    return { ...image, url: listingImageUrl(image) };
  }

  async upload(
    businessId: string,
    inventoryId: string,
    data: Buffer,
    actorUserId: string,
    requestId: string,
  ) {
    await this.ownedListing(businessId, inventoryId);
    const info = inspectListingImage(data);
    this.requireNormalizedWebp(info);
    const storageKey = `${randomUUID()}.${info.extension}`;
    await this.storage.put({ storageKey, data, mimeType: info.mimeType });
    try {
      const image = await this.database.$transaction(async (tx) => {
        await this.lockSupplierQuota(tx, businessId);
        await tx.$queryRaw`SELECT "id" FROM "supplier_inventory" WHERE "id" = ${inventoryId}::uuid FOR UPDATE`;
        const count = await tx.supplierListingImage.count({ where: { inventoryId } });
        if (count >= MAX_IMAGES_PER_LISTING)
          throw conflict(
            "LISTING_IMAGE_LIMIT",
            "A listing can contain at most four images",
          );
        const supplierUsage = await tx.supplierListingImage.aggregate({
          where: { inventory: { businessId } },
          _count: true,
          _sum: { byteSize: true },
        });
        if (
          supplierUsage._count >= this.limits.maxCount ||
          (supplierUsage._sum.byteSize ?? 0) + data.length > this.limits.maxBytes
        )
          throw conflict(
            "SUPPLIER_IMAGE_QUOTA",
            "The supplier image quota has been reached",
          );
        const created = await tx.supplierListingImage.create({
          data: {
            inventoryId,
            storageKey,
            mimeType: info.mimeType,
            byteSize: data.length,
            width: info.width,
            height: info.height,
            displayOrder: count,
            isPrimary: count === 0,
          },
        });
        await tx.supplierInventory.update({
          where: { id: inventoryId },
          data: { legacyImageExempt: false },
        });
        await recordAudit(tx, {
          actorUserId,
          action: "SUPPLIER_LISTING_IMAGE_UPLOADED",
          entityType: "SUPPLIER_LISTING_IMAGE",
          entityId: created.id,
          requestId,
          metadata: { businessId, inventoryId, byteSize: data.length },
        });
        return created;
      });
      return this.serialize(image);
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async reorder(
    businessId: string,
    inventoryId: string,
    imageIds: string[],
    actorUserId: string,
    requestId: string,
  ) {
    await this.ownedListing(businessId, inventoryId);
    if (
      imageIds.length < 1 ||
      imageIds.length > MAX_IMAGES_PER_LISTING ||
      new Set(imageIds).size !== imageIds.length
    )
      throw conflict(
        "INVALID_IMAGE_ORDER",
        "Image order must include each listing image exactly once",
      );
    const result = await this.database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "supplier_inventory" WHERE "id" = ${inventoryId}::uuid FOR UPDATE`;
      const existing = await tx.supplierListingImage.findMany({
        where: { inventoryId },
        select: { id: true },
      });
      if (
        existing.length !== imageIds.length ||
        existing.some((item) => !imageIds.includes(item.id))
      )
        throw conflict(
          "INVALID_IMAGE_ORDER",
          "Image order must include each listing image exactly once",
        );
      await tx.supplierListingImage.updateMany({
        where: { inventoryId },
        data: { displayOrder: { increment: 100 }, isPrimary: false },
      });
      for (const [displayOrder, id] of imageIds.entries())
        await tx.supplierListingImage.update({
          where: { id },
          data: { displayOrder, isPrimary: displayOrder === 0 },
        });
      await recordAudit(tx, {
        actorUserId,
        action: "SUPPLIER_LISTING_IMAGES_REORDERED",
        entityType: "SUPPLIER_INVENTORY",
        entityId: inventoryId,
        requestId,
        metadata: { businessId, imageIds },
      });
      return tx.supplierListingImage.findMany({
        where: { inventoryId },
        orderBy: { displayOrder: "asc" },
      });
    });
    return result.map((image) => this.serialize(image));
  }

  async replace(
    businessId: string,
    inventoryId: string,
    imageId: string,
    data: Buffer,
    actorUserId: string,
    requestId: string,
  ) {
    await this.ownedListing(businessId, inventoryId);
    const info = inspectListingImage(data);
    this.requireNormalizedWebp(info);
    const storageKey = `${randomUUID()}.${info.extension}`;
    await this.storage.put({ storageKey, data, mimeType: info.mimeType });
    try {
      const { image, previousStorageKey } = await this.database.$transaction(
        async (tx) => {
          await this.lockSupplierQuota(tx, businessId);
          await tx.$queryRaw`SELECT "id" FROM "supplier_inventory" WHERE "id" = ${inventoryId}::uuid FOR UPDATE`;
          const current = await tx.supplierListingImage.findFirst({
            where: { id: imageId, inventoryId },
          });
          if (!current) throw notFound();
          const supplierUsage = await tx.supplierListingImage.aggregate({
            where: { inventory: { businessId } },
            _sum: { byteSize: true },
          });
          if (
            (supplierUsage._sum.byteSize ?? 0) - current.byteSize + data.length >
            this.limits.maxBytes
          )
            throw conflict(
              "SUPPLIER_IMAGE_QUOTA",
              "The supplier image quota has been reached",
            );
          const updated = await tx.supplierListingImage.update({
            where: { id: imageId },
            data: {
              storageKey,
              mimeType: info.mimeType,
              byteSize: data.length,
              width: info.width,
              height: info.height,
              version: { increment: 1 },
            },
          });
          await recordAudit(tx, {
            actorUserId,
            action: "SUPPLIER_LISTING_IMAGE_REPLACED",
            entityType: "SUPPLIER_LISTING_IMAGE",
            entityId: imageId,
            requestId,
            metadata: { businessId, inventoryId },
          });
          return { image: updated, previousStorageKey: current.storageKey };
        },
      );
      await this.storage.delete(previousStorageKey).catch(() => undefined);
      return this.serialize(image);
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async remove(
    businessId: string,
    inventoryId: string,
    imageId: string,
    actorUserId: string,
    requestId: string,
  ) {
    await this.ownedListing(businessId, inventoryId);
    const storageKey = await this.database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "supplier_inventory" WHERE "id" = ${inventoryId}::uuid FOR UPDATE`;
      const current = await tx.supplierListingImage.findFirst({
        where: { id: imageId, inventoryId },
        include: { inventory: { select: { publicationStatus: true } } },
      });
      if (!current) throw notFound();
      const count = await tx.supplierListingImage.count({ where: { inventoryId } });
      if (
        count === 1 &&
        current.inventory.publicationStatus === ListingPublicationStatus.PUBLISHED
      )
        throw conflict(
          "LISTING_IMAGE_REQUIRED",
          "A published listing must keep at least one image",
        );
      await tx.supplierListingImage.delete({ where: { id: imageId } });
      const remaining = await tx.supplierListingImage.findMany({
        where: { inventoryId },
        orderBy: { displayOrder: "asc" },
      });
      for (const [displayOrder, image] of remaining.entries())
        await tx.supplierListingImage.update({
          where: { id: image.id },
          data: { displayOrder, isPrimary: displayOrder === 0 },
        });
      await recordAudit(tx, {
        actorUserId,
        action: "SUPPLIER_LISTING_IMAGE_DELETED",
        entityType: "SUPPLIER_LISTING_IMAGE",
        entityId: imageId,
        requestId,
        metadata: { businessId, inventoryId },
      });
      return current.storageKey;
    });
    await this.storage.delete(storageKey).catch(() => undefined);
  }

  async openPublic(imageId: string, version: number) {
    const now = new Date();
    const image = await this.database.supplierListingImage.findFirst({
      where: {
        id: imageId,
        version,
        inventory: {
          isActive: true,
          isAvailable: true,
          publicationStatus: "PUBLISHED",
          moderationStatus: "APPROVED",
          availabilityStatus: { in: ["IN_STOCK", "LOW_STOCK"] },
          stockQuantity: { gt: 0 },
          business: {
            status: "ACTIVE",
            members: { some: { isActive: true, leftAt: null } },
            OR: [
              { subscriptionGraceEndsAt: { gt: now } },
              {
                subscriptions: {
                  some: { status: "ACTIVE", startsAt: { lte: now }, endsAt: { gt: now } },
                },
              },
            ],
          },
        },
      },
      select: { storageKey: true, mimeType: true, byteSize: true },
    });
    if (!image) throw notFound();
    return { ...image, ...(await this.storage.open(image.storageKey)) };
  }
}
