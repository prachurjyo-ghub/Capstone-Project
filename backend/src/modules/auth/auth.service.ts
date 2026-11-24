import { randomUUID, timingSafeEqual } from "node:crypto";
import { AccountStatus, Prisma, type PrismaClient, UserRole } from "@prisma/client";
import type { Env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import type {
  ForgotPasswordInput,
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from "./auth.schemas.js";
import { recordAuthAudit } from "./audit.service.js";
import { hashPassword, verifyPassword } from "./password.js";
import type { RecoveryDelivery } from "./recovery-delivery.js";
import { createOpaqueToken, hashOpaqueToken, signAccessToken } from "./token.service.js";
import { hasCurrentSupplierEntitlement } from "../subscriptions/subscription-access.js";

export type RequestMetadata = {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
};

type SessionMaterial = {
  sessionId: string;
  familyId: string;
  refreshToken: string;
  refreshTokenHash: string;
  csrfToken: string;
  csrfTokenHash: string;
  expiresAt: Date;
};

type SessionResponse = {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  csrfToken: string;
  account: SafeAccount;
};

export type SafeAccount = {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  role: UserRole;
  accountStatus: AccountStatus;
  mustChangePassword: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: Date;
  customerProfile: {
    fullName: string;
    preferredName: string | null;
    companyName: string | null;
  } | null;
  supplierMemberships: Array<{
    id: string;
    title: string | null;
    isPrimary: boolean;
    isActive: boolean;
    business: {
      id: string;
      businessCode: string | null;
      displayName: string;
      status: string;
      subscriptionGraceEndsAt: Date | null;
      entitlementEndsAt: Date | null;
      entitlementSource: "SUBSCRIPTION" | "MIGRATION_GRACE" | null;
    };
  }>;
};

type AccountRecord = Awaited<ReturnType<AuthService["findSafeAccount"]>>;

function isRestricted(status: AccountStatus): boolean {
  return status === AccountStatus.SUSPENDED || status === AccountStatus.DISABLED;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export class AuthService {
  constructor(
    private readonly database: PrismaClient,
    private readonly env: Env,
    private readonly recoveryDelivery: RecoveryDelivery,
  ) {}

  private createSessionMaterial(familyId = randomUUID()): SessionMaterial {
    const refreshToken = createOpaqueToken();
    const csrfToken = createOpaqueToken(32);
    return {
      sessionId: randomUUID(),
      familyId,
      refreshToken,
      refreshTokenHash: hashOpaqueToken(refreshToken, this.env),
      csrfToken,
      csrfTokenHash: hashOpaqueToken(csrfToken, this.env),
      expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    };
  }

  private async buildSessionResponse(
    account: NonNullable<AccountRecord>,
    session: SessionMaterial,
  ): Promise<SessionResponse> {
    return {
      accessToken: await signAccessToken(
        { userId: account.id, sessionId: session.sessionId, role: account.role },
        this.env,
      ),
      accessTokenExpiresIn: this.env.ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: session.refreshToken,
      csrfToken: session.csrfToken,
      account: this.serializeAccount(account),
    };
  }

  private sessionCreateData(
    userId: string,
    session: SessionMaterial,
    meta: RequestMetadata,
  ) {
    return {
      id: session.sessionId,
      userId,
      familyId: session.familyId,
      tokenHash: session.refreshTokenHash,
      csrfTokenHash: session.csrfTokenHash,
      userAgent: meta.userAgent?.slice(0, 500),
      ipAddress: meta.ipAddress?.slice(0, 64),
      expiresAt: session.expiresAt,
    };
  }

  private serializeAccount(account: NonNullable<AccountRecord>): SafeAccount {
    return {
      id: account.id,
      email: account.email,
      fullName: account.fullName,
      phone: account.phone,
      role: account.role,
      accountStatus: account.accountStatus,
      mustChangePassword: account.mustChangePassword,
      emailVerified: account.emailVerifiedAt !== null,
      phoneVerified: account.phoneVerifiedAt !== null,
      createdAt: account.createdAt,
      customerProfile: account.customerProfile,
      supplierMemberships: account.supplierMemberships.map((membership) => ({
        id: membership.id,
        title: membership.title,
        isPrimary: membership.isPrimary,
        isActive: membership.isActive,
        business: {
          id: membership.business.id,
          businessCode: membership.business.businessCode,
          displayName: membership.business.displayName,
          status: membership.business.status,
          subscriptionGraceEndsAt: membership.business.subscriptionGraceEndsAt,
          entitlementEndsAt:
            membership.business.subscriptions[0]?.endsAt ??
            membership.business.subscriptionGraceEndsAt,
          entitlementSource: membership.business.subscriptions[0]
            ? "SUBSCRIPTION"
            : membership.business.subscriptionGraceEndsAt &&
                membership.business.subscriptionGraceEndsAt > new Date()
              ? "MIGRATION_GRACE"
              : null,
        },
      })),
    };
  }

  async findSafeAccount(userId: string) {
    return this.database.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        accountStatus: true,
        mustChangePassword: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        createdAt: true,
        customerProfile: {
          select: { fullName: true, preferredName: true, companyName: true },
        },
        supplierMemberships: {
          select: {
            id: true,
            title: true,
            isPrimary: true,
            isActive: true,
            business: {
              select: {
                id: true,
                businessCode: true,
                displayName: true,
                status: true,
                subscriptionGraceEndsAt: true,
                subscriptions: {
                  where: {
                    status: { in: ["ACTIVE", "SCHEDULED"] },
                    startsAt: { lte: new Date() },
                    endsAt: { gt: new Date() },
                  },
                  select: { endsAt: true },
                  orderBy: { endsAt: "desc" },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
  }

  async register(input: RegisterInput, meta: RequestMetadata): Promise<SessionResponse> {
    const passwordHash = await hashPassword(input.password);
    const session = this.createSessionMaterial();

    try {
      const account = await this.database.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email,
            fullName: input.fullName,
            phone: input.phone,
            passwordHash,
            role: UserRole.CUSTOMER,
            accountStatus: AccountStatus.PENDING_VERIFICATION,
            customerProfile: {
              create: {
                fullName: input.fullName,
                preferredName: input.preferredName,
              },
            },
          },
        });

        await tx.refreshSession.create({
          data: this.sessionCreateData(user.id, session, meta),
        });
        await recordAuthAudit(tx, {
          actorUserId: user.id,
          entityId: user.id,
          action: "AUTH_REGISTERED",
          requestId: meta.requestId,
          metadata: { role: UserRole.CUSTOMER },
        });
        return user;
      });

      const safeAccount = await this.findSafeAccount(account.id);
      if (!safeAccount) throw new Error("Created account was not found");
      return this.buildSessionResponse(safeAccount, session);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError("An account with this email already exists", {
          code: "EMAIL_ALREADY_REGISTERED",
          statusCode: 409,
        });
      }
      throw error;
    }
  }

  async login(input: LoginInput, meta: RequestMetadata): Promise<SessionResponse> {
    const credential = await this.database.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        passwordHash: true,
        accountStatus: true,
        role: true,
        mustChangePassword: true,
      },
    });
    const valid = await verifyPassword(credential?.passwordHash, input.password);

    if (!credential || !valid) {
      await recordAuthAudit(this.database, {
        action: "AUTH_LOGIN_FAILED",
        requestId: meta.requestId,
        metadata: { reason: "invalid_credentials" },
      });
      throw new AppError("Invalid email or password", {
        code: "INVALID_CREDENTIALS",
        statusCode: 401,
      });
    }

    if (isRestricted(credential.accountStatus)) {
      await recordAuthAudit(this.database, {
        actorUserId: credential.id,
        entityId: credential.id,
        action: "AUTH_ACCESS_RESTRICTED",
        requestId: meta.requestId,
        metadata: { accountStatus: credential.accountStatus },
      });
      throw new AppError("Account access is restricted", {
        code: "ACCOUNT_RESTRICTED",
        statusCode: 403,
      });
    }

    if (
      (credential.role === UserRole.SUPPLIER_OWNER ||
        credential.role === UserRole.SUPPLIER_STAFF) &&
      !credential.mustChangePassword
    ) {
      await this.assertSupplierHasEligibleBusiness(credential.id);
    }

    const session = this.createSessionMaterial();
    await this.database.$transaction(async (tx) => {
      await tx.refreshSession.create({
        data: this.sessionCreateData(credential.id, session, meta),
      });
      await tx.user.update({
        where: { id: credential.id },
        data: { lastLoginAt: new Date() },
      });
      await recordAuthAudit(tx, {
        actorUserId: credential.id,
        entityId: credential.id,
        action: "AUTH_LOGIN_SUCCEEDED",
        requestId: meta.requestId,
      });
    });

    const account = await this.findSafeAccount(credential.id);
    if (!account) throw new Error("Authenticated account was not found");
    return this.buildSessionResponse(account, session);
  }

  async refresh(
    rawRefreshToken: string,
    rawCsrfToken: string,
    meta: RequestMetadata,
  ): Promise<SessionResponse> {
    const now = new Date();
    const tokenHash = hashOpaqueToken(rawRefreshToken, this.env);
    const csrfHash = hashOpaqueToken(rawCsrfToken, this.env);
    const replacement = this.createSessionMaterial();

    const outcome = await this.database.$transaction(async (tx) => {
      const current = await tx.refreshSession.findUnique({
        where: { tokenHash },
        include: {
          user: {
            select: {
              accountStatus: true,
              role: true,
              mustChangePassword: true,
            },
          },
        },
      });

      if (!current) return { type: "invalid" } as const;

      if (current.revokedAt || current.replacedByTokenHash) {
        await tx.refreshSession.updateMany({
          where: { familyId: current.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        await recordAuthAudit(tx, {
          actorUserId: current.userId,
          entityId: current.userId,
          action: "AUTH_REFRESH_REPLAY_DETECTED",
          requestId: meta.requestId,
          metadata: { sessionFamilyId: current.familyId },
        });
        return { type: "replay" } as const;
      }

      if (!safeEqual(current.csrfTokenHash, csrfHash)) {
        await tx.refreshSession.updateMany({
          where: { familyId: current.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        await recordAuthAudit(tx, {
          actorUserId: current.userId,
          entityId: current.userId,
          action: "AUTH_REFRESH_CSRF_REJECTED",
          requestId: meta.requestId,
        });
        return { type: "invalid" } as const;
      }

      if (current.expiresAt <= now) {
        await tx.refreshSession.update({
          where: { id: current.id },
          data: { revokedAt: now },
        });
        return { type: "invalid" } as const;
      }

      if (isRestricted(current.user.accountStatus)) {
        await tx.refreshSession.updateMany({
          where: { userId: current.userId, revokedAt: null },
          data: { revokedAt: now },
        });
        await recordAuthAudit(tx, {
          actorUserId: current.userId,
          entityId: current.userId,
          action: "AUTH_ACCESS_RESTRICTED",
          requestId: meta.requestId,
          metadata: { accountStatus: current.user.accountStatus },
        });
        return { type: "restricted" } as const;
      }

      if (
        (current.user.role === UserRole.SUPPLIER_OWNER ||
          current.user.role === UserRole.SUPPLIER_STAFF) &&
        !current.user.mustChangePassword
      ) {
        const memberships = await tx.supplierUser.findMany({
          where: {
            userId: current.userId,
            isActive: true,
            leftAt: null,
            business: { status: "ACTIVE" },
          },
          select: { businessId: true },
        });
        let eligible = false;
        for (const membership of memberships) {
          if (await hasCurrentSupplierEntitlement(tx, membership.businessId, now)) {
            eligible = true;
            break;
          }
        }
        if (!eligible) {
          await tx.refreshSession.updateMany({
            where: { userId: current.userId, revokedAt: null },
            data: { revokedAt: now },
          });
          return { type: "subscription_restricted" } as const;
        }
      }

      const claimed = await tx.refreshSession.updateMany({
        where: { id: current.id, revokedAt: null, replacedByTokenHash: null },
        data: { revokedAt: now, replacedByTokenHash: replacement.refreshTokenHash },
      });

      if (claimed.count !== 1) {
        await tx.refreshSession.updateMany({
          where: { familyId: current.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        return { type: "replay" } as const;
      }

      replacement.familyId = current.familyId;
      replacement.expiresAt = current.expiresAt;
      await tx.refreshSession.create({
        data: this.sessionCreateData(current.userId, replacement, meta),
      });
      await recordAuthAudit(tx, {
        actorUserId: current.userId,
        entityId: current.userId,
        action: "AUTH_REFRESH_ROTATED",
        requestId: meta.requestId,
        metadata: { sessionFamilyId: current.familyId },
      });
      return { type: "success", userId: current.userId } as const;
    });

    if (outcome.type === "restricted") {
      throw new AppError("Account access is restricted", {
        code: "ACCOUNT_RESTRICTED",
        statusCode: 403,
      });
    }
    if (outcome.type === "subscription_restricted") {
      throw new AppError(
        "Supplier subscription is expired or inactive. Contact PartsArc operations.",
        { code: "SUPPLIER_SUBSCRIPTION_REQUIRED", statusCode: 403 },
      );
    }
    if (outcome.type === "replay") {
      throw new AppError("Refresh token reuse was detected", {
        code: "REFRESH_TOKEN_REUSE_DETECTED",
        statusCode: 401,
      });
    }
    if (outcome.type === "invalid") {
      throw new AppError("Refresh session is invalid or expired", {
        code: "INVALID_REFRESH_SESSION",
        statusCode: 401,
      });
    }

    const account = await this.findSafeAccount(outcome.userId);
    if (!account)
      throw new AppError("Refresh session is invalid or expired", {
        code: "INVALID_REFRESH_SESSION",
        statusCode: 401,
      });
    return this.buildSessionResponse(account, replacement);
  }

  async logoutCurrent(
    userId: string,
    familyId: string,
    requestId: string,
  ): Promise<void> {
    const now = new Date();
    await this.database.$transaction(async (tx) => {
      await tx.refreshSession.updateMany({
        where: { userId, familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      await recordAuthAudit(tx, {
        actorUserId: userId,
        entityId: userId,
        action: "AUTH_LOGOUT_CURRENT",
        requestId,
        metadata: { sessionFamilyId: familyId },
      });
    });
  }

  async logoutAll(userId: string, requestId: string): Promise<void> {
    const now = new Date();
    await this.database.$transaction(async (tx) => {
      await tx.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await recordAuthAudit(tx, {
        actorUserId: userId,
        entityId: userId,
        action: "AUTH_LOGOUT_ALL",
        requestId,
      });
    });
  }

  async getMe(userId: string): Promise<SafeAccount> {
    const account = await this.findSafeAccount(userId);
    if (!account) {
      throw new AppError("Authentication is required", {
        code: "AUTHENTICATION_REQUIRED",
        statusCode: 401,
      });
    }
    return this.serializeAccount(account);
  }

  async forgotPassword(input: ForgotPasswordInput, meta: RequestMetadata): Promise<void> {
    const account = await this.database.user.findUnique({
      where: { email: input.email },
      select: { id: true, email: true },
    });
    if (!account) {
      await recordAuthAudit(this.database, {
        action: "AUTH_PASSWORD_RESET_REQUESTED",
        requestId: meta.requestId,
        metadata: { accountMatched: false },
      });
      return;
    }

    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + this.env.PASSWORD_RESET_TTL_MINUTES * 60_000);
    await this.database.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: account.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.passwordResetToken.create({
        data: {
          userId: account.id,
          tokenHash: hashOpaqueToken(token, this.env),
          expiresAt,
        },
      });
      await recordAuthAudit(tx, {
        actorUserId: account.id,
        entityId: account.id,
        action: "AUTH_PASSWORD_RESET_REQUESTED",
        requestId: meta.requestId,
        metadata: { accountMatched: true },
      });
    });

    const resetUrl = new URL(this.env.PASSWORD_RESET_URL_BASE);
    resetUrl.searchParams.set("token", token);
    try {
      await this.recoveryDelivery.deliverPasswordRecovery({
        recipient: account.email,
        resetUrl: resetUrl.toString(),
        expiresAt,
      });
    } catch {
      // Preserve the same public status/body for matched and unmatched accounts.
      await recordAuthAudit(this.database, {
        actorUserId: account.id,
        entityId: account.id,
        action: "AUTH_PASSWORD_RESET_DELIVERY_FAILED",
        requestId: meta.requestId,
      });
    }
  }

  async resetPassword(input: ResetPasswordInput, meta: RequestMetadata): Promise<void> {
    const tokenHash = hashOpaqueToken(input.token, this.env);
    const newPasswordHash = await hashPassword(input.newPassword);
    const now = new Date();

    const outcome = await this.database.$transaction(async (tx) => {
      const resetToken = await tx.passwordResetToken.findUnique({ where: { tokenHash } });
      if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= now) return false;

      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: resetToken.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) return false;

      await tx.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash: newPasswordHash,
          mustChangePassword: false,
          passwordChangedAt: now,
        },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: resetToken.userId, usedAt: null },
        data: { usedAt: now },
      });
      await tx.refreshSession.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await recordAuthAudit(tx, {
        actorUserId: resetToken.userId,
        entityId: resetToken.userId,
        action: "AUTH_PASSWORD_RESET_COMPLETED",
        requestId: meta.requestId,
      });
      return true;
    });

    if (!outcome) {
      throw new AppError("Password reset token is invalid or expired", {
        code: "INVALID_PASSWORD_RESET_TOKEN",
        statusCode: 400,
      });
    }
  }

  private async assertSupplierHasEligibleBusiness(userId: string): Promise<void> {
    const memberships = await this.database.supplierUser.findMany({
      where: {
        userId,
        isActive: true,
        leftAt: null,
      },
      select: { businessId: true, business: { select: { status: true } } },
    });
    for (const membership of memberships.filter(
      (item) => item.business.status === "ACTIVE",
    )) {
      if (await hasCurrentSupplierEntitlement(this.database, membership.businessId))
        return;
    }
    if (memberships.some((item) => item.business.status === "SUSPENDED")) {
      throw new AppError("Supplier business is suspended. Contact PartsArc operations.", {
        code: "SUPPLIER_BUSINESS_SUSPENDED",
        statusCode: 403,
      });
    }
    if (!memberships.some((item) => item.business.status === "ACTIVE")) {
      throw new AppError("Active supplier membership is required", {
        code: "SUPPLIER_ACCESS_RESTRICTED",
        statusCode: 403,
      });
    }
    throw new AppError(
      "Supplier subscription is expired or inactive. Contact PartsArc operations.",
      { code: "SUPPLIER_SUBSCRIPTION_REQUIRED", statusCode: 403 },
    );
  }

  async changePassword(
    userId: string,
    sessionFamilyId: string,
    input: ChangePasswordInput,
    requestId: string,
  ) {
    const current = await this.database.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (
      !current ||
      !(await verifyPassword(current.passwordHash, input.currentPassword))
    ) {
      throw new AppError("Current password is invalid", {
        code: "INVALID_CURRENT_PASSWORD",
        statusCode: 400,
      });
    }
    const passwordHash = await hashPassword(input.newPassword);
    const now = new Date();
    await this.database.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: now },
      });
      await tx.refreshSession.updateMany({
        where: { userId, familyId: { not: sessionFamilyId }, revokedAt: null },
        data: { revokedAt: now },
      });
      await recordAuthAudit(tx, {
        actorUserId: userId,
        entityId: userId,
        action: "AUTH_PASSWORD_CHANGED",
        requestId,
      });
    });
    return this.getMe(userId);
  }
}
