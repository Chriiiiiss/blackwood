import { expect, type Page, test } from "@playwright/test";
import { mockUnknownGuest } from "./guest-fixtures";

const thriller = {
  id: "0123456789012345678901",
  title: "Thriller",
  artists: ["Michael Jackson"],
  coverUrl: null,
  spotifyUrl: "https://open.spotify.com/track/0123456789012345678901",
};
async function setup(page: Page) {
  await mockUnknownGuest(page);
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
    track: thriller as typeof thriller | null,
    status: 200,
    reads: 0,
    connected: true,
    configured: true,
    disconnects: 0,
    id: 1,
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/tv/spotify/current") {
      fixture.reads++;
      return route.fulfill({
        status: fixture.status,
        json: { track: fixture.track },
      });
    }
    if (path === "/api/organizer/spotify/status")
      return route.fulfill({
        json: {
          configured: fixture.configured,
          connected: fixture.connected,
          redirectUri:
            "https://blackwood.example/api/organizer/spotify/callback",
        },
      });
    if (path === "/api/organizer/spotify/connection") {
      expect(request.method()).toBe("DELETE");
      expect(request.headers()["x-organizer-request"]).toBe("1");
      fixture.disconnects++;
      fixture.connected = false;
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/organizer/session")
      return route.fulfill({
        json: {
          authenticated: true,
          expiresAt: "2030-01-01T00:00:00Z",
          idleExpiresAt: "2030-01-01T00:00:00Z",
        },
      });
    const coffre = {
      id: fixture.id,
      name: null,
      state: "collecting",
      serverNow: "2026-10-31T20:00:00Z",
      deadline: "2026-10-31T21:00:00Z",
      durationSeconds: 3600,
      startedAt: "2026-10-31T20:00:00Z",
    };
    if (path === "/api/organizer/coffres")
      return route.fulfill({ json: { coffres: [coffre], nextCursor: null } });
    if (path === "/api/tv/coffre" || path === "/api/organizer/coffre")
      return route.fulfill({ json: coffre });
    return route.fulfill({ status: 404, json: {} });
  });
  return fixture;
}

test("TV shows each new Spotify song for six seconds without repeating it on polls or pauses", async ({
  page,
}) => {
  const f = await setup(page);
  await page.clock.install();
  await page.goto("/coffre/tv");
  const card = page.getByRole("status", { name: "Morceau en cours" });
  await expect(card).toContainText("Thriller");
  await expect(card.getByRole("link")).toHaveAttribute(
    "href",
    thriller.spotifyUrl,
  );
  await expect(page.getByRole("timer")).toBeVisible();
  await page.clock.fastForward(5100);
  await expect.poll(() => f.reads).toBeGreaterThan(1);
  await page.clock.fastForward(1100);
  await expect(card).toHaveCount(0);
  f.track = null;
  await page.clock.fastForward(5100);
  await expect.poll(() => f.reads).toBeGreaterThan(2);
  f.track = thriller;
  await page.clock.fastForward(5100);
  await expect.poll(() => f.reads).toBeGreaterThan(3);
  await expect(card).toHaveCount(0);
  f.track = {
    ...thriller,
    id: "1123456789012345678901",
    title: "Somebody’s Watching Me",
    artists: ["Rockwell"],
  };
  await page.clock.fastForward(5100);
  await expect(card).toContainText("Rockwell");
  await page.screenshot({ path: test.info().outputPath("spotify-tv.png") });
  f.status = 503;
  await page.clock.fastForward(5100);
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("timer")).toBeVisible();
});

test("Spotify alert remains dismissed across Coffre changes and supports reduced motion", async ({
  page,
}) => {
  const f = await setup(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.goto("/coffre/tv");
  const card = page.getByRole("status", { name: "Morceau en cours" });
  await expect(card).toBeVisible();
  expect(
    await card.evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
  await page.clock.fastForward(6200);
  await expect(card).toHaveCount(0);
  f.id = 2;
  await page.clock.fastForward(5100);
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("timer")).toBeVisible();
});

test("organizer can disconnect Spotify and sees a toast after the authorization callback", async ({
  page,
}) => {
  const f = await setup(page);
  await page.goto("/organisateur/coffre?spotify=connected");
  await expect(
    page.getByText("Spotify connecté.", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/organisateur\/coffre$/);
  await page
    .getByRole("button", { name: "Déconnecter Spotify", exact: true })
    .click();
  await expect(
    page.getByText("Spotify déconnecté.", { exact: true }),
  ).toBeVisible();
  expect(f.disconnects).toBe(1);
  await expect(
    page.getByRole("button", {
      name: "Connecter mon compte Spotify",
      exact: true,
    }),
  ).toBeVisible();
  f.configured = false;
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Connecter mon compte Spotify",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByText("Configurer l’application Spotify", { exact: true })
    .click();
  await expect(page.getByLabel("URL de retour Spotify")).toHaveValue(
    "https://blackwood.example/api/organizer/spotify/callback",
  );
});
