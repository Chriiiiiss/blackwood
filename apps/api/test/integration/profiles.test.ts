import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config/env.ts";
import { createDatabase } from "../../src/db/client.ts";
import {
  companionInvitations,
  guestCompanions,
  guestSessions,
  hubSettings,
  invitationResponses,
  profileResponseLinks,
  profiles,
} from "../../src/db/schema.ts";
import { hashPassword } from "../../src/modules/organizer/password.ts";
import {
  guestSessionLifetime,
  hashGuestToken,
} from "../../src/modules/profiles/service.ts";
import { removeInvitationFixtures } from "./fixtures.ts";

test("guest profiles restore, synchronize, gate the hub and claim one independent companion", {
  skip: process.env.BLACKWOOD_ISOLATED_TEST_DB !== "1",
}, async (t) => {
  const password = "Profile integration private password";
  const config = {
    ...loadConfig(),
    organizerPasswordHash: await hashPassword(password),
  };
  const app = buildApp(config, { logger: false });
  const { db, pool } = createDatabase(config.databaseUrl);
  const ids = [randomUUID(), randomUUID()];
  const [responseId, otherId] = ids;
  assert.ok(responseId && otherId);
  const [originalSettings] = await db.select().from(hubSettings);
  t.after(async () => {
    try {
      await db
        .update(hubSettings)
        .set({ hubEnabled: originalSettings?.hubEnabled ?? false })
        .where(eq(hubSettings.id, 1));
      await removeInvitationFixtures(db, ids);
    } finally {
      await app.close();
      await pool.end();
    }
  });
  await db
    .update(hubSettings)
    .set({ hubEnabled: false })
    .where(eq(hubSettings.id, 1));
  const guestHeaders = { origin: config.appOrigin, "x-guest-request": "1" };
  const initial = {
    firstName: " Chris ",
    attendance: "yes",
    plusOne: true,
    ideas: " Original idea ",
  };
  const save = await app.inject({
    method: "PUT",
    url: `/api/invitation-responses/${responseId}`,
    payload: initial,
  });
  assert.equal(save.statusCode, 200, save.body);
  assert.equal(save.headers["set-cookie"], undefined);
  const restore = await app.inject({
    method: "POST",
    url: "/api/guest-access/restore",
    headers: guestHeaders,
    payload: { responseId },
  });
  assert.equal(restore.statusCode, 200, restore.body);
  assert.equal(restore.json().hubEnabled, false);
  const profile = restore.json().profile;
  assert.notEqual(profile.id, responseId);
  assert.deepEqual(Object.keys(profile).sort(), [
    "avatarMediaId",
    "firstName",
    "hasInvitationResponse",
    "id",
    "role",
  ]);
  assert.deepEqual(
    { ...profile, id: "ignored" },
    {
      id: "ignored",
      firstName: "Chris",
      avatarMediaId: null,
      hasInvitationResponse: true,
      role: "main",
    },
  );
  assert.ok(!restore.body.includes(responseId));
  let cookie = String(restore.headers["set-cookie"]).split(";")[0] ?? "";
  assert.ok(
    String(restore.headers["set-cookie"]).includes(
      `Max-Age=${guestSessionLifetime}`,
    ),
  );
  assert.ok(String(restore.headers["set-cookie"]).includes("HttpOnly"));
  assert.ok(String(restore.headers["set-cookie"]).includes("SameSite=Strict"));
  let privateHeaders = { ...guestHeaders, cookie };
  const token = cookie.split("=")[1] ?? "";
  const [session] = await db
    .select()
    .from(guestSessions)
    .where(eq(guestSessions.tokenHash, hashGuestToken(token)));
  assert.ok(session);
  assert.equal(
    session.expiresAt.getTime() - session.createdAt.getTime(),
    guestSessionLifetime * 1000,
  );
  assert.ok(!JSON.stringify(session).includes(token));
  const repeat = await app.inject({
    method: "POST",
    url: "/api/guest-access/restore",
    headers: privateHeaders,
    payload: { responseId },
  });
  assert.equal(repeat.statusCode, 200);
  assert.equal(repeat.headers["set-cookie"], undefined);
  assert.equal(
    (
      await db
        .select()
        .from(guestSessions)
        .where(eq(guestSessions.profileId, profile.id))
    ).length,
    1,
  );
  assert.equal(
    (
      await app.inject({ url: "/api/profiles/me", headers: privateHeaders })
    ).json().code,
    "HUB_CLOSED",
  );
  const current = await app.inject({
    url: "/api/profiles/me/invitation-response",
    headers: privateHeaders,
  });
  assert.deepEqual(current.json(), {
    firstName: "Chris",
    attendance: "yes",
    plusOne: true,
    ideas: initial.ideas,
  });
  const closedEdit = await app.inject({
    method: "PUT",
    url: "/api/profiles/me/invitation-response",
    headers: privateHeaders,
    payload: { ...initial, firstName: "Chris closed" },
  });
  assert.equal(closedEdit.statusCode, 200, closedEdit.body);
  assert.ok(!closedEdit.body.includes(responseId));
  assert.equal(
    (
      await app.inject({ url: "/api/guest-access", headers: privateHeaders })
    ).json().profile.firstName,
    "Chris closed",
  );

  const organizerHeaders = {
    origin: config.appOrigin,
    "x-organizer-request": "1",
  };
  const login = await app.inject({
    method: "POST",
    url: "/api/organizer/session",
    headers: organizerHeaders,
    payload: { password },
  });
  assert.equal(login.statusCode, 200, login.body);
  const organizerCookie =
    String(login.headers["set-cookie"]).split(";")[0] ?? "";
  const authenticatedOrganizer = {
    ...organizerHeaders,
    cookie: organizerCookie,
  };
  const settingsUrl = "/api/organizer/hub-settings";
  assert.equal(
    (await app.inject({ url: settingsUrl, headers: organizerHeaders }))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: settingsUrl,
        headers: { cookie: organizerCookie, "x-organizer-request": "1" },
        payload: { hubEnabled: true },
      })
    ).statusCode,
    403,
  );
  const opened = await app.inject({
    method: "PUT",
    url: settingsUrl,
    headers: authenticatedOrganizer,
    payload: { hubEnabled: true },
  });
  assert.deepEqual(opened.json(), { hubEnabled: true });
  assert.equal(
    (
      await app.inject({ url: "/api/guest-access", headers: privateHeaders })
    ).json().hubEnabled,
    true,
  );
  const restarted = buildApp(config, { logger: false });
  try {
    assert.equal(
      (
        await restarted.inject({
          url: "/api/guest-access",
          headers: privateHeaders,
        })
      ).json().profile.id,
      profile.id,
    );
  } finally {
    await restarted.close();
  }

  const patch = await app.inject({
    method: "PATCH",
    url: "/api/profiles/me",
    headers: privateHeaders,
    payload: { firstName: " Renamed " },
  });
  assert.equal(patch.statusCode, 200, patch.body);
  assert.equal(patch.json().firstName, "Renamed");
  const afterPatch = await app.inject({
    url: `/api/invitation-responses/${responseId}`,
  });
  assert.deepEqual(afterPatch.json(), {
    ...current.json(),
    id: responseId,
    firstName: "Renamed",
  });
  const parallel = await Promise.all(
    Array.from({ length: 9 }, (_, index) =>
      index % 3 === 0
        ? app.inject({
            method: "PUT",
            url: `/api/invitation-responses/${responseId}`,
            payload: { ...initial, firstName: `Legacy ${index}` },
          })
        : index % 3 === 1
          ? app.inject({
              method: "PATCH",
              url: "/api/profiles/me",
              headers: privateHeaders,
              payload: { firstName: `Profile ${index}` },
            })
          : app.inject({
              method: "POST",
              url: "/api/guest-access/restore",
              headers: privateHeaders,
              payload: { responseId },
            }),
    ),
  );
  assert.ok(
    parallel.every((result) => result.statusCode === 200),
    parallel.map((result) => result.body).join("\n"),
  );
  const [storedResponse] = await db
    .select()
    .from(invitationResponses)
    .where(eq(invitationResponses.id, responseId));
  const [storedProfile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, profile.id));
  assert.equal(storedProfile?.firstName, storedResponse?.firstName);
  assert.equal(
    (
      await db
        .select()
        .from(profileResponseLinks)
        .where(eq(profileResponseLinks.responseId, responseId))
    ).length,
    1,
  );
  await app.inject({
    method: "PUT",
    url: `/api/invitation-responses/${otherId}`,
    payload: initial,
  });
  const wrongRestore = await app.inject({
    method: "POST",
    url: "/api/guest-access/restore",
    headers: privateHeaders,
    payload: { responseId: otherId },
  });
  assert.equal(wrongRestore.json().code, "PROFILE_ALREADY_IDENTIFIED");
  assert.equal(
    (
      await app.inject({
        url: `/api/profiles/${profile.id}`,
        headers: privateHeaders,
      })
    ).statusCode,
    404,
  );

  const issueUrl = "/api/profiles/me/companion-invitations";
  const firstLink = await app.inject({
    method: "POST",
    url: issueUrl,
    headers: privateHeaders,
  });
  assert.equal(firstLink.statusCode, 200, firstLink.body);
  const secondLink = await app.inject({
    method: "POST",
    url: issueUrl,
    headers: privateHeaders,
  });
  assert.notEqual(firstLink.json().token, secondLink.json().token);
  const claimUrl = "/api/companion-invitations/claim";
  const claimInput = {
    mainProfileId: profile.id,
    token: secondLink.json().token,
    firstName: " Companion ",
  };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: claimUrl,
        headers: guestHeaders,
        payload: { ...claimInput, token: firstLink.json().token },
      })
    ).json().code,
    "COMPANION_INVITATION_NOT_FOUND",
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: claimUrl,
        headers: privateHeaders,
        payload: claimInput,
      })
    ).json().code,
    "PROFILE_ALREADY_IDENTIFIED",
  );
  const claims = await Promise.all(
    Array.from({ length: 5 }, () =>
      app.inject({
        method: "POST",
        url: claimUrl,
        headers: guestHeaders,
        payload: claimInput,
      }),
    ),
  );
  assert.equal(
    claims.filter((result) => result.statusCode === 200).length,
    1,
    claims.map((result) => result.body).join("\n"),
  );
  assert.ok(
    claims
      .filter((result) => result.statusCode !== 200)
      .every((result) => result.json().code === "COMPANION_ALREADY_CLAIMED"),
  );
  const claimed = claims.find((result) => result.statusCode === 200);
  assert.ok(claimed);
  const companion = claimed.json().profile;
  assert.notEqual(companion.id, profile.id);
  assert.equal(companion.role, "companion");
  assert.equal(companion.hasInvitationResponse, false);
  assert.equal(companion.firstName, "Companion");
  const companionCookie =
    String(claimed.headers["set-cookie"]).split(";")[0] ?? "";
  const companionHeaders = { ...guestHeaders, cookie: companionCookie };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: claimUrl,
        headers: companionHeaders,
        payload: claimInput,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        url: "/api/profiles/me/invitation-response",
        headers: companionHeaders,
      })
    ).json().code,
    "RESPONSE_NOT_FOUND",
  );
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: "/api/profiles/me/invitation-response",
        headers: companionHeaders,
        payload: initial,
      })
    ).json().code,
    "RESPONSE_NOT_FOUND",
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: issueUrl,
        headers: companionHeaders,
      })
    ).json().code,
    "COMPANION_NOT_ALLOWED",
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: issueUrl,
        headers: privateHeaders,
      })
    ).json().code,
    "COMPANION_ALREADY_CLAIMED",
  );
  assert.equal(
    (
      await db
        .select()
        .from(guestCompanions)
        .where(eq(guestCompanions.mainProfileId, profile.id))
    ).length,
    1,
  );
  const [storedLink] = await db
    .select()
    .from(companionInvitations)
    .where(eq(companionInvitations.mainProfileId, profile.id));
  assert.ok(storedLink && storedLink.tokenHash !== claimInput.token);
  const forbiddenRelation = db
    .insert(guestCompanions)
    .values({ mainProfileId: profile.id, companionProfileId: companion.id });
  await assert.rejects(forbiddenRelation);

  await db
    .update(guestSessions)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(guestSessions.tokenHash, hashGuestToken(token)));
  assert.equal(
    (
      await app.inject({ url: "/api/guest-access", headers: privateHeaders })
    ).json().profile,
    null,
  );
  assert.equal(
    (
      await app.inject({ url: "/api/profiles/me", headers: privateHeaders })
    ).json().code,
    "GUEST_UNAUTHENTICATED",
  );
  const renewed = await app.inject({
    method: "POST",
    url: "/api/guest-access/restore",
    headers: privateHeaders,
    payload: { responseId },
  });
  assert.equal(renewed.statusCode, 200);
  assert.equal(renewed.json().profile.id, profile.id);
  cookie = String(renewed.headers["set-cookie"]).split(";")[0] ?? "";
  privateHeaders = { ...guestHeaders, cookie };
  await db
    .update(profiles)
    .set({ legacyAccessEnabled: false })
    .where(eq(profiles.id, profile.id));
  assert.equal(
    (
      await app.inject({ url: "/api/guest-access", headers: privateHeaders })
    ).json().profile,
    null,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/guest-access/restore",
        headers: privateHeaders,
        payload: { responseId },
      })
    ).json().code,
    "PROFILE_ACCESS_DISABLED",
  );
  await db
    .update(profiles)
    .set({ legacyAccessEnabled: true })
    .where(eq(profiles.id, profile.id));
  const closed = await app.inject({
    method: "PUT",
    url: settingsUrl,
    headers: authenticatedOrganizer,
    payload: { hubEnabled: false },
  });
  assert.equal(closed.statusCode, 200);
  assert.equal(
    (
      await app.inject({ url: "/api/profiles/me", headers: privateHeaders })
    ).json().code,
    "HUB_CLOSED",
  );
  assert.equal(
    (
      await app.inject({ url: "/api/guest-access", headers: privateHeaders })
    ).json().profile.id,
    profile.id,
  );
  assert.equal(
    (
      await app.inject({
        url: "/api/profiles/me/invitation-response",
        headers: privateHeaders,
      })
    ).statusCode,
    200,
  );
});
