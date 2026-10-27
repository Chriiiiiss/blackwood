import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { CoffreError } from "../src/modules/coffre/errors.ts";
import type { CoffreRepository } from "../src/modules/coffre/repository.ts";
import { registerCoffreRoutes } from "../src/modules/coffre/routes.ts";
import type { ContributionInput } from "../src/modules/coffre/schemas.ts";
import {
  createCoffreService,
  normalizeContribution,
} from "../src/modules/coffre/service.ts";
import { OrganizerError } from "../src/modules/organizer/errors.ts";
import { ProfileError } from "../src/modules/profiles/errors.ts";

const input: ContributionInput = {
  id: randomUUID(),
  text: "A wish",
  visibility: "public",
  frameId: "plain",
};
function fixtures() {
  const repository: CoffreRepository = {
    state: async () => ({
      coffre: null,
      now: new Date("2026-10-31T20:00:00Z"),
    }),
    history: async () => [],
    createNext: async (previous) => previous + 1,
    rename: async () => {},
    prepare: async () => {},
    start: async () => {},
    advance: async () => {},
    open: async () => {},
    deposit: async () => ({ replayed: false }),
    publicPage: async () => [],
    metadataPage: async () => [],
    detail: async () => {
      throw new CoffreError(404, "CONTRIBUTION_NOT_FOUND");
    },
    remove: async () => {},
    mediaContext: async () => null,
  };
  const discarded: string[] = [];
  const media = {
    discardPhoto: async (id: string) => {
      discarded.push(id);
    },
    collectGarbage: async () => {},
  };
  return {
    repository,
    media,
    discarded,
    service: createCoffreService(repository, media),
  };
}

test("contributions count Unicode code points, reject empty content and constrain Willow to text", () => {
  assert.equal(
    normalizeContribution({ ...input, text: `  ${"👻".repeat(496)}  ` }, false),
    "👻".repeat(496),
  );
  assert.throws(
    () => normalizeContribution({ ...input, text: "👻".repeat(501) }, false),
    { code: "TEXT_TOO_LONG" },
  );
  assert.throws(
    () => normalizeContribution({ ...input, text: " \n\t " }, false),
    { code: "CONTRIBUTION_EMPTY" },
  );
  assert.equal(normalizeContribution({ ...input, text: " \n " }, true), null);
  assert.throws(
    () => normalizeContribution({ ...input, frameId: "one-wish-willow" }, true),
    { code: "FRAME_CONTENT_MISMATCH" },
  );
});

test("the exact deadline reveals Coffre and denies premature public reads", async () => {
  const f = fixtures();
  await assert.rejects(() => f.service.publicPage(), {
    code: "COFFRE_NOT_REVEALED",
  });
  const deadline = new Date("2026-11-01T02:00:00Z");
  const coffre = {
    name: null,
    id: 1,
    durationSeconds: 21600,
    startedAt: new Date("2026-10-31T20:00:00Z"),
    deadline,
  };
  f.repository.state = async () => ({
    coffre,
    now: new Date(deadline.getTime() - 1),
  });
  assert.equal((await f.service.state()).state, "collecting");
  f.repository.state = async () => ({ coffre, now: deadline });
  assert.equal((await f.service.state()).state, "revealed");
  assert.deepEqual(await f.service.publicPage(), {
    contributions: [],
    nextCursor: null,
  });
});

