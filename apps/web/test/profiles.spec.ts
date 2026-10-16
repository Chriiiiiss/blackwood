import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import type {
  GuestAccess,
  GuestProfile,
} from "../src/features/guest-access/requests";

const main: GuestProfile = {
  id: "151597a3-d728-414d-9b74-717386c10b01",
  firstName: "Alex",
  avatarMediaId: null,
  hasInvitationResponse: true,
  role: "main",
};
const token = "A".repeat(43);
const companionPath = `/companions/${main.id}#token=${token}`;
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=",
  "base64",
);

async function mock(page: Page, profile: GuestProfile | null = { ...main }) {
  const state = {
    access: { hubEnabled: true, profile } as GuestAccess,
    nameStatus: 200,
    avatarStatus: 200,
    claimStatus: 200,
    claimCode: "",
    claims: 0,
    uploads: 0,
    patches: 0,
    issues: 0,
    companion: {
      eligible: true,
      companion: null as { firstName: string } | null,
    },
  };
  await page.route("**/api/guest-access", (route) =>
    route.fulfill({ json: state.access }),
  );
  await page.route("**/api/profiles/me/companion", (route) =>
    route.fulfill({ json: state.companion }),
  );
  await page.route("**/api/profiles/me", (route) => {
    state.patches++;
    expect(route.request().headers()["x-guest-request"]).toBe("1");
    if (state.nameStatus !== 200)
      return route.fulfill({ status: state.nameStatus, json: {} });
    if (state.access.profile)
      state.access.profile.firstName = route.request().postDataJSON().firstName;
    return route.fulfill({ json: state.access.profile });
  });
  await page.route("**/api/profiles/me/avatar", (route) => {
    expect(route.request().headers()["x-guest-request"]).toBe("1");
    if (route.request().method() === "PUT") {
      state.uploads++;
      expect(route.request().headers()["content-type"]).toContain(
        "multipart/form-data",
      );
      expect(route.request().postDataBuffer()?.toString()).toContain(
        'name="file"',
      );
      if (state.avatarStatus !== 200)
        return route.fulfill({
          status: state.avatarStatus,
          json: { code: "INVALID_IMAGE" },
        });
    }
    if (state.access.profile)
      state.access.profile.avatarMediaId =
        route.request().method() === "DELETE"
          ? null
          : "241597a3-d728-414d-9b74-717386c10b01";
    return route.fulfill({ json: state.access.profile });
  });
  await page.route("**/api/media/*/image", (route) =>
    route.fulfill({ body: pixel, contentType: "image/png" }),
  );
  await page.route("**/api/profiles/me/companion-invitations", (route) => {
    state.issues++;
    return route.fulfill({
      json: {
        mainProfileId: main.id,
        token,
        expiresAt: "2026-10-23T12:00:00Z",
      },
    });
  });
  await page.route("**/api/companion-invitations/claim", (route) => {
    state.claims++;
    expect(route.request().postDataJSON()).toEqual({
      mainProfileId: main.id,
      token,
      firstName: "Sam",
    });
    if (state.claimStatus !== 200)
      return route.fulfill({
        status: state.claimStatus,
        json: { code: state.claimCode },
      });
    state.access.profile = {
      ...main,
      id: "341597a3-d728-414d-9b74-717386c10b01",
      firstName: "Sam",
      role: "companion",
      hasInvitationResponse: false,
    };
    return route.fulfill({ json: state.access });
  });
  return state;
}

test("profile edits preserve a failed draft, update the hub and survive reload", async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto("/");
  await page.getByRole("link", { name: /Mon profil/ }).click();
  await expect(page.getByLabel("Ton prénom", { exact: true })).toHaveValue(
    "Alex",
  );
  state.nameStatus = 500;
  await page.getByLabel("Ton prénom", { exact: true }).fill(" Morgan ");
  await page.getByRole("button", { name: "Enregistrer mon prénom" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Ton prénom", { exact: true })).toHaveValue(
    " Morgan ",
  );
  state.nameStatus = 200;
  await page.getByRole("button", { name: "Enregistrer mon prénom" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Ton prénom a été enregistré",
  );
  await page.getByRole("link", { name: "← Retour au hub" }).click();
  await expect(
    page.getByRole("heading", { name: "Bienvenue, Morgan." }),
  ).toBeVisible();
  await page.goto("/profiles");
  await expect(page.getByLabel("Ton prénom", { exact: true })).toHaveValue(
    "Morgan",
  );
  await page.getByLabel("Ton prénom", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Enregistrer mon prénom" }).click();
  await expect(page.getByRole("alert")).toContainText("entre 1 et 50");
  expect(state.patches).toBe(2);
});

test("avatar preview can be cropped, retried, replaced, cancelled and deleted", async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto("/profiles");
  await expect(
    page.getByRole("img", { name: "Avatar par défaut" }),
  ).toBeVisible();
  await page.getByLabel("Choisir une photo").setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: pixel,
  });
  await expect(
    page.getByRole("img", { name: "Aperçu du cadrage" }),
  ).toBeVisible();
  await page.getByLabel("Zoom", { exact: true }).fill("2");
  state.avatarStatus = 400;
  await page.getByRole("button", { name: "Enregistrer ma photo" }).click();
  await expect(page.getByRole("alert")).toContainText("illisible");
  await expect(
    page.getByRole("img", { name: "Aperçu du cadrage" }),
  ).toBeVisible();
  state.avatarStatus = 200;
  await page.getByRole("button", { name: "Enregistrer ma photo" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Ta photo a été enregistrée",
  );
  await expect(
    page.getByRole("img", { name: "Ton avatar actuel" }),
  ).toBeVisible();
  await page.getByLabel("Remplacer ma photo").setInputFiles({
    name: "replacement.png",
    mimeType: "image/png",
    buffer: pixel,
  });
  await page.getByRole("button", { name: "Annuler le choix" }).click();
  expect(state.uploads).toBe(2);
  await expect(
    page.getByRole("img", { name: "Aperçu du cadrage" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Supprimer ma photo" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Ta photo a été supprimée",
  );
  await expect(
    page.getByRole("img", { name: "Avatar par défaut" }),
  ).toBeVisible();
});

test("browser-unsupported images offer a centered server crop without blocking HEIC upload", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/profiles");
  await page.getByLabel("Choisir une photo").setInputFiles({
    name: "phone.heic",
    mimeType: "image/heic",
    buffer: Buffer.from("fictitious unsupported browser image"),
  });
  await expect(page.getByRole("status")).toContainText("cadrage carré centré");
  await expect(
    page.getByRole("button", { name: "Enregistrer ma photo" }),
  ).toBeEnabled();
});

test("companion links use a fragment and existing companions prevent another creation", async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto("/profiles");
  await page.getByRole("button", { name: "Créer le lien pour mon +1" }).click();
  await expect(page.getByLabel("Lien à transmettre à ton +1")).toHaveValue(
    new RegExp(`/companions/${main.id}#token=${token}$`),
  );
  await page.getByRole("button", { name: "Masquer le lien" }).click();
  await expect(page.getByLabel("Lien à transmettre à ton +1")).toHaveCount(0);
  state.companion = { eligible: false, companion: { firstName: "Sam" } };
  await page.reload();
  await expect(page.getByText(/Sam a déjà son propre profil/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Créer le lien/ })).toHaveCount(
    0,
  );
  expect(state.issues).toBe(1);
});

