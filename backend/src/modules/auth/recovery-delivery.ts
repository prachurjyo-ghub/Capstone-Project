import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type PasswordRecoveryMessage = {
  recipient: string;
  resetUrl: string;
  expiresAt: Date;
};

export interface RecoveryDelivery {
  deliverPasswordRecovery(message: PasswordRecoveryMessage): Promise<void>;
}

export class LocalFileRecoveryDelivery implements RecoveryDelivery {
  constructor(private readonly outboxDirectory: string) {}

  async deliverPasswordRecovery(message: PasswordRecoveryMessage): Promise<void> {
    const directory = resolve(this.outboxDirectory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = resolve(directory, `${Date.now()}-${randomUUID()}.json`);
    await writeFile(
      file,
      `${JSON.stringify(
        {
          recipient: message.recipient,
          resetUrl: message.resetUrl,
          expiresAt: message.expiresAt.toISOString(),
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }
}

export class DisabledRecoveryDelivery implements RecoveryDelivery {
  async deliverPasswordRecovery(_message: PasswordRecoveryMessage): Promise<void> {
    // Production deliberately has no fallback that could expose raw recovery tokens.
  }
}
