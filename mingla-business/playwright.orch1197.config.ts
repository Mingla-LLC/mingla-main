// ORCH-1197 — real-Chromium SheetWeb viewport measurement (self-contained: loads
// playwright/orch1197/index.html via file:// — no web server).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright/orch1197",
  testMatch: /sheet-web-viewport\.spec\.ts$/,
  globalSetup: "./playwright/orch1197/globalSetup.mjs",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [["list"]],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
