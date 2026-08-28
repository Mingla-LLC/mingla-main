import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.ISSUE_2768_PORT ?? 27680);

export default defineConfig({
  testDir: "./playwright/issue2768",
  testMatch: /public-venue-hit-target-fidelity\.(happy|adversarial)\.spec\.ts$/,
  globalSetup: "./playwright/issue2768/globalSetup.mjs",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    headless: true,
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  },
  projects: [
    {
      name: "phone-chromium-touch",
      use: {
        ...devices["Desktop Chrome"],
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: {
    cwd: ".",
    command: "node playwright/issue2768/serve.mjs",
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
