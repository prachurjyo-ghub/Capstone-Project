import { afterEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { S3RequestAttachmentStorage } from "../src/modules/requests/s3-attachment-storage.js";
import { SesTransactionalEmailDelivery } from "../src/modules/auth/ses-email-delivery.js";
import { BrevoTransactionalEmailDelivery } from "../src/modules/auth/brevo-email-delivery.js";

describe("production adapter contracts", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("stores private attachments with encryption and reads/deletes by generated key", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
      })
      .mockResolvedValueOnce({});
    const storage = new S3RequestAttachmentStorage(
      "private-bucket",
      "tenant/attachments",
      { send } as never,
    );
    const key = "123e4567-e89b-12d3-a456-426614174000.jpg";
    await storage.put({ storageKey: key, data: Buffer.from([1, 2, 3]) });
    expect(send.mock.calls[0]![0].input).toMatchObject({
      Bucket: "private-bucket",
      Key: "tenant/attachments/" + key,
      ServerSideEncryption: "AES256",
    });
    await expect(storage.read(key)).resolves.toEqual(Buffer.from([1, 2, 3]));
    await storage.delete(key);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("uses provider-managed encryption headers for S3-compatible endpoints", async () => {
    vi.stubEnv("AWS_ENDPOINT_URL_S3", "https://storage.example.test");
    const send = vi.fn().mockResolvedValue({});
    const storage = new S3RequestAttachmentStorage("private-bucket", "attachments", {
      send,
    } as never);
    await storage.put({
      storageKey: "123e4567-e89b-12d3-a456-426614174000.png",
      data: Buffer.from([1, 2, 3]),
    });
    expect(send.mock.calls[0]![0].input).toMatchObject({
      Bucket: "private-bucket",
      ContentType: "image/png",
    });
    expect(send.mock.calls[0]![0].input).not.toHaveProperty("ServerSideEncryption");
  });

  it("opens S3 attachment bodies as streams without buffering", async () => {
    const send = vi.fn().mockResolvedValue({
      Body: Readable.from([Buffer.from([1, 2]), Buffer.from([3])]),
      ContentLength: 3,
    });
    const storage = new S3RequestAttachmentStorage("private-bucket", "attachments", {
      send,
    } as never);
    const opened = await storage.open("123e4567-e89b-12d3-a456-426614174000.jpg");
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3]));
    expect(opened.contentLength).toBe(3);
  });

  it("rejects unsafe object keys before contacting storage", async () => {
    const send = vi.fn();
    const storage = new S3RequestAttachmentStorage("private-bucket", "attachments", {
      send,
    } as never);
    await expect(storage.read("../secret")).rejects.toMatchObject({
      code: "ATTACHMENT_STORAGE_UNAVAILABLE",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("delivers recovery and invitation links through SES", async () => {
    const send = vi.fn().mockResolvedValue({});
    const delivery = new SesTransactionalEmailDelivery("no-reply@example.com", {
      send,
    } as never);
    await delivery.deliverPasswordRecovery({
      recipient: "customer@example.com",
      resetUrl: "https://customer.example/reset-password?token=secret",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    });
    await delivery.deliverSupplierInvitation({
      recipient: "owner@example.com",
      businessName: "Example Parts",
      activationUrl: "https://supplier.example/accept-invitation?token=secret",
      expiresAt: new Date("2030-01-02T00:00:00Z"),
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0].input.Destination.ToAddresses).toEqual([
      "customer@example.com",
    ]);
    expect(send.mock.calls[1]![0].input.Destination.ToAddresses).toEqual([
      "owner@example.com",
    ]);
  });

  it("delivers recovery and invitation links through Brevo without exposing the API key", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    const delivery = new BrevoTransactionalEmailDelivery(
      "xkeysib-private-value",
      "no-reply@example.com",
      "PartsArc",
      request as never,
    );
    await delivery.deliverPasswordRecovery({
      recipient: "customer@example.com",
      resetUrl: "https://customer.example/reset-password?token=secret",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    });
    await delivery.deliverSupplierInvitation({
      recipient: "owner@example.com",
      businessName: "Example Parts",
      activationUrl: "https://supplier.example/accept-invitation?token=secret",
      expiresAt: new Date("2030-01-02T00:00:00Z"),
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]![0]).toBe("https://api.brevo.com/v3/smtp/email");
    const first = request.mock.calls[0]![1];
    expect(first.headers["api-key"]).toBe("xkeysib-private-value");
    expect(JSON.parse(first.body)).toMatchObject({
      sender: { email: "no-reply@example.com", name: "PartsArc" },
      to: [{ email: "customer@example.com" }],
      subject: "Reset your PartsArc password",
    });
  });
});
