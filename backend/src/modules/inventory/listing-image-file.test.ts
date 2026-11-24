import { describe, expect, it } from "vitest";
import { inspectListingImage, MAX_LISTING_IMAGE_BYTES } from "./listing-image-file.js";

function png(width: number, height: number) {
  const data = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data);
  data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

function webp(width: number, height: number) {
  const data = Buffer.alloc(30);
  data.write("RIFF", 0, "ascii");
  data.writeUInt32LE(22, 4);
  data.write("WEBPVP8X", 8, "ascii");
  data.writeUIntLE(width - 1, 24, 3);
  data.writeUIntLE(height - 1, 27, 3);
  return data;
}

describe("listing image validation", () => {
  it("reads dimensions from valid PNG and WebP signatures", () => {
    expect(inspectListingImage(png(640, 480))).toMatchObject({
      mimeType: "image/png",
      width: 640,
      height: 480,
    });
    expect(inspectListingImage(webp(1600, 900))).toMatchObject({
      mimeType: "image/webp",
      width: 1600,
      height: 900,
    });
  });

  it("rejects extension/header spoofing and unsafe pixel counts", () => {
    expect(() => inspectListingImage(Buffer.from("not an image"))).toThrow(
      /JPEG, PNG, or WebP/,
    );
    expect(() => inspectListingImage(png(8000, 8000))).toThrow(/dimensions/);
  });

  it("rejects optimized payloads above two MiB before decoding", () => {
    expect(() => inspectListingImage(Buffer.alloc(MAX_LISTING_IMAGE_BYTES + 1))).toThrow(
      /2 MiB/,
    );
  });
});
