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
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
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
  await expect(
    page.getByRole("button", { name: "Enregistrer mon prénom" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Modifier mon prénom" }).click();
  await expect(page.getByLabel("Ton prénom", { exact: true })).toBeFocused();
  state.nameStatus = 500;
  await page.getByLabel("Ton prénom", { exact: true }).fill(" Morgan ");
  await page.getByRole("button", { name: "Enregistrer mon prénom" }).click();
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Impossible d’enregistrer",
  );
  await expect(page.getByLabel("Ton prénom", { exact: true })).toHaveValue(
    " Morgan ",
  );
  state.nameStatus = 200;
  await page.getByRole("button", { name: "Enregistrer mon prénom" }).click();
  await expect(page.locator("[data-sonner-toast]")).toContainText(
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
  await page.getByRole("button", { name: "Agrandir", exact: true }).click();
  state.avatarStatus = 400;
  await page.getByRole("button", { name: "Enregistrer ma photo" }).click();
  await expect(
    page.getByRole("dialog").locator("[data-sonner-toast]"),
  ).toContainText("illisible");
  await expect(
    page.getByRole("img", { name: "Aperçu du cadrage" }),
  ).toBeVisible();
  state.avatarStatus = 200;
  await page.getByRole("button", { name: "Enregistrer ma photo" }).click();
  await expect(page.locator("[data-sonner-toast]")).toContainText(
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
  await expect(page.locator("[data-sonner-toast]")).toContainText(
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
  // The incoming toast overlaps these mobile actions during its animation.
  const notification = page.locator("[data-sonner-toast]").filter({
    hasText: "Le lien pour ton +1 est prêt à être transmis.",
  });
  await expect(notification).toBeVisible();
  await notification
    .getByRole("button", { name: "Fermer la notification" })
    .click();
  await expect(notification).toBeHidden();
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
  await expect(page.locator("[data-sonner-toast]")).toContainText(
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
    await expect(page.locator("[data-sonner-toast]")).toContainText(text);
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

async function openCrop(page: Page) {
  await page.goto("/profiles");
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 800;
    const context = canvas.getContext("2d");
    if (!context) throw Error("Canvas unavailable.");
    context.fillStyle = "#69439a";
    context.fillRect(0, 0, 1200, 800);
    context.fillStyle = "#ffb36b";
    context.fillRect(0, 0, 400, 800);
    return canvas.toDataURL("image/png").split(",")[1] ?? "";
  });
  await page.getByLabel("Choisir une photo").focus();
  await page.getByLabel("Choisir une photo").setInputFiles({
    name: "portrait.png",
    mimeType: "image/png",
    buffer: Buffer.from(encoded, "base64"),
  });
  const frame = page.getByRole("button", {
    name: "Déplacer la photo",
    exact: true,
  });
  await expect(frame).toBeEnabled();
  return frame;
}

test("crop modal supports mouse dragging, wheel zoom, edge clamping and keyboard controls", async ({
  page,
  isMobile,
}) => {
  await mock(page);
  const frame = await openCrop(page);
  await expect(
    page.getByRole("dialog", { name: "Cadre ta photo" }),
  ).toBeVisible();
  await expect(page.getByRole("slider")).toHaveCount(0);
  const bounds = await frame.boundingBox();
  if (!bounds) throw Error("Missing crop bounds.");
  await frame.hover();
  if (isMobile) await frame.press("+");
  else await page.mouse.wheel(0, -300);
  await expect(page.getByLabel("Niveau de zoom")).not.toHaveText("100 %");
  const before = await frame.getByRole("img").getAttribute("style");
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 40,
    bounds.y + bounds.height / 2 + 25,
    { steps: 5 },
  );
  await page.mouse.up();
  expect(await frame.getByRole("img").getAttribute("style")).not.toBe(before);
  await frame.press("ArrowLeft");
  await frame.press("+");
  await page.getByRole("button", { name: "Recentrer", exact: true }).click();
  await expect(page.getByLabel("Niveau de zoom")).toHaveText("100 %");
  await frame.focus();
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () =>
          document.activeElement === document.body ||
          !!document.activeElement?.closest("dialog"),
      ),
    ).toBe(true);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByRole("button", { name: "Fermer", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Choisir une photo")).toBeFocused();
  await expect(
    page.getByRole("img", { name: "Avatar par défaut" }),
  ).toBeVisible();
});

test("two touch pointers pinch and drag without moving the page or exposing empty crop edges", async ({
  page,
}) => {
  await mock(page);
  const frame = await openCrop(page);
  const bounds = await frame.boundingBox();
  if (!bounds) throw Error("Missing crop bounds.");
  // Synthetic pointer events have no browser pointer capture; mouse capture is exercised above.
  await frame.evaluate((element) => {
    element.setPointerCapture = () => {};
  });
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await frame.dispatchEvent("pointerdown", {
    pointerId: 31,
    pointerType: "touch",
    clientX: x - 30,
    clientY: y,
  });
  await frame.dispatchEvent("pointerdown", {
    pointerId: 32,
    pointerType: "touch",
    clientX: x + 30,
    clientY: y,
  });
  await frame.dispatchEvent("pointermove", {
    pointerId: 31,
    pointerType: "touch",
    clientX: x - 60,
    clientY: y,
  });
  await frame.dispatchEvent("pointermove", {
    pointerId: 32,
    pointerType: "touch",
    clientX: x + 60,
    clientY: y,
  });
  await expect(page.getByLabel("Niveau de zoom")).toHaveText("200 %");
  await frame.dispatchEvent("pointercancel", {
    pointerId: 32,
    pointerType: "touch",
  });
  await frame.dispatchEvent("pointermove", {
    pointerId: 31,
    pointerType: "touch",
    clientX: x + 2000,
    clientY: y + 2000,
  });
  await frame.dispatchEvent("pointerup", {
    pointerId: 31,
    pointerType: "touch",
  });
  const crop = await frame.getByRole("img").evaluate((image) => ({
    left: Number.parseFloat(image.style.left),
    top: Number.parseFloat(image.style.top),
    width: Number.parseFloat(image.style.width),
    height: Number.parseFloat(image.style.height),
  }));
  expect(crop.left).toBeLessThanOrEqual(0);
  expect(crop.top).toBeLessThanOrEqual(0);
  expect(crop.left + crop.width).toBeGreaterThanOrEqual(100);
  expect(crop.top + crop.height).toBeGreaterThanOrEqual(100);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(
    "hidden",
  );
  await page.getByRole("button", { name: "Enregistrer ma photo" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Ta photo a été enregistrée.",
  );
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
});

test("phone capture remains available without getUserMedia on an HTTP development origin", async ({
  page,
}) => {
  await mock(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    }),
  );
  await page.goto("/profiles");
  const chooserPromise = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Prendre une photo", exact: true })
    .click();
  const chooser = await chooserPromise;
  expect(await chooser.element().getAttribute("capture")).toBe("user");
  await chooser.setFiles({
    name: "camera.png",
    mimeType: "image/png",
    buffer: pixel,
  });
  await expect(
    page.getByRole("dialog", { name: "Cadre ta photo" }),
  ).toBeVisible();
});

test("camera refusal is shown as a toast inside the modal and leaves file selection available", async ({
  page,
}) => {
  await mock(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException("Denied", "NotAllowedError");
        },
      },
    }),
  );
  await page.goto("/profiles");
  await page
    .getByRole("button", { name: "Prendre une photo", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").locator("[data-sonner-toast]"),
  ).toContainText("L’accès à la caméra a été refusé");
  const dialog = page.getByRole("dialog");
  const notification = dialog.locator("[data-sonner-toast]");
  const dialogBounds = await dialog.boundingBox();
  const toastBounds = await notification.boundingBox();
  if (!dialogBounds || !toastBounds) throw Error("Missing modal notification.");
  expect(toastBounds.x).toBeGreaterThanOrEqual(dialogBounds.x);
  expect(toastBounds.x + toastBounds.width).toBeLessThanOrEqual(
    dialogBounds.x + dialogBounds.width,
  );
  await dialog
    .getByRole("button", { name: "Fermer la notification", exact: true })
    .click();
  await expect(notification).not.toBeVisible();
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Choisir une photo")).toBeVisible();
});

