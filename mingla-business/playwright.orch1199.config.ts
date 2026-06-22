// ORCH-1199 — real-Chromium SheetWeb viewport measurement on an ANDROID / Samsung
// profile (mobile UA + touch + deviceScaleFactor). Self-contained: loads
// playwright/orch1199/index.html via file:// — no web server.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright/orch1199",
  testMatch: /sheet-android-viewport\.spec\.ts$/,
  globalSetup: "./playwright/orch1199/globalSetup.mjs",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [["list"]],
  projects: [
    {
      name: "android-chrome",
      use: {
        // Galaxy S20 descriptor → Android mobile UA + touch + devicePixelRatio,
        // overridden per-test viewport/visualViewport in the spec.
        ...devices["Galaxy S5"],
        userAgent:
          "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
  ],
});
