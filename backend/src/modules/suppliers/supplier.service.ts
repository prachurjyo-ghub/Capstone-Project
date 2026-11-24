import { randomBytes } from "node:crypto";
import {
  AccountStatus,
  InvitationStatus,
  InvitationType,
  Prisma,
  type PrismaClient,
  SupplierBusinessStatus,
  UserRole,
} from "@prisma/client";
import type { Env } from "../../config/env.js";
import { recordAudit } from "../auth/audit.service.js";
import { hashPassword } from "../auth/password.js";
import { createOpaqueToken, hashOpaqueToken } from "../auth/token.service.js";
import { AppError } from "../../shared/errors/app-error.js";
import type {
  AcceptInvitationInput,
  CreateBusinessInput,
  CreateLocationInput,
  CreateOwnerAccountInput,
  InviteOwnerInput,
  ListBusinessQuery,
  ResetMemberTemporaryPasswordInput,
  SupportedCategoriesInput,
  UpdateBusinessInput,
  UpdateLocationInput,
  UpdateMemberAccountStatusInput,
} from "./supplier.schemas.js";
import type { SupplierInvitationDelivery } from "./supplier-invitation-delivery.js";

const businessInclude = {
  ownerUser: {
    select: { id: true, email: true, fullName: true, role: true },
  },
  locations: {
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  },
  members: {
    select: {
      id: true,
      title: true,
      isPrimary: true,
      isActive: true,
      joinedAt: true,
      leftAt: true,
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          accountStatus: true,
          mustChangePassword: true,
        },
      },
    },
    orderBy: [{ isPrimary: "desc" }, { joinedAt: "asc" }],
  },
  _count: {
    select: { members: true, invitations: true },
  },
} satisfies Prisma.SupplierBusinessInclude;