test("a camera permission response arriving after cancellation immediately stops every track", async ({
  page,
}) => {
  await mock(page);
  await page.addInitScript(() => {
    const state = window as unknown as {
      cameraResolve?: (stream: object) => void;
      stoppedTracks: number;
    };
    state.stoppedTracks = 0;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () =>
          new Promise((resolve) => {
            state.cameraResolve = resolve;
          }),
      },
    });
  });
  await page.goto("/profiles");
  await page
    .getByRole("button", { name: "Prendre une photo", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await page.evaluate(() => {
    const state = window as unknown as {
      cameraResolve?: (stream: object) => void;
      stoppedTracks: number;
    };
    state.cameraResolve?.({
      getTracks: () => [
        {
          stop: () => {
            state.stoppedTracks++;
          },
        },
      ],
    });
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { stoppedTracks: number }).stoppedTracks,
      ),
    )
    .toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a simulated webcam photo opens the crop modal and releases camera tracks before upload", async ({
  page,
}) => {
  const state = await mock(page);
  await page.addInitScript(() => {
    const state = window as unknown as { cameraTracks: MediaStreamTrack[] };
    state.cameraTracks = [];
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 480;
          const context = canvas.getContext("2d");
          const render = () => {
            if (context) {
              context.fillStyle = "#69439a";
              context.fillRect(0, 0, 640, 480);
            }
          };
          render();
          const stream = canvas.captureStream(10);
          const timer = window.setInterval(render, 100);
          stream.getTracks().forEach((track) => {
            state.cameraTracks.push(track);
            const stop = track.stop.bind(track);
            track.stop = () => {
              window.clearInterval(timer);
              stop();
            };
          });
          return stream;
        },
      },
    });
  });
  await page.goto("/profiles");
  test.skip(
    !(await page.evaluate(
      () => typeof HTMLCanvasElement.prototype.captureStream === "function",
    )),
    "Browser lacks the simulated webcam source.",
  );
  await page
    .getByRole("button", { name: "Prendre une photo", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Prendre la photo", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Cadre ta photo" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { cameraTracks: MediaStreamTrack[] }
      ).cameraTracks.every((track) => track.readyState === "ended"),
    ),
  ).toBe(true);
  expect(state.uploads).toBe(0);
  await page.getByRole("button", { name: "Enregistrer ma photo" }).click();
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Ta photo a été enregistrée.",
  );
  expect(state.uploads).toBe(1);
});

