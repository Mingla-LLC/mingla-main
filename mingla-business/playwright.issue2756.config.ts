import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright/issue2756",
  testMatch: /public-venue-refresh-focus\.spec\.ts$/,
  globalSetup: "./playwright/issue2756/globalSetup.mjs",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"] },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
