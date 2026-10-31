import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { mockUnknownGuest } from "./guest-fixtures";

async function setup(page: Page, initial = "prepared") {
  await mockUnknownGuest(page);
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
  const fixture = {
    state: initial,
    name: null as string | null,
    deadline: "2026-10-31T21:00:00.000Z" as string | null,
    durationSeconds: 3600,
    details: [] as string[],
    deletes: [] as string[],
    commands: [] as { path: string; body: Record<string, unknown> }[],
    deposits: [] as Record<string, unknown>[],
    filters: [] as string[],
    unauthorized: false,
    failDeposit: false,
    rows: [
      {
        id: "private-id",
        visibility: "private",
        frameId: "plain",
        createdAt: "2026-10-31T20:00:00Z",
        hasText: true,
        hasPhoto: false,
        author: { profileId: "profile", firstName: "Alex" },
      },
      {
        id: "public-id",
        visibility: "public",
        frameId: "plain",
        createdAt: "2026-10-31T20:00:00Z",
        hasText: true,
        hasPhoto: false,
        author: null,
      },
    ],
  };
  await page.route("**/api/organizer/**", async (route) => {
    const request = route.request();
    expect(request.headers()["x-organizer-request"]).toBe("1");
    const url = new URL(request.url());
    const path = url.pathname;
    if (fixture.unauthorized) return route.fulfill({ status: 401, json: {} });
    if (path.endsWith("/session"))
      return route.fulfill({
        json: {
          authenticated: true,
          expiresAt: "2030-01-01T00:00:00Z",
          idleExpiresAt: "2030-01-01T00:00:00Z",
        },
      });
    if (path.endsWith("/coffres"))
      return route.fulfill({
        json: {
          coffres:
            fixture.state === "unprepared"
              ? []
              : [
                  {
                    id: 1,
                    state: fixture.state,
                    serverNow: "2026-10-31T20:00:00Z",
                    deadline: fixture.deadline,
                    durationSeconds: fixture.durationSeconds,
                    startedAt: "2026-10-31T20:00:00Z",
                  },
                ],
          nextCursor: null,
        },
      });
    if (path.endsWith("/hub-settings"))
      return route.fulfill({ json: { hubEnabled: true } });
    if (path.endsWith("/contributions") && request.method() === "POST") {
      const body = request.postDataJSON();
      fixture.deposits.push(body);
      expect(request.headers()["x-guest-request"]).toBeUndefined();
      if (fixture.failDeposit) {
        fixture.failDeposit = false;
        return route.abort("failed");
      }
      return route.fulfill({ json: { id: body.id, received: true } });
    }
    if (path.endsWith("/contributions")) {
      fixture.filters.push(url.search);
      return route.fulfill({
        json: {
          contributions: fixture.rows.filter(
            (row) =>
              !url.searchParams.has("visibility") ||
              row.visibility === url.searchParams.get("visibility"),
          ),
          nextCursor: null,
        },
      });
    }
    if (path.includes("/contributions/")) {
      const id = path.split("/").at(-1) ?? "";
      if (request.method() === "DELETE") {
        fixture.deletes.push(id);
        fixture.rows = fixture.rows.filter((row) => row.id !== id);
        return route.fulfill({ status: 204 });
      }
      fixture.details.push(id);
      return route.fulfill({
        json: {
          ...fixture.rows.find((row) => row.id === id),
          text: "Confidential memory",
          photoMediaId: null,
        },
      });
    }
    if (request.method() !== "GET") {
      const body = request.postDataJSON();
      fixture.commands.push({ path, body });
      if (request.method() === "PATCH") fixture.name = body.name;
      if (request.method() === "PUT") {
        fixture.durationSeconds = body.durationSeconds;
        fixture.state = "prepared";
      }
      if (path.endsWith("/start")) fixture.state = "collecting";
      if (path.endsWith("/advance")) fixture.deadline = body.deadline;
      if (path.endsWith("/open")) {
        fixture.state = "revealed";
        fixture.deadline = "2026-10-31T20:00:00.000Z";
      }
    }
    return route.fulfill({
      json: {
        id: fixture.state === "unprepared" ? null : 1,
        name: fixture.name,
        state: fixture.state,
        serverNow: "2026-10-31T20:00:00.000Z",
        durationSeconds:
          fixture.state === "unprepared" ? null : fixture.durationSeconds,
        startedAt: ["collecting", "revealed"].includes(fixture.state)
          ? "2026-10-31T20:00:00.000Z"
          : null,
        deadline: ["collecting", "revealed"].includes(fixture.state)
          ? fixture.deadline
          : null,
      },
    });
  });
  await page.goto("/organisateur/coffre");
  await expect(
    page.getByRole("heading", { name: "Le Coffre.", exact: true }),
  ).toBeVisible();
  return fixture;
}

