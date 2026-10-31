import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config/env.ts";
import { createDatabase } from "../../src/db/client.ts";
import {
  activityEvents,
  guestSessions,
  profiles,
} from "../../src/db/schema.ts";
import { hashPassword } from "../../src/modules/organizer/password.ts";
import { hashGuestToken } from "../../src/modules/profiles/service.ts";

test("activity follows protected cookie identities, isolates organizer reads and paginates persisted events", {
  skip: process.env.BLACKWOOD_ISOLATED_TEST_DB !== "1",
}, async (t) => {
  const password = "Activity integration password";
  const config = {
    ...loadConfig(),
    organizerPasswordHash: await hashPassword(password),
  };
  const { db, pool } = createDatabase(config.databaseUrl);
  const ids = [randomUUID(), randomUUID()];
  const tokens = ids.map(() => randomBytes(32).toString("base64url"));
  const name = config.appOrigin.startsWith("https:")
    ? "__Host-blackwood-guest"
    : "blackwood-guest-dev";
  const headers = tokens.map((token) => ({
    origin: config.appOrigin,
    "x-guest-request": "1",
    cookie: `${name}=${token}`,
  }));
  const [first, other] = headers;
  assert.ok(first && other && ids[0] && ids[1]);
  const app = buildApp(config, { logger: false });
  const anonymousId = randomUUID();
  t.after(async () => {
    await app.close();
    await db
      .delete(activityEvents)
      .where(inArray(activityEvents.profileId, ids));
    await db.delete(activityEvents).where(eq(activityEvents.id, anonymousId));
    await db.delete(guestSessions).where(inArray(guestSessions.profileId, ids));
    await db.delete(profiles).where(inArray(profiles.id, ids));
    await pool.end();
  });
  await db
    .insert(profiles)
    .values(
      ids.map((id) => ({ id, firstName: "Alex", role: "main" as const })),
    );
  await db.insert(guestSessions).values(
    ids.map((profileId, i) => ({
      profileId,
      tokenHash: hashGuestToken(tokens[i] ?? ""),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    })),
  );
  const body = { id: randomUUID(), kind: "page_view", page: "coffre" };
  const post = (payload: object, who: Record<string, string> = first) =>
    app.inject({
      method: "POST",
      url: "/api/activity/events",
      headers: who,
      payload,
    });
  assert.equal((await post(body)).statusCode, 204);
  assert.equal((await post(body)).statusCode, 204);
  const second = { ...body, id: randomUUID() };
  assert.equal((await post(second, other)).statusCode, 204);
  assert.equal(
    (
      await post(
        {
          id: randomUUID(),
          kind: "client_error",
          page: "profile",
          code: "TypeError",
          source: "index-demo.js:12:4",
        },
        other,
      )
    ).statusCode,
    204,
  );
  assert.equal(
    (await post({ ...body, id: randomUUID(), profileId: ids[1] })).statusCode,
    400,
  );
  assert.equal(
    (
      await post({
        ...body,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await post(
        { ...body, id: randomUUID() },
        { ...first, origin: "https://foreign.example" },
      )
    ).statusCode,
    403,
  );
  const secret = "DO-NOT-STORE-THIS-CODE";
  assert.equal(
    (
      await post({
        id: randomUUID(),
        kind: "api_error",
        page: "coffre",
        route: `/api/media/${ids[0]}/image?code=${secret}#token=${secret}`,
        method: "GET",
        status: 503,
        code: "HTTP_ERROR",
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await post(
        { ...body, id: anonymousId },
        { origin: config.appOrigin, "x-guest-request": "1" },
      )
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await app.inject({
        url: "/api/organizer/activity",
        headers: { ...first, "x-organizer-request": "1" },
      })
    ).statusCode,
    401,
  );
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
  const read = (suffix = "") =>
    app.inject({ url: `/api/organizer/activity${suffix}`, headers: admin });
  const feed = await read(`?profileId=${ids[0]}`);
  assert.equal(feed.statusCode, 200, feed.body);
  assert.equal(feed.headers["cache-control"], "no-store");
  assert.equal(feed.json().events.length, 2);
  assert.ok(
    feed
      .json()
      .events.every((row: { profileId: string }) => row.profileId === ids[0]),
  );
  assert.ok(!feed.body.includes(secret));
  assert.equal(
    feed.json().events.find((row: { kind: string }) => row.kind === "api_error")
      .route,
    "/api/media/:id/image",
  );
  assert.equal((await read(`?profileId=${ids[1]}`)).json().events.length, 2);
  assert.equal(
    (await read(`?profileId=${ids[0]}&onlyErrors=1&page=coffre`)).json().events
      .length,
    1,
  );
  assert.ok(
    (await read("?profileId=anonymous"))
      .json()
      .events.some(
        (row: { id: string; firstName: string | null }) =>
          row.id === anonymousId && row.firstName === null,
      ),
  );
  await db.insert(activityEvents).values(
    Array.from({ length: 60 }, () => ({
      id: randomUUID(),
      profileId: ids[0],
      kind: "page_view",
      page: "profile",
    })),
  );
  const firstPage = (await read(`?profileId=${ids[0]}`)).json();
  assert.equal(firstPage.events.length, 50);
  assert.ok(firstPage.nextCursor);
  const nextPage = (
    await read(`?profileId=${ids[0]}&before=${firstPage.nextCursor}`)
  ).json();
  assert.equal(nextPage.events.length, 12);
  assert.ok(
    !nextPage.events.some((row: { id: string }) =>
      firstPage.events.some((earlier: { id: string }) => earlier.id === row.id),
    ),
  );
});
