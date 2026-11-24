import type { Prisma, PrismaClient } from "@prisma/client";

type AuditClient = PrismaClient | Prisma.TransactionClient;

export type AuditEvent = {
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  requestId?: string;
  metadata?: Prisma.InputJsonObject;
};

export async function recordAudit(client: AuditClient, event: AuditEvent): Promise<void> {
  await client.auditLog.create({
    data: {
      actorUserId: event.actorUserId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      requestId: event.requestId,
      metadata: event.metadata,
    },
  });
}

export type AuthAuditEvent = Omit<AuditEvent, "entityType">;

export function recordAuthAudit(
  client: AuditClient,
  event: AuthAuditEvent,
): Promise<void> {
  return recordAudit(client, { ...event, entityType: "USER" });
}
