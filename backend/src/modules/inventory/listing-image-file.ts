import { AppError } from "../../shared/errors/app-error.js";

export const MAX_LISTING_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_LISTING_IMAGE_PIXELS = 24_000_000;
export const MAX_LISTING_IMAGE_DIMENSION = 8_000;

type ImageInfo = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
  width: number;
  height: number;
};
const invalid = (message = "The image payload is invalid") =>
  new AppError(message, { code: "INVALID_LISTING_IMAGE", statusCode: 400 });

function jpegSize(data: Buffer) {
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1]!;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = data.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > data.length) break;
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
      ].includes(marker)
    ) {
      return {
        height: data.readUInt16BE(offset + 5),
        width: data.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  throw invalid();
}

function webpSize(data: Buffer) {
  const kind = data.toString("ascii", 12, 16);
  if (kind === "VP8X" && data.length >= 30)
    return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
  if (
    kind === "VP8 " &&
    data.length >= 30 &&
    data[23] === 0x9d &&
    data[24] === 0x01 &&
    data[25] === 0x2a
  )
    return {
      width: data.readUInt16LE(26) & 0x3fff,
      height: data.readUInt16LE(28) & 0x3fff,
    };
  if (kind === "VP8L" && data.length >= 25 && data[20] === 0x2f) {
    const bits = data.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  throw invalid();
}

export function inspectListingImage(data: Buffer): ImageInfo {
  if (!data.length || data.length > MAX_LISTING_IMAGE_BYTES)
    throw invalid("Optimized images must be 2 MiB or smaller");
  let info: ImageInfo;
  if (
    data.length >= 24 &&
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    info = {
      mimeType: "image/png",
      extension: "png",
      width: data.readUInt32BE(16),
      height: data.readUInt32BE(20),
    };
  } else if (
    data.length >= 12 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[data.length - 2] === 0xff &&
    data[data.length - 1] === 0xd9
  ) {
    info = { mimeType: "image/jpeg", extension: "jpg", ...jpegSize(data) };
  } else if (
    data.length >= 30 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  ) {
    info = { mimeType: "image/webp", extension: "webp", ...webpSize(data) };
  } else throw invalid("Only valid JPEG, PNG, or WebP images are accepted");
  if (
    !info.width ||
    !info.height ||
    info.width > MAX_LISTING_IMAGE_DIMENSION ||
    info.height > MAX_LISTING_IMAGE_DIMENSION ||
    info.width * info.height > MAX_LISTING_IMAGE_PIXELS
  )
    throw invalid("Image dimensions exceed the safe processing limit");
  return info;
}
