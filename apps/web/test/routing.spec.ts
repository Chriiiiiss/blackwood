import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockUnknownGuest } from "./guest-fixtures";

test.beforeEach(async ({ page }) => mockUnknownGuest(page));

test("unknown URLs survive reload and link back without a document reload", async ({
  page,
}) => {
  await page.goto("/chambre/inconnue");
  const heading = page.getByRole("heading", {
    name: "Cette chambre est introuvable.",
  });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(heading).toBeVisible();
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations).toEqual([]);

  await page.evaluate(() => {
    document.body.dataset.navigationMarker = "same-document";
  });
  await page.getByRole("link", { name: "Retour à l’invitation" }).click();
  await expect(page).toHaveURL("/invitation");
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toBeVisible();
  expect(
    await page.evaluate(() => document.body.dataset.navigationMarker),
  ).toBe("same-document");
  await page.goBack();
  await expect(heading).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toBeVisible();
});

test("home and skip links preserve an unsaved invitation draft", async ({
  page,
}) => {
  await page.goto("/");
  const name = page.getByRole("textbox", { name: "Ton prénom" });
  await name.fill("Alex");
  await page.getByRole("link", { name: "Accueil — Hôtel Blackwood" }).click();
  await expect(name).toHaveValue("Alex");
  const skipLink = page.getByRole("link", { name: "Aller au formulaire" });
  await skipLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/invitation#guest-register");
  await expect(page.locator("#guest-register")).toBeFocused();
  await expect(name).toHaveValue("Alex");
});
