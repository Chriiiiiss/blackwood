import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config/env.ts";
import { createDatabase } from "../../src/db/client.ts";
import { tvPairing, tvSessions } from "../../src/db/schema.ts";
import { hashPassword } from "../../src/modules/organizer/password.ts";

test("four-digit TV pairing is single-use, bounded and independent of guest access", {
  skip: process.env.BLACKWOOD_ISOLATED_TEST_DB !== "1",
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "blackwood-tv-access-"));
  const password = "TV pairing integration password";
  const config = {
    ...loadConfig(),
    mediaRoot: root,
    organizerPasswordHash: await hashPassword(password),
  };
  const { db, pool } = createDatabase(config.databaseUrl);
  let app = buildApp(config, { logger: false });
  const createdHashes: string[] = [];
  t.after(async () => {
    await app.close();
    for (const value of createdHashes)
      await db.delete(tvSessions).where(eq(tvSessions.tokenHash, value));
    await db.delete(tvPairing);
    await pool.end();
    await rm(root, { recursive: true, force: true });
  });
  const origin = config.appOrigin;
  const login = await app.inject({
    method: "POST",
    url: "/api/organizer/session",
    headers: { origin, "x-organizer-request": "1" },
    payload: { password },
  });
  assert.equal(login.statusCode, 200, login.body);
  const admin = {
    origin,
    "x-organizer-request": "1",
    cookie: String(login.headers["set-cookie"]).split(";")[0] ?? "",
  };
  const pairingUrl = "/api/organizer/tv/pairing";
  const loginUrl = "/api/tv/session";
  const issue = () =>
    app.inject({
      method: "POST",
      url: pairingUrl,
      headers: admin,
      payload: {},
    });
  const redeem = (code: unknown, headers = { origin, "x-tv-request": "1" }) =>
    app.inject({ method: "POST", url: loginUrl, headers, payload: { code } });

  for (const headers of [
    { origin, "x-organizer-request": "1" },
    { ...admin, origin: "https://other.test" },
    { ...admin, "x-organizer-request": "" },
  ]) {
    assert.ok(
      [401, 403].includes(
        (
          await app.inject({
            method: "POST",
            url: pairingUrl,
            headers,
            payload: {},
          })
        ).statusCode,
      ),
    );
  }
  const issued = await issue();
  assert.equal(issued.statusCode, 200, issued.body);
  const { code, expiresAt } = issued.json();
  assert.match(code, /^[0-9]{4}$/);
  assert.ok(Date.parse(expiresAt) > Date.now() + 590_000);
  assert.equal(issued.headers["cache-control"], "private, no-store");
  const [stored] = await db.select().from(tvPairing);
  assert.equal(
    stored?.codeHash,
    createHash("sha256").update(code).digest("hex"),
  );
  for (const headers of [
    { origin, "x-tv-request": "" },
    { origin: "https://other.test", "x-tv-request": "1" },
  ]) {
    assert.equal((await redeem(code, headers)).statusCode, 403);
  }
  for (const value of [1234, "123", "12345", "ABCD", null])
    assert.equal((await redeem(value)).statusCode, 400);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: loginUrl,
        headers: { origin, "x-tv-request": "1" },
        payload: { code, extra: true },
      })
    ).statusCode,
    400,
  );

  // Two simultaneous uses of a valid short code must never create two sessions.
  const attempts = await Promise.all([redeem(code), redeem(code)]);
  assert.deepEqual(
    attempts.map((value) => value.statusCode).sort(),
    [200, 401],
  );
  const accepted = attempts.find((value) => value.statusCode === 200);
  assert.ok(accepted);
  assert.deepEqual(Object.keys(accepted.json()), ["expiresAt"]);
  const tvCookie = accepted.cookies.find((value) =>
    value.name.includes("blackwood-tv"),
  );
  assert.ok(tvCookie);
  const tokenHash = createHash("sha256").update(tvCookie.value).digest("hex");
  createdHashes.push(tokenHash);
  const tv = { cookie: `${tvCookie.name}=${tvCookie.value}` };
  assert.match(String(accepted.headers["set-cookie"]), /HttpOnly/);
  assert.match(String(accepted.headers["set-cookie"]), /SameSite=Strict/);
  assert.match(String(accepted.headers["set-cookie"]), /Max-Age=604800/);
  assert.equal(
    (await app.inject({ url: "/api/tv/coffre", headers: tv })).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ url: "/api/tv/coffre", headers: admin })).statusCode,
    401,
  );
  for (const url of ["/api/profiles/me", "/api/coffre"])
    assert.equal((await app.inject({ url, headers: tv })).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/coffre/contributions",
        headers: { ...tv, origin, "x-guest-request": "1" },
        payload: {},
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: pairingUrl,
        headers: { ...tv, origin, "x-organizer-request": "1" },
        payload: {},
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        url: "/api/organizer/coffre",
        headers: { ...tv, "x-organizer-request": "1" },
      })
    ).statusCode,
    401,
  );

  await app.close();
  app = buildApp(config, { logger: false });
  assert.equal(
    (await app.inject({ url: "/api/tv/coffre", headers: tv })).statusCode,
    200,
  );
  const next = (await issue()).json().code;
  const wrong = next === "0000" ? "1111" : "0000";
  await Promise.all(Array.from({ length: 8 }, () => redeem(wrong)));
  const [exhausted] = await db.select().from(tvPairing);
  assert.equal(exhausted?.attempts, 5);
  assert.equal((await redeem(next)).statusCode, 401);
  assert.equal(
    (await app.inject({ url: "/api/tv/coffre", headers: tv })).statusCode,
    200,
  );
  const expiring = (await issue()).json().code;
  await db.update(tvPairing).set({ expiresAt: new Date(Date.now() - 1) });
  assert.equal((await redeem(expiring)).statusCode, 401);
  // Replacing the pending code invalidates it without disconnecting paired screens.
  const previous = (await issue()).json().code;
  let replacement = (await issue()).json().code;
  while (replacement === previous) replacement = (await issue()).json().code;
  assert.equal((await redeem(previous)).statusCode, 401);
  assert.equal(
    (await app.inject({ url: "/api/tv/coffre", headers: tv })).statusCode,
    200,
  );
  await db
    .update(tvSessions)
    .set({ expiresAt: new Date(Date.now() - 1) })
    .where(eq(tvSessions.tokenHash, tokenHash));
  assert.equal(
    (await app.inject({ url: "/api/tv/coffre", headers: tv })).statusCode,
    401,
  );
});
