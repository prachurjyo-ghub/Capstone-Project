import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { AppError } from "../../shared/errors/app-error.js";
import type { RequestAttachmentStorage, StoredAttachment } from "./attachment-storage.js";

type S3Port = Pick<S3Client, "send">;

function createS3Client(): S3Client {
  const endpoint = process.env.AWS_ENDPOINT_URL_S3?.trim();
  return new S3Client({
    endpoint: endpoint || undefined,
    // Neon Object Storage and other S3-compatible providers address objects as
    // <endpoint>/<bucket>/<key>. Native AWS S3 continues to use its defaults.
    forcePathStyle: Boolean(endpoint),
  });
}

export class S3RequestAttachmentStorage implements RequestAttachmentStorage {
  constructor(
    private readonly bucket: string,
    private readonly prefix: string,
    private readonly client: S3Port = createS3Client(),
  ) {}

  private key(storageKey: string) {
    if (!/^[0-9a-f-]{36}\.(?:jpg|png)$/i.test(storageKey)) {
      throw new AppError("Request attachment storage is unavailable", {
        code: "ATTACHMENT_STORAGE_UNAVAILABLE",
        statusCode: 503,
      });
    }
    return `${this.prefix.replace(/^\/+|\/+$/g, "")}/${storageKey}`;
  }

  async put(file: StoredAttachment) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(file.storageKey),
        Body: file.data,
        ContentType: file.storageKey.endsWith(".png") ? "image/png" : "image/jpeg",
        // Custom S3-compatible providers define encryption at the bucket/provider
        // layer. AWS S3 receives an explicit server-side encryption request.
        ...(process.env.AWS_ENDPOINT_URL_S3
          ? {}
          : { ServerSideEncryption: "AES256" as const }),
      }),
    );
  }

  async read(storageKey: string) {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.key(storageKey) }),
    );
    if (!result.Body)
      throw new AppError("Attachment was not found", {
        code: "ATTACHMENT_NOT_FOUND",
        statusCode: 404,
      });
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async open(storageKey: string) {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.key(storageKey) }),
    );
    if (!result.Body)
      throw new AppError("Attachment was not found", {
        code: "ATTACHMENT_NOT_FOUND",
        statusCode: 404,
      });
    const body = result.Body as unknown as {
      pipe?: unknown;
      transformToWebStream: () => ReadableStream<Uint8Array>;
    };
    const stream =
      body instanceof Readable
        ? body
        : Readable.fromWeb(body.transformToWebStream() as never);
    return { stream, contentLength: result.ContentLength };
  }

  async delete(storageKey: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(storageKey) }),
    );
  }
}
