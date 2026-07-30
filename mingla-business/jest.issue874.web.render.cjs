const nativeConfig = require("./jest.issue874.render.cjs");

module.exports = {
  ...nativeConfig,
  moduleNameMapper: {
    ...nativeConfig.moduleNameMapper,
    "^../../../analytics/phMask$": "<rootDir>/src/analytics/phMask.web.ts",
  },
  testMatch: [
    "**/__tests__/AnalyticsHomeTile.issue874.render.test.tsx",
    "**/__tests__/BrandAnalyticsScreen.issue874.render.test.tsx",
    "**/__tests__/home.issue874.render.test.tsx",
  ],
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "native"],
  },
};
