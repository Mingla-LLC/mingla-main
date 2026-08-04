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
//   npx jest --config jest.orch1190r2.tablecard.web.render.cjs --runInBand

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
    "**/__tests__/venueTableCardMobileWidth.orch1190r2.web.render.test.tsx",
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
