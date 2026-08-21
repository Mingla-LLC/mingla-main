// #1834 [keyboard-blocks-bank-field] — bank-field SmartScrollView render proof
// (mingla-implementor happy-path leg).
//
// Stands up a REAL @testing-library/react-native mount of the production
// BrandOnboardView (Nigeria branch) and BrandPaymentsView (Paystack rail) so
// the fix is proven on the MOUNTED TREE rather than by grepping the source:
// the scroll host that owns the NG account-number Input must be the wrapper's
// KeyboardAwareScrollView carrying the inherited bottomOffset=54 (42 Done bar
// + 12 visible clearance), NOT react-native's plain ScrollView, which
// subscribes to no keyboard frames and is the whole defect.
//
// Mechanically identical to jest.orch1331.render.cjs (RN preset + babel-jest,
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
// a dormant suite is the exact bug class #1834 exists to kill.
//
// Run:
//   npx jest --config jest.issue1834.render.cjs --runInBand


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
    "**/__tests__/issue_1834_bank_field_smartscroll.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|@testing-library|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom)",
  ],
  moduleNameMapper: {
    // #2418 — this suite proves keyboard layout, not telemetry transport.
    // Keep its native resolution path while replacing only the ESM SDK leaf
    // with the existing platform-neutral Sentry shim used by web.
    "^@sentry/react-native$": path.join(
      businessRoot,
      "src",
      "diagnostics",
      "sentry.ts",
    ),
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
