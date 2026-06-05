import { defineConfig, devices } from "@playwright/test";

// ORCH-1083 — mobile-profile load-time harness (metric M-2).
// Serves the ALREADY-EXPORTED web-build (the implementor runs `npm run web:export`
// BEFORE and AFTER the change, then runs this harness against each export on the
// SAME machine). The static server is reused from META-ORCH-0952; throttling
// (4x CPU + Fast-3G via CDP) is applied per-test inside the spec (Chromium-only).
//
// Does NOT modify the existing playwright.config.ts / meta_orch_0952 tests.

const port = Number(process.env.ORCH_1083_PORT ?? 43183);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./",
  testMatch: /orch-1083-load-perf\.spec\.ts$/,
  timeout: 600_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "off",
  },
  webServer: {
    // Serve the existing export (do NOT re-export here — the implementor controls
    // which export [before/after] is on disk before launching this harness).
    // cwd pinned to the package root so the static-server + web-build paths resolve
    // regardless of where this config lives.
    cwd: "..",
    command: `node playwright/meta-orch-0952-static-server.mjs web-build ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    // CDP throttling is Chromium-only; M-2 is the Chromium-mobile timed metric.
    { name: "chromium-mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
});
