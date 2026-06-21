// ORCH-1184 tester-owned ADVERSARIAL render-proof — worktree-local jest config.
// Mirrors the existing render configs (jest.orch1122.render.cjs etc.) but for
// the tester's mount/style-resolution test
// (venueSuiteShell.orch1184.fullwidth.adversarial.render.test.tsx).
//
// react-test-renderer@19.1.0 + @testing-library/react-native@^13 resolve from
// the standard `mingla-business/node_modules` in this worktree (npm hoisted
// them there; they are gitignored, so they never enter the diff). If a fresh
// worktree lacks them, provision once with:
//   cd mingla-business && npm i react-test-renderer@19.1.0 @testing-library/react-native@^13
//
// Run:
//   npx jest --config jest.orch1184.adversarial.render.cjs --runInBand

const path = require("path");

const businessRoot = __dirname;
const bizModules = path.join(businessRoot, "node_modules");

const fs = require("fs");
const rtlRoot = path.join(bizModules, "@testing-library", "react-native");
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
    "**/__tests__/venueSuiteShell.orch1184.fullwidth.adversarial.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|@testing-library|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom)",
  ],
  moduleNameMapper: {
    // `Button` (invitation card) → hapticFeedback → expo-haptics, which has no
    // native side under jest; reuse the committed no-op stub.
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
    // `GlassCard` → expo-blur (BlurView) needs expo-modules-core's native
    // EventEmitter (absent under jest); render children through a plain View.
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
  },
  setupFilesAfterEnv: [extendExpect],
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
