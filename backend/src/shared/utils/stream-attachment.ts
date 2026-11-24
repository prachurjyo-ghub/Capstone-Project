import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { Response } from "express";

export async function streamAttachment(
  res: Response,
  attachment: {
    fileName: string;
    mimeType: string;
    byteSize?: number | null;
    stream: Readable;
  },
) {
  const safeName = attachment.fileName.replace(/["\\\r\n]/g, "_");
  res.status(200).type(attachment.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
  res.setHeader("Cache-Control", "private, no-store");
  if (typeof attachment.byteSize === "number") {
    res.setHeader("Content-Length", String(attachment.byteSize));
  }
  try {
    await pipeline(attachment.stream, res);
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error as Error);
      return;
    }
    throw error;
  }
}
