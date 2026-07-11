// ORCH-1355 TESTER adversarial suites — worktree-local jest config
// (mingla-tester leg). Runs the tester's OWN adversarial guards at angles
// distinct from the implementor's render + promotion suites:
//   - symptom 2: RsvpWizardToggleBurst.orch1355.tester (single-patch call-count
//     on the REAL RsvpStep5Setup + debounce-coalesced burst + server echo).
//   - symptom 1: Rsvp/Event PromotionAdversarial.orch1355.tester (NO
//     router.replace at all + route-key unchanged + mount stays 1 + URL
//     reconciled to the server id + hostile type-more-during-promotion) and
//     RsvpDeepLinkColdOpen.orch1355.tester (deep-link / resume cold-open at a
//     server id resolves with no promotion).
//
// Mirrors jest.orch1355.render.cjs / jest.orch1355.promotion.cjs (RN preset +
// babel-jest) and resolves RTL + react-test-renderer from the worktree-local
// .orch1118-testdeps overlay (gitignored), with react/react-native pinned to the
// business install (single copy).
//
// Run:
//   npx jest --config jest.orch1355.tester.cjs --runInBand

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
    "**/__tests__/RsvpWizardToggleBurst.orch1355.tester.test.tsx",
    "**/__tests__/RsvpPromotionAdversarial.orch1355.tester.test.tsx",
    "**/__tests__/EventPromotionAdversarial.orch1355.tester.test.tsx",
    "**/__tests__/RsvpDeepLinkColdOpen.orch1355.tester.test.tsx",
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
