// ORCH-1122 tester-owned ADVERSARIAL cover-close render-proof — worktree-local
// jest config. Mirrors jest.orch1122.render.cjs (the implementor's open-path
// render config) but targets the tester's two-way-binding close test
// (EditPublishedTripScreen.coverClose.adversarial.render.test.tsx). Reuses the
// same RN preset + babel transform + the worktree-local .orch1118-testdeps
// overlay (gitignored; provisioned once per worktree).
//
// Provision the overlay once per worktree with:
//   mkdir -p .orch1118-testdeps && cd .orch1118-testdeps && \
//   npm i react-test-renderer@19.1.0 @testing-library/react-native@^13
//
// ── #1486 — WHAT IT TOOK TO MAKE THIS RUNNABLE IN CI ───────────────────────
// This config's own header used to declare it "worktree-local … NOT committed"
// and resolve its render deps exclusively from the gitignored
// `.orch1118-testdeps/` overlay. It was committed anyway, and pointed at a
// workflow as written it could not have started: the overlay does not exist on
// a CI runner. Two changes fix that:
//
//   1. render deps resolve from the worktree overlay when one is provisioned,
//      otherwise from `mingla-business/node_modules`, which the workflow fills
//      with `npm install --no-save` (the recipe jest.issue874.render.cjs uses);
//   2. the native-only modules the screen's import graph GREW since this config
//      was written — expo-video and react-native-svg arrive through
//      @mingla/offering-rendering -> ParallaxCoverShell -> EventCoverMedia, and
//      expo-constants through the config reads — are stubbed at the boundary.
//      None of them has a native side under jest, and none bears on what this
//      suite asserts.
//
// Run:
//   npx jest --config jest.orch1122.adversarial.render.cjs --runInBand

const fs = require("fs");
const path = require("path");

const businessRoot = __dirname;
const overlay = path.join(businessRoot, ".orch1118-testdeps", "node_modules");
const bizModules = path.join(businessRoot, "node_modules");
// #1486 — prefer the worktree overlay when provisioned, else the business
// install (which the workflow populates with npm install --no-save).
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
    "**/__tests__/EditPublishedTripScreen.coverClose.adversarial.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|@testing-library|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom)",
  ],
  moduleNameMapper: {
    // #1486 — native modules with no jest side, reached through the screen's
    // import graph. Stubs only; the screen and its pickers are the real thing.
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
    "^expo-video$": path.join(businessRoot, "jest.issue1561.expo-video-stub.cjs"),
    "^expo-linear-gradient$": path.join(businessRoot, "jest.issue1561.linear-gradient-stub.cjs"),
    "^lottie-react-native$": path.join(businessRoot, "jest.issue1561.lottie-stub.cjs"),
    "^react-native-svg$": path.join(businessRoot, "jest.issue1561.svg-stub.cjs"),
    "^expo-constants$": path.join(businessRoot, "__manual_mocks__", "expo-constants.js"),
    "^expo-modules-core$": path.join(businessRoot, "__manual_mocks__", "expo-modules-core.js"),
    "^@mingla/location-input$": path.join(
      businessRoot,
      "..",
      "packages",
      "location-input",
      "index.ts",
    ),
    "^@mingla/location-input/(.*)$": path.join(
      businessRoot,
      "..",
      "packages",
      "location-input",
      "$1",
    ),
    "^react$": path.join(bizModules, "react"),
    "^react/(.*)$": path.join(bizModules, "react", "$1"),
    "^react-native$": path.join(bizModules, "react-native"),
    "^react-test-renderer$": path.join(testDeps, "react-test-renderer"),
    "^react-test-renderer/(.*)$": path.join(
      testDeps,
      "react-test-renderer",
      "$1",
    ),
    "^@testing-library/react-native$": path.join(
      testDeps,
      "@testing-library",
      "react-native",
    ),
    "^@testing-library/react-native/(.*)$": path.join(
      testDeps,
      "@testing-library",
      "react-native",
      "$1",
    ),
  },
  modulePaths: [testDeps, bizModules],
  setupFilesAfterEnv: [extendExpect],
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
