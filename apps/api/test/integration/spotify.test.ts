import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config/env.ts";
import { createDatabase } from "../../src/db/client.ts";
import {
  organizerSessions,
  spotifyConnection,
  tvPairing,
  tvSessions,
} from "../../src/db/schema.ts";
import { hashPassword } from "../../src/modules/organizer/password.ts";
import { deferred } from "../helpers/deferred.ts";
import { pairTv } from "../helpers/tv.ts";

test("Spotify OAuth binds the browser, survives restart and never exposes credentials to the TV or logs", {
  skip: process.env.BLACKWOOD_ISOLATED_TEST_DB !== "1",
}, async (t) => {
  const password = "Spotify integration password";
  const config = {
    ...loadConfig(),
    appOrigin: "https://blackwood.example",
    organizerPasswordHash: await hashPassword(password),
    spotify: { clientId: "test-client", clientSecret: "private-client-secret" },
  };
  const { db, pool } = createDatabase(config.databaseUrl);
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      logs.push(String(chunk));
      done();
    },
  });
  let exchanges = 0;
  let readCount = 0;
  let exchangeGate: Promise<void> | undefined;
  let entered: (() => void) | undefined;
  const http: typeof fetch = async (url) => {
    if (String(url) === "https://accounts.spotify.com/api/token") {
      exchanges++;
      entered?.();
      await exchangeGate;
      return Response.json({
        access_token: "private-access-token",
        refresh_token: "private-refresh-token",
        expires_in: 3600,
        scope: "user-read-currently-playing",
      });
    }
    assert.equal(
      String(url),
      "https://api.spotify.com/v1/me/player/currently-playing",
    );
    readCount++;
    return Response.json({
      is_playing: true,
      currently_playing_type: "track",
      item: {
        id: "0123456789012345678901",
        type: "track",
        name: "Thriller",
        artists: [{ name: "Michael Jackson" }],
        album: { images: [{ url: "https://i.scdn.co/image/example" }] },
      },
    });
  };
  let app = buildApp(config, { logger: { stream } }, undefined, http);
  t.after(async () => {
    await app.close();
    await db.delete(spotifyConnection);
    await db.delete(organizerSessions);
    await db.delete(tvPairing);
    await db.delete(tvSessions);
    await pool.end();
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/organizer/session",
    headers: { origin: config.appOrigin, "x-organizer-request": "1" },
    payload: { password },
  });
  assert.equal(login.statusCode, 200, login.body);
  const admin = {
    origin: config.appOrigin,
    "x-organizer-request": "1",
    cookie: String(login.headers["set-cookie"]).split(";")[0] ?? "",
  };
  const tv = await pairTv(app, admin);
  const begin = async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/organizer/spotify/authorize",
      headers: admin,
      payload: {},
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.ok(!response.body.includes(config.spotify.clientSecret));
    const state = new URL(response.json().url).searchParams.get("state");
    assert.ok(state);
    const cookie = response.cookies.find((item) =>
      item.name.includes("spotify-state"),
    );
    assert.ok(cookie);
    assert.match(String(response.headers["set-cookie"]), /HttpOnly/);
    assert.match(String(response.headers["set-cookie"]), /SameSite=Lax/);
    assert.match(String(response.headers["set-cookie"]), /Secure/);
    return { state, cookie: `${cookie.name}=${cookie.value}` };
  };
  const callback = (state: string, cookie = "") =>
    app.inject({
      url: `/api/organizer/spotify/callback?code=private-one-use-code&state=${state}`,
      headers: {
        cookie,
        origin: "https://accounts.spotify.com",
        "sec-fetch-site": "cross-site",
      },
    });
  for (const headers of [{}, tv, admin]) {
    const response = await app.inject({
      url: "/api/tv/spotify/current",
      headers,
    });
    assert.equal(
      response.statusCode,
      headers === tv ? 200 : 401,
      response.body,
    );
  }
  assert.equal(
    (
      await app.inject({
        url: "/api/organizer/spotify/status",
        headers: { "x-organizer-request": "1" },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/organizer/spotify/authorize",
        headers: { ...admin, origin: "https://accounts.spotify.com" },
        payload: {},
      })
    ).statusCode,
    403,
  );
  const grant = await begin();
  assert.equal(
    (await callback(grant.state)).headers.location,
    "/organisateur/coffre?spotify=error",
  );
  assert.equal(exchanges, 0);
  assert.equal(
    (await callback(grant.state, grant.cookie)).headers.location,
    "/organisateur/coffre?spotify=connected",
  );
  assert.equal(
    (await callback(grant.state, grant.cookie)).headers.location,
    "/organisateur/coffre?spotify=error",
  );
  assert.equal(exchanges, 1);
  const [stored] = await db.select().from(spotifyConnection);
  assert.ok(stored?.encryptedTokens);
  assert.ok(!stored.encryptedTokens.includes("private-access-token"));
  assert.ok(!stored.encryptedTokens.includes("private-refresh-token"));
  const status = await app.inject({
    url: "/api/organizer/spotify/status",
    headers: admin,
  });
  assert.deepEqual(status.json(), {
    configured: true,
    connected: true,
    redirectUri: `${config.appOrigin}/api/organizer/spotify/callback`,
  });
  const current = await app.inject({
    url: "/api/tv/spotify/current",
    headers: tv,
  });
  assert.equal(current.statusCode, 200, current.body);
  assert.equal(current.json().track.title, "Thriller");
  assert.deepEqual(Object.keys(current.json().track).sort(), [
    "artists",
    "coverUrl",
    "id",
    "spotifyUrl",
    "title",
  ]);
  assert.equal(current.headers["cache-control"], "no-store");
  await app.inject({ url: "/api/tv/spotify/current", headers: tv });
  assert.equal(readCount, 1);
  await app.close();
  app = buildApp(config, { logger: { stream } }, undefined, http);
  assert.equal(
    (
      await app.inject({ url: "/api/organizer/spotify/status", headers: admin })
    ).json().connected,
    true,
  );
  assert.equal(
    (await app.inject({ url: "/api/tv/spotify/current", headers: tv })).json()
      .track.title,
    "Thriller",
  );

  // Logout while Spotify exchanges the code must win over the late callback.
  const late = await begin();
  const started = deferred<void>();
  const release = deferred<void>();
  entered = started.resolve;
  exchangeGate = release.promise;
  const pending = callback(late.state, late.cookie).then(
    (response) => response,
  );
  await started.promise;
  const disconnected = await app.inject({
    method: "DELETE",
    url: "/api/organizer/spotify/connection",
    headers: admin,
  });
  assert.equal(disconnected.statusCode, 204, disconnected.body);
  await db
    .delete(organizerSessions)
    .where(
      eq(
        organizerSessions.tokenHash,
        (await db.select().from(organizerSessions))[0]?.tokenHash ?? "",
      ),
    );
  release.resolve();
  assert.equal(
    (await pending).headers.location,
    "/organisateur/coffre?spotify=error",
  );
  assert.equal(
    (await db.select().from(spotifyConnection))[0]?.encryptedTokens,
    null,
  );
  assert.deepEqual(
    (await app.inject({ url: "/api/tv/spotify/current", headers: tv })).json(),
    { track: null },
  );
  const text = logs.join("");
  for (const secret of [
    "private-client-secret",
    "private-access-token",
    "private-refresh-token",
    "private-one-use-code",
    grant.state,
  ])
    assert.ok(
      !text.includes(secret),
      `Logs must not include ${secret.slice(0, 8)}…`,
    );
});
