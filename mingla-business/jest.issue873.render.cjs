const path = require("path");
const businessRoot = __dirname;
const modules = path.join(businessRoot, "node_modules");

module.exports = {
  rootDir: businessRoot,
  preset: "react-native",
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": ["babel-jest", { configFile: path.join(businessRoot, "jest.orch1118.babel.cjs") }],
  },
  testMatch: ["**/__tests__/GuestRosterExperience.issue873.render.test.tsx"],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@testing-library|test-renderer|react-clone-referenced-element|expo|@expo|react-native-safe-area-context|react-native-reanimated|react-native-svg)",
  ],
  moduleNameMapper: {
    "^react$": path.join(modules, "react"),
    "^react/(.*)$": path.join(modules, "react", "$1"),
    "^react-native$": path.join(modules, "react-native"),
    "^react-test-renderer$": path.join(modules, "react-test-renderer"),
  },
  haste: { defaultPlatform: "ios", platforms: ["ios", "android", "native"] },
};
