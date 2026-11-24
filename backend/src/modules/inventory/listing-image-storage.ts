import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import type { Readable } from "node:stream";
import path from "node:path";
import { AppError } from "../../shared/errors/app-error.js";

export type ListingImageFile = { storageKey: string; data: Buffer; mimeType: string };
export type ListingImageStream = { stream: Readable; contentLength?: number };
export type ListingImageObject = { storageKey: string; lastModified: Date };
export type ListingImageObjectPage = {
  objects: ListingImageObject[];
  nextCursor?: string;
};

export interface ListingImageStorage {
  put(file: ListingImageFile): Promise<void>;
  open(storageKey: string): Promise<ListingImageStream>;
  delete(storageKey: string): Promise<void>;
  list(cursor: string | undefined, limit: number): Promise<ListingImageObjectPage>;
}

function unavailable() {
  return new AppError("Listing image storage is unavailable", {
    code: "LISTING_IMAGE_STORAGE_UNAVAILABLE",
    statusCode: 503,
  });
}

function safeKey(storageKey: string) {
  if (!/^[0-9a-f-]{36}\.(?:jpe?g|png|webp)$/i.test(storageKey)) throw unavailable();
  return storageKey;
}

export class DisabledListingImageStorage implements ListingImageStorage {
  async put(): Promise<void> {
    throw unavailable();
  }
  async open(): Promise<ListingImageStream> {
    throw unavailable();
  }
  async delete(): Promise<void> {
    throw unavailable();
  }
  async list(): Promise<ListingImageObjectPage> {
    throw unavailable();
  }
}

export class LocalListingImageStorage implements ListingImageStorage {
  private readonly root: string;
  constructor(directory: string) {
    this.root = path.resolve(directory);
  }
  private target(storageKey: string) {
    const target = path.resolve(this.root, safeKey(storageKey));
    if (path.dirname(target) !== this.root) throw unavailable();
    return target;
  }
  async put(file: ListingImageFile) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(this.target(file.storageKey), file.data, { flag: "wx", mode: 0o600 });
  }
  async open(storageKey: string) {
    const target = this.target(storageKey);
    const metadata = await stat(target);
    return { stream: createReadStream(target), contentLength: metadata.size };
  }
  async delete(storageKey: string) {
    try {
      await unlink(this.target(storageKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async list(cursor: string | undefined, limit: number) {
    let names: string[];
    try {
      names = (await readdir(this.root))
        .filter((name) => /^[0-9a-f-]{36}\.(?:jpe?g|png|webp)$/i.test(name))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { objects: [] };
      throw error;
    }
    const start = cursor ? names.findIndex((name) => name > cursor) : 0;
    const offset = start < 0 ? names.length : start;
    const selected = names.slice(offset, offset + limit);
    const objects = await Promise.all(
      selected.map(async (storageKey) => ({
        storageKey,
        lastModified: (await stat(this.target(storageKey))).mtime,
      })),
    );
    return {
      objects,
      ...(offset + selected.length < names.length && selected.length
        ? { nextCursor: selected.at(-1) }
        : {}),
    };
  }
}
