import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config/env.ts";
import { createDatabase } from "../../src/db/client.ts";
import {
  coffreContributions,
  coffres,
  companionInvitations,
  guestCodes,
  guestCompanions,
  guestSessions,
  hubSettings,
  invitationResponses,
  mediaAssets,
  profileResponseLinks,
  profiles,
} from "../../src/db/schema.ts";
import { hashPassword } from "../../src/modules/organizer/password.ts";
import { imageFixture, multipart } from "../helpers/media.ts";
import { pairTv } from "../helpers/tv.ts";

test("organizer removal revokes all access, allows companion replacement and preserves Coffre memories", {
  skip: process.env.BLACKWOOD_ISOLATED_TEST_DB !== "1",
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "blackwood-profile-removal-"));
  const password = "Profile removal integration password";
  const config = {
    ...loadConfig(),
    mediaRoot: root,
    organizerPasswordHash: await hashPassword(password),
  };
  const { db, pool } = createDatabase(config.databaseUrl);
  const app = buildApp(config, { logger: false });
  const responseIds = [randomUUID(), randomUUID()];
  const ids: string[] = [];
  const [settings] = await db.select().from(hubSettings);
  t.after(async () => {
    await app.close();
    await db
      .delete(coffreContributions)
      .where(eq(coffreContributions.coffreId, 1));
    await db.delete(coffres).where(eq(coffres.id, 1));
    if (ids.length) {
      await db
        .delete(mediaAssets)
        .where(inArray(mediaAssets.ownerProfileId, ids));
      await db
        .delete(guestSessions)
        .where(inArray(guestSessions.profileId, ids));
      await db.delete(guestCodes).where(inArray(guestCodes.profileId, ids));
      await db
        .delete(companionInvitations)
        .where(inArray(companionInvitations.mainProfileId, ids));
      await db
        .delete(guestCompanions)
        .where(inArray(guestCompanions.mainProfileId, ids));
      await db
        .delete(profileResponseLinks)
        .where(inArray(profileResponseLinks.profileId, ids));
      await db.delete(profiles).where(inArray(profiles.id, ids));
    }
    await db
      .delete(invitationResponses)
      .where(inArray(invitationResponses.id, responseIds));
    await db
      .update(hubSettings)
      .set({ hubEnabled: settings?.hubEnabled ?? false })
      .where(eq(hubSettings.id, 1));
    await pool.end();
    await rm(root, { recursive: true, force: true });
  });
  const guest = { origin: config.appOrigin, "x-guest-request": "1" };
  const organizer = { origin: config.appOrigin, "x-organizer-request": "1" };
  const cookieOf = (response: { headers: Record<string, unknown> }) =>
    String(response.headers["set-cookie"]).split(";")[0] ?? "";
  const login = await app.inject({
    method: "POST",
    url: "/api/organizer/session",
    headers: organizer,
    payload: { password },
  });
  assert.equal(login.statusCode, 200, login.body);
  const admin = { ...organizer, cookie: cookieOf(login) };
  await db
    .update(hubSettings)
    .set({ hubEnabled: true })
    .where(eq(hubSettings.id, 1));
  const input = {
    firstName: "Sam",
    attendance: "yes",
    plusOne: true,
    ideas: "Keep my original response",
  };
  const mainHeaders: Record<string, string>[] = [];
  for (const [index, responseId] of responseIds.entries()) {
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: `/api/invitation-responses/${responseId}`,
          payload: { ...input, firstName: index ? "Alex" : "Sam" },
        })
      ).statusCode,
      200,
    );
    const restored = await app.inject({
      method: "POST",
      url: "/api/guest-access/restore",
      headers: guest,
      payload: { responseId },
    });
    ids.push(restored.json().profile.id);
    mainHeaders.push({ ...guest, cookie: cookieOf(restored) });
  }
  const mainId = ids[0];
  const otherId = ids[1];
  const main = mainHeaders[0];
  const other = mainHeaders[1];
  assert.ok(mainId && otherId && main && other);
  const issue = () =>
    app.inject({
      method: "POST",
      url: "/api/profiles/me/companion-invitations",
      headers: main,
    });
  const claim = (token: string, firstName = "Alex") =>
    app.inject({
      method: "POST",
      url: "/api/companion-invitations/claim",
      headers: guest,
      payload: { mainProfileId: mainId, token, firstName },
    });
  const invitation = await issue();
  const claimed = await claim(invitation.json().token);
  assert.equal(claimed.statusCode, 200, claimed.body);
  const companionId: string = claimed.json().profile.id;
  ids.push(companionId);
  const companion = { ...guest, cookie: cookieOf(claimed) };
  const codeUrl = `/api/organizer/profiles/${companionId}/code`;
  const code = (
    await app.inject({ method: "POST", url: codeUrl, headers: admin })
  ).json().code;
  const secondSession = await app.inject({
    method: "POST",
    url: "/api/guest-access/login",
    headers: guest,
    payload: { code },
  });
  assert.equal(secondSession.statusCode, 200);
  const list = await app.inject({
    url: "/api/organizer/profile-access",
    headers: admin,
  });
  assert.equal(
    list.json().find((row: { id: string }) => row.id === companionId)
      .relatedFirstName,
    "Sam",
  );

  await app.inject({
    method: "PUT",
    url: "/api/organizer/coffre",
    headers: admin,
    payload: { durationSeconds: 600 },
  });
  await app.inject({
    method: "POST",
    url: "/api/organizer/coffre/start",
    headers: admin,
    payload: {},
  });
  const contributionIds = [randomUUID(), randomUUID()];
  for (const [index, id] of contributionIds.entries()) {
    const form = multipart([
      {
        name: "contribution",
        data: JSON.stringify({
          id,
          text: index ? "Private memory" : "Public memory",
          visibility: index ? "private" : "public",
          frameId: "plain",
        }),
      },
      { name: "file", filename: "memory.jpg", data: await imageFixture() },
    ]);
    const deposited: { statusCode: number; body: string } = await app.inject({
      method: "POST",
      url: "/api/coffre/contributions",
      headers: {
        ...(index ? main : companion),
        "content-type": form.contentType,
      },
      payload: form.payload,
    });
    assert.equal(deposited.statusCode, 200, deposited.body);
  }
  const before = await db
    .select()
    .from(coffreContributions)
    .where(inArray(coffreContributions.id, contributionIds));
  const mediaBefore = await db
    .select()
    .from(mediaAssets)
    .where(inArray(mediaAssets.ownerProfileId, [mainId, companionId]));
  const removeUrl = `/api/organizer/profiles/${companionId}`;
  for (const headers of [
    organizer,
    { ...organizer, cookie: main.cookie },
    { ...admin, origin: "https://foreign.example" },
  ]) {
    assert.ok(
      [401, 403].includes(
        (await app.inject({ method: "DELETE", url: removeUrl, headers }))
          .statusCode,
      ),
    );
  }
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: "/api/organizer/profiles/invalid",
        headers: admin,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/api/organizer/profiles/${randomUUID()}`,
        headers: admin,
      })
    ).statusCode,
    404,
  );
  const removed = await app.inject({
    method: "DELETE",
    url: removeUrl,
    headers: admin,
  });
  assert.equal(removed.statusCode, 204, removed.body);
  assert.equal(removed.headers["cache-control"], "no-store");
  assert.equal(
    (await app.inject({ method: "DELETE", url: removeUrl, headers: admin }))
      .statusCode,
    204,
  );
  for (const cookie of [companion.cookie, cookieOf(secondSession)]) {
    assert.equal(
      (
        await app.inject({ url: "/api/guest-access", headers: { cookie } })
      ).json().profile,
      null,
    );
    assert.equal(
      (await app.inject({ url: "/api/profiles/me", headers: { cookie } }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/coffre/contributions",
          headers: { ...guest, cookie },
          payload: {
            id: randomUUID(),
            text: "Denied",
            visibility: "public",
            frameId: "plain",
          },
        })
      ).statusCode,
      401,
    );
  }
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/guest-access/login",
        headers: guest,
        payload: { code },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (await app.inject({ method: "POST", url: codeUrl, headers: admin }))
      .statusCode,
    404,
  );
  assert.equal((await claim(invitation.json().token)).statusCode, 404);
  assert.equal(
    (await app.inject({ url: "/api/guest-access", headers: main })).json()
      .profile.id,
    mainId,
  );
  assert.deepEqual(
    (
      await app.inject({ url: "/api/profiles/me/companion", headers: main })
    ).json(),
    { eligible: true, companion: null },
  );
  assert.equal(
    (await app.inject({ url: "/api/profiles/me", headers: other })).json().id,
    otherId,
  );
  const replacementLink = await issue();
  const replacements = await Promise.all([
    claim(replacementLink.json().token, "New companion"),
    claim(replacementLink.json().token, "New companion"),
  ]);
  assert.equal(replacements.filter((row) => row.statusCode === 200).length, 1);
  const replacement = replacements.find((row) => row.statusCode === 200);
  assert.ok(replacement);
  const replacementId: string = replacement.json().profile.id;
  ids.push(replacementId);
  assert.notEqual(replacementId, companionId);

  const removalRace = await Promise.all([
    app.inject({
      method: "PUT",
      url: "/api/profiles/me/invitation-response",
      headers: main,
      payload: input,
    }),
    app.inject({
      method: "DELETE",
      url: `/api/organizer/profiles/${mainId}`,
      headers: admin,
    }),
  ]);
  assert.ok(
    [200, 401].includes(removalRace[0].statusCode),
    removalRace[0].body,
  );
  assert.equal(removalRace[1].statusCode, 204);
  for (const method of ["GET", "PUT"] as const) {
    const legacy = await app.inject({
      method,
      url: `/api/invitation-responses/${responseIds[0]}`,
      ...(method === "PUT" ? { payload: input } : {}),
    });
    assert.equal(legacy.statusCode, 403, legacy.body);
    assert.equal(legacy.json().code, "PROFILE_DELETED");
  }
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/guest-access/restore",
        headers: guest,
        payload: { responseId: responseIds[0] },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/organizer/profiles/${mainId}/code`,
        headers: admin,
      })
    ).statusCode,
    404,
  );
  const retained = await app.inject({
    url: "/api/guest-access",
    headers: { cookie: cookieOf(replacement) },
  });
  assert.equal(retained.json().profile.id, replacementId);
  assert.equal(
    (
      await db
        .select()
        .from(guestCompanions)
        .where(eq(guestCompanions.mainProfileId, mainId))
    ).length,
    0,
  );
  const activeList = (
    await app.inject({ url: "/api/organizer/profile-access", headers: admin })
  ).json();
  assert.ok(
    !activeList.some((row: { id: string }) =>
      [mainId, companionId].includes(row.id),
    ),
  );
  assert.equal(
    activeList.find((row: { id: string }) => row.id === replacementId)
      .relatedFirstName,
    null,
  );
  const responses = (
    await app.inject({
      url: "/api/organizer/invitation-responses",
      headers: admin,
    })
  ).json();
  assert.equal(responses.responses.length, 1);
  assert.equal(responses.responses[0].firstName, "Alex");
  assert.deepEqual(responses.totals, {
    attending: 1,
    toConfirm: 0,
    plusOnes: 1,
  });
  assert.deepEqual(
    await db
      .select()
      .from(coffreContributions)
      .where(inArray(coffreContributions.id, contributionIds)),
    before,
  );
  assert.deepEqual(
    await db
      .select()
      .from(mediaAssets)
      .where(inArray(mediaAssets.ownerProfileId, [mainId, companionId])),
    mediaBefore,
  );
  await app.inject({
    method: "POST",
    url: "/api/organizer/coffre/open",
    headers: admin,
    payload: {},
  });
  const tv = await pairTv(app, admin);
  const publicRows = (
    await app.inject({ url: "/api/tv/coffre/contributions", headers: tv })
  ).json();
  assert.ok(JSON.stringify(publicRows).includes("Public memory"));
  assert.ok(!JSON.stringify(publicRows).includes("Private memory"));
  for (const row of before) {
    assert.ok(row.photoMediaId);
    const path = `/api/media/${row.photoMediaId}/image`;
    assert.equal(
      (await app.inject({ url: path, headers: admin })).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          url: `/api/tv/coffre/media/${row.photoMediaId}/image`,
          headers: tv,
        })
      ).statusCode,
      row.visibility === "public" ? 200 : 404,
    );
  }
});
