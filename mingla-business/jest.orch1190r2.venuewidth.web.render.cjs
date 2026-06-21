// ORCH-1190 R2 BUG-2 — venue empty-state FULL-WIDTH web render-proof config.
//
// Renders the REAL VenueReservationsModule / VenueWaitlistModule / VenueMenuModule
// EMPTY states through react-native-web (the deployed business web target) via
// ReactDOMServer, so we can assert the empty-state GlassCard wrapper spans the
// full content width — the prod web bug Seth flagged: those three modules' empty
// cards rendered as a narrow, centered ~half-width card while Tables/Settings
// content cards (width:"100%") spanned the workspace.
//
// Native (`ios`-platform) render configs structurally cannot catch this: on web
// a column flex child with no explicit width + alignItems:"center" shrinks to its
// centered content's min width; the `width:"100%"` fix is what forces edge-to-edge.
//
// `react-native` is aliased to `react-native-web`; `expo-blur` → the committed
// no-op blur stub (GlassCard → GlassChrome → BlurView has no native side under
// jest). Both already hoisted into mingla-business/node_modules (gitignored, never
// in the diff). If a fresh worktree lacks them:
//   cd mingla-business && npm i react-native-web react-dom
//
// Run:
//   npx jest --config jest.orch1190r2.venuewidth.web.render.cjs --runInBand

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
    "**/__tests__/venueEmptyStateFullWidth.orch1190r2.web.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|react-native-web|@react-native-community|expo|@expo)",
  ],
  moduleNameMapper: {
    // Render the WEB build (the deployed business web target's components).
    "^react-native$": "react-native-web",
    // GlassCard → GlassChrome → expo-blur BlurView has no native side under jest;
    // render children through a plain View (purely decorative, zero bearing on
    // the width style under assertion).
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
    // Button → hapticFeedback → expo-haptics has no native side under jest.
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
  },
};
