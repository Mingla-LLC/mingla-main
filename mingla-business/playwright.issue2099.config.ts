/**
 * #2099 §D6 — the Business browser-runtime config (Amendment 4 §D8).
 *
 * Separate from `playwright.config.ts` so it changes nothing about the existing
 * browser suite. Both §D6 viewports are projects, because the defect this gate
 * exists for was present at BOTH and a single-viewport run would have missed
 * the `stay` option sitting off the top at 390x844.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright/issue2099",
  testMatch: /pending-identity-correction\.spec\.ts$/,
  globalSetup: "./playwright/issue2099/globalSetup.mjs",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], headless: true },
  projects: [
    {
      name: "desktop-1280x800",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile-web-390x844",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
});
