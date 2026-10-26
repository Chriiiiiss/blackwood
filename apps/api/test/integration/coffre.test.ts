import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { and, eq, inArray, sql } from "drizzle-orm";
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
import { createCoffreRepository } from "../../src/modules/coffre/repository.ts";
import type { ContributionInput } from "../../src/modules/coffre/schemas.ts";
import { createMediaRepository } from "../../src/modules/media/repository.ts";
import { createMediaService } from "../../src/modules/media/service.ts";
import { createMediaStorage } from "../../src/modules/media/storage.ts";
import { hashPassword } from "../../src/modules/organizer/password.ts";
import { hashGuestToken } from "../../src/modules/profiles/service.ts";
import { imageFixture, multipart } from "../helpers/media.ts";

test("Coffre lifecycle, immutable deposits, countdown races and protected media use real PostgreSQL", {
  skip: process.env.BLACKWOOD_ISOLATED_TEST_DB !== "1",
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "blackwood-coffre-"));
  const password = "Coffre integration password";
  const config = {
    ...loadConfig(),
    mediaRoot: root,
    organizerPasswordHash: await hashPassword(password),
  };
  const { db, pool } = createDatabase(config.databaseUrl);
  assert.equal(
    (await db.select().from(coffres)).length,
    0,
    "Coffre tests require an unused isolated database",
  );
  const [settings] = await db.select().from(hubSettings);
  const profileIds = [randomUUID(), randomUUID()];
  const tokens = [
    randomBytes(32).toString("base64url"),
    randomBytes(32).toString("base64url"),
  ];
  const guestCookie = config.appOrigin.startsWith("https:")
    ? "__Host-blackwood-guest"
    : "blackwood-guest-dev";
  const headers = {
    origin: config.appOrigin,
    "x-guest-request": "1",
    cookie: `${guestCookie}=${tokens[0]}`,
  };
  const other = { ...headers, cookie: `${guestCookie}=${tokens[1]}` };
  let admin = {
    origin: config.appOrigin,
    "x-organizer-request": "1",
    cookie: "",
  };
  let app = buildApp(config, { logger: false });
  const assets = new Set<string>();
  t.after(async () => {
    await app.close();
    await db
      .delete(coffreContributions)
      .where(eq(coffreContributions.coffreId, 1));
    await db.delete(coffres).where(eq(coffres.id, 1));
    const remaining = await db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(eq(mediaAssets.purpose, "photo"));
    for (const asset of remaining) assets.add(asset.id);
    if (assets.size)
      await db.delete(mediaAssets).where(inArray(mediaAssets.id, [...assets]));
    await db
      .delete(guestSessions)
      .where(inArray(guestSessions.profileId, profileIds));
    await db.delete(profiles).where(inArray(profiles.id, profileIds));
    await db
      .update(hubSettings)
      .set({ hubEnabled: settings?.hubEnabled ?? false })
      .where(eq(hubSettings.id, 1));
    await pool.end();
    await rm(root, { recursive: true, force: true });
  });
  await db.insert(profiles).values(
    profileIds.map((id) => ({
      id,
      firstName: "Same test name",
      role: "main" as const,
    })),
  );
  await db.insert(guestSessions).values(
    profileIds.map((profileId, index) => ({
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
  const login = await app.inject({
    method: "POST",
    url: "/api/organizer/session",
    headers: admin,
    payload: { password },
  });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = login.cookies.find((row) => row.name.includes("organizer"));
  assert.ok(cookie);
  admin = { ...admin, cookie: `${cookie.name}=${cookie.value}` };
  const base = "/api/coffre";
  const management = "/api/organizer/coffre";
  const textInput = (
    overrides: Partial<ContributionInput> = {},
  ): ContributionInput => ({
    id: randomUUID(),
    text: "A public wish",
    visibility: "public",
    frameId: "plain",
    ...overrides,
  });
  const deposit = (
    payload: ContributionInput,
    customHeaders: Record<string, string> = headers,
    administrative = false,
  ) =>
    app.inject({
      method: "POST",
      url: `${administrative ? management : base}/contributions`,
      headers: customHeaders,
      payload,
    });
  const image = await imageFixture();
  const file = { name: "file", filename: "untrusted-name.jpg", data: image };
  const photo = (
    input: ContributionInput,
    customHeaders: Record<string, string> = headers,
    administrative = false,
    parts = [{ name: "contribution", data: JSON.stringify(input) }, file],
  ) => {
    const form = multipart(parts);
    return app.inject({
      method: "POST",
      url: `${administrative ? management : base}/contributions`,
      headers: { ...customHeaders, "content-type": form.contentType },
      payload: form.payload,
    });
  };
  const noStaged = async () => {
    assert.deepEqual(await readdir(join(root, ".tmp")), []);
    const rows = await db
      .select({ status: mediaAssets.status })
      .from(mediaAssets)
      .where(eq(mediaAssets.purpose, "photo"));
    assert.ok(
      rows.every((row) => row.status === "ready"),
      JSON.stringify(rows),
    );
  };
  const preparedPrivate = textInput({
    text: "Private organizer secret",
    visibility: "private",
  });
  let publicPhotoId = "";
  let privatePhotoId = "";
  const publicPhoto = textInput({ text: "Photo reveal", frameId: "plain" });
  const privatePhoto = textInput({
    text: "Private guest secret",
    visibility: "private",
  });

  await t.test(
    "authentication and the hub protect state and reject writes before preparation",
    async () => {
      for (const url of [base, `${base}/contributions`]) {
        const response = await app.inject({ url });
        assert.equal(response.statusCode, 401, response.body);
        assert.match(String(response.headers["cache-control"]), /no-store/);
      }
      const state = await app.inject({ url: base, headers });
      assert.equal(state.statusCode, 200, state.body);
      assert.equal(state.json().state, "unprepared");
      assert.equal(
        (await deposit(textInput())).json().code,
        "COFFRE_NOT_PREPARED",
      );
      assert.equal(
        (await deposit(preparedPrivate, admin, true)).json().code,
        "COFFRE_NOT_PREPARED",
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `${management}/start`,
            headers: admin,
            payload: {},
          })
        ).json().code,
        "COFFRE_NOT_PREPARED",
      );
      assert.equal(
        (await app.inject({ url: management, headers })).statusCode,
        403,
      );
      assert.equal(
        (
          await app.inject({
            url: management,
            headers: { ...admin, cookie: headers.cookie },
          })
        ).statusCode,
        401,
      );
      assert.equal(
        (
          await app.inject({
            method: "PUT",
            url: management,
            headers: { ...admin, origin: "https://foreign.example" },
            payload: { durationSeconds: 3600 },
          })
        ).statusCode,
        403,
      );
      await db
        .update(hubSettings)
        .set({ hubEnabled: false })
        .where(eq(hubSettings.id, 1));
      assert.equal(
        (await app.inject({ url: base, headers })).json().code,
        "HUB_CLOSED",
      );
      await db
        .update(hubSettings)
        .set({ hubEnabled: true })
        .where(eq(hubSettings.id, 1));
    },
  );

  await t.test(
    "only the organizer deposits into a prepared Coffre; metadata does not load content",
    async () => {
      for (const durationSeconds of [3600, 7200]) {
        const response = await app.inject({
          method: "PUT",
          url: management,
          headers: admin,
          payload: { durationSeconds },
        });
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.json().state, "prepared");
        assert.equal(response.json().durationSeconds, durationSeconds);
        assert.equal(response.json().deadline, null);
      }
      assert.equal(
        (await deposit(textInput())).json().code,
        "COFFRE_NOT_COLLECTING",
      );
      const rejected = await photo(textInput());
      assert.equal(
        rejected.json().code,
        "COFFRE_NOT_COLLECTING",
        rejected.body,
      );
      await noStaged();
      const saved = await deposit(preparedPrivate, admin, true);
      assert.deepEqual(saved.json(), {
        id: preparedPrivate.id,
        received: true,
      });
      const metadata = await app.inject({
        url: `${management}/contributions`,
        headers: admin,
      });
      assert.equal(metadata.statusCode, 200, metadata.body);
      assert.equal(metadata.json().contributions.length, 1);
      assert.deepEqual(Object.keys(metadata.json().contributions[0]).sort(), [
        "author",
        "createdAt",
        "frameId",
        "hasPhoto",
        "hasText",
        "id",
        "visibility",
      ]);
      assert.ok(!metadata.body.includes(preparedPrivate.text ?? ""));
      const detail = await app.inject({
        url: `${management}/contributions/${preparedPrivate.id}`,
        headers: admin,
      });
      assert.equal(detail.json().text, preparedPrivate.text);
      assert.equal(detail.json().author, null);
      assert.equal(
        (await app.inject({ url: `${base}/contributions`, headers })).json()
          .code,
        "COFFRE_NOT_REVEALED",
      );
    },
  );

  await t.test(
    "start is atomic and idempotent; restart preserves the shared deadline",
    async () => {
      const starts = await Promise.all(
        [1, 2].map(() =>
          app.inject({
            method: "POST",
            url: `${management}/start`,
            headers: admin,
            payload: {},
          }),
        ),
      );
      for (const result of starts)
        assert.equal(result.statusCode, 200, result.body);
      assert.equal(starts[0]?.json().deadline, starts[1]?.json().deadline);
      const deadline = starts[0]?.json().deadline;
      assert.equal(
        (
          await app.inject({
            method: "PUT",
            url: management,
            headers: admin,
            payload: { durationSeconds: 1 },
          })
        ).json().code,
        "COFFRE_ALREADY_STARTED",
      );
      for (const action of ["pause", "reset", "stop", "reopen"])
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: `${management}/${action}`,
              headers: admin,
              payload: {},
            })
          ).statusCode,
          404,
        );
      await app.close();
      app = buildApp(config, { logger: false });
      const resumed = await app.inject({ url: base, headers });
      assert.equal(resumed.json().deadline, deadline);
      assert.equal(resumed.json().state, "collecting");
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `${management}/start`,
            headers: admin,
            payload: {},
          })
        ).json().deadline,
        deadline,
      );
    },
  );

  await t.test(
    "retries cannot duplicate or edit contributions, including homonymous guests",
    async () => {
      const input = textInput({
        frameId: "one-wish-willow",
        text: "👻".repeat(500),
      });
      const saved = await Promise.all([deposit(input), deposit(input)]);
      for (const result of saved)
        assert.deepEqual(result.json(), { id: input.id, received: true });
      assert.equal(
        (
          await db
            .select()
            .from(coffreContributions)
            .where(eq(coffreContributions.id, input.id))
        ).length,
        1,
      );
      assert.equal(
        (await deposit({ ...input, text: "Different content" })).json().code,
        "CONTRIBUTION_CONFLICT",
      );
      assert.equal(
        (await deposit(input, other)).json().code,
        "CONTRIBUTION_CONFLICT",
      );
      assert.equal((await deposit(textInput(), other)).statusCode, 200);
      for (const method of ["GET", "PATCH", "DELETE"] as const) {
        assert.equal(
          (
            await app.inject({
              method,
              url: `${base}/contributions/${input.id}`,
              headers,
            })
          ).statusCode,
          404,
        );
      }
      assert.equal(
        (
          await app.inject({
            url: `${management}/contributions/${input.id}`,
            headers: { ...headers, "x-organizer-request": "1" },
          })
        ).statusCode,
        401,
      );
    },
  );

  await t.test(
    "photos attach atomically and remain unreadable by their author before reveal",
    async () => {
      const saved = await photo(publicPhoto);
      assert.equal(saved.statusCode, 200, saved.body);
      assert.deepEqual(saved.json(), { id: publicPhoto.id, received: true });
      const detail = await app.inject({
        url: `${management}/contributions/${publicPhoto.id}`,
        headers: admin,
      });
      publicPhotoId = detail.json().photoMediaId;
      assert.equal(detail.json().author.profileId, profileIds[0]);
      assets.add(publicPhotoId);
      const secret = await photo(privatePhoto);
      assert.equal(secret.statusCode, 200, secret.body);
      privatePhotoId = (
        await app.inject({
          url: `${management}/contributions/${privatePhoto.id}`,
          headers: admin,
        })
      ).json().photoMediaId;
      assets.add(privatePhotoId);
      for (const mediaId of [publicPhotoId, privatePhotoId]) {
        for (const variant of ["image", "thumbnail"]) {
          const url = `/api/media/${mediaId}/${variant}`;
          for (const customHeaders of [{}, headers, other])
            assert.equal(
              (await app.inject({ url, headers: customHeaders })).statusCode,
              404,
            );
          assert.equal(
            (await app.inject({ url, headers: admin })).statusCode,
            200,
          );
        }
      }
      const retried = await photo(publicPhoto);
      assert.deepEqual(retried.json(), { id: publicPhoto.id, received: true });
      assert.equal(
        (
          await app.inject({
            url: `${management}/contributions/${publicPhoto.id}`,
            headers: admin,
          })
        ).json().photoMediaId,
        publicPhotoId,
      );
      const wrong = await photo({
        ...publicPhoto,
        text: "Altered photo caption",
      });
      assert.equal(wrong.json().code, "CONTRIBUTION_CONFLICT");
      const changedBytes = await photo(publicPhoto, headers, false, [
        { name: "contribution", data: JSON.stringify(publicPhoto) },
        { ...file, data: await imageFixture("png") },
      ]);
      assert.equal(changedBytes.json().code, "CONTRIBUTION_CONFLICT");
      await noStaged();
    },
  );

  await t.test(
    "malformed and invalid photo envelopes leave no files or staged rows",
    async () => {
      const metadata = {
        name: "contribution",
        data: JSON.stringify(textInput()),
      };
      const badParts = [
        [],
        [file],
        [metadata],
        [metadata, { ...file, name: "unknown" }],
        [metadata, file, file],
        [metadata, metadata, file],
        [{ ...metadata, data: "not JSON" }, file],
        [
          {
            ...metadata,
            data: JSON.stringify({
              ...textInput(),
              photoMediaId: publicPhotoId,
            }),
          },
          file,
        ],
        [metadata, { ...file, data: Buffer.from("Not an image") }],
      ];
      const before = (await readdir(root)).sort();
      for (const parts of badParts) {
        const response = await photo(textInput(), headers, false, parts);
        assert.ok(
          response.statusCode >= 400 && response.statusCode < 500,
          response.body,
        );
        assert.ok(!response.body.includes(root));
        await noStaged();
        assert.deepEqual((await readdir(root)).sort(), before);
      }
      assert.equal(
        (await photo(textInput({ frameId: "one-wish-willow" }))).json().code,
        "FRAME_CONTENT_MISMATCH",
      );
      const reversed = textInput({ text: "" });
      assert.equal(
        (
          await photo(reversed, headers, false, [
            file,
            { name: "contribution", data: JSON.stringify(reversed) },
          ])
        ).statusCode,
        200,
      );
      await noStaged();
    },
  );

  await t.test(
    "revocation and hub closure during upload are checked again before attachment",
    async () => {
      // Simulate completed processing after access changed, using the same internal seam as HTTP.
      const repository = createCoffreRepository(db, createMediaRepository(db));
      const media = createMediaService(
        createMediaRepository(db),
        createMediaStorage(root),
        repository.mediaContext,
      );
      const owner = profileIds[0];
      assert.ok(owner);
      const staged = await media.preparePhoto(owner, async (input) => {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(input, image);
        return undefined;
      });
      const actor = {
        kind: "guest" as const,
        profileId: owner,
        sessionHash: hashGuestToken(tokens[0] ?? ""),
      };
      await db
        .update(hubSettings)
        .set({ hubEnabled: false })
        .where(eq(hubSettings.id, 1));
      await assert.rejects(
        () =>
          repository.deposit(textInput(), "Photo", "hash", staged.id, actor),
        { code: "HUB_CLOSED" },
      );
      await db
        .update(hubSettings)
        .set({ hubEnabled: true })
        .where(eq(hubSettings.id, 1));
      await db
        .update(profiles)
        .set({ legacyAccessEnabled: false })
        .where(eq(profiles.id, owner));
      await assert.rejects(
        () =>
          repository.deposit(textInput(), "Photo", "hash", staged.id, actor),
        { code: "GUEST_UNAUTHENTICATED" },
      );
      assert.equal(
        (
          await app.inject({
            url: `/api/media/${publicPhotoId}/image`,
            headers,
          })
        ).statusCode,
        404,
      );
      await db
        .update(profiles)
        .set({ legacyAccessEnabled: true })
        .where(eq(profiles.id, owner));
      await db
        .update(guestSessions)
        .set({ expiresAt: new Date(0) })
        .where(eq(guestSessions.profileId, owner));
      await assert.rejects(
        () =>
          repository.deposit(textInput(), "Photo", "hash", staged.id, actor),
        { code: "GUEST_UNAUTHENTICATED" },
      );
      await db
        .update(guestSessions)
        .set({ expiresAt: new Date(Date.now() + 86_400_000) })
        .where(eq(guestSessions.profileId, owner));
      await media.discardPhoto(staged.id);
      await noStaged();
    },
  );

  await t.test(
    "an upload or lock wait crossing the deadline cannot use transaction start time",
    async () => {
      // Updating only this test-owned Coffre allows a deterministic deadline race without sleeping hours.
      const boundary = Date.now();
      await db
        .update(coffres)
        .set({
          durationSeconds: 2,
          startedAt: new Date(boundary - 1000),
          deadline: new Date(boundary + 1000),
        })
        .where(eq(coffres.id, 1));
      let locked!: () => void;
      const lockReady = new Promise<void>((resolve) => {
        locked = resolve;
      });
      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const blocking = db.transaction(async (tx) => {
        await tx.select().from(coffres).where(eq(coffres.id, 1)).for("update");
        locked();
        await hold;
      });
      await lockReady;
      const delayed = deposit(textInput());
      try {
        let waiting = false;
        for (let attempt = 0; attempt < 60; attempt++) {
          const result = await db.execute<{ startedAt: Date }>(
            sql`select xact_start as "startedAt" from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock' and query like ${'%from "coffres"%for update%'} limit 1`,
          );
          if (result.rows.length) {
            assert.ok(
              new Date(result.rows[0]?.startedAt ?? 0).getTime() <
                boundary + 1000,
            );
            waiting = true;
            break;
          }
          await setTimeout(10);
        }
        assert.ok(
          waiting,
          "The deposit must actually wait on PostgreSQL before the deadline",
        );
        await setTimeout(Math.max(0, boundary + 1050 - Date.now()));
      } finally {
        release();
        await blocking;
      }
      const response = await delayed;
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().code, "COFFRE_REVEALED");
      const expiredUpload = await photo(textInput());
      assert.equal(expiredUpload.json().code, "COFFRE_REVEALED");
      await noStaged();
    },
  );

  await t.test(
    "reveal exposes only public content to connected guests and TV; pagination is stable",
    async () => {
      const state = await app.inject({ url: base, headers });
      assert.equal(state.json().state, "revealed");
      const listing = await app.inject({
        url: `${base}/contributions`,
        headers: other,
      });
      assert.equal(listing.statusCode, 200, listing.body);
      assert.ok(
        listing
          .json()
          .contributions.some(
            (row: { id: string }) => row.id === publicPhoto.id,
          ),
      );
      assert.ok(!listing.body.includes("Private"));
      assert.ok(!listing.body.includes("author"));
      assert.ok(!listing.body.includes("Same test name"));
      assert.ok(!listing.body.includes(profileIds[0] ?? ""));
      assert.ok(!listing.body.includes("requestHash"));
      assert.ok(!listing.body.includes(privatePhotoId));
      for (const variant of ["image", "thumbnail"]) {
        assert.equal(
          (
            await app.inject({
              url: `/api/media/${publicPhotoId}/${variant}`,
              headers: other,
            })
          ).statusCode,
          200,
        );
        assert.equal(
          (
            await app.inject({
              url: `/api/media/${privatePhotoId}/${variant}`,
              headers: other,
            })
          ).statusCode,
          404,
        );
        assert.equal(
          (await app.inject({ url: `/api/media/${publicPhotoId}/${variant}` }))
            .statusCode,
          404,
        );
      }
      // A lost success response can still be retried after closure, without creating a new deposit.
      assert.deepEqual((await photo(publicPhoto)).json(), {
        id: publicPhoto.id,
        received: true,
      });
      assert.equal((await deposit(textInput())).json().code, "COFFRE_REVEALED");
      const rows = Array.from({ length: 55 }, () => ({
        ...textInput(),
        coffreId: 1,
        authorProfileId: profileIds[0],
        requestHash: "pagination fixture",
        text: "Pagination fixture",
      }));
      await db.insert(coffreContributions).values(rows);
      const first = await app.inject({ url: `${base}/contributions`, headers });
      assert.equal(first.json().contributions.length, 50);
      assert.ok(first.json().nextCursor);
      const second = await app.inject({
        url: `${base}/contributions?after=${first.json().nextCursor}`,
        headers,
      });
      const ids = [
        ...first.json().contributions,
        ...second.json().contributions,
      ].map((row) => row.id);
      assert.equal(new Set(ids).size, ids.length);
      const expected = await db
        .select({ id: coffreContributions.id })
        .from(coffreContributions)
        .where(
          and(
            eq(coffreContributions.visibility, "public"),
            sql`${coffreContributions.deletedAt} IS NULL`,
          ),
        );
      assert.equal(ids.length, expected.length);
      assert.equal(second.json().nextCursor, null);
      assert.equal(
        (
          await app.inject({
            url: `${base}/contributions?after=invalid`,
            headers,
          })
        ).statusCode,
        400,
      );
    },
  );

  await t.test(
    "organizer deletion needs no content read, revokes media and prevents resurrection",
    async () => {
      const privateListing = await app.inject({
        url: `${management}/contributions?visibility=private`,
        headers: admin,
      });
      assert.ok(
        privateListing
          .json()
          .contributions.some(
            (row: { id: string }) => row.id === privatePhoto.id,
          ),
      );
      assert.ok(!privateListing.body.includes("Private guest secret"));
      for (const input of [publicPhoto, privatePhoto]) {
        const removed = await app.inject({
          method: "DELETE",
          url: `${management}/contributions/${input.id}`,
          headers: admin,
        });
        assert.equal(removed.statusCode, 204, removed.body);
        assert.equal(
          (
            await app.inject({
              method: "DELETE",
              url: `${management}/contributions/${input.id}`,
              headers: admin,
            })
          ).statusCode,
          204,
        );
        assert.equal(
          (
            await app.inject({
              url: `${management}/contributions/${input.id}`,
              headers: admin,
            })
          ).statusCode,
          404,
        );
        assert.equal((await photo(input)).json().code, "CONTRIBUTION_CONFLICT");
      }
      for (const id of [publicPhotoId, privatePhotoId]) {
        for (const customHeaders of [headers, admin])
          assert.equal(
            (
              await app.inject({
                url: `/api/media/${id}/image`,
                headers: customHeaders,
              })
            ).statusCode,
            404,
          );
        assert.equal((await readdir(root)).includes(id), false);
      }
      const [tombstone] = await db
        .select()
        .from(coffreContributions)
        .where(eq(coffreContributions.id, privatePhoto.id));
      assert.equal(tombstone?.text, null);
      assert.equal(tombstone?.photoMediaId, null);
      assert.ok(tombstone?.deletedAt);
      assert.ok(
        !(
          await app.inject({ url: `${base}/contributions`, headers })
        ).body.includes(publicPhotoId),
      );
      await noStaged();
    },
  );
});
