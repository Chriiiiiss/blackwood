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
    page.getByText("31 octobre 2026", {
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
    page.getByRole("heading", { name: "Projection indisponible" }),
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
  test.setTimeout(60_000);
  const fixture = await setup(page, true);
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  fixture.state = "revealed";
  const memories = [
    first,
    second,
    ...Array.from({ length: 10 }, (_, index) => ({
      ...second,
      id: `151597a3-d728-414d-9b74-${String(index + 100).padStart(12, "0")}`,
      text: `Un autre souvenir de la nuit ${index + 1}.`,
    })),
  ];
  fixture.pages.first = { contributions: memories, nextCursor: null };
  const start = new Date("2026-10-31T20:00:00Z");
  await page.clock.install({ time: start });
  await page.clock.pauseAt(start);
  // SwiftShader renders the real scene at 16:9 without a full TV-sized readback.
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto("/coffre/tv");
  const canvas = page.getByRole("img", {
    name: "Les souvenirs flottent en trois dimensions",
  });
  async function waitForModels(count: number) {
    await expect
      .poll(
        async () => {
          // Flush queued API notifications and RAF while the test clock is paused.
          await page.clock.runFor(64);
          return canvas.evaluateAll(
            (nodes) =>
              nodes[0]?.getAttribute("data-items")?.split(",").filter(Boolean)
                .length ?? 0,
          );
        },
        { timeout: 15_000 },
      )
      .toBe(count);
  }
  await waitForModels(12);
  await expect(canvas).toHaveAttribute("data-renderer", "three");
  const residents = await canvas.getAttribute("data-items");
  expect(await canvas.getAttribute("data-models")).toContain("one-wish-willow");
  expect(await canvas.getAttribute("data-models")).toContain("plain");
  const bounds = await canvas.boundingBox();
  expect(bounds).toMatchObject({ x: 0, y: 0, width: 960, height: 540 });
  if (!bounds) throw new Error("The TV canvas must fill the viewport.");
  // Capture two rendered instants directly: GPU readback must not run inside a
  // five-second polling assertion or advance the scene's reading timeline.
  await page.clock.runFor(64);
  const before = await page.screenshot({ clip: bounds });
  await page.clock.runFor(500);
  const after = await page.screenshot({ clip: bounds });
  expect(after.equals(before)).toBe(false);
  await page.screenshot({
    path: test.info().outputPath("tv-three-desktop.png"),
  });
  await page.clock.fastForward(6500);
  await expect(canvas).toHaveAttribute("data-phase", "arriving");
  const selected = await canvas.getAttribute("data-focused");
  expect(selected).toBe(first.id);
  await page.clock.fastForward(3200);
  await expect(canvas).toHaveAttribute("data-phase", "reading");
  await expect(canvas).toHaveAttribute("data-focused", selected ?? "");
  await expect(canvas).toHaveAttribute("data-items", residents ?? "");
  await page.screenshot({
    path: test.info().outputPath("tv-three-reading.png"),
  });
  await page.clock.fastForward(10_000);
  await expect(canvas).toHaveAttribute("data-phase", "returning");
  await page.clock.fastForward(3200);
  await expect(canvas).toHaveAttribute("data-phase", "floating");
  await expect(canvas).toHaveAttribute("data-focused", "");
  await expect(canvas).toHaveAttribute("data-items", residents ?? "");
  // A content refresh removes deleted GPU objects without replacing the survivors.
  fixture.pages.first = { contributions: memories.slice(1), nextCursor: null };
  await page.clock.fastForward(5100);
  await waitForModels(11);
  expect(await canvas.getAttribute("data-items")).not.toContain(first.id);
  // Axe schedules its own timers; only the scene timeline needs a paused clock.
  await page.clock.resume();
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
  await waitForModels(11);
});

