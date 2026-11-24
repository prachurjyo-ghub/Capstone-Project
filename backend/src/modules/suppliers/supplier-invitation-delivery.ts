import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export type SupplierInvitationMessage = {
  recipient: string;
  businessName: string;
  activationUrl: string;
  expiresAt: Date;
};

export interface SupplierInvitationDelivery {
  deliverSupplierInvitation(message: SupplierInvitationMessage): Promise<void>;
}

export class LocalFileSupplierInvitationDelivery implements SupplierInvitationDelivery {
  constructor(private readonly outboxDirectory: string) {}

  async deliverSupplierInvitation(message: SupplierInvitationMessage): Promise<void> {
    const directory = resolve(this.outboxDirectory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = resolve(
      directory,
      `${Date.now()}-${randomUUID()}-supplier-invitation.json`,
    );
    await writeFile(
      file,
      `${JSON.stringify(
        {
          type: "supplier-owner-invitation",
          recipient: message.recipient,
          businessName: message.businessName,
          activationUrl: message.activationUrl,
          expiresAt: message.expiresAt.toISOString(),
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }
}

export class DisabledSupplierInvitationDelivery implements SupplierInvitationDelivery {
  async deliverSupplierInvitation(_message: SupplierInvitationMessage): Promise<void> {
    throw new Error("Supplier invitation delivery is not configured");
  }
}
