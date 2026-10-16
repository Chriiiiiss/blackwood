import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { mockUnknownGuest } from "./guest-fixtures";

test.beforeEach(async ({ page }) => mockUnknownGuest(page));

const storageKey = "blackwood.invitation-response-id";
const responseId = "61601657-b814-4a20-af61-8cfe57a679a3";
const endpoint = "**/api/invitation-responses/*";
const savedResponse = {
  id: responseId,
  firstName: "Alex",
  attendance: "to_confirm",
  plusOne: true,
  ideas: "A haunted lobby!",
};

async function seedIdentifier(page: Page, id = responseId) {
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: storageKey, value: id },
  );
}

async function chooseAttendance(page: Page, name: string) {
  await page
    .getByRole("group", { name: "Tu viens ?", exact: true })
    .getByRole("radio", { name, exact: true })
    .check();
}

async function choosePlusOne(page: Page, plusOne: boolean) {
  await page
    .getByRole("group", { name: "Solo bolo ?", exact: true })
    .getByRole("radio", {
      name: plusOne ? "Je viens à deux" : "Oui, solo",
      exact: true,
    })
    .check();
}

test("requires explicit choices and resets the companion after declining", async ({
  page,
}) => {
  const submissions: unknown[] = [];
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 404,
        json: { code: "RESPONSE_NOT_FOUND" },
      });
      return;
    }
    const body = route.request().postDataJSON();
    submissions.push(body);
    await route.fulfill({
      json: { ...body, id: route.request().url().split("/").at(-1) },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Solo bolo ?" })).toBeHidden();
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(
    page.getByRole("textbox", { name: "Ton prénom" }),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toBeFocused();
  expect(submissions).toHaveLength(0);

  await page.getByRole("textbox", { name: "Ton prénom" }).fill("  Alex  ");
  await chooseAttendance(page, "Oui");
  await choosePlusOne(page, true);
  await chooseAttendance(page, "Non");
  await expect(page.getByRole("group", { name: "Solo bolo ?" })).toBeHidden();
  await chooseAttendance(page, "À confirmer");
  await expect(
    page
      .getByRole("group", { name: "Solo bolo ?" })
      .getByRole("radio", { checked: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  expect(submissions).toHaveLength(0);
  await expect(
    page
      .getByRole("group", { name: "Solo bolo ?" })
      .getByRole("radio", { name: "Oui, solo", exact: true }),
  ).toBeFocused();
  await choosePlusOne(page, false);
  await page
    .getByRole("textbox", { name: "Une idée pour la soirée ?" })
    .fill(" \n ");
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(
    page.getByText("Ta réponse a bien été enregistrée. Merci !", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Merci pour ta réponse !" }),
  ).toBeFocused();
  expect(submissions).toEqual([
    { firstName: "Alex", attendance: "to_confirm", plusOne: false, ideas: "" },
  ]);
});

test("preserves input and the persisted identifier across a failed save and retry", async ({
  page,
}) => {
  const ids: string[] = [];
  let releaseRequest: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 404, json: {} });
      return;
    }
    expect(route.request().postDataJSON().plusOne).toBe(true);
    const id = route.request().url().split("/").at(-1) ?? "";
    ids.push(id);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), storageKey),
    ).toBe(id);
    if (ids.length === 1) {
      await pending;
      await route.fulfill({
        status: 500,
        json: { code: "RESPONSE_UNAVAILABLE" },
      });
    } else {
      await route.fulfill({ json: { ...route.request().postDataJSON(), id } });
    }
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Ton prénom" }).fill("Morgan");
  await chooseAttendance(page, "Oui");
  await choosePlusOne(page, true);
  await page
    .getByRole("textbox", { name: "Une idée pour la soirée ?" })
    .fill("Candlelit reception");
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect.poll(() => ids.length).toBe(1);
  await expect(
    page.getByRole("button", { name: /enregistrement/i }),
  ).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: "Ton prénom" }),
  ).toBeDisabled();
  releaseRequest?.();
  await expect(
    page.getByText("Impossible d’enregistrer ta réponse. Réessaie.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Une idée pour la soirée ?" }),
  ).toHaveValue("Candlelit reception");
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toHaveValue(
    "Morgan",
  );
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(
    page.getByRole("button", { name: "Modifier ma réponse" }),
  ).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
});

