import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { test } from "node:test";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { Pool } from "pg";
import { buildApp } from "../src/app.ts";
import { ProfileError } from "../src/modules/profiles/errors.ts";
import { registerProfileRoutes } from "../src/modules/profiles/routes.ts";
import {
  guestSessionLifetime,
  type ProfileService,
} from "../src/modules/profiles/service.ts";

test("guest routes validate bodies, protect writes and keep access secrets in secure cookies", async (t) => {
  const origin = "https://blackwood.example";
  const profile = {
    id: randomUUID(),
    firstName: "Chris",
    avatarMediaId: null,
    hasInvitationResponse: true,
    role: "main" as const,
  };
  const access = { hubEnabled: true, profile };
  const token = randomBytes(32).toString("base64url");
  const invitation = {
    firstName: "Chris",
    attendance: "yes" as const,
    plusOne: false,
    ideas: null,
  };
  let calls = 0;
  const service: ProfileService = {
    async login() {
      calls++;
      return { access, token };
    },
    async issueCode() {
      return { code: "test" };
    },
    async codeProfiles() {
      return [];
    },
    async disableAccess() {},
    async access() {
      return access;
    },
    async restore() {
      calls++;
      return { access, token };
    },
    async profile() {
      return profile;
    },
    async patch(firstName) {
      calls++;
      return { ...profile, firstName };
    },
    async invitation() {
      return invitation;
    },
    async saveInvitation() {
      calls++;
      return invitation;
    },
    async issueCompanion() {
      calls++;
      return {
        mainProfileId: profile.id,
        token,
        expiresAt: new Date().toISOString(),
      };
    },
    async claimCompanion() {
      calls++;
      return { access, token };
    },
  };
  const app = Fastify({
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  await app.register(cookie);
  registerProfileRoutes(app, service, origin);
  t.after(() => app.close());
  const headers = { origin, "x-guest-request": "1" };
  const restoreUrl = "/api/guest-access/restore";
  for (const invalidHeaders of [
    {},
    { origin },
    { "x-guest-request": "1" },
    { ...headers, origin: "https://other.example" },
  ]) {
    const result = await app.inject({
      method: "POST",
      url: restoreUrl,
      headers: invalidHeaders,
      payload: { responseId: randomUUID() },
    });
    assert.equal(result.statusCode, 403);
    assert.equal(result.headers["cache-control"], "no-store");
  }
  for (const payload of [
    {},
    { responseId: profile.id, extra: true },
    { responseId: profile.id, firstName: "name" },
    { responseId: "invalid" },
    { responseId: 1 },
  ]) {
    assert.equal(
      (
        await app.inject({ method: "POST", url: restoreUrl, headers, payload })
      ).json().code,
      "VALIDATION_ERROR",
    );
  }
  for (const firstName of ["", " \t\n ", "🎃".repeat(51), null, 1]) {
    const result = await app.inject({
      method: "PATCH",
      url: "/api/profiles/me",
      headers,
      payload: { firstName },
    });
    assert.equal(result.statusCode, 400, result.body);
  }
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: "/api/profiles/me",
        headers,
        payload: { firstName: "Chris", avatarMediaId: profile.id },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: restoreUrl,
        headers: { ...headers, "content-type": "text/plain" },
        payload: "response",
      })
    ).statusCode,
    415,
  );
  assert.equal(calls, 0);
  for (const payload of [
    {},
    { code: 123 },
    { code: "" },
    { code: "A".repeat(129) },
    { code: "test", profileId: profile.id },
  ]) {
    const invalid = await app.inject({
      method: "POST",
      url: "/api/guest-access/login",
      headers,
      payload,
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().code, "VALIDATION_ERROR");
  }
  assert.equal(calls, 0);
  const patch = await app.inject({
    method: "PATCH",
    url: "/api/profiles/me",
    headers,
    payload: { firstName: ` ${"🎃".repeat(50)} ` },
  });
  assert.equal(patch.statusCode, 200, patch.body);
  assert.equal(patch.json().firstName, "🎃".repeat(50));
  const responseId = randomUUID();
  const restored = await app.inject({
    method: "POST",
    url: restoreUrl,
    headers,
    payload: { responseId },
  });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.ok(!restored.body.includes(responseId));
  assert.ok(!restored.body.includes(token));
  const setCookie = String(restored.headers["set-cookie"]);
  assert.match(setCookie, /^__Host-blackwood-guest=/);
  for (const flag of [
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${guestSessionLifetime}`,
  ])
    assert.ok(setCookie.includes(flag));
  assert.ok(!setCookie.includes("Domain="));
  const codeLogin = await app.inject({
    method: "POST",
    url: "/api/guest-access/login",
    headers,
    payload: { code: "ABCD-EFGH-JKMN-PQRS-TVWX" },
  });
  assert.equal(codeLogin.statusCode, 200, codeLogin.body);
  assert.equal(String(codeLogin.headers["set-cookie"]), setCookie);
  assert.deepEqual(codeLogin.json(), access);
  t.mock.method(service, "login", async () => {
    throw new ProfileError(429, "LOGIN_RATE_LIMITED", 42);
  });
  const limited = await app.inject({
    method: "POST",
    url: "/api/guest-access/login",
    headers,
    payload: { code: "ABCD-EFGH-JKMN-PQRS-TVWX" },
  });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers["retry-after"], "42");
  assert.equal(limited.json().code, "LOGIN_RATE_LIMITED");
  assert.equal(limited.headers["set-cookie"], undefined);
  const current = await app.inject({
    url: "/api/profiles/me/invitation-response",
  });
  assert.equal(current.statusCode, 200);
  assert.equal(current.json().id, undefined);
  const originalCalls = calls;
  for (const payload of [
    { firstName: "Chris", attendance: "yes" },
    { firstName: "Chris", attendance: "yes", plusOne: "false" },
    {
      firstName: "Chris",
      attendance: "yes",
      plusOne: false,
      ideas: "a".repeat(1001),
    },
  ]) {
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: "/api/profiles/me/invitation-response",
          headers,
          payload,
        })
      ).statusCode,
      400,
    );
  }
  assert.equal(calls, originalCalls);
});

test("anonymous access differs from storage failure and profile logs redact secrets", async (t) => {
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
    },
    { logger: { stream } },
  );
  t.after(() => app.close());
  const anonymous = await app.inject({ url: "/api/guest-access" });
  assert.deepEqual(anonymous.json(), { hubEnabled: false, profile: null });
  assert.equal(anonymous.headers["cache-control"], "no-store");
  assert.equal(
    (await app.inject({ url: "/api/profiles/me" })).json().code,
    "GUEST_UNAUTHENTICATED",
  );
  const secret = randomBytes(32).toString("base64url");
  t.mock.method(Pool.prototype, "query", async () => {
    throw new Error(`SQL parameters: ${secret}`);
  });
  const failed = await app.inject({
    url: "/api/guest-access",
    headers: { cookie: `__Host-blackwood-guest=${secret}` },
  });
  assert.equal(failed.statusCode, 500);
  assert.equal(failed.json().code, "PROFILE_UNAVAILABLE");
  assert.equal(failed.json().profile, undefined);
  assert.ok(!failed.body.includes(secret));
  assert.ok(!logs.includes(secret));
  assert.ok(!logs.includes("SQL parameters"));
  const codeLogin = await app.inject({
    method: "POST",
    url: "/api/guest-access/login",
    headers: { origin: "https://blackwood.example", "x-guest-request": "1" },
    payload: { code: "ABCD-EFGH-JKMN-PQRS-TVWX" },
  });
  assert.equal(codeLogin.statusCode, 500);
  assert.equal(codeLogin.json().code, "PROFILE_UNAVAILABLE");
  assert.ok(!logs.includes("ABCD-EFGH-JKMN-PQRS-TVWX"));
  assert.ok(!logs.includes(secret));
});
