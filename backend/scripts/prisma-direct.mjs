import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";

const command = process.argv[2];
if (!new Set(["deploy", "status"]).has(command)) {
  process.stderr.write("Usage: prisma-direct.mjs <deploy|status>\n");
  process.exit(2);
}

const directUrl = process.env.DATABASE_URL_UNPOOLED?.trim();
if (!directUrl) {
  process.stderr.write(
    "DATABASE_URL_UNPOOLED is required for Prisma migration commands.\n",
  );
  process.exit(2);
}

let parsed;
try {
  parsed = new URL(directUrl);
} catch {
  process.stderr.write(
    "DATABASE_URL_UNPOOLED must be a valid PostgreSQL connection URL.\n",
  );
  process.exit(2);
}
if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
  process.stderr.write("DATABASE_URL_UNPOOLED must use the PostgreSQL protocol.\n");
  process.exit(2);
}
if (parsed.hostname.includes("-pooler")) {
  process.stderr.write("DATABASE_URL_UNPOOLED must not use a pooled Neon hostname.\n");
  process.exit(2);
}

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prismaCli = path.join(backendRoot, "node_modules/prisma/build/index.js");
const schema = path.join(backendRoot, "prisma/schema.prisma");
const child = spawn(
  process.execPath,
  [prismaCli, "migrate", command, "--schema", schema],
  {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: directUrl },
  },
);
child.on("error", (error) => {
  process.stderr.write(`Could not start Prisma migration command: ${error.message}\n`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.stderr.write(`Prisma migration command ended from signal ${signal}.\n`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
