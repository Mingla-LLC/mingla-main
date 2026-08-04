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
// ── #1486 — RENDER-DEP RESOLUTION (worktree overlay, else business install) ─
// The render deps (react-test-renderer + @testing-library/react-native) are
// installed by the workflow with `npm install --no-save`, so in CI they live in
// `mingla-business/node_modules`. Inside a git worktree that directory is a
// SYMLINK into the shared anchor checkout, which must not be mutated, so a
// developer provisions `.orch1118-testdeps/` instead. This resolves whichever
// one actually has the packages. Neither is a mock — both are the real renderer.
//
// Run:
//   npx jest --config jest.orch1152.render.cjs --runInBand

const fs = require("fs");
const path = require("path");

const businessRoot = __dirname;
const bizModules = path.join(businessRoot, "node_modules");

// #1486 — prefer a worktree-local overlay when present, else the business install.
const overlay = path.join(businessRoot, ".orch1118-testdeps", "node_modules");
const testDeps = fs.existsSync(path.join(overlay, "@testing-library", "react-native"))
  ? overlay
  : bizModules;

const rtlRoot = path.join(testDeps, "@testing-library", "react-native");
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
    "^react-test-renderer$": path.join(testDeps, "react-test-renderer"),
    "^react-test-renderer/(.*)$": path.join(
      bizModules,
      "react-test-renderer",
      "$1",
    ),
    "^@testing-library/react-native$": rtlRoot,
    "^@testing-library/react-native/(.*)$": path.join(rtlRoot, "$1"),
  },
  modulePaths: [testDeps, bizModules],
  setupFilesAfterEnv: [extendExpect],
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
