import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export async function enqueueOutbox(
  database: Db,
  event: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    eventKey: string;
    payload?: Prisma.InputJsonValue;
    availableAt?: Date;
  },
) {
  return database.outboxEvent.upsert({
    where: { eventKey: event.eventKey },
    update: {},
    create: {
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventKey: event.eventKey,
      payload: event.payload ?? {},
      availableAt: event.availableAt,
    },
  });
}
