/**
 * #2262 [composer-responsive-layout] — the composer geometry config.
 *
 * Separate from `playwright.config.ts` so it changes nothing about the existing
 * browser suite. All FOUR viewports are projects because the defect this gate
 * exists for was present at every one of them and by different amounts — 9px of
 * overlap at 1440x900, 129px at 1024x700, 89px below the fold at 390x750 and
 * 181px at 320x568. A single-viewport run would have called three of those a
 * pass.
 *
 * Never a mid-test resize: CDP `Emulation.setDeviceMetricsOverride` fires
 * neither `window.resize` nor `visualViewport.resize`, so react-native-web's
 * `Dimensions` does not update and a resized page reports a stale layout.
 * Each project reloads.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright/issue2262",
  testMatch: /composer-viewport-fit\.spec\.ts$/,
  globalSetup: "./playwright/issue2262/globalSetup.mjs",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], headless: true },
  projects: [
    {
      name: "desktop-1440x900",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // The worst measured failure, and a SHORT window rather than a narrow one:
      // 129px of footer-over-content overlap plus 77px unreachable behind
      // `overflow:hidden` with no scrollbar.
      name: "desktop-1024x700",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 700 } },
    },
    {
      name: "mobile-390x750",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 750 } },
    },
    {
      // Narrower than any shipping iPhone. The action row's HORIZONTAL fit was
      // DISPROVEN as a defect here (0px overflow, no label clipped); the
      // vertical failure was 181px below the fold.
      name: "mobile-320x568",
      use: { ...devices["Desktop Chrome"], viewport: { width: 320, height: 568 } },
    },
  ],
});
