const path = require("path");
const businessRoot = path.resolve(__dirname, "../mingla-business");
const businessModules = path.join(businessRoot, "node_modules");
const base = require(path.join(businessRoot, "jest.issue1561.web.render.cjs"));

module.exports = {
  ...base,
  rootDir: __dirname,
  modulePaths: [businessModules],
  moduleNameMapper: {
    ...base.moduleNameMapper,
    "^react$": path.join(businessModules, "react"),
    "^react/(.*)$": path.join(businessModules, "react", "$1"),
    "^react-native$": path.join(businessModules, "react-native-web"),
    "^react-test-renderer$": path.join(businessModules, "react-test-renderer"),
    "^react-test-renderer/(.*)$": path.join(
      businessModules,
      "react-test-renderer",
      "$1",
    ),
  },
  testMatch: [
    "**/__tests__/publicHeroAccessibility.issue2774.happy.test.tsx",
    "**/__tests__/publicHeroAccessibility.issue2774.adversarial.test.tsx",
    "**/__tests__/publicHeroAccessibility.issue2788.singleReactOwner.test.cjs",
  ],
};
