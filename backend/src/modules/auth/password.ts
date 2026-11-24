import argon2 from "argon2";

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
} as const;

const dummyHashPromise = argon2.hash(
  "PartsArc invalid-credential timing value",
  ARGON2_OPTIONS,
);

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string | undefined,
  password: string,
): Promise<boolean> {
  const hash = passwordHash?.startsWith("$argon2id$")
    ? passwordHash
    : await dummyHashPromise;

  try {
    const valid = await argon2.verify(hash, password);
    return passwordHash?.startsWith("$argon2id$") === true && valid;
  } catch {
    return false;
  }
}
