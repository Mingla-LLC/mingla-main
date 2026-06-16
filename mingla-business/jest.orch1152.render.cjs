// ORCH-1152 tester-owned ADVERSARIAL render-proof — jest config. Mirrors the
// ORCH-1147R2 render-proof pattern (RN jest preset + babel transform +
// react-test-renderer + @testing-library/react-native, react/react-native
// pinned to the business install for a single-copy React).
//
// Unlike the implementor's math + hand-rolled-string test (which never mounts a
// React tree), this MOUNTS the REAL CartProvider in the EMPTY state and renders
// the bottom-bar JSX from the three checkout index.tsx screens (the ORIGINAL
// pre-1152 unconditional `formatCurrency(allInTotal, currency)` shape), then
// asserts the tree RENDERS without throwing and shows "—". react-test-renderer
// throws synchronously from render() on a commit-time throw, so a passing mount
// IS the no-crash proof — the exact state that shipped the RangeError.
//
// Provision deps once per worktree (they hoist into mingla-business/node_modules):
//   mkdir -p .orch1118-testdeps && cd .orch1118-testdeps && npm init -y && \
//     npm i react-test-renderer@19.1.0 @testing-library/react-native@^13 --legacy-peer-deps
//
// Run:
//   npx jest --config jest.orch1152.render.cjs --runInBand

const fs = require("fs");
const path = require("path");

const businessRoot = __dirname;
const bizModules = path.join(businessRoot, "node_modules");

const rtlRoot = path.join(bizModules, "@testing-library", "react-native");
const matchersBuild = path.join(rtlRoot, "build", "matchers", "extend-expect.js");
const matchersDist = path.join(rtlRoot, "dist", "matchers", "extend-expect.js");
const extendExpect = fs.existsSync(matchersBuild) ? matchersBuild : matchersDist;

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
    "**/__tests__/orch_1152_empty_cart_currency_crash.adversarial.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|@testing-library|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom)",
  ],
  moduleNameMapper: {
    "^react$": path.join(bizModules, "react"),
    "^react/(.*)$": path.join(bizModules, "react", "$1"),
    "^react-native$": path.join(bizModules, "react-native"),
    "^react-test-renderer$": path.join(bizModules, "react-test-renderer"),
    "^react-test-renderer/(.*)$": path.join(
      bizModules,
      "react-test-renderer",
      "$1",
    ),
    "^@testing-library/react-native$": rtlRoot,
    "^@testing-library/react-native/(.*)$": path.join(rtlRoot, "$1"),
  },
  modulePaths: [bizModules],
  setupFilesAfterEnv: [extendExpect],
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
