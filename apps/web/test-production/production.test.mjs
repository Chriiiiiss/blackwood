import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { hashPassword } from "../../api/src/modules/organizer/password.ts";
import { imageFixture, imageMetadata } from "../../api/test/helpers/media.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));

test("production containers save, restore and edit real invitation responses", {
  timeout: 600_000,
}, async (t) => {
  const organizerPassword = randomBytes(24).toString("base64url");
  const env = {
    ...process.env,
    POSTGRES_USER: "blackwood",
    POSTGRES_DB: "blackwood",
    POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
    SITE_ADDRESS: "http://:80",
    APP_ORIGIN: "http://localhost",
    HTTP_BIND: "127.0.0.1",
    HTTP_PORT: "0",
    HTTPS_PORT: "0",
    APP_VERSION: "production-test",
    IMAGE_PREFIX: "blackwood",
    ORGANIZER_PASSWORD_HASH: await hashPassword(organizerPassword),
  };
  const args = [
    "compose",
    "--file",
    "compose.production.yaml",
    "--env-file",
    "/dev/null",
    "--project-name",
    `blackwood-test-${randomUUID().slice(0, 8)}`,
  ];
  const options = { cwd: root, env, encoding: "utf8", timeout: 480_000 };
  const compose = (command, overrides = {}) =>
    execFileSync("docker", [...args, ...command], { ...options, ...overrides });
  const sql = (query, database = "blackwood") =>
    compose([
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "blackwood",
      "-d",
      database,
      "-tAc",
      query,
    ]).trim();

  t.after(() =>
    compose(["down", "--volumes", "--remove-orphans"], {
      stdio: "inherit",
    }),
  );
  // A cached apt layer can hide a dependency that fresh CI runners cannot install.
  compose(["build", "--pull", "--no-cache", "api", "web"], {
    stdio: "inherit",
  });
  compose(["up", "-d", "--wait", "--wait-timeout", "60", "db"], {
    stdio: "inherit",
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    compose(["run", "--rm", "migrate"], { stdio: "inherit" });
  }
  compose(["up", "-d", "--no-deps", "web"], { stdio: "inherit" });
  const baseUrl = `http://${compose(["port", "web", "80"]).trim()}`;
  env.APP_ORIGIN = baseUrl;
  compose(["up", "-d", "--wait", "--wait-timeout", "90", "api", "web"], {
    stdio: "inherit",
  });

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });
  const robotsPolicy = "noindex, nofollow";
  assert.equal(health.headers.get("x-robots-tag"), robotsPolicy);

  for (const service of ["db", "api"]) {
    const id = compose(["ps", "-q", service]).trim();
    const ports = JSON.parse(
      execFileSync(
        "docker",
        ["inspect", "--format", "{{json .NetworkSettings.Ports}}", id],
        options,
      ),
    );
    assert.ok(
      Object.values(ports ?? {}).every((bindings) => bindings === null),
    );
  }
  const html = await fetch(baseUrl);
  assert.match(html.headers.get("cache-control"), /no-cache/);
  assert.equal(html.headers.get("x-robots-tag"), robotsPolicy);
  const document = await html.text();
  assert.match(
    document,
    /<meta name="robots" content="noindex, nofollow"\s*\/?>/,
  );
  const assetPath = document.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(assetPath);
  const asset = await fetch(`${baseUrl}${assetPath}`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("cache-control"), /immutable/);
  assert.equal(asset.headers.get("x-robots-tag"), robotsPolicy);
  const robots = await fetch(`${baseUrl}/robots.txt`);
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get("content-type"), /^text\/plain/);
  assert.match(await robots.text(), /^User-agent: \*\r?\nDisallow:\s*$/m);
  const nestedPage = await fetch(`${baseUrl}/invitation`);
  assert.equal(nestedPage.headers.get("x-robots-tag"), robotsPolicy);
  assert.match(
    await nestedPage.text(),
    /<meta name="robots" content="noindex, nofollow"\s*\/?>/,
  );
  assert.equal((await fetch(`${baseUrl}/assets/missing.js`)).status, 404);
  const unknownApi = await fetch(`${baseUrl}/api/missing`);
  assert.equal(unknownApi.status, 404);
  assert.match(unknownApi.headers.get("content-type"), /application\/json/);
  assert.equal(unknownApi.headers.get("x-robots-tag"), robotsPolicy);

  const foreignRequest = await fetch(
    `${baseUrl}/api/invitation-responses/${randomUUID()}`,
    { headers: { Origin: "https://unrelated.example" } },
  );
  assert.equal(foreignRequest.status, 403);
  assert.equal(foreignRequest.headers.get("access-control-allow-origin"), null);
  assert.equal((await foreignRequest.json()).code, "ORIGIN_NOT_ALLOWED");

  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/chambre/inconnue`);
  const notFoundHeading = page.getByRole("heading", {
    name: "Cette chambre est introuvable.",
  });
  await expect(notFoundHeading).toBeVisible();
  await page.reload();
  await expect(notFoundHeading).toBeVisible();
  await page.getByRole("link", { name: "Retour à l’invitation" }).click();
  await expect(page).toHaveURL(`${baseUrl}/invitation`);
  await page
    .getByRole("textbox", { name: "Ton prénom" })
    .fill("Deployment test");
  await page
    .getByRole("group", { name: "Tu viens ?", exact: true })
    .getByRole("radio", { name: "Oui", exact: true })
    .check();
  await page
    .getByRole("group", { name: "Solo bolo ?", exact: true })
    .getByRole("radio", { name: "Je viens à deux", exact: true })
    .check();
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(
    page.getByRole("heading", { name: "Merci pour ta réponse !" }),
  ).toBeVisible();

  const id = await page.evaluate(() =>
    localStorage.getItem("blackwood.invitation-response-id"),
  );
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(
    sql(`SELECT first_name || ':' || attendance || ':' || plus_one
    FROM invitation_responses WHERE id = '${id}'`),
    "Deployment test:yes:true",
  );

  compose(["restart", "db", "api"], { stdio: "inherit" });
  await expect
    .poll(
      async () => {
        try {
          return (
            await fetch(`${baseUrl}/api/health`, {
              signal: AbortSignal.timeout(2_000),
            })
          ).status;
        } catch {
          return 0;
        }
      },
      { timeout: 60_000 },
    )
    .toBe(200);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Modifier ma réponse" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Modifier ma réponse" }).click();
  await page
    .getByRole("group", { name: "Tu viens ?", exact: true })
    .getByRole("radio", { name: "Non", exact: true })
    .check();
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(
    page.getByText("Ta réponse a bien été mise à jour.", { exact: true }),
  ).toBeVisible();
  const response = await fetch(`${baseUrl}/api/invitation-responses/${id}`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    id,
    firstName: "Deployment test",
    attendance: "no",
    plusOne: false,
    ideas: null,
  });
  assert.equal(sql("SELECT count(*) FROM invitation_responses"), "1");

  const dump = compose(
    [
      "exec",
      "-T",
      "db",
      "pg_dump",
      "-U",
      "blackwood",
      "-d",
      "blackwood",
      "-Fc",
    ],
    { encoding: "buffer" },
  );
  compose([
    "exec",
    "-T",
    "db",
    "createdb",
    "-U",
    "blackwood",
    "blackwood_restore",
  ]);
  compose(
    [
      "exec",
      "-T",
      "db",
      "pg_restore",
      "-U",
      "blackwood",
      "-d",
      "blackwood_restore",
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
    ],
    { input: dump },
  );
  assert.equal(
    sql(
      `SELECT attendance || ':' || plus_one
    FROM invitation_responses WHERE id = '${id}'`,
      "blackwood_restore",
    ),
    "no:false",
  );

  const organizerHeaders = { "X-Organizer-Request": "1" };
  const privateUrl = `${baseUrl}/api/organizer/invitation-responses`;
  const anonymous = await fetch(privateUrl, { headers: organizerHeaders });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get("cache-control"), "no-store");
  const fixtures = [
    {
      firstName: "Chris",
      attendance: "yes",
      plusOne: true,
      ideas: "🎃".repeat(500),
    },
    { firstName: "Alex", attendance: "yes", plusOne: false },
    { firstName: "Sam", attendance: "to_confirm", plusOne: true },
    { firstName: "Alex", attendance: "no", plusOne: false },
  ];
  const fixtureIds = [id, randomUUID(), randomUUID(), randomUUID()];
  for (const [index, fixture] of fixtures.entries()) {
    const saved = await fetch(
      `${baseUrl}/api/invitation-responses/${fixtureIds[index]}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fixture),
      },
    );
    assert.equal(saved.status, 200);
  }
  const organizer = await page.context().newPage();
  await organizer.goto(`${baseUrl}/organisateur/invitations`);
  await expect(
    organizer.getByLabel("Mot de passe", { exact: true }),
  ).toBeVisible();
  await organizer.getByLabel("Mot de passe", { exact: true }).fill("incorrect");
  await organizer
    .getByRole("button", { name: "Se connecter", exact: true })
    .click();
  await expect(organizer.getByRole("alert")).toContainText("incorrect");
  await organizer
    .getByLabel("Mot de passe", { exact: true })
    .fill(organizerPassword);
  await organizer
    .getByRole("button", { name: "Se connecter", exact: true })
    .click();
  await expect(
    organizer.getByRole("heading", { name: "Réponses (4)", exact: true }),
  ).toBeVisible();
  await expect(organizer).toHaveURL(`${baseUrl}/organisateur/invitations`);
  await expect(
    organizer.getByRole("link", { name: "Invitations", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    organizer.getByRole("link", { name: "Coffre", exact: true }),
  ).toHaveAttribute("href", "/organisateur/coffre");
  await expect(
    organizer.getByRole("heading", { name: "Alex", exact: true }),
  ).toHaveCount(2);
  await expect(
    organizer.locator('dl[aria-label="Totaux des réponses"] dd'),
  ).toHaveText(["2", "1", "1", "4"]);
  const sessionCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "blackwood-organizer-dev",
  );
  assert.ok(sessionCookie);
  assert.equal(sessionCookie.httpOnly, true);
  assert.equal(sessionCookie.sameSite, "Strict");
  assert.ok(
    !(await organizer.evaluate(() => document.cookie)).includes(
      sessionCookie.name,
    ),
  );
  const authenticatedHeaders = {
    ...organizerHeaders,
    Cookie: `${sessionCookie.name}=${sessionCookie.value}`,
  };
  const read = await fetch(privateUrl, { headers: authenticatedHeaders });
  const snapshot = await read.json();
  assert.deepEqual(snapshot.totals, {
    attending: 2,
    toConfirm: 1,
    plusOnes: 1,
  });
  assert.equal(snapshot.responses.length, 4);
  for (const row of snapshot.responses)
    assert.deepEqual(Object.keys(row).sort(), [
      "attendance",
      "firstName",
      "ideas",
      "plusOne",
    ]);
  for (const fixtureId of fixtureIds)
    assert.ok(!JSON.stringify(snapshot).includes(fixtureId));
  const edited = await fetch(
    `${baseUrl}/api/invitation-responses/${fixtureIds[2]}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Sam",
        attendance: "yes",
        plusOne: true,
      }),
    },
  );
  assert.equal(edited.status, 200);
  await organizer
    .getByRole("button", { name: "Actualiser", exact: true })
    .click();
  await expect(
    organizer.getByRole("heading", { name: "Réponses (4)", exact: true }),
  ).toBeVisible();
  assert.deepEqual(
    (await (await fetch(privateUrl, { headers: authenticatedHeaders })).json())
      .totals,
    { attending: 3, toConfirm: 0, plusOnes: 2 },
  );
  await expect(
    organizer.locator('dl[aria-label="Totaux des réponses"] dd'),
  ).toHaveText(["3", "0", "2", "4"]);

  const hubToggle = organizer.getByRole("switch", {
    name: "Ouvrir le hub aux invités identifiés",
  });
  await expect(hubToggle).not.toBeChecked();
  await hubToggle.click();
  await expect(
    organizer.getByText("Accueil mis à jour.", { exact: true }),
  ).toBeVisible();
  await page.goto(`${baseUrl}/`);
  await expect(
    page.getByRole("heading", { name: "Bienvenue, Chris." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Coffre/ })).toHaveAttribute(
    "href",
    "/coffre",
  );
  const guestCookie = (await context.cookies()).find((cookie) =>
    cookie.name.includes("guest"),
  );
  assert.ok(guestCookie);
  assert.equal(guestCookie.httpOnly, true);
  assert.equal(guestCookie.sameSite, "Strict");
  assert.ok(
    !(await page.evaluate(() => document.cookie)).includes(guestCookie.name),
  );
  const guestAccess = await context.request.get(`${baseUrl}/api/guest-access`, {
    headers: { "X-Guest-Request": "1" },
  });
  const identified = await guestAccess.json();
  assert.equal(identified.hubEnabled, true);
  assert.equal(identified.profile.hasInvitationResponse, true);
  assert.notEqual(identified.profile.id, id);
  assert.ok(!JSON.stringify(identified).includes(id));

  await organizer.getByRole("link", { name: "Clés des invités" }).click();
  const guestAccessCard = organizer.getByRole("listitem").filter({
    has: organizer.getByRole("heading", { name: "Chris", exact: true }),
  });
  await guestAccessCard
    .getByRole("button", { name: "Générer un code", exact: true })
    .click();
  await expect(organizer.locator("code")).toBeVisible();
  const personalCode = await organizer.locator("code").innerText();
  assert.match(
    personalCode,
    /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){4}$/,
  );
  await organizer.getByRole("button", { name: "Masquer le code" }).click();
  await expect(organizer.locator("code")).toHaveCount(0);
  const recoveryContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  t.after(() => recoveryContext.close());
  const recoveryPage = await recoveryContext.newPage();
  await recoveryPage.goto(`${baseUrl}/`);
  await recoveryPage
    .getByRole("link", { name: "Retrouver mon profil par code" })
    .click();
  await recoveryPage.getByLabel("Ton code personnel").fill("invalid-code");
  await recoveryPage
    .getByRole("button", { name: "Retrouver mon profil" })
    .click();
  await expect(recoveryPage.getByRole("alert")).toContainText(
    "incorrect ou désactivé",
  );
  await recoveryPage
    .getByLabel("Ton code personnel")
    .fill(personalCode.toLowerCase());
  await recoveryPage
    .getByRole("button", { name: "Retrouver mon profil" })
    .click();
  await expect(
    recoveryPage.getByRole("heading", { name: "Bienvenue, Chris." }),
  ).toBeVisible();
  const recoveredAccess = await (
    await recoveryContext.request.get(`${baseUrl}/api/guest-access`)
  ).json();
  assert.equal(recoveredAccess.profile.id, identified.profile.id);
  assert.equal(
    await recoveryPage.evaluate(() =>
      localStorage.getItem("blackwood.invitation-response-id"),
    ),
    null,
  );
  assert.equal(sql("SELECT count(*) FROM invitation_responses"), "4");
  await organizer
    .getByRole("link", { name: "Invitations", exact: true })
    .click();

  // Exercise the media API through Caddy with real cookies and the shipped decoder.
  const mediaHeaders = { "X-Guest-Request": "1", Origin: baseUrl };
  const uploadAvatar = (buffer) =>
    context.request.put(`${baseUrl}/api/profiles/me/avatar`, {
      headers: mediaHeaders,
      multipart: {
        file: {
          name: "untrusted-upload.heic",
          mimeType: "application/octet-stream",
          buffer,
        },
      },
    });
  const initialAvatar = await uploadAvatar(await imageFixture());
  assert.equal(initialAvatar.status(), 200, await initialAvatar.text());
  let mediaId = (await initialAvatar.json()).avatarMediaId;
  const apiContainer = compose(["ps", "-q", "api"]).trim();
  const limits = JSON.parse(
    execFileSync(
      "docker",
      ["inspect", "--format", "{{json .HostConfig}}", apiContainer],
      options,
    ),
  );
  assert.equal(limits.Memory, 512 * 1024 * 1024);
  assert.equal(limits.NanoCpus, 1_000_000_000);
  for (const fixture of [
    {
      name: "iphone-11-pro-max.heic",
      hash: "d9b9ebe21c4127080414f2b86f6ecb900dc2ca902be82b39be93b61ccb622680",
      dimensions: [1487, 1920],
    },
    {
      name: "iphone-13-pro-max.heic",
      hash: "e760c80eed310e4f27c092d5487693ca8e104e7cc01d25ba4828deb28f679676",
      dimensions: [1440, 1920],
    },
  ]) {
    const bytes = await readFile(
      new URL(`../../api/test/fixtures/media/${fixture.name}`, import.meta.url),
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      fixture.hash,
    );
    const previous = mediaId;
    const uploaded = await uploadAvatar(bytes);
    assert.equal(
      uploaded.status(),
      200,
      `${fixture.name}: ${await uploaded.text()}`,
    );
    mediaId = (await uploaded.json()).avatarMediaId;
    assert.notEqual(mediaId, previous);
    assert.equal(
      (
        await context.request.get(`${baseUrl}/api/media/${previous}/image`)
      ).status(),
      404,
    );
    const image = await context.request.get(
      `${baseUrl}/api/media/${mediaId}/image`,
    );
    assert.equal(image.status(), 200);
    assert.equal(image.headers()["cache-control"], "private, no-store");
    const metadata = await imageMetadata(await image.body());
    assert.deepEqual([metadata.width, metadata.height], [512, 512]);
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.space, "srgb");
    for (const key of ["exif", "xmp", "iptc", "icc", "orientation"])
      assert.equal(metadata[key], undefined);

    // Photo and thumbnail share the same HEIC decoder, without adding a public upload route.
    const photoResult = compose(
      [
        "run",
        "--rm",
        "--no-deps",
        "-T",
        "--entrypoint",
        "node",
        "api",
        "--input-type=module",
        "-e",
        `
      import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
      import { readFileSync } from 'node:fs';
      import sharp from 'sharp';
      import { processImage } from './dist/modules/media/processor.js';
      const root = await mkdtemp('/tmp/blackwood-heic-');
      try {
        await writeFile(root + '/input', readFileSync(0));
        const result = await processImage(root + '/input', root + '/output', 'photo');
        const metadata = await sharp(await readFile(root + '/output/image.jpg')).metadata();
        const thumbnail = await sharp(await readFile(root + '/output/thumbnail.jpg')).metadata();
        if (metadata.exif || metadata.xmp || metadata.orientation || thumbnail.exif || thumbnail.xmp) throw Error('Output metadata retained');
        console.log(JSON.stringify({ width: result.width, height: result.height, thumbnailWidth: result.thumbnailWidth, thumbnailHeight: result.thumbnailHeight, format: metadata.format, space: metadata.space }));
      } finally { await rm(root, { recursive: true, force: true }); }
    `,
      ],
      { input: bytes },
    );
    const normalized = JSON.parse(photoResult.trim());
    assert.deepEqual([normalized.width, normalized.height], fixture.dimensions);
    assert.equal(
      Math.max(normalized.thumbnailWidth, normalized.thumbnailHeight),
      480,
    );
    assert.equal(normalized.format, "jpeg");
    assert.equal(normalized.space, "srgb");
  }
  let mediaUrl = `${baseUrl}/api/media/${mediaId}/image`;
  assert.equal((await fetch(mediaUrl)).status, 404);
  assert.equal((await organizer.request.get(mediaUrl)).status(), 200);
  const oversizedFile = await uploadAvatar(Buffer.alloc(20 * 1024 * 1024 + 1));
  assert.equal(oversizedFile.status(), 413, await oversizedFile.text());
  const oversizedRequest = await context.request.put(
    `${baseUrl}/api/profiles/me/avatar`,
    {
      headers: { ...mediaHeaders, "Content-Type": "application/octet-stream" },
      data: Buffer.alloc(21 * 1024 * 1024 + 1),
    },
  );
  assert.equal(oversizedRequest.status(), 413);
  assert.equal(sql("SELECT count(*) FROM media_assets"), "1");
  const diskFiles = compose([
    "exec",
    "-T",
    "api",
    "find",
    "/media",
    "-type",
    "f",
  ])
    .trim()
    .split("\n");
  assert.deepEqual(diskFiles, [`/media/${mediaId}/image.jpg`]);
  const staticMedia = await fetch(`${baseUrl}/media/${mediaId}/image.jpg`);
  assert.notEqual(
    staticMedia.headers.get("content-type")?.split(";")[0],
    "image/jpeg",
  );

  // Freeze media writes before taking the matching database and volume snapshots.
  compose(["stop", "api"]);
  const mediaDump = compose(
    [
      "exec",
      "-T",
      "db",
      "pg_dump",
      "-U",
      "blackwood",
      "-d",
      "blackwood",
      "-Fc",
    ],
    { encoding: "buffer" },
  );
  const mediaArchive = compose(
    [
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "--entrypoint",
      "tar",
      "api",
      "-C",
      "/media",
      "-cf",
      "-",
      ".",
    ],
    { encoding: "buffer" },
  );
  assert.ok(mediaArchive.length > 0);
  sql("CREATE DATABASE blackwood_media_restore");
  compose(
    [
      "exec",
      "-T",
      "db",
      "pg_restore",
      "-U",
      "blackwood",
      "-d",
      "blackwood_media_restore",
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
    ],
    { input: mediaDump },
  );
  assert.equal(
    sql(
      `SELECT avatar_media_id FROM profiles WHERE id = '${identified.profile.id}'`,
      "blackwood_media_restore",
    ),
    mediaId,
  );
  const mediaHash = compose(
    [
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "--entrypoint",
      "node",
      "api",
      "--input-type=module",
      "-e",
      `
    import { createHash } from 'node:crypto';
    import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
    import { execFileSync } from 'node:child_process';
    const root = mkdtempSync('/tmp/blackwood-media-restore-');
    try {
      execFileSync('tar', ['-C', root, '-xf', '-'], { input: readFileSync(0) });
      const original = readFileSync('/media/' + process.argv[1] + '/image.jpg');
      const restored = readFileSync(root + '/' + process.argv[1] + '/image.jpg');
      if (!original.equals(restored)) throw Error('Media restoration changed pixels');
      console.log(createHash('sha256').update(restored).digest('hex'));
    } finally { rmSync(root, { recursive: true, force: true }); }
  `,
      mediaId,
    ],
    { input: mediaArchive },
  ).trim();
  compose(
    [
      "up",
      "-d",
      "--no-deps",
      "--force-recreate",
      "--wait",
      "--wait-timeout",
      "90",
      "api",
    ],
    { stdio: "inherit" },
  );
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${baseUrl}/api/health`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(200);
  const persistedMedia = await context.request.get(mediaUrl);
  assert.equal(persistedMedia.status(), 200);
  assert.equal(
    createHash("sha256")
      .update(await persistedMedia.body())
      .digest("hex"),
    mediaHash,
  );
  await page.getByRole("link", { name: /Mon invitation/ }).click();
  await expect(page.getByText("Chris", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "← Retour au hub" }).click();
  await page.getByRole("link", { name: /Mon profil/ }).click();
  await page.getByLabel("Ton prénom", { exact: true }).fill("Current guest");
  await page.getByRole("button", { name: "Enregistrer mon prénom" }).click();
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Ton prénom a été enregistré.",
  );
  await page.getByLabel("Remplacer ma photo").setInputFiles({
    name: "profile-ui.png",
    mimeType: "image/png",
    buffer: await imageFixture("png"),
  });
  await expect(
    page.getByRole("img", { name: "Aperçu du cadrage" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Agrandir", exact: true }).click();
  await page.getByRole("button", { name: "Enregistrer ma photo" }).click();
  await expect(
    page.getByText("Ta photo a été enregistrée.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("img", { name: "Ton avatar actuel" }),
  ).toBeVisible();
  const updatedAvatar = await (
    await context.request.get(`${baseUrl}/api/guest-access`)
  ).json();
  mediaUrl = `${baseUrl}/api/media/${updatedAvatar.profile.avatarMediaId}/image`;
  await page.getByRole("link", { name: "← Retour au hub" }).click();
  await page.getByRole("link", { name: /Mon invitation/ }).click();
  await expect(page.getByText("Current guest", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Modifier ma réponse" }).click();
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toHaveValue(
    "Current guest",
  );
  await expect(
    page.getByRole("radio", { name: "Oui", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "Je viens à deux", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("textbox", { name: "Une idée pour la soirée ?" }),
  ).toHaveValue("🎃".repeat(500));
  await page
    .getByRole("textbox", { name: "Une idée pour la soirée ?" })
    .fill("Profile-linked edit");
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(
    page.getByText("Ta réponse a bien été mise à jour.", { exact: true }),
  ).toBeVisible();
  assert.equal(sql("SELECT count(*) FROM invitation_responses"), "4");
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("blackwood.invitation-response-id"),
    ),
    id,
  );

  await hubToggle.click();
  await expect(hubToggle).not.toBeChecked();
  await page.goto(`${baseUrl}/profiles`);
  await expect(page).toHaveURL(`${baseUrl}/invitation`);
  await expect(page.getByText("Current guest", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Modifier ma réponse" }).click();
  await page
    .getByRole("textbox", { name: "Une idée pour la soirée ?" })
    .fill("Hub-closed edit");
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(
    page.getByText("Ta réponse a bien été mise à jour.", { exact: true }),
  ).toBeVisible();
  const closedEdit = await context.request.get(
    `${baseUrl}/api/profiles/me/invitation-response`,
    { headers: { "X-Guest-Request": "1" } },
  );
  assert.equal(closedEdit.status(), 200);
  assert.equal((await closedEdit.json()).ideas, "Hub-closed edit");
  await recoveryContext.clearCookies();
  await recoveryPage.goto(`${baseUrl}/login`);
  await recoveryPage.getByLabel("Ton code personnel").fill(personalCode);
  await recoveryPage
    .getByRole("button", { name: "Retrouver mon profil" })
    .click();
  await expect(recoveryPage).toHaveURL(`${baseUrl}/invitation`);
  await expect(
    recoveryPage.getByText("Current guest", { exact: true }),
  ).toBeVisible();
  await recoveryPage
    .getByRole("button", { name: "Modifier ma réponse" })
    .click();
  await expect(
    recoveryPage.getByRole("textbox", { name: "Une idée pour la soirée ?" }),
  ).toHaveValue("Hub-closed edit");
  assert.equal(sql("SELECT count(*) FROM invitation_responses"), "4");
  await hubToggle.click();
  await expect(hubToggle).toBeChecked();
  await page.goto(`${baseUrl}/profiles`);
  await page.getByRole("button", { name: "Créer le lien pour mon +1" }).click();
  const companionUrl = await page
    .getByLabel("Lien à transmettre à ton +1")
    .inputValue();
  assert.ok(new URL(companionUrl).hash.startsWith("#token="));
  const companionContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  t.after(() => companionContext.close());
  const companionPage = await companionContext.newPage();
  await companionPage.goto(companionUrl);
  await companionPage
    .getByLabel("Ton prénom", { exact: true })
    .fill("Accompanying guest");
  await companionPage.getByRole("button", { name: "Créer mon profil" }).click();
  await expect(companionPage.locator("[data-sonner-toast]")).toContainText(
    "Ton profil et ton accès personnel sont créés.",
  );
  assert.equal(new URL(companionPage.url()).hash, "");
  const companionAccess = await (
    await companionContext.request.get(`${baseUrl}/api/guest-access`)
  ).json();
  assert.equal(companionAccess.profile.role, "companion");
  assert.equal(companionAccess.profile.hasInvitationResponse, false);
  assert.notEqual(companionAccess.profile.id, identified.profile.id);
  await companionPage.getByLabel("Choisir une photo").setInputFiles({
    name: "companion.png",
    mimeType: "image/png",
    buffer: await imageFixture("png"),
  });
  await companionPage
    .getByRole("button", { name: "Enregistrer ma photo" })
    .click();
  await expect(
    companionPage.getByText("Ta photo a été enregistrée."),
  ).toBeVisible();
  await companionPage.reload();
  await companionPage
    .getByRole("link", { name: "Continuer avec mon profil" })
    .click();
  await expect(
    companionPage.getByRole("img", { name: "Ton avatar actuel" }),
  ).toBeVisible();
  await companionPage
    .getByRole("button", { name: "Supprimer ma photo" })
    .click();
  await expect(
    companionPage.getByText("Ta photo a été supprimée.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(/Accompanying guest a déjà son propre profil/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Créer le lien pour mon +1" }),
  ).toHaveCount(0);
  await companionPage.goto(`${baseUrl}/`);
  await expect(
    companionPage.getByRole("heading", {
      name: "Bienvenue, Accompanying guest.",
    }),
  ).toBeVisible();
  await companionPage.getByRole("link", { name: /Mon invitation/ }).click();
  await expect(
    companionPage.getByText(
      "Tu es reconnu en tant qu’accompagnant. Tu n’as pas de réponse personnelle à remplir.",
    ),
  ).toBeVisible();
  await expect(companionPage.getByRole("textbox")).toHaveCount(0);
  await expect(
    companionPage.getByRole("link", { name: "Aller au formulaire" }),
  ).toHaveCount(0);
  assert.equal(sql("SELECT count(*) FROM invitation_responses"), "4");
  await hubToggle.click();
  await expect(hubToggle).not.toBeChecked();
  await companionPage.goto(`${baseUrl}/profiles`);
  await expect(companionPage).toHaveURL(`${baseUrl}/invitation`);
  await expect(companionPage.getByRole("textbox")).toHaveCount(0);
  await hubToggle.click();
  await expect(hubToggle).toBeChecked();
  compose(["restart", "api"], { stdio: "inherit" });
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${baseUrl}/api/health`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 60_000 },
    )
    .toBe(200);
  await organizer.reload();
  await expect(
    organizer.getByRole("heading", { name: "Réponses (4)", exact: true }),
  ).toBeVisible();
  await expect(hubToggle).toBeChecked();
  await page.goto(`${baseUrl}/`);
  await expect(
    page.getByRole("heading", { name: "Bienvenue, Current guest." }),
  ).toBeVisible();
  assert.equal((await context.request.get(mediaUrl)).status(), 200);
  await page.getByRole("link", { name: /Mon profil/ }).click();
  await page.getByRole("button", { name: "Supprimer ma photo" }).click();
  await expect(
    page.getByText("Ta photo a été supprimée.", { exact: true }),
  ).toBeVisible();
  const deletedProfile = await (
    await context.request.get(`${baseUrl}/api/guest-access`)
  ).json();
  assert.equal(deletedProfile.profile.avatarMediaId, null);
  assert.equal((await context.request.get(mediaUrl)).status(), 404);
  assert.equal(sql("SELECT count(*) FROM media_assets"), "0");
  assert.equal(
    compose(["exec", "-T", "api", "find", "/media", "-type", "f"]).trim(),
    "",
  );
  // Exercise the guest Coffre UI against the real cookie, API, database and media worker.
  const coffreContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: {
      cookies: (await context.cookies()).filter((cookie) =>
        cookie.name.includes("guest"),
      ),
      origins: [],
    },
  });
  t.after(() => coffreContext.close());
  const coffreGuest = await coffreContext.newPage();
  await organizer.goto(`${baseUrl}/organisateur/coffre`);
  await organizer.getByLabel("Durée du compte à rebours").fill("360");
  await organizer.getByRole("button", { name: "Préparer le Coffre" }).click();
  await expect(
    organizer.getByRole("button", { name: "Lancer le compte à rebours" }),
  ).toBeVisible();
  await coffreGuest.goto(`${baseUrl}/coffre`);
  await expect(
    coffreGuest.getByRole("heading", {
      name: "Les souvenirs attendent leur heure.",
    }),
  ).toBeVisible();
  await expect(coffreGuest.getByLabel("Un mot pour plus tard.")).toHaveCount(0);
  await organizer
    .getByRole("button", { name: "Lancer le compte à rebours" })
    .click();
  await expect(organizer.getByRole("timer")).toBeVisible();
  await coffreGuest.reload();
  const sharedMemory = "Un vrai souvenir enregistré depuis le navigateur.";
  await coffreGuest.getByLabel("Un mot pour plus tard.").fill(sharedMemory);
  await coffreGuest.getByRole("radio", { name: /One Wish Willow/ }).check();
  await coffreGuest.getByRole("button", { name: "Continuer" }).click();
  await expect(
    coffreGuest.getByRole("dialog").getByText(sharedMemory, { exact: true }),
  ).toBeVisible();
  await coffreGuest.getByRole("button", { name: "Confier au Coffre" }).click();
  await expect(coffreGuest.getByLabel("Un mot pour plus tard.")).toHaveValue(
    "",
  );
  assert.equal(sql("SELECT count(*) FROM coffre_contributions"), "1");
  await expect(
    coffreGuest.getByText(sharedMemory, { exact: true }),
  ).toHaveCount(0);
  assert.equal(
    (
      await coffreContext.request.get(`${baseUrl}/api/coffre/contributions`)
    ).status(),
    409,
  );
  await coffreGuest
    .getByLabel("Un mot pour plus tard.")
    .fill("Un souvenir privé pour Chris.");
  await coffreGuest
    .getByLabel("Ajouter une photo", { exact: true })
    .setInputFiles({
      name: "coffre-private.jpg",
      mimeType: "image/jpeg",
      buffer: await imageFixture(),
    });
  await coffreGuest.getByRole("button", { name: "Continuer" }).click();
  await coffreGuest.getByRole("radio", { name: /Juste pour Chris/ }).check();
  await expect(
    coffreGuest
      .getByRole("dialog")
      .getByRole("figure", { name: "Écrin Classique" }),
  ).toBeVisible();
  await coffreGuest.getByRole("button", { name: "Confier au Coffre" }).click();
  await expect(coffreGuest.getByLabel("Un mot pour plus tard.")).toHaveValue(
    "",
  );
  assert.equal(sql("SELECT count(*) FROM coffre_contributions"), "2");
  const privateCoffrePhoto = sql(
    "SELECT photo_media_id FROM coffre_contributions WHERE visibility = 'private'",
  );
  assert.equal(
    (
      await coffreContext.request.get(
        `${baseUrl}/api/media/${privateCoffrePhoto}/image`,
      )
    ).status(),
    404,
  );
  assert.equal(
    (
      await organizer.request.get(
        `${baseUrl}/api/media/${privateCoffrePhoto}/image`,
      )
    ).status(),
    200,
  );
  compose(["restart", "api", "db"], { stdio: "inherit" });
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${baseUrl}/api/health`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 60_000 },
    )
    .toBe(200);
  assert.equal(sql("SELECT count(*) FROM coffre_contributions"), "2");
  await organizer.reload();
  await organizer.getByLabel("Nouveau temps restant").fill("30");
  await organizer.getByRole("button", { name: "Avancer l’ouverture" }).click();
  await expect
    .poll(() =>
      Number(
        sql(
          "SELECT extract(epoch from (deadline - clock_timestamp()))::int FROM coffres WHERE id = 1",
        ),
      ),
    )
    .toBeLessThan(1801);
  await organizer
    .getByRole("button", { name: "Ouvrir maintenant", exact: true })
    .click();
  await organizer
    .getByRole("button", { name: "Confirmer l’ouverture" })
    .click();
  await expect(
    organizer.getByText("Le Coffre est ouvert", { exact: true }),
  ).toBeVisible();
  await coffreGuest.reload();
  await expect(
    coffreGuest.getByRole("heading", { name: "Ce qu’on garde de cette nuit." }),
  ).toBeVisible();
  await expect(
    coffreGuest.getByText(sharedMemory, { exact: true }),
  ).toBeVisible();
  await expect(
    coffreGuest.getByText("Un souvenir privé pour Chris.", { exact: true }),
  ).toHaveCount(0);
  await expect(coffreGuest.getByLabel("Un mot pour plus tard.")).toHaveCount(0);
  assert.equal(
    (
      await coffreContext.request.get(
        `${baseUrl}/api/media/${privateCoffrePhoto}/image`,
      )
    ).status(),
    404,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/coffre/contributions`)).status,
    401,
  );

  await recoveryPage.goto(`${baseUrl}/`);
  await expect(
    recoveryPage.getByRole("heading", { name: "Bienvenue, Current guest." }),
  ).toBeVisible();
  await organizer.getByRole("link", { name: "Clés des invités" }).click();
  const currentAccessCard = organizer.getByRole("listitem").filter({
    has: organizer.getByRole("heading", {
      name: "Current guest",
      exact: true,
    }),
  });
  await currentAccessCard
    .getByRole("button", { name: "Régénérer le code" })
    .click();
  await expect(organizer.locator("code")).toBeVisible();
  const regeneratedCode = await organizer.locator("code").innerText();
  assert.notEqual(regeneratedCode, personalCode);
  await recoveryPage.reload();
  await expect(
    recoveryPage.getByRole("heading", { name: "Bienvenue, Current guest." }),
  ).toBeVisible();
  await currentAccessCard
    .getByRole("button", { name: "Désactiver l’accès" })
    .click();
  await expect(currentAccessCard).toContainText("Accès désactivé");
  await expect(organizer.locator("code")).toHaveCount(0);
  await recoveryPage.goto(`${baseUrl}/login`);
  await recoveryPage.getByLabel("Ton code personnel").fill(regeneratedCode);
  await recoveryPage
    .getByRole("button", { name: "Retrouver mon profil" })
    .click();
  await expect(recoveryPage.getByRole("alert")).toContainText(
    "incorrect ou désactivé",
  );
  await page.goto(`${baseUrl}/`);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Ton prénom")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Retrouver mon profil par code" }),
  ).toBeVisible();
  assert.equal(sql("SELECT count(*) FROM invitation_responses"), "4");
  await organizer
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
  await expect(
    organizer.getByText("Tu es déconnecté.", { exact: true }),
  ).toBeVisible();
  assert.equal(
    (await fetch(privateUrl, { headers: authenticatedHeaders })).status,
    401,
  );
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("blackwood.invitation-response-id"),
    ),
    id,
  );
  await organizer.goto(`${baseUrl}/organisateur`);
  await expect(
    organizer.getByLabel("Mot de passe", { exact: true }),
  ).toBeVisible();
  await organizer.close();
});
