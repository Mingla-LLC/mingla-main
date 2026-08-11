// #1863 [error-toast-covers-bank-field] — payments permission gate render proof
// (mingla-implementor happy-path leg).
//
// Stands up a REAL @testing-library/react-native mount of the three production
// ROUTE components (app/brand/[id]/payments/{index,onboard,reports}.tsx) so the
// gate is proven where it actually lives. Mounting the VIEWS instead would go
// green with all three routes unwrapped, which is exactly the defect.
//
// Mechanically identical to jest.issue1834.render.cjs (RN preset + babel-jest,
// haste.defaultPlatform "ios" so the .native wrapper variant resolves); only
// testMatch differs. That config already solves the RTL/react-test-renderer
// resolution problem — worktree overlay when a developer has provisioned one,
// otherwise mingla-business/node_modules, which the workflow populates with
//   npm install --no-save react-test-renderer@19.1.0 @testing-library/react-native
// — with react/react-native pinned to the business install (single copy).
// Neither path is a mock; both are the real renderer.
//
// Invoked by .github/workflows/issue-1486-dormant-render-suites.yml. A jest
// config no workflow runs fails the class-A gate
// .github/scripts/strict-grep/issue-1486-jest-config-invoked-by-workflow.mjs —
// a dormant suite is precisely the bug class this issue is full of.
//
// Run:
//   npx jest --config jest.issue1863.render.cjs --runInBand

const fs = require("fs");
const path = require("path");

const businessRoot = __dirname;
const overlay = path.join(businessRoot, ".orch1118-testdeps", "node_modules");
const bizModules = path.join(businessRoot, "node_modules");

// #1486 — prefer the worktree overlay when it exists, else the business install.
const testDeps = fs.existsSync(
    path.join(overlay, "@testing-library", "react-native"),
  )
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
    "**/__tests__/issue_1863_payments_permission_gate.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|@testing-library|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom)",
  ],
  moduleNameMapper: {
    "^react$": path.join(bizModules, "react"),
    "^react/(.*)$": path.join(bizModules, "react", "$1"),
    "^react-native$": path.join(bizModules, "react-native"),
    "^react-test-renderer$": path.join(testDeps, "react-test-renderer"),
    "^react-test-renderer/(.*)$": path.join(testDeps, "react-test-renderer", "$1"),
    "^@testing-library/react-native$": path.join(testDeps, "@testing-library", "react-native"),
    "^@testing-library/react-native/(.*)$": path.join(testDeps, "@testing-library", "react-native", "$1"),
  },
  modulePaths: [testDeps, bizModules],
  setupFilesAfterEnv: [
    extendExpect,
    // #1486 — React 19 deleted legacy mode, so a setState performed after an
    // await is scheduled on a macrotask instead of committing synchronously.
    // This shim makes an awaited `fireEvent` resolve after React's work queue is
    // drained. Real component, real handlers, real reconciler.
    path.join(businessRoot, "jest.issue1486.fireevent-flush.setup.cjs"),
  ],
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
