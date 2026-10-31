import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { fingerprint } from "../organizer/password.ts";
import type { OrganizerRepository } from "../organizer/repository.ts";
import {
  type SpotifyConfig,
  SpotifyError,
  type SpotifyProvider,
  type SpotifyTrack,
} from "./provider.ts";
import type { SpotifyRepository } from "./repository.ts";
import { spotifyTokenCipher } from "./tokens.ts";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function createSpotifyService(
  repository: SpotifyRepository,
  organizer: Pick<OrganizerRepository, "touchSession">,
  config: SpotifyConfig | undefined,
  passwordHash: string | undefined,
  appOrigin: string,
  provider: SpotifyProvider | undefined,
  clock = () => new Date(),
) {
  const redirectUri = `${appOrigin}/api/organizer/spotify/callback`;
  const cipher = config ? spotifyTokenCipher(config) : undefined;
  const pending = new Map<
    string,
    { sessionHash: string; revision: string; expires: number }
  >();
  let generation = 0;
  let cached: { track: SpotifyTrack | null; until: number } | undefined;
  let flight: Promise<SpotifyTrack | null> | undefined;
  const invalidate = () => {
    generation++;
    cached = undefined;
    pending.clear();
  };
  async function current(): Promise<SpotifyTrack | null> {
    if (!provider || !cipher) return null;
    if (cached && clock().getTime() < cached.until) return cached.track;
    if (flight) return flight;
    const started = generation;
    const run = async () => {
      let revision: string | undefined;
      try {
        const row = await repository.connection();
        revision = row.revision;
        if (!row.encryptedTokens || !row.expiresAt) {
          cached = { track: null, until: clock().getTime() + 5000 };
          return null;
        }
        let tokens = cipher.decrypt(row.encryptedTokens);
        const refresh = async () => {
          const fresh = await provider.refresh(tokens.refreshToken);
          if (
            started !== generation ||
            !(await repository.refresh(
              row.revision,
              cipher.encrypt(fresh),
              new Date(clock().getTime() + fresh.expiresIn * 1000),
            ))
          )
            throw new SpotifyError(401);
          tokens = fresh;
        };
        if (row.expiresAt.getTime() <= clock().getTime() + 30000)
          await refresh();
        let track: SpotifyTrack | null;
        try {
          track = await provider.current(tokens.accessToken);
        } catch (error) {
          if (!(error instanceof SpotifyError) || error.status !== 401)
            throw error;
          await refresh();
          track = await provider.current(tokens.accessToken);
        }
        if (started !== generation) return null;
        cached = { track, until: clock().getTime() + 5000 };
        return track;
      } catch (error) {
        if (started !== generation) return null;
        if (error instanceof SpotifyError && error.revoked && revision) {
          await repository.disconnect(revision);
          generation++;
        }
        const wait =
          error instanceof SpotifyError ? Math.max(1, error.retryAfter) : 30;
        cached = { track: null, until: clock().getTime() + wait * 1000 };
        return null;
      }
    };
    flight = run();
    try {
      return await flight;
    } finally {
      flight = undefined;
    }
  }
  return {
    async status() {
      if (!config || !cipher)
        return { configured: false, connected: false, redirectUri };
      const row = await repository.connection();
      let connected = false;
      if (row.encryptedTokens) {
        try {
          cipher.decrypt(row.encryptedTokens);
          connected = true;
        } catch {
          /* Reconnecting replaces an obsolete encrypted grant. */
        }
      }
      return { configured: true, connected, redirectUri };
    },
    async begin(sessionToken: string) {
      if (!config || !passwordHash) throw new SpotifyError(503);
      const now = clock().getTime();
      for (const [key, value] of pending)
        if (value.expires <= now) pending.delete(key);
      if (pending.size >= 50) throw new SpotifyError(429);
      const state = randomBytes(32).toString("base64url");
      const row = await repository.connection();
      pending.set(hash(state), {
        sessionHash: fingerprint(sessionToken),
        revision: row.revision,
        expires: now + 600000,
      });
      const url = new URL("https://accounts.spotify.com/authorize");
      url.search = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: "user-read-currently-playing",
        state,
      }).toString();
      return { url: url.href, state };
    },
    async finish(
      state: string,
      cookie: string | undefined,
      code?: string,
      denied = false,
    ) {
      if (
        !provider ||
        !cipher ||
        !passwordHash ||
        !cookie ||
        !/^[\w-]{43}$/.test(state) ||
        state.length !== cookie.length ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(cookie))
      )
        return "error" as const;
      const grant = pending.get(hash(state));
      pending.delete(hash(state));
      if (!grant || grant.expires <= clock().getTime()) return "error" as const;
      const credential = fingerprint(passwordHash);
      if (
        !(await organizer.touchSession(grant.sessionHash, credential, clock()))
      )
        return "error" as const;
      if (denied) return "denied" as const;
      if (!code) return "error" as const;
      const tokens = await provider.exchange(code, redirectUri);
      const accepted = await repository.authorize(
        grant.sessionHash,
        credential,
        grant.revision,
        cipher.encrypt(tokens),
        new Date(clock().getTime() + tokens.expiresIn * 1000),
        clock(),
      );
      if (!accepted) return "error" as const;
      invalidate();
      return "connected" as const;
    },
    async disconnect() {
      invalidate();
      await repository.connection();
      await repository.disconnect();
    },
    current,
  };
}
export type SpotifyService = ReturnType<typeof createSpotifyService>;
