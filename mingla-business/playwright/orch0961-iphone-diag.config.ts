import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./",
  testMatch: /orch0961-iphone-diag\.spec\.ts$/,
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: { trace: "off" },
});
