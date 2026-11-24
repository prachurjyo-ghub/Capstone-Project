import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NotificationChannel } from "@prisma/client";

export type NotificationDeliveryMessage = {
  channel: NotificationChannel;
  recipient: string;
  title: string;
  body: string;
  eventKey: string;
};

export interface NotificationDeliveryProvider {
  deliver(message: NotificationDeliveryMessage): Promise<void>;
}

export class DisabledNotificationDelivery implements NotificationDeliveryProvider {
  async deliver(_message: NotificationDeliveryMessage): Promise<void> {
    throw new Error("NOTIFICATION_DELIVERY_NOT_CONFIGURED");
  }
}

/** Development-only delivery sink. Files are ignored by Git and contain no auth tokens. */
export class LocalNotificationDelivery implements NotificationDeliveryProvider {
  constructor(private readonly directory: string) {}

  async deliver(message: NotificationDeliveryMessage): Promise<void> {
    const root = path.resolve(this.directory);
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(root, `${Date.now()}-${randomUUID()}.json`),
      JSON.stringify({ ...message, deliveredAt: new Date().toISOString() }, null, 2),
      { flag: "wx", mode: 0o600 },
    );
  }
}
