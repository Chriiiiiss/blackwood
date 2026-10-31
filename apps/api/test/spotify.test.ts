import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { parseEnv } from "../src/config/env.ts";
import {
  createSpotifyProvider,
  SpotifyError,
  type SpotifyProvider,
} from "../src/modules/spotify/provider.ts";
import type { SpotifyRepository } from "../src/modules/spotify/repository.ts";
import { createSpotifyService } from "../src/modules/spotify/service.ts";
import { spotifyTokenCipher } from "../src/modules/spotify/tokens.ts";
import { deferred } from "./helpers/deferred.ts";

const config = {
  clientId: "test-client",
  clientSecret: "private-client-secret",
};
const tokens = {
  accessToken: "private-access-token",
  refreshToken: "private-refresh-token",
  expiresIn: 3600,
};
const track = {
  id: "0123456789012345678901",
  title: "Thriller",
  artists: ["Michael Jackson"],
  coverUrl: "https://i.scdn.co/image/example",
  spotifyUrl: "https://open.spotify.com/track/0123456789012345678901",
};

function setup() {
  let now = new Date("2026-10-31T20:00:00Z");
  const row: Awaited<ReturnType<SpotifyRepository["connection"]>> = {
    id: 1,
    revision: randomUUID(),
    encryptedTokens: null,
    expiresAt: null,
    updatedAt: now,
  };
  let validSession = true;
  const repository: SpotifyRepository = {
    async connection() {
      return { ...row };
    },
    async authorize(
      _session,
      _credential,
      revision,
      encryptedTokens,
      expiresAt,
    ) {
      if (!validSession || revision !== row.revision) return false;
      Object.assign(row, {
        encryptedTokens,
        expiresAt,
        revision: randomUUID(),
      });
      return true;
    },
    async refresh(revision, encryptedTokens, expiresAt) {
      if (revision !== row.revision) return false;
      Object.assign(row, { encryptedTokens, expiresAt });
      return true;
    },
    async disconnect(revision) {
      if (revision && revision !== row.revision) return;
      Object.assign(row, {
        revision: randomUUID(),
        encryptedTokens: null,
        expiresAt: null,
      });
    },
  };
  let reads = 0,
    refreshes = 0,
    exchanges = 0;
  const provider: SpotifyProvider = {
    async exchange() {
      exchanges++;
      return tokens;
    },
    async refresh() {
      refreshes++;
      return { ...tokens, accessToken: "refreshed-access-token" };
    },
    async current() {
      reads++;
      return track;
    },
  };
  const service = createSpotifyService(
    repository,
    {
      async touchSession() {
        return validSession
          ? { expiresAt: new Date(now.getTime() + 3600000) }
          : undefined;
      },
    },
    config,
    "password-hash",
    "https://blackwood.example",
    provider,
    () => now,
  );
  return {
    service,
    row,
    provider,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    revoke() {
      validSession = false;
    },
    counts: () => ({ reads, refreshes, exchanges }),
    async connect() {
      const grant = await service.begin("organizer-token");
      assert.equal(
        await service.finish(grant.state, grant.state, "code"),
        "connected",
      );
    },
  };
}

test("Spotify configuration is optional, paired and restricted to valid redirect origins", () => {
  const base = { DATABASE_URL: "postgresql://test:test@127.0.0.1/test" };
  assert.equal(parseEnv(base).spotify, undefined);
  assert.throws(
    () => parseEnv({ ...base, SPOTIFY_CLIENT_ID: config.clientId }),
    /both SPOTIFY/,
  );
  assert.throws(
    () =>
      parseEnv({
        ...base,
        SPOTIFY_CLIENT_ID: config.clientId,
        SPOTIFY_CLIENT_SECRET: config.clientSecret,
      }),
    /HTTPS/,
  );
  assert.deepEqual(
    parseEnv({
      ...base,
      APP_ORIGIN: "http://127.0.0.1:5187",
      SPOTIFY_CLIENT_ID: config.clientId,
      SPOTIFY_CLIENT_SECRET: config.clientSecret,
    }).spotify,
    config,
  );
});