test("name action stays in place and releases its pointer highlight after edit and save", async ({
  page,
  isMobile,
}) => {
  const state = await mock(page);
  let finishSave = () => {};
  const saved = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  await page.route("**/api/profiles/me", async (route) => {
    await saved;
    if (state.access.profile) state.access.profile.firstName = "Morgan";
    await route.fulfill({ json: state.access.profile });
  });
  await page.goto("/profiles");
  const edit = page.getByRole("button", {
    name: "Modifier mon prénom",
    exact: true,
  });
  const geometry = await edit.boundingBox();
  if (!geometry) throw Error("Missing action button.");
  if (!isMobile) {
    await edit.hover();
    await expect
      .poll(() =>
        edit.evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .not.toBe("rgba(0, 0, 0, 0)");
  }
  if (isMobile) await edit.tap();
  else await edit.click();
  await expect(page.getByLabel("Ton prénom", { exact: true })).toBeFocused();
  await expect
    .poll(() =>
      edit.evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .toBe("rgba(0, 0, 0, 0)");
  await page.getByLabel("Ton prénom", { exact: true }).fill("Morgan");
  const save = page.getByRole("button", {
    name: "Enregistrer mon prénom",
    exact: true,
  });
  const dirtyGeometry = await save.boundingBox();
  expect(dirtyGeometry).toEqual(geometry);
  await save.click();
  const pending = page.getByRole("button", {
    name: "Enregistrement…",
    exact: true,
  });
  await expect(pending).toBeDisabled();
  await expect(page.getByLabel("Ton prénom", { exact: true })).toBeDisabled();
  finishSave();
  await expect(edit).toBeVisible();
  await expect
    .poll(() =>
      edit.evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .toBe("rgba(0, 0, 0, 0)");
  await expect.poll(() => edit.boundingBox()).toEqual(geometry);
  await page.keyboard.press("Tab");
  await edit.focus();
  expect(
    await edit.evaluate((element) => element.matches(":focus-visible")),
  ).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByLabel("Ton prénom", { exact: true }).fill("Sam");
  expect(
    await save.evaluate(
      (element) => element.getAnimations({ subtree: true }).length,
    ),
  ).toBe(0);
});
