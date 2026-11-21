import { defineConfig, devices } from "@playwright/test";

// #2331 — I-PRIVACY-BAR-NEVER-OCCLUDES, the edge-based gate on both sites.
//   • Host web: a real `expo export -p web` with scripts/inject-mobile-blur-css.mjs
//     applied (as in the vercel.json build), at $DIST_2331, served with SPA
//     fallback by playwright/issue2331/static-server.mjs.
//   • usemingla.com: the real production Next build of ../mingla-marketing
//     (`next start`; built first when no build is present).
// Web Build Check runs this after the #2771 lane.
export default defineConfig({
  testDir: "./playwright",
  testMatch: /issue2331(?:-marketing)?\/strip-clearance\.spec\.ts$/,
  // Each page is its own test; three workers run host and marketing pages side
  // by side (the strip audit is read-only, and every test has its own context).
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 3,
  timeout: 600_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  webServer: [
    {
      command: "node playwright/issue2331/static-server.mjs",
      url: "http://127.0.0.1:43233/index.html",
      reuseExistingServer: false,
      env: { DIST_2331: process.env.DIST_2331 ?? "", PORT_2331: "43233" },
    },
    {
      command: "(test -f .next/BUILD_ID || (node scripts/clear-historical-city-build.mjs && npm exec -- next build)) && npm run start -- --port 43234",
      cwd: "../mingla-marketing",
      url: "http://127.0.0.1:43234/",
      reuseExistingServer: false,
      timeout: 600_000,
    },
  ],
  use: { ...devices["Desktop Chrome"], headless: true },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
