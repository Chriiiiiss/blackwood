import { randomInt } from "node:crypto";

export function generateGuestCode() {
  return String(randomInt(10_000)).padStart(4, "0");
}

export const normalizeGuestCode = (code: string) =>
  code.toUpperCase().replace(/[\s-]/g, "");

// Previously distributed codes remain usable until the organizer rotates them.
export const validGuestCode = (code: string) =>
  /^(?:[0-9]{4}|[0-9A-HJKMNP-TV-Z]{20})$/.test(code);
