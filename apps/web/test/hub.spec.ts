import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import type {
  GuestAccess,
  GuestProfile,
} from "../src/features/guest-access/requests";

const responseId = "61601657-b814-4a20-af61-8cfe57a679a3";
const storageKey = "blackwood.invitation-response-id";
const profile: GuestProfile = {
  id: "151597a3-d728-414d-9b74-717386c10b01",
  firstName: "Alex",
  avatarMediaId: null,
  hasInvitationResponse: true,
  role: "main",
};
const invitation = {
  firstName: "Alex",
  attendance: "to_confirm",
  plusOne: true,
  ideas: "A haunted lobby!",
};

async function mockAccess(page: Page, initial: GuestAccess) {
  const state = {
    access: initial,
    restoredProfile: profile,
    restoreStatus: 200,
    accessStatus: 200,
    restores: 0,
    cookieReads: 0,
    cookieWrites: 0,
    legacyRequests: 0,
    response: { ...invitation },
  };
  await page.route("**/api/guest-access", (route) => {
    expect(route.request().headers()["x-guest-request"]).toBe("1");
    return route.fulfill({
      status: state.accessStatus,
      json: state.accessStatus === 200 ? state.access : {},
    });
  });
  await page.route("**/api/guest-access/restore", (route) => {
    state.restores++;
    expect(route.request().headers()["x-guest-request"]).toBe("1");
    expect(route.request().postDataJSON()).toEqual({ responseId });
    if (state.restoreStatus === 200)
      state.access.profile = { ...state.restoredProfile };
    return route.fulfill({
      status: state.restoreStatus,
      json: state.restoreStatus === 200 ? state.access : {},
    });
  });
  await page.route("**/api/profiles/me/invitation-response", (route) => {
    expect(route.request().headers()["x-guest-request"]).toBe("1");
    if (route.request().method() === "PUT") {
      state.cookieWrites++;
      state.response = { ...state.response, ...route.request().postDataJSON() };
      if (state.access.profile)
        state.access.profile.firstName = state.response.firstName;
    } else state.cookieReads++;
    return route.fulfill({ json: state.response });
  });
  await page.route("**/api/invitation-responses/*", (route) => {
    state.legacyRequests++;
    return route.fulfill({ json: { ...state.response, id: responseId } });
  });
  return state;
}

test("identified guests get an accessible mobile hub and unavailable apps stay explicit", async ({
  page,
}) => {
  await mockAccess(page, { hubEnabled: true, profile: { ...profile } });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Bienvenue, Alex." }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toHaveCount(
    0,
  );
  await expect(page.getByText("À venir · indisponible")).toHaveCount(2);
  await expect(
    page.getByRole("link", { name: /Coffre|Mon profil|connexion/i }),
  ).toHaveCount(0);
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
  await page.reload();
  await page.getByRole("link", { name: /Mon invitation/ }).click();
  await expect(page).toHaveURL("/invitation");
  await expect(
    page.getByRole("button", { name: "Modifier ma réponse" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "← Retour au hub" }).click();
  await expect(
    page.getByRole("heading", { name: "Bienvenue, Alex." }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "Modifier ma réponse" }),
  ).toBeVisible();
});