test("photo retries and refused deposits discard only staged uploads; receipts contain no content", async () => {
  const f = fixtures();
  const actor = { kind: "organizer" as const };
  const photo = { id: randomUUID(), hash: "photo digest" };
  let firstHash: string | undefined;
  f.repository.deposit = async (_input, text, hash) => {
    assert.equal(text, "A wish");
    firstHash = hash;
    return { replayed: false };
  };
  assert.deepEqual(await f.service.deposit(input, actor, photo), {
    id: input.id,
    received: true,
  });
  assert.deepEqual(f.discarded, []);
  f.repository.deposit = async (_input, _text, hash) => {
    assert.equal(hash, firstHash);
    return { replayed: true };
  };
  await f.service.deposit({ ...input, text: " A wish " }, actor, photo);
  assert.deepEqual(f.discarded, [photo.id]);
  f.repository.deposit = async () => {
    throw new CoffreError(409, "COFFRE_REVEALED");
  };
  await assert.rejects(() => f.service.deposit(input, actor, photo), {
    code: "COFFRE_REVEALED",
  });
  await assert.rejects(
    () =>
      f.service.deposit({ ...input, frameId: "one-wish-willow" }, actor, photo),
    { code: "FRAME_CONTENT_MISMATCH" },
  );
  assert.equal(f.discarded.length, 3);
});

