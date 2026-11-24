import {
  AccountStatus,
  InventoryAvailability,
  ListingPublicationStatus,
  ProductCondition,
  SupplierListingClassification,
  SupplierBusinessStatus,
  UserRole,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createLogger } from "../src/config/logger.js";
import { prisma } from "../src/config/prisma.js";
import { hashPassword } from "../src/modules/auth/password.js";
import { cleanupFulfillment } from "./helpers/cleanup-fulfillment.js";

const env = loadEnv();
const logger = createLogger();
const app = createApp(env, logger);
const quotaApp = createApp({ ...env, SUPPLIER_IMAGE_MAX_COUNT: 4 }, logger);
const password = "StrongPassword123";

async function cleanDatabase() {
  await cleanupFulfillment(prisma);
  await prisma.auditLog.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.refreshSession.deleteMany();
  await prisma.accountInvitation.deleteMany();
  await prisma.sourcingRequest.deleteMany();
  await prisma.inventoryCsvPreview.deleteMany();
  await prisma.inventoryStockAdjustment.deleteMany();
  await prisma.supplierInventory.deleteMany();
  await prisma.supplierUser.deleteMany();
  await prisma.supplierBusiness.deleteMany();
  await prisma.productCompatibility.deleteMany();
  await prisma.productNumber.deleteMany();
  await prisma.product.deleteMany();
  await prisma.brand.deleteMany();
  await prisma.partCategory.deleteMany();
  await prisma.customerProfile.deleteMany();
  await prisma.user.deleteMany();
}

async function provisionUser(email: string, role: UserRole) {
  return prisma.user.create({
    data: {
      email,
      fullName: "Task 6 User",
      passwordHash: await hashPassword(password),
      role,
      accountStatus: AccountStatus.ACTIVE,
      ...(role === UserRole.CUSTOMER
        ? { customerProfile: { create: { fullName: "Task 6 Customer" } } }
        : {}),
    },
  });
}

async function authorization(email: string) {
  const response = await request(app)
    .post(`${env.API_PREFIX}/auth/login`)
    .send({ email, password });
  expect(response.status).toBe(200);
  return `Bearer ${response.body.data.accessToken as string}`;
}

async function supplierContext(
  email: string,
  role: UserRole = UserRole.SUPPLIER_OWNER,
  status: SupplierBusinessStatus = SupplierBusinessStatus.ACTIVE,
) {
  const user = await provisionUser(email, role);
  const business = await prisma.supplierBusiness.create({
    data: {
      legalName: `${email} Limited`,
      displayName: email,
      status,
      subscriptionGraceEndsAt: new Date("2099-01-01T00:00:00.000Z"),
      ownerUserId: role === UserRole.SUPPLIER_OWNER ? user.id : null,
      members: {
        create: {
          userId: user.id,
          isPrimary: role === UserRole.SUPPLIER_OWNER,
          isActive: true,
        },
      },
    },
  });
  return { user, business, authorization: await authorization(email) };
}

async function catalogueFixture() {
  const category = await prisma.partCategory.create({
    data: { name: "Filters", slug: "filters" },
  });
  const brand = await prisma.brand.create({
    data: { name: "Denso", slug: "denso" },
  });
  const product = await prisma.product.create({
    data: {
      catalogueCode: "CAT-FILTER-1",
      name: "Oil Filter",
      categoryId: category.id,
      brandId: brand.id,
      numbers: {
        create: { partNumber: "90915-YZZD2", isPrimary: true },
      },
      compatibility: {
        create: { make: "Toyota", model: "Corolla", yearFrom: 2010, yearTo: 2020 },
      },
    },
  });
  return { category, brand, product };
}

function offeringPayload(productId: string, sku = "FILTER-001") {
  return {
    productId,
    sku,
    unitPrice: "1250.50",
    condition: ProductCondition.NEW,
    stockQuantity: 10,
    minimumStock: 3,
    preparationTimeMin: 60,
    isAvailable: true,
  };
}

function testPng(width = 640, height = 480) {
  const data = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data);
  data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

function testWebp(width = 640, height = 480) {
  const data = Buffer.alloc(30);
  data.write("RIFF", 0, "ascii");
  data.writeUInt32LE(22, 4);
  data.write("WEBPVP8X", 8, "ascii");
  data.writeUIntLE(width - 1, 24, 3);
  data.writeUIntLE(height - 1, 27, 3);
  return data;
}

async function attachImage(inventoryId: string) {
  return prisma.supplierListingImage.create({
    data: {
      inventoryId,
      storageKey: `${randomUUID()}.png`,
      mimeType: "image/png",
      byteSize: 24,
      width: 640,
      height: 480,
      displayOrder: 0,
      isPrimary: true,
    },
  });
}

