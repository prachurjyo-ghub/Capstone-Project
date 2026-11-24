import {
  AccountStatus,
  InventoryAvailability,
  SourcingRequestStatus,
  SupplierAssignmentEventType,
  SupplierAssignmentStatus,
  SupplierBusinessStatus,
  UserRole,
  type Prisma,
  type PrismaClient,
  type RequestUrgency,
} from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";
import { hasCurrentSupplierEntitlement } from "../subscriptions/subscription-access.js";
import { recordAudit } from "../auth/audit.service.js";
import type { RequestAttachmentStorage } from "../requests/attachment-storage.js";
import type { MatchingClock } from "./matching-clock.js";
import type { DistributeRequestInput, SupplierInboxQuery } from "./matching.schemas.js";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

const matchableRequestStatuses: SourcingRequestStatus[] = [
  SourcingRequestStatus.SUBMITTED,
  SourcingRequestStatus.MATCHING,
];
const supplierActionRequestStatuses: SourcingRequestStatus[] = [
  SourcingRequestStatus.MATCHING,
  SourcingRequestStatus.QUOTING,
];
const responsiveAssignmentStatuses: SupplierAssignmentStatus[] = [
  SupplierAssignmentStatus.ASSIGNED,
  SupplierAssignmentStatus.VIEWED,
];

const matchingRequestInclude = {
  items: {
    orderBy: { lineNumber: "asc" },
    include: {
      category: { select: { id: true, name: true, slug: true } },
      product: {
        select: {
          id: true,
          name: true,
          category: { select: { id: true, name: true, slug: true } },
          numbers: { select: { partNumber: true } },
        },
      },
    },
  },
} satisfies Prisma.SourcingRequestInclude;

type MatchingRequest = Prisma.SourcingRequestGetPayload<{
  include: typeof matchingRequestInclude;
}>;

