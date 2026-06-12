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
// Run:
//   npx jest --config jest.orch1122.adversarial.render.cjs --runInBand

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
    "**/__tests__/EditPublishedTripScreen.coverClose.adversarial.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|@testing-library|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom)",
  ],
  moduleNameMapper: {
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
    "^react-test-renderer$": path.join(overlay, "react-test-renderer"),
    "^react-test-renderer/(.*)$": path.join(
      overlay,
      "react-test-renderer",
      "$1",
    ),
    "^@testing-library/react-native$": path.join(
      overlay,
      "@testing-library",
      "react-native",
    ),
    "^@testing-library/react-native/(.*)$": path.join(
      overlay,
      "@testing-library",
      "react-native",
      "$1",
    ),
  },
  modulePaths: [overlay, bizModules],
  setupFilesAfterEnv: [extendExpect],
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
