// Issue #1793 [guest-ordering] — jest config for the shared ordering rules that
// live in `packages/brand-rendering/venueOrdering/`.
//
// WHY THIS CONFIG EXISTS — the same two reasons as `jest.issue1503.cfg.cjs`:
//
// 1. REACH. `mingla-business/jest.config.cjs` has `rootDir` = mingla-business, so
//    nothing under `packages/**/__tests__` is ever swept by the default suite. A
//    test written there with no config to run it is a DARK safety mechanism —
//    green CI over an unexecuted file — which is the #1038 / #1047 failure shape
//    and the one this programme can least afford on the phase that takes money.
//
// 2. RESOLUTION. `react-native` maps to `react-native-web`, the resolver that
//    actually ships on buyer web.
//
// The suite here is the PURE half (rules, copy, the basket, the sitting): no
// renderer is mounted, because what these assertions protect are promises —
// "a counter order is never promised delivery", "a paused venue is told the
// truth", "the tip is asked once" — and a promise is a function of data, not of
// pixels. The render-side proof is the strict-grep gate plus the two apps'
// own suites.
//
// Run:
//   cd mingla-business && npx jest --config jest.issue1793.cfg.cjs --runInBand

/* global __dirname */
const path = require("path");

const businessRoot = __dirname;
const repoRoot = path.resolve(businessRoot, "..");

module.exports = {
  rootDir: repoRoot,
  roots: [path.join(repoRoot, "packages", "brand-rendering")],
  testEnvironment: "node",
  globals: { __DEV__: true },
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(businessRoot, "jest.orch1118.babel.cjs") },
    ],
  },
  testMatch: ["**/__tests__/venueOrdering.issue1793.test.ts"],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|react-native-web|@react-native-community|react-native-svg|lucide-react-native|expo|@expo)",
  ],
  modulePaths: [path.join(businessRoot, "node_modules")],
  moduleNameMapper: {
    "^react-native$": "react-native-web",
  },
};
