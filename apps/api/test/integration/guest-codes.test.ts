import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config/env.ts";
import { createDatabase } from "../../src/db/client.ts";
import {
  guestCodeLoginLimits,
  guestCodes,
  guestSessions,
  invitationResponses,
  profileResponseLinks,
  profiles,
} from "../../src/db/schema.ts";
import { hashPassword } from "../../src/modules/organizer/password.ts";
import { normalizeGuestCode } from "../../src/modules/profiles/code.ts";
import { createProfileRepository } from "../../src/modules/profiles/repository.ts";
import {
  guestSessionLifetime,
  hashGuestToken,
} from "../../src/modules/profiles/service.ts";
import { removeInvitationFixtures } from "./fixtures.ts";

const isolated = { skip: process.env.BLACKWOOD_ISOLATED_TEST_DB !== "1" };
const cookieOf = (response: { headers: Record<string, unknown> }) =>
  String(response.headers["set-cookie"]).split(";")[0] ?? "";

test(
  "personal codes recover existing profiles and enforce rotation, revocation and organizer isolation",
  isolated,
  async (t) => {
    const password = "Guest code integration organizer password";
    const config = {
      ...loadConfig(),
      organizerPasswordHash: await hashPassword(password),
    };
    const { db, pool } = createDatabase(config.databaseUrl);
    const app = buildApp(config, { logger: false });
    const restarted = buildApp(config, { logger: false });
    const responseId = randomUUID();
    const companionId = randomUUID();
    t.after(async () => {
      await app.close();
      await restarted.close();
      await db
        .delete(guestSessions)
        .where(eq(guestSessions.profileId, companionId));
      await db.delete(guestCodes).where(eq(guestCodes.profileId, companionId));
      await db.delete(profiles).where(eq(profiles.id, companionId));
      await removeInvitationFixtures(db, [responseId]);
      await db.delete(guestCodeLoginLimits);
      await pool.end();
    });
    const guest = { origin: config.appOrigin, "x-guest-request": "1" };
    const organizer = { origin: config.appOrigin, "x-organizer-request": "1" };
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: `/api/invitation-responses/${responseId}`,
          payload: {
            firstName: "Code Guest",
            attendance: "yes",
            plusOne: true,
            ideas: "Keep this idea",
          },
        })
      ).statusCode,
      200,
    );
    const [link] = await db
      .select()
      .from(profileResponseLinks)
      .where(eq(profileResponseLinks.responseId, responseId));
    assert.ok(link);
    const profileId = link.profileId;
    await db.insert(profiles).values({
      id: companionId,
      firstName: "Code Companion",
      role: "companion",
    });
    const [original] = await db
      .select()
      .from(invitationResponses)
      .where(eq(invitationResponses.id, responseId));
    const restored = await app.inject({
      method: "POST",
      url: "/api/guest-access/restore",
      headers: guest,
      payload: { responseId },
    });
    const originalCookie = cookieOf(restored);
    assert.equal(restored.statusCode, 200, restored.body);
    const organizerLogin = await app.inject({
      method: "POST",
      url: "/api/organizer/session",
      headers: organizer,
      payload: { password },
    });
    const authorized = { ...organizer, cookie: cookieOf(organizerLogin) };
    assert.equal(organizerLogin.statusCode, 200, organizerLogin.body);
    const codeUrl = `/api/organizer/profiles/${profileId}/code`;
    for (const method of ["POST", "DELETE"] as const) {
      assert.equal(
        (await app.inject({ method, url: codeUrl, headers: organizer }))
          .statusCode,
        401,
      );
      assert.equal(
        (
          await app.inject({
            method,
            url: codeUrl,
            headers: { ...authorized, origin: "https://foreign.example" },
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await app.inject({
            method,
            url: codeUrl,
            headers: { ...organizer, cookie: originalCookie },
          })
        ).statusCode,
        401,
      );
      assert.equal(
        (
          await app.inject({
            method,
            url: `/api/organizer/profiles/${randomUUID()}/code`,
            headers: authorized,
          })
        ).statusCode,
        404,
      );
    }
    assert.equal(
      (
        await app.inject({
          url: "/api/organizer/profile-access",
          headers: organizer,
        })
      ).statusCode,
      401,
    );
    const issued = await app.inject({
      method: "POST",
      url: codeUrl,
      headers: authorized,
    });
    assert.equal(issued.statusCode, 200, issued.body);
    assert.equal(issued.headers["cache-control"], "no-store");
    const code: string = issued.json().code;
    assert.match(code, /^[0-9]{4}$/);
    const [stored] = await db
      .select()
      .from(guestCodes)
      .where(eq(guestCodes.profileId, profileId));
    assert.equal(stored?.codeHash, hashGuestToken(normalizeGuestCode(code)));
    assert.ok(!JSON.stringify(stored).includes(code));
    assert.equal(
      (
        await db
          .select()
          .from(guestCodes)
          .where(eq(guestCodes.profileId, profileId))
      ).length,
      1,
    );
    const login = (candidate: string, cookie?: string) =>
      app.inject({
        method: "POST",
        url: "/api/guest-access/login",
        headers: { ...guest, ...(cookie ? { cookie } : {}) },
        payload: { code: candidate },
      });
    const first = await login(` ${code.toLowerCase().replaceAll("-", " ")} `);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().profile.id, profileId);
    assert.equal(first.json().hubEnabled, false);
    const firstCookie = cookieOf(first);
    const sessionToken = firstCookie.split("=")[1] ?? "";
    const [session] = await db
      .select()
      .from(guestSessions)
      .where(eq(guestSessions.tokenHash, hashGuestToken(sessionToken)));
    assert.ok(session);
    assert.equal(
      session.expiresAt.getTime() - session.createdAt.getTime(),
      guestSessionLifetime * 1000,
    );
    assert.equal(
      (await login(code, firstCookie)).headers["set-cookie"],
      undefined,
    );
    const second = await login(code);
    assert.equal(second.statusCode, 200, second.body);
    const secondCookie = cookieOf(second);
    const companionCodeResponse = await app.inject({
      method: "POST",
      url: `/api/organizer/profiles/${companionId}/code`,
      headers: authorized,
    });
    const companionCode: string = companionCodeResponse.json().code;
    const switchAttempt = await login(companionCode, firstCookie);
    assert.equal(switchAttempt.statusCode, 409);
    assert.equal(switchAttempt.json().code, "PROFILE_ALREADY_IDENTIFIED");
    const companionLogin = await login(companionCode);
    assert.equal(companionLogin.statusCode, 200, companionLogin.body);
    assert.equal(companionLogin.json().profile.id, companionId);
    assert.equal(companionLogin.json().profile.hasInvitationResponse, false);
    assert.equal(
      (
        await app.inject({
          url: "/api/profiles/me/invitation-response",
          headers: { cookie: cookieOf(companionLogin) },
        })
      ).statusCode,
      404,
    );
    const listed = await app.inject({
      url: "/api/organizer/profile-access",
      headers: authorized,
    });
    assert.equal(listed.statusCode, 200);
    assert.ok(
      listed
        .json()
        .some(
          (row: { id: string; codeEnabled: boolean }) =>
            row.id === companionId && row.codeEnabled,
        ),
    );
    assert.ok(
      !listed.body.includes(code) &&
        !listed.body.includes(stored?.codeHash ?? "missing"),
    );
    const replacement = await app.inject({
      method: "POST",
      url: codeUrl,
      headers: authorized,
    });
    const nextCode: string = replacement.json().code;
    assert.notEqual(nextCode, code);
    assert.equal((await login(code)).statusCode, 401);
    for (const cookie of [originalCookie, firstCookie, secondCookie]) {
      assert.equal(
        (
          await restarted.inject({
            url: "/api/guest-access",
            headers: { cookie },
          })
        ).json().profile.id,
        profileId,
      );
    }
    assert.equal((await login(nextCode)).statusCode, 200);
    const disabled = await app.inject({
      method: "DELETE",
      url: codeUrl,
      headers: authorized,
    });
    assert.equal(disabled.statusCode, 204, disabled.body);
    assert.equal(
      (
        await db
          .select()
          .from(guestSessions)
          .where(eq(guestSessions.profileId, profileId))
      ).length,
      0,
    );
    const invalid = await login("0000-0000-0000-0000-0000");
    const rejected = await login(nextCode);
    assert.equal(rejected.statusCode, 401);
    assert.deepEqual(rejected.json(), invalid.json());
    for (const cookie of [originalCookie, firstCookie, secondCookie]) {
      assert.equal(
        (
          await restarted.inject({
            url: "/api/guest-access",
            headers: { cookie },
          })
        ).json().profile,
        null,
      );
    }
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/guest-access/restore",
          headers: guest,
          payload: { responseId },
        })
      ).json().code,
      "PROFILE_ACCESS_DISABLED",
    );
    // Historical invitation compatibility cannot re-enable a disabled profile.
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: `/api/invitation-responses/${responseId}`,
          payload: {
            firstName: "Code Guest",
            attendance: "yes",
            plusOne: true,
            ideas: "Keep this idea",
          },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/guest-access/restore",
          headers: guest,
          payload: { responseId },
        })
      ).statusCode,
      401,
    );
    const enabledAgain = await app.inject({
      method: "POST",
      url: codeUrl,
      headers: authorized,
    });
    const renewedCode: string = enabledAgain.json().code;
    const renewed = await login(renewedCode);
    assert.equal(renewed.statusCode, 200, renewed.body);
    const renewedCookie = cookieOf(renewed);
    const tokenHash = hashGuestToken(renewedCookie.split("=")[1] ?? "");
    await db
      .update(guestSessions)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(guestSessions.tokenHash, tokenHash));
    assert.equal(
      (
        await app.inject({
          url: "/api/guest-access",
          headers: { cookie: renewedCookie },
        })
      ).json().profile,
      null,
    );
    assert.equal((await login(renewedCode, renewedCookie)).statusCode, 200);
    const race = await Promise.all([
      login(renewedCode),
      app.inject({ method: "DELETE", url: codeUrl, headers: authorized }),
    ]);
    assert.ok([200, 401].includes(race[0].statusCode));
    assert.equal(race[1].statusCode, 204);
    assert.equal(
      (
        await db
          .select()
          .from(guestSessions)
          .where(eq(guestSessions.profileId, profileId))
      ).length,
      0,
    );
    const [after] = await db
      .select()
      .from(invitationResponses)
      .where(eq(invitationResponses.id, responseId));
    assert.deepEqual({ ...after, updatedAt: original?.updatedAt }, original);
    assert.equal(
      (
        await db
          .select()
          .from(profileResponseLinks)
          .where(eq(profileResponseLinks.responseId, responseId))
      ).length,
      1,
    );
  },
);

