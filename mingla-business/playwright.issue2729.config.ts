import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright/issue2729",
  testMatch: /public-venue-scroll-owner\.(happy|adversarial)\.spec\.ts$/,
  globalSetup: "./playwright/issue2729/globalSetup.mjs",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
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
});
