import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { AppError } from "../../shared/errors/app-error.js";

export const MAX_REQUEST_PHOTOS = 5;
export const MAX_REQUEST_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_REQUEST_PHOTO_DIMENSION = 8_000;
export const MAX_REQUEST_PHOTO_PIXELS = 40_000_000;

export type ValidatedImage = {
  data: Buffer;
  storageKey: string;
  fileName: string;
  mimeType: "image/jpeg" | "image/png";
  byteSize: number;
  width: number;
  height: number;
  contentSha256: string;
};

function invalid(message: string): AppError {
  return new AppError(message, {
    code: "INVALID_REQUEST_PHOTO",
    statusCode: 400,
  });
}

function pngDimensions(data: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (data.length < 45 || !data.subarray(0, 8).equals(signature)) return null;
  if (data.readUInt32BE(8) !== 13 || data.toString("ascii", 12, 16) !== "IHDR") {
    throw invalid("PNG is missing a valid IHDR header");
  }
  let offset = 8;
  let hasImageData = false;
  let reachedEnd = false;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > data.length) throw invalid("PNG chunk data is truncated");
    const type = data.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") hasImageData = true;
    if (type === "IEND") {
      if (length !== 0 || chunkEnd !== data.length) {
        throw invalid("PNG has invalid data after its end marker");
      }
      reachedEnd = true;
      break;
    }
    offset = chunkEnd;
  }
  if (!hasImageData || !reachedEnd) throw invalid("PNG image data is incomplete");
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function jpegDimensions(data: Buffer): { width: number; height: number } | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  if (data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9) {
    throw invalid("JPEG image data is incomplete");
  }
  let offset = 2;
  while (offset + 3 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let markerOffset = offset + 1;
    while (data[markerOffset] === 0xff) markerOffset += 1;
    const marker = data[markerOffset];
    offset = markerOffset + 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > data.length) break;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) break;
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      if (length < 7) throw invalid("JPEG frame header is invalid");
      return {
        height: data.readUInt16BE(offset + 3),
        width: data.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  throw invalid("JPEG dimensions could not be read");
}

function safeDisplayName(value: string | undefined, extension: string): string {
  const base = path.basename(value?.trim() || `request-photo.${extension}`);
  const cleaned = [...base]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .slice(0, 180);
  return cleaned || `request-photo.${extension}`;
}

export function validateRequestImage(
  data: Buffer,
  originalName?: string,
): ValidatedImage {
  if (data.length === 0) throw invalid("Photo file is empty");
  if (data.length > MAX_REQUEST_PHOTO_BYTES) {
    throw new AppError("Photo exceeds the 5 MiB limit", {
      code: "REQUEST_PHOTO_TOO_LARGE",
      statusCode: 413,
    });
  }

  const png = pngDimensions(data);
  const jpeg = png ? null : jpegDimensions(data);
  const dimensions = png ?? jpeg;
  if (!dimensions) throw invalid("Only actual JPEG and PNG images are accepted");
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > MAX_REQUEST_PHOTO_DIMENSION ||
    dimensions.height > MAX_REQUEST_PHOTO_DIMENSION ||
    dimensions.width * dimensions.height > MAX_REQUEST_PHOTO_PIXELS
  ) {
    throw invalid("Photo dimensions exceed the allowed limits");
  }

  const extension = png ? "png" : "jpg";
  return {
    data,
    storageKey: `${randomUUID()}.${extension}`,
    fileName: safeDisplayName(originalName, extension),
    mimeType: png ? "image/png" : "image/jpeg",
    byteSize: data.length,
    width: dimensions.width,
    height: dimensions.height,
    contentSha256: createHash("sha256").update(data).digest("hex"),
  };
}
