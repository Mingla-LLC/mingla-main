// Issue #1484 [stay-desktop-shell] — render-proof jest config.
//
// The Stay/Venue suite shells mount real RN components (Pressable, ScrollView,
// GlassCard, Button, lucide icons), so they need the react-native preset +
// @testing-library/react-native — NOT the default node/ts-jest config, which
// excludes every `*.render.test.tsx` on purpose (see jest.config.cjs).
//
// react-test-renderer + @testing-library/react-native are TEST-ONLY and are
// deliberately not app dependencies; CI installs them with `--no-save`
// (see .github/workflows/issue-1484-stay-desktop-shell-tests.yml). Locally:
//   cd mingla-business && \
//     npm install --no-save react-test-renderer@19.1.0 @testing-library/react-native
//
// Run:
//   cd mingla-business && npx jest --config jest.issue1484.render.cjs --runInBand

const fs = require("fs");
const path = require("path");

const businessRoot = __dirname;
const modules = path.join(businessRoot, "node_modules");

const rtlRoot = path.join(modules, "@testing-library", "react-native");
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
    "**/__tests__/staySuiteShell.issue1484.desktopShell.render.test.tsx",
    "**/__tests__/stayInventoryManager.issue1484.formMeasure.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|@testing-library|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom|react-native-svg|lucide-react-native)",
  ],
  moduleNameMapper: {
    // `Button` → hapticFeedback → expo-haptics has no native side under jest;
    // reuse the committed no-op stub.
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
