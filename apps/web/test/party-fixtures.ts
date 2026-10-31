import type { Page } from "@playwright/test";
export async function mockPartyOpen(page: Page) {
  await page.route("**/api/party-access", (route) =>
    route.fulfill({
      json: {
        opensAt: "2026-10-31T20:00:00.000Z",
        serverNow: "2026-10-31T20:00:00.000Z",
        isOpen: true,
      },
    }),
  );
}
