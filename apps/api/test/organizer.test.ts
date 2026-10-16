import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { Pool } from "pg";
import { buildApp } from "../src/app.ts";
import { parseEnv } from "../src/config/env.ts";
import {
  fingerprint,
  hashPassword,
  parsePasswordHash,
  verifyPassword,
} from "../src/modules/organizer/password.ts";
import type { OrganizerRepository } from "../src/modules/organizer/repository.ts";
import { registerOrganizerRoutes } from "../src/modules/organizer/routes.ts";
import { createOrganizerService } from "../src/modules/organizer/service.ts";

const password = "Test-only secret with 25 chars";
const encoded = await hashPassword(password);

test("password hashing is salted, strict and never trims the password", async () => {
  assert.ok(await verifyPassword(password, encoded));
  assert.equal(await verifyPassword(` ${password}`, encoded), false);
  assert.notEqual(await hashPassword(password), encoded);
  for (const value of [
    "bad-secret",
    encoded.replace("131072", "1024"),
    `${encoded}=`,
    encoded.replace("scrypt$v1", "scrypt$v2"),
  ]) {
    assert.throws(
      () => parsePasswordHash(value),
      (error: unknown) =>
        error instanceof Error && !error.message.includes(value),
    );
  }
  await assert.rejects(hashPassword("short"));
  const databaseUrl = "postgresql://test:test@127.0.0.1/test";
  assert.throws(
    () =>
      parseEnv({
        DATABASE_URL: databaseUrl,
        ORGANIZER_PASSWORD_HASH: "bad-secret",
      }),
    /ORGANIZER_PASSWORD_HASH/,
  );
  assert.throws(
    () =>
      parseEnv({
        DATABASE_URL: databaseUrl,
        ORGANIZER_PASSWORD_HASH: encoded,
        APP_ORIGIN: "http://example.com",
      }),
    /HTTPS/,
  );
  assert.equal(
    parseEnv({ DATABASE_URL: databaseUrl, ORGANIZER_PASSWORD_HASH: encoded })
      .organizerPasswordHash,
    encoded,
  );
});

function repository(): OrganizerRepository {
  const sessions = new Map<string, { expiresAt: Date }>();
  let hubEnabled = false;
  return {
    async readHubSettings() {
      return { hubEnabled };
    },
    async saveHubSettings(enabled) {
      hubEnabled = enabled;
      return { hubEnabled };
    },
    async cleanExpired() {},
    async consumeLoginAttempt() {
      return { allowed: true, retryAfter: 1 };
    },
    async createSession(values, previous) {
      if (previous) sessions.delete(previous);
      sessions.set(values.tokenHash, { expiresAt: values.expiresAt });
    },
    async touchSession(hash) {
      return sessions.get(hash);
    },
    async revokeSession(hash) {
      sessions.delete(hash);
    },
    async readResponses() {
      return [
        { firstName: "Alex", attendance: "yes", plusOne: true, ideas: null },
        { firstName: "Alex", attendance: "yes", plusOne: false, ideas: "Idea" },
        {
          firstName: "Sam",
          attendance: "to_confirm",
          plusOne: true,
          ideas: null,
        },
        { firstName: "No", attendance: "no", plusOne: false, ideas: null },
      ];
    },
  };
}

