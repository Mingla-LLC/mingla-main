// #1780 — deployed-web checkbox semantics for the invite picker.
// Renders the real product components through react-native-web, not the native
// renderer, so aria-checked is proved at the emitted DOM boundary.

const path = require("path");

module.exports = {
  rootDir: __dirname,
  testEnvironment: "node",
  globals: { __DEV__: true },
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(__dirname, "jest.orch1118.babel.cjs") },
    ],
  },
  testMatch: [
    "**/__tests__/InvitePeopleStep.issue1780.webA11y.tester_adversarial.web.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|react-native-web|@react-native-community|expo|@expo)",
  ],
  moduleNameMapper: {
    "^react-native$": "react-native-web",
    "^react-native-reanimated$": path.join(__dirname, "jest.orch1211.reanimated-web-stub.cjs"),
    "^expo-haptics$": path.join(__dirname, "jest.orch1147r2.haptics-stub.cjs"),
  },
};
