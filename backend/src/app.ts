import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import type { Env } from "./config/env.js";
import type { Logger } from "./config/logger.js";
import { prisma } from "./config/prisma.js";
import { createErrorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import {
  DisabledRecoveryDelivery,
  LocalFileRecoveryDelivery,
  type RecoveryDelivery,
} from "./modules/auth/recovery-delivery.js";
import { createApiRouter } from "./routes/index.js";
import {
  DisabledSupplierInvitationDelivery,
  LocalFileSupplierInvitationDelivery,
  type SupplierInvitationDelivery,
} from "./modules/suppliers/supplier-invitation-delivery.js";
import {
  DisabledRequestAttachmentStorage,
  LocalRequestAttachmentStorage,
  type RequestAttachmentStorage,
} from "./modules/requests/attachment-storage.js";
import {
  SystemMatchingClock,
  type MatchingClock,
} from "./modules/matching/matching-clock.js";
import { S3RequestAttachmentStorage } from "./modules/requests/s3-attachment-storage.js";
import { SesTransactionalEmailDelivery } from "./modules/auth/ses-email-delivery.js";
import { BrevoTransactionalEmailDelivery } from "./modules/auth/brevo-email-delivery.js";
import {
  DisabledListingImageStorage,
  LocalListingImageStorage,
  type ListingImageStorage,
} from "./modules/inventory/listing-image-storage.js";
import { S3ListingImageStorage } from "./modules/inventory/s3-listing-image-storage.js";

const BODY_LIMIT = "1mb";

export function createApp(
  env: Env,
  logger: Logger,
  options: {
    recoveryDelivery?: RecoveryDelivery;
    supplierInvitationDelivery?: SupplierInvitationDelivery;
    requestAttachmentStorage?: RequestAttachmentStorage;
    matchingClock?: MatchingClock;
    listingImageStorage?: ListingImageStorage;
  } = {},
) {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY_HOPS === 0 ? false : env.TRUST_PROXY_HOPS);

  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(
    cors({
      origin: env.CLIENT_ORIGINS,
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(
    pinoHttp({
      logger,
      customProps: (req) => ({
        requestId: req.requestId,
      }),
      customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url,
          };
        },
      },
    }),
  );
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

  app.get("/", (req, res) => {
    res.json({
      success: true,
      data: {
        service: "partsarc-backend",
        message: "API is running. Use the versioned health endpoint.",
        health: `${env.API_PREFIX}/health`,
      },
      requestId: req.requestId,
    });
  });

  const productionEmail =
    env.EMAIL_DELIVERY_PROVIDER === "ses"
      ? new SesTransactionalEmailDelivery(env.SES_FROM_EMAIL!)
      : env.EMAIL_DELIVERY_PROVIDER === "brevo"
        ? new BrevoTransactionalEmailDelivery(
            env.BREVO_API_KEY!,
            env.BREVO_FROM_EMAIL!,
            env.BREVO_FROM_NAME,
          )
        : null;
  const recoveryDelivery =
    options.recoveryDelivery ??
    productionEmail ??
    (env.EMAIL_DELIVERY_PROVIDER === "local"
      ? new LocalFileRecoveryDelivery(env.RECOVERY_OUTBOX_DIR)
      : new DisabledRecoveryDelivery());
  const supplierInvitationDelivery =
    options.supplierInvitationDelivery ??
    productionEmail ??
    (env.EMAIL_DELIVERY_PROVIDER === "local"
      ? new LocalFileSupplierInvitationDelivery(env.RECOVERY_OUTBOX_DIR)
      : new DisabledSupplierInvitationDelivery());
  const requestAttachmentStorage =
    options.requestAttachmentStorage ??
    (env.ATTACHMENT_STORAGE_PROVIDER === "s3"
      ? new S3RequestAttachmentStorage(env.S3_PRIVATE_BUCKET!, env.S3_ATTACHMENT_PREFIX)
      : env.ATTACHMENT_STORAGE_PROVIDER === "local"
        ? new LocalRequestAttachmentStorage(env.REQUEST_ATTACHMENT_DIR)
        : new DisabledRequestAttachmentStorage());
  const listingImageStorage =
    options.listingImageStorage ??
    (env.ATTACHMENT_STORAGE_PROVIDER === "s3"
      ? new S3ListingImageStorage(env.S3_PRIVATE_BUCKET!, env.S3_LISTING_IMAGE_PREFIX)
      : env.ATTACHMENT_STORAGE_PROVIDER === "local"
        ? new LocalListingImageStorage(`${env.REQUEST_ATTACHMENT_DIR}-listing-images`)
        : new DisabledListingImageStorage());
  app.use(
    env.API_PREFIX,
    createApiRouter(
      prisma,
      env,
      recoveryDelivery,
      supplierInvitationDelivery,
      requestAttachmentStorage,
      listingImageStorage,
      options.matchingClock ?? new SystemMatchingClock(),
    ),
  );
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
