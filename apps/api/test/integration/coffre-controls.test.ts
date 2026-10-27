import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config/env.ts";
import { createDatabase } from "../../src/db/client.ts";
import {
  coffreContributions,
  coffres,
  guestSessions,
  hubSettings,
  profiles,
} from "../../src/db/schema.ts";
import { hashPassword } from "../../src/modules/organizer/password.ts";
import { hashGuestToken } from "../../src/modules/profiles/service.ts";

test("organizer deadline advancement and immediate opening serialize with deposits", {
  skip: process.env.BLACKWOOD_ISOLATED_TEST_DB !== "1",
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "blackwood-coffre-controls-"));
  const password = "Coffre controls test password";
  const config = {
    ...loadConfig(),
    mediaRoot: root,
    organizerPasswordHash: await hashPassword(password),
  };
  const { db, pool } = createDatabase(config.databaseUrl);
  assert.equal(
    (await db.select().from(coffres)).length,
    0,
    "Controls tests require an unused isolated Coffre.",
  );
  const [previousSettings] = await db.select().from(hubSettings);
  const profileId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const app = buildApp(config, { logger: false });
  t.after(async () => {
    await app.close();
    await db
      .delete(coffreContributions)
      .where(eq(coffreContributions.coffreId, 1));
    await db.delete(coffres).where(eq(coffres.id, 1));
    await db
      .delete(guestSessions)
      .where(eq(guestSessions.profileId, profileId));
    await db.delete(profiles).where(eq(profiles.id, profileId));
    await db
      .update(hubSettings)
      .set({ hubEnabled: previousSettings?.hubEnabled ?? false })
      .where(eq(hubSettings.id, 1));
    await pool.end();
    await rm(root, { recursive: true, force: true });
  });
  await db
    .insert(profiles)
    .values({ id: profileId, firstName: "Timing fixture", role: "main" });
  await db.insert(guestSessions).values({
    profileId,
    tokenHash: hashGuestToken(token),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await db
    .update(hubSettings)
    .set({ hubEnabled: true })
    .where(eq(hubSettings.id, 1));
  const origin = config.appOrigin;
  const guest = {
    origin,
    "x-guest-request": "1",
    cookie: `${origin.startsWith("https:") ? "__Host-blackwood-guest" : "blackwood-guest-dev"}=${token}`,
  };
  const login = await app.inject({
    method: "POST",
    url: "/api/organizer/session",
    headers: { origin, "x-organizer-request": "1" },
    payload: { password },
  });
  const cookie = login.cookies.find((value) =>
    value.name.includes("organizer"),
  );
  assert.ok(cookie, login.body);
  const admin = {
    origin,
    "x-organizer-request": "1",
    cookie: `${cookie.name}=${cookie.value}`,
  };
  const path = "/api/organizer/coffre";
  const command = (name: string, payload: object = {}) =>
    app.inject({
      method: "POST",
      url: `${path}/${name}`,
      headers: admin,
      payload,
    });
  assert.equal((await command("open")).json().code, "COFFRE_NOT_PREPARED");
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: path,
        headers: admin,
        payload: { durationSeconds: 21600 },
      })
    ).statusCode,
    200,
  );
  assert.equal((await command("open")).json().code, "COFFRE_NOT_COLLECTING");
  const initial = (await command("start")).json();
  const deadline = new Date(
    Date.parse(initial.serverNow) + 60_000,
  ).toISOString();
  const advanced = await command("advance", { deadline });
  assert.equal(advanced.statusCode, 200, advanced.body);
  assert.equal(advanced.json().deadline, deadline);
  assert.equal(advanced.json().startedAt, initial.startedAt);
  assert.equal(advanced.json().durationSeconds, initial.durationSeconds);
  assert.equal((await command("advance", { deadline })).statusCode, 200);
  for (const invalid of [
    initial.deadline,
    new Date(Date.now() - 1000).toISOString(),
  ]) {
    const result = await command("advance", { deadline: invalid });
    assert.equal(result.statusCode, 409, result.body);
    assert.equal(result.json().code, "COFFRE_INVALID_DEADLINE");
  }
  const deposit = (text: string, visibility = "public") =>
    app.inject({
      method: "POST",
      url: "/api/coffre/contributions",
      headers: guest,
      payload: { id: randomUUID(), text, visibility, frameId: "plain" },
    });
  assert.equal((await deposit("A shared memory")).statusCode, 200);
  assert.equal((await deposit("A private memory", "private")).statusCode, 200);
  assert.equal(
    (await app.inject({ url: "/api/coffre/contributions", headers: guest }))
      .statusCode,
    409,
  );

  let release!: () => void;
  let locked!: () => void;
  const ready = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blocker = db.transaction(async (tx) => {
    await tx.select().from(coffres).where(eq(coffres.id, 1)).for("update");
    locked();
    await hold;
  });
  await ready;
  const opening = command("open");
  async function waitForLocks(count: number) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const result = await db.execute<{ count: string }>(
        sql`select count(*)::text as count from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock' and query like ${'%from "coffres"%for update%'}`,
      );
      if (Number(result.rows[0]?.count) >= count) return;
      await setTimeout(10);
    }
    throw new Error("The commands did not reach their Coffre row locks.");
  }
  let delayed: ReturnType<typeof deposit> | undefined;
  try {
    await waitForLocks(1);
    delayed = deposit("Must not be inserted after opening");
    await waitForLocks(2);
  } finally {
    release();
    await blocker;
  }
  const opened = await opening;
  assert.equal(opened.statusCode, 200, opened.body);
  assert.equal(opened.json().state, "revealed");
  assert.equal((await delayed)?.json().code, "COFFRE_REVEALED");
  assert.equal((await db.select().from(coffreContributions)).length, 2);
  const revealedDeadline = opened.json().deadline;
  assert.equal((await command("open")).json().deadline, revealedDeadline);
  assert.equal((await command("start")).json().deadline, revealedDeadline);
  assert.equal(
    (await command("advance", { deadline: revealedDeadline })).statusCode,
    200,
  );
  assert.equal(
    (await command("advance", { deadline: initial.deadline })).json().code,
    "COFFRE_REVEALED",
  );
  const list = await app.inject({
    url: "/api/coffre/contributions",
    headers: guest,
  });
  assert.deepEqual(
    list.json().contributions.map((row: { text: string }) => row.text),
    ["A shared memory"],
  );
  assert.equal(
    (await app.inject({ url: "/api/coffre/contributions" })).statusCode,
    401,
  );
});
