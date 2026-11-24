import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
    API_PREFIX: z
      .string()
      .min(1)
      .default("/api/v1")
      .transform((value) => (value.startsWith("/") ? value : `/${value}`))
      .refine((value) => !value.endsWith("/") || value === "/", {
        message: "API_PREFIX should not end with a trailing slash unless it is '/'",
      }),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    CLIENT_ORIGINS: z
      .string()
      .min(1, "CLIENT_ORIGINS is required")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .refine((origins) => origins.length > 0, {
        message: "CLIENT_ORIGINS must include at least one origin",
      }),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    ACCESS_TOKEN_SECRET: z
      .string()
      .min(32, "ACCESS_TOKEN_SECRET must be at least 32 characters"),
    TOKEN_HASH_SECRET: z
      .string()
      .min(32, "TOKEN_HASH_SECRET must be at least 32 characters"),
    JWT_ISSUER: z.string().min(1).default("partsarc-api"),
    JWT_AUDIENCE: z.string().min(1).default("partsarc-frontends"),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
    SUPPLIER_INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(72),
    SUPPLIER_INVITATION_URL_BASE: z.string().url(),
    REFRESH_COOKIE_NAME: z.string().min(1).default("partsarc_refresh"),
    CSRF_COOKIE_NAME: z.string().min(1).default("partsarc_csrf"),
    COOKIE_SECURE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    COOKIE_SAME_SITE: z.enum(["strict", "lax", "none"]).default("lax"),
    COOKIE_DOMAIN: z
      .string()
      .trim()
      .optional()
      .transform((value) => value || undefined),
    PASSWORD_RESET_URL_BASE: z.string().url(),
    RECOVERY_OUTBOX_DIR: z.string().min(1).default(".local/recovery-outbox"),
    REQUEST_ATTACHMENT_DIR: z.string().min(1).default(".local/request-attachments"),
    NOTIFICATION_OUTBOX_DIR: z.string().min(1).default(".local/notification-outbox"),
    NOTIFICATION_EMAIL_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    NOTIFICATION_SMS_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    REDIS_URL: z
      .string()
      .url()
      .optional()
      .transform((value) => value || undefined),
    REDIS_KEY_PREFIX: z.string().min(3).default("partsarc:dev"),
    CATALOGUE_CACHE_TTL_SECONDS: z.coerce.number().int().min(10).max(3600).default(120),
    CATALOGUE_LOCAL_CACHE_MAX_ENTRIES: z.coerce
      .number()
      .int()
      .min(10)
      .max(5000)
      .default(200),
    CATALOGUE_GENERATION_CACHE_SECONDS: z.coerce.number().int().min(1).max(30).default(5),
    JOB_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
    WORKER_HEARTBEAT_TTL_SECONDS: z.coerce.number().int().min(30).max(300).default(90),
    WORKER_HEARTBEAT_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .min(10)
      .max(120)
      .default(30),
    RATE_LIMIT_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    AUTH_RATE_LIMIT_STORE: z.enum(["memory", "redis"]).default("memory"),
    ATTACHMENT_STORAGE_PROVIDER: z.enum(["local", "s3", "disabled"]).default("local"),
    AWS_REGION: z.string().trim().min(1).optional(),
    AWS_ENDPOINT_URL_S3: z.string().url().optional(),
    S3_PRIVATE_BUCKET: z.string().trim().min(3).optional(),
    S3_ATTACHMENT_PREFIX: z.string().trim().default("partsarc/attachments"),
    S3_LISTING_IMAGE_PREFIX: z.string().trim().default("partsarc/listing-images"),
    SUPPLIER_IMAGE_MAX_COUNT: z.coerce.number().int().min(4).max(10_000).default(1_000),
    SUPPLIER_IMAGE_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(8 * 1024 * 1024)
      .max(100 * 1024 * 1024 * 1024)
      .default(1024 * 1024 * 1024),
    LISTING_IMAGE_ORPHAN_GRACE_HOURS: z.coerce.number().int().min(1).max(720).default(24),
    LISTING_IMAGE_RECONCILE_BATCH_SIZE: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000)
      .default(100),
    EMAIL_DELIVERY_PROVIDER: z
      .enum(["local", "ses", "brevo", "disabled"])
      .default("local"),
    SES_FROM_EMAIL: z.string().email().optional(),
    BREVO_API_KEY: z.string().trim().min(20).optional(),
    BREVO_FROM_EMAIL: z.string().email().optional(),
    BREVO_FROM_NAME: z.string().trim().min(1).max(100).default("PartsArc"),
  })
  .superRefine((env, ctx) => {
    if (env.WORKER_HEARTBEAT_INTERVAL_SECONDS * 2 > env.WORKER_HEARTBEAT_TTL_SECONDS) {
      ctx.addIssue({
        code: "custom",
        path: ["WORKER_HEARTBEAT_INTERVAL_SECONDS"],
        message: "Heartbeat interval must be no more than half its TTL",
      });
    }
    if (env.COOKIE_SAME_SITE === "none" && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: "custom",
        path: ["COOKIE_SECURE"],
        message: "COOKIE_SECURE must be true when COOKIE_SAME_SITE is none",
      });
    }

    if (env.NODE_ENV === "production" && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: "custom",
        path: ["COOKIE_SECURE"],
        message: "COOKIE_SECURE must be true in production",
      });
    }
    if (
      env.NODE_ENV === "production" &&
      (env.NOTIFICATION_EMAIL_ENABLED || env.NOTIFICATION_SMS_ENABLED) &&
      !env.REDIS_URL
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["REDIS_URL"],
        message: "REDIS_URL is required for production notification delivery",
      });
    }
    if (env.AUTH_RATE_LIMIT_STORE === "redis" && !env.REDIS_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["REDIS_URL"],
        message: "REDIS_URL is required for Redis authentication rate limiting",
      });
    }
    if (
      env.ATTACHMENT_STORAGE_PROVIDER === "s3" &&
      (!env.AWS_REGION || !env.S3_PRIVATE_BUCKET)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["S3_PRIVATE_BUCKET"],
        message: "AWS_REGION and S3_PRIVATE_BUCKET are required for S3 storage",
      });
    }
    if (
      env.EMAIL_DELIVERY_PROVIDER === "ses" &&
      (!env.AWS_REGION || !env.SES_FROM_EMAIL)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["SES_FROM_EMAIL"],
        message: "AWS_REGION and SES_FROM_EMAIL are required for SES delivery",
      });
    }
    if (
      env.EMAIL_DELIVERY_PROVIDER === "brevo" &&
      (!env.BREVO_API_KEY || !env.BREVO_FROM_EMAIL)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["BREVO_API_KEY"],
        message: "BREVO_API_KEY and BREVO_FROM_EMAIL are required for Brevo delivery",
      });
    }
    if (env.NODE_ENV === "production") {
      if (env.AUTH_RATE_LIMIT_STORE !== "redis")
        ctx.addIssue({
          code: "custom",
          path: ["AUTH_RATE_LIMIT_STORE"],
          message: "Production requires the Redis rate-limit store",
        });
      if (env.ATTACHMENT_STORAGE_PROVIDER !== "s3")
        ctx.addIssue({
          code: "custom",
          path: ["ATTACHMENT_STORAGE_PROVIDER"],
          message: "Production requires durable S3 attachment storage",
        });
      if (!["ses", "brevo"].includes(env.EMAIL_DELIVERY_PROVIDER))
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_DELIVERY_PROVIDER"],
          message: "Production requires SES or Brevo email delivery",
        });
      if (!env.REDIS_URL)
        ctx.addIssue({
          code: "custom",
          path: ["REDIS_URL"],
          message: "Production requires Redis",
        });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | undefined;

export function loadEnv(): Env {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

export function getEnv(): Env {
  if (!cachedEnv) {
    return loadEnv();
  }
  return cachedEnv;
}
