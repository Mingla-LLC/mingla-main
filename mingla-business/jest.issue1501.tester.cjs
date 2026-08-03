// Issue #1501 [add-rooms-form] — TESTER adversarial render config.
//
// A separate runner from `jest.issue1501.render.cjs` on purpose: the tester's
// suite must be able to run, fail and be reasoned about independently of the
// implementor's, and adding a `testMatch` entry to their config would couple
// the two. Same preset and same transforms, so a green run here means the same
// thing it means there.
//
// Run:
//   cd mingla-business && npx jest --config jest.issue1501.tester.cjs --runInBand

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
  testMatch: [
    "**/__tests__/stayEditorAdversarial.issue1501.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom|react-native-svg|lucide-react-native)",
  ],
  moduleNameMapper: {
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
  },
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
