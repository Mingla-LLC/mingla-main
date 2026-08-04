// Issue #1532 [stay-manager-ux] — render-proof jest config.
//
// The four defects Seth reported are all RENDERED facts — a gap that measures
// zero, a chip row that inflates to keyboard height, a tab that turns orange
// while the content does not change, a heading that contradicts the button that
// opened it. None of them can be proved by reading source text, and three of
// them were invisible to the render suites that were green when they shipped.
//
// Same preset + transforms as `jest.issue1501.render.cjs`, plus the boundary
// stubs the canonical `Sheet` needs (gesture-handler / keyboard-controller /
// safe-area-context) now that the Stay editor is a committed task inside one.
//
// Run:
//   cd mingla-business && npx jest --config jest.issue1532.render.cjs --runInBand

const path = require("path");

const businessRoot = __dirname;

module.exports = {
  rootDir: businessRoot,
  preset: "react-native",
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(businessRoot, "jest.orch1118.babel.cjs") },
    ],
  },
  testMatch: ["**/__tests__/stayManagerUx.issue1532.render.test.tsx"],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom|react-native-svg|lucide-react-native|react-native-keyboard-controller)",
  ],
  moduleNameMapper: {
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
    "^react-native-gesture-handler$": path.join(
      businessRoot,
      "jest.issue1532.gesture-handler-stub.cjs",
    ),
    "^react-native-safe-area-context$": path.join(
      businessRoot,
      "jest.issue1532.safearea-stub.cjs",
    ),
    "^react-native-keyboard-controller$": path.join(
      businessRoot,
      "node_modules",
      "react-native-keyboard-controller",
      "jest",
    ),
  },
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
