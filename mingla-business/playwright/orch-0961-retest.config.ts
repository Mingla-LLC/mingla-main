import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.ORCH_0961_PORT ?? 43197);

export default defineConfig({
  testDir: "./",
  testMatch: /orch-0961-retest\.spec\.ts$/,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "webkit-iphone-13", use: { ...devices["iPhone 13"] } },
  ],
});
