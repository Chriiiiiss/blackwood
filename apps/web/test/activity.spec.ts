import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const alex = "151597a3-d728-414d-9b74-717386c10b01";
const sam = "151597a3-d728-414d-9b74-717386c10b02";
async function guest(page: Page, recordingFails = false) {
  const events: Record<string, unknown>[] = [];
  await page.route("**/api/activity/events", (route) => {
    events.push(route.request().postDataJSON());
    return recordingFails ? route.abort() : route.fulfill({ status: 204 });
  });
  await page.route("**/api/guest-access", (route) =>
    route.fulfill({
      json: {
        hubEnabled: true,
        profile: {
          id: alex,
          firstName: "Alex",
          role: "main",
          avatarMediaId: null,
          hasInvitationResponse: true,
        },
      },
    }),
  );
  await page.route("**/api/profiles/me/companion", (route) =>
    route.fulfill({ json: { eligible: false, companion: null } }),
  );
  await page.route("**/api/profiles/me", (route) =>
    route.fulfill({
      json: {
        id: alex,
        firstName: "Alex",
        role: "main",
        avatarMediaId: null,
        hasInvitationResponse: true,
      },
    }),
  );
  return events;
}
test("guest navigation and failures report sanitized context without profile claims or private contents", async ({
  page,
}) => {
  const events = await guest(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Bienvenue, Alex." }),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        events.filter(
          (event) => event.kind === "page_view" && event.page === "hub",
        ).length,
    )
    .toBe(1);
  await page.getByRole("link", { name: "Mon profil", exact: true }).click();
  await expect
    .poll(() =>
      events.some(
        (event) => event.kind === "page_view" && event.page === "profile",
      ),
    )
    .toBe(true);
  await page.route("**/api/coffre/contributions", (route) =>
    route.fulfill({
      status: 503,
      json: { code: "PRIVATE_ERROR", message: "Never include this message" },
    }),
  );
  await page.evaluate(async () => {
    await fetch("/api/coffre/contributions", {
      method: "POST",
      body: JSON.stringify({ text: "SECRET MESSAGE" }),
    });
  });
  await expect
    .poll(() =>
      events.some(
        (event) => event.kind === "api_error" && event.status === 503,
      ),
    )
    .toBe(true);
  await page.route("**/api/missions/me", (route) => route.abort());
  await page.evaluate(async () => {
    await fetch("/api/missions/me").catch(() => {});
  });
  await expect
    .poll(() => events.some((event) => event.kind === "network_error"))
    .toBe(true);
  await page.evaluate(() =>
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new TypeError("SECRET ERROR MESSAGE"),
        message: "SECRET ERROR MESSAGE",
        filename: "https://example.test/assets/index-demo.js?code=SECRET",
        lineno: 12,
        colno: 4,
      }),
    ),
  );
  await expect
    .poll(() =>
      events.some(
        (event) =>
          event.kind === "client_error" &&
          event.source === "index-demo.js:12:4",
      ),
    )
    .toBe(true);
  const encoded = JSON.stringify(events);
  expect(encoded).not.toContain(alex);
  expect(encoded).not.toContain("SECRET");
  expect(encoded).not.toContain("Never include");
  expect(encoded).not.toContain("PRIVATE_ERROR");
});
test("an unavailable collector does not block profile navigation or change successful API responses", async ({
  page,
}) => {
  await guest(page, true);
  await page.goto("/");
  await page.getByRole("link", { name: "Mon profil", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Mon profil", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      async () =>
        (
          await fetch("/api/profiles/me", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ firstName: "Alex" }),
          })
        ).status,
    ),
  ).toBe(200);
});

test("organizer activity filters people and errors, paginates and remains private and accessible", async ({
  page,
}) => {
  const filters: string[] = [];
  let status = 200;
  const base = {
    profileId: alex,
    firstName: "Alex",
    kind: "page_view",
    page: "coffre",
    route: null,
    method: null,
    status: null,
    code: null,
    source: null,
    createdAt: "2026-10-31T20:14:00Z",
  };
  await page.route("**/api/organizer/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/session"))
      return route.fulfill({
        json: {
          authenticated: true,
          expiresAt: "2027-01-01T00:00:00Z",
          idleExpiresAt: "2027-01-01T00:00:00Z",
        },
      });
    if (url.pathname.endsWith("/hub-settings"))
      return route.fulfill({ json: { hubEnabled: true } });
    if (url.pathname.endsWith("/profile-access"))
      return route.fulfill({
        json: [
          { id: alex, firstName: "Alex" },
          { id: sam, firstName: "Sam" },
        ],
      });
    if (url.pathname.endsWith("/activity")) {
      expect(route.request().headers()["x-organizer-request"]).toBe("1");
      filters.push(url.search);
      const failed = {
        ...base,
        id: "error",
        profileId: sam,
        firstName: "Sam",
        kind: "api_error",
        status: 503,
        code: "HTTP_ERROR",
        route: "/api/coffre/contributions",
        method: "POST",
      };
      const rows = url.searchParams.has("onlyErrors")
        ? [failed]
        : url.searchParams.has("before")
          ? [{ ...base, id: "older" }]
          : [{ ...base, id: "visit" }, failed];
      return route.fulfill({
        status,
        json:
          status === 200
            ? { events: rows, nextCursor: url.search ? "" : alex }
            : {},
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/organisateur/activite");
  const feed = page.getByRole("list", { name: "Journal d’activité" });
  await expect(feed.getByText("Alex", { exact: true })).toBeVisible();
  await expect(feed.getByText("Erreur HTTP 503 · Coffre")).toBeVisible();
  await page.getByRole("button", { name: "Activité plus ancienne" }).click();
  await expect(feed.getByRole("listitem")).toHaveCount(3);
  await page.getByLabel("Invité", { exact: true }).selectOption(sam);
  await expect
    .poll(() => filters.some((value) => value.includes(`profileId=${sam}`)))
    .toBe(true);
  await page.getByLabel("Erreurs uniquement").check();
  await expect(feed.getByRole("listitem")).toHaveCount(1);
  await expect
    .poll(() => filters.some((value) => value.includes("onlyErrors=1")))
    .toBe(true);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  status = 401;
  await page.getByRole("button", { name: "Actualiser", exact: true }).click();
  await expect(page).toHaveURL(/\/organisateur\/connexion/);
  await expect(feed).toHaveCount(0);
});
