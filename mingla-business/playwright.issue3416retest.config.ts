import { defineConfig, devices } from "@playwright/test";

// PR #3416 independent retest. Requires a local `expo export -p web` built with
// EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 at $DIST_3416. All network
// except the static server and the in-test Supabase mock is aborted.
export default defineConfig({
  testDir: "./playwright/issue3416-retest",
  workers: 1,
  timeout: 120_000,
  reporter: [["list"]],
  webServer: {
    command: "node playwright/issue3416-retest/static-server.mjs",
    url: "http://127.0.0.1:8416/index.html",
    reuseExistingServer: true,
    env: { DIST_3416: process.env.DIST_3416 ?? "", PORT_3416: "8416" },
  },
  projects: [
    { name: "mobile-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
});
