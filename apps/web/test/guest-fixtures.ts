import type { Page } from "@playwright/test";

export async function mockUnknownGuest(page: Page) {
  await page.route("**/api/guest-access", (route) =>
    route.fulfill({ json: { hubEnabled: false, profile: null } }),
  );
  await page.route("**/api/guest-access/restore", (route) =>
    route.fulfill({ status: 404, json: { code: "RESPONSE_NOT_FOUND" } }),
  );
}
