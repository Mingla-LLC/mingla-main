// issue #962 [pre-bank-currency-degbp] render-proof jest config. Mirrors the
// ORCH-1147R2 pattern (RN jest preset + babel transform + react-test-renderer +
// @testing-library/react-native, react/react-native pinned to the business
// install for a single-copy React).
//
// The default node/ts-jest config excludes every `*.render.test.tsx` (see
// jest.config.cjs `\.render\.test\.tsx$`), so the #962 QuantityRow render-proofs
// need this dedicated config. It maps the `@mingla/offering-rendering` bare
// specifier straight to QuantityRow.tsx so the barrel index.ts (which pulls in
// EventCoverMedia → expo-video → expo-modules-core, absent under jest) is never
// loaded — the SAME real row the wrapper renders, only the unrelated barrel
// siblings bypassed. expo-haptics is stubbed (QuantityRow calls selectionAsync
// in tap handlers; not exercised by the text assertions).
//
// Covers BOTH the implementor's F6 render-proof and the tester's adversarial
// crash-safety render-proof.
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
//   npx jest --config jest.issue0962.render.cjs --runInBand

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
    "**/__tests__/issue_0962_quantity_row_null_currency.render.test.tsx",
    "**/__tests__/issue_0962_adversarial_quantity_row_crash.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|@testing-library|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom|react-native-svg)",
  ],
  moduleNameMapper: {
    "^@mingla/offering-rendering$": path.join(
      businessRoot,
      "..",
      "packages",
      "offering-rendering",
      "QuantityRow.tsx",
    ),
    "^@mingla/offering-rendering/(.*)$": path.join(
      businessRoot,
      "..",
      "packages",
      "offering-rendering",
      "$1",
    ),
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
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
