import {
  InventoryImportStatus,
  QuotationStatus,
  SourcingOptionStatus,
  SupplierAssignmentEventType,
  SupplierAssignmentStatus,
  type PrismaClient,
} from "@prisma/client";
import type { MatchingClock } from "../matching/matching-clock.js";
import { enqueueOutbox } from "../communications/outbox.service.js";

const ACTIVE_ASSIGNMENTS = [
  SupplierAssignmentStatus.ASSIGNED,
  SupplierAssignmentStatus.VIEWED,
];
const ACTIVE_QUOTES = [
  QuotationStatus.SUBMITTED,
  QuotationStatus.ADMIN_REVIEW,
  QuotationStatus.CLARIFICATION,
  QuotationStatus.SENT_TO_CUSTOMER,
];

export class BackgroundService {
  constructor(
    private readonly database: PrismaClient,
    private readonly clock: MatchingClock,
    private readonly batchSize: number,
  ) {}

  async reconcileLifecycle() {
    const now = this.clock.now();
    const requests = await this.database.sourcingRequest.findMany({
      where: {
        responseDeadlineAt: { lte: now },
        assignments: { some: { status: { in: ACTIVE_ASSIGNMENTS } } },
      },
      select: { id: true, responseDeadlineAt: true },
      orderBy: { responseDeadlineAt: "asc" },
      take: this.batchSize,
    });
    let assignmentsExpired = 0;
    for (const request of requests) {
      await this.database.$transaction(async (tx) => {
        const assignments = await tx.supplierRequestAssignment.findMany({
          where: { requestId: request.id, status: { in: ACTIVE_ASSIGNMENTS } },
          select: { id: true, status: true },
        });
        for (const assignment of assignments) {
          const updated = await tx.supplierRequestAssignment.updateMany({
            where: { id: assignment.id, status: assignment.status },
            data: { status: SupplierAssignmentStatus.EXPIRED, expiredAt: now },
          });
          if (!updated.count) continue;
          assignmentsExpired += 1;
          await tx.supplierAssignmentHistory.create({
            data: {
              assignmentId: assignment.id,
              eventType: SupplierAssignmentEventType.EXPIRED,
              fromStatus: assignment.status,
              toStatus: SupplierAssignmentStatus.EXPIRED,
              deadlineAt: request.responseDeadlineAt,
            },
          });
        }
      });
    }

    const quotations = await this.database.quotation.findMany({
      where: { status: { in: ACTIVE_QUOTES }, validUntil: { lte: now } },
      select: { id: true, status: true },
      orderBy: { validUntil: "asc" },
      take: this.batchSize,
    });
    let quotationsExpired = 0;
    for (const quotation of quotations) {
      await this.database.$transaction(async (tx) => {
        const updated = await tx.quotation.updateMany({
          where: { id: quotation.id, status: quotation.status, validUntil: { lte: now } },
          data: { status: QuotationStatus.EXPIRED, version: { increment: 1 } },
        });
        if (!updated.count) return;
        quotationsExpired += 1;
        await tx.quotationStatusHistory.create({
          data: {
            quotationId: quotation.id,
            fromStatus: quotation.status,
            toStatus: QuotationStatus.EXPIRED,
            note: "Quotation validity elapsed",
          },
        });
        await tx.sourcingOption.updateMany({
          where: { quotationId: quotation.id, status: SourcingOptionStatus.PUBLISHED },
          data: {
            status: SourcingOptionStatus.INVALIDATED,
            invalidatedAt: now,
            invalidationReason: "Underlying quotation expired",
            version: { increment: 1 },
          },
        });
      });
    }

    const options = await this.database.sourcingOption.findMany({
      where: { status: SourcingOptionStatus.PUBLISHED, validUntil: { lte: now } },
      select: { id: true },
      orderBy: { validUntil: "asc" },
      take: this.batchSize,
    });
    let optionsExpired = 0;
    for (const option of options) {
      await this.database.$transaction(async (tx) => {
        const updated = await tx.sourcingOption.updateMany({
          where: {
            id: option.id,
            status: SourcingOptionStatus.PUBLISHED,
            validUntil: { lte: now },
          },
          data: { status: SourcingOptionStatus.EXPIRED, version: { increment: 1 } },
        });
        if (!updated.count) return;
        optionsExpired += 1;
        await tx.sourcingOptionHistory.create({
          data: {
            optionId: option.id,
            fromStatus: SourcingOptionStatus.PUBLISHED,
            toStatus: SourcingOptionStatus.EXPIRED,
            reason: "Option validity elapsed",
          },
        });
      });
    }

    const previews = await this.database.inventoryCsvPreview.updateMany({
      where: { status: InventoryImportStatus.PREVIEWED, expiresAt: { lte: now } },
      data: {
        status: InventoryImportStatus.EXPIRED,
        rows: [],
        result: { expired: true },
      },
    });
    return {
      assignmentsExpired,
      quotationsExpired,
      optionsExpired,
      csvPreviewsExpired: previews.count,
    };
  }

  async enqueueReminders() {
    const now = this.clock.now();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const assignments = await this.database.supplierRequestAssignment.findMany({
      where: {
        status: { in: ACTIVE_ASSIGNMENTS },
        request: { responseDeadlineAt: { gt: now, lte: in24Hours } },
      },
      select: { id: true, request: { select: { responseDeadlineAt: true } } },
      take: this.batchSize,
    });
    for (const assignment of assignments) {
      await enqueueOutbox(this.database, {
        eventType: "SUPPLIER_ASSIGNMENT_REMINDER",
        aggregateType: "SUPPLIER_ASSIGNMENT",
        aggregateId: assignment.id,
        eventKey: `assignment-reminder:${assignment.id}:${assignment.request.responseDeadlineAt?.toISOString()}`,
        payload: {},
      });
    }
    const orders = await this.database.order.findMany({
      where: {
        status: { notIn: ["COMPLETED", "CANCELLED", "FAILED", "RETURNED"] },
        OR: [
          { estimatedWindowStart: { gt: now, lte: in24Hours } },
          { targetDeadlineAt: { lte: now } },
        ],
      },
      select: { id: true, estimatedWindowStart: true, targetDeadlineAt: true },
      take: this.batchSize,
    });
    for (const order of orders) {
      const breached = !!order.targetDeadlineAt && order.targetDeadlineAt <= now;
      await enqueueOutbox(this.database, {
        eventType: breached ? "URGENT_DEADLINE_BREACHED" : "DELIVERY_REMINDER",
        aggregateType: "ORDER",
        aggregateId: order.id,
        eventKey: breached
          ? `urgent-breach:${order.id}:${order.targetDeadlineAt?.toISOString()}`
          : `delivery-reminder:${order.id}:${order.estimatedWindowStart?.toISOString()}`,
        payload: {},
      });
    }
    return { assignmentReminders: assignments.length, orderReminders: orders.length };
  }
}
