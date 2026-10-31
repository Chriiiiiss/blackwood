import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../src/app.ts";
import { parseEnv } from "../src/config/env.ts";
import { defaultPartyOpensAt } from "../src/modules/party-access/service.ts";

const config = {
  databaseUrl: "postgresql://user:secret@127.0.0.1:5432/test",
  appOrigin: "http://localhost:5173",
};
test("guest activities use server time and open exactly at 21:00 Paris; admin and TV stay independent", async (t) => {
  t.mock.method(Pool.prototype, "query", async () => ({ rows: [] }));
  t.mock.method(Pool.prototype, "end", async () => {});
  let time = new Date("2026-10-31T19:59:59.999Z");
  const app = buildApp(config, { logger: false }, () => time);
  t.after(() => app.close());
  const state = await app.inject({ url: "/api/party-access" });
  assert.deepEqual(state.json(), {
    opensAt: defaultPartyOpensAt,
    serverNow: time.toISOString(),
    isOpen: false,
  });
  assert.equal(state.headers["cache-control"], "no-store");
  for (const [method, url] of [
    ["GET", "/api/coffre"],
    ["GET", "/api/coffre?coffreId=1"],
    ["POST", "/api/coffre/contributions"],
    ["GET", "/api/missions/me"],
    ["GET", "/api/missions/players"],
    ["GET", "/api/missions/me/confirmations"],
    ["POST", "/api/missions/me/assignments"],
  ] as const) {
    const response = await app.inject({
      method,
      url,
      headers: {
        origin: config.appOrigin,
        "x-guest-request": "1",
        date: "Sat, 01 Nov 2036 20:00:00 GMT",
      },
      ...(method === "POST" ? { payload: {} } : {}),
    });
    assert.equal(response.statusCode, 403, url);
    assert.equal(response.json().code, "PARTY_NOT_OPEN", url);
    assert.match(String(response.headers["cache-control"]), /no-store/);
  }
  for (const url of [
    "/api/organizer/coffre",
    "/api/tv/coffre",
    "/api/tv/missions/leaderboard",
    "/api/guest-access",
    "/api/health",
  ]) {
    const response = await app.inject({
      url,
      headers: { "x-organizer-request": "1" },
    });
    assert.notEqual(response.json().code, "PARTY_NOT_OPEN", url);
  }
  time = new Date(defaultPartyOpensAt);
  assert.equal(
    (await app.inject({ url: "/api/party-access" })).json().isOpen,
    true,
  );
  for (const url of ["/api/coffre", "/api/missions/me"]) {
    const response = await app.inject({ url });
    assert.equal(
      response.statusCode,
      401,
      "Opening never grants a guest session",
    );
  }
});
test("party opening config requires a timezone and supports an explicit test schedule", () => {
  assert.equal(
    parseEnv({
      DATABASE_URL: config.databaseUrl,
      PARTY_OPENS_AT: "2026-10-31T21:00:00+01:00",
    }).partyOpensAt,
    defaultPartyOpensAt,
  );
  for (const invalid of [
    "tonight",
    "2026-10-31T21:00:00",
    "2026-99-99T21:00:00Z",
  ])
    assert.throws(
      () =>
        parseEnv({ DATABASE_URL: config.databaseUrl, PARTY_OPENS_AT: invalid }),
      /PARTY_OPENS_AT/,
    );
});