const invitationSelect = {
  id: true,
  email: true,
  invitationType: true,
  status: true,
  businessId: true,
  invitedByUserId: true,
  acceptedByUserId: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AccountInvitationSelect;

class ProvisioningConflict extends Error {}

function conflict(code: string, message: string): AppError {
  return new AppError(message, { code, statusCode: 409 });
}

function invalidInvitation(): AppError {
  return new AppError("Supplier invitation is invalid or unavailable", {
    code: "INVALID_SUPPLIER_INVITATION",
    statusCode: 400,
  });
}

export class SupplierService {
  constructor(
    private readonly database: PrismaClient,
    private readonly env: Env,
    private readonly invitationDelivery: SupplierInvitationDelivery,
  ) {}

  private async requireBusiness(businessId: string) {
    const business = await this.database.supplierBusiness.findUnique({
      where: { id: businessId },
      include: businessInclude,
    });
    if (!business) {
      throw new AppError("Supplier business was not found", {
        code: "SUPPLIER_BUSINESS_NOT_FOUND",
        statusCode: 404,
      });
    }
    return business;
  }

  private assertEditable(status: SupplierBusinessStatus): void {
    if (status === SupplierBusinessStatus.CLOSED) {
      throw conflict("SUPPLIER_BUSINESS_CLOSED", "Closed businesses cannot be modified");
    }
  }

  private newBusinessCode(): string {
    return `SUP-${randomBytes(5).toString("hex").toUpperCase()}`;
  }

  private invitationMaterial() {
    const token = createOpaqueToken();
    return {
      token,
      tokenHash: hashOpaqueToken(token, this.env),
      expiresAt: new Date(
        Date.now() + this.env.SUPPLIER_INVITATION_TTL_HOURS * 3_600_000,
      ),
    };
  }

  private async deliverInvitation(
    invitationId: string,
    email: string,
    businessName: string,
    token: string,
    expiresAt: Date,
    actorUserId: string,
    requestId: string,
  ): Promise<void> {
    const activationUrl = new URL(this.env.SUPPLIER_INVITATION_URL_BASE);
    activationUrl.searchParams.set("token", token);
    try {
      await this.invitationDelivery.deliverSupplierInvitation({
        recipient: email,
        businessName,
        activationUrl: activationUrl.toString(),
        expiresAt,
      });
    } catch {
      await recordAudit(this.database, {
        actorUserId,
        action: "SUPPLIER_INVITATION_DELIVERY_FAILED",
        entityType: "ACCOUNT_INVITATION",
        entityId: invitationId,
        requestId,
      });
      throw new AppError("Supplier invitation could not be delivered", {
        code: "SUPPLIER_INVITATION_DELIVERY_FAILED",
        statusCode: 502,
      });
    }
  }

  async createBusiness(
    input: CreateBusinessInput,
    actorUserId: string,
    requestId: string,
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.database.$transaction(async (tx) => {
          const business = await tx.supplierBusiness.create({
            data: {
              ...input,
              businessCode: this.newBusinessCode(),
              status: SupplierBusinessStatus.DRAFT,
            },
            include: businessInclude,
          });
          await recordAudit(tx, {
            actorUserId,
            action: "SUPPLIER_BUSINESS_CREATED",
            entityType: "SUPPLIER_BUSINESS",
            entityId: business.id,
            requestId,
            metadata: { status: business.status },
          });
          return business;
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002" &&
          attempt < 2
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("Unable to allocate supplier business code");
  }

  async createOwnerAccount(
    businessId: string,
    input: CreateOwnerAccountInput,
    actorUserId: string,
    requestId: string,
  ) {
    const passwordHash = await hashPassword(input.temporaryPassword);
    try {
      return await this.database.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`supplier-owner:${businessId}`}, 0))`;
        const business = await tx.supplierBusiness.findUnique({
          where: { id: businessId },
          include: { members: { where: { isPrimary: true, isActive: true } } },
        });
        if (!business) {
          throw new AppError("Supplier business was not found", {
            code: "SUPPLIER_BUSINESS_NOT_FOUND",
            statusCode: 404,
          });
        }
        if (business.ownerUserId || business.members.length > 0) {
          throw conflict(
            "SUPPLIER_OWNER_EXISTS",
            "This business already has an initial owner",
          );
        }
        const owner = await tx.user.create({
          data: {
            email: input.email,
            fullName: input.fullName,
            phone: input.phone,
            passwordHash,
            role: UserRole.SUPPLIER_OWNER,
            accountStatus: AccountStatus.ACTIVE,
            mustChangePassword: true,
          },
          select: {
            id: true,
            email: true,
            fullName: true,
            phone: true,
            role: true,
            accountStatus: true,
            mustChangePassword: true,
            createdAt: true,
          },
        });
        await tx.supplierUser.create({
          data: {
            businessId,
            userId: owner.id,
            title: "Owner",
            isPrimary: true,
            isActive: true,
          },
        });
        await tx.supplierBusiness.update({
          where: { id: businessId },
          data: { ownerUserId: owner.id },
        });
        await recordAudit(tx, {
          actorUserId,
          action: "SUPPLIER_OWNER_ACCOUNT_CREATED",
          entityType: "SUPPLIER_BUSINESS",
          entityId: businessId,
          requestId,
          metadata: { ownerUserId: owner.id, requiresCredentialChange: true },
        });
        return owner;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw conflict(
          "SUPPLIER_OWNER_EMAIL_CONFLICT",
          "An account already uses this email; account linking is not available here",
        );
      }
      throw error;
    }
  }

  async updateMemberAccountStatus(
    businessId: string,
    membershipId: string,
    input: UpdateMemberAccountStatusInput,
    actorUserId: string,
    requestId: string,
  ) {
    return this.database.$transaction(async (tx) => {
      const membership = await tx.supplierUser.findFirst({
        where: { id: membershipId, businessId },
        include: { user: true },
      });
      if (!membership) {
        throw new AppError("Supplier member was not found", {
          code: "SUPPLIER_MEMBER_NOT_FOUND",
          statusCode: 404,
        });
      }
      const status = input.status as AccountStatus;
      if (membership.user.accountStatus === status)
        return {
          id: membership.id,
          user: {
            id: membership.user.id,
            email: membership.user.email,
            fullName: membership.user.fullName,
            accountStatus: membership.user.accountStatus,
          },
        };
      const user = await tx.user.update({
        where: { id: membership.userId },
        data: {
          accountStatus: status,
          suspendedAt: status === AccountStatus.SUSPENDED ? new Date() : null,
          suspendedReason: status === AccountStatus.SUSPENDED ? input.reason : null,
        },
        select: { id: true, email: true, fullName: true, accountStatus: true },
      });
      if (status === AccountStatus.SUSPENDED) {
        await tx.refreshSession.updateMany({
          where: { userId: membership.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await recordAudit(tx, {
        actorUserId,
        action:
          status === AccountStatus.SUSPENDED
            ? "SUPPLIER_MEMBER_ACCOUNT_SUSPENDED"
            : "SUPPLIER_MEMBER_ACCOUNT_REACTIVATED",
        entityType: "USER",
        entityId: membership.userId,
        requestId,
        metadata: { businessId, membershipId, reason: input.reason },
      });
      return { id: membership.id, user };
    });
  }

  async resetMemberTemporaryPassword(
    businessId: string,
    membershipId: string,
    input: ResetMemberTemporaryPasswordInput,
    actorUserId: string,
    requestId: string,
  ) {
    const passwordHash = await hashPassword(input.temporaryPassword);
    const now = new Date();
    return this.database.$transaction(async (tx) => {
      const membership = await tx.supplierUser.findFirst({
        where: {
          id: membershipId,
          businessId,
          isActive: true,
          leftAt: null,
          user: {
            role: { in: [UserRole.SUPPLIER_OWNER, UserRole.SUPPLIER_STAFF] },
          },
        },
        select: { id: true, userId: true },
      });
      if (!membership) {
        throw new AppError("Active supplier member was not found", {
          code: "SUPPLIER_MEMBER_NOT_FOUND",
          statusCode: 404,
        });
      }
      const user = await tx.user.update({
        where: { id: membership.userId },
        data: {
          passwordHash,
          mustChangePassword: true,
          passwordChangedAt: now,
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          accountStatus: true,
          mustChangePassword: true,
        },
      });
      await tx.refreshSession.updateMany({
        where: { userId: membership.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await recordAudit(tx, {
        actorUserId,
        action: "SUPPLIER_MEMBER_TEMPORARY_PASSWORD_RESET",
        entityType: "USER",
        entityId: membership.userId,
        requestId,
        metadata: { businessId, membershipId, reason: input.reason },
      });
      return { id: membership.id, user };
    });
  }

  async listBusinesses(query: ListBusinessQuery) {
    const where: Prisma.SupplierBusinessWhereInput = {
      status: query.status,
      ...(query.search
        ? {
            OR: [
              { legalName: { contains: query.search, mode: "insensitive" } },
              { displayName: { contains: query.search, mode: "insensitive" } },
              { businessCode: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.database.$transaction([
      this.database.supplierBusiness.findMany({
        where,
        include: businessInclude,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.supplierBusiness.count({ where }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  getBusiness(businessId: string) {
    return this.requireBusiness(businessId);
  }

  async updateBusiness(
    businessId: string,
    input: UpdateBusinessInput,
    actorUserId: string,
    requestId: string,
  ) {
    const current = await this.requireBusiness(businessId);
    this.assertEditable(current.status);
    return this.database.$transaction(async (tx) => {
      const business = await tx.supplierBusiness.update({
        where: { id: businessId },
        data: input,
        include: businessInclude,
      });
      await recordAudit(tx, {
        actorUserId,
        action: "SUPPLIER_BUSINESS_UPDATED",
        entityType: "SUPPLIER_BUSINESS",
        entityId: businessId,
        requestId,
        metadata: { fields: Object.keys(input) },
      });
      return business;
    });
  }

  async setSupportedCategories(
    businessId: string,
    input: SupportedCategoriesInput,
    actorUserId: string,
    requestId: string,
  ) {
    const current = await this.requireBusiness(businessId);
    this.assertEditable(current.status);
    const categories = await this.database.partCategory.findMany({
      where: { slug: { in: input.categories }, isActive: true },
      select: { slug: true },
    });
    const found = new Set(categories.map((category) => category.slug));
    const missing = input.categories.filter((slug) => !found.has(slug));
    if (missing.length > 0) {
      throw new AppError("One or more supported categories are invalid", {
        code: "INVALID_SUPPORTED_CATEGORIES",
        statusCode: 400,
        details: missing.map((slug) => ({ slug })),
      });
    }
    return this.database.$transaction(async (tx) => {
      const business = await tx.supplierBusiness.update({
        where: { id: businessId },
        data: { supportedCategories: input.categories },
        include: businessInclude,
      });
      await recordAudit(tx, {
        actorUserId,
        action: "SUPPLIER_CATEGORIES_UPDATED",
        entityType: "SUPPLIER_BUSINESS",
        entityId: businessId,
        requestId,
        metadata: { categoryCount: input.categories.length },
      });
      return business;
    });
  }

  async createLocation(
    businessId: string,
    input: CreateLocationInput,
    actorUserId: string,
    requestId: string,
  ) {
    const business = await this.requireBusiness(businessId);
    this.assertEditable(business.status);
    if (input.isPrimary && !input.isActive) {
      throw new AppError("An inactive location cannot be primary", {
        code: "INVALID_LOCATION_STATE",
        statusCode: 400,
      });
    }
    return this.database.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.supplierLocation.updateMany({
          where: { businessId },
          data: { isPrimary: false },
        });
      }
      const location = await tx.supplierLocation.create({
        data: { businessId, ...input },
      });
      await recordAudit(tx, {
        actorUserId,
        action: "SUPPLIER_LOCATION_CREATED",
        entityType: "SUPPLIER_LOCATION",
        entityId: location.id,
        requestId,
        metadata: { businessId },
      });
      return location;
    });
  }

  async updateLocation(
    businessId: string,
    locationId: string,
    input: UpdateLocationInput,
    actorUserId: string,
    requestId: string,
  ) {
    const business = await this.requireBusiness(businessId);
    this.assertEditable(business.status);
    const current = await this.database.supplierLocation.findFirst({
      where: { id: locationId, businessId },
    });
    if (!current) {
      throw new AppError("Supplier location was not found", {
        code: "SUPPLIER_LOCATION_NOT_FOUND",
        statusCode: 404,
      });
    }
    const willBePrimary = input.isPrimary ?? current.isPrimary;
    const willBeActive = input.isActive ?? current.isActive;
    if (willBePrimary && !willBeActive) {
      throw new AppError("An inactive location cannot be primary", {
        code: "INVALID_LOCATION_STATE",
        statusCode: 400,
      });
    }
    return this.database.$transaction(async (tx) => {
      if (input.isPrimary === true) {
        await tx.supplierLocation.updateMany({
          where: { businessId, id: { not: locationId } },
          data: { isPrimary: false },
        });
      }
      const location = await tx.supplierLocation.update({
        where: { id: locationId },
        data: input,
      });
      await recordAudit(tx, {
        actorUserId,
        action: "SUPPLIER_LOCATION_UPDATED",
        entityType: "SUPPLIER_LOCATION",
        entityId: locationId,
        requestId,
        metadata: { businessId, fields: Object.keys(input) },
      });
      return location;
    });
  }

  async deactivateLocation(
    businessId: string,
    locationId: string,
    actorUserId: string,
    requestId: string,
  ) {
    const business = await this.requireBusiness(businessId);
    this.assertEditable(business.status);
    const result = await this.database.supplierLocation.updateMany({
      where: { id: locationId, businessId },
      data: { isActive: false, isPrimary: false },
    });
    if (result.count !== 1) {
      throw new AppError("Supplier location was not found", {
        code: "SUPPLIER_LOCATION_NOT_FOUND",
        statusCode: 404,
      });
    }
    await recordAudit(this.database, {
      actorUserId,
      action: "SUPPLIER_LOCATION_DEACTIVATED",
      entityType: "SUPPLIER_LOCATION",
      entityId: locationId,
      requestId,
      metadata: { businessId },
    });
    return this.database.supplierLocation.findUniqueOrThrow({
      where: { id: locationId },
    });
  }

  private async expirePendingInvitations(businessId: string): Promise<void> {
    await this.database.accountInvitation.updateMany({
      where: {
        businessId,
        invitationType: InvitationType.SUPPLIER_OWNER,
        status: InvitationStatus.PENDING,
        expiresAt: { lte: new Date() },
      },
      data: { status: InvitationStatus.EXPIRED },
    });
  }

  async inviteInitialOwner(
    businessId: string,
    input: InviteOwnerInput,
    actorUserId: string,
    requestId: string,
  ) {
    await this.expirePendingInvitations(businessId);
    const material = this.invitationMaterial();
    const result = await this.database
      .$transaction(async (tx) => {
        const business = await tx.supplierBusiness.findUnique({
          where: { id: businessId },
        });
        if (!business) {
          throw new AppError("Supplier business was not found", {
            code: "SUPPLIER_BUSINESS_NOT_FOUND",
            statusCode: 404,
          });
        }
        this.assertEditable(business.status);
        if (business.ownerUserId) {
          throw conflict(
            "SUPPLIER_OWNER_EXISTS",
            "Supplier business already has an owner",
          );
        }
        const [primaryMembership, pendingInvitation] = await Promise.all([
          tx.supplierUser.findFirst({
            where: { businessId, isPrimary: true, leftAt: null },
            select: { id: true },
          }),
          tx.accountInvitation.findFirst({
            where: {
              businessId,
              invitationType: InvitationType.SUPPLIER_OWNER,
              status: InvitationStatus.PENDING,
            },
            select: { id: true },
          }),
        ]);
        if (primaryMembership) {
          throw conflict(
            "SUPPLIER_OWNER_EXISTS",
            "Supplier business already has an owner",
          );
        }
        if (pendingInvitation) {
          throw conflict(
            "PENDING_OWNER_INVITATION_EXISTS",
            "A pending owner invitation already exists; resend or revoke it",
          );
        }
        const invitation = await tx.accountInvitation.create({
          data: {
            email: input.email,
            invitationType: InvitationType.SUPPLIER_OWNER,
            status: InvitationStatus.PENDING,
            tokenHash: material.tokenHash,
            businessId,
            invitedByUserId: actorUserId,
            expiresAt: material.expiresAt,
          },
          select: invitationSelect,
        });
        await recordAudit(tx, {
          actorUserId,
          action: "SUPPLIER_OWNER_INVITED",
          entityType: "ACCOUNT_INVITATION",
          entityId: invitation.id,
          requestId,
          metadata: { businessId, expiresAt: invitation.expiresAt.toISOString() },
        });
        return { invitation, businessName: business.displayName };
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw conflict(
            "PENDING_OWNER_INVITATION_EXISTS",
            "A pending owner invitation already exists; resend or revoke it",
          );
        }
        throw error;
      });
    await this.deliverInvitation(
      result.invitation.id,
      result.invitation.email,
      result.businessName,
      material.token,
      material.expiresAt,
      actorUserId,
      requestId,
    );
    return result.invitation;
  }

  async listInvitations(businessId: string) {
    await this.requireBusiness(businessId);
    await this.expirePendingInvitations(businessId);
    return this.database.accountInvitation.findMany({
      where: { businessId, invitationType: InvitationType.SUPPLIER_OWNER },
      select: invitationSelect,
      orderBy: { createdAt: "desc" },
    });
  }

  async getInvitation(businessId: string, invitationId: string) {
    await this.requireBusiness(businessId);
    await this.expirePendingInvitations(businessId);
    const invitation = await this.database.accountInvitation.findFirst({
      where: { id: invitationId, businessId },
      select: invitationSelect,
    });
    if (!invitation) {
      throw new AppError("Supplier invitation was not found", {
        code: "SUPPLIER_INVITATION_NOT_FOUND",
        statusCode: 404,
      });
    }
    return invitation;
  }

  async resendInvitation(
    businessId: string,
    invitationId: string,
    actorUserId: string,
    requestId: string,
  ) {
    await this.expirePendingInvitations(businessId);
    const material = this.invitationMaterial();
    const result = await this.database.$transaction(async (tx) => {
      const invitation = await tx.accountInvitation.findFirst({
        where: {
          id: invitationId,
          businessId,
          invitationType: InvitationType.SUPPLIER_OWNER,
        },
        include: { business: true },
      });
      if (!invitation) {
        throw new AppError("Supplier invitation was not found", {
          code: "SUPPLIER_INVITATION_NOT_FOUND",
          statusCode: 404,
        });
      }
      if (
        (invitation.status !== InvitationStatus.PENDING &&
          invitation.status !== InvitationStatus.EXPIRED) ||
        invitation.revokedAt ||
        invitation.business?.ownerUserId
      ) {
        throw conflict(
          "SUPPLIER_INVITATION_NOT_PENDING",
          "Only a pending or expired owner invitation can be resent",
        );
      }
      const invalidated = await tx.accountInvitation.updateMany({
        where: {
          id: invitationId,
          status: { in: [InvitationStatus.PENDING, InvitationStatus.EXPIRED] },
          revokedAt: null,
        },
        data: { status: InvitationStatus.REVOKED, revokedAt: new Date() },
      });
      if (invalidated.count !== 1) {
        throw conflict(
          "SUPPLIER_INVITATION_NOT_PENDING",
          "Invitation is no longer available to resend",
        );
      }
      const replacement = await tx.accountInvitation.create({
        data: {
          email: invitation.email,
          invitationType: InvitationType.SUPPLIER_OWNER,
          status: InvitationStatus.PENDING,
          tokenHash: material.tokenHash,
          businessId,
          invitedByUserId: actorUserId,
          expiresAt: material.expiresAt,
        },
        select: invitationSelect,
      });
      await recordAudit(tx, {
        actorUserId,
        action: "SUPPLIER_OWNER_INVITATION_RESENT",
        entityType: "ACCOUNT_INVITATION",
        entityId: replacement.id,
        requestId,
        metadata: { businessId, replacedInvitationId: invitationId },
      });
      return { replacement, businessName: invitation.business!.displayName };
    });
    await this.deliverInvitation(
      result.replacement.id,
      result.replacement.email,
      result.businessName,
      material.token,
      material.expiresAt,
      actorUserId,
      requestId,
    );
    return result.replacement;
  }

  async revokeInvitation(
    businessId: string,
    invitationId: string,
    actorUserId: string,
    requestId: string,
  ) {
    await this.expirePendingInvitations(businessId);
    const now = new Date();
    const result = await this.database.$transaction(async (tx) => {
      const revoked = await tx.accountInvitation.updateMany({
        where: {
          id: invitationId,
          businessId,
          invitationType: InvitationType.SUPPLIER_OWNER,
          status: InvitationStatus.PENDING,
          expiresAt: { gt: now },
        },
        data: { status: InvitationStatus.REVOKED, revokedAt: now },
      });
      if (revoked.count !== 1) return null;
      await recordAudit(tx, {
        actorUserId,
        action: "SUPPLIER_OWNER_INVITATION_REVOKED",
        entityType: "ACCOUNT_INVITATION",
        entityId: invitationId,
        requestId,
        metadata: { businessId },
      });
      return tx.accountInvitation.findUnique({
        where: { id: invitationId },
        select: invitationSelect,
      });
    });
    if (!result) {
      throw conflict(
        "SUPPLIER_INVITATION_NOT_PENDING",
        "Only a pending invitation can be revoked",
      );
    }
    return result;
  }

  async acceptInvitation(input: AcceptInvitationInput, requestId: string) {
    const passwordHash = await hashPassword(input.password);
    const tokenHash = hashOpaqueToken(input.token, this.env);
    const now = new Date();
    try {
      const outcome = await this.database.$transaction(
        async (tx) => {
          const invitation = await tx.accountInvitation.findUnique({
            where: { tokenHash },
            include: { business: true },
          });
          if (
            !invitation ||
            invitation.invitationType !== InvitationType.SUPPLIER_OWNER ||
            !invitation.businessId ||
            !invitation.business
          ) {
            return { type: "invalid" } as const;
          }
          if (
            invitation.status !== InvitationStatus.PENDING ||
            invitation.revokedAt ||
            invitation.acceptedAt
          ) {
            return { type: "invalid" } as const;
          }
          if (invitation.expiresAt <= now) {
            await tx.accountInvitation.update({
              where: { id: invitation.id },
              data: { status: InvitationStatus.EXPIRED },
            });
            return { type: "invalid" } as const;
          }
          if (invitation.business.ownerUserId) {
            return { type: "owner_conflict" } as const;
          }
          const existingUser = await tx.user.findUnique({
            where: { email: invitation.email },
            select: { id: true },
          });
          if (existingUser) return { type: "email_conflict" } as const;

          const primaryMembership = await tx.supplierUser.findFirst({
            where: {
              businessId: invitation.businessId,
              isPrimary: true,
              leftAt: null,
            },
            select: { id: true },
          });
          if (primaryMembership) return { type: "owner_conflict" } as const;

          const claimed = await tx.accountInvitation.updateMany({
            where: {
              id: invitation.id,
              status: InvitationStatus.PENDING,
              revokedAt: null,
              acceptedAt: null,
              expiresAt: { gt: now },
            },
            data: { status: InvitationStatus.ACCEPTED, acceptedAt: now },
          });
          if (claimed.count !== 1) return { type: "invalid" } as const;

          const user = await tx.user.create({
            data: {
              email: invitation.email,
              fullName: input.fullName,
              passwordHash,
              role: UserRole.SUPPLIER_OWNER,
              accountStatus: AccountStatus.ACTIVE,
              emailVerifiedAt: now,
            },
          });
          const membership = await tx.supplierUser.create({
            data: {
              businessId: invitation.businessId,
              userId: user.id,
              title: "Owner",
              isPrimary: true,
              isActive: true,
            },
          });
          const assigned = await tx.supplierBusiness.updateMany({
            where: { id: invitation.businessId, ownerUserId: null },
            data: { ownerUserId: user.id },
          });
          if (assigned.count !== 1) throw new ProvisioningConflict();
          await tx.accountInvitation.update({
            where: { id: invitation.id },
            data: { acceptedByUserId: user.id },
          });
          await recordAudit(tx, {
            actorUserId: user.id,
            action: "SUPPLIER_OWNER_INVITATION_ACCEPTED",
            entityType: "ACCOUNT_INVITATION",
            entityId: invitation.id,
            requestId,
            metadata: {
              businessId: invitation.businessId,
              membershipId: membership.id,
            },
          });
          return {
            type: "success",
            userId: user.id,
            businessId: invitation.businessId,
          } as const;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (outcome.type === "invalid") throw invalidInvitation();
      if (outcome.type === "email_conflict") {
        throw conflict(
          "INVITED_EMAIL_ALREADY_REGISTERED",
          "The invited email already belongs to an account; account linking is not supported",
        );
      }
      if (outcome.type === "owner_conflict") {
        throw conflict(
          "SUPPLIER_OWNER_EXISTS",
          "Supplier business already has an initial owner",
        );
      }
      return {
        message: "Supplier owner account created; sign in to continue",
        userId: outcome.userId,
        businessId: outcome.businessId,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof ProvisioningConflict) {
        throw conflict(
          "SUPPLIER_OWNER_EXISTS",
          "Supplier business already has an initial owner",
        );
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" || error.code === "P2034")
      ) {
        if (error.code === "P2002") {
          throw conflict(
            "INVITED_EMAIL_ALREADY_REGISTERED",
            "The invited email cannot be provisioned through this invitation",
          );
        }
        throw invalidInvitation();
      }
      throw error;
    }
  }

  async submitForReview(businessId: string, actorUserId: string, requestId: string) {
    return this.transitionBusiness(
      businessId,
      [SupplierBusinessStatus.DRAFT],
      SupplierBusinessStatus.PENDING_REVIEW,
      actorUserId,
      requestId,
      "SUPPLIER_BUSINESS_SUBMITTED_FOR_REVIEW",
    );
  }

  async activateBusiness(businessId: string, actorUserId: string, requestId: string) {
    const business = await this.requireBusiness(businessId);
    if (!business.ownerUserId) {
      throw conflict(
        "SUPPLIER_OWNER_REQUIRED",
        "An accepted initial owner is required before activation",
      );
    }
    const primary = await this.database.supplierUser.findFirst({
      where: {
        businessId,
        userId: business.ownerUserId,
        isPrimary: true,
        isActive: true,
        leftAt: null,
      },
    });
    if (!primary) {
      throw conflict(
        "ACTIVE_OWNER_MEMBERSHIP_REQUIRED",
        "An active owner membership is required before activation",
      );
    }
    return this.transitionBusiness(
      businessId,
      [SupplierBusinessStatus.PENDING_REVIEW, SupplierBusinessStatus.SUSPENDED],
      SupplierBusinessStatus.ACTIVE,
      actorUserId,
      requestId,
      "SUPPLIER_BUSINESS_ACTIVATED",
      { suspendedAt: null, suspendedReason: null },
    );
  }

  async suspendBusiness(
    businessId: string,
    reason: string,
    actorUserId: string,
    requestId: string,
  ) {
    return this.transitionBusiness(
      businessId,
      [SupplierBusinessStatus.ACTIVE],
      SupplierBusinessStatus.SUSPENDED,
      actorUserId,
      requestId,
      "SUPPLIER_BUSINESS_SUSPENDED",
      { suspendedAt: new Date(), suspendedReason: reason },
      true,
    );
  }

  async disableBusiness(
    businessId: string,
    reason: string | undefined,
    actorUserId: string,
    requestId: string,
  ) {
    const business = await this.requireBusiness(businessId);
    if (business.status === SupplierBusinessStatus.CLOSED) {
      throw conflict("INVALID_BUSINESS_STATUS_TRANSITION", "Business is already closed");
    }
    const now = new Date();
    return this.database.$transaction(async (tx) => {
      const userIds = (
        await tx.supplierUser.findMany({
          where: { businessId, isActive: true, leftAt: null },
          select: { userId: true },
        })
      ).map((membership) => membership.userId);
      await tx.supplierUser.updateMany({
        where: { businessId, isActive: true, leftAt: null },
        data: { isActive: false, leftAt: now },
      });
      if (userIds.length > 0) {
        await tx.refreshSession.updateMany({
          where: { userId: { in: userIds }, revokedAt: null },
          data: { revokedAt: now },
        });
      }
      const updated = await tx.supplierBusiness.update({
        where: { id: businessId },
        data: {
          status: SupplierBusinessStatus.CLOSED,
          closedAt: now,
          suspendedReason: reason,
        },
        include: businessInclude,
      });
      await recordAudit(tx, {
        actorUserId,
        action: "SUPPLIER_BUSINESS_DISABLED",
        entityType: "SUPPLIER_BUSINESS",
        entityId: businessId,
        requestId,
        metadata: { from: business.status, to: SupplierBusinessStatus.CLOSED },
      });
      return updated;
    });
  }

  private async transitionBusiness(
    businessId: string,
    allowedFrom: SupplierBusinessStatus[],
    target: SupplierBusinessStatus,
    actorUserId: string,
    requestId: string,
    action: string,
    data: Prisma.SupplierBusinessUpdateInput = {},
    revokeMemberSessions = false,
  ) {
    const current = await this.requireBusiness(businessId);
    if (!allowedFrom.includes(current.status)) {
      throw conflict(
        "INVALID_BUSINESS_STATUS_TRANSITION",
        `Cannot transition supplier business from ${current.status} to ${target}`,
      );
    }
    return this.database.$transaction(async (tx) => {
      if (revokeMemberSessions) {
        const userIds = (
          await tx.supplierUser.findMany({
            where: { businessId, isActive: true, leftAt: null },
            select: { userId: true },
          })
        ).map((membership) => membership.userId);
        if (userIds.length > 0) {
          await tx.refreshSession.updateMany({
            where: { userId: { in: userIds }, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
      }
      const changed = await tx.supplierBusiness.updateMany({
        where: { id: businessId, status: { in: allowedFrom } },
        data: { ...data, status: target },
      });
      if (changed.count !== 1) {
        throw conflict(
          "INVALID_BUSINESS_STATUS_TRANSITION",
          "Supplier business status changed during this request",
        );
      }
      await recordAudit(tx, {
        actorUserId,
        action,
        entityType: "SUPPLIER_BUSINESS",
        entityId: businessId,
        requestId,
        metadata: { from: current.status, to: target },
      });
      return tx.supplierBusiness.findUniqueOrThrow({
        where: { id: businessId },
        include: businessInclude,
      });
    });
  }
}
