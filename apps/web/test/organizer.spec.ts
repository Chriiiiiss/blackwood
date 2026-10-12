import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const initial = {
  responses: [
    {
      firstName: "Chris",
      attendance: "yes",
      plusOne: true,
      ideas: "🎃".repeat(500),
    },
    { firstName: "Alex", attendance: "yes", plusOne: false, ideas: null },
    { firstName: "Sam", attendance: "to_confirm", plusOne: true, ideas: null },
    { firstName: "Alex", attendance: "no", plusOne: false, ideas: null },
  ],
  totals: { attending: 2, toConfirm: 1, plusOnes: 1 },
};

async function mockOrganizer(page: Page, authenticated = false) {
  const state = {
    authenticated,
    data: initial,
    listError: false,
    logoutError: false,
    expires: Date.now() + 604_800_000,
    idleExpires: Date.now() + 86_400_000,
    holdList: undefined as Promise<void> | undefined,
    holdLogout: undefined as Promise<void> | undefined,
  };
  await page.route("**/api/organizer/**", async (route) => {
    const request = route.request();
    expect(request.headers()["x-organizer-request"]).toBe("1");
    const session = {
      authenticated: true,
      expiresAt: new Date(state.expires).toISOString(),
      idleExpiresAt: new Date(state.idleExpires).toISOString(),
    };
    if (request.method() === "POST") {
      if (request.postDataJSON().password !== "Correct password")
        return route.fulfill({
          status: 401,
          json: { code: "INVALID_CREDENTIALS" },
        });
      state.authenticated = true;
      return route.fulfill({ json: session });
    }
    if (request.method() === "DELETE") {
      await state.holdLogout;
      if (state.logoutError) return route.fulfill({ status: 503, json: {} });
      state.authenticated = false;
      return route.fulfill({ status: 204 });
    }
    if (!state.authenticated)
      return route.fulfill({ status: 401, json: { code: "UNAUTHENTICATED" } });
    if (request.url().endsWith("/session"))
      return route.fulfill({ json: session });
    await state.holdList;
    await route
      .fulfill(
        state.listError ? { status: 503, json: {} } : { json: state.data },
      )
      .catch(() => {});
  });
  return state;
}

test("organizer login, mobile cards, reload and totals remain accessible", async ({
  page,
}) => {
  await mockOrganizer(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/organisateur/connexion");
  await page.getByLabel("Mot de passe", { exact: true }).fill("Wrong password");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Ce mot de passe est incorrect.",
  );
  await expect(page.getByLabel("Mot de passe", { exact: true })).toHaveValue(
    "",
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page
    .getByLabel("Mot de passe", { exact: true })
    .fill("Correct password");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Réponses (4)", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Alex", exact: true }),
  ).toHaveCount(2);
  const totals = page.getByRole("definition");
  expect((await totals.allTextContents()).slice(0, 3)).toEqual(["2", "1", "1"]);
  expect(
    await page
      .locator("main")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Réponses (4)", exact: true }),
  ).toBeVisible();
});

test("direct unauthenticated access, empty list and retry use the private flow", async ({
  page,
}) => {
  const state = await mockOrganizer(page);
  await page.goto("/organisateur");
  await expect(page.getByLabel("Mot de passe", { exact: true })).toBeVisible();
  state.authenticated = true;
  state.data = {
    responses: [],
    totals: { attending: 0, toConfirm: 0, plusOnes: 0 },
  };
  await page.goto("/organisateur");
  await expect(page.getByText("Aucune réponse pour le moment.")).toBeVisible();
  state.listError = true;
  await page.getByRole("button", { name: "Actualiser", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Impossible de charger");
  state.listError = false;
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(page.getByText("Aucune réponse pour le moment.")).toBeVisible();
});

test("logout hides responses, retries failure and preserves the public response identity", async ({
  page,
}) => {
  const state = await mockOrganizer(page, true);
  await page.goto("/organisateur");
  await expect(
    page.getByRole("heading", { name: "Réponses (4)", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    localStorage.setItem("blackwood.invitation-response-id", "public-identity"),
  );
  state.logoutError = true;
  await page
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "déconnexion n’a pas pu être confirmée",
  );
  await expect(
    page.getByRole("heading", { name: "Chris", exact: true }),
  ).toHaveCount(0);
  state.logoutError = false;
  await page
    .getByRole("button", { name: "Réessayer la déconnexion", exact: true })
    .click();
  await expect(
    page.getByText("Tu es déconnecté.", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("blackwood.invitation-response-id"),
    ),
  ).toBe("public-identity");
  await page.goto("/organisateur");
  await expect(page.getByLabel("Mot de passe", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Chris", exact: true }),
  ).toHaveCount(0);
});

test("expiry removes private cards without waiting for another API call", async ({
  page,
}) => {
  await page.clock.install();
  const state = await mockOrganizer(page, true);
  state.idleExpires = Date.now() + 5000;
  await page.goto("/organisateur");
  await expect(
    page.getByRole("heading", { name: "Réponses (4)", exact: true }),
  ).toBeVisible();
  await page.clock.runFor(6000);
  await expect(
    page.getByText("Ta session a expiré. Reconnecte-toi pour continuer."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Chris", exact: true }),
  ).toHaveCount(0);
});

test("returning to the foreground rechecks session before showing cached data", async ({
  page,
}) => {
  const state = await mockOrganizer(page, true);
  await page.goto("/organisateur");
  await expect(
    page.getByRole("heading", { name: "Chris", exact: true }),
  ).toBeVisible();
  state.authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("Mot de passe", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Chris", exact: true }),
  ).toHaveCount(0);
});

test("a late list response after navigation cannot repopulate private cards", async ({
  page,
}) => {
  const state = await mockOrganizer(page, true);
  await page.goto("/organisateur");
  await expect(
    page.getByRole("heading", { name: "Chris", exact: true }),
  ).toBeVisible();
  let release = () => {};
  state.holdList = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = page.waitForRequest("**/api/organizer/invitation-responses");
  await page.getByRole("button", { name: "Actualiser", exact: true }).click();
  await pending;
  await expect(
    page.getByRole("heading", { name: "Chris", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Accueil — Hôtel Blackwood" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toBeVisible();
  state.authenticated = false;
  release();
  await page.goBack();
  await expect(page.getByLabel("Mot de passe", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Chris", exact: true }),
  ).toHaveCount(0);
});
