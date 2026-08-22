import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright/issue2399",
  testMatch: /chooser-web-dom\.spec\.ts$/,
  globalSetup: "./playwright/issue2399/globalSetup.mjs",
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"] },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