test("Coffre HTTP validates without coercion, authenticates before bodies and redacts failures", async (t) => {
  const f = fixtures();
  const logs: string[] = [];
  const app = Fastify({
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    logger: {
      stream: {
        write: (line: string) => {
          logs.push(line);
        },
      },
    },
  });
  await app.register(cookie);
  await app.register(multipart);
  const origin = "http://localhost:5178";
  const headers = {
    origin,
    "x-guest-request": "1",
    cookie: "blackwood-guest-dev=valid",
  };
  const admin = {
    origin,
    "x-organizer-request": "1",
    cookie: "blackwood-organizer-dev=valid",
  };
  registerCoffreRoutes(
    app,
    f.service,
    {
      ...f.media,
      preparePhoto: async () => {
        throw new Error("Unexpected photo");
      },
    },
    {
      profile: async (token) => {
        if (token !== "valid")
          throw new ProfileError(401, "GUEST_UNAUTHENTICATED");
        return {
          id: randomUUID(),
          firstName: "Fixture",
          role: "main",
          avatarMediaId: null,
          hasInvitationResponse: true,
        };
      },
    },
    {
      session: async (token) => {
        if (token !== "valid") throw new OrganizerError(401, "UNAUTHENTICATED");
        return { authenticated: true, expiresAt: "", idleExpiresAt: "" };
      },
    },
    origin,
    {
      session: async () => {
        throw new Error("Unexpected TV access");
      },
    },
  );
  t.after(() => app.close());
  const send = (payload: unknown) =>
    app.inject({
      method: "POST",
      url: "/api/coffre/contributions",
      headers: { ...headers, "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });
  for (const payload of [
    { ...input, extra: true },
    { ...input, text: 42 },
    { ...input, id: "invalid" },
    { ...input, visibility: "anonymous" },
    { ...input, frameId: "invented" },
    { ...input, text: "👻".repeat(501) },
    null,
    [],
  ]) {
    const response = await send(payload);
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().code, "VALIDATION_ERROR");
  }
  const valid = await send(input);
  assert.equal(valid.statusCode, 200, valid.body);
  assert.equal(valid.headers["cache-control"], "private, no-store");
  assert.match(String(valid.headers.vary), /Cookie/);
  assert.deepEqual(Object.keys(valid.json()).sort(), ["id", "received"]);
  for (const durationSeconds of [0, -1, 604801, 1.5, "3600", null]) {
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: "/api/organizer/coffre",
          headers: admin,
          payload: { durationSeconds },
        })
      ).statusCode,
      400,
    );
  }
  let renamed: { name: string; id: number } | undefined;
  f.repository.rename = async (name, id) => {
    renamed = { name, id };
  };
  for (const payload of [
    {},
    { name: 10 },
    { name: " " },
    { name: "x".repeat(81) },
    { name: "Test", deadline: "2026-10-31T20:00:00Z" },
  ]) {
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/organizer/coffre?coffreId=2",
          headers: admin,
          payload,
        })
      ).statusCode,
      400,
    );
  }
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: "/api/organizer/coffre?coffreId=2",
        headers: admin,
        payload: { name: "  New memories  " },
      })
    ).statusCode,
    200,
  );
  assert.deepEqual(renamed, { name: "New memories", id: 2 });
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: "/api/organizer/coffre?coffreId=2",
        headers: admin,
        payload: { name: "🎃".repeat(80) },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: "/api/organizer/coffre?coffreId=2",
        headers,
        payload: { name: "Guest change" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: "/api/organizer/coffre?coffreId=2",
        headers: { ...admin, cookie: "" },
        payload: { name: "No session" },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: "/api/organizer/coffre?coffreId=2",
        headers: { ...admin, origin: "https://other.test" },
        payload: { name: "Foreign origin" },
      })
    ).statusCode,
    403,
  );
  let previousCoffre: number | undefined;
  f.repository.createNext = async (previous) => {
    previousCoffre = previous;
    return previous + 1;
  };
  for (const payload of [
    {},
    { previousCoffreId: "1" },
    { previousCoffreId: 0 },
    { previousCoffreId: 1, extra: true },
  ]) {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/organizer/coffres",
          headers: admin,
          payload,
        })
      ).statusCode,
      400,
    );
  }
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/organizer/coffres",
        headers: admin,
        payload: { previousCoffreId: 1 },
      })
    ).statusCode,
    200,
  );
  assert.equal(previousCoffre, 1);
  assert.equal(
    (await app.inject({ url: "/api/organizer/coffres", headers: admin }))
      .statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ url: "/api/coffres", headers })).statusCode,
    404,
  );
  for (const url of [
    "/api/coffre?coffreId=0",
    "/api/coffre?coffreId=1&coffreId=2",
    "/api/organizer/coffres?before=-1",
    "/api/organizer/coffres?before=2&extra=1",
  ]) {
    assert.equal(
      (
        await app.inject({
          url,
          headers: url.includes("/organizer/") ? admin : headers,
        })
      ).statusCode,
      400,
    );
  }
  let advanced: Date | undefined;
  let opened = 0;
  f.repository.advance = async (deadline) => {
    advanced = deadline;
  };
  f.repository.open = async () => {
    opened++;
  };
  const deadline = "2026-10-31T21:00:00.000Z";
  for (const payload of [
    {},
    { deadline: 10 },
    { deadline: "not-a-date" },
    { deadline, extra: true },
  ]) {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/organizer/coffre/advance",
          headers: admin,
          payload,
        })
      ).statusCode,
      400,
    );
  }
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/organizer/coffre/advance",
        headers: admin,
        payload: { deadline },
      })
    ).statusCode,
    200,
  );
  assert.equal(advanced?.toISOString(), deadline);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/organizer/coffre/open",
        headers: admin,
        payload: { unexpected: true },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/organizer/coffre/open",
        headers: admin,
        payload: {},
      })
    ).statusCode,
    200,
  );
  assert.equal(opened, 1);
  for (const command of ["advance", "open"]) {
    const url = `/api/organizer/coffre/${command}`;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { ...admin, cookie: "" },
          payload: "invalid JSON",
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (await app.inject({ method: "POST", url, headers, payload: {} }))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { ...admin, origin: "https://foreign.example" },
          payload: {},
        })
      ).statusCode,
      403,
    );
  }
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/coffre/contributions",
        headers: { ...headers, cookie: "", "content-type": "application/json" },
        payload: "bad JSON",
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/coffre/contributions",
        headers: { ...headers, origin: "http://foreign.example" },
        payload: input,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ url: "/api/organizer/coffre", headers })).statusCode,
    403,
  );
  const secret = "private contribution /path/to/file password";
  f.repository.deposit = async () => {
    throw new Error(secret);
  };
  const failed = await send(input);
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.json().code, "COFFRE_UNAVAILABLE");
  assert.ok(!failed.body.includes(secret));
  assert.ok(!logs.join("").includes(secret));
});