test("original browser restores automatically and cookie identity takes precedence over legacy storage", async ({
  page,
}) => {
  await page.addInitScript(
    ({ storageKey, responseId }) =>
      localStorage.setItem(storageKey, responseId),
    { storageKey, responseId },
  );
  const state = await mockAccess(page, { hubEnabled: true, profile: null });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Bienvenue, Alex." }),
  ).toBeVisible();
  expect(state.restores).toBe(1);
  expect(state.legacyRequests).toBe(0);
  state.access.profile = { ...profile, firstName: "Morgan" };
  await page.goto("/invitation");
  await expect(page.getByText("Morgan", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Modifier ma réponse" }).click();
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toHaveValue(
    "Morgan",
  );
  await expect(
    page.getByRole("textbox", { name: "Une idée pour la soirée ?" }),
  ).toHaveValue(invitation.ideas);
  await expect(
    page.getByRole("radio", { name: "À confirmer", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "Je viens à deux", exact: true }),
  ).toBeChecked();
  await page.getByRole("textbox", { name: "Ton prénom" }).fill("Sam");
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(
    page.getByText("Ta réponse a bien été mise à jour.", { exact: true }),
  ).toBeVisible();
  expect(state.cookieWrites).toBe(1);
  expect(state.restores).toBe(1);
  expect(state.legacyRequests).toBe(0);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBe(responseId);
});

test("closed hub redirects profile routes while preserving access and invitation editing", async ({
  page,
}) => {
  const state = await mockAccess(page, {
    hubEnabled: false,
    profile: { ...profile },
  });
  await page.goto("/profiles");
  await expect(page).toHaveURL("/invitation");
  await page.getByRole("button", { name: "Modifier ma réponse" }).click();
  await page.getByRole("textbox", { name: "Ton prénom" }).fill("Morgan");
  await page.getByRole("link", { name: "Accueil — Hôtel Blackwood" }).click();
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toHaveValue(
    "Morgan",
  );
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  expect(state.access.profile?.id).toBe(profile.id);
  await expect(
    page.getByText("Ta réponse a bien été mise à jour.", { exact: true }),
  ).toBeVisible();
  state.access.hubEnabled = true;
  await page.goto("/profiles");
  await expect(
    page.getByText(
      "La modification du profil n’est pas encore disponible. Ton accès est bien conservé.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

test("companions without a personal response keep access without a personal form", async ({
  page,
}) => {
  const state = await mockAccess(page, {
    hubEnabled: true,
    profile: { ...profile, role: "companion", hasInvitationResponse: false },
  });
  await page.goto("/");
  await page.getByRole("link", { name: /Mon invitation/ }).click();
  await expect(
    page.getByText(
      "Tu es reconnu en tant qu’accompagnant. Tu n’as pas de réponse personnelle à remplir.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toHaveCount(
    0,
  );
  state.access.hubEnabled = false;
  await page.goto("/");
  await expect(page).toHaveURL("/invitation");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  expect(state.cookieReads).toBe(0);
  expect(state.legacyRequests).toBe(0);
});

test("restore failures block duplicate registration and retry the original identifier", async ({
  page,
}) => {
  await page.addInitScript(
    ({ storageKey, responseId }) =>
      localStorage.setItem(storageKey, responseId),
    { storageKey, responseId },
  );
  const state = await mockAccess(page, { hubEnabled: true, profile: null });
  state.restoreStatus = 500;
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "Impossible de retrouver ton accès",
  );
  await expect(page.getByRole("textbox")).toHaveCount(0);
  expect(state.legacyRequests).toBe(0);
  state.restoreStatus = 200;
  await page.getByRole("button", { name: "Réessayer" }).click();
  await expect(
    page.getByRole("heading", { name: "Bienvenue, Alex." }),
  ).toBeVisible();
  expect(state.restores).toBe(2);
});

test("a missing legacy response preserves its UUID and explains unavailable code recovery", async ({
  page,
}) => {
  await page.addInitScript(
    ({ storageKey, responseId }) =>
      localStorage.setItem(storageKey, responseId),
    { storageKey, responseId },
  );
  const state = await mockAccess(page, { hubEnabled: true, profile: null });
  state.restoreStatus = 404;
  await page.route("**/api/invitation-responses/*", (route) =>
    route.fulfill({ status: 404, json: {} }),
  );
  await page.goto("/");
  await expect(page).toHaveURL("/invitation");
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toBeVisible();
  await expect(
    page.getByText(/La connexion par code personnel sera bientôt disponible/),
  ).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBe(responseId);
  await expect(page.getByRole("link", { name: /connexion/i })).toHaveCount(0);
});

test("a new save establishes guest access without changing creation confirmation", async ({
  page,
}) => {
  const state = await mockAccess(page, { hubEnabled: true, profile: null });
  await page.route("**/api/invitation-responses/*", (route) =>
    route.fulfill({
      json: {
        ...route.request().postDataJSON(),
        id: route.request().url().split("/").at(-1),
      },
    }),
  );
  await page.route("**/api/guest-access/restore", (route) => {
    state.access.profile = { ...profile, firstName: "Sam" };
    return route.fulfill({ json: state.access });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Ton prénom" }).fill("Sam");
  await page
    .getByRole("group", { name: "Tu viens ?", exact: true })
    .getByRole("radio", { name: "Non", exact: true })
    .check();
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(
    page.getByText("Ta réponse a bien été enregistrée. Merci !", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "← Retour au hub" }).click();
  await expect(
    page.getByRole("heading", { name: "Bienvenue, Sam." }),
  ).toBeVisible();
  expect(state.cookieReads).toBe(0);
});

test("returning to Invitations uses the current profile name with cached attendance and ideas", async ({
  page,
}) => {
  const state = await mockAccess(page, {
    hubEnabled: true,
    profile: { ...profile },
  });
  await page.goto("/invitation");
  await expect(page.getByText("Alex", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "← Retour au hub" }).click();
  await expect(
    page.getByRole("heading", { name: "Bienvenue, Alex." }),
  ).toBeVisible();
  state.access.profile = { ...profile, firstName: "Morgan" };
  await page.getByRole("link", { name: /Mon invitation/ }).click();
  await expect(page.getByText("Morgan", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Modifier ma réponse" }).click();
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toHaveValue(
    "Morgan",
  );
  await expect(
    page.getByRole("textbox", { name: "Une idée pour la soirée ?" }),
  ).toHaveValue(invitation.ideas);
  await expect(
    page.getByRole("radio", { name: "À confirmer", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "Je viens à deux", exact: true }),
  ).toBeChecked();
  expect(state.cookieWrites).toBe(0);
});

test("a failed access exchange after saving keeps the saved response editable", async ({
  page,
}) => {
  await mockAccess(page, { hubEnabled: true, profile: null });
  await page.route("**/api/guest-access/restore", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  let writes = 0;
  await page.route("**/api/invitation-responses/*", (route) => {
    writes++;
    return route.fulfill({
      json: {
        ...route.request().postDataJSON(),
        id: route.request().url().split("/").at(-1),
      },
    });
  });
  await page.goto("/invitation");
  await page.getByRole("textbox", { name: "Ton prénom" }).fill("Sam");
  await page
    .getByRole("group", { name: "Tu viens ?", exact: true })
    .getByRole("radio", { name: "Non", exact: true })
    .check();
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(
    page.getByText("Ta réponse a bien été enregistrée. Merci !", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Modifier ma réponse" }).click();
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toHaveValue(
    "Sam",
  );
  expect(writes).toBe(1);
});
