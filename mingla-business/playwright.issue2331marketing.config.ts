import { defineConfig, devices } from "@playwright/test";

// #2331 — usemingla.com privacy bar + /links (real Next app, dev server).
// Vendor ids are fixtures; vendor requests are fulfilled locally and recorded.
export default defineConfig({
  testDir: "./playwright/issue2331-marketing",
  testMatch: /marketing-privacy-bar\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  webServer: {
    command: "NEXT_PUBLIC_POSTHOG_KEY=phc_issue2331 NEXT_PUBLIC_GA4_MEASUREMENT_ID=G-ISSUE2331 npx next dev -H 127.0.0.1 -p 43231",
    cwd: "../mingla-marketing",
    url: "http://127.0.0.1:43231/links",
    reuseExistingServer: false,
    timeout: 240_000,
  },
  use: { ...devices["Desktop Chrome"], headless: true, baseURL: "http://127.0.0.1:43231" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
