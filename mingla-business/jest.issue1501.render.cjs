// Issue #1501 [add-rooms-form] — render-proof jest config (react-test-renderer).
//
// The Add Rooms or Places editor mounts real RN components (Pressable,
// ScrollView, TextInput, GlassCard, Button, lucide icons), so it needs the
// react-native preset — NOT the default node/ts-jest config, which excludes
// every `*.render.test.tsx` on purpose (see jest.config.cjs).
//
// `react-test-renderer` IS a real devDependency (19.1.0), so a plain `npm ci`
// is enough — nothing here depends on `@testing-library/react-native` (absent
// from package.json; importing it would add a TS2307 to the issue-1403
// typecheck-delta gate).
//
// Run:
//   cd mingla-business && npx jest --config jest.issue1501.render.cjs --runInBand

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
    "**/__tests__/stayFieldAxis.issue1501.render.test.tsx",
    "**/__tests__/stayOfferingEditor.issue1501.render.test.tsx",
    "**/__tests__/stayOfferingInputs.issue1501.render.test.tsx",
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
