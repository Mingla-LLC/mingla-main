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
  testMatch: ["**/__tests__/stayLifecycleLayout.issue1944.render.test.tsx"],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom|react-native-svg|lucide-react-native|react-native-keyboard-controller)",
  ],
  moduleNameMapper: {
    "^expo-haptics$": path.join(
      businessRoot,
      "jest.orch1147r2.haptics-stub.cjs",
    ),
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
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
