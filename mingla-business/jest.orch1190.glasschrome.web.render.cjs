// ORCH-1190 (attempt #5) — GlassChrome inner-surface full-width web render-proof.
// Renders the REAL GlassChrome primitive through react-native-web via
// ReactDOMServer and asserts the inner clip/content layers carry
// alignSelf:"stretch" (the proven Chromium-measured fix). See the test file's
// header for the real-Chromium measurement evidence.
//   npx jest --config jest.orch1190.glasschrome.web.render.cjs --runInBand
const path = require("path");
const businessRoot = __dirname;
module.exports = {
  rootDir: businessRoot,
  testEnvironment: "node",
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(businessRoot, "jest.orch1118.babel.cjs") },
    ],
  },
  testMatch: [
    "**/__tests__/glassChromeFullWidthSurface.orch1190.web.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|react-native-web|@react-native-community|expo|@expo)",
  ],
  moduleNameMapper: {
    "^react-native$": "react-native-web",
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
  },
};
