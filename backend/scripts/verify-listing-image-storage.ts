import { randomUUID } from "node:crypto";
import { S3ListingImageStorage } from "../src/modules/inventory/s3-listing-image-storage.js";

const bucket = process.env.S3_PRIVATE_BUCKET?.trim();
const prefix = process.env.S3_LISTING_IMAGE_PREFIX?.trim();
if (!bucket || !prefix) {
  throw new Error("S3_PRIVATE_BUCKET and S3_LISTING_IMAGE_PREFIX are required");
}

const firstKey = `${randomUUID()}.webp`;
const replacementKey = `${randomUUID()}.webp`;
const first = Buffer.from("phase3-listing-image-first");
const replacement = Buffer.from("phase3-listing-image-replacement");
const storage = new S3ListingImageStorage(bucket, prefix);

async function read(storageKey: string) {
  const opened = await storage.open(storageKey);
  const chunks: Buffer[] = [];
  for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function main() {
  try {
    await storage.put({ storageKey: firstKey, data: first, mimeType: "image/webp" });
    if (!(await read(firstKey)).equals(first)) throw new Error("initial read mismatch");
    const initialList = await storage.list(undefined, 10);
    if (!initialList.objects.some((object) => object.storageKey === firstKey))
      throw new Error("initial object was not listed");

    await storage.put({
      storageKey: replacementKey,
      data: replacement,
      mimeType: "image/webp",
    });
    await storage.delete(firstKey);
    await read(firstKey)
      .then(() => {
        throw new Error("deleted object remained readable");
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code !== "LISTING_IMAGE_NOT_FOUND") throw error;
      });
    if (!(await read(replacementKey)).equals(replacement))
      throw new Error("replacement read mismatch");

    await storage.delete(replacementKey);
    const finalList = await storage.list(undefined, 10);
    if (finalList.objects.length !== 0) throw new Error("test prefix was not empty");
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        workflow: ["upload", "read", "list", "replace", "delete", "404-check"],
        prefix,
      })}\n`,
    );
  } finally {
    await Promise.allSettled([storage.delete(firstKey), storage.delete(replacementKey)]);
  }
}

void main();
