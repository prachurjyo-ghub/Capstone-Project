import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListingImageReconciler } from "./listing-image-reconciler.js";
import type {
  ListingImageFile,
  ListingImageObject,
  ListingImageStorage,
  ListingImageStream,
} from "./listing-image-storage.js";

function databaseStub(options?: { referenced?: string[]; raced?: string[] }) {
  const referenced = new Set(options?.referenced ?? []);
  const raced = new Set(options?.raced ?? []);
  return {
    supplierListingImage: {
      findMany: vi.fn(async ({ where }: { where: { storageKey: { in: string[] } } }) =>
        where.storageKey.in
          .filter((storageKey) => referenced.has(storageKey))
          .map((storageKey) => ({ storageKey })),
      ),
      findUnique: vi.fn(async ({ where }: { where: { storageKey: string } }) =>
        raced.has(where.storageKey) ? { id: "new-reference" } : null,
      ),
    },
  } as unknown as PrismaClient;
}

class MemoryStorage implements ListingImageStorage {
  readonly deleted: string[] = [];
  readonly attempts = new Map<string, number>();

  constructor(
    private readonly objects: ListingImageObject[],
    private readonly failuresBeforeSuccess = 0,
  ) {}

  async put(_file: ListingImageFile) {}
  async open(_storageKey: string): Promise<ListingImageStream> {
    throw new Error("not used");
  }
  async delete(storageKey: string) {
    const attempts = (this.attempts.get(storageKey) ?? 0) + 1;
    this.attempts.set(storageKey, attempts);
    if (attempts <= this.failuresBeforeSuccess) throw new Error("temporary failure");
    this.deleted.push(storageKey);
  }
  async list(cursor: string | undefined, limit: number) {
    const sorted = [...this.objects].sort((left, right) =>
      left.storageKey.localeCompare(right.storageKey),
    );
    const offset = cursor
      ? Math.max(
          0,
          sorted.findIndex((object) => object.storageKey > cursor),
        )
      : 0;
    const objects = sorted.slice(offset, offset + limit);
    return {
      objects,
      ...(offset + objects.length < sorted.length && objects.length
        ? { nextCursor: objects.at(-1)!.storageKey }
        : {}),
    };
  }
}

const now = new Date("2026-10-31T12:00:00.000Z");
const old = new Date("2026-10-29T12:00:00.000Z");
const recent = new Date("2026-10-31T11:30:00.000Z");
const referencedKey = "00000000-0000-4000-8000-000000000001.webp";
const orphanKey = "00000000-0000-4000-8000-000000000002.webp";
const recentKey = "00000000-0000-4000-8000-000000000003.webp";

afterEach(() => vi.useRealTimers());

describe("ListingImageReconciler", () => {
  it("paginates bounded scans and reports old unreferenced objects without mutation", async () => {
    const storage = new MemoryStorage([
      { storageKey: referencedKey, lastModified: old },
      { storageKey: orphanKey, lastModified: old },
      { storageKey: recentKey, lastModified: recent },
    ]);
    const reconciler = new ListingImageReconciler(
      databaseStub({ referenced: [referencedKey] }),
      storage,
      24,
    );

    const first = await reconciler.reconcile({ limit: 1, dryRun: true, now });
    expect(first).toMatchObject({
      inspected: 1,
      referenced: 1,
      candidates: [],
      deleted: [],
      nextCursor: referencedKey,
    });
    const second = await reconciler.reconcile({
      cursor: first.nextCursor!,
      limit: 10,
      dryRun: true,
      now,
    });
    expect(second).toMatchObject({
      inspected: 2,
      tooRecent: 1,
      candidates: [orphanKey],
      deleted: [],
      nextCursor: null,
    });
    expect(storage.deleted).toEqual([]);
  });

  it("retries deletion with backoff and deletes only after the database recheck", async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage([{ storageKey: orphanKey, lastModified: old }], 2);
    const reconciler = new ListingImageReconciler(databaseStub(), storage, 24);

    const pending = reconciler.reconcile({ limit: 10, dryRun: false, now });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result).toMatchObject({
      candidates: [orphanKey],
      deleted: [orphanKey],
      failed: [],
    });
    expect(storage.attempts.get(orphanKey)).toBe(3);
  });

  it("preserves an orphan candidate that becomes referenced during reconciliation", async () => {
    const storage = new MemoryStorage([{ storageKey: orphanKey, lastModified: old }]);
    const reconciler = new ListingImageReconciler(
      databaseStub({ raced: [orphanKey] }),
      storage,
      24,
    );

    const result = await reconciler.reconcile({ limit: 10, dryRun: false, now });

    expect(result.candidates).toEqual([orphanKey]);
    expect(result.deleted).toEqual([]);
    expect(storage.deleted).toEqual([]);
  });
});