test("restores a saved response and edits the same record", async ({
  page,
}) => {
  await seedIdentifier(page);
  await page.clock.install();
  let reads = 0;
  let current = { ...savedResponse };
  await page.route(endpoint, async (route) => {
    expect(route.request().url()).toContain(responseId);
    if (route.request().method() === "PUT")
      current = { ...current, ...route.request().postDataJSON() };
    else reads++;
    await route.fulfill({ json: current });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Modifier ma réponse" }).click();
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toHaveValue(
    "Alex",
  );
  await expect(
    page.getByRole("textbox", { name: "Une idée pour la soirée ?" }),
  ).toHaveValue("A haunted lobby!");
  const initialReads = reads;
  await page.getByRole("textbox", { name: "Ton prénom" }).fill("Morgan");
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
  });
  await page.clock.runFor(100);
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toHaveValue(
    "Morgan",
  );
  expect(reads).toBe(initialReads);
  await chooseAttendance(page, "Non");
  await page.getByRole("button", { name: /envoyer/i }).click();
  await expect(
    page.getByText("Ta réponse a bien été mise à jour.", { exact: true }),
  ).toBeVisible();
  expect(current.plusOne).toBe(false);
  await page.getByRole("button", { name: "Modifier ma réponse" }).click();
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toHaveValue(
    "Morgan",
  );
  expect(reads).toBe(initialReads);
  await page.reload();
  await page.getByRole("button", { name: "Modifier ma réponse" }).click();
  await expect(
    page.getByRole("radio", { name: "Non", exact: true }),
  ).toBeChecked();
  await expect(page.getByRole("group", { name: "Solo bolo ?" })).toBeHidden();
});

test("a failed restore cannot overwrite the saved response and can be retried", async ({
  page,
}) => {
  await seedIdentifier(page);
  await page.clock.install();
  let reads = 0;
  let unavailable = true;
  await page.route(endpoint, async (route) => {
    reads++;
    expect(route.request().method()).toBe("GET");
    await route.fulfill(
      unavailable ? { status: 500, json: {} } : { json: savedResponse },
    );
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Envoyer à Chris" }),
  ).toBeHidden();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBe(responseId);
  const initialReads = reads;
  await page.clock.fastForward(30_000);
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
  });
  await page.clock.runFor(100);
  expect(reads).toBe(initialReads);
  unavailable = false;
  await page.getByRole("button", { name: "Réessayer" }).click();
  await expect(
    page.getByRole("button", { name: "Modifier ma réponse" }),
  ).toBeVisible();
  expect(reads).toBe(initialReads + 1);
});

test("retries a blocked storage read before restoring the saved response", async ({
  page,
}) => {
  await seedIdentifier(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (!(window as Window & { allowRead?: boolean }).allowRead)
        throw new DOMException("Storage blocked", "SecurityError");
      return original.call(this, key);
    };
  });
  let reads = 0;
  await page.route(endpoint, async (route) => {
    reads++;
    expect(route.request().url()).toContain(responseId);
    await route.fulfill({ json: savedResponse });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Envoyer à Chris" }),
  ).toBeHidden();
  expect(reads).toBe(0);
  await page.evaluate(() => {
    (window as Window & { allowRead?: boolean }).allowRead = true;
  });
  await page.getByRole("button", { name: "Réessayer" }).click();
  await expect(
    page.getByRole("button", { name: "Modifier ma réponse" }),
  ).toBeVisible();
  expect(reads).toBeGreaterThan(0);
});

