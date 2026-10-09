import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: "pnpm dev --port 5174",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: !process.env.CI,
  },
});