test("organizer routes enforce request headers, JSON, cookies and revocation", async (t) => {
  const origin = "https://blackwood.example";
  const repo = repository();
  const app = Fastify({
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  await app.register(cookie);
  registerOrganizerRoutes(app, createOrganizerService(repo, encoded), origin, {
    async codeProfiles() {
      return [];
    },
    async issueCode() {
      return { code: "test" };
    },
    async disableAccess() {},
  });
  t.after(() => app.close());
  const headers = { origin, "x-organizer-request": "1" };
  const url = "/api/organizer/session";
  for (const invalidHeaders of [
    {},
    { origin },
    { "x-organizer-request": "1" },
    { ...headers, origin: "https://other.example" },
  ]) {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers: invalidHeaders,
          payload: { password },
        })
      ).statusCode,
      403,
    );
  }
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url,
        headers: { ...headers, "content-type": "text/plain" },
        payload: password,
      })
    ).statusCode,
    415,
  );
  for (const payload of [
    { password: 1 },
    { password, extra: true },
    {},
    { password: "a".repeat(129) },
  ]) {
    assert.equal(
      (await app.inject({ method: "POST", url, headers, payload })).statusCode,
      400,
    );
  }
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url,
        headers,
        payload: { password: "a".repeat(3000) },
      })
    ).statusCode,
    413,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url,
        headers,
        payload: { password: "wrong" },
      })
    ).statusCode,
    401,
  );
  const response = await app.inject({
    method: "POST",
    url,
    headers,
    payload: { password },
  });
  assert.equal(response.statusCode, 200, response.body);
  const setCookie = String(response.headers["set-cookie"]);
  assert.match(setCookie, /^__Host-blackwood-organizer=/);
  for (const flag of [
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Path=/",
    "Max-Age=604800",
  ])
    assert.ok(setCookie.includes(flag));
  assert.ok(!setCookie.includes("Domain="));
  assert.deepEqual(Object.keys(response.json()).sort(), [
    "authenticated",
    "expiresAt",
    "idleExpiresAt",
  ]);
  const sessionCookie = setCookie.split(";")[0] ?? "";
  const privateHeaders = { ...headers, cookie: sessionCookie };
  assert.equal(
    (await app.inject({ url, headers: privateHeaders })).statusCode,
    200,
  );
  const listUrl = "/api/organizer/invitation-responses";
  assert.equal((await app.inject({ url: listUrl, headers })).statusCode, 401);
  const list = await app.inject({ url: listUrl, headers: privateHeaders });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json().totals, {
    attending: 2,
    toConfirm: 1,
    plusOnes: 1,
  });
  assert.equal(list.json().responses.length, 4);
  const replacement = await app.inject({
    method: "POST",
    url,
    headers: privateHeaders,
    payload: { password },
  });
  assert.notEqual(
    replacement.headers["set-cookie"],
    response.headers["set-cookie"],
  );
  assert.equal(
    (await app.inject({ url, headers: privateHeaders })).statusCode,
    401,
  );
  const nextHeaders = {
    ...headers,
    cookie: String(replacement.headers["set-cookie"]).split(";")[0] ?? "",
  };
  assert.equal(
    (await app.inject({ method: "DELETE", url, headers: nextHeaders }))
      .statusCode,
    204,
  );
  assert.equal(
    (await app.inject({ url: listUrl, headers: nextHeaders })).statusCode,
    401,
  );
  assert.equal(
    (await app.inject({ method: "DELETE", url, headers })).statusCode,
    204,
  );
  t.mock.method(repo, "revokeSession", async () => {
    throw new Error("SQL contains secret token");
  });
  const failed = await app.inject({
    method: "DELETE",
    url,
    headers: nextHeaders,
  });
  assert.equal(failed.statusCode, 503);
  assert.ok(!failed.body.includes("secret"));
  t.mock.method(repo, "consumeLoginAttempt", async () => ({
    allowed: false,
    retryAfter: 120,
  }));
  const limited = await app.inject({
    method: "POST",
    url,
    headers: { ...headers, "content-type": "application/json" },
    payload: "{malformed",
  });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers["retry-after"], "120");
  assert.equal(limited.json().code, "LOGIN_RATE_LIMITED");
});

test("disabled organizer access and concurrent derivations fail closed", async () => {
  const repo = repository();
  await assert.rejects(createOrganizerService(repo, undefined).prepare(false), {
    code: "ORGANIZER_UNAVAILABLE",
  });
  const service = createOrganizerService(repo, encoded);
  const first = service.login(password);
  await assert.rejects(service.login(password), {
    code: "LOGIN_RATE_LIMITED",
    retryAfter: 1,
  });
  const result = await first;
  assert.notEqual(result.token, fingerprint(result.token));
});

test("organizer errors and application logging never expose credentials or database parameters", async (t) => {
  t.mock.method(Pool.prototype, "query", async () => ({ rows: [] }));
  t.mock.method(Pool.prototype, "end", async () => {});
  let logs = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      logs += String(chunk);
      callback();
    },
  });
  const app = buildApp(
    {
      databaseUrl: "postgresql://test:test@127.0.0.1/test",
      appOrigin: "https://blackwood.example",
      organizerPasswordHash: encoded,
    },
    {
      logger: {
        stream,
        serializers: {
          req: (request) => ({ headers: request.headers }),
          res: (reply) => ({ headers: reply.getHeaders?.() }),
        },
      },
    },
  );
  t.after(() => app.close());
  const token = "synthetic-secret-session-token";
  app.get("/logging-test", async (request, reply) => {
    request.log.info(
      { password, body: { password }, token, organizerPasswordHash: encoded },
      "Redaction verification.",
    );
    return reply.header("set-cookie", token).send({ ok: true });
  });
  await app.inject({
    url: "/logging-test",
    headers: { cookie: token, authorization: token },
  });
  t.mock.method(Pool.prototype, "query", async () => {
    throw new Error(`SQL parameters: ${password}`);
  });
  const failed = await app.inject({
    url: "/api/organizer/session",
    headers: { "x-organizer-request": "1" },
  });
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.headers["cache-control"], "no-store");
  assert.ok(logs.includes("Redaction verification"));
  for (const secret of [password, token, encoded, "SQL parameters"])
    assert.ok(!logs.includes(secret));
  assert.ok(!failed.body.includes(password));
});
