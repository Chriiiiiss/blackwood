import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const prefix = "scrypt$v1$131072$8$1$";
const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

export function parsePasswordHash(value: string) {
  const match = /^scrypt\$v1\$131072\$8\$1\$([\w-]{22})\$([\w-]{86})$/.exec(
    value,
  );
  if (!match?.[1] || !match[2])
    throw new Error("ORGANIZER_PASSWORD_HASH is invalid.");
  const salt = Buffer.from(match[1], "base64url");
  const hash = Buffer.from(match[2], "base64url");
  if (
    salt.length !== 16 ||
    hash.length !== 64 ||
    salt.toString("base64url") !== match[1] ||
    hash.toString("base64url") !== match[2]
  ) {
    throw new Error("ORGANIZER_PASSWORD_HASH is invalid.");
  }
  return { salt, hash };
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export function passwordWithinLimits(password: string, minimum = 1) {
  const length = [...password].length;
  return (
    length >= minimum && length <= 128 && Buffer.byteLength(password) <= 512
  );
}

export async function hashPassword(password: string) {
  if (!passwordWithinLimits(password, 20))
    throw new Error(
      "Use a password of 20–128 characters, at most 512 UTF-8 bytes.",
    );
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `${prefix}${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const { salt, hash } = parsePasswordHash(encoded);
  return timingSafeEqual(await derive(password, salt), hash);
}

export const fingerprint = (value: string) =>
  createHash("sha256").update(value).digest("hex");
