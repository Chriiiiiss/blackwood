import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config/env.ts";
import { createDatabase } from "../../src/db/client.ts";
import { invitationResponses } from "../../src/db/schema.ts";
import { removeInvitationFixtures } from "./fixtures.ts";

test("invitation responses persist, update and remain scoped to their identifiers", async (t) => {
  const config = loadConfig();
  const app = buildApp(config, { logger: false });
  const { db, pool } = createDatabase(config.databaseUrl);
  const ids = Array.from({ length: 5 }, () => randomUUID());
  const [id, otherId, concurrentId, boundaryId, invalidId] = ids;
  assert.ok(id && otherId && concurrentId && boundaryId && invalidId);
  t.after(async () => {
    try {
      await removeInvitationFixtures(db, ids);
    } finally {
      await app.close();
      await pool.end();
    }
  });
  const url = `/api/invitation-responses/${id}`;

  await t.test(
    "the first save trims the name and persists all four fields",
    async () => {
      const response = await app.inject({
        method: "PUT",
        url,
        payload: {
          firstName: "  Chris \n",
          attendance: "yes",
          plusOne: true,
          ideas: " A haunted lobby! ",
        },
      });
      assert.equal(response.statusCode, 200, response.body);
      const expected = {
        id,
        firstName: "Chris",
        attendance: "yes",
        plusOne: true,
        ideas: " A haunted lobby! ",
      };
      assert.deepEqual(response.json(), expected);
      assert.equal(response.headers["cache-control"], "no-store");
      const [stored] = await db
        .select()
        .from(invitationResponses)
        .where(eq(invitationResponses.id, id));
      assert.ok(stored);
      assert.deepEqual(
        {
          id: stored.id,
          firstName: stored.firstName,
          attendance: stored.attendance,
          plusOne: stored.plusOne,
          ideas: stored.ideas,
        },
        expected,
      );
      assert.ok(stored.createdAt instanceof Date);
      assert.ok(stored.updatedAt instanceof Date);
      const read = await app.inject({ method: "GET", url });
      assert.equal(read.statusCode, 200);
      assert.deepEqual(read.json(), expected);

      const restarted = buildApp(config, { logger: false });
      try {
        const readAfterRestart = await restarted.inject({ method: "GET", url });
        assert.deepEqual(readAfterRestart.json(), expected);
      } finally {
        await restarted.close();
      }
    },
  );

  await t.test(
    "updates keep one row and reset plus one when attendance becomes no",
    async () => {
      const [original] = await db
        .select()
        .from(invitationResponses)
        .where(eq(invitationResponses.id, id));
      assert.ok(original);
      for (const plusOne of [true, undefined]) {
        const response = await app.inject({
          method: "PUT",
          url,
          payload: {
            firstName: "Chris",
            attendance: "no",
            ...(plusOne === undefined ? {} : { plusOne }),
            ideas: " \t\n ",
          },
        });
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), {
          id,
          firstName: "Chris",
          attendance: "no",
          plusOne: false,
          ideas: null,
        });
      }
      const rows = await db
        .select()
        .from(invitationResponses)
        .where(eq(invitationResponses.id, id));
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.createdAt.getTime(), original.createdAt.getTime());
      assert.ok(
        (rows[0]?.updatedAt.getTime() ?? 0) >= original.updatedAt.getTime(),
      );

      const missingChoice = await app.inject({
        method: "PUT",
        url,
        payload: { firstName: "Chris", attendance: "to_confirm" },
      });
      assert.equal(missingChoice.statusCode, 400);
      const unchanged = await app.inject({ method: "GET", url });
      assert.equal(unchanged.json().attendance, "no");
      const provisional = await app.inject({
        method: "PUT",
        url,
        payload: {
          firstName: "Chris",
          attendance: "to_confirm",
          plusOne: true,
        },
      });
      assert.equal(provisional.statusCode, 200);
      assert.equal(provisional.json().plusOne, true);
      assert.equal(provisional.json().ideas, null);
    },
  );

  await t.test(
    "another browser identifier creates a distinct response even with the same name",
    async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/api/invitation-responses/${otherId}`,
        payload: { firstName: "Chris", attendance: "yes", plusOne: false },
      });
      assert.equal(response.statusCode, 200);
      const rows = await db
        .select()
        .from(invitationResponses)
        .where(inArray(invitationResponses.id, [id, otherId]));
      assert.equal(rows.length, 2);
      const first = await app.inject({ method: "GET", url });
      assert.equal(first.json().attendance, "to_confirm");
      const other = await app.inject({
        method: "GET",
        url: `/api/invitation-responses/${otherId}`,
      });
      assert.equal(other.json().attendance, "yes");
      const list = await app.inject({
        method: "GET",
        url: "/api/invitation-responses",
      });
      assert.equal(list.statusCode, 404);
      const unknown = await app.inject({
        method: "GET",
        url: `/api/invitation-responses/${randomUUID()}`,
      });
      assert.equal(unknown.statusCode, 404);
    },
  );

  await t.test(
    "concurrent repeated first submissions create exactly one row",
    async () => {
      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          app.inject({
            method: "PUT",
            url: `/api/invitation-responses/${concurrentId}`,
            payload: {
              firstName: "Alex",
              attendance: "to_confirm",
              plusOne: false,
            },
          }),
        ),
      );
      assert.ok(responses.every((response) => response.statusCode === 200));
      const rows = await db
        .select()
        .from(invitationResponses)
        .where(eq(invitationResponses.id, concurrentId));
      assert.equal(rows.length, 1);
    },
  );

  await t.test(
    "text limits accept Unicode boundaries and refuse invalid data without inserting",
    async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/api/invitation-responses/${boundaryId}`,
        payload: {
          firstName: ` ${"🎃".repeat(50)} `,
          attendance: "yes",
          plusOne: false,
          ideas: "🎃".repeat(1000),
        },
      });
      assert.equal(response.statusCode, 200, response.body);
      for (const payload of [
        { firstName: " ", attendance: "yes", plusOne: true },
        { firstName: "Chris", attendance: "yes" },
        { firstName: "Chris", attendance: "no", ideas: "a".repeat(1001) },
      ]) {
        const invalid: typeof response = await app.inject({
          method: "PUT",
          url: `/api/invitation-responses/${invalidId}`,
          payload,
        });
        assert.equal(invalid.statusCode, 400);
      }
      const rows = await db
        .select()
        .from(invitationResponses)
        .where(eq(invitationResponses.id, invalidId));
      assert.equal(rows.length, 0);
    },
  );

  await t.test(
    "database constraints reject invalid writes outside the API",
    async () => {
      for (const values of [
        { firstName: " ", attendance: "yes" as const, plusOne: false },
        {
          firstName: "a".repeat(51),
          attendance: "yes" as const,
          plusOne: false,
        },
        { firstName: "Chris", attendance: "no" as const, plusOne: true },
        {
          firstName: "Chris",
          attendance: "yes" as const,
          plusOne: false,
          ideas: "a".repeat(1001),
        },
      ]) {
        await assert.rejects(
          db.insert(invitationResponses).values({ id: invalidId, ...values }),
        );
      }
    },
  );
});
