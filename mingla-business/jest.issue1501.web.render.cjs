// Issue #1501 [add-rooms-form] — WEB-RESOLVED render-proof config.
//
// WHY THIS EXISTS (the #1484 P1-1 lesson, restated): a react-test-renderer
// suite is structurally BLIND to react-native-web's class resolution. #1484's
// desktop uncap shipped broken while 29 headless render tests were green,
// because `react-native`'s `StyleSheet.flatten` and RNW's atomic-class compiler
// disagree about what actually reaches the DOM. Anything WIDTH- or
// FLEX-AXIS-related in #1501 is therefore also proved here, through the
// resolver that really ships on desktop web.
//
// `react-native` -> `react-native-web`, rendered via ReactDOMServer; the
// assertions read the EMITTED ATOMIC CLASSES.
//
// Run:
//   cd mingla-business &&
//   npx jest --config jest.issue1501.web.render.cjs --runInBand

const path = require("path");

const businessRoot = __dirname;

module.exports = {
  rootDir: businessRoot,
  testEnvironment: "node",
  // react-native-web's dev-only invariant helpers read the RN `__DEV__` global,
  // which only the metro/RN jest preset defines. This config is node-env, so
  // declare it explicitly (matches how the RN preset sets it).
  globals: { __DEV__: true },
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(businessRoot, "jest.orch1118.babel.cjs") },
    ],
  },
  testMatch: [
    "**/__tests__/stayFieldAxis.issue1501.web.render.test.tsx",
    "**/__tests__/stayEditorDesktop.issue1501.web.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|react-native-web|@react-native-community|react-native-svg|lucide-react-native|expo|@expo)",
  ],
  moduleNameMapper: {
    "^react-native$": "react-native-web",
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
  },
};
