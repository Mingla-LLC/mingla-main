// Issue #679 [follow-a-brand] — jest config for the shared brand-page Follow
// suites that live in `packages/brand-rendering`.
//
// WHY THIS CONFIG EXISTS — the same two load-bearing reasons as #1503's:
//
// 1. REACH. `mingla-business/jest.config.cjs` has `rootDir` = mingla-business,
//    so NOTHING under `packages/**/__tests__` is ever swept by the default
//    suite. The two ORCH-1155 brand-page suites were written there and ran in
//    NO CI job at all (#679 investigation D-1 — the dark-suite #1038/#1047
//    failure shape); this config RESURRECTS them into CI alongside the new
//    #679 follow-gate suites. `rootDir` is the repo root here and `roots` pins
//    the crawl to the one package under test.
//
// 2. RESOLUTION. `react-native` maps to `react-native-web` — the resolver that
//    actually ships on buyer web (the #1484 P1-1 lesson). The 1155 + #679
//    implementor suites are node-env source-as-text and don't mount, but the
//    tester's adversarial WEB-RENDER suite (issue_679_follow_gate.adversarial.
//    render.test.tsx, matched below) mounts the REAL page through RNW, so the
//    harness must resolve exactly like #1563's.
//
// `modulePaths` points at mingla-business/node_modules because packages/* carry
// no node_modules of their own (deliberate — it guarantees one React instance
// across app + packages, see metro.config.js).
//
// Run:
//   cd mingla-business && npx jest --config jest.issue679.cfg.cjs --runInBand

/* global __dirname */
const path = require("path");

const businessRoot = __dirname;
const repoRoot = path.resolve(businessRoot, "..");

module.exports = {
  rootDir: repoRoot,
  roots: [path.join(repoRoot, "packages", "brand-rendering")],
  testEnvironment: "node",
  // react-native-web's dev-only invariant helpers read the RN `__DEV__` global,
  // which only the metro/RN jest preset defines. This config is node-env, so
  // declare it explicitly (matches jest.issue1503.cfg.cjs).
  globals: { __DEV__: true },
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(businessRoot, "jest.orch1118.babel.cjs") },
    ],
  },
  testMatch: [
    // ORCH-1155 brand-page suites — resurrected into CI (investigation D-1).
    "**/__tests__/orch_1155_brand_redesign.test.tsx",
    "**/__tests__/orch_1155_brand_redesign.adversarial.test.tsx",
    // #679 implementor happy-path (structural + executable predicates).
    "**/__tests__/issue_679_follow_gate.test.tsx",
    // #679 TESTER adversarial web-render suite (real RNW mount) — matched here
    // so it is swept the moment the tester lands it.
    "**/__tests__/issue_679_follow_gate.adversarial.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|react-native-web|@react-native-community|react-native-svg|lucide-react-native|expo|@expo)",
  ],
  modulePaths: [path.join(businessRoot, "node_modules")],
  moduleNameMapper: {
    "^react-native$": "react-native-web",
  },
};
