import { config } from "dotenv";

config();

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL is required for database-backed tests");
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.COOKIE_SECURE = "false";
process.env.COOKIE_SAME_SITE = "lax";