test("ineligible main profiles edit invitations and companions cannot invite another companion", async ({
  page,
}) => {
  const state = await mock(page);
  state.companion.eligible = false;
  await page.goto("/profiles");
  await expect(page.getByText(/indique que tu viens à deux/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Créer le lien/ })).toHaveCount(
    0,
  );
  state.access.profile = {
    ...main,
    role: "companion",
    hasInvitationResponse: false,
  };
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Mon profil", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ton +1" })).toHaveCount(0);
});

test("a companion creates an independent profile, can add an avatar and reload safely", async ({
  page,
}) => {
  const state = await mock(page, null);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(companionPath);
  await page.getByLabel("Ton prénom", { exact: true }).fill(" Sam ");
  await page.getByRole("button", { name: "Créer mon profil" }).dblclick();
  await expect(page.getByRole("status")).toContainText(
    "Ton profil et ton accès personnel sont créés",
  );
  await expect(page.getByLabel("Choisir une photo")).toBeVisible();
  expect(state.claims).toBe(1);
  expect(requests.some((url) => url.includes(token))).toBe(false);
  expect(new URL(page.url()).hash).toBe("");
  await page.reload();
  await expect(page.getByText(/Tu es déjà reconnu, Sam/)).toBeVisible();
  await page.getByRole("link", { name: "Continuer avec mon profil" }).click();
  await expect(page.getByLabel("Ton prénom", { exact: true })).toHaveValue(
    "Sam",
  );
  expect(state.claims).toBe(1);
  expect(requests.some((url) => url.includes("invitation-responses"))).toBe(
    false,
  );
});

test("invalid, expired and already-claimed links explain recovery without a new invitation", async ({
  page,
}) => {
  const state = await mock(page, null);
  await page.goto(`/companions/${main.id}`);
  await expect(page.getByRole("alert")).toContainText("Ce lien est invalide");
  for (const [status, code, text] of [
    [404, "COMPANION_INVITATION_NOT_FOUND", "invalide ou expiré"],
    [409, "COMPANION_ALREADY_CLAIMED", "déjà été utilisé"],
    [500, "", "Impossible d’enregistrer"],
  ] as const) {
    state.claimStatus = status;
    state.claimCode = code;
    await page.goto(companionPath);
    await page.getByLabel("Ton prénom", { exact: true }).fill("Sam");
    await page.getByRole("button", { name: "Créer mon profil" }).click();
    await expect(page.getByRole("alert")).toContainText(text);
    await expect(page.getByLabel("Ton prénom", { exact: true })).toHaveValue(
      "Sam",
    );
    await expect(
      page.getByRole("link", { name: "Retrouver mon profil par code" }),
    ).toHaveAttribute("href", "/login");
  }
});

test("recognized browsers and closed hubs never silently create a companion", async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto(companionPath);
  await expect(page.getByText(/Tu es déjà reconnu, Alex/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Créer mon profil" }),
  ).toHaveCount(0);
  state.access.profile = null;
  state.access.hubEnabled = false;
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Le hub est fermé");
  await expect(
    page.getByRole("button", { name: "Créer mon profil" }),
  ).toHaveCount(0);
  expect(state.claims).toBe(0);
});

test("profile and companion forms stay accessible on narrow screens", async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto("/profiles");
  await expect(
    page.getByRole("button", { name: "Créer le lien pour mon +1" }),
  ).toBeVisible();
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
  state.access.profile = null;
  await page.goto(companionPath);
  await expect(
    page.getByRole("button", { name: "Créer mon profil" }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
