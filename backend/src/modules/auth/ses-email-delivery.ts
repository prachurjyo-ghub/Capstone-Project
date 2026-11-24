import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { RecoveryDelivery, PasswordRecoveryMessage } from "./recovery-delivery.js";
import type {
  SupplierInvitationDelivery,
  SupplierInvitationMessage,
} from "../suppliers/supplier-invitation-delivery.js";

type SesPort = Pick<SESv2Client, "send">;

export class SesTransactionalEmailDelivery
  implements RecoveryDelivery, SupplierInvitationDelivery
{
  constructor(
    private readonly from: string,
    private readonly client: SesPort = new SESv2Client({}),
  ) {}

  private async send(recipient: string, subject: string, text: string) {
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [recipient] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: "UTF-8" },
            Body: { Text: { Data: text, Charset: "UTF-8" } },
          },
        },
      }),
    );
  }

  deliverPasswordRecovery(message: PasswordRecoveryMessage) {
    return this.send(
      message.recipient,
      "Reset your PartsArc password",
      `Open this single-use link before ${message.expiresAt.toISOString()}:\n\n${message.resetUrl}\n\nIf you did not request this, ignore this email.`,
    );
  }

  deliverSupplierInvitation(message: SupplierInvitationMessage) {
    return this.send(
      message.recipient,
      `Activate your ${message.businessName} supplier account`,
      `You were invited as the initial supplier owner. Open this single-use link before ${message.expiresAt.toISOString()}:\n\n${message.activationUrl}`,
    );
  }
}
