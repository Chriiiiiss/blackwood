import { randomBytes } from "node:crypto";

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateGuestCode() {
  const code = Array.from(randomBytes(20), (byte) => alphabet[byte & 31]).join(
    "",
  );
  return code.match(/.{4}/g)?.join("-") ?? code;
}

export const normalizeGuestCode = (code: string) =>
  code.toUpperCase().replace(/[\s-]/g, "");

export const validGuestCode = (code: string) =>
  /^[0-9A-HJKMNP-TV-Z]{20}$/.test(code);
