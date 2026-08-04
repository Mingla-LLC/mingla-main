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
// ── #1486 — WHY THIS CONFIG NEEDED REPAIR BEFORE IT COULD BE WIRED ──────────
// This suite was invoked by no workflow, so nothing noticed when the component
// tree it mounts grew a `lucide-react-native` icon. lucide pulls
// `react-native-svg`, whose fabric specs require the real `react-native`
// (bypassing the `^react-native$` → `react-native-web` alias, which is anchored
// and does not catch deep `react-native/Libraries/...` paths) and immediately
// dereference `__DEV__`. Result: `ReferenceError: __DEV__ is not defined`, and
// the suite could not even start. The repair is the same pair the modern,
// workflow-invoked `jest.issue1561.web.render.cjs` already carries: declare
// `__DEV__` and stub `react-native-svg` at the web boundary. Once repaired the
// suite passes — the layout contract it guards was never broken; only its
// harness had rotted, unobserved, because nothing ran it.
//
// Run:
//   npx jest --config jest.orch1190r3.venuewidth.web.render.cjs --runInBand

const path = require("path");

const businessRoot = __dirname;

module.exports = {
  rootDir: businessRoot,
  testEnvironment: "node",
  globals: { __DEV__: true },
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
    "node_modules/(?!(jest-)?react-native|@react-native|react-native-web|@react-native-community|react-native-svg|lucide-react-native|expo|@expo)",
  ],
  moduleNameMapper: {
    "^react-native$": "react-native-web",
    // #1486 — lucide-react-native -> react-native-svg fabric specs reach the
    // REAL react-native through deep paths the anchored alias above cannot
    // catch. Stub svg at the web boundary, exactly as jest.issue1561.web.render.cjs does.
    "^react-native-svg$": path.join(businessRoot, "jest.issue1561.svg-stub.cjs"),
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
  },
};
