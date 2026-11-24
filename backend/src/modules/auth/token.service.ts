import { createHmac, randomBytes } from "node:crypto";
import type { UserRole } from "@prisma/client";
import { jwtVerify, SignJWT } from "jose";
import type { Env } from "../../config/env.js";

const ACCESS_TOKEN_ALGORITHM = "HS256";

export type AccessTokenClaims = {
  userId: string;
  sessionId: string;
  role: UserRole;
};

export function createOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashOpaqueToken(token: string, env: Env): string {
  return createHmac("sha256", env.TOKEN_HASH_SECRET).update(token).digest("hex");
}

export async function signAccessToken(
  claims: AccessTokenClaims,
  env: Env,
): Promise<string> {
  return new SignJWT({ sid: claims.sessionId, role: claims.role })
    .setProtectedHeader({ alg: ACCESS_TOKEN_ALGORITHM, typ: "JWT" })
    .setSubject(claims.userId)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(env.ACCESS_TOKEN_SECRET));
}

export async function verifyAccessToken(
  token: string,
  env: Env,
): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(
    token,
    new TextEncoder().encode(env.ACCESS_TOKEN_SECRET),
    {
      algorithms: [ACCESS_TOKEN_ALGORITHM],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      maxTokenAge: `${env.ACCESS_TOKEN_TTL_SECONDS}s`,
    },
  );

  if (
    typeof payload.sub !== "string" ||
    typeof payload.sid !== "string" ||
    typeof payload.role !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("Access token claims are invalid");
  }

  return {
    userId: payload.sub,
    sessionId: payload.sid,
    role: payload.role as UserRole,
  };
}