test(
  "guest code attempt budgets are atomic, durable and expire without retaining old candidates",
  isolated,
  async (t) => {
    const { db, pool } = createDatabase(loadConfig().databaseUrl);
    t.after(async () => {
      await db.delete(guestCodeLoginLimits);
      await pool.end();
    });
    await db.delete(guestCodeLoginLimits);
    const repository = createProfileRepository(db);
    const now = new Date("2026-10-16T12:00:30.000Z");
    const candidate = hashGuestToken("candidate-one");
    const concurrent = await Promise.all(
      Array.from({ length: 12 }, () =>
        repository.consumeCodeAttempt(candidate, now),
      ),
    );
    assert.equal(concurrent.filter((row) => row.allowed).length, 5);
    assert.ok(
      concurrent
        .filter((row) => !row.allowed)
        .every((row) => row.retryAfter === 270),
    );
    assert.equal(
      (await createProfileRepository(db).consumeCodeAttempt(candidate, now))
        .allowed,
      false,
    );
    const total = await Promise.all(
      Array.from({ length: 110 }, (_, index) =>
        repository.consumeCodeAttempt(
          hashGuestToken(`candidate-${index}`),
          now,
        ),
      ),
    );
    assert.equal(total.filter((row) => row.allowed).length, 87);
    assert.ok((await db.select().from(guestCodeLoginLimits)).length <= 101);
    const nextWindow = new Date("2026-10-16T12:05:00.000Z");
    assert.equal(
      (await repository.consumeCodeAttempt(candidate, nextWindow)).allowed,
      true,
    );
    assert.equal((await db.select().from(guestCodeLoginLimits)).length, 2);
    const [global] = await db
      .select()
      .from(guestCodeLoginLimits)
      .where(eq(guestCodeLoginLimits.key, "global"));
    assert.equal(global?.attempts, 1);
  },
);