test("offline saves fail visibly and can be retried with the same identifier", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Ton prénom" }).fill("Alex");
  await chooseAttendance(page, "Non");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(
    page.getByText("Impossible d’enregistrer ta réponse. Réessaie.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Envoyer à Chris" }),
  ).toBeEnabled();
  const id = await page.evaluate(
    (key) => localStorage.getItem(key),
    storageKey,
  );
  expect(id).toBeTruthy();
  await context.setOffline(false);
  await page.route(endpoint, async (route) => {
    expect(route.request().method()).toBe("PUT");
    expect(route.request().url()).toContain(id);
    await route.fulfill({ json: { ...route.request().postDataJSON(), id } });
  });
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(
    page.getByRole("button", { name: "Modifier ma réponse" }),
  ).toBeVisible();
});

test("a missing saved response reuses its identifier on first save", async ({
  page,
}) => {
  await seedIdentifier(page);
  await page.route(endpoint, async (route) => {
    expect(route.request().url()).toContain(responseId);
    await route.fulfill(
      route.request().method() === "GET"
        ? { status: 404, json: { code: "RESPONSE_NOT_FOUND" } }
        : { json: { ...route.request().postDataJSON(), id: responseId } },
    );
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Ton prénom" }).fill("Alex");
  await chooseAttendance(page, "Non");
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(
    page.getByText("Ta réponse a bien été enregistrée. Merci !", {
      exact: true,
    }),
  ).toBeVisible();
});

test("storage failure prevents an unrecoverable submission and allows recovery", async ({
  page,
}) => {
  let requests = 0;
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (!(window as Window & { allowStorage?: boolean }).allowStorage)
        throw new DOMException("Storage blocked", "SecurityError");
      original.call(this, key, value);
    };
  });
  await page.route(endpoint, async (route) => {
    requests++;
    await route.fulfill({
      json: {
        ...route.request().postDataJSON(),
        id: route.request().url().split("/").at(-1),
      },
    });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Ton prénom" }).fill("Alex");
  await chooseAttendance(page, "Non");
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Autorise le stockage dans ton navigateur",
  );
  expect(requests).toBe(0);
  await page.evaluate(() => {
    (window as Window & { allowStorage?: boolean }).allowStorage = true;
  });
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toHaveValue(
    "Alex",
  );
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(
    page.getByRole("button", { name: "Modifier ma réponse" }),
  ).toBeVisible();
  expect(requests).toBe(1);
});

test("text limits count Unicode code points and server validation preserves the draft", async ({
  page,
}) => {
  let submissions = 0;
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 404, json: {} });
      return;
    }
    submissions++;
    await route.fulfill({
      status: 400,
      json: {
        code: "VALIDATION_ERROR",
        errors: [{ field: "firstName", message: "Invalid name" }],
      },
    });
  });
  await page.goto("/");
  const name = page.getByRole("textbox", { name: "Ton prénom" });
  const ideas = page.getByRole("textbox", {
    name: "Une idée pour la soirée ?",
  });
  await name.fill("🎃".repeat(51));
  await chooseAttendance(page, "Non");
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  expect(submissions).toBe(0);
  await name.fill(` ${"🎃".repeat(50)} `);
  await ideas.fill("🎃".repeat(1001));
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(ideas).toHaveAttribute("aria-invalid", "true");
  expect(submissions).toBe(0);
  await ideas.fill("🎃".repeat(1000));
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect.poll(() => submissions).toBe(1);
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(ideas).toHaveValue("🎃".repeat(1000));
});

test("a stalled save times out and retries with the same identifier", async ({
  page,
}) => {
  const ids: string[] = [];
  await page.clock.install();
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 404, json: {} });
      return;
    }
    const id = route.request().url().split("/").at(-1) ?? "";
    ids.push(id);
    if (ids.length > 1)
      await route.fulfill({ json: { ...route.request().postDataJSON(), id } });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Ton prénom" }).fill("Alex");
  await chooseAttendance(page, "Non");
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect.poll(() => ids.length).toBe(1);
  await page.clock.fastForward(15_001);
  await expect(
    page.getByText("Impossible d’enregistrer ta réponse. Réessaie.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(
    page.getByRole("button", { name: "Modifier ma réponse" }),
  ).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
});

