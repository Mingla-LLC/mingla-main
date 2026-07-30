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
  testMatch: [
    "**/__tests__/AnalyticsHomeTile.issue874.render.test.tsx",
    "**/__tests__/BrandAnalyticsScreen.issue874.render.test.tsx",
    "**/__tests__/home.issue874.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|@testing-library|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom|react-native-reanimated|react-native-svg)",
  ],
  moduleNameMapper: {
    "^react$": path.join(modules, "react"),
    "^react/(.*)$": path.join(modules, "react", "$1"),
    "^react-native$": path.join(modules, "react-native"),
    "^react-test-renderer$": path.join(modules, "react-test-renderer"),
    "^react-test-renderer/(.*)$": path.join(modules, "react-test-renderer", "$1"),
    "^@testing-library/react-native$": path.join(
      modules,
      "@testing-library",
      "react-native",
    ),
    "^@testing-library/react-native/(.*)$": path.join(
      modules,
      "@testing-library",
      "react-native",
      "$1",
    ),
    "^expo-blur$": path.join(
      businessRoot,
      "__tests__/stubs/expoBlur.issue1180.stub.tsx",
    ),
    "^expo-linear-gradient$": path.join(
      businessRoot,
      "__tests__/stubs/expoLinearGradient.issue1180.stub.tsx",
    ),
  },
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