test("mission scores refresh independently and preserve the TV canvas", async ({
  page,
}) => {
  const fixture = await setup(page);
  let showScoresWithMemories = false;
  let unavailable = false;
  let points = 2;
  await page.route("**/api/tv/missions/leaderboard", (route) =>
    route.fulfill({
      status: unavailable ? 503 : 200,
      json: unavailable
        ? {}
        : {
            showScoresWithMemories,
            refreshedAt: new Date().toISOString(),
            players: [
              { id: "a".repeat(64), rank: 1, firstName: "Sam", points },
            ],
          },
    }),
  );
  await page.goto("/coffre/tv");
  const board = page.getByRole("complementary", {
    name: "Classement des missions",
  });
  await expect(board.getByText("Sam", { exact: true })).toBeVisible();
  await page
    .locator("canvas")
    .evaluate((node) => node.setAttribute("data-probe", "same-canvas"));
  points = 3;
  await expect(board.getByText("03", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-probe",
    "same-canvas",
  );
  unavailable = true;
  await expect(board.getByText("Scores indisponibles")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-probe",
    "same-canvas",
  );
  unavailable = false;
  fixture.state = "revealed";
  await expect(
    page.getByText("Le Coffre est ouvert", { exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(board).toHaveCount(0);
  await page
    .locator("canvas")
    .evaluate((node) => node.setAttribute("data-probe", "revealed-canvas"));
  showScoresWithMemories = true;
  await expect(board).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-probe",
    "revealed-canvas",
  );
});

async function celebrationSetup(page: Page) {
  await page.clock.install();
  const coffre = await setup(page);
  const alex = { id: "a".repeat(64), rank: 1, firstName: "Alex", points: 3 };
  const camille = {
    id: "b".repeat(64),
    rank: 2,
    firstName: "Camille",
    points: 2,
  };
  const sam = { id: "c".repeat(64), rank: 3, firstName: "Sam", points: 1 };
  const scores = {
    status: 200,
    showScoresWithMemories: false,
    players: [alex, camille, sam],
  };
  await page.route("**/api/tv/missions/leaderboard", (route) =>
    route.fulfill({
      status: scores.status,
      json:
        scores.status === 200
          ? { ...scores, refreshedAt: new Date().toISOString() }
          : {},
    }),
  );
  await page.goto("/coffre/tv");
  const board = page.getByRole("complementary", {
    name: "Classement des missions",
  });
  await expect(board.getByText("Camille", { exact: true })).toBeVisible();
  const notice = board.getByRole("status");
  const poll = async () => {
    const response = page.waitForResponse((res) =>
      res.url().endsWith("/tv/missions/leaderboard"),
    );
    await page.clock.fastForward(5001);
    await response;
  };
  return { coffre, scores, board, notice, poll, alex, camille, sam };
}

test("TV celebrates live gains once, moves the same player rows and never replays on reload", async ({
  page,
}) => {
  const { scores, board, notice, poll, alex, camille, sam } =
    await celebrationSetup(page);
  await expect(notice).toHaveCount(0);
  await board
    .locator("li")
    .filter({ hasText: "Camille" })
    .evaluate((row) => row.setAttribute("data-probe", "same-player"));
  await page
    .locator("canvas")
    .evaluate((node) => node.setAttribute("data-probe", "same-scene"));
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (
        this instanceof HTMLElement &&
        this.dataset.playerId &&
        Array.isArray(frames) &&
        frames.some(
          (frame) =>
            typeof frame.transform === "string" &&
            frame.transform.includes("scale(1.07)"),
        )
      ) {
        this.setAttribute("data-rank-motion", "started");
      }
      return animate.call(this, frames, options);
    };
  });
  scores.players = [
    { ...camille, rank: 1, points: 4 },
    { ...alex, rank: 2 },
    sam,
  ];
  await poll();
  await expect(notice).toContainText("Camille prend la tête !");
  await expect(notice).toContainText("+2 points");
  await expect(board.locator("li").first()).toHaveAttribute(
    "data-probe",
    "same-player",
  );
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-probe",
    "same-scene",
  );
  await expect(board.locator("li").first()).toHaveAttribute(
    "data-rank-motion",
    "started",
  );
  await page.clock.fastForward(4001);
  await expect(notice).toHaveCount(0);
  await poll();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(board.getByText("Camille", { exact: true })).toBeVisible();
  await expect(notice).toHaveCount(0);
});

test("TV keeps homonyms independent, queues gains and does not celebrate a rename or tie as an overtake", async ({
  page,
}) => {
  const { board, notice, poll, camille, sam } = await celebrationSetup(page);
  camille.firstName = "Alex";
  await poll();
  await expect(board.getByText("Alex", { exact: true })).toHaveCount(2);
  await expect(notice).toHaveCount(0);
  camille.points = 3;
  camille.rank = 1;
  sam.points = 2;
  await poll();
  await expect(notice).toContainText("Alex a réussi une mission");
  await expect(notice).toHaveAttribute("data-overtake", "false");
  await page.clock.fastForward(4001);
  await expect(notice).toContainText("Sam a réussi une mission");
  await expect(notice).toHaveAttribute("data-overtake", "false");
});

