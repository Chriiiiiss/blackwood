import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const root = fileURLToPath(new URL("../../..", import.meta.url));

test("production containers save, restore and edit real invitation responses", {
  timeout: 600_000,
}, async (t) => {
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
  compose(["build", "api", "web"], { stdio: "inherit" });
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${baseUrl}/chambre/inconnue`);
  const notFoundHeading = page.getByRole("heading", {
    name: "Cette chambre est introuvable.",
  });
  await expect(notFoundHeading).toBeVisible();
  await page.reload();
  await expect(notFoundHeading).toBeVisible();
  await page.getByRole("link", { name: "Retour à l’invitation" }).click();
  await expect(page).toHaveURL(`${baseUrl}/`);
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
});
