import { UserRole, type PrismaClient } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import type { Env } from "../../config/env.js";
import {
  createAuthenticateMiddleware,
  requireRoles,
} from "../../middleware/authenticate.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { sendSuccess } from "../../shared/utils/response.js";
import {
  DisabledNotificationDelivery,
  LocalNotificationDelivery,
} from "../communications/notification-delivery.js";
import { OutboxProcessor } from "../communications/outbox-processor.js";
import type { MatchingClock } from "../matching/matching-clock.js";
import { BackgroundService } from "./background.service.js";
import type { ListingImageStorage } from "../inventory/listing-image-storage.js";
import { ListingImageReconciler } from "../inventory/listing-image-reconciler.js";
import { recordAudit } from "../auth/audit.service.js";

const params = z.object({ id: z.string().uuid() }).strict();
const query = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    status: z.enum(["PENDING", "PROCESSING", "PROCESSED", "FAILED"]).optional(),
  })
  .strict();
const imageReconciliationInput = z
  .object({
    cursor: z.string().min(1).max(2_048).optional(),
    limit: z.coerce.number().int().min(1).max(1_000).optional(),
    dryRun: z.boolean().default(true),
  })
  .strict();

export function createAdminJobRouter(
  database: PrismaClient,
  env: Env,
  clock: MatchingClock,
  listingImageStorage: ListingImageStorage,
) {
  const router = Router();
  const delivery =
    env.NODE_ENV === "development"
      ? new LocalNotificationDelivery(env.NOTIFICATION_OUTBOX_DIR)
      : new DisabledNotificationDelivery();
  const outbox = new OutboxProcessor(database, env, delivery);
  const background = new BackgroundService(database, clock, env.JOB_BATCH_SIZE);
  const imageReconciler = new ListingImageReconciler(
    database,
    listingImageStorage,
    env.LISTING_IMAGE_ORPHAN_GRACE_HOURS,
  );
  router.use(createAuthenticateMiddleware(database, env));
  router.use(requireRoles(database, UserRole.ADMIN, UserRole.SUPER_ADMIN));
  router.get("/outbox", validateRequest({ query }), async (req, res) => {
    const input = req.query as unknown as {
      page: number;
      pageSize: number;
      status?: "PENDING" | "PROCESSING" | "PROCESSED" | "FAILED";
    };
    const where = { status: input.status };
    const [items, total] = await database.$transaction([
      database.outboxEvent.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          eventType: true,
          aggregateType: true,
          aggregateId: true,
          status: true,
          attempts: true,
          maxAttempts: true,
          availableAt: true,
          processedAt: true,
          lastErrorCode: true,
          createdAt: true,
        },
      }),
      database.outboxEvent.count({ where }),
    ]);
    sendSuccess(
      res,
      { items, total, page: input.page, pageSize: input.pageSize },
      200,
      req.requestId,
    );
  });
  router.post("/outbox/process", async (req, res) => {
    sendSuccess(res, await outbox.processBatch(), 200, req.requestId);
  });
  router.post("/outbox/:id/retry", validateRequest({ params }), async (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") throw new Error("id is missing");
    const result = await outbox.retryFailed(id);
    sendSuccess(res, { queued: result.count === 1 }, 200, req.requestId);
  });
  router.post("/reconcile", async (req, res) => {
    sendSuccess(res, await background.reconcileLifecycle(), 200, req.requestId);
  });
  router.post("/reminders", async (req, res) => {
    sendSuccess(res, await background.enqueueReminders(), 200, req.requestId);
  });
  router.post(
    "/listing-images/reconcile",
    requireRoles(database, UserRole.SUPER_ADMIN),
    validateRequest({ body: imageReconciliationInput }),
    async (req, res) => {
      if (!req.auth) throw new Error("Admin authentication context is missing");
      const input = req.body as z.infer<typeof imageReconciliationInput>;
      const result = await imageReconciler.reconcile({
        ...input,
        limit: input.limit ?? env.LISTING_IMAGE_RECONCILE_BATCH_SIZE,
      });
      req.log.info(
        {
          dryRun: result.dryRun,
          inspected: result.inspected,
          candidates: result.candidates.length,
          deleted: result.deleted.length,
          failed: result.failed.length,
          hasNextPage: Boolean(result.nextCursor),
          durationMs: result.durationMs,
        },
        "Operator listing-image reconciliation completed",
      );
      if (!input.dryRun) {
        await recordAudit(database, {
          actorUserId: req.auth.id,
          action: "LISTING_IMAGE_ORPHAN_RECONCILIATION",
          entityType: "SYSTEM",
          requestId: req.requestId,
          metadata: {
            inspected: result.inspected,
            candidates: result.candidates.length,
            deleted: result.deleted.length,
            failed: result.failed.length,
          },
        });
      }
      sendSuccess(res, result, 200, req.requestId);
    },
  );
  return router;
}
