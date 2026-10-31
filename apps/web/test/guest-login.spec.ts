import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const profile = {
  id: "151597a3-d728-414d-9b74-717386c10b01",
  firstName: "Alex",
  role: "main",
  avatarMediaId: null,
  hasInvitationResponse: true,
};
const code = "0042";

for (const hubEnabled of [true, false]) {
  test(`code login recovers the existing response with hub ${hubEnabled ? "open" : "closed"}`, async ({
    page,
  }) => {
    let access = { hubEnabled, profile: null as typeof profile | null };
    let writes = 0;
    await page.route("**/api/guest-access", (route) =>
      route.fulfill({ json: access }),
    );
    await page.route("**/api/guest-access/login", async (route) => {
      writes++;
      expect(route.request().headers()["x-guest-request"]).toBe("1");
      expect(route.request().postDataJSON()).toEqual({ code });
      await new Promise((resolve) => setTimeout(resolve, 100));
      access = { hubEnabled, profile };
      return route.fulfill({ json: access });
    });
    await page.route("**/api/profiles/me/invitation-response", (route) =>
      route.fulfill({
        json: {
          firstName: "Alex",
          attendance: "yes",
          plusOne: false,
          ideas: "Original idea",
        },
      }),
    );
    await page.goto("/login");
    await expect(page.getByLabel("Ton code personnel")).toHaveAttribute(
      "inputmode",
      "numeric",
    );
    await page.getByLabel("Ton code personnel").fill(code);
    await page
      .getByRole("button", { name: "Retrouver mon profil" })
      .dblclick({ delay: 5 });
    await expect(page).toHaveURL(hubEnabled ? "/" : "/invitation");
    expect(writes).toBe(1);
    if (hubEnabled)
      await expect(
        page.getByRole("heading", { name: "Bienvenue, Alex." }),
      ).toBeVisible();
    else
      await expect(
        page.getByRole("button", { name: "Modifier ma réponse" }),
      ).toBeVisible();
    expect(
      await page.evaluate(() => JSON.stringify(localStorage)),
    ).not.toContain(code);
    expect(page.url()).not.toContain(code);
  });
}

test("login explains invalid codes, rate limits and failures without retaining the secret", async ({
  page,
}) => {
  await page.route("**/api/guest-access", (route) =>
    route.fulfill({ json: { hubEnabled: true, profile: null } }),
  );
  let status = 401;
  let calls = 0;
  await page.route("**/api/guest-access/login", (route) => {
    calls++;
    return route.fulfill({
      status,
      headers: { "Retry-After": "125" },
      json: {
        code: status === 401 ? "INVALID_GUEST_CODE" : "LOGIN_RATE_LIMITED",
      },
    });
  });
  await page.goto("/login");
  for (const [nextStatus, message] of [
    [401, "incorrect ou désactivé"],
    [429, "3 minute(s)"],
    [500, "indisponible"],
  ] as const) {
    status = nextStatus;
    await page.getByLabel("Ton code personnel").fill(code);
    await page.getByRole("button", { name: "Retrouver mon profil" }).click();
    await expect(page.getByRole("alert")).toContainText(message);
    await expect(page.getByLabel("Ton code personnel")).toHaveValue("");
  }
  expect(calls).toBe(3);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("recognized browsers continue with their existing identity without a login attempt", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/guest-access", (route) =>
    route.fulfill({ json: { hubEnabled: true, profile } }),
  );
  await page.route("**/api/guest-access/login", (route) => {
    calls++;
    return route.abort();
  });
  await page.goto("/login");
  await expect(page.getByText(/Tu es déjà reconnu, Alex/)).toBeVisible();
  await expect(page.getByLabel("Ton code personnel")).toHaveCount(0);
  await page.getByRole("link", { name: "Continuer", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Bienvenue, Alex." }),
  ).toBeVisible();
  expect(calls).toBe(0);
});

test("disabled legacy access can reach login without creating another invitation", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "blackwood.invitation-response-id",
      "61601657-b814-4a20-af61-8cfe57a679a3",
    ),
  );
  await page.route("**/api/guest-access", (route) =>
    route.fulfill({ json: { hubEnabled: true, profile: null } }),
  );
  await page.route("**/api/guest-access/restore", (route) =>
    route.fulfill({ status: 401, json: { code: "PROFILE_ACCESS_DISABLED" } }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Ton prénom")).toHaveCount(0);
  await page
    .getByRole("link", { name: "Retrouver mon profil par code" })
    .click();
  await expect(page.getByLabel("Ton code personnel")).toBeVisible();
});
