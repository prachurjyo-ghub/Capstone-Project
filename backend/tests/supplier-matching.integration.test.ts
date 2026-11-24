import {
  AccountStatus,
  InventoryAvailability,
  ProductCondition,
  SourcingRequestStatus,
  SupplierAssignmentEventType,
  SupplierAssignmentStatus,
  SupplierBusinessStatus,
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
import type { MatchingClock } from "../src/modules/matching/matching-clock.js";
import { LocalRequestAttachmentStorage } from "../src/modules/requests/attachment-storage.js";
import { validateRequestImage } from "../src/modules/requests/image-validation.js";

const env = loadEnv();
const logger = createLogger();
const password = "StrongPassword123";
const initialNow = new Date("2026-10-19T00:00:00.000Z");
const attachmentDirectory = mkdtempSync(join(tmpdir(), "autopro-matching-tests-"));
const storage = new LocalRequestAttachmentStorage(attachmentDirectory);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

class MutableClock implements MatchingClock {
  current = new Date(initialNow);

  now() {
    return new Date(this.current);
  }
}

const clock = new MutableClock();
const app = createApp(env, logger, {
  requestAttachmentStorage: storage,
  matchingClock: clock,
});

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
      fullName: `${role} Test User`,
      phone: role === UserRole.CUSTOMER ? "+8801700999999" : null,
      passwordHash: await hashPassword(password),
      role,
      accountStatus: AccountStatus.ACTIVE,
      customerProfile:
        role === UserRole.CUSTOMER
          ? { create: { fullName: "Private Customer Name" } }
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

async function userContext(email: string, role: UserRole) {
  const user = await provisionUser(email, role);
  return { user, authorization: await authorization(email) };
}

async function catalogueFixture() {
  const category = await prisma.partCategory.create({
    data: { name: "Braking", slug: "braking" },
  });
  const product = await prisma.product.create({
    data: {
      catalogueCode: `T8-${randomUUID()}`,
      name: "Front Brake Pad",
      categoryId: category.id,
      numbers: { create: { partNumber: "PAD-T8-100", isPrimary: true } },
    },
  });
  return { category, product };
}

async function submittedRequest(
  customerId: string,
  categoryId: string,
  productId: string,
  withPhoto = false,
) {
  const created = await prisma.sourcingRequest.create({
    data: {
      requestNumber: `RFQ-T8-${randomUUID()}`,
      customerId,
      status: SourcingRequestStatus.SUBMITTED,
      urgency: "URGENT",
      title: "Brake parts required",
      customerNotes: "Private customer-level note",
      adminNotes: "Internal operations note",
      submittedAt: clock.now(),
      vehicleSnapshot: {
        source: "MANUAL",
        make: "Toyota",
        model: "Axio",
        year: 2017,
        variant: "G",
        registrationNumber: "PRIVATE-REG",
        chassisVin: "PRIVATE-CHASSIS",
        engineInfo: "1NZ-FE",
      },
      deliverySnapshot: {
        source: "MANUAL",
        recipientName: "Private Recipient",
        phone: "+8801700112233",
        addressLine: "99 Private Exact Road",
        addressLine2: "Private Floor",
        area: "Dhanmondi",
        city: "Dhaka",
        postalCode: "1209",
        landmark: "Private landmark",
        deliveryInstructions: "Private delivery instructions",
      },
      items: {
        create: {
          lineNumber: 1,
          description: "Front brake pad set",
          partNumber: "PAD-T8-100",
          quantity: 1,
          categoryId,
          productId,
          customerNotes: "Private item note",
        },
      },
      statusHistory: {
        create: {
          fromStatus: SourcingRequestStatus.DRAFT,
          toStatus: SourcingRequestStatus.SUBMITTED,
        },
      },
    },
    include: { items: true },
  });
  if (!withPhoto) return { request: created, attachment: null };
  const image = validateRequestImage(png, "private-customer-photo.png");
  await storage.put(image);
  const attachment = await prisma.requestAttachment.create({
    data: {
      requestId: created.id,
      requestItemId: created.items[0]!.id,
      fileName: image.fileName,
      mimeType: image.mimeType,
      storageKey: image.storageKey,
      byteSize: image.byteSize,
      width: image.width,
      height: image.height,
      contentSha256: image.contentSha256,
    },
  });
  return { request: created, attachment };
}

async function supplierContext(options: {
  email: string;
  name: string;
  status?: SupplierBusinessStatus;
  memberActive?: boolean;
  categories?: string[];
  area?: string;
  productId?: string;
  withInventory?: boolean;
  role?: UserRole;
}) {
  const role = options.role ?? UserRole.SUPPLIER_OWNER;
  const user = await provisionUser(options.email, role);
  const business = await prisma.supplierBusiness.create({
    data: {
      legalName: `${options.name} Limited`,
      displayName: options.name,
      status: options.status ?? SupplierBusinessStatus.ACTIVE,
      subscriptionGraceEndsAt: new Date("2099-01-01T00:00:00.000Z"),
      supportedCategories: options.categories ?? [],
      serviceAreas: options.area ? [options.area] : [],
      ownerUserId: role === UserRole.SUPPLIER_OWNER ? user.id : null,
      members: {
        create: {
          userId: user.id,
          isPrimary: role === UserRole.SUPPLIER_OWNER,
          isActive: options.memberActive ?? true,
        },
      },
      locations: options.area
        ? {
            create: {
              label: "Main",
              addressLine: "Supplier address",
              area: options.area,
              city: "Dhaka",
              isActive: true,
            },
          }
        : undefined,
    },
    include: { members: true },
  });
  if (options.withInventory && options.productId) {
    await prisma.supplierInventory.create({
      data: {
        businessId: business.id,
        productId: options.productId,
        sku: `SKU-${randomUUID()}`,
        stockQuantity: 5,
        reservedQuantity: 1,
        unitPrice: "1000.00",
        condition: ProductCondition.NEW,
        availabilityStatus: InventoryAvailability.IN_STOCK,
      },
    });
  }
  return {
    user,
    business,
    membership: business.members[0]!,
    authorization:
      (options.status ?? SupplierBusinessStatus.ACTIVE) ===
        SupplierBusinessStatus.ACTIVE &&
      (options.memberActive ?? true)
        ? await authorization(options.email)
        : "",
  };
}

function deadline(hours = 1) {
  return new Date(clock.now().getTime() + hours * 60 * 60_000);
}

async function distribute(
  adminAuthorization: string,
  requestId: string,
  suppliers: Array<{ businessId: string; overrideReason?: string }>,
  responseDeadlineAt = deadline(),
) {
  return request(app)
    .post(`${env.API_PREFIX}/admin/requests/${requestId}/assignments`)
    .set("authorization", adminAuthorization)
    .send({ responseDeadlineAt: responseDeadlineAt.toISOString(), suppliers });
}

beforeEach(async () => {
  clock.current = new Date(initialNow);
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
  await rm(attachmentDirectory, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("admin matching and distribution", () => {
  it("enforces admin access and returns deterministic, explainable eligible suggestions", async () => {
    const admin = await userContext("match-admin@autopro.test", UserRole.ADMIN);
    const customer = await userContext("match-customer@autopro.test", UserRole.CUSTOMER);
    const { category, product } = await catalogueFixture();
    const sourcing = await submittedRequest(
      customer.user.customerProfile!.id,
      category.id,
      product.id,
    );
    const stocked = await supplierContext({
      email: "stocked@autopro.test",
      name: "A Stocked Supplier",
      categories: [category.slug],
      area: "Dhanmondi",
      productId: product.id,
      withInventory: true,
    });
    const sourcingOnly = await supplierContext({
      email: "sourcing-only@autopro.test",
      name: "B Sourcing Supplier",
      categories: [category.slug],
      area: "Dhaka",
    });
    await supplierContext({
      email: "suspended-suggestion@autopro.test",
      name: "Suspended Supplier",
      status: SupplierBusinessStatus.SUSPENDED,
      categories: [category.slug],
    });
    await supplierContext({
      email: "inactive-member@autopro.test",
      name: "Inactive Member Supplier",
      memberActive: false,
      categories: [category.slug],
    });

    const denied = await request(app)
      .get(`${env.API_PREFIX}/admin/requests/${sourcing.request.id}/suggestions`)
      .set("authorization", customer.authorization);
    expect(denied.status).toBe(403);
    const response = await request(app)
      .get(`${env.API_PREFIX}/admin/requests/${sourcing.request.id}/suggestions`)
      .set("authorization", admin.authorization);
    expect(response.status).toBe(200);
    expect(response.body.data.suggestions).toHaveLength(2);
    expect(
      response.body.data.suggestions.map(
        (item: { business: { id: string } }) => item.business.id,
      ),
    ).toEqual([stocked.business.id, sourcingOnly.business.id]);
    expect(response.body.data.suggestions[0]).toMatchObject({
      score: 140,
      requiresOverride: false,
      matching: {
        inventory: { status: "MATCH", coveredItemCount: 1 },
        category: { status: "MATCH", coveredItemCount: 1 },
        location: { status: "MATCH", areaMatch: true },
      },
    });
    expect(response.body.data.suggestions[1].matching.inventory.status).toBe("UNKNOWN");
  });

  it("requires mismatch overrides and makes repeated concurrent distribution idempotent", async () => {
    const admin = await userContext("distribution-admin@autopro.test", UserRole.ADMIN);
    const customer = await userContext(
      "distribution-customer@autopro.test",
      UserRole.CUSTOMER,
    );
    const { category, product } = await catalogueFixture();
    const sourcing = await submittedRequest(
      customer.user.customerProfile!.id,
      category.id,
      product.id,
    );
    const mismatch = await supplierContext({
      email: "mismatch@autopro.test",
      name: "Mismatch Supplier",
      categories: ["engine"],
      area: "Chattogram",
    });
    const rejected = await distribute(admin.authorization, sourcing.request.id, [
      { businessId: mismatch.business.id },
    ]);
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe("MATCHING_OVERRIDE_REQUIRED");

    const payload = [
      {
        businessId: mismatch.business.id,
        overrideReason:
          "Operations confirmed this supplier can source the requested part",
      },
    ];
    const [first, second] = await Promise.all([
      distribute(admin.authorization, sourcing.request.id, payload),
      distribute(admin.authorization, sourcing.request.id, payload),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const assignments = await prisma.supplierRequestAssignment.findMany({
      where: { requestId: sourcing.request.id },
      include: { history: true },
    });
    expect(assignments).toHaveLength(1);
    expect(
      assignments[0]!.history.filter(
        (event) => event.eventType === SupplierAssignmentEventType.ASSIGNED,
      ),
    ).toHaveLength(1);
    const storedRequest = await prisma.sourcingRequest.findUniqueOrThrow({
      where: { id: sourcing.request.id },
      include: { statusHistory: true },
    });
    expect(storedRequest.status).toBe(SourcingRequestStatus.MATCHING);
    expect(
      storedRequest.statusHistory.filter(
        (entry) => entry.toStatus === SourcingRequestStatus.MATCHING,
      ),
    ).toHaveLength(1);
  });
});

describe("supplier inbox privacy and responses", () => {
  it("returns 100 bounded request summaries in one list response", async () => {
    const customer = await userContext(
      "summary-customer@autopro.test",
      UserRole.CUSTOMER,
    );
    const supplier = await supplierContext({
      email: "summary-supplier@autopro.test",
      name: "Summary Supplier",
    });
    const category = await prisma.partCategory.create({
      data: { name: "Summary Parts", slug: `summary-${randomUUID()}` },
    });
    const deadline = new Date(clock.now().getTime() + 86_400_000);
    const requests = await prisma.$transaction(
      Array.from({ length: 100 }, (_, index) =>
        prisma.sourcingRequest.create({
          data: {
            requestNumber: `SUMMARY-${String(index + 1).padStart(3, "0")}`,
            customerId: customer.user.customerProfile!.id,
            status: SourcingRequestStatus.MATCHING,
            urgency: index % 2 ? "STANDARD" : "URGENT",
            title: `Summary request ${index + 1}`,
            responseDeadlineAt: deadline,
            vehicleSnapshot: { make: "Toyota", model: "Axio", year: 2018 },
            deliverySnapshot: {
              area: "Dhanmondi",
              city: "Dhaka",
              addressLine: "private exact address",
              phone: "+8801700000000",
            },
            items: {
              create: {
                lineNumber: 1,
                description: `Brake component ${index + 1}`,
                quantity: 1,
                categoryId: category.id,
              },
            },
          },
          select: { id: true },
        }),
      ),
    );
    await prisma.supplierRequestAssignment.createMany({
      data: requests.map((item) => ({
        requestId: item.id,
        businessId: supplier.business.id,
      })),
    });

    const listStartedAt = performance.now();
    const response = await request(app)
      .get(`${env.API_PREFIX}/supplier/requests?pageSize=100`)
      .set("authorization", supplier.authorization);
    const listDurationMs = performance.now() - listStartedAt;

    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(100);
    expect(response.body.data.items[0].request).toMatchObject({
      vehicle: { make: "Toyota", model: "Axio", year: 2018 },
      deliveryArea: { area: "Dhanmondi", city: "Dhaka" },
      attachmentCount: 0,
    });
    expect(JSON.stringify(response.body)).not.toContain("private exact address");
    expect(JSON.stringify(response.body)).not.toContain("+8801700000000");
    const detailsStartedAt = performance.now();
    const details = await Promise.all(
      response.body.data.items.map((item: { id: string }) =>
        request(app)
          .get(`${env.API_PREFIX}/supplier/requests/${item.id}`)
          .set("authorization", supplier.authorization),
      ),
    );
    expect(details.every((detail) => detail.status === 200)).toBe(true);
    const oldList = {
      ...response.body,
      data: {
        ...response.body.data,
        items: response.body.data.items.map(
          (item: { request: Record<string, unknown>; [key: string]: unknown }) => {
            const { request, ...assignment } = item;
            const oldRequest = { ...request };
            delete oldRequest.vehicle;
            delete oldRequest.deliveryArea;
            delete oldRequest.items;
            delete oldRequest.attachmentCount;
            return { ...assignment, request: oldRequest };
          },
        ),
      },
    };
    const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
    process.stdout.write(
      `PHASE1_SUPPLIER_METRIC ${JSON.stringify({
        records: 100,
        beforeCalls: 101,
        afterCalls: 1,
        beforeBytes:
          bytes(oldList) + details.reduce((sum, detail) => sum + bytes(detail.body), 0),
        afterBytes: bytes(response.body),
        beforeDurationMs: Number(
          (listDurationMs + performance.now() - detailsStartedAt).toFixed(2),
        ),
        afterDurationMs: Number(listDurationMs.toFixed(2)),
      })}\n`,
    );
  });

  it("isolates suppliers and photos while excluding contact, exact-address, and internal fields", async () => {
    const admin = await userContext("privacy-admin@autopro.test", UserRole.ADMIN);
    const customer = await userContext(
      "privacy-customer@autopro.test",
      UserRole.CUSTOMER,
    );
    const { category, product } = await catalogueFixture();
    const sourcing = await submittedRequest(
      customer.user.customerProfile!.id,
      category.id,
      product.id,
      true,
    );
    const first = await supplierContext({
      email: "privacy-first@autopro.test",
      name: "Privacy First",
      categories: [category.slug],
      area: "Dhanmondi",
    });
    const second = await supplierContext({
      email: "privacy-second@autopro.test",
      name: "Privacy Second",
      categories: [category.slug],
      area: "Dhanmondi",
    });
    const distributed = await distribute(admin.authorization, sourcing.request.id, [
      { businessId: first.business.id },
      { businessId: second.business.id },
    ]);
    expect(distributed.status).toBe(200);
    const firstAssignment = distributed.body.data.assignments.find(
      (item: { businessId: string }) => item.businessId === first.business.id,
    );

    const detail = await request(app)
      .get(`${env.API_PREFIX}/supplier/requests/${firstAssignment.id}`)
      .set("authorization", first.authorization);
    expect(detail.status).toBe(200);
    expect(detail.body.data.request.deliveryArea).toEqual({
      area: "Dhanmondi",
      city: "Dhaka",
    });
    expect(detail.body.data.request.vehicle).toMatchObject({
      make: "Toyota",
      model: "Axio",
      year: 2017,
      engineInfo: "1NZ-FE",
    });
    const serialized = JSON.stringify(detail.body);
    for (const forbidden of [
      "Private Customer Name",
      "+8801700112233",
      "99 Private Exact Road",
      "Private Recipient",
      "PRIVATE-REG",
      "PRIVATE-CHASSIS",
      "Internal operations note",
      "Private customer-level note",
      "Private item note",
      "private-customer-photo.png",
      "storageKey",
      "contentSha256",
      second.business.displayName,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    const ownPhoto = await request(app)
      .get(
        `${env.API_PREFIX}/supplier/requests/${firstAssignment.id}/attachments/${sourcing.attachment!.id}`,
      )
      .set("authorization", first.authorization);
    expect(ownPhoto.status).toBe(200);
    const isolated = await request(app)
      .get(
        `${env.API_PREFIX}/supplier/requests/${firstAssignment.id}/attachments/${sourcing.attachment!.id}`,
      )
      .set("authorization", second.authorization);
    expect(isolated.status).toBe(404);
  });

  it("handles viewed, clarification/reply, and skip flows for owners and staff", async () => {
    const admin = await userContext("flow-admin@autopro.test", UserRole.ADMIN);
    const customer = await userContext("flow-customer@autopro.test", UserRole.CUSTOMER);
    const { category, product } = await catalogueFixture();
    const sourcing = await submittedRequest(
      customer.user.customerProfile!.id,
      category.id,
      product.id,
    );
    const staff = await supplierContext({
      email: "flow-staff@autopro.test",
      name: "Staff Operated Supplier",
      categories: [category.slug],
      area: "Dhanmondi",
      role: UserRole.SUPPLIER_STAFF,
    });
    const distributed = await distribute(admin.authorization, sourcing.request.id, [
      { businessId: staff.business.id },
    ]);
    const assignmentId = distributed.body.data.assignments[0].id as string;

    const firstView = await request(app)
      .post(`${env.API_PREFIX}/supplier/requests/${assignmentId}/view`)
      .set("authorization", staff.authorization);
    const repeatedView = await request(app)
      .post(`${env.API_PREFIX}/supplier/requests/${assignmentId}/view`)
      .set("authorization", staff.authorization);
    expect(firstView.status).toBe(200);
    expect(repeatedView.status).toBe(200);
    expect(
      await prisma.supplierAssignmentHistory.count({
        where: { assignmentId, eventType: SupplierAssignmentEventType.VIEWED },
      }),
    ).toBe(1);

    const asked = await request(app)
      .post(`${env.API_PREFIX}/supplier/requests/${assignmentId}/clarifications`)
      .set("authorization", staff.authorization)
      .send({ question: "Is an equivalent manufacturer acceptable?" });
    expect(asked.status).toBe(201);
    const adminView = await request(app)
      .get(`${env.API_PREFIX}/admin/requests/${sourcing.request.id}/assignments`)
      .set("authorization", admin.authorization);
    expect(adminView.body.data.assignments[0].clarifications[0].question).toBe(
      "Is an equivalent manufacturer acceptable?",
    );
    const replied = await request(app)
      .post(
        `${env.API_PREFIX}/admin/requests/${sourcing.request.id}/assignments/${assignmentId}/clarifications/${asked.body.data.id}/reply`,
      )
      .set("authorization", admin.authorization)
      .send({ reply: "Yes, include clear compatibility evidence." });
    expect(replied.status).toBe(200);
    const supplierView = await request(app)
      .get(`${env.API_PREFIX}/supplier/requests/${assignmentId}`)
      .set("authorization", staff.authorization);
    expect(supplierView.body.data.clarifications[0].reply).toBe(
      "Yes, include clear compatibility evidence.",
    );

    const skipped = await request(app)
      .post(`${env.API_PREFIX}/supplier/requests/${assignmentId}/skip`)
      .set("authorization", staff.authorization)
      .send({ reason: "Unable to source within the response window" });
    expect(skipped.status).toBe(200);
    expect(skipped.body.data.status).toBe(SupplierAssignmentStatus.SKIPPED);
    const blocked = await request(app)
      .post(`${env.API_PREFIX}/supplier/requests/${assignmentId}/clarifications`)
      .set("authorization", staff.authorization)
      .send({ question: "Can this skipped assignment be reopened?" });
    expect(blocked.status).toBe(409);
    const noReopen = await distribute(admin.authorization, sourcing.request.id, [
      { businessId: staff.business.id },
    ]);
    expect(noReopen.status).toBe(409);
  });
});

describe("deadline, withdrawal, cancellation, and business-state enforcement", () => {
  it("expires exactly at the deadline, records changes, and never silently reopens", async () => {
    const admin = await userContext("deadline-admin@autopro.test", UserRole.ADMIN);
    const customer = await userContext(
      "deadline-customer@autopro.test",
      UserRole.CUSTOMER,
    );
    const { category, product } = await catalogueFixture();
    const sourcing = await submittedRequest(
      customer.user.customerProfile!.id,
      category.id,
      product.id,
      true,
    );
    const supplier = await supplierContext({
      email: "deadline-supplier@autopro.test",
      name: "Deadline Supplier",
      categories: [category.slug],
      area: "Dhanmondi",
    });
    const firstDeadline = deadline();
    const distributed = await distribute(
      admin.authorization,
      sourcing.request.id,
      [{ businessId: supplier.business.id }],
      firstDeadline,
    );
    const assignmentId = distributed.body.data.assignments[0].id as string;
    const changedDeadline = deadline(2);
    const changed = await request(app)
      .patch(`${env.API_PREFIX}/admin/requests/${sourcing.request.id}/response-deadline`)
      .set("authorization", admin.authorization)
      .send({ responseDeadlineAt: changedDeadline.toISOString() });
    expect(changed.status).toBe(200);
    expect(
      changed.body.data.assignments[0].history.some(
        (event: { eventType: string }) => event.eventType === "DEADLINE_CHANGED",
      ),
    ).toBe(true);

    clock.current = new Date(changedDeadline);
    const expired = await request(app)
      .post(`${env.API_PREFIX}/supplier/requests/${assignmentId}/view`)
      .set("authorization", supplier.authorization);
    expect(expired.status).toBe(409);
    expect(expired.body.error.code).toBe("ASSIGNMENT_EXPIRED");
    const stored = await prisma.supplierRequestAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
    });
    expect(stored.status).toBe(SupplierAssignmentStatus.EXPIRED);
    const expiredPhoto = await request(app)
      .get(
        `${env.API_PREFIX}/supplier/requests/${assignmentId}/attachments/${sourcing.attachment!.id}`,
      )
      .set("authorization", supplier.authorization);
    expect(expiredPhoto.status).toBe(404);
    const noReopen = await distribute(
      admin.authorization,
      sourcing.request.id,
      [{ businessId: supplier.business.id }],
      deadline(1),
    );
    expect(noReopen.status).toBe(409);
  });

  it("enforces withdrawal, cancellation races, and post-assignment suspension", async () => {
    const admin = await userContext("state-admin@autopro.test", UserRole.ADMIN);
    const customer = await userContext("state-customer@autopro.test", UserRole.CUSTOMER);
    const { category, product } = await catalogueFixture();
    const firstRequest = await submittedRequest(
      customer.user.customerProfile!.id,
      category.id,
      product.id,
    );
    const supplier = await supplierContext({
      email: "state-supplier@autopro.test",
      name: "State Supplier",
      categories: [category.slug],
      area: "Dhanmondi",
    });
    const firstDistribution = await distribute(
      admin.authorization,
      firstRequest.request.id,
      [{ businessId: supplier.business.id }],
    );
    const withdrawnId = firstDistribution.body.data.assignments[0].id as string;
    const withdrawn = await request(app)
      .post(
        `${env.API_PREFIX}/admin/requests/${firstRequest.request.id}/assignments/${withdrawnId}/withdraw`,
      )
      .set("authorization", admin.authorization)
      .send({ reason: "Assignment sent to the wrong operational team" });
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.data.assignments[0].status).toBe(
      SupplierAssignmentStatus.WITHDRAWN,
    );
    const withdrawnAction = await request(app)
      .post(`${env.API_PREFIX}/supplier/requests/${withdrawnId}/view`)
      .set("authorization", supplier.authorization);
    expect(withdrawnAction.status).toBe(409);

    const raceRequest = await submittedRequest(
      customer.user.customerProfile!.id,
      category.id,
      product.id,
      true,
    );
    const raceDistribution = await distribute(
      admin.authorization,
      raceRequest.request.id,
      [{ businessId: supplier.business.id }],
    );
    const raceAssignmentId = raceDistribution.body.data.assignments[0].id as string;
    const [viewed, cancelled] = await Promise.all([
      request(app)
        .post(`${env.API_PREFIX}/supplier/requests/${raceAssignmentId}/view`)
        .set("authorization", supplier.authorization),
      request(app)
        .post(`${env.API_PREFIX}/customers/me/requests/${raceRequest.request.id}/cancel`)
        .set("authorization", customer.authorization)
        .send({ reason: "Customer cancelled during distribution" }),
    ]);
    expect(cancelled.status).toBe(200);
    expect([200, 409]).toContain(viewed.status);
    const afterCancellation = await request(app)
      .post(`${env.API_PREFIX}/supplier/requests/${raceAssignmentId}/skip`)
      .set("authorization", supplier.authorization)
      .send({ reason: "Should be blocked" });
    expect(afterCancellation.status).toBe(409);
    const cancelledPhoto = await request(app)
      .get(
        `${env.API_PREFIX}/supplier/requests/${raceAssignmentId}/attachments/${raceRequest.attachment!.id}`,
      )
      .set("authorization", supplier.authorization);
    expect(cancelledPhoto.status).toBe(404);

    await prisma.supplierBusiness.update({
      where: { id: supplier.business.id },
      data: { status: SupplierBusinessStatus.SUSPENDED },
    });
    const suspended = await request(app)
      .get(`${env.API_PREFIX}/supplier/requests`)
      .set("authorization", supplier.authorization);
    expect(suspended.status).toBe(403);
  });
});
