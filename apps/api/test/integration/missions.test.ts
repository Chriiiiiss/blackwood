import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config/env.ts";
import { createDatabase } from "../../src/db/client.ts";
import {
  guestSessions,
  hubSettings,
  missionAssignments,
  missionClaims,
  missionSettings,
  profiles,
} from "../../src/db/schema.ts";
import { missionCatalog } from "../../src/modules/missions/catalog.ts";
import { hashPassword } from "../../src/modules/organizer/password.ts";
import { createProfileRepository } from "../../src/modules/profiles/repository.ts";
import { hashGuestToken } from "../../src/modules/profiles/service.ts";
import { pairTv } from "../helpers/tv.ts";

test("private missions award one recipient-confirmed point and persist independently of Coffres", {
  skip: process.env.BLACKWOOD_ISOLATED_TEST_DB !== "1",
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "blackwood-missions-"));
  const password = "Missions integration password";
  const config = {
    ...loadConfig(),
    mediaRoot: root,
    organizerPasswordHash: await hashPassword(password),
  };
  const { db, pool } = createDatabase(config.databaseUrl);
  const [settings] = await db.select().from(hubSettings);
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const tokens = ids.map(() => randomBytes(32).toString("base64url"));
  const cookieName = config.appOrigin.startsWith("https:")
    ? "__Host-blackwood-guest"
    : "blackwood-guest-dev";
  const headers = ids.map((_, i) => ({
    origin: config.appOrigin,
    "x-guest-request": "1",
    cookie: `${cookieName}=${tokens[i]}`,
  }));
  const [sam, alex, other] = headers;
  assert.ok(sam && alex && other && ids[0] && ids[1] && ids[2]);
  let app = buildApp(config, { logger: false });
  t.after(async () => {
    await app.close();
    const rows = await db
      .select({ id: missionAssignments.id })
      .from(missionAssignments)
      .where(inArray(missionAssignments.profileId, ids));
    if (rows.length)
      await db.delete(missionClaims).where(
        inArray(
          missionClaims.assignmentId,
          rows.map((row) => row.id),
        ),
      );
    await db
      .delete(missionAssignments)
      .where(inArray(missionAssignments.profileId, ids));
    await db.delete(guestSessions).where(inArray(guestSessions.profileId, ids));
    await db.delete(profiles).where(inArray(profiles.id, ids));
    await db.delete(missionSettings);
    await db
      .update(hubSettings)
      .set({ hubEnabled: settings?.hubEnabled ?? false })
      .where(eq(hubSettings.id, 1));
    await pool.end();
    await rm(root, { recursive: true, force: true });
  });
  await db.insert(profiles).values(
    ids.map((id, index) => ({
      id,
      firstName: ["Sam", "Alex", "Other"][index] ?? "Guest",
      role: index === 1 ? ("companion" as const) : ("main" as const),
    })),
  );
  await db.insert(guestSessions).values(
    ids.map((profileId, index) => ({
      profileId,
      tokenHash: hashGuestToken(tokens[index] ?? ""),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    })),
  );
  await db
    .update(hubSettings)
    .set({ hubEnabled: true })
    .where(eq(hubSettings.id, 1));
  const base = "/api/missions";
  const own = (who = sam) => app.inject({ url: `${base}/me`, headers: who });
  const draw = (id: string, who = sam, after: string | null = null) =>
    app.inject({
      method: "POST",
      url: `${base}/me/assignments`,
      headers: who,
      payload: { id, after },
    });
  const initialId = randomUUID();
  const draws = await Promise.all([
    draw(initialId),
    draw(randomUUID()),
    draw(initialId),
  ]);
  assert.ok(
    draws.every((row) => row.statusCode === 200),
    draws.map((row) => row.body).join(),
  );
  const current = draws[0]?.json().current;
  assert.ok(current);
  assert.ok(draws.every((row) => row.json().current.id === current.id));
  assert.equal((await own(alex)).json().current, null);
  assert.equal((await app.inject({ url: `${base}/me` })).statusCode, 401);
  assert.equal(
    (await draw(randomUUID(), { ...sam, origin: "https://other.test" }))
      .statusCode,
    403,
  );
  assert.equal(
    (await draw(randomUUID(), { ...sam, "x-guest-request": "" })).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${base}/me/assignments`,
        headers: sam,
        payload: { id: randomUUID(), owner: ids[1] },
      })
    ).statusCode,
    400,
  );
  assert.equal((await own()).headers["cache-control"], "private, no-store");
  const claim = (id: string, recipientProfileId = ids[1], who = sam) =>
    app.inject({
      method: "POST",
      url: `${base}/me/assignments/${current.id}/claims`,
      headers: who,
      payload: { id, recipientProfileId },
    });
  assert.equal((await claim(randomUUID(), ids[0])).statusCode, 400);
  assert.equal(
    (await claim(randomUUID())).statusCode,
    409,
    "Only participants appear as recipients",
  );
  assert.equal((await draw(randomUUID(), alex)).statusCode, 200);
  const claimId = randomUUID();
  assert.equal((await claim(claimId)).statusCode, 204);
  assert.equal((await claim(claimId)).statusCode, 204);
  assert.equal((await claim(randomUUID())).statusCode, 409);
  assert.equal((await claim(randomUUID(), ids[1], other)).statusCode, 404);
  const incoming = await app.inject({
    url: `${base}/me/confirmations`,
    headers: alex,
  });
  assert.equal(incoming.json()[0].text, current.text);
  assert.deepEqual(
    (
      await app.inject({ url: `${base}/me/confirmations`, headers: other })
    ).json(),
    [],
  );
  const decide = (id: string, decision = "confirmed", who = alex) =>
    app.inject({
      method: "POST",
      url: `${base}/me/confirmations/${id}/decision`,
      headers: who,
      payload: { decision },
    });
  assert.equal((await decide(claimId, "confirmed", sam)).statusCode, 404);
  assert.equal((await decide(claimId, "confirmed", other)).statusCode, 404);
  const confirmed = await Promise.all([
    decide(claimId),
    decide(claimId),
    decide(claimId),
  ]);
  assert.ok(
    confirmed.every((row) => row.statusCode === 204),
    confirmed.map((row) => row.body).join(),
  );
  assert.equal((await own()).json().score, 1);
  assert.equal(
    (await own()).json().current,
    null,
    "A new mission needs an explicit draw",
  );
  assert.equal((await decide(claimId, "rejected")).statusCode, 409);
  // A lost draw response replay after completion cannot draw the next assignment.
  assert.equal((await draw(current.id)).json().current, null);
  const next = (await draw(randomUUID(), sam, current.id)).json().current;
  assert.ok(next && next.text !== current.text);
  const nextClaim = randomUUID();
  const sendNext = (id: string) =>
    app.inject({
      method: "POST",
      url: `${base}/me/assignments/${next.id}/claims`,
      headers: sam,
      payload: { id, recipientProfileId: ids[1] },
    });
  assert.equal((await sendNext(nextClaim)).statusCode, 204);
  assert.equal((await decide(nextClaim, "rejected")).statusCode, 204);
  assert.equal((await decide(nextClaim)).statusCode, 409);
  assert.equal((await own()).json().score, 1);
  assert.equal((await own()).json().current.id, next.id);
  const cancelledId = randomUUID();
  assert.equal((await sendNext(cancelledId)).statusCode, 204);
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `${base}/me/claims/${cancelledId}`,
        headers: sam,
      })
    ).statusCode,
    204,
  );
  assert.equal((await decide(cancelledId)).statusCode, 409);
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
  const tvUrl = "/api/tv/missions/leaderboard";
  assert.equal(
    (await app.inject({ url: tvUrl, headers: sam })).statusCode,
    401,
  );
  assert.equal(
    (await app.inject({ url: `${base}/me`, headers: tv })).statusCode,
    401,
  );
  const board = await app.inject({ url: tvUrl, headers: tv });
  assert.equal(board.statusCode, 200, board.body);
  assert.equal(
    board
      .json()
      .players.find((row: { firstName: string }) => row.firstName === "Sam")
      .points,
    1,
  );
  assert.deepEqual(Object.keys(board.json().players[0]).sort(), [
    "firstName",
    "id",
    "points",
    "rank",
  ]);
  const tvIds = board.json().players.map((row: { id: string }) => row.id);
  assert.equal(new Set(tvIds).size, tvIds.length);
  for (const id of tvIds) assert.match(id, /^[a-f0-9]{64}$/);
  for (const id of ids) assert.ok(!board.body.includes(id));
  await db
    .update(profiles)
    .set({ firstName: "Sam" })
    .where(eq(profiles.id, ids[1]));
  const homonyms = (await app.inject({ url: tvUrl, headers: tv })).json()
    .players;
  assert.equal(
    homonyms.filter((row: { firstName: string }) => row.firstName === "Sam")
      .length,
    2,
  );
  assert.deepEqual(
    homonyms.map((row: { id: string }) => row.id).sort(),
    [...tvIds].sort(),
  );
  await db
    .update(profiles)
    .set({ firstName: "Alex" })
    .where(eq(profiles.id, ids[1]));
  assert.ok(!board.body.includes(current.text));
  assert.equal(board.json().showScoresWithMemories, false);
  const settingUrl = "/api/organizer/missions/tv-settings";
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: settingUrl,
        headers: admin,
        payload: { showScoresWithMemories: true },
      })
    ).statusCode,
    200,
  );
  await app.close();
  app = buildApp(config, { logger: false });
  assert.equal((await own()).json().score, 1);
  assert.equal(
    (await app.inject({ url: tvUrl, headers: tv })).json()
      .showScoresWithMemories,
    true,
  );
  const pendingRevocation = randomUUID();
  assert.equal((await sendNext(pendingRevocation)).statusCode, 204);
  await createProfileRepository(db).disableAccess(ids[1]);
  assert.equal((await decide(pendingRevocation)).statusCode, 401);
  assert.deepEqual(
    (await app.inject({ url: `${base}/players`, headers: sam })).json(),
    [],
  );
  await createProfileRepository(db).remove(ids[0]);
  assert.equal((await own()).statusCode, 401);
  assert.ok(
    !(await app.inject({ url: tvUrl, headers: tv }))
      .json()
      .players.some((row: { firstName: string }) => row.firstName === "Sam"),
  );
  assert.equal(new Set(missionCatalog.map(([key]) => key)).size, 25);
});
