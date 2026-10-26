import { defineConfig, devices } from "@playwright/test";

// #2331 — privacy bar occlusion + data-rule proofs.
//   • Real `expo export -p web` at $DIST_2331, built with
//     EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54331 and fixture vendor ids
//     (see playwright/issue2331/README in the spec header). Supabase is mocked
//     in-test and every other origin is fulfilled locally or aborted.
//   • The #2769 real-source venue harness (PublicVenueScreen + the real bar).
export default defineConfig({
  testDir: "./playwright/issue2331",
  testMatch: /privacy-bar\.(happy|adversarial)\.spec\.ts$/,
  globalSetup: "./playwright/issue2769/globalSetup.mjs",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  webServer: [
    {
      command: "node playwright/issue2331/static-server.mjs",
      url: "http://127.0.0.1:8331/index.html",
      reuseExistingServer: false,
      env: { DIST_2331: process.env.DIST_2331 ?? "", PORT_2331: "8331" },
    },
    {
      command: "node playwright/issue2769/server.mjs",
      url: "http://127.0.0.1:42769",
      reuseExistingServer: false,
    },
  ],
  use: { ...devices["Desktop Chrome"], headless: true },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
