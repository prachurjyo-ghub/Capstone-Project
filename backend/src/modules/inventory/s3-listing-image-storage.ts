import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { AppError } from "../../shared/errors/app-error.js";
import type { ListingImageFile, ListingImageStorage } from "./listing-image-storage.js";

type S3Port = Pick<S3Client, "send">;
function client() {
  const endpoint = process.env.AWS_ENDPOINT_URL_S3?.trim();
  return new S3Client({
    endpoint: endpoint || undefined,
    forcePathStyle: Boolean(endpoint),
  });
}

export class S3ListingImageStorage implements ListingImageStorage {
  constructor(
    private readonly bucket: string,
    private readonly prefix: string,
    private readonly s3: S3Port = client(),
  ) {}
  private key(storageKey: string) {
    if (!/^[0-9a-f-]{36}\.(?:jpe?g|png|webp)$/i.test(storageKey)) {
      throw new AppError("Listing image storage is unavailable", {
        code: "LISTING_IMAGE_STORAGE_UNAVAILABLE",
        statusCode: 503,
      });
    }
    return `${this.prefix.replace(/^\/+|\/+$/g, "")}/${storageKey}`;
  }
  async put(file: ListingImageFile) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(file.storageKey),
        Body: file.data,
        ContentType: file.mimeType,
        CacheControl: "public, max-age=31536000, immutable",
        ...(process.env.AWS_ENDPOINT_URL_S3
          ? {}
          : { ServerSideEncryption: "AES256" as const }),
      }),
    );
  }
  async open(storageKey: string) {
    let result;
    try {
      result = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(storageKey) }),
      );
    } catch (error) {
      const storageError = error as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      if (
        storageError.name === "NoSuchKey" ||
        storageError.$metadata?.httpStatusCode === 404
      )
        throw new AppError("Listing image was not found", {
          code: "LISTING_IMAGE_NOT_FOUND",
          statusCode: 404,
        });
      throw error;
    }
    if (!result.Body)
      throw new AppError("Listing image was not found", {
        code: "LISTING_IMAGE_NOT_FOUND",
        statusCode: 404,
      });
    const body = result.Body as unknown as {
      transformToWebStream: () => ReadableStream<Uint8Array>;
    };
    return {
      stream:
        body instanceof Readable
          ? body
          : Readable.fromWeb(body.transformToWebStream() as never),
      contentLength: result.ContentLength,
    };
  }
  async delete(storageKey: string) {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(storageKey) }),
    );
  }

  async list(cursor: string | undefined, limit: number) {
    const normalizedPrefix = `${this.prefix.replace(/^\/+|\/+$/g, "")}/`;
    const result = await this.s3.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: normalizedPrefix,
        ContinuationToken: cursor,
        MaxKeys: limit,
      }),
    );
    return {
      objects: (result.Contents ?? []).flatMap((object) => {
        if (
          !object.Key ||
          !object.LastModified ||
          !object.Key.startsWith(normalizedPrefix)
        )
          return [];
        const storageKey = object.Key.slice(normalizedPrefix.length);
        return /^[0-9a-f-]{36}\.(?:jpe?g|png|webp)$/i.test(storageKey)
          ? [{ storageKey, lastModified: object.LastModified }]
          : [];
      }),
      ...(result.IsTruncated && result.NextContinuationToken
        ? { nextCursor: result.NextContinuationToken }
        : {}),
    };
  }
}
