// ORCH-1143 LiveOfferingCard render-proof — worktree-local jest config (tester).
//
// Stands up a REAL @testing-library/react-native mount of the production
// LiveOfferingCard so the per-kind scan button + single-vs-carousel sizing are
// proven to RENDER + FIRE at runtime (not just source-grepped). Mirrors
// jest.orch1122.render.cjs (RN preset + babel-jest of the RN tree) and resolves
// RTL + react-test-renderer from the worktree-local .orch1118-testdeps overlay
// (gitignored; provisioned per worktree), with react/react-native pinned to the
// business install (single copy).
//
// Run:
//   npx jest --config jest.orch1143.render.cjs --runInBand

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
    "**/__tests__/LiveOfferingCard.orch1143.render.test.tsx",
    // ORCH-1143 SC-7 (tester adversarial) — Upcoming/Live de-dup render proof.
    "**/__tests__/UpcomingDedup.orch1143.render.test.tsx",
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
