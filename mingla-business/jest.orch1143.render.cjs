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
// ── #1486 — RESOLVING THE RENDER DEPS SO CI CAN ACTUALLY RUN THIS ──────────
// This config resolved react-test-renderer and @testing-library/react-native
// EXCLUSIVELY from `.orch1118-testdeps/node_modules` — a per-worktree overlay
// that is GITIGNORED and therefore never exists on a CI runner. That is a large
// part of why the suite was never wired: pointed at a workflow as written, it
// could not have started. It now resolves from whichever location actually has
// the packages: the worktree overlay when a developer has provisioned one,
// otherwise `mingla-business/node_modules`, which the workflow populates with
// `npm install --no-save react-test-renderer@19.1.0 @testing-library/react-native`
// (the same recipe the already-wired jest.issue874.render.cjs relies on).
// Neither path is a mock — both are the real renderer.
//
// Run:
//   npx jest --config jest.orch1143.render.cjs --runInBand

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
    "**/__tests__/LiveOfferingCard.orch1143.render.test.tsx",
    // ORCH-1143 SC-7 (tester adversarial) — Upcoming/Live de-dup render proof.
    "**/__tests__/UpcomingDedup.orch1143.render.test.tsx",
    // ORCH-1143 §4.4-A continuous-section fix v2 — flat-vs-elevated chrome proof.
    "**/__tests__/LiveOfferingCard.flat.orch1143.render.test.tsx",
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
  setupFilesAfterEnv: [extendExpect],
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
