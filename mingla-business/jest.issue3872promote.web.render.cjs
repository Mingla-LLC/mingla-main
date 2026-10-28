// #3872 Promote overview redesign — web render proofs.
//
// Mounts the REAL Program kit (GlassCard, ListGroup, StatStrip, ListRow) and
// the REAL BlastPromotionOverview through react-native-web on a
// react-test-renderer root, so the styles are resolved by react-native-web's
// own StyleSheet: a `StyleSheet.create` style becomes a CSS class and a plain
// object becomes an inline style. That split is the bug the GlassCard
// padding proof pins (inline `{ padding }` zeroed every padding longhand the
// card's caller set, on web only), so it cannot be proved under the default
// config, which maps `react-native` to a lightweight mock.
//
// CI: the #1486 dormant render suites workflow.
//
// Run (from mingla-business/):
//   npx jest --config jest.issue3872promote.web.render.cjs --ci --maxWorkers=2
/* global __dirname */
const path = require("path");

const businessRoot = __dirname;

module.exports = {
  rootDir: businessRoot,
  testEnvironment: "node",
  testTimeout: 20000,
  globals: { __DEV__: true },
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(businessRoot, "jest.issue2323.babel.cjs") },
    ],
  },
  testMatch: ["**/__tests__/issue_3872_promote_*.web.render.test.tsx"],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|react-native-web|@react-native-community|expo|@expo)",
  ],
  modulePaths: ["<rootDir>/node_modules"],
  moduleNameMapper: {
    "^react-native$": "react-native-web",
    "^react$": "<rootDir>/node_modules/react",
    "^react/jsx-runtime$": "<rootDir>/node_modules/react/jsx-runtime.js",
    "^react/jsx-dev-runtime$": "<rootDir>/node_modules/react/jsx-dev-runtime.js",
  },
  haste: {
    defaultPlatform: "web",
    platforms: ["web"],
  },
};
