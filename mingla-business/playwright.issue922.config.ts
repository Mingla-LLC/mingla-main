import { defineConfig } from "@playwright/test";

const port = Number(process.env.ISSUE_922_PORT ?? 19422);

export default defineConfig({
  testDir: "./playwright",
  testMatch: /issue922-business-web-actionable(?:\.adversarial)?\.spec\.ts$/,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 11; SM-A725F) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  },
  webServer: {
    cwd: ".",
    command: "node playwright/issue922-static-server.mjs",
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