test("TV clears stale celebrations after errors, hidden tabs and revelation", async ({
  page,
}) => {
  const { scores, coffre, board, notice, poll, alex } =
    await celebrationSetup(page);
  alex.points++;
  await poll();
  await expect(notice).toContainText("Alex");
  scores.status = 503;
  await poll();
  await expect(board.getByText("Scores indisponibles")).toBeVisible();
  await expect(notice).toHaveCount(0);
  scores.status = 200;
  alex.points++;
  await poll();
  await expect(board.locator("li").first().locator("strong")).toHaveText("05");
  await expect(notice).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(board).toHaveCount(0);
  alex.points++;
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await poll();
  await expect(board.locator("li").first().locator("strong")).toHaveText("06");
  await expect(notice).toHaveCount(0);
  alex.points++;
  await poll();
  await expect(notice).toContainText("+1 point");
  coffre.state = "revealed";
  scores.showScoresWithMemories = true;
  await poll();
  await expect(
    page.getByText("Le Coffre est ouvert", { exact: true }),
  ).toBeVisible();
  await expect(notice).toHaveCount(0);
  alex.points++;
  await poll();
  await expect(board.locator("li").first().locator("strong")).toHaveText("08");
  await expect(notice).toHaveCount(0);
});

test("TV rank changes respect reduced motion and pagination does not invent a success", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { scores, board, notice, poll, alex, camille } =
    await celebrationSetup(page);
  scores.players.push(
    ...Array.from({ length: 4 }, (_, i) => ({
      id: String(i + 4).repeat(64),
      rank: 4 + i,
      firstName: `Guest ${i}`,
      points: 0,
    })),
  );
  await poll();
  await expect(board.getByText("1 / 2", { exact: true })).toBeVisible();
  await page.clock.runFor(10001);
  await expect(board.getByText("Guest 2", { exact: true })).toBeVisible();
  await expect(notice).toHaveCount(0);
  scores.players = [
    { ...camille, points: 4, rank: 1 },
    { ...alex, rank: 2 },
    ...scores.players.slice(2),
  ];
  await poll();
  await expect(notice).toContainText("Camille prend la tête !");
  await expect(board.locator("li").first()).toContainText("Camille");
  expect(
    await board
      .locator("li")
      .evaluateAll((rows) => rows.flatMap((row) => row.getAnimations()).length),
  ).toBe(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

type WakeLockProbe = {
  requests: number;
  releases: number;
  revoke: () => Promise<void> | undefined;
  resolvePending: () => void;
};
declare global {
  interface Window {
    tvWakeLockProbe: WakeLockProbe;
  }
}

async function mockWakeLock(
  page: Page,
  mode: "allowed" | "denied" | "unsupported" | "delayed" = "allowed",
) {
  await page.addInitScript((mode) => {
    let current: FakeLock | undefined;
    let resolvePending: ((value: FakeLock) => void) | undefined;
    const probe: WakeLockProbe = {
      requests: 0,
      releases: 0,
      revoke: () => current?.release(),
      resolvePending: () => resolvePending?.(createLock()),
    };
    class FakeLock extends EventTarget {
      released = false;
      readonly type = "screen";
      async release() {
        if (this.released) return;
        this.released = true;
        probe.releases++;
        this.dispatchEvent(new Event("release"));
      }
    }
    function createLock() {
      current = new FakeLock();
      return current;
    }
    window.tvWakeLockProbe = probe;
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value:
        mode === "unsupported"
          ? undefined
          : {
              async request(type: string) {
                if (type !== "screen")
                  throw new Error("Unexpected wake lock type");
                probe.requests++;
                if (mode === "denied")
                  throw new DOMException("Refused", "NotAllowedError");
                if (mode === "delayed")
                  return new Promise<FakeLock>((resolve) => {
                    resolvePending = resolve;
                  });
                return createLock();
              },
            },
    });
  }, mode);
}

