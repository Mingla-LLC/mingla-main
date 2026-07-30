const base = require("./jest.config.cjs");

module.exports = {
  ...base,
  testMatch: [
    "**/src/services/__tests__/venueOrganicInsightsService.issue1421.test.ts",
    "**/src/hooks/__tests__/useVenueOrganicInsights.issue1421.test.ts",
    "**/src/components/venue/__tests__/venueOrganicEngagement.issue1421.test.ts",
  ],
  testPathIgnorePatterns: ["/node_modules/"],
};
