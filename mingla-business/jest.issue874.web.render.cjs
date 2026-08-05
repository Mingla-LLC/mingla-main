const nativeConfig = require("./jest.issue874.render.cjs");

module.exports = {
  ...nativeConfig,
  moduleNameMapper: {
    ...nativeConfig.moduleNameMapper,
    "^../../../analytics/phMask$": "<rootDir>/src/analytics/phMask.web.ts",
  },
  testMatch: [
    "**/__tests__/analytics.issue874.tester.adversarial.render.test.tsx",
    "**/__tests__/BrandAnalyticsA11y.issue874.tester.adversarial.render.test.tsx",
    "**/__tests__/AnalyticsHomeTile.issue874.render.test.tsx",
    // #1616 [analytics card collapse] — tester-owned adversarial proof (see the
    // native config); runs on the web pane too because the tile ships there.
    "**/__tests__/AnalyticsHomeTile.issue1616.tester.adversarial.render.test.tsx",
    "**/__tests__/BrandAnalyticsScreen.issue874.render.test.tsx",
    "**/__tests__/RegularsSection.issue874.render.test.tsx",
    "**/__tests__/home.issue874.render.test.tsx",
  ],
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "native"],
  },
};
