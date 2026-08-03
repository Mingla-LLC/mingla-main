// #962 [pre-bank currency de-GBP] Phase 2 — TESTER R5 render-proof jest config.
// Mirrors jest.issue0962.render.cjs (RN preset + babel transform +
// react-test-renderer, react/react-native pinned to the business install for a
// single-copy React). Unlike the Phase-1 config this needs NO
// @testing-library/react-native (not installed in this worktree) — the render
// proof drives react-test-renderer directly (create() throws synchronously on a
// commit-time RangeError, so a clean mount IS the no-crash proof).
//
// EventDetailKpiCard pulls GlassCard -> GlassChrome -> expo-blur; the blur is
// decorative and absent under jest, so expo-blur is stubbed to a plain View.
//
// The default node/ts-jest config excludes every `*.render.test.tsx`
// (jest.config.cjs `\.render\.test\.tsx$`), so this dedicated config runs it.
//
// Run:
//   npx jest --config jest.issue0962r5.render.cjs --runInBand

const path = require("path");

const businessRoot = __dirname;
const bizModules = path.join(businessRoot, "node_modules");

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
    "**/__tests__/issue_0962_r5_kpicard_hide.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|@testing-library|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom|react-native-svg)",
  ],
  moduleNameMapper: {
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
    "^react$": path.join(bizModules, "react"),
    "^react/(.*)$": path.join(bizModules, "react", "$1"),
    "^react-native$": path.join(bizModules, "react-native"),
    "^react-test-renderer$": path.join(bizModules, "react-test-renderer"),
    "^react-test-renderer/(.*)$": path.join(
      bizModules,
      "react-test-renderer",
      "$1",
    ),
  },
  modulePaths: [bizModules],
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
