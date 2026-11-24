import type { PrismaClient } from "@prisma/client";

/** Delete Phase 2 records in foreign-key order without resetting the test database. */
export async function cleanupFulfillment(database: PrismaClient): Promise<void> {
  await database.walletLedgerEntry.deleteMany();
  await database.commissionReservation.deleteMany();
  await database.walletTopUp.deleteMany();
  await database.supplierWallet.deleteMany();
  await database.commissionPolicy.deleteMany();
  await database.notificationDelivery.deleteMany();
  await database.notification.deleteMany();
  await database.outboxEvent.deleteMany();
  await database.operationalCaseHistory.deleteMany();
  await database.operationalCase.deleteMany();
  await database.supplierRecovery.deleteMany();
  await database.settlementAllocation.deleteMany();
  await database.transaction.deleteMany();
  await database.supplierSettlement.deleteMany();
  await database.supplierPayable.deleteMany();
  await database.refund.deleteMany();
  await database.invoiceItem.deleteMany();
  await database.invoice.deleteMany();
  await database.platformBusinessConfig.deleteMany();
  await database.messageAttachment.deleteMany();
  await database.message.deleteMany();
  await database.conversationParticipant.deleteMany();
  await database.conversation.deleteMany();
  await database.urgentFulfillmentHistory.deleteMany();
  await database.orderReturn.deleteMany();
  await database.orderFailure.deleteMany();
  await database.orderCancellationRequest.deleteMany();
  await database.inventoryReservationEvent.deleteMany();
  await database.inventoryReservation.deleteMany();
  await database.deliveryStatusHistory.deleteMany();
  await database.delivery.deleteMany();
  await database.fulfillmentStatusHistory.deleteMany();
  await database.orderConversionAttempt.deleteMany();
  await database.orderItem.deleteMany();
  await database.order.deleteMany();
}
