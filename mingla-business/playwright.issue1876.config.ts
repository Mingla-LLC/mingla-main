import { defineConfig, devices } from "@playwright/test";

/**
 * Issue #1876 — real-Chromium reachability gate for the terminal recovery card.
 * Self-contained: the spec fulfils every request itself, so there is no
 * `webServer` and no export step. iPhone 13 is the geometry the defect was
 * measured on (390x664 visible), so it is the geometry the fix is proved on.
 *
 * Run: cd mingla-business && npx playwright test -c playwright.issue1876.config.ts
 */
export default defineConfig({
  testDir: "./playwright/issue1876",
  testMatch: /boot-error-reachability\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [["list"]],
  // `devices["iPhone 13"]` carries `browserName: "webkit"`, and no WebKit binary
  // is in the local Playwright cache. The defect is CSS-layout-deterministic
  // (`height:100%` + static flow + `overflow:hidden` propagation), so Chromium at
  // iPhone 13 geometry is the honest measurement; WebKit coverage is a gap, not a
  // claim. Overriding the browser AFTER the spread is deliberate.
  projects: [
    { name: "iphone-13", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
});