test("replaces a malformed stored identifier before contacting the API", async ({
  page,
}) => {
  await seedIdentifier(page, "invalid-id");
  await page.route(endpoint, async (route) => {
    const id = route.request().url().split("/").at(-1);
    expect(id).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
    );
    await route.fulfill(
      route.request().method() === "GET"
        ? { status: 404, json: {} }
        : { json: { ...route.request().postDataJSON(), id } },
    );
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Ton prénom" }).fill("Alex");
  await chooseAttendance(page, "Non");
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(
    page.getByRole("button", { name: "Modifier ma réponse" }),
  ).toBeVisible();
});

test("attendance reactions happen before submission, expire and preserve the selected response", async ({
  page,
}) => {
  let submissions = 0;
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "PUT") submissions++;
    await route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/");
  const reaction = page.getByTestId("attendance-reaction");
  await expect(reaction).toHaveCount(0);
  await chooseAttendance(page, "Oui");
  await choosePlusOne(page, false);
  await expect(reaction).toHaveCount(0);
  await chooseAttendance(page, "Non");
  await expect(reaction).toBeVisible();
  await expect
    .poll(() =>
      reaction
        .locator("img")
        .evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
    )
    .toBe(true);
  expect(
    await reaction.evaluate(
      (element) => getComputedStyle(element).animationName,
    ),
  ).toBe("none");
  expect(
    await reaction.evaluate(
      (element) => getComputedStyle(element).pointerEvents,
    ),
  ).toBe("none");
  await page.getByRole("textbox", { name: "Ton prénom" }).fill("Alex");
  await expect(
    page.getByRole("radio", { name: "Non", exact: true }),
  ).toBeChecked();
  await page.clock.fastForward(4_001);
  await expect(reaction).toHaveCount(0);
  await chooseAttendance(page, "À confirmer");
  await expect(reaction).toBeVisible();
  await chooseAttendance(page, "Non");
  await page.clock.fastForward(3_000);
  await expect(reaction).toBeVisible();
  await chooseAttendance(page, "Oui");
  await expect(reaction).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toHaveValue(
    "Alex",
  );
  expect(submissions).toBe(0);
});

test("has accessible fields and fits narrow screens with reduced motion", async ({
  page,
  browserName,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Ton prénom" })).toBeVisible();
  await chooseAttendance(page, "À confirmer");
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await expect(
    page.getByRole("button", { name: "Envoyer à Chris" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Ton prénom" }).focus();
  // macOS WebKit uses Option-Tab to include non-text controls in navigation.
  await page.keyboard.press(
    browserName === "webkit" && process.platform === "darwin"
      ? "Alt+Tab"
      : "Tab",
  );
  await expect(
    page
      .getByRole("group", { name: "Tu viens ?", exact: true })
      .getByRole("radio", { name: "À confirmer", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(
    page
      .getByRole("group", { name: "Tu viens ?", exact: true })
      .getByRole("radio", { name: "Non", exact: true }),
  ).toBeChecked();
});

test("HTTP LAN browsers without randomUUID persist a secure v4 identifier before save and reuse it", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    }),
  );
  const identifiers: string[] = [];
  await page.route(endpoint, async (route) => {
    const id = route.request().url().split("/").at(-1) ?? "";
    if (route.request().method() === "GET")
      return route.fulfill({ status: 404, json: {} });
    identifiers.push(id);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), storageKey),
    ).toBe(id);
    return route.fulfill(
      identifiers.length === 1
        ? { status: 500, json: {} }
        : { json: { ...route.request().postDataJSON(), id } },
    );
  });
  await page.goto("/invitation");
  await page.getByLabel("Ton prénom", { exact: true }).fill("LAN test");
  await chooseAttendance(page, "Non");
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Impossible d’enregistrer",
  );
  await page.getByRole("button", { name: "Envoyer à Chris" }).click();
  await expect(
    page.getByRole("heading", { name: "Merci pour ta réponse !" }),
  ).toBeVisible();
  expect(identifiers).toHaveLength(2);
  expect(identifiers[0]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(identifiers[1]).toBe(identifiers[0]);
});
