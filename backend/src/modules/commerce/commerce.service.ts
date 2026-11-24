import {
  AdminReviewStatus,
  ClarificationInitiator,
  Prisma,
  QuotationStatus,
  SourcingOptionStatus,
  SourcingRequestStatus,
  SourcingRequestType,
  SupplierAssignmentStatus,
  SupplierAssignmentEventType,
  SupplierBusinessStatus,
  type PrismaClient,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors/app-error.js";
import { recordAudit } from "../auth/audit.service.js";
import { enqueueOutbox } from "../communications/outbox.service.js";
import type { MatchingClock } from "../matching/matching-clock.js";
import { hasCurrentSupplierEntitlement } from "../subscriptions/subscription-access.js";
import type {
  AcceptOptionInput,
  PrepareOptionInput,
  QuotationWriteInput,
} from "./commerce.schemas.js";

type Tx = Prisma.TransactionClient;
type PageQuery = {
  page: number;
  pageSize: number;
  status?: QuotationStatus | SourcingOptionStatus;
};
const D = Prisma.Decimal;
const money = (value: Prisma.Decimal.Value) =>
  new D(value).toDecimalPlaces(2, D.ROUND_HALF_UP);
const displayMoney = (value: Prisma.Decimal.Value) => money(value).toFixed(2);
const conflict = (message: string, code = "STATE_CONFLICT") =>
  new AppError(message, { code, statusCode: 409 });
const notFound = (message: string) =>
  new AppError(message, { code: "NOT_FOUND", statusCode: 404 });

async function lock(tx: Tx, table: string, id: string) {
  if (!/^[a-z_]+$/.test(table)) throw new Error("Unsafe table name");
  await tx.$queryRawUnsafe(
    `SELECT "id" FROM "${table}" WHERE "id" = $1::uuid FOR UPDATE`,
    id,
  );
}

async function nextNumber(
  tx: Tx,
  sequence: "quotation_number_seq" | "sourcing_option_number_seq",
  prefix: string,
) {
  const rows = await tx.$queryRawUnsafe<Array<{ value: bigint }>>(
    `SELECT nextval('${sequence}') AS "value"`,
  );
  return `${prefix}-${new Date().getUTCFullYear()}-${String(rows[0]?.value ?? 0).padStart(6, "0")}`;
}

const quoteInclude = {
  items: { orderBy: { lineNumber: "asc" as const } },
  statusHistory: { orderBy: { createdAt: "asc" as const } },
  clarifications: { orderBy: { askedAt: "asc" as const } },
  assignment: { select: { id: true, status: true } },
} satisfies Prisma.QuotationInclude;

const optionInclude = {
  lines: { orderBy: { lineNumber: "asc" as const } },
  clarifications: { orderBy: { askedAt: "asc" as const } },
  acceptance: {
    select: { id: true, acceptedAt: true, deliverySnapshot: true },
  },
  quotation: {
    select: {
      id: true,
      status: true,
      validUntil: true,
      businessId: true,
      business: { select: { displayName: true } },
    },
  },
} satisfies Prisma.SourcingOptionInclude;

type Quote = Prisma.QuotationGetPayload<{ include: typeof quoteInclude }>;
type Option = Prisma.SourcingOptionGetPayload<{ include: typeof optionInclude }>;

function supplierQuote(quote: Quote) {
  return {
    id: quote.id,
    quotationNumber: quote.quotationNumber,
    requestId: quote.requestId,
    assignmentId: quote.assignmentId,
    status: quote.status,
    adminReviewStatus: quote.adminReviewStatus,
    revisionGroupId: quote.revisionGroupId,
    revisionNumber: quote.revisionNumber,
    supersedesId: quote.supersedesId,
    supplierSubtotal: displayMoney(quote.supplierSubtotal),
    preparationTimeMin: quote.preparationTimeMin,
    deliveryEstimateText: quote.deliveryEstimateText,
    compatibilityNotes: quote.compatibilityNotes,
    supplierNotes: quote.supplierNotes,
    validUntil: quote.validUntil,
    submittedAt: quote.submittedAt,
    createdAt: quote.createdAt,
    updatedAt: quote.updatedAt,
    items: quote.items.map((item) => ({
      id: item.id,
      requestItemId: item.requestItemId,
      productId: item.productId,
      inventoryId: item.inventoryId,
      alternativeToItemId: item.alternativeToItemId,
      lineNumber: item.lineNumber,
      description: item.description,
      brand: item.brand,
      partNumber: item.partNumber,
      condition: item.condition,
      quantity: item.quantity,
      supplierUnitPrice: displayMoney(item.supplierUnitPrice),
      supplierLineTotal: displayMoney(item.supplierLineTotal),
      compatibilityNotes: item.compatibilityNotes,
      alternativePartInfo: item.alternativePartInfo,
    })),
    statusHistory: quote.statusHistory,
    clarifications: quote.clarifications.map((item) => ({
      id: item.id,
      initiator: item.initiator,
      question: item.question,
      askedAt: item.askedAt,
      reply: item.reply,
      repliedAt: item.repliedAt,
    })),
  };
}

function customerOption(option: Option) {
  return {
    id: option.id,
    optionNumber: option.optionNumber,
    requestId: option.requestId,
    supplier: { displayName: option.quotation.business.displayName },
    revisionNumber: option.revisionNumber,
    status: option.status,
    currency: option.currency,
    customerItemsTotal: displayMoney(option.customerItemsTotal),
    deliveryCharge: displayMoney(option.deliveryCharge),
    priorityCharge: displayMoney(option.priorityCharge),
    customerTotal: displayMoney(option.customerTotal),
    preparationTimeMin: option.preparationTimeMin,
    deliveryEstimateText: option.deliveryEstimateText,
    compatibilityNotes: option.compatibilityNotes,
    customerNotes: option.customerNotes,
    validUntil: option.validUntil,
    publishedAt: option.publishedAt,
    version: option.version,
    lines: option.lines.map((line) => ({
      id: line.id,
      requestItemId: line.requestItemId,
      description: line.description,
      brand: line.brand,
      partNumber: line.partNumber,
      condition: line.condition,
      quantity: line.quantity,
      customerUnitPrice: displayMoney(line.customerUnitPrice),
      customerLineTotal: displayMoney(line.customerLineTotal),
      compatibilityNotes: line.compatibilityNotes,
      alternativePartInfo: line.alternativePartInfo,
      selectedAlternative: line.isAlternative,
    })),
    clarifications: option.clarifications.map((item) => ({
      id: item.id,
      question: item.question,
      askedAt: item.askedAt,
      reply: item.reply,
      repliedAt: item.repliedAt,
    })),
    acceptance: option.acceptance
      ? {
          id: option.acceptance.id,
          acceptedAt: option.acceptance.acceptedAt,
          deliverySnapshot: option.acceptance.deliverySnapshot,
        }
      : null,
  };
}

function safeAcceptance(acceptance: {
  id: string;
  optionId: string;
  requestId: string;
  optionRevision: number;
  currency: string;
  customerItemsTotal: Prisma.Decimal;
  deliveryCharge: Prisma.Decimal;
  priorityCharge: Prisma.Decimal;
  customerTotal: Prisma.Decimal;
  deliverySnapshot: Prisma.JsonValue;
  acceptedAt: Date;
  items: Array<{
    description: string;
    brand: string | null;
    partNumber: string | null;
    condition: string;
    quantity: number;
    customerUnitPrice: Prisma.Decimal;
    customerLineTotal: Prisma.Decimal;
    compatibilityNotes: string | null;
    alternativePartInfo: string | null;
    isAlternative: boolean;
  }>;
}) {
  return {
    id: acceptance.id,
    optionId: acceptance.optionId,
    requestId: acceptance.requestId,
    optionRevision: acceptance.optionRevision,
    currency: acceptance.currency,
    customerItemsTotal: displayMoney(acceptance.customerItemsTotal),
    deliveryCharge: displayMoney(acceptance.deliveryCharge),
    priorityCharge: displayMoney(acceptance.priorityCharge),
    customerTotal: displayMoney(acceptance.customerTotal),
    deliverySnapshot: acceptance.deliverySnapshot,
    acceptedAt: acceptance.acceptedAt,
    items: acceptance.items.map((item) => ({
      description: item.description,
      brand: item.brand,
      partNumber: item.partNumber,
      condition: item.condition,
      quantity: item.quantity,
      customerUnitPrice: displayMoney(item.customerUnitPrice),
      customerLineTotal: displayMoney(item.customerLineTotal),
      compatibilityNotes: item.compatibilityNotes,
      alternativePartInfo: item.alternativePartInfo,
      selectedAlternative: item.isAlternative,
    })),
  };
}

export class CommerceService {
  constructor(
    private readonly database: PrismaClient,
    private readonly clock: MatchingClock,
  ) {}

  private async assertMembership(tx: Tx, userId: string, businessId: string) {
    const membership = await tx.supplierUser.findFirst({
      where: {
        userId,
        businessId,
        isActive: true,
        leftAt: null,
        business: { status: SupplierBusinessStatus.ACTIVE },
      },
      select: { id: true },
    });
    if (!membership)
      throw new AppError("Active supplier membership is required", {
        code: "SUPPLIER_ACCESS_RESTRICTED",
        statusCode: 403,
      });
    if (!(await hasCurrentSupplierEntitlement(tx, businessId, this.clock.now())))
      throw new AppError("An active supplier subscription is required", {
        code: "SUPPLIER_SUBSCRIPTION_REQUIRED",
        statusCode: 403,
      });
  }

  private async assertSupplierAssignment(
    tx: Tx,
    businessId: string,
    assignmentId: string,
    now: Date,
  ) {
    const assignment = await tx.supplierRequestAssignment.findFirst({
      where: { id: assignmentId, businessId },
      include: {
        request: { include: { items: true } },
        business: { select: { status: true } },
      },
    });
    if (!assignment) throw notFound("Supplier assignment was not found");
    if (assignment.business.status !== SupplierBusinessStatus.ACTIVE)
      throw conflict("Supplier business is not active", "SUPPLIER_INACTIVE");
    if (
      !(
        [
          SourcingRequestStatus.MATCHING,
          SourcingRequestStatus.QUOTING,
        ] as SourcingRequestStatus[]
      ).includes(assignment.request.status)
    )
      throw conflict("Request is not accepting quotations", "REQUEST_NOT_QUOTABLE");
    if (
      (
        [
          SupplierAssignmentStatus.SKIPPED,
          SupplierAssignmentStatus.WITHDRAWN,
          SupplierAssignmentStatus.EXPIRED,
        ] as SupplierAssignmentStatus[]
      ).includes(assignment.status)
    )
      throw conflict("Assignment is no longer actionable", "ASSIGNMENT_INACTIVE");
    if (
      !assignment.request.responseDeadlineAt ||
      assignment.request.responseDeadlineAt <= now
    )
      throw conflict("Assignment response deadline has expired", "ASSIGNMENT_EXPIRED");
    return assignment;
  }

  private async validateQuoteItems(
    tx: Tx,
    businessId: string,
    requestItems: Array<{ id: string; quantity: number }>,
    input: QuotationWriteInput["items"],
  ) {
    const requestIds = new Set(requestItems.map((item) => item.id));
    if (input.some((item) => !requestIds.has(item.requestItemId)))
      throw new AppError("Quotation item does not belong to the assigned request", {
        code: "INVALID_REQUEST_ITEM",
        statusCode: 400,
      });
    for (const item of input) {
      const required = requestItems.find(
        (requestItem) => requestItem.id === item.requestItemId,
      )!;
      if (item.quantity > required.quantity)
        throw new AppError("Quotation quantity cannot exceed the requested quantity", {
          code: "INVALID_QUANTITY",
          statusCode: 400,
        });
    }
    const primaryIds = input
      .filter((item) => !item.alternativeToLineNumber)
      .map((item) => item.requestItemId);
    if (new Set(primaryIds).size !== primaryIds.length)
      throw new AppError(
        "Use alternatives instead of duplicate primary offers for one request item",
        { code: "DUPLICATE_PRIMARY_OFFER", statusCode: 400 },
      );
    const inventoryIds = [
      ...new Set(input.flatMap((item) => (item.inventoryId ? [item.inventoryId] : []))),
    ];
    if (inventoryIds.length) {
      const count = await tx.supplierInventory.count({
        where: { id: { in: inventoryIds }, businessId },
      });
      if (count !== inventoryIds.length)
        throw new AppError("Inventory reference does not belong to this supplier", {
          code: "INVALID_INVENTORY_REFERENCE",
          statusCode: 400,
        });
    }
    const productIds = [
      ...new Set(input.flatMap((item) => (item.productId ? [item.productId] : []))),
    ];
    if (
      productIds.length &&
      (await tx.product.count({ where: { id: { in: productIds }, isActive: true } })) !==
        productIds.length
    )
      throw new AppError("Catalogue product reference is invalid", {
        code: "INVALID_PRODUCT_REFERENCE",
        statusCode: 400,
      });
    input.forEach((item) => {
      if (item.alternativeToLineNumber) {
        const primary = input[item.alternativeToLineNumber - 1];
        if (
          !primary ||
          primary.alternativeToLineNumber ||
          primary.requestItemId !== item.requestItemId
        )
          throw new AppError(
            "Alternative must reference a primary line for the same request item",
            { code: "INVALID_ALTERNATIVE", statusCode: 400 },
          );
      }
    });
  }

  private async replaceQuoteItems(
    tx: Tx,
    quotationId: string,
    items: QuotationWriteInput["items"],
  ) {
    await tx.quotationItem.deleteMany({ where: { quotationId } });
    const created = new Map<number, string>();
    for (const [index, item] of items.entries()) {
      const row = await tx.quotationItem.create({
        data: {
          quotationId,
          requestItemId: item.requestItemId,
          productId: item.productId ?? null,
          inventoryId: item.inventoryId ?? null,
          alternativeToItemId: item.alternativeToLineNumber
            ? created.get(item.alternativeToLineNumber)
            : null,
          lineNumber: index + 1,
          description: item.description,
          brand: item.brand ?? null,
          partNumber: item.partNumber ?? null,
          condition: item.condition,
          quantity: item.quantity,
          supplierUnitPrice: money(item.supplierUnitPrice),
          supplierLineTotal: money(item.supplierUnitPrice).mul(item.quantity),
          compatibilityNotes: item.compatibilityNotes ?? null,
          alternativePartInfo: item.alternativePartInfo ?? null,
        },
      });
      created.set(index + 1, row.id);
    }
  }

  private subtotal(items: QuotationWriteInput["items"]) {
    return items.reduce(
      (sum, item) =>
        item.alternativeToLineNumber
          ? sum
          : sum.add(money(item.supplierUnitPrice).mul(item.quantity)),
      money(0),
    );
  }

  async createQuotation(
    userId: string,
    businessId: string,
    input: QuotationWriteInput,
    requestId?: string,
  ) {
    const now = this.clock.now();
    return this.database.$transaction(async (tx) => {
      await lock(tx, "supplier_request_assignments", input.assignmentId);
      await this.assertMembership(tx, userId, businessId);
      const assignment = await this.assertSupplierAssignment(
        tx,
        businessId,
        input.assignmentId,
        now,
      );
      if (
        input.validUntil <= now ||
        input.validUntil > assignment.request.responseDeadlineAt!
      )
        throw new AppError(
          "Quotation validity must be in the future and no later than the assignment deadline",
          { code: "INVALID_VALIDITY", statusCode: 400 },
        );
      await this.validateQuoteItems(
        tx,
        businessId,
        assignment.request.items,
        input.items,
      );
      const existing = await tx.quotation.findFirst({
        where: { assignmentId: input.assignmentId, status: QuotationStatus.DRAFT },
      });
      if (existing)
        throw conflict(
          "A draft quotation already exists for this assignment",
          "DRAFT_EXISTS",
        );
      const id = randomUUID();
      const subtotal = this.subtotal(input.items);
      const quote = await tx.quotation.create({
        data: {
          id,
          quotationNumber: await nextNumber(tx, "quotation_number_seq", "QT"),
          requestId: assignment.requestId,
          businessId,
          assignmentId: assignment.id,
          revisionGroupId: id,
          supplierSubtotal: subtotal,
          customerTotal: subtotal,
          preparationTimeMin: input.preparationTimeMin ?? null,
          deliveryEstimateText: input.deliveryEstimateText ?? null,
          compatibilityNotes: input.compatibilityNotes ?? null,
          supplierNotes: input.supplierNotes ?? null,
          validUntil: input.validUntil,
        },
      });
      await this.replaceQuoteItems(tx, quote.id, input.items);
      await tx.quotationStatusHistory.create({
        data: {
          quotationId: quote.id,
          toStatus: QuotationStatus.DRAFT,
          actorUserId: userId,
        },
      });
      await recordAudit(tx, {
        actorUserId: userId,
        action: "QUOTATION_DRAFT_CREATED",
        entityType: "QUOTATION",
        entityId: quote.id,
        requestId,
        metadata: { businessId, sourcingRequestId: assignment.requestId },
      });
      return supplierQuote(
        await tx.quotation.findUniqueOrThrow({
          where: { id: quote.id },
          include: quoteInclude,
        }),
      );
    });
  }

  async updateQuotation(
    userId: string,
    businessId: string,
    quotationId: string,
    input: Omit<QuotationWriteInput, "assignmentId">,
    requestId?: string,
  ) {
    const now = this.clock.now();
    return this.database.$transaction(async (tx) => {
      await lock(tx, "quotations", quotationId);
      await this.assertMembership(tx, userId, businessId);
      const quote = await tx.quotation.findFirst({
        where: { id: quotationId, businessId },
      });
      if (!quote) throw notFound("Quotation was not found");
      if (quote.status !== QuotationStatus.DRAFT || !quote.assignmentId)
        throw conflict("Only draft quotations can be edited", "QUOTATION_IMMUTABLE");
      const assignment = await this.assertSupplierAssignment(
        tx,
        businessId,
        quote.assignmentId,
        now,
      );
      if (
        input.validUntil <= now ||
        input.validUntil > assignment.request.responseDeadlineAt!
      )
        throw new AppError(
          "Quotation validity must be in the future and no later than the assignment deadline",
          { code: "INVALID_VALIDITY", statusCode: 400 },
        );
      await this.validateQuoteItems(
        tx,
        businessId,
        assignment.request.items,
        input.items,
      );
      await tx.quotation.update({
        where: { id: quote.id },
        data: {
          supplierSubtotal: this.subtotal(input.items),
          customerTotal: this.subtotal(input.items),
          preparationTimeMin: input.preparationTimeMin ?? null,
          deliveryEstimateText: input.deliveryEstimateText ?? null,
          compatibilityNotes: input.compatibilityNotes ?? null,
          supplierNotes: input.supplierNotes ?? null,
          validUntil: input.validUntil,
          version: { increment: 1 },
        },
      });
      await this.replaceQuoteItems(tx, quote.id, input.items);
      await recordAudit(tx, {
        actorUserId: userId,
        action: "QUOTATION_DRAFT_UPDATED",
        entityType: "QUOTATION",
        entityId: quote.id,
        requestId,
        metadata: { businessId },
      });
      return supplierQuote(
        await tx.quotation.findUniqueOrThrow({
          where: { id: quote.id },
          include: quoteInclude,
        }),
      );
    });
  }

  async listSupplierQuotations(businessId: string, query: PageQuery) {
    const where: Prisma.QuotationWhereInput = {
      businessId,
      ...(query.status ? { status: query.status as QuotationStatus } : {}),
    };
    const [total, rows] = await this.database.$transaction([
      this.database.quotation.count({ where }),
      this.database.quotation.findMany({
        where,
        include: quoteInclude,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map(supplierQuote),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async getSupplierQuotation(businessId: string, id: string) {
    const quote = await this.database.quotation.findFirst({
      where: { id, businessId },
      include: quoteInclude,
    });
    if (!quote) throw notFound("Quotation was not found");
    const revisions = await this.database.quotation.findMany({
      where: { revisionGroupId: quote.revisionGroupId, businessId },
      select: {
        id: true,
        quotationNumber: true,
        revisionNumber: true,
        status: true,
        submittedAt: true,
      },
      orderBy: { revisionNumber: "asc" },
    });
    return { ...supplierQuote(quote), revisions };
  }

  async submitQuotation(
    userId: string,
    businessId: string,
    id: string,
    idempotencyKey: string,
    requestId?: string,
  ) {
    const now = this.clock.now();
    return this.database.$transaction(async (tx) => {
      await lock(tx, "quotations", id);
      await this.assertMembership(tx, userId, businessId);
      const quote = await tx.quotation.findFirst({
        where: { id, businessId },
        include: { items: true },
      });
      if (!quote) throw notFound("Quotation was not found");
      if (
        quote.submissionKey === idempotencyKey &&
        quote.status !== QuotationStatus.DRAFT
      )
        return supplierQuote(
          await tx.quotation.findUniqueOrThrow({ where: { id }, include: quoteInclude }),
        );
      if (quote.status !== QuotationStatus.DRAFT || !quote.assignmentId)
        throw conflict(
          "Quotation cannot be submitted from its current state",
          "QUOTATION_NOT_SUBMITTABLE",
        );
      const assignment = await this.assertSupplierAssignment(
        tx,
        businessId,
        quote.assignmentId,
        now,
      );
      if (
        !quote.validUntil ||
        quote.validUntil <= now ||
        quote.validUntil > assignment.request.responseDeadlineAt!
      )
        throw conflict("Quotation validity is no longer eligible", "QUOTATION_EXPIRED");
      if (!quote.items.some((item) => !item.alternativeToItemId))
        throw conflict("Quotation needs at least one primary line", "EMPTY_QUOTATION");
      const previous = quote.supersedesId
        ? await tx.quotation.findUnique({ where: { id: quote.supersedesId } })
        : null;
      await tx.quotation.update({
        where: { id },
        data: {
          status: QuotationStatus.SUBMITTED,
          submittedAt: now,
          submissionKey: idempotencyKey,
          version: { increment: 1 },
        },
      });
      await tx.quotationStatusHistory.create({
        data: {
          quotationId: id,
          fromStatus: QuotationStatus.DRAFT,
          toStatus: QuotationStatus.SUBMITTED,
          actorUserId: userId,
        },
      });
      if (previous) {
        await tx.quotation.update({
          where: { id: previous.id },
          data: { status: QuotationStatus.SUPERSEDED },
        });
        await tx.quotationStatusHistory.create({
          data: {
            quotationId: previous.id,
            fromStatus: previous.status,
            toStatus: QuotationStatus.SUPERSEDED,
            actorUserId: userId,
            note: "Superseded by submitted revision",
          },
        });
        await this.invalidateOptions(
          tx,
          previous.id,
          "Supplier submitted a newer quotation revision",
          userId,
          now,
        );
      }
      const oldAssignmentStatus = assignment.status;
      if (assignment.status !== SupplierAssignmentStatus.QUOTED) {
        await tx.supplierRequestAssignment.update({
          where: { id: assignment.id },
          data: { status: SupplierAssignmentStatus.QUOTED, quotedAt: now },
        });
        await tx.supplierAssignmentHistory.create({
          data: {
            assignmentId: assignment.id,
            eventType: SupplierAssignmentEventType.QUOTED,
            fromStatus: oldAssignmentStatus,
            toStatus: SupplierAssignmentStatus.QUOTED,
            actorUserId: userId,
          },
        });
      }
      if (assignment.request.requestType === SourcingRequestType.USED_PART_RFQ) {
        const primaryItems = quote.items.filter((item) => !item.alternativeToItemId);
        const previousOption = await tx.sourcingOption.findFirst({
          where: {
            requestId: quote.requestId,
            quotation: { businessId },
            status: SourcingOptionStatus.PUBLISHED,
          },
          orderBy: { revisionNumber: "desc" },
        });
        if (previousOption) {
          await tx.sourcingOption.update({
            where: { id: previousOption.id },
            data: {
              status: SourcingOptionStatus.INVALIDATED,
              invalidatedAt: now,
              invalidationReason: "Supplier submitted a newer quotation revision",
              version: { increment: 1 },
            },
          });
          await tx.sourcingOptionHistory.create({
            data: {
              optionId: previousOption.id,
              fromStatus: SourcingOptionStatus.PUBLISHED,
              toStatus: SourcingOptionStatus.INVALIDATED,
              actorUserId: userId,
              reason: "Supplier submitted a newer quotation revision",
            },
          });
        }
        const optionId = randomUUID();
        const option = await tx.sourcingOption.create({
          data: {
            id: optionId,
            optionNumber: await nextNumber(tx, "sourcing_option_number_seq", "OPT"),
            requestId: quote.requestId,
            quotationId: quote.id,
            versionGroupId: previousOption?.versionGroupId ?? optionId,
            revisionNumber: (previousOption?.revisionNumber ?? 0) + 1,
            supersedesId: previousOption?.id,
            status: SourcingOptionStatus.PUBLISHED,
            supplierSubtotal: quote.supplierSubtotal,
            customerItemsTotal: quote.supplierSubtotal,
            customerTotal: quote.supplierSubtotal,
            preparationTimeMin: quote.preparationTimeMin,
            deliveryEstimateText: quote.deliveryEstimateText,
            compatibilityNotes: quote.compatibilityNotes,
            customerNotes:
              "Supplier quotation published without routine administrative approval.",
            validUntil: quote.validUntil!,
            publishedAt: now,
          },
        });
        for (const [index, item] of primaryItems.entries()) {
          await tx.sourcingOptionLine.create({
            data: {
              optionId: option.id,
              requestItemId: item.requestItemId!,
              quotationItemId: item.id,
              lineNumber: index + 1,
              description: item.description,
              brand: item.brand,
              partNumber: item.partNumber,
              condition: item.condition,
              quantity: item.quantity,
              supplierUnitPrice: item.supplierUnitPrice,
              supplierLineTotal: item.supplierLineTotal,
              customerUnitPrice: item.supplierUnitPrice,
              customerLineTotal: item.supplierLineTotal,
              compatibilityNotes: item.compatibilityNotes,
              alternativePartInfo: item.alternativePartInfo,
              isAlternative: false,
            },
          });
        }
        await tx.sourcingOptionHistory.create({
          data: {
            optionId: option.id,
            toStatus: SourcingOptionStatus.PUBLISHED,
            actorUserId: userId,
            reason: "Routine used-parts quotation published automatically",
          },
        });
        await tx.quotation.update({
          where: { id: quote.id },
          data: { status: QuotationStatus.SENT_TO_CUSTOMER },
        });
        await tx.sourcingRequest.update({
          where: { id: assignment.requestId },
          data: {
            status: SourcingRequestStatus.AWAITING_CUSTOMER,
            version: { increment: 1 },
          },
        });
        await tx.requestStatusHistory.create({
          data: {
            requestId: assignment.requestId,
            fromStatus: assignment.request.status,
            toStatus: SourcingRequestStatus.AWAITING_CUSTOMER,
            actorUserId: userId,
            note: "Used-parts quotation is available to the customer",
          },
        });
        await enqueueOutbox(tx, {
          eventType: "QUOTATION_SUBMITTED",
          aggregateType: "SOURCING_REQUEST",
          aggregateId: assignment.requestId,
          eventKey: `used-rfq:${assignment.requestId}:quotation:${quote.id}`,
          payload: {
            businessId,
            requestId: assignment.requestId,
            quotationId: quote.id,
            optionId: option.id,
          },
        });
        await enqueueOutbox(tx, {
          eventType: "SOURCING_OPTION_PUBLISHED",
          aggregateType: "SOURCING_OPTION",
          aggregateId: option.id,
          eventKey: `used-rfq:${assignment.requestId}:option:${option.id}:published`,
          payload: { requestId: assignment.requestId, optionId: option.id },
        });
      } else if (assignment.request.status === SourcingRequestStatus.MATCHING) {
        await tx.sourcingRequest.update({
          where: { id: assignment.requestId },
          data: { status: SourcingRequestStatus.QUOTING, version: { increment: 1 } },
        });
        await tx.requestStatusHistory.create({
          data: {
            requestId: assignment.requestId,
            fromStatus: SourcingRequestStatus.MATCHING,
            toStatus: SourcingRequestStatus.QUOTING,
            actorUserId: userId,
            note: "Supplier quotation submitted",
          },
        });
      }
      await recordAudit(tx, {
        actorUserId: userId,
        action: "QUOTATION_SUBMITTED",
        entityType: "QUOTATION",
        entityId: id,
        requestId,
        metadata: {
          businessId,
          sourcingRequestId: quote.requestId,
          revisionNumber: quote.revisionNumber,
        },
      });
      return supplierQuote(
        await tx.quotation.findUniqueOrThrow({ where: { id }, include: quoteInclude }),
      );
    });
  }

  async createRevision(
    userId: string,
    businessId: string,
    id: string,
    requestId?: string,
  ) {
    const now = this.clock.now();
    return this.database.$transaction(async (tx) => {
      await lock(tx, "quotations", id);
      await this.assertMembership(tx, userId, businessId);
      const source = await tx.quotation.findFirst({
        where: { id, businessId },
        include: { items: { orderBy: { lineNumber: "asc" } } },
      });
      if (!source || !source.assignmentId) throw notFound("Quotation was not found");
      if (
        (
          [
            QuotationStatus.DRAFT,
            QuotationStatus.WITHDRAWN,
            QuotationStatus.EXPIRED,
            QuotationStatus.SUPERSEDED,
            QuotationStatus.REJECTED,
            QuotationStatus.ACCEPTED,
          ] as QuotationStatus[]
        ).includes(source.status)
      )
        throw conflict("Quotation is not eligible for revision", "REVISION_NOT_ALLOWED");
      await this.assertSupplierAssignment(tx, businessId, source.assignmentId, now);
      const pending = await tx.quotation.findFirst({
        where: { revisionGroupId: source.revisionGroupId, status: QuotationStatus.DRAFT },
      });
      if (pending)
        return supplierQuote(
          await tx.quotation.findUniqueOrThrow({
            where: { id: pending.id },
            include: quoteInclude,
          }),
        );
      const latest = await tx.quotation.aggregate({
        where: { revisionGroupId: source.revisionGroupId },
        _max: { revisionNumber: true },
      });
      const created = await tx.quotation.create({
        data: {
          quotationNumber: await nextNumber(tx, "quotation_number_seq", "QT"),
          requestId: source.requestId,
          businessId,
          assignmentId: source.assignmentId,
          revisionGroupId: source.revisionGroupId,
          revisionNumber: (latest._max.revisionNumber ?? 0) + 1,
          supersedesId: source.id,
          supplierSubtotal: source.supplierSubtotal,
          customerTotal: source.supplierSubtotal,
          preparationTimeMin: source.preparationTimeMin,
          deliveryEstimateText: source.deliveryEstimateText,
          compatibilityNotes: source.compatibilityNotes,
          supplierNotes: source.supplierNotes,
          validUntil: source.validUntil,
        },
      });
      const idMap = new Map<string, string>();
      for (const item of source.items) {
        const row = await tx.quotationItem.create({
          data: {
            quotationId: created.id,
            requestItemId: item.requestItemId,
            productId: item.productId,
            inventoryId: item.inventoryId,
            alternativeToItemId: item.alternativeToItemId
              ? idMap.get(item.alternativeToItemId)
              : null,
            lineNumber: item.lineNumber,
            description: item.description,
            brand: item.brand,
            partNumber: item.partNumber,
            condition: item.condition,
            quantity: item.quantity,
            supplierUnitPrice: item.supplierUnitPrice,
            supplierLineTotal: item.supplierLineTotal,
            compatibilityNotes: item.compatibilityNotes,
            alternativePartInfo: item.alternativePartInfo,
          },
        });
        idMap.set(item.id, row.id);
      }
      await tx.quotationStatusHistory.create({
        data: {
          quotationId: created.id,
          toStatus: QuotationStatus.DRAFT,
          actorUserId: userId,
          note: `Revision of ${source.quotationNumber}`,
        },
      });
      await recordAudit(tx, {
        actorUserId: userId,
        action: "QUOTATION_REVISION_CREATED",
        entityType: "QUOTATION",
        entityId: created.id,
        requestId,
        metadata: { businessId, revisionNumber: created.revisionNumber },
      });
      return supplierQuote(
        await tx.quotation.findUniqueOrThrow({
          where: { id: created.id },
          include: quoteInclude,
        }),
      );
    });
  }

  async withdrawQuotation(
    userId: string,
    businessId: string,
    id: string,
    reason: string,
    requestId?: string,
  ) {
    const now = this.clock.now();
    return this.database.$transaction(async (tx) => {
      await lock(tx, "quotations", id);
      await this.assertMembership(tx, userId, businessId);
      const quote = await tx.quotation.findFirst({ where: { id, businessId } });
      if (!quote) throw notFound("Quotation was not found");
      if (
        !(
          [
            QuotationStatus.SUBMITTED,
            QuotationStatus.ADMIN_REVIEW,
            QuotationStatus.CLARIFICATION,
            QuotationStatus.SENT_TO_CUSTOMER,
          ] as QuotationStatus[]
        ).includes(quote.status)
      )
        throw conflict("Quotation cannot be withdrawn", "WITHDRAWAL_NOT_ALLOWED");
      await tx.quotation.update({
        where: { id },
        data: { status: QuotationStatus.WITHDRAWN, version: { increment: 1 } },
      });
      await tx.quotationStatusHistory.create({
        data: {
          quotationId: id,
          fromStatus: quote.status,
          toStatus: QuotationStatus.WITHDRAWN,
          note: reason,
          actorUserId: userId,
        },
      });
      await this.invalidateOptions(
        tx,
        id,
        "Supplier withdrew the quotation",
        userId,
        now,
      );
      await recordAudit(tx, {
        actorUserId: userId,
        action: "QUOTATION_WITHDRAWN",
        entityType: "QUOTATION",
        entityId: id,
        requestId,
        metadata: { businessId },
      });
      return supplierQuote(
        await tx.quotation.findUniqueOrThrow({ where: { id }, include: quoteInclude }),
      );
    });
  }

  async getAdminComparison(requestId: string) {
    const request = await this.database.sourcingRequest.findUnique({
      where: { id: requestId },
      include: {
        items: { orderBy: { lineNumber: "asc" } },
        quotations: {
          where: { status: { not: QuotationStatus.DRAFT } },
          include: quoteInclude,
          orderBy: [{ businessId: "asc" }, { revisionNumber: "desc" }],
        },
      },
    });
    if (!request) throw notFound("Sourcing request was not found");
    return {
      request: {
        id: request.id,
        requestNumber: request.requestNumber,
        status: request.status,
        items: request.items.map(
          ({ id, lineNumber, description, partNumber, quantity }) => ({
            id,
            lineNumber,
            description,
            partNumber,
            quantity,
          }),
        ),
      },
      quotations: request.quotations.map(supplierQuote),
      compatibilityDisclaimer:
        "Compatibility information is supplier-provided and is not a guaranteed fit.",
    };
  }

  async getAdminQuotation(id: string) {
    const quote = await this.database.quotation.findUnique({
      where: { id },
      include: quoteInclude,
    });
    if (!quote) throw notFound("Quotation was not found");
    return supplierQuote(quote);
  }

  async askSupplierClarification(
    adminId: string,
    id: string,
    question: string,
    requestId?: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await lock(tx, "quotations", id);
      const quote = await tx.quotation.findUnique({ where: { id } });
      if (!quote?.assignmentId) throw notFound("Quotation was not found");
      if (
        !(
          [
            QuotationStatus.SUBMITTED,
            QuotationStatus.ADMIN_REVIEW,
            QuotationStatus.CLARIFICATION,
          ] as QuotationStatus[]
        ).includes(quote.status)
      )
        throw conflict("Quotation is not under review", "CLARIFICATION_NOT_ALLOWED");
      const row = await tx.supplierClarification.create({
        data: {
          assignmentId: quote.assignmentId,
          quotationId: id,
          initiator: ClarificationInitiator.ADMIN,
          question,
          askedByUserId: adminId,
        },
      });
      if (quote.status !== QuotationStatus.CLARIFICATION) {
        await tx.quotation.update({
          where: { id },
          data: {
            status: QuotationStatus.CLARIFICATION,
            adminReviewStatus: AdminReviewStatus.CHANGES_REQUESTED,
          },
        });
        await tx.quotationStatusHistory.create({
          data: {
            quotationId: id,
            fromStatus: quote.status,
            toStatus: QuotationStatus.CLARIFICATION,
            actorUserId: adminId,
            note: "Admin requested clarification",
          },
        });
      }
      await recordAudit(tx, {
        actorUserId: adminId,
        action: "QUOTATION_CLARIFICATION_REQUESTED",
        entityType: "QUOTATION",
        entityId: id,
        requestId,
      });
      return { id: row.id, question: row.question, askedAt: row.askedAt };
    });
  }

  async replySupplierClarification(
    userId: string,
    businessId: string,
    quotationId: string,
    clarificationId: string,
    reply: string,
    requestId?: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await this.assertMembership(tx, userId, businessId);
      const quote = await tx.quotation.findFirst({
        where: { id: quotationId, businessId },
      });
      if (!quote) throw notFound("Quotation was not found");
      const clarification = await tx.supplierClarification.findFirst({
        where: {
          id: clarificationId,
          quotationId,
          initiator: ClarificationInitiator.ADMIN,
        },
      });
      if (!clarification) throw notFound("Clarification was not found");
      if (clarification.repliedAt)
        return {
          id: clarification.id,
          reply: clarification.reply,
          repliedAt: clarification.repliedAt,
        };
      const updated = await tx.supplierClarification.update({
        where: { id: clarification.id },
        data: { reply, repliedByUserId: userId, repliedAt: this.clock.now() },
      });
      await recordAudit(tx, {
        actorUserId: userId,
        action: "QUOTATION_CLARIFICATION_REPLIED",
        entityType: "QUOTATION",
        entityId: quotationId,
        requestId,
        metadata: { businessId },
      });
      return { id: updated.id, reply: updated.reply, repliedAt: updated.repliedAt };
    });
  }

  async rejectQuotation(adminId: string, id: string, reason: string, requestId?: string) {
    return this.database.$transaction(async (tx) => {
      await lock(tx, "quotations", id);
      const quote = await tx.quotation.findUnique({ where: { id } });
      if (!quote) throw notFound("Quotation was not found");
      if (
        !(
          [
            QuotationStatus.SUBMITTED,
            QuotationStatus.ADMIN_REVIEW,
            QuotationStatus.CLARIFICATION,
          ] as QuotationStatus[]
        ).includes(quote.status)
      )
        throw conflict("Quotation cannot be rejected", "REJECTION_NOT_ALLOWED");
      await tx.quotation.update({
        where: { id },
        data: {
          status: QuotationStatus.REJECTED,
          adminReviewStatus: AdminReviewStatus.REJECTED,
          rejectedAt: this.clock.now(),
        },
      });
      await tx.quotationStatusHistory.create({
        data: {
          quotationId: id,
          fromStatus: quote.status,
          toStatus: QuotationStatus.REJECTED,
          note: reason,
          actorUserId: adminId,
        },
      });
      await recordAudit(tx, {
        actorUserId: adminId,
        action: "QUOTATION_REJECTED",
        entityType: "QUOTATION",
        entityId: id,
        requestId,
      });
      return supplierQuote(
        await tx.quotation.findUniqueOrThrow({ where: { id }, include: quoteInclude }),
      );
    });
  }

  async prepareOption(
    adminId: string,
    requestId: string,
    input: PrepareOptionInput,
    auditRequestId?: string,
  ) {
    const now = this.clock.now();
    return this.database.$transaction(async (tx) => {
      await lock(tx, "sourcing_requests", requestId);
      const quote = await tx.quotation.findFirst({
        where: { id: input.quotationId, requestId },
        include: {
          items: true,
          business: {
            select: {
              status: true,
              members: { where: { isActive: true, leftAt: null }, select: { id: true } },
            },
          },
        },
      });
      if (!quote) throw notFound("Quotation was not found");
      if (
        !(
          [
            QuotationStatus.SUBMITTED,
            QuotationStatus.ADMIN_REVIEW,
            QuotationStatus.CLARIFICATION,
            QuotationStatus.SENT_TO_CUSTOMER,
          ] as QuotationStatus[]
        ).includes(quote.status) ||
        quote.business.status !== SupplierBusinessStatus.ACTIVE ||
        quote.business.members.length === 0 ||
        !quote.validUntil ||
        quote.validUntil <= now
      )
        throw conflict(
          "Quotation is not eligible for publication",
          "QUOTATION_NOT_ELIGIBLE",
        );
      if (input.validUntil <= now || input.validUntil > quote.validUntil)
        throw new AppError(
          "Option validity must be in the future and no later than quotation validity",
          { code: "INVALID_VALIDITY", statusCode: 400 },
        );
      const selected = input.quotationItemIds.map((id) =>
        quote.items.find((item) => item.id === id),
      );
      if (selected.some((item) => !item))
        throw new AppError("Selected quotation item is invalid", {
          code: "INVALID_QUOTATION_ITEM",
          statusCode: 400,
        });
      const lines = selected as typeof quote.items;
      if (
        new Set(lines.map((line) => line.requestItemId)).size !== lines.length ||
        lines.some((line) => !line.requestItemId)
      )
        throw new AppError("Select exactly one offered part per covered request item", {
          code: "DUPLICATE_ITEM_COVERAGE",
          statusCode: 400,
        });
      const supplierSubtotal = lines.reduce(
        (sum, item) => sum.add(item.supplierLineTotal),
        money(0),
      );
      const margin = money(input.platformMargin);
      const delivery = money(input.deliveryCharge);
      const priority = money(input.priorityCharge);
      const itemsTotal = supplierSubtotal.add(margin);
      const customerTotal = itemsTotal.add(delivery).add(priority);
      let supersedes = null;
      if (input.supersedesOptionId) {
        supersedes = await tx.sourcingOption.findFirst({
          where: { id: input.supersedesOptionId, requestId },
        });
        if (!supersedes || supersedes.status === SourcingOptionStatus.ACCEPTED)
          throw conflict("Option cannot be superseded", "OPTION_NOT_SUPERSEDED");
      }
      const optionId = randomUUID();
      const groupId = supersedes?.versionGroupId ?? optionId;
      const revision = supersedes ? supersedes.revisionNumber + 1 : 1;
      const option = await tx.sourcingOption.create({
        data: {
          id: optionId,
          optionNumber: await nextNumber(tx, "sourcing_option_number_seq", "OPT"),
          requestId,
          quotationId: quote.id,
          versionGroupId: groupId,
          revisionNumber: revision,
          supersedesId: supersedes?.id,
          supplierSubtotal,
          platformMargin: margin,
          deliveryCharge: delivery,
          priorityCharge: priority,
          customerItemsTotal: itemsTotal,
          customerTotal,
          preparationTimeMin: quote.preparationTimeMin,
          deliveryEstimateText: quote.deliveryEstimateText,
          compatibilityNotes: quote.compatibilityNotes,
          customerNotes: input.customerNotes ?? null,
          internalNotes: input.internalNotes ?? null,
          validUntil: input.validUntil,
        },
      });
      let allocated = money(0);
      for (const [index, item] of lines.entries()) {
        const lineMargin =
          index === lines.length - 1
            ? margin.sub(allocated)
            : money(
                margin
                  .mul(item.supplierLineTotal)
                  .div(supplierSubtotal.isZero() ? lines.length : supplierSubtotal),
              );
        allocated = allocated.add(lineMargin);
        const lineTotal = money(item.supplierLineTotal.add(lineMargin));
        await tx.sourcingOptionLine.create({
          data: {
            optionId: option.id,
            requestItemId: item.requestItemId!,
            quotationItemId: item.id,
            lineNumber: index + 1,
            description: item.description,
            brand: item.brand,
            partNumber: item.partNumber,
            condition: item.condition,
            quantity: item.quantity,
            supplierUnitPrice: item.supplierUnitPrice,
            supplierLineTotal: item.supplierLineTotal,
            customerUnitPrice: money(lineTotal.div(item.quantity)),
            customerLineTotal: lineTotal,
            compatibilityNotes: item.compatibilityNotes,
            alternativePartInfo: item.alternativePartInfo,
            isAlternative: Boolean(item.alternativeToItemId),
          },
        });
      }
      await tx.sourcingOptionHistory.create({
        data: {
          optionId: option.id,
          toStatus: SourcingOptionStatus.DRAFT,
          actorUserId: adminId,
        },
      });
      await recordAudit(tx, {
        actorUserId: adminId,
        action: "SOURCING_OPTION_PREPARED",
        entityType: "SOURCING_OPTION",
        entityId: option.id,
        requestId: auditRequestId,
        metadata: {
          sourcingRequestId: requestId,
          quotationId: quote.id,
          revisionNumber: revision,
        },
      });
      return this.adminOption(
        await tx.sourcingOption.findUniqueOrThrow({
          where: { id: option.id },
          include: optionInclude,
        }),
      );
    });
  }

  private adminOption(option: Option) {
    return {
      ...customerOption(option),
      quotationId: option.quotationId,
      supplierSubtotal: displayMoney(option.supplierSubtotal),
      platformMargin: displayMoney(option.platformMargin),
      internalNotes: option.internalNotes,
    };
  }

  async getAdminOption(id: string) {
    const option = await this.database.sourcingOption.findUnique({
      where: { id },
      include: optionInclude,
    });
    if (!option) throw notFound("Sourcing option was not found");
    return this.adminOption(option);
  }

  async publishOption(
    adminId: string,
    id: string,
    expectedVersion: number,
    requestId?: string,
  ) {
    const now = this.clock.now();
    return this.database.$transaction(async (tx) => {
      await lock(tx, "sourcing_options", id);
      const option = await tx.sourcingOption.findUnique({
        where: { id },
        include: {
          quotation: {
            include: {
              business: {
                select: {
                  status: true,
                  members: {
                    where: { isActive: true, leftAt: null },
                    select: { id: true },
                  },
                },
              },
            },
          },
        },
      });
      if (!option) throw notFound("Sourcing option was not found");
      if (
        option.status !== SourcingOptionStatus.DRAFT ||
        option.version !== expectedVersion
      )
        throw conflict("Option changed or is not publishable", "OPTION_VERSION_CONFLICT");
      if (
        option.validUntil <= now ||
        !option.quotation.validUntil ||
        option.quotation.validUntil <= now ||
        option.quotation.business.status !== SupplierBusinessStatus.ACTIVE ||
        !(
          [
            QuotationStatus.SUBMITTED,
            QuotationStatus.ADMIN_REVIEW,
            QuotationStatus.CLARIFICATION,
            QuotationStatus.SENT_TO_CUSTOMER,
          ] as QuotationStatus[]
        ).includes(option.quotation.status)
      )
        throw conflict(
          "Underlying quotation is no longer eligible",
          "OPTION_NOT_ACTIONABLE",
        );
      if (option.supersedesId) {
        const prior = await tx.sourcingOption.findUnique({
          where: { id: option.supersedesId },
        });
        if (prior?.status === SourcingOptionStatus.ACCEPTED)
          throw conflict(
            "Accepted option cannot be superseded",
            "OPTION_ALREADY_ACCEPTED",
          );
        if (prior?.status === SourcingOptionStatus.PUBLISHED)
          await this.setOptionStatus(
            tx,
            prior.id,
            prior.status,
            SourcingOptionStatus.INVALIDATED,
            adminId,
            "Replaced by a newer published version",
            now,
          );
      }
      await tx.sourcingOption.update({
        where: { id },
        data: {
          status: SourcingOptionStatus.PUBLISHED,
          publishedAt: now,
          version: { increment: 1 },
        },
      });
      await tx.sourcingOptionHistory.create({
        data: {
          optionId: id,
          fromStatus: SourcingOptionStatus.DRAFT,
          toStatus: SourcingOptionStatus.PUBLISHED,
          actorUserId: adminId,
        },
      });
      await tx.quotation.update({
        where: { id: option.quotationId },
        data: {
          status: QuotationStatus.SENT_TO_CUSTOMER,
          adminReviewStatus: AdminReviewStatus.APPROVED,
        },
      });
      const request = await tx.sourcingRequest.findUniqueOrThrow({
        where: { id: option.requestId },
      });
      if (
        (
          [
            SourcingRequestStatus.MATCHING,
            SourcingRequestStatus.QUOTING,
          ] as SourcingRequestStatus[]
        ).includes(request.status)
      ) {
        await tx.sourcingRequest.update({
          where: { id: request.id },
          data: {
            status: SourcingRequestStatus.AWAITING_CUSTOMER,
            version: { increment: 1 },
          },
        });
        await tx.requestStatusHistory.create({
          data: {
            requestId: request.id,
            fromStatus: request.status,
            toStatus: SourcingRequestStatus.AWAITING_CUSTOMER,
            actorUserId: adminId,
            note: "Customer sourcing option published",
          },
        });
      }
      await recordAudit(tx, {
        actorUserId: adminId,
        action: "SOURCING_OPTION_PUBLISHED",
        entityType: "SOURCING_OPTION",
        entityId: id,
        requestId,
        metadata: { sourcingRequestId: option.requestId },
      });
      return this.adminOption(
        await tx.sourcingOption.findUniqueOrThrow({
          where: { id },
          include: optionInclude,
        }),
      );
    });
  }

  private async setOptionStatus(
    tx: Tx,
    id: string,
    from: SourcingOptionStatus,
    to: SourcingOptionStatus,
    actorUserId: string | undefined,
    reason: string,
    now: Date,
  ) {
    await tx.sourcingOption.update({
      where: { id },
      data: {
        status: to,
        version: { increment: 1 },
        ...(to === SourcingOptionStatus.INVALIDATED
          ? { invalidatedAt: now, invalidationReason: reason }
          : {}),
        ...(to === SourcingOptionStatus.WITHDRAWN
          ? { withdrawnAt: now, invalidationReason: reason }
          : {}),
        ...(to === SourcingOptionStatus.REJECTED
          ? { rejectedAt: now, invalidationReason: reason }
          : {}),
      },
    });
    await tx.sourcingOptionHistory.create({
      data: { optionId: id, fromStatus: from, toStatus: to, actorUserId, reason },
    });
  }

  private async invalidateOptions(
    tx: Tx,
    quotationId: string,
    reason: string,
    actorUserId: string,
    now: Date,
  ) {
    const options = await tx.sourcingOption.findMany({
      where: {
        quotationId,
        status: { in: [SourcingOptionStatus.DRAFT, SourcingOptionStatus.PUBLISHED] },
      },
    });
    for (const option of options)
      await this.setOptionStatus(
        tx,
        option.id,
        option.status,
        SourcingOptionStatus.INVALIDATED,
        actorUserId,
        reason,
        now,
      );
  }

  async withdrawOption(adminId: string, id: string, reason: string, requestId?: string) {
    return this.database.$transaction(async (tx) => {
      await lock(tx, "sourcing_options", id);
      const option = await tx.sourcingOption.findUnique({ where: { id } });
      if (!option) throw notFound("Sourcing option was not found");
      if (option.status !== SourcingOptionStatus.PUBLISHED)
        throw conflict(
          "Only published options can be withdrawn",
          "WITHDRAWAL_NOT_ALLOWED",
        );
      await this.setOptionStatus(
        tx,
        id,
        option.status,
        SourcingOptionStatus.WITHDRAWN,
        adminId,
        reason,
        this.clock.now(),
      );
      await recordAudit(tx, {
        actorUserId: adminId,
        action: "SOURCING_OPTION_WITHDRAWN",
        entityType: "SOURCING_OPTION",
        entityId: id,
        requestId,
        metadata: { sourcingRequestId: option.requestId },
      });
      return this.adminOption(
        await tx.sourcingOption.findUniqueOrThrow({
          where: { id },
          include: optionInclude,
        }),
      );
    });
  }

  async listCustomerOptions(userId: string, requestId: string, query: PageQuery) {
    const customer = await this.database.customerProfile.findUnique({
      where: { userId },
    });
    if (!customer) throw notFound("Sourcing request was not found");
    const request = await this.database.sourcingRequest.findFirst({
      where: { id: requestId, customerId: customer.id },
    });
    if (!request) throw notFound("Sourcing request was not found");
    await this.expirePublished(requestId);
    const where: Prisma.SourcingOptionWhereInput = {
      requestId,
      status: query.status
        ? (query.status as SourcingOptionStatus)
        : { not: SourcingOptionStatus.DRAFT },
    };
    const [total, rows] = await this.database.$transaction([
      this.database.sourcingOption.count({ where }),
      this.database.sourcingOption.findMany({
        where,
        include: optionInclude,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map(customerOption),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async listCustomerOptionsBatch(
    userId: string,
    query: { requestIds: string[]; page: number; pageSize: number },
  ) {
    const where: Prisma.SourcingOptionWhereInput = {
      requestId: { in: [...new Set(query.requestIds)] },
      status: { not: SourcingOptionStatus.DRAFT },
      request: { customer: { userId } },
    };
    const [total, rows] = await this.database.$transaction([
      this.database.sourcingOption.count({ where }),
      this.database.sourcingOption.findMany({
        where,
        include: optionInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((option) => {
        const serialized = customerOption(option);
        return option.status === SourcingOptionStatus.PUBLISHED &&
          option.validUntil <= this.clock.now()
          ? { ...serialized, status: SourcingOptionStatus.EXPIRED }
          : serialized;
      }),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async getCustomerOption(userId: string, id: string) {
    const option = await this.findCustomerOption(userId, id);
    return customerOption(option);
  }

  private async findCustomerOption(userId: string, id: string) {
    const option = await this.database.sourcingOption.findFirst({
      where: {
        id,
        status: { not: SourcingOptionStatus.DRAFT },
        request: { customer: { userId } },
      },
      include: optionInclude,
    });
    if (!option) throw notFound("Sourcing option was not found");
    if (
      option.status === SourcingOptionStatus.PUBLISHED &&
      option.validUntil <= this.clock.now()
    ) {
      await this.expirePublished(option.requestId);
      return await this.database.sourcingOption.findUniqueOrThrow({
        where: { id },
        include: optionInclude,
      });
    }
    return option;
  }

  private async expirePublished(requestId: string) {
    const now = this.clock.now();
    const expired = await this.database.sourcingOption.findMany({
      where: {
        requestId,
        status: SourcingOptionStatus.PUBLISHED,
        validUntil: { lte: now },
      },
      select: { id: true },
    });
    for (const option of expired)
      await this.database.$transaction(async (tx) =>
        this.setOptionStatus(
          tx,
          option.id,
          SourcingOptionStatus.PUBLISHED,
          SourcingOptionStatus.EXPIRED,
          undefined,
          "Option validity elapsed",
          now,
        ),
      );
  }

  async askCustomerClarification(
    userId: string,
    id: string,
    question: string,
    requestId?: string,
  ) {
    const option = await this.findCustomerOption(userId, id);
    if (option.status !== SourcingOptionStatus.PUBLISHED)
      throw conflict("Option is not open for clarification", "OPTION_NOT_ACTIONABLE");
    const customer = await this.database.customerProfile.findUniqueOrThrow({
      where: { userId },
    });
    const row = await this.database.customerOptionClarification.create({
      data: { optionId: id, customerId: customer.id, question, askedByUserId: userId },
    });
    await recordAudit(this.database, {
      actorUserId: userId,
      action: "CUSTOMER_OPTION_CLARIFICATION_REQUESTED",
      entityType: "SOURCING_OPTION",
      entityId: id,
      requestId,
    });
    return { id: row.id, question: row.question, askedAt: row.askedAt };
  }

  async replyCustomerClarification(
    adminId: string,
    id: string,
    clarificationId: string,
    reply: string,
    requestId?: string,
  ) {
    const row = await this.database.customerOptionClarification.findFirst({
      where: { id: clarificationId, optionId: id },
    });
    if (!row) throw notFound("Clarification was not found");
    if (row.repliedAt) return { id: row.id, reply: row.reply, repliedAt: row.repliedAt };
    const updated = await this.database.customerOptionClarification.update({
      where: { id: row.id },
      data: { reply, repliedByUserId: adminId, repliedAt: this.clock.now() },
    });
    await recordAudit(this.database, {
      actorUserId: adminId,
      action: "CUSTOMER_OPTION_CLARIFICATION_REPLIED",
      entityType: "SOURCING_OPTION",
      entityId: id,
      requestId,
    });
    return { id: updated.id, reply: updated.reply, repliedAt: updated.repliedAt };
  }

  async rejectCustomerOption(
    userId: string,
    id: string,
    reason: string,
    requestId?: string,
  ) {
    const customer = await this.database.customerProfile.findUnique({
      where: { userId },
    });
    if (!customer) throw notFound("Sourcing option was not found");
    return this.database.$transaction(async (tx) => {
      await lock(tx, "sourcing_options", id);
      const option = await tx.sourcingOption.findFirst({
        where: { id, request: { customerId: customer.id } },
      });
      if (!option) throw notFound("Sourcing option was not found");
      if (
        option.status !== SourcingOptionStatus.PUBLISHED ||
        option.validUntil <= this.clock.now()
      )
        throw conflict("Option is not actionable", "OPTION_NOT_ACTIONABLE");
      await this.setOptionStatus(
        tx,
        id,
        option.status,
        SourcingOptionStatus.REJECTED,
        userId,
        reason,
        this.clock.now(),
      );
      await recordAudit(tx, {
        actorUserId: userId,
        action: "SOURCING_OPTION_REJECTED",
        entityType: "SOURCING_OPTION",
        entityId: id,
        requestId,
      });
      return customerOption(
        await tx.sourcingOption.findUniqueOrThrow({
          where: { id },
          include: optionInclude,
        }),
      );
    });
  }

  async acceptOption(
    userId: string,
    id: string,
    input: AcceptOptionInput,
    requestId?: string,
  ) {
    const now = this.clock.now();
    const customer = await this.database.customerProfile.findUnique({
      where: { userId },
    });
    if (!customer) throw notFound("Sourcing option was not found");
    return this.database.$transaction(async (tx) => {
      const prior = await tx.optionAcceptance.findUnique({
        where: {
          customerId_idempotencyKey: {
            customerId: customer.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
        include: { items: true },
      });
      if (prior) {
        if (prior.optionId !== id)
          throw conflict("Idempotency key was already used", "IDEMPOTENCY_CONFLICT");
        return safeAcceptance(prior);
      }
      const optionBase = await tx.sourcingOption.findFirst({
        where: { id, request: { customerId: customer.id } },
      });
      if (!optionBase) throw notFound("Sourcing option was not found");
      await lock(tx, "sourcing_requests", optionBase.requestId);
      await lock(tx, "sourcing_options", id);
      const concurrentPrior = await tx.optionAcceptance.findUnique({
        where: {
          customerId_idempotencyKey: {
            customerId: customer.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
        include: { items: true },
      });
      if (concurrentPrior) {
        if (concurrentPrior.optionId !== id)
          throw conflict("Idempotency key was already used", "IDEMPOTENCY_CONFLICT");
        return safeAcceptance(concurrentPrior);
      }
      const option = await tx.sourcingOption.findUniqueOrThrow({
        where: { id },
        include: {
          lines: true,
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
          request: { include: { items: true } },
        },
      });
      if (
        option.status !== SourcingOptionStatus.PUBLISHED ||
        option.version !== input.expectedVersion ||
        option.validUntil <= now ||
        !option.quotation.validUntil ||
        option.quotation.validUntil <= now ||
        option.quotation.status !== QuotationStatus.SENT_TO_CUSTOMER ||
        option.quotation.business.status !== SupplierBusinessStatus.ACTIVE ||
        option.quotation.business.members.length === 0 ||
        option.quotation.business.members.length === 0 ||
        !(
          [
            SourcingRequestStatus.AWAITING_CUSTOMER,
            SourcingRequestStatus.ACCEPTED,
          ] as SourcingRequestStatus[]
        ).includes(option.request.status)
      )
        throw conflict("Option is no longer actionable", "OPTION_NOT_ACTIONABLE");
      let delivery: Prisma.InputJsonValue;
      if (input.deliveryAddressId) {
        const address = await tx.customerAddress.findFirst({
          where: {
            id: input.deliveryAddressId,
            customerId: customer.id,
            isActive: true,
            deletedAt: null,
          },
        });
        if (!address)
          throw new AppError("Delivery address was not found", {
            code: "INVALID_DELIVERY_ADDRESS",
            statusCode: 400,
          });
        delivery = {
          source: "SAVED",
          savedAddressId: address.id,
          recipientName: address.recipientName ?? customer.fullName,
          phone: address.phone ?? "",
          addressLine: address.addressLine,
          addressLine2: address.addressLine2,
          area: address.area ?? "",
          city: address.city,
          postalCode: address.postalCode,
          landmark: address.landmark,
          deliveryInstructions: address.deliveryInstructions,
        };
      } else
        delivery = {
          source: "MANUAL",
          savedAddressId: null,
          ...input.manualDelivery!,
        } as Prisma.InputJsonObject;
      const accepted = await tx.optionAcceptanceItem.groupBy({
        by: ["requestItemId"],
        where: {
          acceptance: { requestId: option.requestId, allocationReleasedAt: null },
        },
        _sum: { quantity: true },
      });
      const acceptedMap = new Map(
        accepted.map((row) => [row.requestItemId, row._sum.quantity ?? 0]),
      );
      for (const line of option.lines) {
        const required = option.request.items.find(
          (item) => item.id === line.requestItemId,
        )?.quantity;
        if (
          !required ||
          (acceptedMap.get(line.requestItemId) ?? 0) + line.quantity > required
        )
          throw conflict(
            "Acceptance would exceed a requested item quantity",
            "ITEM_QUANTITY_EXCEEDED",
          );
      }
      const acceptance = await tx.optionAcceptance.create({
        data: {
          optionId: option.id,
          requestId: option.requestId,
          customerId: customer.id,
          idempotencyKey: input.idempotencyKey,
          optionRevision: option.revisionNumber,
          currency: option.currency,
          customerItemsTotal: option.customerItemsTotal,
          deliveryCharge: option.deliveryCharge,
          priorityCharge: option.priorityCharge,
          customerTotal: option.customerTotal,
          deliverySnapshot: delivery,
          items: {
            create: option.lines.map((line) => ({
              requestItemId: line.requestItemId,
              optionLineId: line.id,
              quotationItemId: line.quotationItemId,
              description: line.description,
              brand: line.brand,
              partNumber: line.partNumber,
              condition: line.condition,
              quantity: line.quantity,
              customerUnitPrice: line.customerUnitPrice,
              customerLineTotal: line.customerLineTotal,
              compatibilityNotes: line.compatibilityNotes,
              alternativePartInfo: line.alternativePartInfo,
              isAlternative: line.isAlternative,
            })),
          },
        },
        include: { items: true },
      });
      await this.setOptionStatus(
        tx,
        id,
        option.status,
        SourcingOptionStatus.ACCEPTED,
        userId,
        "Customer accepted option",
        now,
      );
      const acceptedRequestIds = new Set(option.lines.map((line) => line.requestItemId));
      const conflicts = await tx.sourcingOption.findMany({
        where: {
          requestId: option.requestId,
          id: { not: id },
          status: SourcingOptionStatus.PUBLISHED,
          lines: { some: { requestItemId: { in: [...acceptedRequestIds] } } },
        },
      });
      for (const other of conflicts)
        await this.setOptionStatus(
          tx,
          other.id,
          other.status,
          SourcingOptionStatus.INVALIDATED,
          userId,
          "Conflicts with accepted item coverage",
          now,
        );
      const allAccepted = await tx.optionAcceptanceItem.groupBy({
        by: ["requestItemId"],
        where: {
          acceptance: { requestId: option.requestId, allocationReleasedAt: null },
        },
        _sum: { quantity: true },
      });
      const totals = new Map(
        allAccepted.map((row) => [row.requestItemId, row._sum.quantity ?? 0]),
      );
      const complete = option.request.items.every(
        (item) => (totals.get(item.id) ?? 0) >= item.quantity,
      );
      for (const item of option.request.items) {
        if ((totals.get(item.id) ?? 0) >= item.quantity && item.status !== "ACCEPTED")
          await tx.sourcingRequestItem.update({
            where: { id: item.id },
            data: { status: "ACCEPTED" },
          });
      }
      if (complete && option.request.status !== SourcingRequestStatus.ACCEPTED) {
        await tx.sourcingRequest.update({
          where: { id: option.requestId },
          data: { status: SourcingRequestStatus.ACCEPTED, version: { increment: 1 } },
        });
        await tx.requestStatusHistory.create({
          data: {
            requestId: option.requestId,
            fromStatus: option.request.status,
            toStatus: SourcingRequestStatus.ACCEPTED,
            actorUserId: userId,
            note: "All requested item quantities accepted",
          },
        });
      }
      await recordAudit(tx, {
        actorUserId: userId,
        action: "SOURCING_OPTION_ACCEPTED",
        entityType: "OPTION_ACCEPTANCE",
        entityId: acceptance.id,
        requestId,
        metadata: {
          sourcingRequestId: option.requestId,
          optionId: option.id,
          completeCoverage: complete,
        },
      });
      return safeAcceptance(acceptance);
    });
  }
}
