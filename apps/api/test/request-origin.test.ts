import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../src/app.ts";

const appOrigin = "https://halloween.sirhc.xyz";
const config = {
  databaseUrl: "postgresql://user:secret@127.0.0.1:5432/test",
  appOrigin,
};
const url = `/api/invitation-responses/${randomUUID()}`;

test("foreign browser origins are rejected before accessing PostgreSQL", async (t) => {
  const query = t.mock.method(Pool.prototype, "query", async () => ({
    rows: [],
  }));
  t.mock.method(Pool.prototype, "end", async () => {});
  const app = buildApp(config, { logger: false });
  t.after(() => app.close());
  await app.ready();
  const startupQueries = query.mock.callCount();

  for (const origin of [
    "https://unrelated.example",
    "https://other.sirhc.xyz",
    "http://halloween.sirhc.xyz",
    "https://halloween.sirhc.xyz:8443",
    "https://halloween.sirhc.xyz.attacker.example",
    "null",
  ]) {
    for (const method of ["GET", "PUT", "OPTIONS"] as const) {
      const response = await app.inject({
        method,
        url,
        headers: { origin },
        ...(method === "PUT" && {
          payload: { firstName: "Chris", attendance: "yes", plusOne: false },
        }),
      });
      assert.equal(response.statusCode, 403, `${method} ${origin}`);
      assert.equal(response.json().code, "ORIGIN_NOT_ALLOWED");
      assert.equal(response.headers["access-control-allow-origin"], undefined);
    }
  }
  for (const site of ["cross-site", "same-site"]) {
    const response = await app.inject({
      method: "GET",
      url,
      headers: { "sec-fetch-site": site },
    });
    assert.equal(response.statusCode, 403);
  }
  assert.equal(query.mock.callCount(), startupQueries);
});

test("same-origin browser requests and non-browser healthchecks still work", async (t) => {
  const query = t.mock.method(Pool.prototype, "query", async () => ({
    rows: [],
  }));
  t.mock.method(Pool.prototype, "end", async () => {});
  const app = buildApp(config, { logger: false });
  t.after(() => app.close());
  await app.ready();
  const startupQueries = query.mock.callCount();

  for (const headers of [
    { origin: appOrigin, "sec-fetch-site": "same-origin" },
    { "sec-fetch-site": "same-origin" },
    {},
  ]) {
    const response = await app.inject({ method: "GET", url, headers });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().code, "RESPONSE_NOT_FOUND");
  }
  assert.equal(query.mock.callCount(), startupQueries + 3);
  const health = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(health.statusCode, 200);
});