beforeEach(cleanDatabase);

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

describe("admin catalogue", () => {
  it("enforces admin permissions and manages validated catalogue records", async () => {
    const admin = await provisionUser("catalogue-admin@autopro.test", UserRole.ADMIN);
    const customer = await provisionUser(
      "catalogue-customer@autopro.test",
      UserRole.CUSTOMER,
    );
    const adminAuth = await authorization(admin.email);
    const customerAuth = await authorization(customer.email);

    const denied = await request(app)
      .post(`${env.API_PREFIX}/admin/catalogue/categories`)
      .set("authorization", customerAuth)
      .send({ name: "Braking", slug: "braking" });
    expect(denied.status).toBe(403);

    const category = await request(app)
      .post(`${env.API_PREFIX}/admin/catalogue/categories`)
      .set("authorization", adminAuth)
      .send({ name: "Braking", slug: "braking" });
    const brand = await request(app)
      .post(`${env.API_PREFIX}/admin/catalogue/brands`)
      .set("authorization", adminAuth)
      .send({ name: "Toyota", slug: "toyota" });
    expect(category.status).toBe(201);
    expect(brand.status).toBe(201);

    const invalid = await request(app)
      .post(`${env.API_PREFIX}/admin/catalogue/products`)
      .set("authorization", adminAuth)
      .send({
        name: "Brake Pad",
        categoryId: category.body.data.id,
        numbers: [
          { partNumber: "04465-1", isPrimary: true },
          { partNumber: "04465-2", isPrimary: true },
        ],
      });
    expect(invalid.status).toBe(400);

    const created = await request(app)
      .post(`${env.API_PREFIX}/admin/catalogue/products`)
      .set("authorization", adminAuth)
      .send({
        catalogueCode: "CAT-BRAKE-1",
        name: "Front Brake Pad",
        categoryId: category.body.data.id,
        brandId: brand.body.data.id,
        numbers: [
          { partNumber: "04465-0D150", isPrimary: true },
          { partNumber: "04465-0D151" },
        ],
        compatibility: [{ make: "Toyota", model: "Axio", yearFrom: 2012, yearTo: 2018 }],
      });
    expect(created.status).toBe(201);
    expect(created.body.data.numbers).toHaveLength(2);
    expect(created.body.data.compatibility).toHaveLength(1);

    const deactivated = await request(app)
      .patch(`${env.API_PREFIX}/admin/catalogue/products/${created.body.data.id}`)
      .set("authorization", adminAuth)
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.isActive).toBe(false);
    expect(JSON.stringify(deactivated.body)).not.toContain("passwordHash");
  });
});

