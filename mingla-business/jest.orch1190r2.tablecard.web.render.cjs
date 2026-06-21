// ORCH-1190 R2 — venue TABLE-CARD mobile full-width web render-proof config.
//
// Renders the REAL VenueTablesModule populated state through react-native-web
// (the deployed business web target) via ReactDOMServer, so we can assert the
// table card + inner row + text column carry the layout styles that keep the
// tile full-width on a narrow mobile viewport — the prod bug Seth flagged: an
// added table tile rendered cramped with the title wrapping one char per line.
//
// `react-native` is aliased to `react-native-web`; `expo-blur` → the committed
// no-op blur stub (GlassCard → GlassChrome → BlurView has no native side under
// jest); `expo-haptics` → the no-op haptics stub.
//
// Run:
//   npx jest --config jest.orch1190r2.tablecard.web.render.cjs --runInBand

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
    "**/__tests__/venueTableCardMobileWidth.orch1190r2.web.render.test.tsx",
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
