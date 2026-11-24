import "express-serve-static-core";
import type { AccountStatus, SupplierBusinessStatus, UserRole } from "@prisma/client";

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: UserRole;
  accountStatus: AccountStatus;
  sessionId: string;
  sessionFamilyId: string;
  mustChangePassword: boolean;
};

export type SupplierAccess = {
  membershipId: string;
  businessId: string;
  businessStatus: SupplierBusinessStatus;
  isPrimary: boolean;
  entitlementEndsAt: Date;
  entitlementSource: "SUBSCRIPTION" | "MIGRATION_GRACE";
};

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
    auth?: AuthenticatedUser;
    supplierAccess?: SupplierAccess;
  }
}
