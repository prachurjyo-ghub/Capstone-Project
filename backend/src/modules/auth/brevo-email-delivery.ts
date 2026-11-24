import type { RecoveryDelivery, PasswordRecoveryMessage } from "./recovery-delivery.js";
import type {
  SupplierInvitationDelivery,
  SupplierInvitationMessage,
} from "../suppliers/supplier-invitation-delivery.js";

type FetchPort = typeof fetch;

export class BrevoTransactionalEmailDelivery
  implements RecoveryDelivery, SupplierInvitationDelivery
{
  constructor(
    private readonly apiKey: string,
    private readonly fromEmail: string,
    private readonly fromName: string,
    private readonly request: FetchPort = fetch,
  ) {}

  private async send(recipient: string, subject: string, textContent: string) {
    const response = await this.request("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": this.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { email: this.fromEmail, name: this.fromName },
        to: [{ email: recipient }],
        subject,
        textContent,
      }),
    });

    if (!response.ok) {
      throw new Error(`Brevo rejected transactional email delivery (${response.status})`);
    }
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
