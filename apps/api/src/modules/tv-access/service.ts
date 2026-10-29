import { createHash, randomBytes, randomInt } from "node:crypto";
import { TvAccessError } from "./errors.ts";
import type { TvAccessRepository } from "./repository.ts";

export const tvSessionLifetime = 7 * 24 * 60 * 60;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const tvCookieName = (appOrigin: string) =>
  new URL(appOrigin).protocol === "https:"
    ? "__Host-blackwood-tv"
    : "blackwood-tv-dev";

export function createTvAccessService(
  repository: TvAccessRepository,
  clock = () => new Date(),
) {
  return {
    async issue() {
      const now = clock();
      const code = String(randomInt(10_000)).padStart(4, "0");
      const expiresAt = new Date(now.getTime() + 600_000);
      await repository.issue(hash(code), expiresAt, now);
      return { code, expiresAt: expiresAt.toISOString() };
    },
    async login(code: string, previousToken?: string) {
      const now = clock();
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now.getTime() + tvSessionLifetime * 1000);
      const accepted = await repository.redeem(
        hash(code),
        {
          tokenHash: hash(token),
          createdAt: now,
          expiresAt,
        },
        now,
        previousToken ? hash(previousToken) : undefined,
      );
      if (!accepted) throw new TvAccessError(401, "TV_CODE_INVALID");
      return { token, expiresAt: expiresAt.toISOString() };
    },
    async session(token: string | undefined) {
      if (
        !token ||
        !/^[A-Za-z0-9_-]{43}$/.test(token) ||
        Buffer.from(token, "base64url").toString("base64url") !== token
      )
        throw new TvAccessError(401, "TV_UNAUTHENTICATED");
      if (!(await repository.session(hash(token), clock())))
        throw new TvAccessError(401, "TV_UNAUTHENTICATED");
    },
  };
}
export type TvAccessService = ReturnType<typeof createTvAccessService>;