test("metadata stays sealed until explicit consultation; deletion never reads content", async ({
  page,
}) => {
  const fixture = await setup(page);
  await expect(page.getByText("Alex", { exact: true })).toBeVisible();
  expect(fixture.details).toEqual([]);
  await page
    .getByRole("button", { name: "Supprimer", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  expect(fixture.deletes).toEqual([]);
  await page
    .getByRole("button", { name: "Supprimer", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Confirmer la suppression" }).click();
  await expect(page.getByText("Alex", { exact: true })).toHaveCount(0);
  expect(fixture.deletes).toEqual(["private-id"]);
  expect(fixture.details).toEqual([]);
  await page.getByRole("button", { name: "Consulter", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("Confidential memory", { exact: true }),
  ).toBeVisible();
  expect([...new Set(fixture.details)]).toEqual(["public-id"]);
});

test("prepare, start, advance with server time and confirm irreversible opening", async ({
  page,
}) => {
  const fixture = await setup(page, "unprepared");
  await page.getByRole("button", { name: "1 h", exact: true }).click();
  await page.getByRole("button", { name: "Préparer le Coffre" }).click();
  await page
    .getByRole("button", { name: "Lancer le compte à rebours" })
    .click();
  await expect(page.getByRole("timer")).toBeVisible();
  await page.getByRole("button", { name: "5 min", exact: true }).click();
  await page.getByRole("button", { name: "Avancer l’ouverture" }).click();
  await expect.poll(() => fixture.commands.length).toBe(3);
  const deadline = Date.parse(String(fixture.commands[2]?.body.deadline));
  expect(deadline).toBeGreaterThanOrEqual(Date.parse("2026-10-31T20:05:00Z"));
  expect(deadline).toBeLessThan(Date.parse("2026-10-31T20:05:10Z"));
  await page
    .getByRole("button", { name: "Ouvrir maintenant", exact: true })
    .click();
  expect(fixture.commands).toHaveLength(3);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await page
    .getByRole("button", { name: "Ouvrir maintenant", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirmer l’ouverture" }).click();
  await expect(
    page.getByText("Le Coffre est ouvert", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ouvrir maintenant", exact: true }),
  ).toHaveCount(0);
  expect(
    fixture.commands.map((command) => command.path.split("/").at(-1)),
  ).toEqual(["coffre", "start", "advance", "open"]);
});

test("organizer draft and exact retry survive session revalidation", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page
    .getByRole("button", { name: "Déposer un souvenir", exact: true })
    .click();
  await page.getByLabel("Ton message").fill("A prepared organizer memory");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("Ton message")).toHaveValue(
    "A prepared organizer memory",
  );
  await page.getByRole("button", { name: "Continuer", exact: true }).click();
  fixture.failDeposit = true;
  await page.getByRole("button", { name: "Envoyer au Coffre" }).click();
  await expect.poll(() => fixture.deposits.length).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("Ton message")).toHaveValue(
    "A prepared organizer memory",
  );
  await page
    .getByRole("button", { name: /Retrouver l’envoi à confirmer/ })
    .click();
  await page.getByRole("button", { name: "Réessayer le même envoi" }).click();
  await expect.poll(() => fixture.deposits.length).toBe(2);
  expect(fixture.deposits[1]).toEqual(fixture.deposits[0]);
  await expect(page.getByLabel("Ton message")).toHaveValue("");
});

test("mobile metadata filters remain accessible and expired sessions hide content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const fixture = await setup(page, "revealed");
  await page
    .getByRole("combobox", { name: "Visibilité", exact: true })
    .selectOption("private");
  await expect(
    page.getByRole("button", { name: "Consulter", exact: true }),
  ).toHaveCount(1);
  expect(
    fixture.filters.some(
      (filter) => new URLSearchParams(filter).get("visibility") === "private",
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  fixture.unauthorized = true;
  await page.getByRole("button", { name: "Consulter", exact: true }).click();
  await expect(page).toHaveURL(/\/organisateur\/connexion/);
  await expect(
    page.getByText("Confidential memory", { exact: true }),
  ).toHaveCount(0);
});

test("custom duration accepts human wording and presets stay compact on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const fixture = await setup(page, "unprepared");
  await expect(
    page.getByRole("button", { name: "Préparer le Coffre" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Autre durée", exact: true }).click();
  await page.getByLabel("Durée personnalisée").fill("2 h 30");
  await expect(
    page.getByText("Ouverture dans 2 h 30 min", { exact: true }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Préparer le Coffre" }).click();
  await expect.poll(() => fixture.commands[0]?.body.durationSeconds).toBe(9000);
  await expect(page.getByLabel("Durée personnalisée")).toHaveValue(
    "2 h 30 min",
  );
  await page.getByLabel("Durée personnalisée").fill("169 h");
  await expect(
    page.getByRole("button", { name: "Enregistrer la durée" }),
  ).toBeDisabled();
  await page.getByLabel("Durée personnalisée").fill("30 s");
  await page.getByRole("button", { name: "Enregistrer la durée" }).click();
  await expect.poll(() => fixture.commands[1]?.body.durationSeconds).toBe(30);
  await page.getByRole("button", { name: "1 h", exact: true }).click();
  await expect(page.getByLabel("Durée personnalisée")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "1 h", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("inline Coffre name editing supports cancel, validation and accessible mobile controls", async ({
  page,
}) => {
  const fixture = await setup(page, "collecting");
  await page.setViewportSize({ width: 320, height: 740 });
  const before = fixture.deadline;
  await page
    .getByRole("button", { name: "Renommer le Coffre", exact: true })
    .click();
  const input = page.getByRole("textbox", {
    name: "Nom du Coffre",
    exact: true,
  });
  await expect(input).toBeFocused();
  await input.fill("Cancelled name");
  await input.press("Escape");
  expect(fixture.commands).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Renommer le Coffre", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Renommer le Coffre", exact: true })
    .click();
  await input.fill(" ");
  await page.getByRole("button", { name: "Enregistrer le nom" }).click();
  await expect(
    page.getByText("Choisis un nom de 1 à 80 caractères.", { exact: true }),
  ).toBeVisible();
  expect(fixture.commands).toEqual([]);
  await input.fill("🎃".repeat(80));
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await input.fill("  Les secrets de minuit  ");
  await input.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Les secrets de minuit", exact: true }),
  ).toBeVisible();
  expect(fixture.name).toBe("Les secrets de minuit");
  expect(fixture.deadline).toBe(before);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
