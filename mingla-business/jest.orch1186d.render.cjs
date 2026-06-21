// ORCH-1186-D — venue blasts entry render-proof — worktree-local jest config.
// Mirrors the existing render configs (jest.orch1184.adversarial.render.cjs etc.)
// for the VenueSettingsModule component test that actually MOUNTS the module and
// asserts the "Message your guests" row navigates the composer with the venue's
// brand audience (T-4) and early-returns when brandId is null (T-5).
//
// react-test-renderer@19.1.0 + @testing-library/react-native@^13 resolve from
// the standard `mingla-business/node_modules` in this worktree (npm hoisted them
// there; they are gitignored, so they never enter the diff). If a fresh worktree
// lacks them, provision once with:
//   cd mingla-business && npm i react-test-renderer@19.1.0 @testing-library/react-native@^13
//
// Run:
//   npx jest --config jest.orch1186d.render.cjs --runInBand

const path = require("path");
const fs = require("fs");

const businessRoot = __dirname;
const bizModules = path.join(businessRoot, "node_modules");

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
    "**/__tests__/venueSettingsModule.orch1186d.blastEntry.render.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|@testing-library|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom|react-native-reanimated)",
  ],
  moduleNameMapper: {
    // hapticFeedback → expo-haptics has no native side under jest; no-op stub.
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
    // GlassCard → expo-blur (BlurView) needs native EventEmitter; render a View.
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
  },
  setupFiles: [
    // react-native-gesture-handler is pulled in transitively via Input → Sheet →
    // SheetMobile; its jestSetup registers the native-module shim so the import
    // graph resolves under jest. reanimated's mock satisfies the Button animation.
    path.join(bizModules, "react-native-gesture-handler", "jestSetup.js"),
    path.join(bizModules, "react-native-reanimated", "mock.js"),
  ],
  setupFilesAfterEnv: [extendExpect],
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
