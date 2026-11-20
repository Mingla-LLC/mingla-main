// Issue #4523 [one-calendar] — react-native-preset jest config for the date
// picker regression suites that live in mingla-business and in the shared
// packages (`packages/**` is not swept by the default business config).
//
// Run:
//   cd mingla-business && npx jest --config jest.issue4523.cfg.cjs --runInBand

/* global __dirname */
const path = require("path");

const businessRoot = __dirname;
const repoRoot = path.resolve(businessRoot, "..");
const modules = path.join(businessRoot, "node_modules");

module.exports = {
  rootDir: businessRoot,
  roots: [
    path.join(repoRoot, "packages", "brand-rendering", "__tests__"),
    path.join(businessRoot, "src", "components", "ui", "__tests__"),
  ],
  preset: path.join(modules, "react-native"),
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(businessRoot, "jest.orch1118.babel.cjs") },
    ],
  },
  testMatch: [
    "**/__tests__/issue_4523_*.test.ts",
    "**/__tests__/issue_4523_*.test.tsx",
    "**/packages/calendar/__tests__/**/*.test.ts",
    "**/packages/calendar/__tests__/**/*.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|@testing-library|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom|react-native-reanimated|react-native-svg)",
  ],
  modulePaths: [modules],
  moduleNameMapper: {
    "^react$": path.join(modules, "react"),
    "^react/(.*)$": path.join(modules, "react", "$1"),
    "^react-native$": path.join(modules, "react-native"),
    "^react-test-renderer$": path.join(modules, "react-test-renderer"),
    "^react-test-renderer/(.*)$": path.join(modules, "react-test-renderer", "$1"),
    "^@mingla/brand-rendering/(.+)$": path.join(repoRoot, "packages", "brand-rendering", "$1"),
    "^@mingla/calendar/(.+)$": path.join(repoRoot, "packages", "calendar", "$1"),
    "^@mingla/offering-rendering$": path.join(repoRoot, "packages", "offering-rendering", "index.ts"),
  },
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
