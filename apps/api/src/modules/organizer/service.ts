import { randomBytes } from "node:crypto";
import { OrganizerError } from "./errors.ts";
import { fingerprint, verifyPassword } from "./password.ts";
import type { OrganizerRepository } from "./repository.ts";

export const sessionLifetime = 604_800;
const validToken = (token: string | undefined): token is string =>
  token !== undefined &&
  /^[\w-]{43}$/.test(token) &&
  Buffer.from(token, "base64url").toString("base64url") === token;

function sessionInfo(expiresAt: Date, now: Date) {
  return {
    authenticated: true as const,
    expiresAt: expiresAt.toISOString(),
    idleExpiresAt: new Date(
      Math.min(expiresAt.getTime(), now.getTime() + 86_400_000),
    ).toISOString(),
  };
}

export function createOrganizerService(
  repository: OrganizerRepository,
  passwordHash: string | undefined,
  clock = () => new Date(),
) {
  let verifying = false;
  function requireEnabled() {
    if (!passwordHash) throw new OrganizerError(503, "ORGANIZER_UNAVAILABLE");
    return passwordHash;
  }
  return {
    async prepare(isLogin: boolean) {
      requireEnabled();
      const now = clock();
      if (isLogin) {
        const limit = await repository.consumeLoginAttempt(now);
        if (!limit.allowed)
          throw new OrganizerError(429, "LOGIN_RATE_LIMITED", limit.retryAfter);
      }
      await repository.cleanExpired(now);
    },
    async hubSettings() {
      return repository.readHubSettings();
    },
    async saveHubSettings(hubEnabled: boolean) {
      return repository.saveHubSettings(hubEnabled);
    },
    async login(password: string, previousToken?: string) {
      const passwordHash = requireEnabled();
      if (verifying) throw new OrganizerError(429, "LOGIN_RATE_LIMITED", 1);
      verifying = true;
      try {
        if (!(await verifyPassword(password, passwordHash)))
          throw new OrganizerError(401, "INVALID_CREDENTIALS");
        const now = clock();
        const expiresAt = new Date(now.getTime() + sessionLifetime * 1000);
        const token = randomBytes(32).toString("base64url");
        await repository.createSession(
          {
            tokenHash: fingerprint(token),
            credentialFingerprint: fingerprint(passwordHash),
            createdAt: now,
            lastActivity: now,
            expiresAt,
          },
          validToken(previousToken) ? fingerprint(previousToken) : undefined,
        );
        return { token, info: sessionInfo(expiresAt, now) };
      } finally {
        verifying = false;
      }
    },
    async session(token?: string) {
      const passwordHash = requireEnabled();
      if (!validToken(token)) throw new OrganizerError(401, "UNAUTHENTICATED");
      const now = clock();
      const row = await repository.touchSession(
        fingerprint(token),
        fingerprint(passwordHash),
        now,
      );
      if (!row) throw new OrganizerError(401, "UNAUTHENTICATED");
      return sessionInfo(row.expiresAt, now);
    },
    async logout(token?: string) {
      requireEnabled();
      if (validToken(token)) await repository.revokeSession(fingerprint(token));
    },
    async responses() {
      const responses = await repository.readResponses();
      const totals = { attending: 0, toConfirm: 0, plusOnes: 0 };
      for (const row of responses) {
        if (row.attendance === "yes") {
          totals.attending++;
          if (row.plusOne) totals.plusOnes++;
        } else if (row.attendance === "to_confirm") totals.toConfirm++;
      }
      return { responses, totals };
    },
  };
}

export type OrganizerService = ReturnType<typeof createOrganizerService>;