test("Spotify tokens use authenticated encryption and reject tampering or another secret", () => {
  const cipher = spotifyTokenCipher(config);
  const encrypted = cipher.encrypt(tokens);
  assert.ok(!encrypted.includes(tokens.accessToken));
  assert.ok(!encrypted.includes(tokens.refreshToken));
  assert.deepEqual(cipher.decrypt(encrypted), {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
  assert.notEqual(cipher.encrypt(tokens), encrypted);
  assert.throws(() =>
    spotifyTokenCipher({ ...config, clientSecret: "different" }).decrypt(
      encrypted,
    ),
  );
  const parts = encrypted.split(".");
  parts[1] = Buffer.alloc(16).toString("base64url");
  assert.throws(() => cipher.decrypt(parts.join(".")));
});

test("Spotify authorization binds a one-use browser state to a live organizer session", async () => {
  const f = setup();
  const grant = await f.service.begin("organizer-token");
  const url = new URL(grant.url);
  assert.equal(url.origin, "https://accounts.spotify.com");
  assert.equal(url.searchParams.get("scope"), "user-read-currently-playing");
  assert.equal(
    await f.service.finish(grant.state, "different", "code"),
    "error",
  );
  assert.equal(
    await f.service.finish(grant.state, grant.state, "code"),
    "connected",
  );
  assert.equal(
    await f.service.finish(grant.state, grant.state, "code"),
    "error",
  );
  assert.equal(f.counts().exchanges, 1);
  const stale = await f.service.begin("organizer-token");
  f.revoke();
  assert.equal(
    await f.service.finish(stale.state, stale.state, "code"),
    "error",
  );
  assert.equal(f.counts().exchanges, 1);
});

test("expired, denied and disconnected Spotify grants cannot connect", async () => {
  const f = setup();
  const expired = await f.service.begin("organizer-token");
  f.advance(600001);
  assert.equal(
    await f.service.finish(expired.state, expired.state, "code"),
    "error",
  );
  const denied = await f.service.begin("organizer-token");
  assert.equal(
    await f.service.finish(denied.state, denied.state, undefined, true),
    "denied",
  );
  const canceled = await f.service.begin("organizer-token");
  await f.service.disconnect();
  assert.equal(
    await f.service.finish(canceled.state, canceled.state, "code"),
    "error",
  );
  assert.equal(f.counts().exchanges, 0);
});

test("TV readers share one cached Spotify request and refresh expiring tokens", async () => {
  const f = setup();
  await f.connect();
  assert.deepEqual(
    await Promise.all([
      f.service.current(),
      f.service.current(),
      f.service.current(),
    ]),
    [track, track, track],
  );
  await f.service.current();
  assert.equal(f.counts().reads, 1);
  f.advance(3571000);
  assert.deepEqual(await f.service.current(), track);
  assert.equal(f.counts().refreshes, 1);
  assert.equal(
    spotifyTokenCipher(config).decrypt(f.row.encryptedTokens ?? "").accessToken,
    "refreshed-access-token",
  );
});

test("Spotify rate limits back off without disconnecting or blocking the TV", async () => {
  const f = setup();
  await f.connect();
  let calls = 0;
  f.provider.current = async () => {
    calls++;
    throw new SpotifyError(429, 60);
  };
  assert.equal(await f.service.current(), null);
  f.advance(59000);
  assert.equal(await f.service.current(), null);
  assert.equal(calls, 1);
  assert.equal((await f.service.status()).connected, true);
  f.advance(1001);
  await f.service.current();
  assert.equal(calls, 2);
});

test("Spotify retries an expired access token once and clears revoked grants", async () => {
  const f = setup();
  await f.connect();
  let calls = 0;
  f.provider.current = async () => {
    if (++calls === 1) throw new SpotifyError(401, 30, true);
    return track;
  };
  assert.deepEqual(await f.service.current(), track);
  assert.equal(f.counts().refreshes, 1);
  f.advance(5001);
  f.provider.current = async () => {
    throw new SpotifyError(401, 30, true);
  };
  f.provider.refresh = async () => {
    throw new SpotifyError(400, 30, true);
  };
  assert.equal(await f.service.current(), null);
  assert.equal((await f.service.status()).connected, false);
});

test("disconnect during an in-flight Spotify refresh cannot restore tokens or its alert", async () => {
  const f = setup();
  await f.connect();
  f.advance(3571000);
  const entered = deferred<void>();
  const refreshed = deferred<typeof tokens>();
  f.provider.refresh = () => {
    entered.resolve();
    return refreshed.promise;
  };
  const read = f.service.current();
  await entered.promise;
  await f.service.disconnect();
  refreshed.resolve(tokens);
  assert.equal(await read, null);
  assert.equal(f.row.encryptedTokens, null);
  assert.equal(await f.service.current(), null);
});

test("Spotify provider uses official endpoints, refresh fallback and minimal track metadata", async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  let body: unknown = {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_in: 3600,
    scope: "user-read-currently-playing",
  };
  const http: typeof fetch = async (url, options) => {
    calls.push({ url: String(url), ...(options ? { options } : {}) });
    return Response.json(body);
  };
  const provider = createSpotifyProvider(config, http);
  assert.deepEqual(
    await provider.exchange(
      "one-use-code",
      "https://blackwood.example/api/organizer/spotify/callback",
    ),
    tokens,
  );
  assert.equal(calls[0]?.url, "https://accounts.spotify.com/api/token");
  assert.match(
    new Headers(calls[0]?.options?.headers).get("authorization") ?? "",
    /^Basic /,
  );
  assert.equal(
    new URLSearchParams(String(calls[0]?.options?.body)).get("code"),
    "one-use-code",
  );
  body = { access_token: tokens.accessToken, expires_in: 3600 };
  assert.deepEqual(await provider.refresh(tokens.refreshToken), tokens);
  body = {
    is_playing: true,
    currently_playing_type: "track",
    item: {
      id: track.id,
      name: track.title,
      type: "track",
      artists: [{ name: track.artists[0], privateData: "ignored" }],
      album: {
        images: [
          { url: "https://untrusted.example/image" },
          { url: track.coverUrl },
        ],
      },
      privateData: "ignored",
    },
  };
  assert.deepEqual(await provider.current(tokens.accessToken), track);
  assert.equal(
    calls.at(-1)?.url,
    "https://api.spotify.com/v1/me/player/currently-playing",
  );
  for (const value of [
    { is_playing: false },
    { is_playing: true, currently_playing_type: "ad" },
    {
      is_playing: true,
      currently_playing_type: "track",
      item: { type: "track", id: null },
    },
  ]) {
    body = value;
    assert.equal(await provider.current(tokens.accessToken), null);
  }
  const limited = createSpotifyProvider(
    config,
    async () =>
      new Response(null, { status: 429, headers: { "retry-after": "55" } }),
  );
  await assert.rejects(
    limited.current(tokens.accessToken),
    (e: unknown) =>
      e instanceof SpotifyError && e.status === 429 && e.retryAfter === 55,
  );
});
