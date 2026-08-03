// Issue #1503 [stay-date-pickers] — WEB-RESOLVED jest config for the shared
// Stay date control that lives in `packages/brand-rendering`.
//
// WHY THIS CONFIG EXISTS — two independent reasons, both load-bearing:
//
// 1. REACH. `mingla-business/jest.config.cjs` has `rootDir` = mingla-business, so
//    NOTHING under `packages/**/__tests__` is ever swept by the default suite.
//    A test written there without a config to run it is a dark safety mechanism
//    (the #1038 / #1047 failure shape). `rootDir` is the repo root here, and the
//    `roots` entry pins the crawl to the one package under test.
//
// 2. RESOLUTION. `react-native` maps to `react-native-web` — the resolver that
//    actually SHIPS on buyer web. This is the #1484 P1-1 lesson: a
//    react-test-renderer suite is structurally BLIND to react-native-web's style
//    compiler and DOM output, which is exactly how #1484 shipped visibly broken
//    with 29 green render tests. The date control's whole point is the emitted
//    `<input type="date">` with real `min` / `max` attributes, so it must be
//    proved through RNW + ReactDOMServer, reading the real markup.
//
// `modulePaths` points at mingla-business/node_modules because packages/* carry
// no node_modules of their own (that is deliberate — it guarantees one React
// instance across app + packages, see metro.config.js).
//
// Run:
//   cd mingla-business && npx jest --config jest.issue1503.cfg.cjs --runInBand
// The pure suite is additionally run under TZ=UTC / America/New_York /
// Pacific/Auckland in .github/workflows/issue-1503-stay-date-pickers-tests.yml —
// a Stay date bug that only appears in one zone is the historical failure mode.

const path = require("path");

const businessRoot = __dirname;
const repoRoot = path.resolve(businessRoot, "..");

module.exports = {
  rootDir: repoRoot,
  roots: [path.join(repoRoot, "packages", "brand-rendering")],
  testEnvironment: "node",
  // react-native-web's dev-only invariant helpers read the RN `__DEV__` global,
  // which only the metro/RN jest preset defines. This config is node-env, so
  // declare it explicitly (matches jest.issue1484.web.render.cjs).
  globals: { __DEV__: true },
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(businessRoot, "jest.orch1118.babel.cjs") },
    ],
  },
  testMatch: [
    "**/__tests__/stayDateRules.issue1503.test.ts",
    "**/__tests__/stayDateRangeField.issue1503.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|react-native-web|@react-native-community|react-native-svg|lucide-react-native|expo|@expo)",
  ],
  modulePaths: [path.join(businessRoot, "node_modules")],
  moduleNameMapper: {
    "^react-native$": "react-native-web",
  },
};
