import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function setup(page: Page, organizer = false) {
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
  const state = {
    records: [record(1, "revealed")],
    drafts: [] as { coffreId: number; body: Record<string, unknown> }[],
    details: [] as number[],
    creates: [] as number[],
    failDeposit: false,
    historyReads: 0,
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const coffreId = Number(
      url.searchParams.get("coffreId") ?? state.records.at(-1)?.id,
    );
    const admin = path.startsWith("/api/organizer/");
    if (path === "/api/guest-access")
      return route.fulfill({
        json: {
          hubEnabled: true,
          profile: organizer
            ? null
            : {
                id: "profile",
                firstName: "Alex",
                role: "main",
                avatarMediaId: null,
                hasInvitationResponse: true,
              },
        },
      });
    if (path.endsWith("/session"))
      return route.fulfill({
        json: {
          authenticated: true,
          expiresAt: "2030-01-01T00:00:00Z",
          idleExpiresAt: "2030-01-01T00:00:00Z",
        },
      });
    if (path.endsWith("/hub-settings"))
      return route.fulfill({ json: { hubEnabled: true } });
    if (path.endsWith("/coffres")) {
      state.historyReads++;
      if (request.method() === "POST") {
        const previous = request.postDataJSON().previousCoffreId;
        state.creates.push(previous);
        const next = record(previous + 1, "prepared");
        state.records.push(next);
        return route.fulfill({ json: next });
      }
      return route.fulfill({
        json: { coffres: [...state.records].reverse(), nextCursor: null },
      });
    }
    if (path.endsWith("/coffre"))
      return route.fulfill({
        json: state.records.find((row) => row.id === coffreId),
      });
    if (path.includes("/contributions/") && admin) {
      state.details.push(coffreId);
      return route.fulfill({
        json: {
          id: "old",
          visibility: "private",
          text: "First Coffre private memory",
          photoMediaId: null,
          frameId: "plain",
          createdAt: "2026-10-31T20:00:00Z",
          author: null,
        },
      });
    }
    if (path.endsWith("/contributions")) {
      if (request.method() === "POST") {
        expect(
          request.headers()[admin ? "x-organizer-request" : "x-guest-request"],
        ).toBe("1");
        const body = request.postDataJSON();
        state.drafts.push({ coffreId, body });
        if (state.failDeposit) {
          state.failDeposit = false;
          return route.abort("failed");
        }
        return route.fulfill({ json: { id: body.id, received: true } });
      }
      const contributions =
        coffreId !== 1
          ? []
          : admin
            ? [
                {
                  id: "old",
                  visibility: "private",
                  hasText: true,
                  hasPhoto: false,
                  frameId: "plain",
                  createdAt: "2026-10-31T20:00:00Z",
                  author: {
                    profileId: "old-profile",
                    firstName: "First author",
                  },
                },
              ]
            : [
                {
                  id: "old",
                  text: "First Coffre public memory",
                  photoMediaId: null,
                  frameId: "plain",
                  createdAt: "2026-10-31T20:00:00Z",
                },
              ];
      return route.fulfill({ json: { contributions, nextCursor: null } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return state;
}
function record(id: number, state: string) {
  return {
    id,
    state,
    durationSeconds: 3600,
    serverNow: "2026-10-31T20:00:00Z",
    startedAt: state === "prepared" ? null : "2026-10-31T19:00:00Z",
    deadline:
      state === "prepared"
        ? null
        : state === "collecting"
          ? "2026-10-31T21:00:00Z"
          : "2026-10-31T20:00:00Z",
  };
}

test("new organizer Coffre keeps the previous metadata and explicit content separate", async ({
  page,
}) => {
  const fixture = await setup(page, true);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/organisateur/coffre");
  await page
    .getByRole("button", { name: "Nouveau Coffre", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Le Coffre 2.", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("First author", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Lancer le compte à rebours" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nouveau Coffre", exact: true }),
  ).toHaveCount(0);
  expect(fixture.creates).toEqual([1]);
  const history = page.getByRole("navigation", {
    name: "Les Coffres de la soirée",
  });
  await history.getByRole("button", { name: /Coffre 1/ }).click();
  await expect(page.getByText("First author", { exact: true })).toBeVisible();
  expect(fixture.details).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Nouveau Coffre", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Consulter", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("First Coffre private memory", { exact: true }),
  ).toBeVisible();
  expect(fixture.details.every((id) => id === 1)).toBe(true);
  await page.getByRole("button", { name: "Fermer", exact: true }).click();
  await history.getByRole("button", { name: /Coffre 2/ }).click();
  await expect(page.getByText("First author", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("First Coffre private memory", { exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("guests follow only the latest Coffre and never send an old draft into its successor", async ({
  page,
}) => {
  const fixture = await setup(page);
  fixture.records.push(record(2, "collecting"));
  await page.goto("/coffre");
  await page
    .getByLabel("Un mot pour plus tard.")
    .fill("My second Coffre draft");
  fixture.failDeposit = true;
  await page.getByRole("button", { name: "Continuer", exact: true }).click();
  await page.getByRole("button", { name: "Confier au Coffre" }).click();
  await expect.poll(() => fixture.drafts.length).toBe(1);
  fixture.records[1] = record(2, "revealed");
  fixture.records.push(record(3, "collecting"));
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByRole("heading", { name: "Le Coffre 3.", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Un mot pour plus tard.")).toHaveValue("");
  await expect(
    page.getByRole("navigation", { name: "Les Coffres de la soirée" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("First Coffre public memory", { exact: true }),
  ).toHaveCount(0);
  expect(fixture.historyReads).toBe(0);
  expect(fixture.drafts).toHaveLength(1);
  await page
    .getByLabel("Un mot pour plus tard.")
    .fill("A fresh memory for the third Coffre");
  await page.getByRole("button", { name: "Continuer", exact: true }).click();
  await page.getByRole("button", { name: "Confier au Coffre" }).click();
  await expect.poll(() => fixture.drafts.length).toBe(2);
  expect(fixture.drafts[0]?.coffreId).toBe(2);
  expect(fixture.drafts[1]?.coffreId).toBe(3);
  expect(fixture.drafts[1]?.body.id).not.toBe(fixture.drafts[0]?.body.id);
  await expect(page.getByLabel("Un mot pour plus tard.")).toHaveValue("");
});
