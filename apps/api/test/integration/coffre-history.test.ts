import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config/env.ts";
import { createDatabase } from "../../src/db/client.ts";
import {
  coffreContributions,
  coffres,
  guestSessions,
  hubSettings,
  mediaAssets,
  profiles,
} from "../../src/db/schema.ts";
import { hashPassword } from "../../src/modules/organizer/password.ts";
import { hashGuestToken } from "../../src/modules/profiles/service.ts";
import { imageFixture } from "../helpers/media.ts";

test("successive Coffres preserve scoped content, retries, history and protected photos", {
  skip: process.env.BLACKWOOD_ISOLATED_TEST_DB !== "1",
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "blackwood-coffre-history-"));
  const password = "Coffre history test password";
  const config = {
    ...loadConfig(),
    mediaRoot: root,
    organizerPasswordHash: await hashPassword(password),
  };
  const { db, pool } = createDatabase(config.databaseUrl);
  assert.equal(
    (await db.select().from(coffres)).length,
    0,
    "Requires an unused isolated Coffre database.",
  );
  const [settings] = await db.select().from(hubSettings);
  const profileId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  let app = buildApp(config, { logger: false });
  t.after(async () => {
    await app.close();
    await db.delete(coffreContributions);
    await db.delete(coffres);
    await db
      .delete(mediaAssets)
      .where(eq(mediaAssets.ownerProfileId, profileId));
    await db
      .delete(guestSessions)
      .where(eq(guestSessions.profileId, profileId));
    await db.delete(profiles).where(eq(profiles.id, profileId));
    await db
      .update(hubSettings)
      .set({ hubEnabled: settings?.hubEnabled ?? false })
      .where(eq(hubSettings.id, 1));
    await pool.end();
    await rm(root, { recursive: true, force: true });
  });
  await db
    .insert(profiles)
    .values({ id: profileId, firstName: "History fixture", role: "main" });
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
  const guest = {
    origin,
    "x-guest-request": "1",
    cookie: `${origin.startsWith("https:") ? "__Host-blackwood-guest" : "blackwood-guest-dev"}=${token}`,
  };
  const command = (name: string, coffreId: number) =>
    app.inject({
      method: "POST",
      url: `/api/organizer/coffre/${name}?coffreId=${coffreId}`,
      headers: admin,
      payload: {},
    });
  const create = (previousCoffreId: number) =>
    app.inject({
      method: "POST",
      url: "/api/organizer/coffres",
      headers: admin,
      payload: { previousCoffreId },
    });
  const contribution = {
    id: randomUUID(),
    text: "First public memory",
    visibility: "public",
    frameId: "plain",
  };
  const photo = await imageFixture();
  async function deposit(
    coffreId: number,
    data = contribution,
    withPhoto = false,
  ) {
    if (!withPhoto)
      return app.inject({
        method: "POST",
        url: `/api/coffre/contributions?coffreId=${coffreId}`,
        headers: guest,
        payload: data,
      });
    const boundary = `history-${randomUUID()}`;
    return app.inject({
      method: "POST",
      url: `/api/coffre/contributions?coffreId=${coffreId}`,
      headers: {
        ...guest,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="contribution"\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="memory.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
        ),
        photo,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
  }
  const publicPage = (id: number) =>
    app.inject({
      url: `/api/tv/coffre/contributions?coffreId=${id}`,
      headers: guest,
    });
  const metadata = (id: number) =>
    app.inject({
      url: `/api/organizer/coffre/contributions?coffreId=${id}`,
      headers: admin,
    });
  assert.equal((await app.inject({ url: "/api/coffres" })).statusCode, 404);
  assert.equal(
    (await app.inject({ url: "/api/organizer/coffres", headers: guest }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/organizer/coffres",
        headers: guest,
        payload: { previousCoffreId: 1 },
      })
    ).statusCode,
    403,
  );
  const prepared = await app.inject({
    method: "PUT",
    url: "/api/organizer/coffre",
    headers: admin,
    payload: { durationSeconds: 9000 },
  });
  assert.equal(prepared.statusCode, 200, prepared.body);
  assert.equal((await create(1)).json().code, "COFFRE_NOT_REVEALED");
  await command("start", 1);
  assert.equal((await deposit(1, contribution, true)).statusCode, 200);
  const privateData = {
    ...contribution,
    id: randomUUID(),
    text: "First private memory",
    visibility: "private",
  };
  assert.equal((await deposit(1, privateData, true)).statusCode, 200);
  await command("open", 1);
  const original = await db.select().from(coffreContributions);
  const publicPhoto = original.find(
    (row) => row.id === contribution.id,
  )?.photoMediaId;
  const privatePhoto = original.find(
    (row) => row.id === privateData.id,
  )?.photoMediaId;
  assert.ok(publicPhoto);
  assert.ok(privatePhoto);
  assert.equal(
    (
      await app.inject({
        url: `/api/tv/coffre/media/${publicPhoto}/image`,
        headers: guest,
      })
    ).statusCode,
    200,
  );
  const beforeRename = (await db.select().from(coffres))[0];
  const rename = (id: number, name: string) =>
    app.inject({
      method: "PATCH",
      url: `/api/organizer/coffre?coffreId=${id}`,
      headers: admin,
      payload: { name },
    });
  const firstNamed = await rename(1, "  Les secrets de minuit  ");
  assert.equal(firstNamed.statusCode, 200, firstNamed.body);
  assert.equal(firstNamed.json().name, "Les secrets de minuit");
  const afterRename = (await db.select().from(coffres))[0];
  assert.deepEqual({ ...afterRename, name: null }, beforeRename);
  assert.equal(
    (await app.inject({ url: "/api/coffre", headers: guest })).json().name,
    "Les secrets de minuit",
  );
  const results = await Promise.all([create(1), create(1), create(1)]);
  for (const result of results) {
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().id, 2);
    assert.equal(result.json().state, "prepared");
    assert.equal(result.json().durationSeconds, 9000);
    assert.equal(result.json().name, null);
  }
  assert.equal((await rename(2, "La suite 🎃")).json().name, "La suite 🎃");
  assert.equal(
    (await app.inject({ url: "/api/coffre", headers: guest })).json().name,
    "La suite 🎃",
  );
  assert.equal(
    (await rename(1, "Archives de minuit")).json().name,
    "Archives de minuit",
  );
  assert.equal((await rename(999, "Missing Coffre")).statusCode, 404);
  assert.equal((await db.select().from(coffres)).length, 2);
  assert.deepEqual(await db.select().from(coffreContributions), original);
  assert.equal(
    (await app.inject({ url: "/api/coffre", headers: guest })).json().id,
    2,
  );
  assert.equal(
    (
      await app.inject({
        url: "/api/organizer/coffre?coffreId=1",
        headers: admin,
      })
    ).json().state,
    "revealed",
  );
  assert.equal(
    (await app.inject({ url: "/api/coffre?coffreId=1", headers: guest }))
      .statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ url: "/api/coffres", headers: guest })).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ url: "/api/coffre?coffreId=999", headers: guest }))
      .statusCode,
    404,
  );
  for (const invalid of ["0", "-1", "2.5", "nope", "1&coffreId=2"])
    assert.equal(
      (
        await app.inject({
          url: `/api/coffre?coffreId=${invalid}`,
          headers: guest,
        })
      ).statusCode,
      400,
    );
  assert.equal(
    (await deposit(1, contribution, true)).statusCode,
    200,
    "Lost receipts replay in their original Coffre.",
  );
  assert.equal(
    (await deposit(1, { ...contribution, id: randomUUID() })).json().code,
    "COFFRE_REVEALED",
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/coffre/contributions",
        headers: guest,
        payload: { ...contribution, id: randomUUID() },
      })
    ).json().code,
    "COFFRE_REVEALED",
    "Legacy writes cannot silently move to the successor.",
  );
  assert.equal(
    (await deposit(2, { ...contribution, id: randomUUID() })).json().code,
    "COFFRE_NOT_COLLECTING",
  );
  const second = {
    ...contribution,
    id: randomUUID(),
    text: "Second public memory",
  };
  const secondPrivate = {
    ...second,
    id: randomUUID(),
    text: "Second private memory",
    visibility: "private",
  };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/organizer/coffre/contributions?coffreId=2",
        headers: admin,
        payload: secondPrivate,
      })
    ).statusCode,
    200,
  );
  await command("start", 2);
  assert.equal(
    (await deposit(2, contribution, true)).json().code,
    "CONTRIBUTION_CONFLICT",
    "A contribution UUID cannot cross Coffres.",
  );
  assert.equal((await deposit(2, second)).statusCode, 200);
  assert.equal((await create(2)).json().code, "COFFRE_NOT_REVEALED");
  assert.equal((await publicPage(2)).statusCode, 409);
  assert.equal((await publicPage(1)).statusCode, 404);
  assert.equal(
    (
      await app.inject({
        url: `/api/tv/coffre/media/${publicPhoto}/image`,
        headers: guest,
      })
    ).statusCode,
    404,
  );
  for (const [photoId, headers, status] of [
    [publicPhoto, guest, 404],
    [privatePhoto, guest, 404],
    [privatePhoto, admin, 200],
  ] as const) {
    assert.equal(
      (await app.inject({ url: `/api/media/${photoId}/image`, headers }))
        .statusCode,
      status,
    );
  }
  const oldMetadata = (await metadata(1)).json().contributions;
  assert.equal(oldMetadata.length, 2);
  assert.ok(
    oldMetadata.every(
      (row: object) => !("text" in row) && !("photoMediaId" in row),
    ),
  );
  assert.deepEqual(
    (await metadata(2))
      .json()
      .contributions.map((row: { id: string }) => row.id)
      .sort(),
    [second.id, secondPrivate.id].sort(),
  );
  assert.equal(
    (
      await app.inject({
        url: `/api/organizer/coffre/contributions/${privateData.id}?coffreId=2`,
        headers: admin,
      })
    ).statusCode,
    404,
  );
  await app.inject({
    method: "DELETE",
    url: `/api/organizer/coffre/contributions/${privateData.id}?coffreId=2`,
    headers: admin,
  });
  assert.equal((await metadata(1)).json().contributions.length, 2);
  await command("open", 2);
  assert.deepEqual(
    (await publicPage(2))
      .json()
      .contributions.map((row: { text: string }) => row.text),
    [second.text],
  );
  assert.equal((await publicPage(1)).statusCode, 404);
  await app.close();
  app = buildApp(config, { logger: false });
  assert.equal(
    (await app.inject({ url: "/api/coffre", headers: guest })).json().id,
    2,
  );
  assert.equal((await publicPage(1)).statusCode, 404);
  assert.equal(
    (
      await app.inject({
        url: `/api/organizer/coffre/contributions/${contribution.id}?coffreId=1`,
        headers: admin,
      })
    ).json().text,
    contribution.text,
  );
  const history = (
    await app.inject({ url: "/api/organizer/coffres", headers: admin })
  ).json();
  assert.equal(
    history.coffres.find((row: { id: number }) => row.id === 1)?.name,
    "Archives de minuit",
  );
  assert.equal(
    history.coffres.find((row: { id: number }) => row.id === 2)?.name,
    "La suite 🎃",
  );
  assert.deepEqual(
    history.coffres.map((row: { id: number }) => row.id),
    [2, 1],
  );
  assert.ok(
    history.coffres.every(
      (row: object) => !("contributions" in row) && !("author" in row),
    ),
  );
  await app.inject({
    method: "DELETE",
    url: `/api/organizer/coffre/contributions/${privateData.id}?coffreId=1`,
    headers: admin,
  });
  assert.equal(
    (
      await app.inject({
        url: `/api/media/${privatePhoto}/image`,
        headers: admin,
      })
    ).statusCode,
    404,
  );
  await db.insert(coffres).values(
    Array.from({ length: 51 }, (_, i) => ({
      id: i + 3,
      durationSeconds: 1,
      startedAt: new Date(Date.now() - 5000),
      deadline: new Date(Date.now() - 4500),
    })),
  );
  const first = (
    await app.inject({ url: "/api/organizer/coffres", headers: admin })
  ).json();
  assert.equal(first.coffres.length, 50);
  const last = (
    await app.inject({
      url: `/api/organizer/coffres?before=${first.nextCursor}`,
      headers: admin,
    })
  ).json();
  assert.equal(last.nextCursor, null);
  assert.deepEqual(
    last.coffres.map((row: { id: number }) => row.id),
    [3, 2, 1],
  );
});
