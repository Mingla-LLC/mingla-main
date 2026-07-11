// ORCH-1355 draft-promotion route-remount PROOF (symptom 1) — worktree-local
// jest config (mingla-implementor PROVE+IMPLEMENT leg).
//
// Mounts the REAL production edit routes (app/rsvp/[id]/edit.tsx +
// app/event/[id]/edit.tsx) with expo-router MOCKED (a faithful React-Navigation
// screen-identity model), the wizard mocked as a mount-counting probe, and the
// REAL draftEventStore, to prove the JS-level remount the investigation (§11)
// was blocked on — and to prove the fix suppresses it.
//
// Mirrors jest.orch1355.render.cjs (RN preset + babel-jest) and resolves RTL +
// react-test-renderer from the worktree-local .orch1118-testdeps overlay
// (gitignored; provisioned per worktree), with react/react-native pinned to the
// business install (single copy).
//
// Run:
//   npx jest --config jest.orch1355.promotion.cjs --runInBand

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
    "**/__tests__/RsvpPromotionRemount.orch1355.router.test.tsx",
    "**/__tests__/EventPromotionRemount.orch1355.router.test.tsx",
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
