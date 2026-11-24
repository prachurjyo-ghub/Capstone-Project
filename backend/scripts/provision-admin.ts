import { AccountStatus, UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma.js";
import { hashPassword } from "../src/modules/auth/password.js";

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const fullName = process.env.ADMIN_NAME?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !fullName || !password)
    throw new Error(
      "ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD must be supplied through the process environment",
    );
  if (
    password.length < 12 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password)
  )
    throw new Error(
      "ADMIN_PASSWORD must contain 12+ characters with uppercase, lowercase and a number",
    );
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing)
    throw new Error("An account with ADMIN_EMAIL already exists; no changes were made");
  const user = await prisma.user.create({
    data: {
      email,
      fullName,
      passwordHash: await hashPassword(password),
      role: UserRole.SUPER_ADMIN,
      accountStatus: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
    select: { id: true, email: true, role: true },
  });
  process.stdout.write(JSON.stringify(user) + "\n");
}

void main().finally(() => prisma.$disconnect());
