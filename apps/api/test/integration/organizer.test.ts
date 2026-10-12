import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config/env.ts";
import { createDatabase } from "../../src/db/client.ts";
import {
  invitationResponses,
  organizerLoginLimit,
  organizerSessions,
} from "../../src/db/schema.ts";
import {
  fingerprint,
  hashPassword,
} from "../../src/modules/organizer/password.ts";
import { createOrganizerRepository } from "../../src/modules/organizer/repository.ts";

test("private access persists, expires, revokes and reads a consistent invitation snapshot", {
  skip: process.env.BLACKWOOD_ISOLATED_TEST_DB !== "1",
}, async (t) => {
  const password = "Integration-only private password";
  const passwordHash = await hashPassword(password);
  const config = { ...loadConfig(), organizerPasswordHash: passwordHash };
  const app = buildApp(config, { logger: false });
  const { db, pool } = createDatabase(config.databaseUrl);
  const repo = createOrganizerRepository(db);
  const ids = Array.from({ length: 4 }, () => randomUUID());
  const tokens: string[] = [];
  t.after(async () => {
    await db
      .delete(invitationResponses)
      .where(inArray(invitationResponses.id, ids));
    await db
      .delete(organizerSessions)
      .where(
        eq(organizerSessions.credentialFingerprint, fingerprint(passwordHash)),
      );
    await app.close();
    await pool.end();
  });
  const headers = { origin: config.appOrigin, "x-organizer-request": "1" };
  const url = "/api/organizer/session";
  const listUrl = "/api/organizer/invitation-responses";
  async function login() {
    const response = await app.inject({
      method: "POST",
      url,
      headers,
      payload: { password },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.ok(!String(response.headers["set-cookie"]).includes("; Secure"));
    const cookie = String(response.headers["set-cookie"]).split(";")[0] ?? "";
    const token = cookie.split("=")[1] ?? "";
    tokens.push(token);
    return { ...headers, cookie };
  }
  const unauthorized = await app.inject({ url: listUrl, headers });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.headers["cache-control"], "no-store");
  const deniedOrigin = await app.inject({
    url: listUrl,
    headers: { ...headers, origin: "https://other.example" },
  });
  assert.equal(deniedOrigin.statusCode, 403);
  assert.equal(deniedOrigin.headers["cache-control"], "no-store");
  const privateHeaders = await login();
  const baseline = (
    await app.inject({ url: listUrl, headers: privateHeaders })
  ).json();
  const entries = [
    {
      firstName: "ENG37 Alex",
      attendance: "yes" as const,
      plusOne: true,
      ideas: "A".repeat(1000),
    },
    {
      firstName: "ENG37 Alex",
      attendance: "yes" as const,
      plusOne: false,
      ideas: null,
    },
    {
      firstName: "ENG37 Sam",
      attendance: "to_confirm" as const,
      plusOne: true,
      ideas: null,
    },
    {
      firstName: "ENG37 Pat",
      attendance: "no" as const,
      plusOne: false,
      ideas: null,
    },
  ];
  await db
    .insert(invitationResponses)
    .values(
      entries.map((entry, index) => ({ ...entry, id: ids[index] as string })),
    );
  let list = await app.inject({ url: listUrl, headers: privateHeaders });
  assert.deepEqual(list.json().totals, {
    attending: baseline.totals.attending + 2,
    toConfirm: baseline.totals.toConfirm + 1,
    plusOnes: baseline.totals.plusOnes + 1,
  });
  assert.equal(list.json().responses.length, baseline.responses.length + 4);
  for (const row of list.json().responses)
    assert.deepEqual(Object.keys(row).sort(), [
      "attendance",
      "firstName",
      "ideas",
      "plusOne",
    ]);
  for (const id of ids) assert.ok(!list.body.includes(id));
  const editedId = ids[2];
  assert.ok(editedId);
  const update = await app.inject({
    method: "PUT",
    url: `/api/invitation-responses/${editedId}`,
    payload: { firstName: "ENG37 Sam", attendance: "yes", plusOne: true },
  });
  assert.equal(update.statusCode, 200);
  list = await app.inject({ url: listUrl, headers: privateHeaders });
  assert.deepEqual(list.json().totals, {
    attending: baseline.totals.attending + 3,
    toConfirm: baseline.totals.toConfirm,
    plusOnes: baseline.totals.plusOnes + 2,
  });
  assert.equal(list.json().responses.length, baseline.responses.length + 4);
  const restarted = buildApp(config, { logger: false });
  try {
    assert.equal(
      (await restarted.inject({ url: listUrl, headers: privateHeaders }))
        .statusCode,
      200,
    );
  } finally {
    await restarted.close();
  }
  const rotated = buildApp(
    { ...config, organizerPasswordHash: await hashPassword(password) },
    { logger: false },
  );
  try {
    assert.equal(
      (await rotated.inject({ url: listUrl, headers: privateHeaders }))
        .statusCode,
      401,
    );
  } finally {
    await rotated.close();
  }
  const firstToken = tokens[0];
  assert.ok(firstToken);
  const [stored] = await db
    .select()
    .from(organizerSessions)
    .where(eq(organizerSessions.tokenHash, fingerprint(firstToken)));
  assert.ok(stored);
  assert.ok(!JSON.stringify(stored).includes(firstToken));
  await db
    .update(organizerSessions)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(organizerSessions.tokenHash, fingerprint(firstToken)));
  assert.equal(
    (await app.inject({ url: listUrl, headers: privateHeaders })).statusCode,
    401,
  );
  const idleHeaders = await login();
  await db
    .update(organizerSessions)
    .set({ lastActivity: new Date(Date.now() - 86_400_001) })
    .where(eq(organizerSessions.tokenHash, fingerprint(tokens[1] as string)));
  assert.equal(
    (await app.inject({ url, headers: idleHeaders })).statusCode,
    401,
  );
  const logoutHeaders = await login();
  assert.equal(
    (await app.inject({ method: "DELETE", url, headers: logoutHeaders }))
      .statusCode,
    204,
  );
  assert.equal(
    (await app.inject({ url: listUrl, headers: logoutHeaders })).statusCode,
    401,
  );
  // Exercise an isolated future window without resetting the shared limit row.
  const future = new Date("2100-01-01T00:00:00Z");
  const limits = await Promise.all(
    Array.from({ length: 24 }, () => repo.consumeLoginAttempt(future)),
  );
  assert.equal(limits.filter((limit) => limit.allowed).length, 20);
  const otherRepo = createOrganizerRepository(db);
  assert.equal((await otherRepo.consumeLoginAttempt(future)).allowed, false);
  assert.equal(
    (await otherRepo.consumeLoginAttempt(new Date(future.getTime() + 900_000)))
      .allowed,
    true,
  );
  // A delayed request from an earlier window cannot reopen the quota.
  await repo.consumeLoginAttempt(new Date());
  const disabled = buildApp(
    { databaseUrl: config.databaseUrl, appOrigin: config.appOrigin },
    { logger: false },
  );
  try {
    assert.equal((await disabled.inject({ url, headers })).statusCode, 503);
  } finally {
    await disabled.close();
  }
  const [limit] = await db
    .select()
    .from(organizerLoginLimit)
    .where(eq(organizerLoginLimit.id, 1));
  assert.ok(limit);
  assert.equal(limit.windowStart.getTime(), future.getTime() + 900_000);
  assert.equal(limit.attempts, 2);
});
