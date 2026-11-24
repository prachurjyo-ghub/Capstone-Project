import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import type { ListingImageStorage } from "./listing-image-storage.js";

export type ListingImageReconcileInput = {
  cursor?: string;
  limit: number;
  dryRun: boolean;
  now?: Date;
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class ListingImageReconciler {
  constructor(
    private readonly database: PrismaClient,
    private readonly storage: ListingImageStorage,
    private readonly graceHours: number,
    private readonly logger?: Logger,
  ) {}

  private async deleteWithRetry(storageKey: string) {
    const delays = [0, 100, 500];
    let lastError: unknown;
    for (const delay of delays) {
      if (delay) await wait(delay);
      try {
        await this.storage.delete(storageKey);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async reconcile(input: ListingImageReconcileInput) {
    const startedAt = Date.now();
    const cutoff = new Date(
      (input.now ?? new Date()).getTime() - this.graceHours * 60 * 60 * 1_000,
    );
    const page = await this.storage.list(input.cursor, input.limit);
    const oldEnough = page.objects.filter((object) => object.lastModified <= cutoff);
    const referenced = oldEnough.length
      ? await this.database.supplierListingImage.findMany({
          where: { storageKey: { in: oldEnough.map((object) => object.storageKey) } },
          select: { storageKey: true },
        })
      : [];
    const referencedKeys = new Set(referenced.map((image) => image.storageKey));
    const candidates = oldEnough.filter(
      (object) => !referencedKeys.has(object.storageKey),
    );
    const deleted: string[] = [];
    const failed: Array<{ storageKey: string; reason: string }> = [];

    if (!input.dryRun) {
      for (const candidate of candidates) {
        const nowReferenced = await this.database.supplierListingImage.findUnique({
          where: { storageKey: candidate.storageKey },
          select: { id: true },
        });
        if (nowReferenced) continue;
        try {
          await this.deleteWithRetry(candidate.storageKey);
          deleted.push(candidate.storageKey);
        } catch (error) {
          failed.push({
            storageKey: candidate.storageKey,
            reason: error instanceof Error ? error.message : "unknown storage error",
          });
        }
      }
    }

    const result = {
      dryRun: input.dryRun,
      inspected: page.objects.length,
      tooRecent: page.objects.length - oldEnough.length,
      referenced: referenced.length,
      candidates: candidates.map((object) => object.storageKey),
      deleted,
      failed,
      nextCursor: page.nextCursor ?? null,
      cutoff,
      durationMs: Date.now() - startedAt,
    };
    this.logger?.info(
      {
        dryRun: result.dryRun,
        inspected: result.inspected,
        candidates: result.candidates.length,
        deleted: result.deleted.length,
        failed: result.failed.length,
        hasNextPage: Boolean(result.nextCursor),
        durationMs: result.durationMs,
      },
      "Listing image orphan reconciliation completed",
    );
    return result;
  }
}
