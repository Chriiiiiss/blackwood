import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import type { ContributionPage } from "../src/features/coffre/requests";
import type { GuestAccess } from "../src/features/guest-access/requests";
import { mockPartyOpen } from "./party-fixtures";

test.use({
  launchOptions: async ({ browserName }, use) => {
    await use(
      browserName === "chromium"
        ? {
            args: [
              "--enable-webgl",
              "--use-angle=swiftshader",
              "--enable-unsafe-swiftshader",
            ],
          }
        : {},
    );
  },
});

const profile = {
  id: "151597a3-d728-414d-9b74-717386c10b01",
  firstName: "Alex",
  avatarMediaId: null,
  hasInvitationResponse: true,
  role: "main" as const,
};
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);
async function setup(page: Page, webgl = false) {
  await mockPartyOpen(page);
  if (!webgl)
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        kind,
        ...args
      ) {
        if (kind === "webgl" || kind === "webgl2") return null;
        return Reflect.apply(original, this, [kind, ...args]);
      } as typeof original;
    });
  const state = {
    access: { hubEnabled: true, profile: { ...profile } } as GuestAccess,
    stateStatus: 200,
    listStatus: 200,
    writeStatus: 200,
    writeCode: "",
    abortNext: false,
    state: "collecting",
    serverNow: "2026-10-31T20:00:00.000Z",
    deadline: "2026-10-31T21:00:00.000Z" as string | null,
    stateReads: 0,
    listReads: 0,
    writes: [] as Record<string, unknown>[],
    bodies: [] as string[],
    revealOnSecondRead: false,
    pages: { first: { contributions: [], nextCursor: null } } as Record<
      string,
      ContributionPage
    >,
  };
  await page.route("**/api/coffres**", (route) =>
    route.fulfill({ json: { coffres: [], nextCursor: null } }),
  );
  await page.route("**/api/guest-access", (route) =>
    route.fulfill({ json: state.access }),
  );
  await page.route("**/api/profiles/me/invitation-response", (route) =>
    route.fulfill({
      json: {
        firstName: "Alex",
        attendance: "yes",
        plusOne: false,
        ideas: null,
      },
    }),
  );
  await page.route(/\/api\/coffre(?:\?.*)?$/, (route) => {
    state.stateReads++;
    if (state.revealOnSecondRead && state.stateReads > 1)
      state.state = "revealed";
    return route.fulfill({
      status: state.stateStatus,
      json:
        state.stateStatus === 200
          ? {
              id: 1,
              name: null,
              state: state.state,
              serverNow: state.serverNow,
              deadline: state.deadline,
              durationSeconds: 3600,
              startedAt: state.serverNow,
            }
          : {
              code:
                state.stateStatus === 401
                  ? "GUEST_UNAUTHENTICATED"
                  : "COFFRE_UNAVAILABLE",
            },
    });
  });
  await page.route("**/api/coffre/contributions**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      state.listReads++;
      const key = new URL(request.url()).searchParams.get("after") ?? "first";
      return route.fulfill({
        status: state.listStatus,
        json:
          state.listStatus === 200
            ? state.pages[key]
            : { code: "GUEST_UNAUTHENTICATED" },
      });
    }
    expect(request.headers()["x-guest-request"]).toBe("1");
    const raw = request.postDataBuffer()?.toString("utf8") ?? "";
    state.bodies.push(raw);
    const metadata = request.headers()["content-type"]?.startsWith("multipart/")
      ? JSON.parse(
          raw.match(/name="contribution"\r\n\r\n([^\r]*)/)?.[1] ?? "{}",
        )
      : request.postDataJSON();
    state.writes.push(metadata);
    if (state.abortNext) {
      state.abortNext = false;
      return route.abort("failed");
    }
    return route.fulfill({
      status: state.writeStatus,
      json:
        state.writeStatus === 200
          ? { id: metadata.id, received: true }
          : { code: state.writeCode },
    });
  });
  return state;
}
const preview = async (page: Page, text = "Un vœu pour cette nuit.") => {
  await page
    .getByRole("textbox", { name: "Un mot pour plus tard." })
    .fill(text);
  // These tests disable WebGL: wait for the final preview layout before a mobile tap.
  await expect(
    page
      .getByRole("region", { name: "Aperçu de ton écrin" })
      .getByRole("figure"),
  ).toHaveAttribute("data-state", "fallback");
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(
    page.getByRole("dialog", { name: "À qui le confier ?" }),
  ).toBeVisible();
};

