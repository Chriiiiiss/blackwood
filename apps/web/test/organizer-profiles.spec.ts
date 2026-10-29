import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { mockUnknownGuest } from "./guest-fixtures";

async function setup(page: Page) {
  await mockUnknownGuest(page);
  const state = {
    profiles: [
      {
        id: "151597a3-d728-414d-9b74-717386c10b01",
        firstName: "Alex",
        role: "main",
        accessEnabled: true,
        codeEnabled: true,
        relatedFirstName: null,
      },
      {
        id: "61601657-b814-4a20-af61-8cfe57a679a3",
        firstName: "Alex",
        role: "companion",
        accessEnabled: true,
        codeEnabled: false,
        relatedFirstName: "Sam",
      },
    ],
    deletions: [] as string[],
    status: 204,
    hold: undefined as Promise<void> | undefined,
  };
  await page.route("**/api/organizer/**", async (route) => {
    const request = route.request();
    expect(request.headers()["x-organizer-request"]).toBe("1");
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/session"))
      return route.fulfill({
        json: {
          authenticated: true,
          expiresAt: new Date(Date.now() + 604800000).toISOString(),
          idleExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      });
    if (path.endsWith("/hub-settings"))
      return route.fulfill({ json: { hubEnabled: true } });
    if (path.endsWith("/profile-access"))
      return route.fulfill({ json: state.profiles });
    if (request.method() === "DELETE" && path.includes("/profiles/")) {
      const id = path.split("/").at(-1) ?? "";
      state.deletions.push(id);
      await state.hold;
      if (state.status === 204)
        state.profiles = state.profiles.filter((profile) => profile.id !== id);
      return route.fulfill({
        status: state.status,
        ...(state.status === 204
          ? {}
          : { json: { code: "PROFILE_UNAVAILABLE" } }),
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/organisateur/acces");
  await expect(
    page.getByRole("heading", { name: "Les invités", exact: true }),
  ).toBeVisible();
  return state;
}

test("organizer searches namesakes, cancels removal and confirms exactly one targeted profile", async ({
  page,
}) => {
  const state = await setup(page);
  const search = page.getByLabel("Rechercher un invité");
  await search.fill("absent");
  await expect(
    page.getByText("Aucun invité ne correspond à ta recherche."),
  ).toBeVisible();
  await search.fill(" aLEX ");
  const cards = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: "Alex", exact: true }) });
  await expect(cards).toHaveCount(2);
  const companion = cards.filter({ hasText: "Accompagne Sam" });
  const trigger = companion.getByRole("button", {
    name: "Supprimer le profil",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "Supprimer le profil de Alex ?",
  });
  await expect(dialog).toContainText(
    "Sam pourra inviter un autre +1 avec un nouveau lien.",
  );
  await expect(dialog).toContainText(
    "Ses souvenirs et leurs photos resteront dans les Coffres.",
  );
  expect(state.deletions).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog).toContainText("61601657");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  let release = () => {};
  state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const confirm = dialog.getByRole("button", {
    name: "Confirmer la suppression",
  });
  await confirm.click();
  await expect(
    dialog.getByRole("button", { name: "Suppression…" }),
  ).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Annuler" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(state.deletions).toEqual(["61601657-b814-4a20-af61-8cfe57a679a3"]);
  release();
  await expect(dialog).toHaveCount(0);
  await expect(cards).toHaveCount(1);
  await expect(
    page.getByText("Le profil de Alex a été supprimé.", { exact: true }),
  ).toBeVisible();
  await expect(search).toHaveValue(" aLEX ");
  await page.reload();
  await expect(cards).toHaveCount(1);
});

test("failed removal stays in the confirmation and mobile actions keep matching widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const state = await setup(page);
  const main = page
    .getByRole("listitem")
    .filter({ hasText: "Invité principal" });
  const buttons = await main
    .getByRole("button")
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().width),
    );
  expect(new Set(buttons.map(Math.round)).size).toBe(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await main
    .getByRole("button", { name: "Supprimer le profil", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "Sa réponse aux invitations sera retirée de la liste et des totaux.",
  );
  state.status = 503;
  await dialog
    .getByRole("button", { name: "Confirmer la suppression" })
    .click();
  await expect(
    dialog.getByText("Impossible de confirmer la suppression. Réessaie."),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Confirmer la suppression" }),
  ).toBeEnabled();
  expect(state.profiles).toHaveLength(2);
  state.status = 204;
  await dialog
    .getByRole("button", { name: "Confirmer la suppression" })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Alex", exact: true }),
  ).toHaveCount(1);
});