describe("supplier catalogue and inventory isolation", () => {
  it("returns supplier-scoped listing classification and authoritative credit eligibility", async () => {
    const { product } = await catalogueFixture();
    const supplier = await supplierContext("eligibility-owner@autopro.test");
    const admin = await provisionUser(
      "eligibility-admin@autopro.test",
      UserRole.SUPER_ADMIN,
    );
    await prisma.commissionPolicy.create({
      data: {
        rateBps: 1000,
        reason: "Supplier eligibility test",
        effectiveFrom: new Date(Date.now() - 1000),
        createdByUserId: admin.id,
      },
    });
    await prisma.supplierWallet.create({
      data: { businessId: supplier.business.id, availableCredit: "200.00" },
    });
    const blocked = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory`)
      .set("authorization", supplier.authorization)
      .set("x-business-id", supplier.business.id)
      .send({
        ...offeringPayload(product.id),
        listingClassification: "NEW_GENUINE",
        publicationStatus: "PUBLISHED",
      });
    expect(blocked.status).toBe(409);
    const created = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory`)
      .set("authorization", supplier.authorization)
      .set("x-business-id", supplier.business.id)
      .send({ ...offeringPayload(product.id), listingClassification: "NEW_GENUINE" });
    expect(created.status).toBe(201);
    const uploaded = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/${created.body.data.id}/images`)
      .set("authorization", supplier.authorization)
      .set("x-business-id", supplier.business.id)
      .set("content-type", "image/webp")
      .send(testWebp());
    expect(uploaded.status).toBe(201);
    const published = await request(app)
      .patch(`${env.API_PREFIX}/supplier/inventory/${created.body.data.id}`)
      .set("authorization", supplier.authorization)
      .set("x-business-id", supplier.business.id)
      .send({ publicationStatus: "PUBLISHED" });
    expect(published.status).toBe(200);
    const listed = await request(app)
      .get(`${env.API_PREFIX}/supplier/inventory`)
      .set("authorization", supplier.authorization)
      .set("x-business-id", supplier.business.id);
    expect(listed.status).toBe(200);
    expect(listed.body.data.items[0]).toMatchObject({
      listingClassification: "NEW_GENUINE",
      publicationStatus: "PUBLISHED",
      commissionEligibility: {
        eligible: true,
        requiredCredit: "125.05",
        rateBps: 1000,
        reason: null,
      },
    });
  });

  it("lists active catalogue products, creates unique offerings, and isolates businesses", async () => {
    const { product } = await catalogueFixture();
    const first = await supplierContext("owner-one@autopro.test");
    const second = await supplierContext("owner-two@autopro.test");

    const catalogue = await request(app)
      .get(`${env.API_PREFIX}/supplier/catalogue/products?search=90915&pageSize=10`)
      .set("authorization", first.authorization);
    expect(catalogue.status).toBe(200);
    expect(catalogue.body.data.total).toBe(1);

    const created = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory`)
      .set("authorization", first.authorization)
      .send(offeringPayload(product.id));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      unitPrice: "1250.50",
      stockQuantity: 10,
      reservedQuantity: 0,
      availableQuantity: 10,
      availabilityStatus: InventoryAvailability.IN_STOCK,
    });

    const updated = await request(app)
      .patch(`${env.API_PREFIX}/supplier/inventory/${created.body.data.id}`)
      .set("authorization", first.authorization)
      .send({ unitPrice: "1300", minimumStock: 4, preparationTimeMin: 45 });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      unitPrice: "1300.00",
      minimumStock: 4,
      preparationTimeMin: 45,
    });

    const duplicate = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory`)
      .set("authorization", first.authorization)
      .send(offeringPayload(product.id, "FILTER-002"));
    expect(duplicate.status).toBe(409);

    const hidden = await request(app)
      .get(`${env.API_PREFIX}/supplier/inventory/${created.body.data.id}`)
      .set("authorization", second.authorization);
    expect(hidden.status).toBe(404);

    const ownList = await request(app)
      .get(`${env.API_PREFIX}/supplier/inventory?stockState=available`)
      .set("authorization", first.authorization);
    expect(ownList.body.data.total).toBe(1);
    const otherList = await request(app)
      .get(`${env.API_PREFIX}/supplier/inventory`)
      .set("authorization", second.authorization);
    expect(otherList.body.data.total).toBe(0);

    await prisma.supplierBusiness.update({
      where: { id: first.business.id },
      data: { status: SupplierBusinessStatus.SUSPENDED },
    });
    const restricted = await request(app)
      .get(`${env.API_PREFIX}/supplier/inventory`)
      .set("authorization", first.authorization);
    expect(restricted.status).toBe(403);
  });

  it("allows staff inventory work but reserves deactivation for owners", async () => {
    const { product } = await catalogueFixture();
    const staff = await supplierContext("staff@autopro.test", UserRole.SUPPLIER_STAFF);
    const created = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory`)
      .set("authorization", staff.authorization)
      .send(offeringPayload(product.id));
    expect(created.status).toBe(201);
    const denied = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/${created.body.data.id}/deactivate`)
      .set("authorization", staff.authorization);
    expect(denied.status).toBe(403);
  });
});

describe("supplier listing images", () => {
  it("validates, isolates, orders, caps, publishes, and protects the primary image", async () => {
    const { product } = await catalogueFixture();
    const owner = await supplierContext("images-owner@autopro.test");
    const other = await supplierContext("images-other@autopro.test");
    const created = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory`)
      .set("authorization", owner.authorization)
      .set("x-business-id", owner.business.id)
      .send(offeringPayload(product.id, "IMAGE-LISTING"));
    expect(created.status).toBe(201);
    const inventoryId = created.body.data.id as string;
    await prisma.supplierInventory.update({
      where: { id: inventoryId },
      data: { legacyImageExempt: true },
    });

    const invalid = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/${inventoryId}/images`)
      .set("authorization", owner.authorization)
      .set("content-type", "image/png")
      .send(Buffer.from("spoofed"));
    expect(invalid.status).toBe(400);

    const unnormalized = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/${inventoryId}/images`)
      .set("authorization", owner.authorization)
      .set("content-type", "image/png")
      .send(testPng());
    expect(unnormalized.status).toBe(415);
    expect(unnormalized.body.error.code).toBe("LISTING_IMAGE_NORMALIZATION_REQUIRED");

    const images: Array<{ id: string; url: string }> = [];
    for (let index = 0; index < 4; index += 1) {
      const uploaded = await request(app)
        .post(`${env.API_PREFIX}/supplier/inventory/${inventoryId}/images`)
        .set("authorization", owner.authorization)
        .set("content-type", "image/webp")
        .send(testWebp(640 + index, 480));
      expect(uploaded.status).toBe(201);
      images.push(uploaded.body.data);
    }
    expect(
      (
        await prisma.supplierInventory.findUniqueOrThrow({
          where: { id: inventoryId },
          select: { legacyImageExempt: true },
        })
      ).legacyImageExempt,
    ).toBe(false);
    const overflow = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/${inventoryId}/images`)
      .set("authorization", owner.authorization)
      .set("content-type", "image/webp")
      .send(testWebp());
    expect(overflow.status).toBe(409);

    const isolated = await request(app)
      .delete(
        `${env.API_PREFIX}/supplier/inventory/${inventoryId}/images/${images[0]!.id}`,
      )
      .set("authorization", other.authorization);
    expect(isolated.status).toBe(404);

    const order = images.map((image) => image.id).reverse();
    const reordered = await request(app)
      .patch(`${env.API_PREFIX}/supplier/inventory/${inventoryId}/images`)
      .set("authorization", owner.authorization)
      .send({ imageIds: order });
    expect(reordered.status).toBe(200);
    expect(reordered.body.data[0]).toMatchObject({ id: order[0], isPrimary: true });

    const published = await request(app)
      .patch(`${env.API_PREFIX}/supplier/inventory/${inventoryId}`)
      .set("authorization", owner.authorization)
      .send({ publicationStatus: "PUBLISHED" });
    expect(published.status).toBe(200);
    expect((await request(app).get(reordered.body.data[0].url)).status).toBe(404);

    await prisma.supplierInventory.update({
      where: { id: inventoryId },
      data: { moderationStatus: "APPROVED" },
    });

    const publicImage = await request(app).get(reordered.body.data[0].url);
    expect(publicImage.status).toBe(200);
    expect(publicImage.headers["cache-control"]).toContain("immutable");
    expect(publicImage.headers["content-type"]).toContain("image/webp");

    const replaced = await request(app)
      .put(`${env.API_PREFIX}/supplier/inventory/${inventoryId}/images/${order[0]}`)
      .set("authorization", owner.authorization)
      .set("content-type", "image/webp")
      .send(testWebp(800, 600));
    expect(replaced.status).toBe(200);
    expect(replaced.body.data).toMatchObject({ id: order[0], version: 2 });
    expect(replaced.body.data.url).not.toBe(reordered.body.data[0].url);
    expect((await request(app).get(reordered.body.data[0].url)).status).toBe(404);
    expect((await request(app).get(replaced.body.data.url)).status).toBe(200);

    for (const imageId of order.slice(1)) {
      expect(
        (
          await request(app)
            .delete(
              `${env.API_PREFIX}/supplier/inventory/${inventoryId}/images/${imageId}`,
            )
            .set("authorization", owner.authorization)
        ).status,
      ).toBe(204);
    }
    const lastDelete = await request(app)
      .delete(`${env.API_PREFIX}/supplier/inventory/${inventoryId}/images/${order[0]}`)
      .set("authorization", owner.authorization);
    expect(lastDelete.status).toBe(409);
  });

  it("serializes supplier-wide quota checks across concurrent sessions", async () => {
    const { category, brand, product } = await catalogueFixture();
    const secondProduct = await prisma.product.create({
      data: {
        catalogueCode: "CAT-FILTER-QUOTA-2",
        name: "Cabin Filter",
        categoryId: category.id,
        brandId: brand.id,
      },
    });
    const supplier = await supplierContext("images-quota@autopro.test");
    const listings = await Promise.all(
      [product.id, secondProduct.id].map((productId, index) =>
        prisma.supplierInventory.create({
          data: {
            businessId: supplier.business.id,
            productId,
            sku: `QUOTA-${index + 1}`,
            unitPrice: "100.00",
            stockQuantity: 2,
            availabilityStatus: InventoryAvailability.IN_STOCK,
            listingClassification: SupplierListingClassification.NEW_AFTERMARKET,
          },
        }),
      ),
    );
    await prisma.supplierListingImage.createMany({
      data: [
        {
          inventoryId: listings[0]!.id,
          storageKey: `${randomUUID()}.webp`,
          mimeType: "image/webp",
          byteSize: 30,
          width: 640,
          height: 480,
          displayOrder: 0,
          isPrimary: true,
        },
        {
          inventoryId: listings[0]!.id,
          storageKey: `${randomUUID()}.webp`,
          mimeType: "image/webp",
          byteSize: 30,
          width: 640,
          height: 480,
          displayOrder: 1,
          isPrimary: false,
        },
        {
          inventoryId: listings[1]!.id,
          storageKey: `${randomUUID()}.webp`,
          mimeType: "image/webp",
          byteSize: 30,
          width: 640,
          height: 480,
          displayOrder: 0,
          isPrimary: true,
        },
      ],
    });
    const secondAuthorization = await authorization(supplier.user.email);

    const responses = await Promise.all(
      listings.map((listing, index) =>
        request(quotaApp)
          .post(`${env.API_PREFIX}/supplier/inventory/${listing.id}/images`)
          .set(
            "authorization",
            index === 0 ? supplier.authorization : secondAuthorization,
          )
          .set("x-business-id", supplier.business.id)
          .set("content-type", "image/webp")
          .send(testWebp()),
      ),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.supplierListingImage.count({
        where: { inventory: { businessId: supplier.business.id } },
      }),
    ).toBe(4);
    expect(responses.find((response) => response.status === 409)!.body.error.code).toBe(
      "SUPPLIER_IMAGE_QUOTA",
    );
  });
});

describe("public customer catalogue discovery", () => {
  it("keeps only migration-grandfathered approved listings discoverable without images", async () => {
    const { product } = await catalogueFixture();
    await prisma.product.update({
      where: { id: product.id },
      data: { imagePath: "/assets/legacy-filter.jpg" },
    });
    const supplier = await supplierContext("public-legacy@autopro.test");
    await prisma.supplierInventory.createMany({
      data: [
        {
          businessId: supplier.business.id,
          productId: product.id,
          sku: "LEGACY-VISIBLE",
          unitPrice: "110.00",
          stockQuantity: 2,
          availabilityStatus: InventoryAvailability.IN_STOCK,
          listingClassification: SupplierListingClassification.NEW_GENUINE,
          publicationStatus: ListingPublicationStatus.PUBLISHED,
          moderationStatus: "APPROVED",
          legacyImageExempt: true,
        },
        {
          businessId: supplier.business.id,
          productId: product.id,
          sku: "IMAGELESS-HIDDEN",
          unitPrice: "90.00",
          stockQuantity: 2,
          availabilityStatus: InventoryAvailability.IN_STOCK,
          listingClassification: SupplierListingClassification.NEW_AFTERMARKET,
          publicationStatus: ListingPublicationStatus.PUBLISHED,
          moderationStatus: "APPROVED",
        },
      ],
    });

    const response = await request(app).get(
      `${env.API_PREFIX}/catalogue/products?pageSize=20`,
    );
    expect(response.status).toBe(200);
    expect(response.body.data.items).toEqual([
      expect.objectContaining({
        id: product.id,
        imagePath: "/assets/legacy-filter.jpg",
        offerCount: 1,
      }),
    ]);
    expect(JSON.stringify(response.body)).not.toContain("IMAGELESS-HIDDEN");
  });

  it("keeps used-part listings quote-based instead of advertising a zero price", async () => {
    const { product } = await catalogueFixture();
    const supplier = await supplierContext("public-used@autopro.test");
    const listing = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory`)
      .set("authorization", supplier.authorization)
      .set("x-business-id", supplier.business.id)
      .send({
        ...offeringPayload(product.id, "USED-PUBLIC-1"),
        unitPrice: "0.00",
        condition: "USED",
        listingClassification: "USED",
      });
    expect(listing.status).toBe(201);
    await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/${listing.body.data.id}/images`)
      .set("authorization", supplier.authorization)
      .set("x-business-id", supplier.business.id)
      .set("content-type", "image/webp")
      .send(testWebp());
    await request(app)
      .patch(`${env.API_PREFIX}/supplier/inventory/${listing.body.data.id}`)
      .set("authorization", supplier.authorization)
      .set("x-business-id", supplier.business.id)
      .send({ publicationStatus: "PUBLISHED" });
    await prisma.supplierInventory.update({
      where: { id: listing.body.data.id },
      data: { moderationStatus: "APPROVED" },
    });
    const response = await request(app).get(
      `${env.API_PREFIX}/catalogue/products?pageSize=20`,
    );
    expect(response.status).toBe(200);
    expect(response.body.data.items[0]).toMatchObject({
      id: product.id,
      priceFrom: null,
      quoteBasedAvailable: true,
    });
  });

  it("returns only eligible available offerings without supplier identity", async () => {
    const { product } = await catalogueFixture();
    const eligible = await supplierContext("public-eligible@autopro.test");
    const hidden = await supplierContext("public-suspended@autopro.test");
    await prisma.supplierBusiness.update({
      where: { id: hidden.business.id },
      data: { status: SupplierBusinessStatus.SUSPENDED },
    });
    await prisma.product.update({
      where: { id: product.id },
      data: { imagePath: "/assets/stock-air-filter.jpg" },
    });
    await prisma.supplierInventory.createMany({
      data: [
        {
          businessId: eligible.business.id,
          productId: product.id,
          sku: "PUBLIC-1",
          unitPrice: "1250.50",
          stockQuantity: 4,
          availabilityStatus: InventoryAvailability.IN_STOCK,
          listingClassification: SupplierListingClassification.NEW_GENUINE,
          publicationStatus: ListingPublicationStatus.PUBLISHED,
          moderationStatus: "APPROVED",
        },
        {
          businessId: hidden.business.id,
          productId: product.id,
          sku: "HIDDEN-1",
          unitPrice: "900.00",
          stockQuantity: 8,
          availabilityStatus: InventoryAvailability.IN_STOCK,
          listingClassification: SupplierListingClassification.NEW_AFTERMARKET,
          publicationStatus: ListingPublicationStatus.PUBLISHED,
        },
      ],
    });
    const eligibleListing = await prisma.supplierInventory.findFirstOrThrow({
      where: { businessId: eligible.business.id, sku: "PUBLIC-1" },
    });
    await attachImage(eligibleListing.id);

    const response = await request(app).get(
      `${env.API_PREFIX}/catalogue/products?pageSize=20`,
    );
    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items[0]).toMatchObject({
      id: product.id,
      priceFrom: "1250.50",
      availability: "AVAILABLE",
      listingClassifications: ["NEW_GENUINE"],
      offerCount: 1,
    });
    expect(response.body.data.items[0].imagePath).toMatch(
      /\/catalogue\/listing-images\//,
    );
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(eligible.business.id);
    expect(serialized).not.toContain(hidden.business.id);
    expect(serialized).not.toContain("displayName");
    expect(serialized).not.toContain("PUBLIC-1");

    const detail = await request(app).get(
      `${env.API_PREFIX}/catalogue/products/${product.id}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.data.offers).toEqual([
      expect.objectContaining({
        supplier: { displayName: eligible.business.displayName },
        listingClassification: "NEW_GENUINE",
        fixedPrice: "1250.50",
        availableQuantity: 4,
        requestAction: "PURCHASE_REQUEST",
      }),
    ]);
    const detailSerialized = JSON.stringify(detail.body);
    expect(detailSerialized).not.toContain("availableCredit");
    expect(detailSerialized).not.toContain("creditEligible");
    expect(detailSerialized).not.toContain("PUBLIC-1");
  });

  it("excludes draft, rejected, and unclassified supplier listings", async () => {
    const { product } = await catalogueFixture();
    const draft = await supplierContext("public-draft@autopro.test");
    const rejected = await supplierContext("public-rejected@autopro.test");
    const unclassified = await supplierContext("public-unclassified@autopro.test");
    await prisma.supplierInventory.createMany({
      data: [
        {
          businessId: draft.business.id,
          productId: product.id,
          sku: "DRAFT-HIDDEN",
          unitPrice: "100.00",
          stockQuantity: 2,
          availabilityStatus: InventoryAvailability.IN_STOCK,
          listingClassification: SupplierListingClassification.NEW_GENUINE,
          publicationStatus: ListingPublicationStatus.DRAFT,
        },
        {
          businessId: rejected.business.id,
          productId: product.id,
          sku: "REJECTED-HIDDEN",
          unitPrice: "100.00",
          stockQuantity: 2,
          availabilityStatus: InventoryAvailability.IN_STOCK,
          listingClassification: SupplierListingClassification.NEW_AFTERMARKET,
          publicationStatus: ListingPublicationStatus.PUBLISHED,
          moderationStatus: "REJECTED",
        },
        {
          businessId: unclassified.business.id,
          productId: product.id,
          sku: "UNCLASSIFIED-HIDDEN",
          unitPrice: "100.00",
          stockQuantity: 2,
          availabilityStatus: InventoryAvailability.IN_STOCK,
          publicationStatus: ListingPublicationStatus.PUBLISHED,
        },
      ],
    });
    const response = await request(app).get(
      `${env.API_PREFIX}/catalogue/products?pageSize=20`,
    );
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ total: 0, items: [] });
  });

  it("ranks credit-ready fixed offers without exposing supplier finances", async () => {
    const { product } = await catalogueFixture();
    const ready = await supplierContext("public-ready@autopro.test");
    const waiting = await supplierContext("public-waiting@autopro.test");
    const admin = await provisionUser("public-policy@autopro.test", UserRole.ADMIN);
    await prisma.commissionPolicy.create({
      data: {
        rateBps: 1000,
        reason: "Public offer ordering test",
        createdByUserId: admin.id,
      },
    });
    await prisma.supplierWallet.create({
      data: { businessId: ready.business.id, availableCredit: "1000.00" },
    });
    await prisma.supplierWallet.create({
      data: { businessId: waiting.business.id, availableCredit: "0.00" },
    });
    await prisma.supplierInventory.createMany({
      data: [
        {
          businessId: ready.business.id,
          productId: product.id,
          sku: "READY-GENUINE",
          unitPrice: "1400.00",
          stockQuantity: 3,
          availabilityStatus: InventoryAvailability.IN_STOCK,
          listingClassification: SupplierListingClassification.NEW_GENUINE,
          publicationStatus: ListingPublicationStatus.PUBLISHED,
          moderationStatus: "APPROVED",
        },
        {
          businessId: waiting.business.id,
          productId: product.id,
          sku: "WAITING-AFTERMARKET",
          unitPrice: "900.00",
          stockQuantity: 3,
          availabilityStatus: InventoryAvailability.IN_STOCK,
          listingClassification: SupplierListingClassification.NEW_AFTERMARKET,
          publicationStatus: ListingPublicationStatus.PUBLISHED,
          moderationStatus: "APPROVED",
        },
      ],
    });
    const publicListings = await prisma.supplierInventory.findMany({
      where: {
        productId: product.id,
        sku: { in: ["READY-GENUINE", "WAITING-AFTERMARKET"] },
      },
    });
    await Promise.all(publicListings.map((listing) => attachImage(listing.id)));

    const response = await request(app).get(
      `${env.API_PREFIX}/catalogue/products/${product.id}`,
    );
    expect(response.status).toBe(200);
    expect(
      response.body.data.offers.map(
        (offer: { supplier: { displayName: string } }) => offer.supplier.displayName,
      ),
    ).toEqual([ready.business.displayName, waiting.business.displayName]);
    expect(JSON.stringify(response.body)).not.toMatch(
      /availableCredit|creditEligible|requiredCredit|rateBps/,
    );
  });

  it("keeps active categories visible even before they contain offerings", async () => {
    await prisma.partCategory.create({
      data: {
        name: "Lubricants",
        slug: "lubricants",
        imagePath: "/assets/engine-oil.jpg",
      },
    });
    const response = await request(app).get(
      `${env.API_PREFIX}/catalogue/categories?pageSize=20`,
    );
    expect(response.status).toBe(200);
    expect(response.body.data.items).toContainEqual(
      expect.objectContaining({
        slug: "lubricants",
        imagePath: "/assets/engine-oil.jpg",
      }),
    );
  });
});

