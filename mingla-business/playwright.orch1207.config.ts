// ORCH-1207 — real-Chromium SheetWeb opacity + drag-to-dismiss measurement
// (self-contained: loads playwright/orch1207/index.html via file:// — no web
// server). Mirrors playwright.orch1197.config.ts.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright/orch1207",
  testMatch: /sheet-web-dismiss-opaque\.spec\.ts$/,
  globalSetup: "./playwright/orch1207/globalSetup.mjs",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [["list"]],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
