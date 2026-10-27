import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import Fastify from "fastify";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config/env.ts";
import { createDatabase } from "../../src/db/client.ts";
import {
  guestSessions,
  hubSettings,
  mediaAssets,
  profiles,
} from "../../src/db/schema.ts";
import { MediaError } from "../../src/modules/media/errors.ts";
import { mediaModule } from "../../src/modules/media/index.ts";
import { mediaLimits } from "../../src/modules/media/limits.ts";
import type { ContributionMediaContext } from "../../src/modules/media/policy.ts";
import { createMediaRepository } from "../../src/modules/media/repository.ts";
import { createMediaService } from "../../src/modules/media/service.ts";
import { createMediaStorage } from "../../src/modules/media/storage.ts";
import { hashPassword } from "../../src/modules/organizer/password.ts";
import { hashGuestToken } from "../../src/modules/profiles/service.ts";
import { imageFixture, multipart } from "../helpers/media.ts";

test("media HTTP lifecycle, access policies and crash cleanup use real PostgreSQL and files", {
  skip: process.env.BLACKWOOD_ISOLATED_TEST_DB !== "1",
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "blackwood-media-db-"));
  const password = "Media integration password";
  const config = {
    ...loadConfig(),
    mediaRoot: root,
    organizerPasswordHash: await hashPassword(password),
  };
  const { db, pool } = createDatabase(config.databaseUrl);
  const owner = randomUUID();
  const other = randomUUID();
  const tokens = [
    randomBytes(32).toString("base64url"),
    randomBytes(32).toString("base64url"),
  ];
  const cookieName = config.appOrigin.startsWith("https:")
    ? "__Host-blackwood-guest"
    : "blackwood-guest-dev";
  const headers = {
    origin: config.appOrigin,
    "x-guest-request": "1",
    cookie: `${cookieName}=${tokens[0]}`,
  };
  const otherHeaders = { ...headers, cookie: `${cookieName}=${tokens[1]}` };
  const [settings] = await db.select().from(hubSettings);
  let app = buildApp(config, { logger: false });
  t.after(async () => {
    await app.close();
    await db
      .update(profiles)
      .set({ avatarMediaId: null })
      .where(inArray(profiles.id, [owner, other]));
    await db
      .delete(mediaAssets)
      .where(inArray(mediaAssets.ownerProfileId, [owner, other]));
    await db
      .delete(guestSessions)
      .where(inArray(guestSessions.profileId, [owner, other]));
    await db.delete(profiles).where(inArray(profiles.id, [owner, other]));
    await db
      .update(hubSettings)
      .set({ hubEnabled: settings?.hubEnabled ?? false })
      .where(eq(hubSettings.id, 1));
    await pool.end();
    await rm(root, { recursive: true, force: true });
  });
  await db.insert(profiles).values(
    [owner, other].map((id) => ({
      id,
      firstName: "Media fixture",
      role: "main" as const,
    })),
  );
  await db.insert(guestSessions).values(
    [owner, other].map((profileId, index) => ({
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
  const input = await imageFixture();
  const avatarUrl = "/api/profiles/me/avatar";
  const upload = async (
    parts: Parameters<typeof multipart>[0],
    customHeaders = headers,
  ) => {
    const form = multipart(parts);
    return app.inject({
      method: "PUT",
      url: avatarUrl,
      headers: { ...customHeaders, "content-type": form.contentType },
      payload: form.payload,
    });
  };
  const file = { name: "file", filename: "untrusted-name.jpg", data: input };
  const assertClean = async (id?: string) => {
    assert.deepEqual(
      (await readdir(root)).sort(),
      [".tmp", ...(id ? [id] : [])].sort(),
    );
    assert.deepEqual(await readdir(join(root, ".tmp")), []);
    const rows = await db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.ownerProfileId, owner));
    assert.deepEqual(
      rows.map((row) => row.id),
      id ? [id] : [],
    );
  };

  await t.test(
    "uploads attach an avatar, protect direct URLs and reject malformed forms without orphans",
    async () => {
      const missingSession = await upload([file], { ...headers, cookie: "" });
      assert.equal(missingSession.statusCode, 401, missingSession.body);
      assert.equal(
        (await upload([file], { ...headers, origin: "https://other.example" }))
          .statusCode,
        403,
      );
      const saved = await upload([file]);
      assert.equal(saved.statusCode, 200, saved.body);
      const id = saved.json().avatarMediaId as string;
      assert.ok(id);
      assert.ok(!saved.body.includes(root));
      const [asset] = await db
        .select()
        .from(mediaAssets)
        .where(eq(mediaAssets.id, id));
      assert.equal(asset?.status, "ready");
      assert.deepEqual([asset?.width, asset?.height], [512, 512]);
      await assertClean(id);
      assert.deepEqual(await readdir(join(root, id)), ["image.jpg"]);
      const url = `/api/media/${id}/image`;
      for (const requestHeaders of [
        {},
        otherHeaders,
        { cookie: `${cookieName}=invalid` },
      ]) {
        const denied = await app.inject({ url, headers: requestHeaders });
        assert.equal(denied.statusCode, 404, denied.body);
        assert.equal(denied.headers["cache-control"], "private, no-store");
        assert.match(String(denied.headers.vary), /Cookie/);
      }
      const image = await app.inject({ url, headers });
      assert.equal(image.statusCode, 200, image.body);
      assert.equal(image.headers["content-type"], "image/jpeg");
      assert.deepEqual(
        image.rawPayload,
        await readFile(join(root, id, "image.jpg")),
      );
      assert.equal(
        (await app.inject({ url: `/api/media/${id}/thumbnail`, headers }))
          .statusCode,
        404,
      );
      assert.equal(
        (await app.inject({ url: "/api/media/invalid/image", headers }))
          .statusCode,
        400,
      );
      const badForms = [
        [],
        [{ name: "crop", data: "{}" }],
        [{ ...file, name: "unexpected" }],
        [file, file],
        [file, { name: "unknown", data: "value" }],
        [file, { name: "crop", data: "not JSON" }],
        [
          file,
          { name: "crop", data: JSON.stringify({ left: -1, top: 0, size: 1 }) },
        ],
        [
          file,
          {
            name: "crop",
            data: JSON.stringify({ left: 0.9, top: 0.9, size: 1 }),
          },
        ],
        [file, { name: "crop", data: "x".repeat(513) }],
        [file, { name: "crop", data: "{}" }, { name: "crop", data: "{}" }],
        [{ ...file, data: Buffer.from("not a JPEG") }],
        [
          {
            ...file,
            data: Buffer.from(
              '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
            ),
          },
        ],
        [{ ...file, data: Buffer.alloc(mediaLimits.fileBytes + 1, 0) }],
      ];
      for (const parts of badForms) {
        const rejected = await upload(parts);
        assert.ok(
          rejected.statusCode >= 400 && rejected.statusCode < 500,
          rejected.body,
        );
        assert.ok(!rejected.body.includes(root));
        await assertClean(id);
      }
      await db
        .update(hubSettings)
        .set({ hubEnabled: false })
        .where(eq(hubSettings.id, 1));
      assert.equal((await upload([file])).statusCode, 403);
      assert.equal((await app.inject({ url, headers })).statusCode, 404);
      await db
        .update(hubSettings)
        .set({ hubEnabled: true })
        .where(eq(hubSettings.id, 1));
      await db
        .update(guestSessions)
        .set({ expiresAt: new Date(0) })
        .where(eq(guestSessions.tokenHash, hashGuestToken(tokens[1] ?? "")));
      assert.equal((await upload([file], otherHeaders)).statusCode, 401);
      await db
        .update(guestSessions)
        .set({ expiresAt: new Date(Date.now() + 86_400_000) })
        .where(eq(guestSessions.tokenHash, hashGuestToken(tokens[1] ?? "")));
      const replaced = await upload([
        file,
        { name: "crop", data: JSON.stringify({ left: 0, top: 0, size: 0.5 }) },
      ]);
      assert.equal(replaced.statusCode, 200, replaced.body);
      const replacement = replaced.json().avatarMediaId as string;
      assert.notEqual(replacement, id);
      assert.equal((await app.inject({ url, headers })).statusCode, 404);
      await assertClean(replacement);
      await app.close();
      app = buildApp(config, { logger: false });
      assert.equal(
        (await app.inject({ url: `/api/media/${replacement}/image`, headers }))
          .statusCode,
        200,
      );
      const deleted = await app.inject({
        method: "DELETE",
        url: avatarUrl,
        headers,
      });
      assert.equal(deleted.statusCode, 200, deleted.body);
      assert.equal(deleted.json().avatarMediaId, null);
      await assertClean();
      assert.equal(
        (await app.inject({ method: "DELETE", url: avatarUrl, headers }))
          .statusCode,
        200,
      );
    },
  );

  await t.test(
    "busy uploads, commit-time hub closure and crash leftovers cannot orphan files",
    async () => {
      const repository = createMediaRepository(db);
      const storage = createMediaStorage(root);
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started: () => void = () => {};
      const receiving = new Promise<void>((resolve) => {
        started = resolve;
      });
      const service = createMediaService(repository, storage);
      const pending = service.uploadAvatar(owner, async (path) => {
        await writeFile(path, input);
        started();
        await gate;
        return undefined;
      });
      await receiving;
      await assert.rejects(
        service.uploadAvatar(owner, async () => undefined),
        (error: unknown) =>
          error instanceof MediaError && error.code === "MEDIA_BUSY",
      );
      await db
        .update(hubSettings)
        .set({ hubEnabled: false })
        .where(eq(hubSettings.id, 1));
      release();
      await assert.rejects(
        pending,
        (error: unknown) =>
          error instanceof MediaError && error.code === "HUB_CLOSED",
      );
      await assertClean();
      await db
        .update(hubSettings)
        .set({ hubEnabled: true })
        .where(eq(hubSettings.id, 1));
      const ready = await service.uploadAvatar(owner, async (path) => {
        await writeFile(path, input);
        return undefined;
      });
      for (const stage of ["pending", "staged"] as const) {
        const id = randomUUID();
        await repository.begin(id, owner, "photo");
        const temporary = await storage.begin(id);
        await copyFile(join(root, ready.id, "image.jpg"), temporary.input);
        if (stage === "staged") {
          await copyFile(temporary.input, join(temporary.output, "image.jpg"));
          await storage.publish(id, temporary.output);
          await repository.stage(id, {
            width: 512,
            height: 512,
            bytes: input.length,
            thumbnailWidth: null,
            thumbnailHeight: null,
            thumbnailBytes: null,
          });
        }
        await db
          .update(mediaAssets)
          .set({ updatedAt: new Date(0) })
          .where(eq(mediaAssets.id, id));
      }
      await app.close();
      app = buildApp(config, { logger: false });
      await app.ready();
      await assertClean(ready.id);
      await service.deleteAvatar(owner);
      await assertClean();
    },
  );

  await t.test(
    "Coffre attachment is atomic and routes apply server visibility to images and thumbnails",
    async () => {
      const repository = createMediaRepository(db);
      const storage = createMediaStorage(root);
      const service = createMediaService(repository, storage);
      const photo = await service.preparePhoto(owner, async (path) => {
        await writeFile(path, input);
        return undefined;
      });
      await assert.rejects(
        db.transaction((tx) => service.attachPhoto(tx, photo.id, other)),
        (error: unknown) =>
          error instanceof MediaError && error.code === "MEDIA_NOT_ATTACHABLE",
      );
      await assert.rejects(
        db.transaction(async (tx) => {
          await service.attachPhoto(tx, photo.id, owner);
          throw Error("Rollback contribution");
        }),
      );
      assert.equal((await repository.find(photo.id))?.status, "staged");
      await db.transaction((tx) => service.attachPhoto(tx, photo.id, owner));
      await assert.rejects(
        db.transaction((tx) => service.attachPhoto(tx, photo.id, owner)),
        (error: unknown) =>
          error instanceof MediaError && error.code === "MEDIA_NOT_ATTACHABLE",
      );
      const login = await app.inject({
        method: "POST",
        url: "/api/organizer/session",
        headers: { origin: config.appOrigin, "x-organizer-request": "1" },
        payload: { password },
      });
      assert.equal(login.statusCode, 200, login.body);
      const organizerHeaders = {
        cookie: String(login.headers["set-cookie"]).split(";")[0] ?? "",
      };
      assert.equal(
        (
          await app.inject({
            url: `/api/media/${photo.id}/image`,
            headers: organizerHeaders,
          })
        ).statusCode,
        404,
      );
      let context: ContributionMediaContext | null = null;
      const integrated = Fastify({
        logger: false,
        ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
      });
      await integrated.register(mediaModule, {
        db,
        root,
        appOrigin: config.appOrigin,
        passwordHash: config.organizerPasswordHash,
        contributionContext: async (id) => (id === photo.id ? context : null),
      });
      try {
        for (const visibility of ["private", "public"] as const)
          for (const revealed of [false, true]) {
            context = { visibility, revealed, current: true, deleted: false };
            for (const variant of ["image", "thumbnail"])
              for (const [requestHeaders, expected] of [
                [{}, 404],
                [headers, visibility === "public" && revealed ? 200 : 404],
                [otherHeaders, visibility === "public" && revealed ? 200 : 404],
                [organizerHeaders, 200],
              ] as const) {
                const response = await integrated.inject({
                  url: `/api/media/${photo.id}/${variant}`,
                  headers: requestHeaders,
                });
                assert.equal(
                  response.statusCode,
                  expected,
                  `${visibility}/${revealed}/${variant}: ${response.body.slice(0, 200)}`,
                );
                assert.equal(
                  response.headers["cache-control"],
                  "private, no-store",
                );
              }
          }
        context = {
          visibility: "public",
          revealed: true,
          current: true,
          deleted: true,
        };
        assert.equal(
          (
            await integrated.inject({
              url: `/api/media/${photo.id}/image`,
              headers: organizerHeaders,
            })
          ).statusCode,
          404,
        );
        context = null;
        assert.equal(
          (
            await integrated.inject({
              url: `/api/media/${photo.id}/image`,
              headers,
            })
          ).statusCode,
          404,
        );
      } finally {
        await integrated.close();
      }
      await db.transaction((tx) => service.markPhotoDeleting(tx, photo.id));
      await service.collectGarbage();
      const abandoned = await service.preparePhoto(owner, async (path) => {
        await writeFile(path, input);
        return undefined;
      });
      await service.discardPhoto(abandoned.id);
      await assertClean();
      const exists = await db
        .select()
        .from(mediaAssets)
        .where(eq(mediaAssets.ownerProfileId, owner));
      assert.equal(exists.length, 0);
    },
  );
});