async function setTvVisibility(page: Page, hidden: boolean) {
  await page.evaluate((hidden) => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: hidden,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: hidden ? "hidden" : "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test("TV wake lock requires a click, preserves the scene and releases on navigation", async ({
  page,
}) => {
  await setup(page);
  await mockWakeLock(page);
  await page.goto("/coffre/tv");
  await expect(page.getByRole("timer")).toBeVisible();
  await page
    .locator("canvas")
    .evaluate((node) => node.setAttribute("data-wake-probe", "same-scene"));
  expect(await page.evaluate(() => window.tvWakeLockProbe.requests)).toBe(0);
  await page
    .getByRole("button", { name: "Garder l’écran allumé", exact: true })
    .click();
  const active = page.getByRole("button", {
    name: "Maintien de l’écran activé",
    exact: true,
  });
  await expect(active).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("main [data-sonner-toast]")).toContainText(
    "Demande acceptée.",
  );
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-wake-probe",
    "same-scene",
  );
  await active.click();
  await expect
    .poll(() => page.evaluate(() => window.tvWakeLockProbe.releases))
    .toBe(1);
  await page
    .getByRole("button", { name: "Garder l’écran allumé", exact: true })
    .click();
  await expect(active).toBeVisible();
  await page.getByRole("link", { name: "Hôtel Blackwood" }).click();
  await expect
    .poll(() => page.evaluate(() => window.tvWakeLockProbe.releases))
    .toBe(2);
});

test("TV wake lock resumes only after opt-in and does not retry system revocation", async ({
  page,
}) => {
  await setup(page);
  await mockWakeLock(page);
  await page.goto("/coffre/tv");
  await expect(page.getByRole("timer")).toBeVisible();
  await setTvVisibility(page, true);
  await setTvVisibility(page, false);
  expect(await page.evaluate(() => window.tvWakeLockProbe.requests)).toBe(0);
  await page
    .getByRole("button", { name: "Garder l’écran allumé", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Maintien de l’écran activé",
      exact: true,
    }),
  ).toBeVisible();
  await setTvVisibility(page, true);
  await expect
    .poll(() => page.evaluate(() => window.tvWakeLockProbe.releases))
    .toBe(1);
  await setTvVisibility(page, false);
  await expect(
    page.getByRole("button", {
      name: "Maintien de l’écran activé",
      exact: true,
    }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.tvWakeLockProbe.requests)).toBe(2);
  await page.evaluate(() => window.tvWakeLockProbe.revoke());
  await expect(
    page.getByRole("button", { name: "Garder l’écran allumé", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("main [data-sonner-toast]")).toContainText(
    "Le navigateur a interrompu",
  );
  await setTvVisibility(page, true);
  await setTvVisibility(page, false);
  expect(await page.evaluate(() => window.tvWakeLockProbe.requests)).toBe(2);
});

for (const mode of ["unsupported", "denied"] as const) {
  test(`TV wake lock explains ${mode} support without interrupting the projection`, async ({
    page,
  }) => {
    await setup(page);
    await mockWakeLock(page, mode);
    await page.goto("/coffre/tv");
    await expect(page.getByRole("timer")).toBeVisible();
    const button = page.getByRole("button", {
      name: "Garder l’écran allumé",
      exact: true,
    });
    await button.click();
    await expect(page.locator("main [data-sonner-toast]")).toContainText(
      mode === "unsupported"
        ? "Ce navigateur ne permet pas"
        : "Le navigateur a refusé",
    );
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(button).toBeEnabled();
    await expect(page.getByRole("timer")).toBeVisible();
  });
}

test("TV wake lock prevents duplicate requests and releases a grant resolved while hidden", async ({
  page,
}) => {
  await setup(page);
  await mockWakeLock(page, "delayed");
  await page.goto("/coffre/tv");
  await expect(page.getByRole("timer")).toBeVisible();
  const button = page.getByRole("button", {
    name: "Garder l’écran allumé",
    exact: true,
  });
  await button.evaluate((node) => {
    (node as HTMLButtonElement).click();
    (node as HTMLButtonElement).click();
  });
  await expect(
    page.getByRole("button", { name: "Demande…", exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate(() => window.tvWakeLockProbe.requests)).toBe(1);
  await setTvVisibility(page, true);
  await page.evaluate(() => window.tvWakeLockProbe.resolvePending());
  await expect
    .poll(() => page.evaluate(() => window.tvWakeLockProbe.releases))
    .toBe(1);
  await expect(button).toHaveAttribute("aria-pressed", "false");
});