describe("stock integrity", () => {
  it("serializes concurrent adjustments and makes adjustment retries idempotent", async () => {
    const { product } = await catalogueFixture();
    const supplier = await supplierContext("stock-owner@autopro.test");
    const created = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory`)
      .set("authorization", supplier.authorization)
      .send(offeringPayload(product.id));
    const inventoryId = created.body.data.id as string;

    const [first, second] = await Promise.all([
      request(app)
        .post(`${env.API_PREFIX}/supplier/inventory/${inventoryId}/stock-adjustments`)
        .set("authorization", supplier.authorization)
        .send({
          idempotencyKey: "concurrent-a",
          quantityDelta: 2,
          reason: "Goods received",
        }),
      request(app)
        .post(`${env.API_PREFIX}/supplier/inventory/${inventoryId}/stock-adjustments`)
        .set("authorization", supplier.authorization)
        .send({
          idempotencyKey: "concurrent-b",
          quantityDelta: 3,
          reason: "Goods received",
        }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const stored = await prisma.supplierInventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    expect(stored.stockQuantity).toBe(15);

    const retry = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/${inventoryId}/stock-adjustments`)
      .set("authorization", supplier.authorization)
      .send({
        idempotencyKey: "concurrent-a",
        quantityDelta: 2,
        reason: "Goods received",
      });
    expect(retry.status).toBe(200);
    expect(retry.body.data.duplicate).toBe(true);
    expect(
      await prisma.inventoryStockAdjustment.count({
        where: { idempotencyKey: { startsWith: "concurrent-" } },
      }),
    ).toBe(2);
    expect(
      (await prisma.supplierInventory.findUniqueOrThrow({ where: { id: inventoryId } }))
        .stockQuantity,
    ).toBe(15);
  });

  it("protects reserved stock, computes availability, and preserves deactivated history", async () => {
    const { product } = await catalogueFixture();
    const supplier = await supplierContext("reserved-owner@autopro.test");
    const created = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory`)
      .set("authorization", supplier.authorization)
      .send(offeringPayload(product.id));
    const inventoryId = created.body.data.id as string;
    await prisma.supplierInventory.update({
      where: { id: inventoryId },
      data: { reservedQuantity: 4 },
    });
    const rejected = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/${inventoryId}/stock-adjustments`)
      .set("authorization", supplier.authorization)
      .send({
        idempotencyKey: "reserved-reduction",
        quantityDelta: -7,
        reason: "Stock count",
      });
    expect(rejected.status).toBe(409);

    const unavailable = await request(app)
      .patch(`${env.API_PREFIX}/supplier/inventory/${inventoryId}`)
      .set("authorization", supplier.authorization)
      .send({ isAvailable: false });
    expect(unavailable.body.data.availabilityStatus).toBe(InventoryAvailability.HIDDEN);

    const deactivated = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/${inventoryId}/deactivate`)
      .set("authorization", supplier.authorization);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.isActive).toBe(false);
    expect(await prisma.supplierInventory.count({ where: { id: inventoryId } })).toBe(1);
  });

  it("applies bounded absolute-stock bulk updates atomically with versions", async () => {
    const { product } = await catalogueFixture();
    const supplier = await supplierContext("bulk-owner@autopro.test");
    const created = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory`)
      .set("authorization", supplier.authorization)
      .send(offeringPayload(product.id));
    const bulk = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/bulk`)
      .set("authorization", supplier.authorization)
      .send({
        operationId: "bulk-operation-1",
        items: [
          {
            inventoryId: created.body.data.id,
            version: created.body.data.version,
            stockQuantity: 6,
            stockReason: "Cycle count",
            unitPrice: "1199.90",
          },
        ],
      });
    expect(bulk.status).toBe(200);
    expect(bulk.body.data.items[0]).toMatchObject({
      stockQuantity: 6,
      unitPrice: "1199.90",
    });
    const stale = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/bulk`)
      .set("authorization", supplier.authorization)
      .send({
        operationId: "bulk-operation-2",
        items: [
          {
            inventoryId: created.body.data.id,
            version: created.body.data.version,
            unitPrice: "1100.00",
          },
        ],
      });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("STALE_INVENTORY_VERSION");
  });
});

