import { AccountStatus, type Prisma, type PrismaClient, UserRole } from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";
import { recordAudit } from "../auth/audit.service.js";
import type {
  AdminCustomerListQuery,
  CreateAddressInput,
  CreateVehicleInput,
  UpdateAddressInput,
  UpdateCustomerProfileInput,
  UpdateVehicleInput,
} from "./customer.schemas.js";

const addressSelect = {
  id: true,
  label: true,
  recipientName: true,
  phone: true,
  addressLine: true,
  addressLine2: true,
  area: true,
  city: true,
  postalCode: true,
  landmark: true,
  deliveryInstructions: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CustomerAddressSelect;

const vehicleSelect = {
  id: true,
  make: true,
  model: true,
  year: true,
  variant: true,
  registrationNumber: true,
  chassisVin: true,
  engineInfo: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.VehicleSelect;

const customerAccountSelect = {
  id: true,
  email: true,
  phone: true,
  role: true,
  accountStatus: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  suspendedAt: true,
  createdAt: true,
  updatedAt: true,
  customerProfile: {
    select: {
      id: true,
      fullName: true,
      preferredName: true,
      companyName: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.UserSelect;

type CustomerAccount = Prisma.UserGetPayload<{ select: typeof customerAccountSelect }>;

function serializeCustomerAccount(account: CustomerAccount) {
  return {
    id: account.id,
    email: account.email,
    phone: account.phone,
    role: account.role,
    accountStatus: account.accountStatus,
    emailVerified: account.emailVerifiedAt !== null,
    phoneVerified: account.phoneVerifiedAt !== null,
    suspendedAt: account.suspendedAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    profile: account.customerProfile
      ? {
          fullName: account.customerProfile.fullName,
          preferredName: account.customerProfile.preferredName,
          companyName: account.customerProfile.companyName,
          createdAt: account.customerProfile.createdAt,
          updatedAt: account.customerProfile.updatedAt,
        }
      : null,
  };
}

function notFound(kind: "address" | "vehicle"): AppError {
  return new AppError(`Saved ${kind} was not found`, {
    code: `CUSTOMER_${kind.toUpperCase()}_NOT_FOUND`,
    statusCode: 404,
  });
}

function customerNotFound(): AppError {
  return new AppError("Customer account was not found", {
    code: "CUSTOMER_NOT_FOUND",
    statusCode: 404,
  });
}

export class CustomerService {
  constructor(private readonly database: PrismaClient) {}

  private async customerProfileId(userId: string): Promise<string> {
    const customer = await this.database.user.findFirst({
      where: { id: userId, role: UserRole.CUSTOMER },
      select: { customerProfile: { select: { id: true } } },
    });
    if (!customer?.customerProfile) throw customerNotFound();
    return customer.customerProfile.id;
  }

  private async lockCustomer(
    tx: Prisma.TransactionClient,
    customerProfileId: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT "id"
      FROM "customer_profiles"
      WHERE "id" = ${customerProfileId}::uuid
      FOR UPDATE
    `;
  }

  async getMyProfile(userId: string) {
    const account = await this.database.user.findFirst({
      where: { id: userId, role: UserRole.CUSTOMER },
      select: customerAccountSelect,
    });
    if (!account?.customerProfile) throw customerNotFound();
    return serializeCustomerAccount(account);
  }

  async updateMyProfile(
    userId: string,
    input: UpdateCustomerProfileInput,
    requestId: string,
  ) {
    const profileId = await this.customerProfileId(userId);
    await this.database.$transaction(async (tx) => {
      await tx.customerProfile.update({ where: { id: profileId }, data: input });
      if (input.fullName !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { fullName: input.fullName },
        });
      }
      await recordAudit(tx, {
        actorUserId: userId,
        action: "CUSTOMER_PROFILE_UPDATED",
        entityType: "USER",
        entityId: userId,
        requestId,
        metadata: { fields: Object.keys(input) },
      });
    });
    return this.getMyProfile(userId);
  }

  async listMyAddresses(userId: string) {
    const customerId = await this.customerProfileId(userId);
    return this.database.customerAddress.findMany({
      where: { customerId, isActive: true, deletedAt: null },
      select: addressSelect,
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
  }

  async createAddress(userId: string, input: CreateAddressInput, requestId: string) {
    const customerId = await this.customerProfileId(userId);
    return this.database.$transaction(async (tx) => {
      await this.lockCustomer(tx, customerId);
      if (input.isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId, isActive: true, deletedAt: null, isDefault: true },
          data: { isDefault: false },
        });
      }
      const address = await tx.customerAddress.create({
        data: { customerId, ...input },
        select: addressSelect,
      });
      await recordAudit(tx, {
        actorUserId: userId,
        action: "CUSTOMER_ADDRESS_CREATED",
        entityType: "CUSTOMER_ADDRESS",
        entityId: address.id,
        requestId,
        metadata: { isDefault: address.isDefault },
      });
      return address;
    });
  }

  async updateAddress(
    userId: string,
    addressId: string,
    input: UpdateAddressInput,
    requestId: string,
  ) {
    const customerId = await this.customerProfileId(userId);
    return this.database.$transaction(async (tx) => {
      await this.lockCustomer(tx, customerId);
      const existing = await tx.customerAddress.findFirst({
        where: { id: addressId, customerId, isActive: true, deletedAt: null },
        select: {
          id: true,
          label: true,
          recipientName: true,
          phone: true,
          addressLine: true,
          addressLine2: true,
          area: true,
          city: true,
          postalCode: true,
          landmark: true,
          deliveryInstructions: true,
          isDefault: true,
          _count: { select: { sourcingRequests: true, orders: true } },
        },
      });
      if (!existing) throw notFound("address");
      const isHistoricallyReferenced =
        existing._count.sourcingRequests > 0 || existing._count.orders > 0;
      let address;
      if (isHistoricallyReferenced) {
        await tx.customerAddress.update({
          where: { id: addressId },
          data: { isActive: false, isDefault: false, deletedAt: new Date() },
        });
        const { _count: _references, id: _id, ...savedFields } = existing;
        address = await tx.customerAddress.create({
          data: { customerId, ...savedFields, ...input },
          select: addressSelect,
        });
      } else {
        address = await tx.customerAddress.update({
          where: { id: addressId },
          data: input,
          select: addressSelect,
        });
      }
      await recordAudit(tx, {
        actorUserId: userId,
        action: isHistoricallyReferenced
          ? "CUSTOMER_ADDRESS_REPLACED"
          : "CUSTOMER_ADDRESS_UPDATED",
        entityType: "CUSTOMER_ADDRESS",
        entityId: address.id,
        requestId,
        metadata: {
          fields: Object.keys(input),
          ...(isHistoricallyReferenced ? { replacedAddressId: addressId } : {}),
        },
      });
      return address;
    });
  }

  async setDefaultAddress(userId: string, addressId: string, requestId: string) {
    const customerId = await this.customerProfileId(userId);
    return this.database.$transaction(async (tx) => {
      await this.lockCustomer(tx, customerId);
      const target = await tx.customerAddress.findFirst({
        where: { id: addressId, customerId, isActive: true, deletedAt: null },
        select: { id: true },
      });
      if (!target) throw notFound("address");
      await tx.customerAddress.updateMany({
        where: { customerId, isActive: true, deletedAt: null, isDefault: true },
        data: { isDefault: false },
      });
      const address = await tx.customerAddress.update({
        where: { id: addressId },
        data: { isDefault: true },
        select: addressSelect,
      });
      await recordAudit(tx, {
        actorUserId: userId,
        action: "CUSTOMER_DEFAULT_ADDRESS_SELECTED",
        entityType: "CUSTOMER_ADDRESS",
        entityId: addressId,
        requestId,
      });
      return address;
    });
  }

  async deleteAddress(userId: string, addressId: string, requestId: string) {
    const customerId = await this.customerProfileId(userId);
    return this.database.$transaction(async (tx) => {
      await this.lockCustomer(tx, customerId);
      const existing = await tx.customerAddress.findFirst({
        where: { id: addressId, customerId, isActive: true, deletedAt: null },
        select: { id: true, isDefault: true },
      });
      if (!existing) throw notFound("address");
      const now = new Date();
      await tx.customerAddress.update({
        where: { id: addressId },
        data: { isActive: false, isDefault: false, deletedAt: now },
      });

      let promotedAddressId: string | null = null;
      if (existing.isDefault) {
        const replacement = await tx.customerAddress.findFirst({
          where: { customerId, isActive: true, deletedAt: null },
          select: { id: true },
          orderBy: { createdAt: "asc" },
        });
        if (replacement) {
          await tx.customerAddress.update({
            where: { id: replacement.id },
            data: { isDefault: true },
          });
          promotedAddressId = replacement.id;
        }
      }
      await recordAudit(tx, {
        actorUserId: userId,
        action: "CUSTOMER_ADDRESS_DELETED",
        entityType: "CUSTOMER_ADDRESS",
        entityId: addressId,
        requestId,
        metadata: { defaultReplacementSelected: promotedAddressId !== null },
      });
      return {
        id: addressId,
        deleted: true,
        promotedDefaultAddressId: promotedAddressId,
      };
    });
  }

  async listMyVehicles(userId: string) {
    const customerId = await this.customerProfileId(userId);
    return this.database.vehicle.findMany({
      where: { customerId, isActive: true, deletedAt: null },
      select: vehicleSelect,
      orderBy: { createdAt: "asc" },
    });
  }

  async createVehicle(userId: string, input: CreateVehicleInput, requestId: string) {
    const customerId = await this.customerProfileId(userId);
    return this.database.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.create({
        data: { customerId, ...input },
        select: vehicleSelect,
      });
      await recordAudit(tx, {
        actorUserId: userId,
        action: "CUSTOMER_VEHICLE_CREATED",
        entityType: "VEHICLE",
        entityId: vehicle.id,
        requestId,
      });
      return vehicle;
    });
  }

  async updateVehicle(
    userId: string,
    vehicleId: string,
    input: UpdateVehicleInput,
    requestId: string,
  ) {
    const customerId = await this.customerProfileId(userId);
    return this.database.$transaction(async (tx) => {
      const existing = await tx.vehicle.findFirst({
        where: { id: vehicleId, customerId, isActive: true, deletedAt: null },
        select: {
          id: true,
          make: true,
          model: true,
          year: true,
          variant: true,
          registrationNumber: true,
          chassisVin: true,
          engineInfo: true,
          notes: true,
          _count: { select: { sourcingRequests: true, requestItems: true } },
        },
      });
      if (!existing) throw notFound("vehicle");
      const isHistoricallyReferenced =
        existing._count.sourcingRequests > 0 || existing._count.requestItems > 0;
      let vehicle;
      if (isHistoricallyReferenced) {
        await tx.vehicle.update({
          where: { id: vehicleId },
          data: { isActive: false, deletedAt: new Date() },
        });
        const { _count: _references, id: _id, ...savedFields } = existing;
        vehicle = await tx.vehicle.create({
          data: { customerId, ...savedFields, ...input },
          select: vehicleSelect,
        });
      } else {
        vehicle = await tx.vehicle.update({
          where: { id: vehicleId },
          data: input,
          select: vehicleSelect,
        });
      }
      await recordAudit(tx, {
        actorUserId: userId,
        action: isHistoricallyReferenced
          ? "CUSTOMER_VEHICLE_REPLACED"
          : "CUSTOMER_VEHICLE_UPDATED",
        entityType: "VEHICLE",
        entityId: vehicle.id,
        requestId,
        metadata: {
          fields: Object.keys(input),
          ...(isHistoricallyReferenced ? { replacedVehicleId: vehicleId } : {}),
        },
      });
      return vehicle;
    });
  }

  async deleteVehicle(userId: string, vehicleId: string, requestId: string) {
    const customerId = await this.customerProfileId(userId);
    const now = new Date();
    const result = await this.database.$transaction(async (tx) => {
      const deleted = await tx.vehicle.updateMany({
        where: { id: vehicleId, customerId, isActive: true, deletedAt: null },
        data: { isActive: false, deletedAt: now },
      });
      if (deleted.count !== 1) throw notFound("vehicle");
      await recordAudit(tx, {
        actorUserId: userId,
        action: "CUSTOMER_VEHICLE_DELETED",
        entityType: "VEHICLE",
        entityId: vehicleId,
        requestId,
      });
      return { id: vehicleId, deleted: true };
    });
    return result;
  }

  async listCustomers(query: AdminCustomerListQuery) {
    const where: Prisma.UserWhereInput = {
      role: UserRole.CUSTOMER,
      accountStatus: query.status,
      customerProfile: { isNot: null },
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: "insensitive" } },
              { phone: { contains: query.search, mode: "insensitive" } },
              { fullName: { contains: query.search, mode: "insensitive" } },
              {
                customerProfile: {
                  is: {
                    OR: [
                      { fullName: { contains: query.search, mode: "insensitive" } },
                      { preferredName: { contains: query.search, mode: "insensitive" } },
                      { companyName: { contains: query.search, mode: "insensitive" } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [accounts, total] = await this.database.$transaction([
      this.database.user.findMany({
        where,
        select: customerAccountSelect,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.user.count({ where }),
    ]);
    return {
      items: accounts.map(serializeCustomerAccount),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getCustomer(userId: string) {
    const account = await this.database.user.findFirst({
      where: { id: userId, role: UserRole.CUSTOMER },
      select: {
        ...customerAccountSelect,
        customerProfile: {
          select: {
            ...customerAccountSelect.customerProfile.select,
            addresses: {
              where: { isActive: true, deletedAt: null },
              select: addressSelect,
              orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
            },
            vehicles: {
              where: { isActive: true, deletedAt: null },
              select: vehicleSelect,
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });
    if (!account?.customerProfile) throw customerNotFound();
    return {
      ...serializeCustomerAccount(account),
      profile: {
        ...serializeCustomerAccount(account).profile!,
        addresses: account.customerProfile.addresses,
        vehicles: account.customerProfile.vehicles,
      },
    };
  }

  async updateCustomer(
    userId: string,
    input: UpdateCustomerProfileInput,
    actorUserId: string,
    requestId: string,
  ) {
    const customer = await this.database.user.findFirst({
      where: { id: userId, role: UserRole.CUSTOMER },
      select: { customerProfile: { select: { id: true } } },
    });
    if (!customer?.customerProfile) throw customerNotFound();
    await this.database.$transaction(async (tx) => {
      await tx.customerProfile.update({
        where: { id: customer.customerProfile!.id },
        data: input,
      });
      if (input.fullName !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { fullName: input.fullName },
        });
      }
      await recordAudit(tx, {
        actorUserId,
        action: "ADMIN_CUSTOMER_PROFILE_UPDATED",
        entityType: "USER",
        entityId: userId,
        requestId,
        metadata: { fields: Object.keys(input) },
      });
    });
    return this.getCustomer(userId);
  }

  async suspendCustomer(
    userId: string,
    reason: string,
    actorUserId: string,
    requestId: string,
  ) {
    const now = new Date();
    await this.database.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: {
          id: userId,
          role: UserRole.CUSTOMER,
          accountStatus: {
            in: [AccountStatus.ACTIVE, AccountStatus.PENDING_VERIFICATION],
          },
        },
        data: {
          accountStatus: AccountStatus.SUSPENDED,
          suspendedAt: now,
          suspendedReason: reason,
        },
      });
      if (updated.count !== 1) {
        const exists = await tx.user.findFirst({
          where: { id: userId, role: UserRole.CUSTOMER },
          select: { id: true },
        });
        if (!exists) throw customerNotFound();
        throw new AppError(
          "Customer account cannot be suspended from its current status",
          {
            code: "INVALID_ACCOUNT_STATUS_TRANSITION",
            statusCode: 409,
          },
        );
      }
      await tx.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await recordAudit(tx, {
        actorUserId,
        action: "ADMIN_CUSTOMER_SUSPENDED",
        entityType: "USER",
        entityId: userId,
        requestId,
        metadata: { reason, to: AccountStatus.SUSPENDED },
      });
    });
    return this.getCustomer(userId);
  }

  async reactivateCustomer(userId: string, actorUserId: string, requestId: string) {
    await this.database.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: {
          id: userId,
          role: UserRole.CUSTOMER,
          accountStatus: AccountStatus.SUSPENDED,
        },
        data: {
          accountStatus: AccountStatus.ACTIVE,
          suspendedAt: null,
          suspendedReason: null,
        },
      });
      if (updated.count !== 1) {
        const exists = await tx.user.findFirst({
          where: { id: userId, role: UserRole.CUSTOMER },
          select: { id: true },
        });
        if (!exists) throw customerNotFound();
        throw new AppError("Customer account is not suspended", {
          code: "INVALID_ACCOUNT_STATUS_TRANSITION",
          statusCode: 409,
        });
      }
      await recordAudit(tx, {
        actorUserId,
        action: "ADMIN_CUSTOMER_REACTIVATED",
        entityType: "USER",
        entityId: userId,
        requestId,
        metadata: { to: AccountStatus.ACTIVE },
      });
    });
    return this.getCustomer(userId);
  }
}
