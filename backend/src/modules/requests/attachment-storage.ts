import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import type { Readable } from "node:stream";
import path from "node:path";
import { AppError } from "../../shared/errors/app-error.js";

export type StoredAttachment = {
  storageKey: string;
  data: Buffer;
};
export type AttachmentReadStream = { stream: Readable; contentLength?: number };

export interface RequestAttachmentStorage {
  put(file: StoredAttachment): Promise<void>;
  open(storageKey: string): Promise<AttachmentReadStream>;
  read(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}

function unavailable(): AppError {
  return new AppError("Request attachment storage is unavailable", {
    code: "ATTACHMENT_STORAGE_UNAVAILABLE",
    statusCode: 503,
  });
}

export class DisabledRequestAttachmentStorage implements RequestAttachmentStorage {
  async put(_file: StoredAttachment): Promise<void> {
    throw unavailable();
  }

  async read(_storageKey: string): Promise<Buffer> {
    throw unavailable();
  }

  async open(_storageKey: string): Promise<AttachmentReadStream> {
    throw unavailable();
  }

  async delete(_storageKey: string): Promise<void> {
    throw unavailable();
  }
}

export class LocalRequestAttachmentStorage implements RequestAttachmentStorage {
  private readonly root: string;

  constructor(directory: string) {
    this.root = path.resolve(directory);
  }

  private target(storageKey: string): string {
    if (!/^[0-9a-f-]{36}\.(?:jpg|png)$/i.test(storageKey)) throw unavailable();
    const target = path.resolve(this.root, storageKey);
    if (path.dirname(target) !== this.root) throw unavailable();
    return target;
  }

  async put(file: StoredAttachment): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(this.target(file.storageKey), file.data, {
      flag: "wx",
      mode: 0o600,
    });
  }

  read(storageKey: string): Promise<Buffer> {
    return readFile(this.target(storageKey));
  }

  async open(storageKey: string): Promise<AttachmentReadStream> {
    const target = this.target(storageKey);
    const metadata = await stat(target);
    return { stream: createReadStream(target), contentLength: metadata.size };
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await unlink(this.target(storageKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