const adminAssignmentInclude = {
  business: {
    select: {
      id: true,
      displayName: true,
      businessCode: true,
      status: true,
    },
  },
  history: {
    select: {
      id: true,
      eventType: true,
      fromStatus: true,
      toStatus: true,
      previousDeadlineAt: true,
      deadlineAt: true,
      reason: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  clarifications: {
    select: {
      id: true,
      question: true,
      askedAt: true,
      reply: true,
      repliedAt: true,
    },
    orderBy: { askedAt: "asc" },
  },
} satisfies Prisma.SupplierRequestAssignmentInclude;

function requestNotFound() {
  return new AppError("Sourcing request was not found", {
    code: "SOURCING_REQUEST_NOT_FOUND",
    statusCode: 404,
  });
}

function assignmentNotFound() {
  return new AppError("Supplier assignment was not found", {
    code: "SUPPLIER_ASSIGNMENT_NOT_FOUND",
    statusCode: 404,
  });
}

function conflict(code: string, message: string) {
  return new AppError(message, { code, statusCode: 409 });
}

function normalize(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("en") ?? "";
}

function normalizedPartNumber(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeVehicle(value: Prisma.JsonValue | null) {
  const vehicle = jsonObject(value);
  return {
    make: textValue(vehicle.make),
    model: textValue(vehicle.model),
    year: typeof vehicle.year === "number" ? vehicle.year : null,
    variant: textValue(vehicle.variant),
    engineInfo: textValue(vehicle.engineInfo),
  };
}

function safeDeliveryArea(value: Prisma.JsonValue | null) {
  const delivery = jsonObject(value);
  return {
    area: textValue(delivery.area),
    city: textValue(delivery.city),
  };
}

function datesEqual(left: Date | null, right: Date) {
  return left?.getTime() === right.getTime();
}

export class MatchingService {
  constructor(
    private readonly database: PrismaClient,
    private readonly attachmentStorage: RequestAttachmentStorage,
    private readonly clock: MatchingClock,
  ) {}

  private async lockRequest(tx: Prisma.TransactionClient, requestId: string) {
    await tx.$queryRaw`
      SELECT "id"
      FROM "sourcing_requests"
      WHERE "id" = ${requestId}::uuid
      FOR UPDATE
    `;
  }

  private async matchableRequest(
    database: DatabaseClient,
    requestId: string,
  ): Promise<MatchingRequest> {
    const sourcingRequest = await database.sourcingRequest.findFirst({
      where: { id: requestId, status: { in: matchableRequestStatuses } },
      include: matchingRequestInclude,
    });
    if (!sourcingRequest) throw requestNotFound();
    return sourcingRequest;
  }

  private async buildSuggestions(
    database: DatabaseClient,
    sourcingRequest: MatchingRequest,
    businessIds?: string[],
  ) {
    const now = this.clock.now();
    const productIds = sourcingRequest.items.flatMap((item) =>
      item.productId ? [item.productId] : [],
    );
    const partNumbers = sourcingRequest.items
      .map((item) => normalizedPartNumber(item.partNumber))
      .filter(Boolean);
    const inventoryMatch =
      productIds.length > 0 || partNumbers.length > 0
        ? {
            OR: [
              ...(productIds.length > 0 ? [{ productId: { in: productIds } }] : []),
              ...(partNumbers.length > 0
                ? [
                    {
                      product: {
                        numbers: { some: { partNumber: { in: partNumbers } } },
                      },
                    },
                  ]
                : []),
            ],
          }
        : { id: { equals: "00000000-0000-0000-0000-000000000000" } };
    const businesses = await database.supplierBusiness.findMany({
      where: {
        id: businessIds ? { in: businessIds } : undefined,
        status: SupplierBusinessStatus.ACTIVE,
        OR: [
          { subscriptionGraceEndsAt: { gt: now } },
          {
            subscriptions: {
              some: {
                status: { in: ["ACTIVE", "SCHEDULED"] },
                startsAt: { lte: now },
                endsAt: { gt: now },
              },
            },
          },
        ],
        members: {
          some: {
            isActive: true,
            leftAt: null,
            user: {
              accountStatus: AccountStatus.ACTIVE,
              role: { in: [UserRole.SUPPLIER_OWNER, UserRole.SUPPLIER_STAFF] },
            },
          },
        },
      },
      select: {
        id: true,
        displayName: true,
        businessCode: true,
        supportedCategories: true,
        serviceAreas: true,
        locations: {
          where: { isActive: true },
          select: { city: true, area: true },
        },
        inventory: {
          where: {
            ...inventoryMatch,
            isActive: true,
            isAvailable: true,
            product: { isActive: true, deletedAt: null },
            availabilityStatus: {
              in: [InventoryAvailability.IN_STOCK, InventoryAvailability.LOW_STOCK],
            },
          },
          select: {
            productId: true,
            stockQuantity: true,
            reservedQuantity: true,
            product: {
              select: { numbers: { select: { partNumber: true } } },
            },
          },
        },
      },
    });

    const delivery = safeDeliveryArea(sourcingRequest.deliverySnapshot);
    const requestedArea = normalize(delivery.area);
    const requestedCity = normalize(delivery.city);

    return businesses
      .map((business) => {
        const supported = new Set(business.supportedCategories.map(normalize));
        let categoryKnown = 0;
        let categoryCovered = 0;
        let inventoryCovered = 0;
        const itemCoverage = sourcingRequest.items.map((item) => {
          const category = item.category ?? item.product?.category ?? null;
          const categorySlug = category?.slug ?? null;
          const categoryMatch = categorySlug
            ? supported.has(normalize(categorySlug))
            : null;
          if (categorySlug) categoryKnown += 1;
          if (categoryMatch) categoryCovered += 1;
          const requestedPart = normalizedPartNumber(item.partNumber);
          const exactInventory = business.inventory.some((inventory) => {
            if (inventory.stockQuantity - inventory.reservedQuantity <= 0) return false;
            if (item.productId && inventory.productId === item.productId) return true;
            return (
              Boolean(requestedPart) &&
              inventory.product.numbers.some(
                (number) => normalizedPartNumber(number.partNumber) === requestedPart,
              )
            );
          });
          if (exactInventory) inventoryCovered += 1;
          return {
            itemId: item.id,
            lineNumber: item.lineNumber,
            categorySlug,
            categoryMatch,
            exactAvailableInventory: exactInventory,
          };
        });

        const locationTokens = [
          ...business.serviceAreas.map(normalize),
          ...business.locations.flatMap((location) => [
            normalize(location.area),
            normalize(location.city),
          ]),
        ].filter(Boolean);
        const hasLocationData = locationTokens.length > 0;
        const areaMatch = Boolean(
          requestedArea && locationTokens.includes(requestedArea),
        );
        const cityMatch = Boolean(
          requestedCity && locationTokens.includes(requestedCity),
        );
        const hasDeliveryArea = Boolean(requestedArea || requestedCity);
        const locationStatus =
          !hasDeliveryArea || !hasLocationData
            ? "UNKNOWN"
            : areaMatch || cityMatch
              ? "MATCH"
              : "MISMATCH";
        const categoryStatus =
          categoryKnown === 0 || supported.size === 0
            ? "UNKNOWN"
            : categoryCovered > 0
              ? "MATCH"
              : "MISMATCH";
        const reasons = [
          inventoryCovered > 0
            ? `${inventoryCovered} item(s) have exact available inventory`
            : "No exact available inventory recorded; sourcing may still be possible",
          categoryStatus === "MATCH"
            ? `${categoryCovered} requested category match(es)`
            : categoryStatus === "MISMATCH"
              ? "Configured categories do not match the categorized request items"
              : "Category coverage is unknown",
          locationStatus === "MATCH"
            ? areaMatch
              ? "Active location or service area matches the delivery area"
              : "Active location or service area matches the delivery city"
            : locationStatus === "MISMATCH"
              ? "Configured active locations/service areas do not match the delivery area"
              : "Location coverage is unknown",
        ];
        const score =
          inventoryCovered * 100 +
          categoryCovered * 25 +
          (areaMatch ? 15 : cityMatch ? 10 : 0);
        return {
          business: {
            id: business.id,
            displayName: business.displayName,
            businessCode: business.businessCode,
          },
          score,
          requiresOverride:
            categoryStatus === "MISMATCH" || locationStatus === "MISMATCH",
          matching: {
            inventory: {
              status: inventoryCovered > 0 ? "MATCH" : "UNKNOWN",
              coveredItemCount: inventoryCovered,
            },
            category: {
              status: categoryStatus,
              coveredItemCount: categoryCovered,
              knownItemCount: categoryKnown,
            },
            location: {
              status: locationStatus,
              areaMatch,
              cityMatch,
            },
          },
          itemCoverage,
          reasons,
        };
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.business.displayName.localeCompare(right.business.displayName) ||
          left.business.id.localeCompare(right.business.id),
      );
  }

  async suggestSuppliers(requestId: string) {
    const sourcingRequest = await this.matchableRequest(this.database, requestId);
    return {
      request: {
        id: sourcingRequest.id,
        requestNumber: sourcingRequest.requestNumber,
        status: sourcingRequest.status,
        urgency: sourcingRequest.urgency,
      },
      suggestions: await this.buildSuggestions(this.database, sourcingRequest),
    };
  }

  async distribute(
    requestId: string,
    input: DistributeRequestInput,
    actorUserId: string,
    auditRequestId: string,
  ) {
    const now = this.clock.now();
    if (input.responseDeadlineAt <= now) {
      throw new AppError("Response deadline must be in the future", {
        code: "INVALID_RESPONSE_DEADLINE",
        statusCode: 400,
      });
    }
    await this.database.$transaction(async (tx) => {
      await this.lockRequest(tx, requestId);
      const sourcingRequest = await this.matchableRequest(tx, requestId);
      if (
        sourcingRequest.responseDeadlineAt &&
        sourcingRequest.responseDeadlineAt <= now
      ) {
        throw conflict(
          "REQUEST_RESPONSE_WINDOW_CLOSED",
          "The current supplier response window has expired",
        );
      }
      if (
        sourcingRequest.status === SourcingRequestStatus.MATCHING &&
        sourcingRequest.responseDeadlineAt &&
        !datesEqual(sourcingRequest.responseDeadlineAt, input.responseDeadlineAt)
      ) {
        throw conflict(
          "DEADLINE_CHANGE_REQUIRED",
          "Use the deadline endpoint before distributing with a different deadline",
        );
      }
      const businessIds = input.suppliers.map((supplier) => supplier.businessId);
      const suggestions = await this.buildSuggestions(tx, sourcingRequest, businessIds);
      const suggestionByBusiness = new Map(
        suggestions.map((suggestion) => [suggestion.business.id, suggestion]),
      );
      for (const target of input.suppliers) {
        const suggestion = suggestionByBusiness.get(target.businessId);
        if (!suggestion) {
          throw new AppError("Supplier business is not eligible for assignment", {
            code: "SUPPLIER_NOT_ELIGIBLE",
            statusCode: 400,
          });
        }
        if (suggestion.requiresOverride && !target.overrideReason) {
          throw new AppError(
            "An override reason is required for category or location mismatch",
            { code: "MATCHING_OVERRIDE_REQUIRED", statusCode: 400 },
          );
        }
      }
      const existing = await tx.supplierRequestAssignment.findMany({
        where: { requestId, businessId: { in: businessIds } },
      });
      const existingByBusiness = new Map(existing.map((item) => [item.businessId, item]));
      for (const assignment of existing) {
        if (!responsiveAssignmentStatuses.includes(assignment.status)) {
          throw conflict(
            "ASSIGNMENT_REOPEN_NOT_SUPPORTED",
            "A skipped, expired, withdrawn, or quoted assignment cannot be reopened",
          );
        }
      }

      let createdCount = 0;
      for (const target of input.suppliers) {
        if (existingByBusiness.has(target.businessId)) continue;
        const assignment = await tx.supplierRequestAssignment.create({
          data: { requestId, businessId: target.businessId },
        });
        await tx.supplierAssignmentHistory.create({
          data: {
            assignmentId: assignment.id,
            eventType: SupplierAssignmentEventType.ASSIGNED,
            fromStatus: null,
            toStatus: SupplierAssignmentStatus.ASSIGNED,
            deadlineAt: input.responseDeadlineAt,
            reason: target.overrideReason,
            actorUserId,
          },
        });
        createdCount += 1;
      }

      if (sourcingRequest.status === SourcingRequestStatus.SUBMITTED) {
        await tx.sourcingRequest.update({
          where: { id: requestId },
          data: {
            status: SourcingRequestStatus.MATCHING,
            responseDeadlineAt: input.responseDeadlineAt,
            version: { increment: 1 },
          },
        });
        await tx.requestStatusHistory.create({
          data: {
            requestId,
            fromStatus: SourcingRequestStatus.SUBMITTED,
            toStatus: SourcingRequestStatus.MATCHING,
            actorUserId,
          },
        });
      } else if (!sourcingRequest.responseDeadlineAt) {
        await tx.sourcingRequest.update({
          where: { id: requestId },
          data: {
            responseDeadlineAt: input.responseDeadlineAt,
            version: { increment: 1 },
          },
        });
      }
      await recordAudit(tx, {
        actorUserId,
        action: "SUPPLIER_REQUEST_DISTRIBUTED",
        entityType: "SOURCING_REQUEST",
        entityId: requestId,
        requestId: auditRequestId,
        metadata: {
          businessIds,
          createdCount,
          overrideCount: input.suppliers.filter((item) => item.overrideReason).length,
          responseDeadlineAt: input.responseDeadlineAt.toISOString(),
        },
      });
    });
    return this.listAdminAssignments(requestId);
  }

  private async expireRequestAssignments(requestId: string) {
    const now = this.clock.now();
    await this.database.$transaction(async (tx) => {
      await this.lockRequest(tx, requestId);
      const sourcingRequest = await tx.sourcingRequest.findUnique({
        where: { id: requestId },
        select: { responseDeadlineAt: true },
      });
      if (
        !sourcingRequest?.responseDeadlineAt ||
        sourcingRequest.responseDeadlineAt > now
      ) {
        return;
      }
      const assignments = await tx.supplierRequestAssignment.findMany({
        where: { requestId, status: { in: responsiveAssignmentStatuses } },
        select: { id: true, status: true },
      });
      for (const assignment of assignments) {
        const updated = await tx.supplierRequestAssignment.updateMany({
          where: { id: assignment.id, status: assignment.status },
          data: {
            status: SupplierAssignmentStatus.EXPIRED,
            expiredAt: now,
          },
        });
        if (updated.count === 1) {
          await tx.supplierAssignmentHistory.create({
            data: {
              assignmentId: assignment.id,
              eventType: SupplierAssignmentEventType.EXPIRED,
              fromStatus: assignment.status,
              toStatus: SupplierAssignmentStatus.EXPIRED,
              deadlineAt: sourcingRequest.responseDeadlineAt,
            },
          });
        }
      }
    });
  }

  private async expireDueAssignments(businessId?: string) {
    const due = await this.database.sourcingRequest.findMany({
      where: {
        responseDeadlineAt: { lte: this.clock.now() },
        assignments: {
          some: {
            businessId,
            status: { in: responsiveAssignmentStatuses },
          },
        },
      },
      select: { id: true },
    });
    for (const sourcingRequest of due) {
      await this.expireRequestAssignments(sourcingRequest.id);
    }
  }

  async listAdminAssignments(requestId: string) {
    const sourcingRequest = await this.database.sourcingRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        requestNumber: true,
        status: true,
        responseDeadlineAt: true,
      },
    });
    if (!sourcingRequest) throw requestNotFound();
    await this.expireRequestAssignments(requestId);
    const assignments = await this.database.supplierRequestAssignment.findMany({
      where: { requestId },
      include: adminAssignmentInclude,
      orderBy: [{ assignedAt: "asc" }, { id: "asc" }],
    });
    return { request: sourcingRequest, assignments };
  }

  async changeDeadline(
    requestId: string,
    responseDeadlineAt: Date,
    actorUserId: string,
    auditRequestId: string,
  ) {
    const now = this.clock.now();
    if (responseDeadlineAt <= now) {
      throw new AppError("Response deadline must be in the future", {
        code: "INVALID_RESPONSE_DEADLINE",
        statusCode: 400,
      });
    }
    await this.expireRequestAssignments(requestId);
    await this.database.$transaction(async (tx) => {
      await this.lockRequest(tx, requestId);
      const sourcingRequest = await tx.sourcingRequest.findFirst({
        where: {
          id: requestId,
          status: {
            in: [SourcingRequestStatus.MATCHING, SourcingRequestStatus.QUOTING],
          },
        },
        select: { responseDeadlineAt: true },
      });
      if (!sourcingRequest) throw requestNotFound();
      if (datesEqual(sourcingRequest.responseDeadlineAt, responseDeadlineAt)) return;
      const assignments = await tx.supplierRequestAssignment.findMany({
        where: { requestId, status: { in: responsiveAssignmentStatuses } },
        select: { id: true },
      });
      if (assignments.length === 0) {
        throw conflict(
          "NO_ACTIVE_ASSIGNMENTS",
          "No active assignments are available for a deadline change",
        );
      }
      await tx.sourcingRequest.update({
        where: { id: requestId },
        data: { responseDeadlineAt, version: { increment: 1 } },
      });
      await tx.supplierAssignmentHistory.createMany({
        data: assignments.map((assignment) => ({
          assignmentId: assignment.id,
          eventType: SupplierAssignmentEventType.DEADLINE_CHANGED,
          previousDeadlineAt: sourcingRequest.responseDeadlineAt,
          deadlineAt: responseDeadlineAt,
          actorUserId,
        })),
      });
      await recordAudit(tx, {
        actorUserId,
        action: "SUPPLIER_RESPONSE_DEADLINE_CHANGED",
        entityType: "SOURCING_REQUEST",
        entityId: requestId,
        requestId: auditRequestId,
        metadata: {
          previousDeadlineAt: sourcingRequest.responseDeadlineAt?.toISOString() ?? null,
          responseDeadlineAt: responseDeadlineAt.toISOString(),
          assignmentCount: assignments.length,
        },
      });
    });
    return this.listAdminAssignments(requestId);
  }

  async withdrawAssignment(
    requestId: string,
    assignmentId: string,
    reason: string,
    actorUserId: string,
    auditRequestId: string,
  ) {
    await this.expireRequestAssignments(requestId);
    await this.database.$transaction(async (tx) => {
      await this.lockRequest(tx, requestId);
      const assignment = await tx.supplierRequestAssignment.findFirst({
        where: { id: assignmentId, requestId },
      });
      if (!assignment) throw assignmentNotFound();
      if (!responsiveAssignmentStatuses.includes(assignment.status)) {
        throw conflict(
          "ASSIGNMENT_NOT_WITHDRAWABLE",
          "Only active assignments can be withdrawn",
        );
      }
      const now = this.clock.now();
      await tx.supplierRequestAssignment.update({
        where: { id: assignmentId },
        data: {
          status: SupplierAssignmentStatus.WITHDRAWN,
          withdrawnAt: now,
          note: reason,
        },
      });
      await tx.supplierAssignmentHistory.create({
        data: {
          assignmentId,
          eventType: SupplierAssignmentEventType.WITHDRAWN,
          fromStatus: assignment.status,
          toStatus: SupplierAssignmentStatus.WITHDRAWN,
          reason,
          actorUserId,
        },
      });
      await recordAudit(tx, {
        actorUserId,
        action: "SUPPLIER_ASSIGNMENT_WITHDRAWN",
        entityType: "SUPPLIER_REQUEST_ASSIGNMENT",
        entityId: assignmentId,
        requestId: auditRequestId,
        metadata: { requestId, businessId: assignment.businessId },
      });
    });
    return this.listAdminAssignments(requestId);
  }

  private supplierSummary(assignment: {
    id: string;
    status: SupplierAssignmentStatus;
    assignedAt: Date;
    viewedAt: Date | null;
    skippedAt: Date | null;
    expiredAt: Date | null;
    withdrawnAt: Date | null;
    request: {
      id: string;
      requestNumber: string;
      status: SourcingRequestStatus;
      urgency: RequestUrgency;
      title: string | null;
      neededByAt: Date | null;
      responseDeadlineAt: Date | null;
      submittedAt: Date | null;
      vehicleSnapshot?: Prisma.JsonValue | null;
      deliverySnapshot?: Prisma.JsonValue | null;
      items?: Array<{
        id: string;
        description: string;
        quantity: number;
        category: { name: string } | null;
      }>;
      attachments?: Array<{ id: string }>;
    };
  }) {
    return {
      id: assignment.id,
      status: assignment.status,
      assignedAt: assignment.assignedAt,
      viewedAt: assignment.viewedAt,
      skippedAt: assignment.skippedAt,
      expiredAt: assignment.expiredAt,
      withdrawnAt: assignment.withdrawnAt,
      responseDeadlineAt: assignment.request.responseDeadlineAt,
      request: {
        id: assignment.request.id,
        requestNumber: assignment.request.requestNumber,
        status: assignment.request.status,
        urgency: assignment.request.urgency,
        title: assignment.request.title,
        neededByAt: assignment.request.neededByAt,
        submittedAt: assignment.request.submittedAt,
        ...(assignment.request.items
          ? {
              vehicle: safeVehicle(assignment.request.vehicleSnapshot ?? null),
              deliveryArea: safeDeliveryArea(assignment.request.deliverySnapshot ?? null),
              items: assignment.request.items,
              attachmentCount: assignment.request.attachments?.length ?? 0,
            }
          : {}),
      },
    };
  }

  async listSupplierInbox(businessId: string, query: SupplierInboxQuery) {
    await this.expireDueAssignments(businessId);
    const where: Prisma.SupplierRequestAssignmentWhereInput = {
      businessId,
      status: query.status,
      request: { urgency: query.urgency },
    };
    const [assignments, total] = await this.database.$transaction([
      this.database.supplierRequestAssignment.findMany({
        where,
        select: {
          id: true,
          status: true,
          assignedAt: true,
          viewedAt: true,
          skippedAt: true,
          expiredAt: true,
          withdrawnAt: true,
          request: {
            select: {
              id: true,
              requestNumber: true,
              status: true,
              urgency: true,
              title: true,
              neededByAt: true,
              responseDeadlineAt: true,
              submittedAt: true,
              vehicleSnapshot: true,
              deliverySnapshot: true,
              items: {
                orderBy: { lineNumber: "asc" },
                select: {
                  id: true,
                  description: true,
                  quantity: true,
                  category: { select: { name: true } },
                },
              },
              attachments: { select: { id: true } },
            },
          },
        },
        orderBy: { assignedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.supplierRequestAssignment.count({ where }),
    ]);
    return {
      items: assignments.map((assignment) => this.supplierSummary(assignment)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  private async supplierAssignmentDetail(businessId: string, assignmentId: string) {
    const assignment = await this.database.supplierRequestAssignment.findFirst({
      where: { id: assignmentId, businessId },
      select: {
        id: true,
        requestId: true,
        status: true,
        assignedAt: true,
        viewedAt: true,
        skippedAt: true,
        expiredAt: true,
        withdrawnAt: true,
        clarifications: {
          select: {
            id: true,
            question: true,
            askedAt: true,
            reply: true,
            repliedAt: true,
          },
          orderBy: { askedAt: "asc" },
        },
        request: {
          select: {
            id: true,
            requestNumber: true,
            status: true,
            urgency: true,
            title: true,
            neededByAt: true,
            responseDeadlineAt: true,
            submittedAt: true,
            vehicleSnapshot: true,
            deliverySnapshot: true,
            items: {
              orderBy: { lineNumber: "asc" },
              select: {
                id: true,
                lineNumber: true,
                description: true,
                partNumber: true,
                quantity: true,
                product: { select: { id: true, name: true, catalogueCode: true } },
                category: { select: { id: true, name: true, slug: true } },
              },
            },
            attachments: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                requestItemId: true,
                kind: true,
                mimeType: true,
                byteSize: true,
                width: true,
                height: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });
    if (!assignment) throw assignmentNotFound();
    return {
      ...this.supplierSummary(assignment),
      clarifications: assignment.clarifications,
      request: {
        ...this.supplierSummary(assignment).request,
        vehicle: safeVehicle(assignment.request.vehicleSnapshot),
        deliveryArea: safeDeliveryArea(assignment.request.deliverySnapshot),
        items: assignment.request.items,
        attachments: assignment.request.attachments,
      },
    };
  }

  async getSupplierAssignment(businessId: string, assignmentId: string) {
    const current = await this.database.supplierRequestAssignment.findFirst({
      where: { id: assignmentId, businessId },
      select: { requestId: true },
    });
    if (!current) throw assignmentNotFound();
    await this.expireRequestAssignments(current.requestId);
    return this.supplierAssignmentDetail(businessId, assignmentId);
  }

  private async validateSupplierMutation(
    tx: Prisma.TransactionClient,
    userId: string,
    membershipId: string,
    businessId: string,
    assignmentId: string,
  ) {
    const membership = await tx.supplierUser.findFirst({
      where: {
        id: membershipId,
        userId,
        businessId,
        isActive: true,
        leftAt: null,
        business: { status: SupplierBusinessStatus.ACTIVE },
      },
      select: { id: true },
    });
    if (!membership) {
      throw new AppError("Active supplier membership is required", {
        code: "SUPPLIER_ACCESS_RESTRICTED",
        statusCode: 403,
      });
    }
    if (!(await hasCurrentSupplierEntitlement(tx, businessId, this.clock.now()))) {
      throw new AppError("Supplier subscription is expired or inactive", {
        code: "SUPPLIER_SUBSCRIPTION_REQUIRED",
        statusCode: 403,
      });
    }
    const assignment = await tx.supplierRequestAssignment.findFirst({
      where: { id: assignmentId, businessId },
      include: { request: true },
    });
    if (!assignment) throw assignmentNotFound();
    if (!supplierActionRequestStatuses.includes(assignment.request.status)) {
      throw conflict(
        "REQUEST_NOT_RESPONDABLE",
        "The request no longer accepts supplier responses",
      );
    }
    const now = this.clock.now();
    if (
      assignment.request.responseDeadlineAt &&
      assignment.request.responseDeadlineAt <= now &&
      responsiveAssignmentStatuses.includes(assignment.status)
    ) {
      await tx.supplierRequestAssignment.update({
        where: { id: assignment.id },
        data: { status: SupplierAssignmentStatus.EXPIRED, expiredAt: now },
      });
      await tx.supplierAssignmentHistory.create({
        data: {
          assignmentId: assignment.id,
          eventType: SupplierAssignmentEventType.EXPIRED,
          fromStatus: assignment.status,
          toStatus: SupplierAssignmentStatus.EXPIRED,
          deadlineAt: assignment.request.responseDeadlineAt,
        },
      });
      return { assignment, expired: true as const };
    }
    if (!responsiveAssignmentStatuses.includes(assignment.status)) {
      throw conflict(
        "ASSIGNMENT_NOT_RESPONDABLE",
        "The assignment no longer accepts supplier responses",
      );
    }
    return { assignment, expired: false as const };
  }

  async markViewed(
    userId: string,
    membershipId: string,
    businessId: string,
    assignmentId: string,
    auditRequestId: string,
  ) {
    const result = await this.database.$transaction(async (tx) => {
      const current = await tx.supplierRequestAssignment.findFirst({
        where: { id: assignmentId, businessId },
        select: { requestId: true },
      });
      if (!current) throw assignmentNotFound();
      await this.lockRequest(tx, current.requestId);
      const checked = await this.validateSupplierMutation(
        tx,
        userId,
        membershipId,
        businessId,
        assignmentId,
      );
      if (checked.expired) return { expired: true };
      if (checked.assignment.status === SupplierAssignmentStatus.VIEWED) {
        return { expired: false };
      }
      const now = this.clock.now();
      await tx.supplierRequestAssignment.update({
        where: { id: assignmentId },
        data: { status: SupplierAssignmentStatus.VIEWED, viewedAt: now },
      });
      await tx.supplierAssignmentHistory.create({
        data: {
          assignmentId,
          eventType: SupplierAssignmentEventType.VIEWED,
          fromStatus: SupplierAssignmentStatus.ASSIGNED,
          toStatus: SupplierAssignmentStatus.VIEWED,
          actorUserId: userId,
        },
      });
      await recordAudit(tx, {
        actorUserId: userId,
        action: "SUPPLIER_ASSIGNMENT_VIEWED",
        entityType: "SUPPLIER_REQUEST_ASSIGNMENT",
        entityId: assignmentId,
        requestId: auditRequestId,
        metadata: { businessId },
      });
      return { expired: false };
    });
    if (result.expired) {
      throw conflict("ASSIGNMENT_EXPIRED", "The supplier response deadline has expired");
    }
    return this.supplierAssignmentDetail(businessId, assignmentId);
  }

  async skipAssignment(
    userId: string,
    membershipId: string,
    businessId: string,
    assignmentId: string,
    reason: string | undefined,
    auditRequestId: string,
  ) {
    const result = await this.database.$transaction(async (tx) => {
      const current = await tx.supplierRequestAssignment.findFirst({
        where: { id: assignmentId, businessId },
        select: { requestId: true },
      });
      if (!current) throw assignmentNotFound();
      await this.lockRequest(tx, current.requestId);
      const checked = await this.validateSupplierMutation(
        tx,
        userId,
        membershipId,
        businessId,
        assignmentId,
      );
      if (checked.expired) return { expired: true };
      const now = this.clock.now();
      await tx.supplierRequestAssignment.update({
        where: { id: assignmentId },
        data: {
          status: SupplierAssignmentStatus.SKIPPED,
          skippedAt: now,
          note: reason,
        },
      });
      await tx.supplierAssignmentHistory.create({
        data: {
          assignmentId,
          eventType: SupplierAssignmentEventType.SKIPPED,
          fromStatus: checked.assignment.status,
          toStatus: SupplierAssignmentStatus.SKIPPED,
          reason,
          actorUserId: userId,
        },
      });
      await recordAudit(tx, {
        actorUserId: userId,
        action: "SUPPLIER_ASSIGNMENT_SKIPPED",
        entityType: "SUPPLIER_REQUEST_ASSIGNMENT",
        entityId: assignmentId,
        requestId: auditRequestId,
        metadata: { businessId },
      });
      return { expired: false };
    });
    if (result.expired) {
      throw conflict("ASSIGNMENT_EXPIRED", "The supplier response deadline has expired");
    }
    return this.supplierAssignmentDetail(businessId, assignmentId);
  }

  async askClarification(
    userId: string,
    membershipId: string,
    businessId: string,
    assignmentId: string,
    question: string,
    auditRequestId: string,
  ) {
    const result = await this.database.$transaction(async (tx) => {
      const current = await tx.supplierRequestAssignment.findFirst({
        where: { id: assignmentId, businessId },
        select: { requestId: true },
      });
      if (!current) throw assignmentNotFound();
      await this.lockRequest(tx, current.requestId);
      const checked = await this.validateSupplierMutation(
        tx,
        userId,
        membershipId,
        businessId,
        assignmentId,
      );
      if (checked.expired) return { expired: true, clarification: null };
      const clarification = await tx.supplierClarification.create({
        data: { assignmentId, question, askedByUserId: userId },
        select: { id: true, question: true, askedAt: true, reply: true, repliedAt: true },
      });
      await tx.supplierAssignmentHistory.create({
        data: {
          assignmentId,
          eventType: SupplierAssignmentEventType.CLARIFICATION_ASKED,
          actorUserId: userId,
        },
      });
      await recordAudit(tx, {
        actorUserId: userId,
        action: "SUPPLIER_CLARIFICATION_ASKED",
        entityType: "SUPPLIER_CLARIFICATION",
        entityId: clarification.id,
        requestId: auditRequestId,
        metadata: { assignmentId, businessId },
      });
      return { expired: false, clarification };
    });
    if (result.expired) {
      throw conflict("ASSIGNMENT_EXPIRED", "The supplier response deadline has expired");
    }
    return result.clarification;
  }

  async replyClarification(
    requestId: string,
    assignmentId: string,
    clarificationId: string,
    reply: string,
    actorUserId: string,
    auditRequestId: string,
  ) {
    await this.expireRequestAssignments(requestId);
    const result = await this.database.$transaction(async (tx) => {
      await this.lockRequest(tx, requestId);
      const assignment = await tx.supplierRequestAssignment.findFirst({
        where: {
          id: assignmentId,
          requestId,
          status: { in: responsiveAssignmentStatuses },
          request: { status: { in: supplierActionRequestStatuses } },
        },
        select: { id: true },
      });
      if (!assignment) throw assignmentNotFound();
      const clarification = await tx.supplierClarification.findFirst({
        where: { id: clarificationId, assignmentId },
      });
      if (!clarification) {
        throw new AppError("Clarification was not found", {
          code: "CLARIFICATION_NOT_FOUND",
          statusCode: 404,
        });
      }
      if (clarification.reply !== null) {
        if (clarification.reply === reply) return clarification;
        throw conflict(
          "CLARIFICATION_ALREADY_REPLIED",
          "The clarification already has an operations reply",
        );
      }
      const updated = await tx.supplierClarification.update({
        where: { id: clarificationId },
        data: { reply, repliedByUserId: actorUserId, repliedAt: this.clock.now() },
      });
      await tx.supplierAssignmentHistory.create({
        data: {
          assignmentId,
          eventType: SupplierAssignmentEventType.CLARIFICATION_REPLIED,
          actorUserId,
        },
      });
      await recordAudit(tx, {
        actorUserId,
        action: "SUPPLIER_CLARIFICATION_REPLIED",
        entityType: "SUPPLIER_CLARIFICATION",
        entityId: clarificationId,
        requestId: auditRequestId,
        metadata: { assignmentId },
      });
      return updated;
    });
    return {
      id: result.id,
      question: result.question,
      askedAt: result.askedAt,
      reply: result.reply,
      repliedAt: result.repliedAt,
    };
  }

  async readSupplierAttachment(
    businessId: string,
    assignmentId: string,
    attachmentId: string,
  ) {
    const assignment = await this.database.supplierRequestAssignment.findFirst({
      where: { id: assignmentId, businessId },
      select: { requestId: true },
    });
    if (!assignment) throw assignmentNotFound();
    await this.expireRequestAssignments(assignment.requestId);
    const attachment = await this.database.requestAttachment.findFirst({
      where: {
        id: attachmentId,
        requestId: assignment.requestId,
        request: {
          assignments: {
            some: {
              id: assignmentId,
              businessId,
              status: { in: responsiveAssignmentStatuses },
            },
          },
          status: { in: supplierActionRequestStatuses },
          responseDeadlineAt: { gt: this.clock.now() },
        },
      },
      select: {
        mimeType: true,
        storageKey: true,
        byteSize: true,
      },
    });
    if (!attachment) throw assignmentNotFound();
    try {
      const opened = await this.attachmentStorage.open(attachment.storageKey);
      return {
        fileName:
          attachment.mimeType === "image/png" ? "request-photo.png" : "request-photo.jpg",
        mimeType: attachment.mimeType,
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