describe("inventory CSV", () => {
  function csv(productId: string, stock = 8) {
    return [
      "product_id,part_number,sku,condition,unit_price,stock_quantity,minimum_stock,preparation_time_minutes,is_available,notes",
      `${productId},,CSV-001,NEW,999.95,${stock},2,30,true,Imported`,
    ].join("\n");
  }

  it("previews row errors without mutation and confirms valid files only once", async () => {
    const { product } = await catalogueFixture();
    const supplier = await supplierContext("csv-owner@autopro.test");
    const invalidPreview = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/csv/preview`)
      .set("authorization", supplier.authorization)
      .set("content-type", "text/csv")
      .send(csv(product.id).replace("999.95", "not-money"));
    expect(invalidPreview.status).toBe(201);
    expect(invalidPreview.body.data.summary.errors).toBe(1);
    expect(await prisma.supplierInventory.count()).toBe(0);
    const invalidConfirm = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/csv/confirm`)
      .set("authorization", supplier.authorization)
      .send({ previewId: invalidPreview.body.data.id });
    expect(invalidConfirm.status).toBe(409);

    const preview = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/csv/preview`)
      .set("authorization", supplier.authorization)
      .set("content-type", "text/csv")
      .send(csv(product.id));
    expect(preview.status).toBe(201);
    expect(preview.body.data.summary).toMatchObject({
      creates: 1,
      updates: 0,
      errors: 0,
    });
    const confirmed = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/csv/confirm`)
      .set("authorization", supplier.authorization)
      .send({ previewId: preview.body.data.id });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data).toMatchObject({ created: 1, duplicate: false });
    const duplicate = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/csv/confirm`)
      .set("authorization", supplier.authorization)
      .send({ previewId: preview.body.data.id });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.data.duplicate).toBe(true);
    expect(await prisma.supplierInventory.count()).toBe(1);
  });

  it("binds previews to the supplier and rejects stale updates", async () => {
    const { product } = await catalogueFixture();
    const supplier = await supplierContext("csv-stale@autopro.test");
    const other = await supplierContext("csv-other@autopro.test");
    const offering = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory`)
      .set("authorization", supplier.authorization)
      .send(offeringPayload(product.id, "CSV-001"));
    const preview = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/csv/preview`)
      .set("authorization", supplier.authorization)
      .set("content-type", "text/csv")
      .send(csv(product.id, 12));
    expect(preview.body.data.summary.updates).toBe(1);

    const wrongSupplier = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/csv/confirm`)
      .set("authorization", other.authorization)
      .send({ previewId: preview.body.data.id });
    expect(wrongSupplier.status).toBe(404);

    await request(app)
      .post(
        `${env.API_PREFIX}/supplier/inventory/${offering.body.data.id}/stock-adjustments`,
      )
      .set("authorization", supplier.authorization)
      .send({ idempotencyKey: "csv-stale-change", quantityDelta: 1, reason: "Count" });
    const stale = await request(app)
      .post(`${env.API_PREFIX}/supplier/inventory/csv/confirm`)
      .set("authorization", supplier.authorization)
      .send({ previewId: preview.body.data.id });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("INVENTORY_CSV_STALE");
  });
});
