// ORCH-1190 R3 — venue empty-state FULL-WIDTH web render-proof config (robust).
//
// Renders the REAL VenueReservationsModule / VenueWaitlistModule / VenueMenuModule
// EMPTY states through react-native-web (the deployed business web target) via
// ReactDOMServer, and asserts the empty-state card is wrapped in a stretching
// wrapper (alignSelf:"stretch") with NO fragile width:"100%".
//
// WHY R3 (the R2 config + test asserted the OPPOSITE — width:"100%"): R2's fix
// did not hold on the live web because an explicit width:"100%" can DEFEAT
// alignSelf:"stretch" under an indefinite-width flex ancestor (proven with
// Playwright + real RNW; see IMPLEMENT_ORCH-1190-FULLWIDTH-WEB.md). R3 removes
// the fragile width and relies on a stretching wrapper + alignSelf:"stretch".
//
// `react-native` → `react-native-web`; `expo-blur` → committed no-op blur stub.
//
// Run:
//   npx jest --config jest.orch1190r3.venuewidth.web.render.cjs --runInBand

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
    "**/__tests__/venueEmptyStateFullWidth.orch1190r3.web.render.test.tsx",
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
