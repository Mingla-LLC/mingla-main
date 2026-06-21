// ORCH-1193 [venue/event sheet bottom-cutoff fix] — body-ScrollView bounded
// WEB render-proof config.
//
// Renders the REAL VenueTableSheet through react-native-web (the deployed
// business web target) via ReactDOMServer, so we can assert the body ScrollView
// carries `flex:1` (compiled by react-native-web to an inline `style="flex:1"`)
// — the bound that keeps the scroll viewport inside the fixed-height,
// overflow:hidden SheetMobile panel so the CTA is reachable instead of clipped.
//
// `react-native` is aliased to `react-native-web`; expo-blur/expo-haptics →
// committed no-op stubs (already hoisted into mingla-business/node_modules,
// gitignored, never in the diff). If a fresh worktree lacks react-native-web:
//   cd mingla-business && npm i react-native-web react-dom
//
// Run:
//   npx jest --config jest.orch1193.sheetscroll.web.render.cjs --runInBand

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
    "**/__tests__/sheetBodyScrollBounded.orch1193.web.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|react-native-web|@react-native-community|expo|@expo)",
  ],
  moduleNameMapper: {
    // Render the WEB build (the deployed business web target's components).
    "^react-native$": "react-native-web",
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
  },
};
