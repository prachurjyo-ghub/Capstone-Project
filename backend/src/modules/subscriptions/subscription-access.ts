import {
  SupplierSubscriptionStatus,
  type PrismaClient,
  type Prisma,
} from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export async function hasCurrentSupplierEntitlement(
  database: Db,
  businessId: string,
  now = new Date(),
) {
  const business = await database.supplierBusiness.findUnique({
    where: { id: businessId },
    select: {
      subscriptionGraceEndsAt: true,
      subscriptions: {
        where: {
          status: {
            in: [SupplierSubscriptionStatus.ACTIVE, SupplierSubscriptionStatus.SCHEDULED],
          },
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
        select: { id: true, endsAt: true, status: true },
        orderBy: { endsAt: "desc" },
        take: 1,
      },
    },
  });
  if (!business) return null;
  const subscription = business.subscriptions[0];
  if (subscription) return { source: "SUBSCRIPTION" as const, ...subscription };
  if (business.subscriptionGraceEndsAt && business.subscriptionGraceEndsAt > now) {
    return {
      source: "MIGRATION_GRACE" as const,
      id: null,
      endsAt: business.subscriptionGraceEndsAt,
      status: null,
    };
  }
  return null;
}
