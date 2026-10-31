import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import type {
  Confirmation,
  OwnMissions,
} from "../src/features/missions/requests";

const id = "151597a3-d728-414d-9b74-717386c10b01";
const missionId = "151597a3-d728-414d-9b74-717386c10b02";
const claimId = "151597a3-d728-414d-9b74-717386c10b03";
const text = "Chante les mauvaises paroles d’une chanson et fais-toi corriger.";
async function setup(page: Page) {
  const fixture = {
    own: {
      score: 0,
      exhausted: false,
      current: null,
      history: [],
    } as OwnMissions,
    incoming: [] as Confirmation[],
    claims: [] as { id: string; recipientProfileId: string }[],
    mutations: 0,
    abortClaim: false,
  };
  await page.route("**/api/guest-access", (route) =>
    route.fulfill({
      json: {
        hubEnabled: true,
        profile: {
          id,
          firstName: "Alex",
          role: "companion",
          avatarMediaId: null,
          hasInvitationResponse: false,
        },
      },
    }),
  );
  await page.route("**/api/missions/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      fixture.mutations++;
      expect(request.headers()["x-guest-request"]).toBe("1");
    }
    if (path === "/api/missions/me")
      return route.fulfill({ json: fixture.own });
    if (path === "/api/missions/players")
      return route.fulfill({ json: [{ id: missionId, firstName: "Sam" }] });
    if (path === "/api/missions/me/confirmations")
      return route.fulfill({ json: fixture.incoming });
    if (path === "/api/missions/me/assignments") {
      expect(request.postDataJSON().after).toBeNull();
      fixture.own.current = {
        id: request.postDataJSON().id,
        text,
        pending: null,
      };
      return route.fulfill({ json: fixture.own });
    }
    if (path.endsWith("/claims")) {
      fixture.claims.push(request.postDataJSON());
      if (fixture.abortClaim) {
        fixture.abortClaim = false;
        return route.abort();
      }
      if (fixture.own.current)
        fixture.own.current.pending = {
          id: request.postDataJSON().id,
          recipient: "Sam",
        };
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/decision")) {
      expect(request.postDataJSON().decision).toBe("confirmed");
      fixture.incoming = [];
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return fixture;
}

test("missions keep spoilers private, survive polling and reuse a failed claim", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.goto("/missions");
  await page
    .getByRole("button", { name: "Obtenir ma première mission" })
    .click();
  const mission = page
    .locator('p[aria-hidden="true"]')
    .filter({ hasText: text });
  await expect(mission).toBeVisible();
  await page.getByRole("button", { name: "Afficher la mission" }).click();
  await expect(
    page.getByRole("button", { name: "Masquer la mission" }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.waitForResponse(
    (response) =>
      response.url().endsWith("/missions/me") &&
      response.request().method() === "GET",
  );
  await expect(
    page.getByRole("button", { name: "Masquer la mission" }),
  ).toBeVisible();
  expect(fixture.mutations).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });
  await expect(
    page.getByRole("button", { name: "Afficher la mission" }),
  ).toBeVisible();
  await page.getByLabel("Qui s’est fait piéger ?").selectOption(missionId);
  fixture.abortClaim = true;
  await page
    .getByRole("button", { name: "Faire confirmer", exact: true })
    .click();
  await expect(
    page.getByText("L’action n’a pas pu être confirmée.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("Qui s’est fait piéger ?")).toHaveValue(
    missionId,
  );
  await page
    .getByRole("button", { name: "Faire confirmer", exact: true })
    .click();
  await expect(
    page.getByText("En attente de Sam", { exact: true }),
  ).toBeVisible();
  expect(fixture.claims).toHaveLength(2);
  expect(fixture.claims[0]).toEqual(fixture.claims[1]);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Afficher la mission" }),
  ).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    text,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("incoming confirmations stay visually distinct and work without a personal mission", async ({
  page,
}) => {
  const fixture = await setup(page);
  fixture.incoming = [
    { id: claimId, assignmentId: missionId, firstName: "Sam", text },
  ];
  await page.goto("/");
  await page.getByRole("link", { name: /Missions secrètes/ }).click();
  await page.getByRole("button", { name: "À confirmer · 1" }).click();
  const request = page.getByRole("article", { name: "Demande de Sam" });
  await expect(request.getByText("La mission de Sam")).toBeVisible();
  await expect(
    request.locator('p[aria-hidden="true"]').filter({ hasText: text }),
  ).toBeVisible();
  expect(
    await request.evaluate((node) => getComputedStyle(node).backgroundImage),
  ).not.toContain("244, 236, 223");
  await request.getByRole("button", { name: "Afficher la mission" }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await request.getByRole("button", { name: "Confirmer la réussite" }).click();
  await expect(
    page.getByRole("heading", { name: "Personne ne t’a eu ?" }),
  ).toBeVisible();
  expect(fixture.mutations).toBe(1);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
});
