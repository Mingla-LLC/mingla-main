// #1180 [payout-ui-copy] — mingla-tester ADVERSARIAL render-proof config.
//
// Stands up a REAL @testing-library/react-native mount of the production
// BrandPayoutBreakdown / BrandPayoutStatusPill / BrandPayoutTimelineExplainer
// so the load-bearing UI branches are proven to RENDER at runtime (source-grep
// is capped at "suspected"): the RLS role gap (limited-access vs honest empty),
// the gross→bank receipt ARITHMETIC adding up on screen, CANCELLED = grey pill,
// the "Confirming…" no-fabricated-number state, and the NG explainer note.
//
// Mirrors jest.orch1331.render.cjs — RN preset + babel-jest + the worktree-local
// .orch1118-testdeps overlay (RTL + react-test-renderer), react/react-native
// pinned to the business install (single copy). Tester-authored, append-only.
//
// Run: npx jest --config jest.issue1180.render.cjs --runInBand

const fs = require("fs");
const path = require("path");

const businessRoot = __dirname;
const overlay = path.join(businessRoot, ".orch1118-testdeps", "node_modules");
const bizModules = path.join(businessRoot, "node_modules");

// #1486 — prefer the worktree overlay when it exists, else the business install.
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
    "**/__tests__/BrandPayout.issue1180.adversarial.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|@testing-library|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom|react-native-reanimated)",
  ],
  moduleNameMapper: {
    "^react$": path.join(bizModules, "react"),
    "^react/(.*)$": path.join(bizModules, "react", "$1"),
    "^react-native$": path.join(bizModules, "react-native"),
    "^react-test-renderer$": path.join(testDeps, "react-test-renderer"),
    "^react-test-renderer/(.*)$": path.join(testDeps, "react-test-renderer", "$1"),
    "^@testing-library/react-native$": path.join(testDeps, "@testing-library", "react-native"),
    "^@testing-library/react-native/(.*)$": path.join(testDeps, "@testing-library", "react-native", "$1"),
    // Native-only deps → light stubs so the tree mounts headlessly.
    "^expo-blur$": path.join(businessRoot, "__tests__", "stubs", "expoBlur.issue1180.stub.tsx"),
    "^expo-haptics$": path.join(businessRoot, "__tests__", "stubs", "expoHaptics.issue1180.stub.ts"),
    "^expo-linear-gradient$": path.join(businessRoot, "__tests__", "stubs", "expoLinearGradient.issue1180.stub.tsx"),
  },
  modulePaths: [testDeps, bizModules],
  setupFilesAfterEnv: [extendExpect],
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
