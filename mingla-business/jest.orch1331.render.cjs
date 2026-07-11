// ORCH-1331 PartnerPaystackOnboardForm render-proof — worktree-local jest
// config (mingla-tester adversarial client leg).
//
// Stands up a REAL @testing-library/react-native mount of the production
// PartnerPaystackOnboardForm so the DESIGN §3.2 state machine is proven to
// RENDER + FIRE at runtime (source-grep tests are capped at "suspected"):
// banks_loading → banks_error/retry → idle gating → verify → resolve_error →
// confirm_name → invalidation-on-edit → connect hold (isPending || isSuccess)
// → connect_error retention, plus §7 copy verbatim and I-39 a11y labels.
//
// Mirrors jest.orch1335.render.cjs (RN preset + babel-jest) and resolves RTL +
// react-test-renderer from the worktree-local .orch1118-testdeps overlay
// (gitignored; provision per EditPublishedTripScreen.render.README.md), with
// react/react-native pinned to the business install (single copy).
//
// Run:
//   npx jest --config jest.orch1331.render.cjs --runInBand

const fs = require("fs");
const path = require("path");

const businessRoot = __dirname;
const overlay = path.join(businessRoot, ".orch1118-testdeps", "node_modules");
const bizModules = path.join(businessRoot, "node_modules");

const rtlRoot = path.join(overlay, "@testing-library", "react-native");
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
    "**/__tests__/PartnerPaystackOnboardForm.orch1331.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|@testing-library|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom)",
  ],
  moduleNameMapper: {
    "^react$": path.join(bizModules, "react"),
    "^react/(.*)$": path.join(bizModules, "react", "$1"),
    "^react-native$": path.join(bizModules, "react-native"),
    "^react-test-renderer$": path.join(overlay, "react-test-renderer"),
    "^react-test-renderer/(.*)$": path.join(overlay, "react-test-renderer", "$1"),
    "^@testing-library/react-native$": path.join(overlay, "@testing-library", "react-native"),
    "^@testing-library/react-native/(.*)$": path.join(overlay, "@testing-library", "react-native", "$1"),
  },
  modulePaths: [overlay, bizModules],
  setupFilesAfterEnv: [extendExpect],
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