test("Coffre is linked from the hub and waits without reading contributions before launch", async ({
  page,
}) => {
  const state = await setup(page);
  state.state = "prepared";
  state.deadline = null;
  await page.goto("/");
  await page.getByRole("link", { name: /^Coffre/ }).click();
  await expect(page).toHaveURL("/coffre");
  await expect(
    page.getByRole("heading", { name: "Les souvenirs attendent leur heure." }),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  expect(state.listReads).toBe(0);
  expect(state.writes).toHaveLength(0);
});

test("unknown guests go to personal code login and a closed hub preserves invitation access", async ({
  page,
}) => {
  const state = await setup(page);
  state.access.profile = null;
  await page.goto("/coffre");
  await expect(page).toHaveURL("/login");
  await expect(page.getByLabel("Ton code personnel")).toBeVisible();
  expect(state.stateReads).toBe(0);
  expect(state.listReads).toBe(0);
  state.access = { hubEnabled: false, profile };
  await page.goto("/coffre");
  await expect(page).toHaveURL("/invitation");
  expect(state.stateReads).toBe(0);
});

test("text preview respects privacy, sends once and clears content before another deposit", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/coffre");
  await preview(page, "<script>alert('secret')</script>");
  await page.getByRole("radio", { name: /Juste pour Chris/ }).check();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Jamais diffusé sur la TV.");
  await expect(dialog).toContainText(
    "ne pourra plus être revu individuellement",
  );
  expect(state.writes).toHaveLength(0);
  await dialog.getByRole("button", { name: "Confier au Coffre" }).dblclick();
  await expect(
    page.getByLabel("Un mot pour plus tard.", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByText("Ton souvenir a trouvé sa place dans le Coffre."),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("<script>alert('secret')</script>", { exact: true }),
  ).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({
    visibility: "private",
    frameId: "plain",
    text: "<script>alert('secret')</script>",
  });
  const id = state.writes[0]?.id;
  await expect(
    page.getByRole("textbox", { name: "Un mot pour plus tard." }),
  ).toHaveValue("");
  await preview(page, "Un autre instant");
  await page.getByRole("button", { name: "Confier au Coffre" }).click();
  await expect.poll(() => state.writes.length).toBe(2);
  expect(state.writes[1]?.id).not.toBe(id);
  expect(state.listReads).toBe(0);
});

test("selected frames preview live content locally before the confirmation modal", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/coffre");
  const live = page.getByRole("region", { name: "Aperçu de ton écrin" });
  await live.waitFor();
  await expect(
    live.getByRole("figure", { name: "Écrin Classique" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: /One Wish Willow/ }).check();
  await expect(
    live.getByRole("article", { name: "Vœu One Wish Willow" }),
  ).toBeVisible();
  await expect(live).toContainText("Ton vœu prend forme ici…");
  await page
    .getByRole("textbox", { name: "Un mot pour plus tard." })
    .fill("Une nuit à garder.");
  await expect(live).toContainText("Une nuit à garder.");
  await page.getByRole("radio", { name: /Classique/ }).check();
  await expect(live.getByRole("article")).toHaveCount(0);
  await expect(live).toContainText("Une nuit à garder.");
  await page.getByLabel("Ajouter une photo", { exact: true }).setInputFiles({
    name: "souvenir.png",
    mimeType: "image/png",
    buffer: image,
  });
  const photo = live.getByAltText("Ton aperçu");
  await expect(photo).toBeVisible();
  const source = await photo.getAttribute("src");
  expect(source).toMatch(/^blob:/);
  expect(state.writes).toHaveLength(0);
  expect(state.listReads).toBe(0);
  await page.getByRole("button", { name: "Continuer" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Une nuit à garder.");
  await expect(dialog.getByAltText("Ton aperçu")).toHaveAttribute(
    "src",
    source ?? "",
  );
  expect(state.writes).toHaveLength(0);
});

test("lost receipts retry the exact same draft and UUID even after revelation", async ({
  page,
}) => {
  const state = await setup(page);
  state.abortNext = true;
  await page.goto("/coffre");
  await preview(page, "Garde ce moment.");
  await page.getByRole("button", { name: "Confier au Coffre" }).click();
  await expect(
    page.getByText("L’envoi n’a pas pu être confirmé.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Revenir au dépôt", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Un mot pour plus tard." }),
  ).toBeDisabled();
  state.state = "revealed";
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true })),
  );
  await expect(
    page.getByRole("heading", {
      name: "Les souvenirs attendent le grand écran.",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retrouver l’envoi à confirmer" })
    .click();
  await page.getByRole("button", { name: "Réessayer le même envoi" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.writes).toHaveLength(2);
  expect(state.writes[1]).toEqual(state.writes[0]);
});

test("definitive rejections keep an editable draft and show modal toasts", async ({
  page,
}) => {
  const state = await setup(page);
  state.writeStatus = 429;
  state.writeCode = "MEDIA_BUSY";
  await page.goto("/coffre");
  await preview(page);
  await page.getByRole("button", { name: "Confier au Coffre" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Une photo est en cours de traitement.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Revenir à mon souvenir" }).click();
  await expect(
    page.getByRole("textbox", { name: "Un mot pour plus tard." }),
  ).toHaveValue("Un vœu pour cette nuit.");
  await expect(
    page.getByRole("textbox", { name: "Un mot pour plus tard." }),
  ).toBeEnabled();
  state.writeStatus = 200;
  await preview(page, "Un vœu corrigé");
  await page.getByRole("button", { name: "Confier au Coffre" }).click();
  await expect(
    page.getByLabel("Un mot pour plus tard.", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByText("Ton souvenir a trouvé sa place dans le Coffre."),
  ).toBeVisible();
  expect(state.writes[1]?.text).toBe("Un vœu corrigé");
});

test("photo deposits use multipart, keep their file on failure and prevent photo-only Willow", async ({
  page,
}) => {
  const state = await setup(page);
  state.writeStatus = 400;
  state.writeCode = "INVALID_IMAGE";
  await page.goto("/coffre");
  await page.getByRole("radio", { name: /One Wish Willow/ }).check();
  await page.getByLabel("Ajouter une photo", { exact: true }).setInputFiles({
    name: "souvenir.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(page.getByRole("radio", { name: /Classique/ })).toBeChecked();
  await expect(
    page.getByRole("radio", { name: /One Wish Willow/ }),
  ).toBeDisabled();
  // The asynchronous preview changes the layout above the mobile tap target.
  const livePhoto = page
    .getByRole("region", { name: "Aperçu de ton écrin" })
    .getByAltText("Ton aperçu");
  await expect(livePhoto).toBeVisible();
  await livePhoto.evaluate((node) => (node as HTMLImageElement).decode());
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(
    page.getByRole("dialog").getByAltText("Ton aperçu"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confier au Coffre" }).click();
  await expect(
    page.getByRole("dialog").getByText(/Choisis une photo JPEG/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Revenir à mon souvenir" }).click();
  await expect(page.getByText("souvenir.png", { exact: true })).toBeVisible();
  state.writeStatus = 200;
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("button", { name: "Confier au Coffre" }).click();
  await expect(
    page.getByLabel("Un mot pour plus tard.", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByText("Ton souvenir a trouvé sa place dans le Coffre."),
  ).toBeVisible();
  expect(state.bodies[1]).toContain('name="file"; filename="souvenir.png"');
  expect(state.writes[1]).toMatchObject({ frameId: "plain", text: "" });
  expect(state.writes[1]?.id).toBe(state.writes[0]?.id);
});

test("phone capture and unsupported HEIC previews preserve the file until confirmation", async ({
  page,
}) => {
  const state = await setup(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/coffre");
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Prendre une photo", exact: true })
    .click();
  await (await chooser).setFiles({
    name: "capture.heic",
    mimeType: "image/heic",
    buffer: Buffer.from("browser cannot decode this fixture"),
  });
  // Decoding failure changes the preview height; finish it before scrolling to Continue.
  await expect(
    page
      .getByRole("region", { name: "Aperçu de ton écrin" })
      .getByText(/Le fichier original sera vérifié à l’envoi/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText(/Le fichier original sera vérifié à l’envoi/),
  ).toBeVisible();
  expect(state.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Confier au Coffre" }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.bodies[0]).toContain('filename="capture.heic"');
});

test("Unicode length is counted consistently and large files do not replace the draft", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/coffre");
  await page
    .getByRole("textbox", { name: "Un mot pour plus tard." })
    .fill("👻".repeat(500));
  await expect(page.getByRole("button", { name: "Continuer" })).toBeEnabled();
  await page
    .getByRole("textbox", { name: "Un mot pour plus tard." })
    .fill("👻".repeat(501));
  await expect(page.getByRole("button", { name: "Continuer" })).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: "Un mot pour plus tard." }),
  ).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Ajouter une photo", { exact: true }).setInputFiles({
    name: "large.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
  });
  await expect(page.getByText(/La photo dépasse 20 Mo/)).toBeVisible();
  await expect(page.getByText("large.jpg", { exact: true })).toHaveCount(0);
});

test("the server-clock deadline closes the composer without reading TV contributions", async ({
  page,
}) => {
  const state = await setup(page);
  const clientEpoch = Date.parse("2035-01-01T00:00:00Z");
  const serverEpoch = Date.parse(state.serverNow);
  const duration = 60_000;
  await page.clock.install({ time: new Date(clientEpoch) });
  // Model an advancing server independently of the deliberately incorrect client date.
  await page.route(/\/api\/coffre(?:\?.*)?$/, async (route) => {
    const elapsed = await page.evaluate(
      (epoch) => Date.now() - epoch,
      clientEpoch,
    );
    return route.fulfill({
      json: {
        id: 1,
        name: null,
        state: elapsed >= duration ? "revealed" : "collecting",
        serverNow: new Date(serverEpoch + elapsed).toISOString(),
        deadline: new Date(serverEpoch + duration).toISOString(),
        durationSeconds: 60,
        startedAt: state.serverNow,
      },
    });
  });
  await page.goto("/coffre");
  await page.getByRole("textbox", { name: "Un mot pour plus tard." }).waitFor();
  await preview(page);
  expect(state.listReads).toBe(0);
  await page.clock.fastForward(duration + 1000);
  await expect(
    page.getByRole("heading", {
      name: "Les souvenirs attendent le grand écran.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
  expect(state.listReads).toBe(0);
});

test("after the countdown the guest page neither fetches nor displays stored memories", async ({
  page,
}) => {
  const state = await setup(page);
  state.state = "revealed";
  state.pages.first = {
    contributions: [
      {
        id: "48e51755-d591-4154-b376-3a293ccda11d",
        text: "TV-only memory",
        photoMediaId: "b1add343-81a0-4e15-b630-4a4329fb0f14",
        frameId: "plain",
        createdAt: state.serverNow,
      },
    ],
    nextCursor: null,
  };
  const tvReads: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/tv/") ||
      request.url().includes("/api/media/")
    )
      tvReads.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("link", { name: /Coffre/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Les souvenirs attendent le grand écran.",
    }),
  ).toBeVisible();
  await expect(page.getByText("TV-only memory", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: "Souvenir partagé" }),
  ).toHaveCount(0);
  expect(state.listReads).toBe(0);
  expect(tvReads).toEqual([]);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Les souvenirs attendent le grand écran.",
    }),
  ).toBeVisible();
  expect(state.listReads).toBe(0);
});

test("expired access on the closed Coffre offers personal code recovery", async ({
  page,
}) => {
  const state = await setup(page);
  state.state = "revealed";
  await page.goto("/coffre");
  await expect(
    page.getByRole("heading", {
      name: "Les souvenirs attendent le grand écran.",
    }),
  ).toBeVisible();
  state.stateStatus = 401;
  state.access.profile = null;
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page).toHaveURL("/login");
  expect(state.listReads).toBe(0);
});

test("Coffre and its preview remain accessible at narrow widths and reduced motion", async ({
  page,
}) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/coffre");
  await page.getByRole("textbox", { name: "Un mot pour plus tard." }).waitFor();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("radio", { name: /One Wish Willow/ }).check();
  await page
    .getByRole("textbox", { name: "Un mot pour plus tard." })
    .fill("Un vœu qui ne déborde pas.");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // Safari does not focus buttons on pointer activation; exercise keyboard focus restoration explicitly.
  const trigger = page.getByRole("button", { name: "Continuer" });
  await trigger.focus();
  await trigger.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("article", { name: "Vœu One Wish Willow" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continuer" })).toBeFocused();
});

test.describe("Three.js model previews", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Software WebGL proof runs in Chromium; WebKit cases exercise the illustrated fallback.",
  );

  test("renders the actual models, reuses the renderer and supports rotation, zoom and complete messages", async ({
    page,
  }) => {
    const state = await setup(page, true);
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      const contexts = new Set();
      Object.assign(window, { createdPreviewContexts: 0 });
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        kind,
        ...args
      ) {
        const context = Reflect.apply(original, this, [kind, ...args]);
        if (
          (kind === "webgl" || kind === "webgl2") &&
          context &&
          !contexts.has(context)
        ) {
          contexts.add(context);
          Object.assign(window, { createdPreviewContexts: contexts.size });
        }
        return context;
      } as typeof original;
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/coffre");
    const live = page.getByRole("region", { name: "Aperçu de ton écrin" });
    const canvas = live.locator('canvas[data-renderer="three"]');
    await expect(canvas).toHaveAttribute("data-model", "plain");
    await page.getByRole("radio", { name: /One Wish Willow/ }).check();
    await expect(canvas).toHaveAttribute("data-model", "one-wish-willow");
    await page
      .getByLabel("Un mot pour plus tard.", { exact: true })
      .fill("Une nuit pleine de beaux souvenirs.");
    await expect(live).toContainText("Une nuit pleine de beaux souvenirs.");
    await expect(live.getByRole("button")).toHaveCount(0);
    await canvas.scrollIntoViewIfNeeded();
    const before = await canvas.getAttribute("data-view");
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error("The model viewport has no bounds.");
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width / 2 + 40,
      bounds.y + bounds.height / 2,
      { steps: 6 },
    );
    await page.mouse.up();
    await expect(canvas).not.toHaveAttribute("data-view", before ?? "");
    const dragged = await canvas.getAttribute("data-view");
    await page.mouse.wheel(0, -200);
    await expect(canvas).not.toHaveAttribute("data-view", dragged ?? "");
    await canvas.focus();
    const focused = await canvas.getAttribute("data-view");
    await canvas.press("ArrowRight");
    await expect(canvas).not.toHaveAttribute("data-view", focused ?? "");
    const turned = await canvas.getAttribute("data-view");
    await canvas.press("+");
    await expect(canvas).not.toHaveAttribute("data-view", turned ?? "");
    await canvas.press("Home");
    const long = "👻".repeat(500);
    const revision = await canvas.getAttribute("data-revision");
    await page.getByLabel("Un mot pour plus tard.", { exact: true }).fill(long);
    await expect(canvas).not.toHaveAttribute("data-revision", revision ?? "");
    await expect(live).toContainText(long);
    await expect(canvas).toHaveAttribute("data-model", "one-wish-willow");
    expect(
      await page.evaluate(() => Reflect.get(window, "createdPreviewContexts")),
    ).toBe(1);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const submittedCanvas = await canvas.elementHandle();
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(
      page.getByRole("dialog").locator('canvas[data-renderer="three"]'),
    ).toHaveAttribute("data-model", "one-wish-willow");
    await expect(page.getByRole("dialog")).toContainText(long);
    await expect(
      page.getByRole("dialog").getByText(long, { exact: true }),
    ).toBeVisible();
    expect(state.writes).toHaveLength(0);
    await page.getByRole("button", { name: "Confier au Coffre" }).click();
    await expect(
      page.getByLabel("Un mot pour plus tard.", { exact: true }),
    ).toHaveValue("");
    expect(
      await submittedCanvas?.evaluate((element) => element.isConnected),
    ).toBe(false);
    await expect(canvas).toHaveAttribute("data-model", "one-wish-willow");
    await expect(page.getByText(long, { exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(() => Reflect.get(window, "createdPreviewContexts")),
    ).toBe(3);
    expect(state.writes).toHaveLength(1);
  });

  test("context loss keeps the draft and visibly switches to the illustrated fallback", async ({
    page,
  }) => {
    const state = await setup(page, true);
    await page.goto("/coffre");
    await page
      .getByLabel("Un mot pour plus tard.", { exact: true })
      .fill("Un vœu intact.");
    await page.getByRole("radio", { name: /One Wish Willow/ }).check();
    const live = page.getByRole("region", { name: "Aperçu de ton écrin" });
    const canvas = live.locator('canvas[data-renderer="three"]');
    await expect(canvas).toHaveAttribute("data-model", "one-wish-willow");
    await canvas.evaluate((element: HTMLCanvasElement) =>
      element
        .getContext("webgl2")
        ?.getExtension("WEBGL_lose_context")
        ?.loseContext(),
    );
    await expect(
      live.getByText("La vue 3D est indisponible. Voici l’aperçu illustré."),
    ).toBeVisible();
    await expect(
      live.getByRole("article", { name: "Vœu One Wish Willow" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Un mot pour plus tard.", { exact: true }),
    ).toHaveValue("Un vœu intact.");
    expect(state.writes).toHaveLength(0);
  });
});
