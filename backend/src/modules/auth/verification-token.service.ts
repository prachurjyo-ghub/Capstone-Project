import type { PrismaClient } from "@prisma/client";
import type { Env } from "../../config/env.js";
import { createOpaqueToken, hashOpaqueToken } from "./token.service.js";

/**
 * Token persistence preparation only. A caller must deliver the raw token and
 * complete a real ownership-verification flow before updating verification fields.
 */
export class VerificationTokenService {
  constructor(
    private readonly database: PrismaClient,
    private readonly env: Env,
  ) {}

  async issue(userId: string, purpose: string, expiresAt: Date): Promise<string> {
    const token = createOpaqueToken();
    await this.database.verificationToken.create({
      data: {
        userId,
        purpose,
        tokenHash: hashOpaqueToken(token, this.env),
        expiresAt,
      },
    });
    return token;
  }

  async consume(userId: string, purpose: string, token: string): Promise<boolean> {
    const now = new Date();
    const result = await this.database.verificationToken.updateMany({
      where: {
        userId,
        purpose,
        tokenHash: hashOpaqueToken(token, this.env),
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    return result.count === 1;
  }
}
