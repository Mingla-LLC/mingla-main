import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright/issue2769",
  testMatch: /consent-reserve-composition\.(happy|adversarial)\.spec\.ts$/,
  globalSetup: "./playwright/issue2769/globalSetup.mjs",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  webServer: {
    command: "node playwright/issue2769/server.mjs",
    url: "http://127.0.0.1:42769",
    reuseExistingServer: false,
  },
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    viewport: { width: 390, height: 844 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
