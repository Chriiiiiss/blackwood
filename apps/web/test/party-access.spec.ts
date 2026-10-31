import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function setup(page: Page) {
  const state = {
    isOpen: false,
    status: 200,
    opening: "2026-10-31T20:00:00.000Z",
    now: "2026-10-31T19:59:59.000Z",
    featureReads: [] as string[],
  };
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/party-access")
      return route.fulfill({
        status: state.status,
        json:
          state.status === 200
            ? {
                isOpen: state.isOpen,
                opensAt: state.opening,
                serverNow: state.now,
              }
            : {},
      });
    if (path === "/api/guest-access")
      return route.fulfill({
        json: {
          hubEnabled: true,
          profile: {
            id: "profile",
            firstName: "Alex",
            role: "main",
            avatarMediaId: null,
            hasInvitationResponse: true,
          },
        },
      });
    state.featureReads.push(path);
    return route.fulfill({
      json: { score: 0, exhausted: false, current: null, history: [] },
    });
  });
  return state;
}
for (const destination of ["coffre", "missions"] as const) {
  test(`${destination} redirects to the waiting page without reading activity data or trusting the device clock`, async ({
    page,
  }) => {
    const state = await setup(page);
    await page.clock.setSystemTime(new Date("2036-10-31T22:00:00Z"));
    await page.goto(`/${destination}`);
    await expect(page).toHaveURL(`/a-ce-soir?destination=${destination}`);
    await expect(
      page.getByRole("heading", { name: "Le Coffre et les Missions secrètes" }),
    ).toBeVisible();
    await expect(
      page.getByText("Ouverture à 21 h 00, heure de Paris."),
    ).toBeVisible();
    expect(state.featureReads).toEqual([]);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Le Coffre et les Missions secrètes" }),
    ).toBeVisible();
    expect(state.featureReads).toEqual([]);
    await page.setViewportSize({ width: 320, height: 740 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(320);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
test("waiting page automatically resumes the requested activity once the server opens", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/a-ce-soir?destination=missions");
  await expect(
    page.getByRole("heading", { name: "Le Coffre et les Missions secrètes" }),
  ).toBeVisible();
  state.isOpen = true;
  state.now = state.opening;
  await page.route("**/api/missions/me/confirmations", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/missions/players", (route) =>
    route.fulfill({ json: [] }),
  );
  await expect(page).toHaveURL("/missions", { timeout: 10_000 });
  await expect(
    page.getByRole("button", { name: "Obtenir ma première mission" }),
  ).toBeVisible();
});
test("a failed opening check reveals nothing and can be retried", async ({
  page,
}) => {
  const state = await setup(page);
  state.status = 503;
  await page.goto("/coffre");
  await expect(page.getByRole("alert")).toHaveText(
    "Impossible de vérifier l’ouverture pour le moment.",
  );
  expect(state.featureReads).toEqual([]);
  state.status = 200;
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(page).toHaveURL("/a-ce-soir?destination=coffre");
});
