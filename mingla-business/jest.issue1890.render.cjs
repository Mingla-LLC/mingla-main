// #1890 [keyboard-clearance-overshoot] — Ari composer clearance render proof
// (mingla-implementor happy-path leg).
//
// Stands up a REAL @testing-library/react-native mount of AriChatScreen and
// reads the composer wrapper's resolved `paddingBottom` off the MOUNTED TREE,
// so the keyboard-open lift is proven by execution rather than by grepping the
// source. The defect #1890 fixed was arithmetic that a source pin had actively
// blessed, so a source pin is exactly the wrong instrument here.
//
// Mechanically identical to jest.issue1834.render.cjs (RN preset + babel-jest,
// haste.defaultPlatform "ios" so the .native wrapper + keyboardClearance
// variants resolve); only testMatch differs.
//
// Invoked by .github/workflows/issue-1486-dormant-render-suites.yml. A jest
// config no workflow runs fails the class-A gate
// .github/scripts/strict-grep/issue-1486-jest-config-invoked-by-workflow.mjs.
//
// Run:
//   npx jest --config jest.issue1890.render.cjs --runInBand

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
    "**/__tests__/issue_1890_ari_composer_clearance.happy.test.ts",
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
    // #1486 — React 19 deleted legacy mode, so the `setState` that an ASYNC
    // onPress performs after its `await` is scheduled on a MACROTASK instead of
    // committing synchronously. Awaiting `fireEvent` only drains microtasks, so
    // R-4/R-5/R-6/R-8 read the tree one commit early. This shim makes an awaited
    // `fireEvent` resolve after React's work queue is drained — the React 18
    // semantics the suite was written against. Real component, real handlers,
    // real reconciler; see the stub's header for the measured evidence.
    path.join(businessRoot, "jest.issue1486.fireevent-flush.setup.cjs"),
  ],
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
