const nativeConfig = require("./jest.issue1403.render.cjs");

module.exports = {
  ...nativeConfig,
  testMatch: [
    "**/__tests__/ListingInsightsScreen.issue1403.web.render.test.tsx",
  ],
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "native"],
  },
};
