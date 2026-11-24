import {
  AccountStatus,
  CreditRequirementStatus,
  InventoryAvailability,
  ListingPublicationStatus,
  QuotationStatus,
  SourcingRequestStatus,
  SupplierBusinessStatus,
  SupplierListingClassification,
  UserRole,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createLogger } from "../src/config/logger.js";
import { prisma } from "../src/config/prisma.js";
import { hashPassword } from "../src/modules/auth/password.js";
import { cleanupFulfillment } from "./helpers/cleanup-fulfillment.js";
import { LocalRequestAttachmentStorage } from "../src/modules/requests/attachment-storage.js";

const env = loadEnv();
const logger = createLogger();
const password = "StrongPassword123";
const attachmentDirectory = mkdtempSync(join(tmpdir(), "autopro-request-tests-"));
const app = createApp(env, logger, {
  requestAttachmentStorage: new LocalRequestAttachmentStorage(attachmentDirectory),
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function cleanDatabase() {
  await cleanupFulfillment(prisma);
  await prisma.auditLog.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.refreshSession.deleteMany();
  await prisma.accountInvitation.deleteMany();
  await prisma.quotation.deleteMany();
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
  await prisma.customerAddress.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.customerProfile.deleteMany();
  await prisma.user.deleteMany();
  const files = await readdir(attachmentDirectory);
  await Promise.all(files.map((file) => rm(join(attachmentDirectory, file))));
}

async function provisionUser(email: string, role: UserRole) {
  return prisma.user.create({
    data: {
      email,
      fullName: "Task 7 User",
      passwordHash: await hashPassword(password),
      role,
      accountStatus: AccountStatus.ACTIVE,
      customerProfile:
        role === UserRole.CUSTOMER
          ? { create: { fullName: "Task 7 Customer" } }
          : undefined,
    },
    include: { customerProfile: true },
  });
}

async function authorization(email: string) {
  const response = await request(app)
    .post(`${env.API_PREFIX}/auth/login`)
    .send({ email, password });
  expect(response.status).toBe(200);
  return `Bearer ${response.body.data.accessToken as string}`;
}

async function userContext(email: string, role: UserRole = UserRole.CUSTOMER) {
  const user = await provisionUser(email, role);
  if (role === UserRole.SUPPLIER_OWNER || role === UserRole.SUPPLIER_STAFF) {
    await prisma.supplierBusiness.create({
      data: {
        legalName: `${email} Test Business`,
        displayName: email,
        status: SupplierBusinessStatus.ACTIVE,
        subscriptionGraceEndsAt: new Date("2099-01-01T00:00:00.000Z"),
        members: {
          create: { userId: user.id, isPrimary: role === UserRole.SUPPLIER_OWNER },
        },
      },
    });
  }
  return { user, authorization: await authorization(email) };
}

function completeDraft(items = [{ description: "Front brake pad", quantity: 2 }]) {
  return {
    title: "Brake service parts",
    manualVehicle: { make: "Toyota", model: "Axio", year: 2016 },
    manualDelivery: {
      recipientName: "Test Customer",
      phone: "+8801700000011",
      addressLine: "12 Test Road",
      area: "Dhanmondi",
      city: "Dhaka",
    },
    items,
  };
}

async function createDraft(authorization: string, payload: object = completeDraft()) {
  return request(app)
    .post(`${env.API_PREFIX}/customers/me/requests`)
    .set("authorization", authorization)
    .send(payload);
}

async function submitDraft(authorization: string, requestId: string, key: string) {
  return request(app)
    .post(`${env.API_PREFIX}/customers/me/requests/${requestId}/submit`)
    .set("authorization", authorization)
    .send({ idempotencyKey: key });
}

async function uploadPhoto(
  authorization: string,
  requestId: string,
  requestItemId?: string,
) {
  const suffix = requestItemId ? `?requestItemId=${requestItemId}` : "";
  return request(app)
    .post(`${env.API_PREFIX}/customers/me/requests/${requestId}/attachments${suffix}`)
    .set("authorization", authorization)
    .set("content-type", "image/png")
    .set("x-file-name", "customer-photo.png")
    .send(png);
}

beforeEach(cleanDatabase);

afterAll(async () => {
  await cleanDatabase();
  await rm(attachmentDirectory, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("customer sourcing request drafts and submission", () => {
  it("supports incomplete drafts, item edits, strict fields, and idempotent submission", async () => {
    const { authorization } = await userContext("drafts@autopro.test");
    const [first, second] = await Promise.all([
      createDraft(authorization, { items: [] }),
      createDraft(authorization, { items: [] }),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.requestNumber).toMatch(/^RFQ-\d{4}-\d{6}$/);
    expect(first.body.data.requestNumber).not.toBe(second.body.data.requestNumber);

    const protectedFields = await request(app)
      .patch(`${env.API_PREFIX}/customers/me/requests/${first.body.data.id}`)
      .set("authorization", authorization)
      .send({ customerId: randomUUID(), status: SourcingRequestStatus.SUBMITTED });
    expect(protectedFields.status).toBe(400);

    const item = await request(app)
      .post(`${env.API_PREFIX}/customers/me/requests/${first.body.data.id}/items`)
      .set("authorization", authorization)
      .send({ quantity: 1 });
    expect(item.status).toBe(201);
    const invalidSubmission = await submitDraft(
      authorization,
      first.body.data.id,
      "draft-submit-0001",
    );
    expect(invalidSubmission.status).toBe(400);

    const completed = await request(app)
      .patch(`${env.API_PREFIX}/customers/me/requests/${first.body.data.id}`)
      .set("authorization", authorization)
      .send({
        manualVehicle: { make: "Honda", model: "Vezel" },
        manualDelivery: completeDraft().manualDelivery,
      });
    expect(completed.status).toBe(200);
    const itemId = completed.body.data.items[0].id as string;
    const identified = await request(app)
      .patch(
        `${env.API_PREFIX}/customers/me/requests/${first.body.data.id}/items/${itemId}`,
      )
      .set("authorization", authorization)
      .send({ partNumber: "PAD-100" });
    expect(identified.status).toBe(200);

    const [submitted, retried] = await Promise.all([
      submitDraft(authorization, first.body.data.id, "draft-submit-0001"),
      submitDraft(authorization, first.body.data.id, "draft-submit-0001"),
    ]);
    expect(submitted.status).toBe(200);
    expect(retried.status).toBe(200);
    const stored = await prisma.sourcingRequest.findUniqueOrThrow({
      where: { id: first.body.data.id },
      include: { statusHistory: true },
    });
    expect(stored.status).toBe(SourcingRequestStatus.SUBMITTED);
    expect(
      stored.statusHistory.filter(
        (history) => history.toStatus === SourcingRequestStatus.SUBMITTED,
      ),
    ).toHaveLength(1);

    const reusedDifferently = await submitDraft(
      authorization,
      first.body.data.id,
      "different-submit-key",
    );
    expect(reusedDifferently.status).toBe(409);
    expect(JSON.stringify(submitted.body)).not.toMatch(
      /adminNotes|serviceAreaEligible|responseDeadlineAt|submissionKey|storageKey|contentSha256/,
    );
  });

  it("supports multi-part and photo-only identification while enforcing file rules", async () => {
    const { authorization } = await userContext("photos@autopro.test");
    const created = await createDraft(
      authorization,
      completeDraft([
        { description: "Oil filter", quantity: 1 },
        { description: "", quantity: 1 },
      ]),
    );
    const secondItemId = created.body.data.items[1].id as string;
    const uploaded = await uploadPhoto(authorization, created.body.data.id, secondItemId);
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data).not.toHaveProperty("storageKey");
    expect(
      await submitDraft(authorization, created.body.data.id, "multi-submit-01"),
    ).toHaveProperty("status", 200);

    const photoOnly = await createDraft(
      authorization,
      completeDraft([{ description: "", quantity: 1 }]),
    );
    const invalid = await request(app)
      .post(
        `${env.API_PREFIX}/customers/me/requests/${photoOnly.body.data.id}/attachments`,
      )
      .set("authorization", authorization)
      .set("content-type", "image/png")
      .send(Buffer.from("<svg><script/></svg>"));
    expect(invalid.status).toBe(400);
    const photo = await uploadPhoto(authorization, photoOnly.body.data.id);
    expect(photo.status).toBe(201);
    const submitted = await submitDraft(
      authorization,
      photoOnly.body.data.id,
      "photo-submit-01",
    );
    expect(submitted.status).toBe(200);
  });
});

describe("ownership, snapshots, and concurrent transitions", () => {
  it("validates saved-reference ownership and preserves submission snapshots", async () => {
    const owner = await userContext("snapshot-owner@autopro.test");
    const outsider = await userContext("snapshot-outsider@autopro.test");
    const customerId = owner.user.customerProfile!.id;
    const vehicle = await prisma.vehicle.create({
      data: { customerId, make: "Toyota", model: "Premio", year: 2015 },
    });
    const address = await prisma.customerAddress.create({
      data: {
        customerId,
        label: "Home",
        recipientName: "Snapshot Owner",
        phone: "+8801700000022",
        addressLine: "Old address",
        area: "Uttara",
        city: "Dhaka",
      },
    });
    const denied = await createDraft(outsider.authorization, {
      vehicleId: vehicle.id,
      deliveryAddressId: address.id,
      items: [{ description: "Mirror", quantity: 1 }],
    });
    expect(denied.status).toBe(404);

    const draft = await createDraft(owner.authorization, {
      vehicleId: vehicle.id,
      deliveryAddressId: address.id,
      items: [{ description: "Mirror", quantity: 1 }],
    });
    expect(draft.status).toBe(201);
    expect(
      await submitDraft(owner.authorization, draft.body.data.id, "snapshot-submit"),
    ).toHaveProperty("status", 200);
    await prisma.vehicle.update({
      where: { id: vehicle.id },
      data: { model: "Changed later" },
    });
    await prisma.customerAddress.update({
      where: { id: address.id },
      data: { addressLine: "Changed later" },
    });
    const viewed = await request(app)
      .get(`${env.API_PREFIX}/customers/me/requests/${draft.body.data.id}`)
      .set("authorization", owner.authorization);
    expect(viewed.body.data.vehicleSnapshot.model).toBe("Premio");
    expect(viewed.body.data.deliverySnapshot.addressLine).toBe("Old address");
    const hidden = await request(app)
      .get(`${env.API_PREFIX}/customers/me/requests/${draft.body.data.id}`)
      .set("authorization", outsider.authorization);
    expect(hidden.status).toBe(404);
  });

  it("serializes edit/cancel races and blocks changes after the winning transition", async () => {
    const { authorization } = await userContext("race@autopro.test");
    const draft = await createDraft(authorization);
    const itemId = draft.body.data.items[0].id as string;
    const [edit, cancelled] = await Promise.all([
      request(app)
        .patch(
          `${env.API_PREFIX}/customers/me/requests/${draft.body.data.id}/items/${itemId}`,
        )
        .set("authorization", authorization)
        .send({ quantity: 3 }),
      request(app)
        .post(`${env.API_PREFIX}/customers/me/requests/${draft.body.data.id}/cancel`)
        .set("authorization", authorization)
        .send({ reason: "No longer needed" }),
    ]);
    expect(cancelled.status).toBe(200);
    expect([200, 409]).toContain(edit.status);
    const stored = await prisma.sourcingRequest.findUniqueOrThrow({
      where: { id: draft.body.data.id },
    });
    expect(stored.status).toBe(SourcingRequestStatus.CANCELLED);
    const after = await request(app)
      .patch(
        `${env.API_PREFIX}/customers/me/requests/${draft.body.data.id}/items/${itemId}`,
      )
      .set("authorization", authorization)
      .send({ quantity: 4 });
    expect(after.status).toBe(409);
  });
});

describe("customer storefront listing workflows", () => {
  it("creates a fixed-price request and exposes it to the selected supplier", async () => {
    const customer = await userContext("storefront-fixed@autopro.test");
    const supplier = await userContext(
      "storefront-fixed-supplier@autopro.test",
      UserRole.SUPPLIER_OWNER,
    );
    const admin = await provisionUser("storefront-policy@autopro.test", UserRole.ADMIN);
    const business = await prisma.supplierBusiness.findFirstOrThrow({
      where: { members: { some: { userId: supplier.user.id } } },
    });
    const category = await prisma.partCategory.create({
      data: { name: "Storefront Brakes", slug: `storefront-${randomUUID()}` },
    });
    const product = await prisma.product.create({
      data: {
        name: "Storefront Brake Pad",
        categoryId: category.id,
        numbers: { create: { partNumber: "SF-BRAKE-1", isPrimary: true } },
      },
    });
    const listing = await prisma.supplierInventory.create({
      data: {
        businessId: business.id,
        productId: product.id,
        sku: "SF-FIXED-1",
        stockQuantity: 5,
        unitPrice: "2500.00",
        availabilityStatus: InventoryAvailability.IN_STOCK,
        listingClassification: SupplierListingClassification.NEW_GENUINE,
        publicationStatus: ListingPublicationStatus.PUBLISHED,
      },
    });
    await prisma.commissionPolicy.create({
      data: {
        rateBps: 1000,
        reason: "Storefront workflow",
        createdByUserId: admin.id,
      },
    });
    await prisma.supplierWallet.create({
      data: { businessId: business.id, availableCredit: "1000.00" },
    });
    const address = await prisma.customerAddress.create({
      data: {
        customerId: customer.user.customerProfile!.id,
        recipientName: "Storefront Customer",
        phone: "+8801700000066",
        addressLine: "15 Commerce Road",
        area: "Banani",
        city: "Dhaka",
      },
    });

    const created = await request(app)
      .post(`${env.API_PREFIX}/customers/me/purchase-requests`)
      .set("authorization", customer.authorization)
      .send({
        listingId: listing.id,
        quantity: 2,
        deliveryAddressId: address.id,
        idempotencyKey: "storefront-fixed-0001",
      });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      requestType: "FIXED_PRICE_PURCHASE",
      status: SourcingRequestStatus.SUBMITTED,
      creditStatus: CreditRequirementStatus.ELIGIBLE,
    });

    const supplierView = await request(app)
      .get(`${env.API_PREFIX}/supplier/commerce/purchase-requests?pageSize=20`)
      .set("authorization", supplier.authorization)
      .set("x-business-id", business.id);
    expect(supplierView.status).toBe(200);
    expect(supplierView.body.data.items).toEqual([
      expect.objectContaining({
        requestNumber: created.body.data.requestNumber,
        creditStatus: CreditRequirementStatus.ELIGIBLE,
      }),
    ]);
  });

  it("routes a targeted used-part RFQ to only its listing supplier", async () => {
    const customer = await userContext("storefront-used@autopro.test");
    const supplier = await userContext(
      "storefront-used-supplier@autopro.test",
      UserRole.SUPPLIER_OWNER,
    );
    const business = await prisma.supplierBusiness.findFirstOrThrow({
      where: { members: { some: { userId: supplier.user.id } } },
    });
    const category = await prisma.partCategory.create({
      data: { name: "Storefront Used", slug: `used-${randomUUID()}` },
    });
    const product = await prisma.product.create({
      data: { name: "Used Steering Rack", categoryId: category.id },
    });
    const listing = await prisma.supplierInventory.create({
      data: {
        businessId: business.id,
        productId: product.id,
        sku: "SF-USED-1",
        stockQuantity: 1,
        unitPrice: "0.00",
        condition: "USED",
        availabilityStatus: InventoryAvailability.IN_STOCK,
        listingClassification: SupplierListingClassification.USED,
        publicationStatus: ListingPublicationStatus.PUBLISHED,
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        customerId: customer.user.customerProfile!.id,
        make: "Toyota",
        model: "Axio",
        year: 2016,
      },
    });
    const address = await prisma.customerAddress.create({
      data: {
        customerId: customer.user.customerProfile!.id,
        recipientName: "Used Parts Customer",
        phone: "+8801700000077",
        addressLine: "20 Used Road",
        area: "Uttara",
        city: "Dhaka",
      },
    });
    const draft = await createDraft(customer.authorization, {
      requestType: "USED_PART_RFQ",
      listingId: listing.id,
      vehicleId: vehicle.id,
      deliveryAddressId: address.id,
      items: [
        {
          description: product.name,
          productId: product.id,
          categoryId: category.id,
          quantity: 1,
        },
      ],
    });
    expect(draft.status).toBe(201);
    const submitted = await submitDraft(
      customer.authorization,
      draft.body.data.id,
      "storefront-used-0001",
    );
    expect(submitted.status).toBe(200);
    expect(submitted.body.data).toMatchObject({
      requestType: "USED_PART_RFQ",
      status: SourcingRequestStatus.MATCHING,
      targetBusiness: { displayName: business.displayName },
      listing: { fixedPrice: null },
    });
    const assignments = await prisma.supplierRequestAssignment.findMany({
      where: { requestId: draft.body.data.id },
      select: { businessId: true },
    });
    expect(assignments).toEqual([{ businessId: business.id }]);
  });
});

describe("attachment authorization and operational visibility", () => {
  it("authorizes downloads, cleans files, and prevents limit-write leaks", async () => {
    const owner = await userContext("file-owner@autopro.test");
    const outsider = await userContext("file-outsider@autopro.test");
    const draft = await createDraft(owner.authorization);
    const oversized = await request(app)
      .post(`${env.API_PREFIX}/customers/me/requests/${draft.body.data.id}/attachments`)
      .set("authorization", owner.authorization)
      .set("content-type", "image/png")
      .send(Buffer.alloc(5 * 1024 * 1024 + 1));
    expect(oversized.status).toBe(413);
    const uploads = [];
    for (let index = 0; index < 5; index += 1) {
      uploads.push(await uploadPhoto(owner.authorization, draft.body.data.id));
    }
    expect(uploads.every((upload) => upload.status === 201)).toBe(true);
    expect(await readdir(attachmentDirectory)).toHaveLength(5);
    const rejected = await uploadPhoto(owner.authorization, draft.body.data.id);
    expect(rejected.status).toBe(400);
    expect(await readdir(attachmentDirectory)).toHaveLength(5);

    const attachmentId = uploads[0]!.body.data.id as string;
    const ownDownload = await request(app)
      .get(
        `${env.API_PREFIX}/customers/me/requests/${draft.body.data.id}/attachments/${attachmentId}`,
      )
      .set("authorization", owner.authorization);
    expect(ownDownload.status).toBe(200);
    const hidden = await request(app)
      .get(
        `${env.API_PREFIX}/customers/me/requests/${draft.body.data.id}/attachments/${attachmentId}`,
      )
      .set("authorization", outsider.authorization);
    expect(hidden.status).toBe(404);

    const removed = await request(app)
      .delete(
        `${env.API_PREFIX}/customers/me/requests/${draft.body.data.id}/attachments/${attachmentId}`,
      )
      .set("authorization", owner.authorization);
    expect(removed.status).toBe(200);
    expect(await readdir(attachmentDirectory)).toHaveLength(4);
  });

  it("excludes drafts from admins, enforces roles, and blocks cancellation after acceptance", async () => {
    const customer = await userContext("operations-customer@autopro.test");
    const admin = await userContext("operations-admin@autopro.test", UserRole.ADMIN);
    const supplier = await userContext(
      "operations-supplier@autopro.test",
      UserRole.SUPPLIER_OWNER,
    );
    const draft = await createDraft(customer.authorization);
    const photo = await uploadPhoto(customer.authorization, draft.body.data.id);
    expect(photo.status).toBe(201);

    const customerDenied = await request(app)
      .get(`${env.API_PREFIX}/admin/requests`)
      .set("authorization", customer.authorization);
    expect(customerDenied.status).toBe(403);
    const supplierDenied = await request(app)
      .get(`${env.API_PREFIX}/admin/requests`)
      .set("authorization", supplier.authorization);
    expect(supplierDenied.status).toBe(403);
    const draftHidden = await request(app)
      .get(`${env.API_PREFIX}/admin/requests/${draft.body.data.id}`)
      .set("authorization", admin.authorization);
    expect(draftHidden.status).toBe(404);

    await submitDraft(customer.authorization, draft.body.data.id, "admin-visible-01");
    const visible = await request(app)
      .get(`${env.API_PREFIX}/admin/requests?status=SUBMITTED&pageSize=10`)
      .set("authorization", admin.authorization);
    expect(visible.status).toBe(200);
    expect(visible.body.data.total).toBe(1);
    const detail = await request(app)
      .get(`${env.API_PREFIX}/admin/requests/${draft.body.data.id}`)
      .set("authorization", admin.authorization);
    expect(detail.status).toBe(200);
    expect(detail.body.data.statusHistory).toHaveLength(2);
    const adminDownload = await request(app)
      .get(
        `${env.API_PREFIX}/admin/requests/${draft.body.data.id}/attachments/${photo.body.data.id}`,
      )
      .set("authorization", admin.authorization);
    expect(adminDownload.status).toBe(200);

    const business = await prisma.supplierBusiness.create({
      data: {
        legalName: "Accepted Quote Supplier Limited",
        displayName: "Accepted Quote Supplier",
        status: SupplierBusinessStatus.ACTIVE,
      },
    });
    await prisma.quotation.create({
      data: {
        quotationNumber: `QT-${randomUUID()}`,
        requestId: draft.body.data.id,
        businessId: business.id,
        status: QuotationStatus.ACCEPTED,
        revisionGroupId: randomUUID(),
        supplierSubtotal: "100.00",
        customerTotal: "110.00",
        acceptedAt: new Date(),
      },
    });
    const blocked = await request(app)
      .post(`${env.API_PREFIX}/customers/me/requests/${draft.body.data.id}/cancel`)
      .set("authorization", customer.authorization)
      .send({ reason: "Attempt after acceptance" });
    expect(blocked.status).toBe(409);

    const cancellable = await createDraft(customer.authorization);
    await submitDraft(
      customer.authorization,
      cancellable.body.data.id,
      "cancellable-submit",
    );
    const cancelled = await request(app)
      .post(`${env.API_PREFIX}/customers/me/requests/${cancellable.body.data.id}/cancel`)
      .set("authorization", customer.authorization)
      .send({ reason: "No longer required" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe(SourcingRequestStatus.CANCELLED);
  });
});
