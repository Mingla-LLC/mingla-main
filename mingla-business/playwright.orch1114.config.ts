import { defineConfig, devices } from "@playwright/test";

// ORCH-1114 tester runtime gate — dedicated config. The spec self-hosts its
// static server (beforeAll spawns meta-orch-0952-static-server.mjs on
// web-build-orch1114), so NO webServer block here. Real Desktop Chrome →
// navigator.share is undefined, reproducing the original dead-tap condition.
export default defineConfig({
  testDir: "./playwright",
  testMatch: /orch-1114-share-modal-runtime\.spec\.ts$/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
