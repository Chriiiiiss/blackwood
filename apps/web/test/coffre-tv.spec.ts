import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

test.use({
  launchOptions: async ({ browserName }, use) =>
    use(
      browserName === "chromium"
        ? {
            args: [
              "--enable-webgl",
              "--use-angle=swiftshader",
              "--enable-unsafe-swiftshader",
            ],
          }
        : {},
    ),
});
const first = {
  id: "151597a3-d728-414d-9b74-717386c10b01",
  text: "Un vœu pour cette nuit.",
  photoMediaId: null,
  frameId: "one-wish-willow",
  createdAt: "2026-10-31T20:00:00Z",
};
const second = {
  ...first,
  id: "151597a3-d728-414d-9b74-717386c10b02",
  text: "On garde le meilleur.",
  frameId: "plain",
};
async function setup(page: Page, webgl = false) {
  if (!webgl)
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        kind,
        ...args
      ) {
        return kind === "webgl" || kind === "webgl2"
          ? null
          : Reflect.apply(original, this, [kind, ...args]);
      } as typeof original;
    });
  const fixture = {
    authenticated: true,
    status: 200,
    state: "collecting",
    id: 1,
    serverNow: "2026-10-31T20:00:00Z",
    deadline: "2026-10-31T21:00:00Z",
    reads: [] as string[],
    pages: {
      first: { contributions: [first], nextCursor: second.id },
      [second.id]: { contributions: [second], nextCursor: null },
    } as Record<
      string,
      { contributions: (typeof first)[]; nextCursor: string | null }
    >,
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    fixture.reads.push(url.pathname + url.search);
    if (url.pathname === "/api/tv/session") {
      if (request.postDataJSON().code !== "4826")
        return route.fulfill({ status: 401, json: {} });
      fixture.authenticated = true;
      return route.fulfill({ json: { expiresAt: "2026-11-07T20:00:00Z" } });
    }
    if (!fixture.authenticated)
      return route.fulfill({
        status: 401,
        json: { code: "TV_UNAUTHENTICATED" },
      });
    if (fixture.status !== 200)
      return route.fulfill({
        status: fixture.status,
        json: { code: "COFFRE_UNAVAILABLE" },
      });
    if (url.pathname === "/api/tv/coffre")
      return route.fulfill({
        json: {
          id: fixture.id,
          name: "Les secrets de minuit",
          state: fixture.state,
          serverNow: fixture.serverNow,
          deadline: fixture.deadline,
          durationSeconds: 3600,
          startedAt: fixture.serverNow,
        },
      });
    if (url.pathname === "/api/tv/coffre/contributions")
      return route.fulfill({
        json: fixture.pages[url.searchParams.get("after") ?? "first"],
      });
    return route.fulfill({ status: 404, json: {} });
  });
  return fixture;
}

test("TV authenticates once, waits without reading memories and restores on reload", async ({
  page,
}) => {
  const fixture = await setup(page);
  fixture.authenticated = false;
  await page.goto("/coffre/tv");
  await page.getByLabel("Code TV").fill("1111");
  await page.getByRole("button", { name: "Entrer dans la projection" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Code incorrect, expiré ou épuisé. Génère un nouveau code TV.",
  );
  await page.getByLabel("Code TV").fill("4826");
  await page.getByRole("button", { name: "Entrer dans la projection" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  expect(fixture.reads.some((path) => path.includes("/contributions"))).toBe(
    false,
  );
  await page.reload();
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.getByLabel("Code TV")).toHaveCount(0);
  await expect(
    page.getByText("Le site évoluera au fil des préparatifs.", {
      exact: false,
    }),
  ).toHaveCount(0);
});

test("TV keeps the code field mounted while waiting for pairing and opening the keyboard", async ({
  page,
}) => {
  const fixture = await setup(page);
  fixture.authenticated = false;
  await page.route("**/api/tv/coffre", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    return route.fulfill({ status: 401, json: { code: "TV_UNAUTHENTICATED" } });
  });
  await page.clock.install();
  await page.goto("/coffre/tv");
  const input = page.getByLabel("Code TV");
  await input.fill("12");
  await expect(input).toBeFocused();
  await page.clock.fastForward(6100);
  await expect(input).toHaveValue("12");
  await expect(input).toBeFocused();
  // TV keyboards can change visibility while the visitor is entering the code.
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
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
  });
  await page.clock.runFor(300);
  await expect(input).toHaveValue("12");
  await expect(input).toBeFocused();
});

test("server deadline reveals all TV cursor pages and loss of access hides content", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.clock.install();
  await page.goto("/coffre/tv");
  await expect(page.getByRole("timer")).toBeVisible();
  fixture.state = "revealed";
  await page.clock.fastForward(3100);
  await expect
    .poll(() =>
      fixture.reads.some((path) => path.includes(`after=${second.id}`)),
    )
    .toBe(true);
  await expect(page.getByText(first.text, { exact: true })).toBeVisible();
  fixture.authenticated = false;
  await page.clock.fastForward(3100);
  await expect(page.getByLabel("Code TV")).toBeVisible();
  await expect(page.getByText(first.text, { exact: true })).toHaveCount(0);
  await expect(page.locator('canvas[data-renderer="three"]')).toHaveCount(0);
});

test("TV hides stale memories on errors and follows the successor without reading its content", async ({
  page,
}) => {
  const fixture = await setup(page);
  fixture.state = "revealed";
  await page.goto("/coffre/tv");
  await expect(page.getByText(first.text, { exact: true })).toBeVisible();
  fixture.status = 503;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(
    page.getByRole("heading", { name: "La projection va reprendre." }),
  ).toBeVisible();
  await expect(page.getByText(first.text, { exact: true })).toHaveCount(0);
  fixture.status = 200;
  fixture.id = 2;
  fixture.state = "collecting";
  const before = fixture.reads.filter((path) =>
    path.includes("/contributions"),
  ).length;
  await page.getByRole("button", { name: "Réessayer la projection" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  expect(
    fixture.reads.filter((path) => path.includes("/contributions")),
  ).toHaveLength(before);
});

test("TV renders the actual Three.js models in one animated scene", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "SwiftShader proves the shared WebGL scene in Chromium.",
  );
  const fixture = await setup(page, true);
  fixture.state = "revealed";
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/coffre/tv");
  const canvas = page.getByRole("img", {
    name: "Les souvenirs flottent en trois dimensions",
  });
  await expect(canvas).toHaveAttribute("data-renderer", "three");
  await expect(canvas).toHaveAttribute("data-models", "one-wish-willow,plain");
  const before = await canvas.screenshot();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(before))
    .toBe(false);
  await page.screenshot({
    path: test.info().outputPath("tv-three-desktop.png"),
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await canvas.evaluate((node) =>
    (node as HTMLCanvasElement)
      .getContext("webgl2")
      ?.getExtension("WEBGL_lose_context")
      ?.loseContext(),
  );
  await expect(
    page.getByText("La 3D n’est pas disponible sur ce navigateur.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Réessayer la 3D" }).click();
  await expect(page.locator('canvas[data-renderer="three"]')).toHaveCount(1);
  await expect(page.locator('canvas[data-renderer="three"]')).toHaveAttribute(
    "data-models",
    "one-wish-willow,plain",
  );
});