test(
  "four-digit code allocation is unique under concurrency and rotation cannot reuse the current code",
  isolated,
  async (t) => {
    const { db, pool } = createDatabase(loadConfig().databaseUrl);
    const first = randomUUID();
    const second = randomUUID();
    t.after(async () => {
      await db.delete(guestCodes).where(eq(guestCodes.profileId, first));
      await db.delete(guestCodes).where(eq(guestCodes.profileId, second));
      await db.delete(profiles).where(eq(profiles.id, first));
      await db.delete(profiles).where(eq(profiles.id, second));
      await pool.end();
    });
    await db.insert(profiles).values([
      { id: first, firstName: "Code test one", role: "main" },
      { id: second, firstName: "Code test two", role: "companion" },
    ]);
    const repository = createProfileRepository(db);
    const codeHash = hashGuestToken("0007");
    const results = await Promise.all([
      repository.issueCode(first, codeHash),
      repository.issueCode(second, codeHash),
    ]);
    assert.deepEqual([...results].sort(), [false, true]);
    const winner = results[0] ? first : second;
    const loser = results[0] ? second : first;
    assert.equal(await repository.issueCode(winner, codeHash), false);
    await db
      .update(guestCodes)
      .set({ enabled: false })
      .where(eq(guestCodes.profileId, winner));
    assert.equal(
      await repository.issueCode(loser, codeHash),
      false,
      "A disabled profile still reserves its stored code",
    );
    assert.equal(
      await repository.issueCode(loser, hashGuestToken("0008")),
      true,
    );
    assert.equal(
      await repository.issueCode(winner, hashGuestToken("0009")),
      true,
    );
  },
);
