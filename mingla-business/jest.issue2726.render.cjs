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
    "**/__tests__/restaurantHubPolish.issue2726.happy.render.test.tsx",
    "**/__tests__/restaurantHubPolish.issue2726.tester.adversarial.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|react-test-renderer|lucide-react-native|react-native-svg|expo|@expo)",
  ],
  moduleNameMapper: {
    "^react-native-svg$": path.join(businessRoot, "jest.issue1561.svg-stub.cjs"),
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
  },
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
