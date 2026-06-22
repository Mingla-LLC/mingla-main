// ORCH-1210 — real-Chromium TopSheetWeb swipe-up-to-dismiss measurement
// (self-contained: loads playwright/orch1210/index.html via file:// — no web
// server). Mirrors playwright.orch1207.config.ts.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright/orch1210",
  testMatch: /topsheet-web-swipeup\.spec\.ts$/,
  globalSetup: "./playwright/orch1210/globalSetup.mjs",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [["list"]],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
