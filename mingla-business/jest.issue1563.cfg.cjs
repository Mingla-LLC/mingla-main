// Issue #1563 [room-price-filter] — WEB-RESOLVED jest config for the Stay room
// price bands, which live in `packages/brand-rendering`.
//
// WHY THIS CONFIG EXISTS — the same two load-bearing reasons as #1503's:
//
// 1. REACH. `mingla-business/jest.config.cjs` has `rootDir` = mingla-business,
//    so NOTHING under `packages/**/__tests__` is ever swept by the default
//    suite. A render proof written there without a config to run it is a dark
//    safety mechanism (the #1038 / #1047 failure shape). `rootDir` is the repo
//    root here and `roots` pins the crawl to the one package under test.
//
// 2. RESOLUTION. `react-native` maps to `react-native-web` — the resolver that
//    actually SHIPS on buyer web. The #1484 P1-1 lesson: a react-test-renderer
//    suite over plain `react-native` is structurally blind to RNW's style
//    compiler and DOM output, which is exactly how #1484 shipped visibly broken
//    with 29 green render tests. This issue's claim is that a guest can SEE and
//    TAP price bands on the real page, so it is proved through RNW.
//
// The PURE band/sort/empty-answer logic is NOT run here: it lives in
// `mingla-business/src/components/venue/__tests__/stayRoomPriceFilter.issue1563
// .happy.test.ts` and therefore already runs on every PR under the REQUIRED
// "mingla-business jest (full suite)" check. This config exists only for the
// half that needs a real renderer.
//
// `modulePaths` points at mingla-business/node_modules because packages/* carry
// no node_modules of their own (deliberate — it guarantees one React instance
// across app + packages, see metro.config.js).
//
// Run:
//   cd mingla-business && npx jest --config jest.issue1563.cfg.cjs --runInBand

/* global __dirname */
const path = require("path");

const businessRoot = __dirname;
const repoRoot = path.resolve(businessRoot, "..");

module.exports = {
  rootDir: repoRoot,
  roots: [path.join(repoRoot, "packages", "brand-rendering")],
  testEnvironment: "node",
  // react-native-web's dev-only invariant helpers read the RN `__DEV__` global,
  // which only the metro/RN jest preset defines. This config is node-env, so
  // declare it explicitly (matches jest.issue1503.cfg.cjs).
  globals: { __DEV__: true },
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(businessRoot, "jest.orch1118.babel.cjs") },
    ],
  },
  testMatch: [
    "**/__tests__/stayRoomPriceFilter.issue1563.web.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|react-native-web|@react-native-community|react-native-svg|lucide-react-native|expo|@expo)",
  ],
  modulePaths: [path.join(businessRoot, "node_modules")],
  moduleNameMapper: {
    "^react-native$": "react-native-web",
  },
};
