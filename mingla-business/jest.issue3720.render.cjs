const path = require("path");

const businessRoot = __dirname;
const modules = path.join(businessRoot, "node_modules");

module.exports = {
  rootDir: businessRoot,
  preset: "react-native",
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(businessRoot, "jest.orch1118.babel.cjs") },
    ],
  },
  testMatch: ["**/__tests__/issue_3720_help_support_inputs.render.test.tsx"],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|react-native-svg|expo|@expo|react-native-reanimated)",
  ],
  moduleNameMapper: {
    "^react$": path.join(modules, "react"),
    "^react/(.*)$": path.join(modules, "react", "$1"),
    "^react-native$": path.join(modules, "react-native"),
    "^react-test-renderer$": path.join(modules, "react-test-renderer"),
    "^react-test-renderer/(.*)$": path.join(modules, "react-test-renderer", "$1"),
  },
  haste: { defaultPlatform: "ios", platforms: ["ios", "android", "native"] },
};
