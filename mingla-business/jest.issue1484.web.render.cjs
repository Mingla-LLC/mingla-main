// Issue #1484 [stay-desktop-shell] — DESKTOP WIDTH web render-proof config.
//
// WHY THIS EXISTS (the #1484 P1-1 lesson): the desktop uncap shipped BROKEN
// while 29 headless react-native render tests were green. The cap was expressed
// as `[styles.page, <an override setting maxWidth to undefined>]`; under plain
// `react-native` the flattened style keeps the key with value `undefined`, so
// `expect(flat.maxWidth).toBeUndefined()` passed either way. Under
// `react-native-web` — the resolver that actually SHIPS on desktop web — the
// base style's atomic `r-maxWidth-*` class survives into the DOM and the cap
// still applies. Only a render through RNW's real style compiler can see that.
//
// So: `react-native` → `react-native-web`, rendered via ReactDOMServer, and the
// assertions read the EMITTED ATOMIC CLASSES — the same `r-maxWidth-*` atoms
// the tester read out of the live browser.
//
// Run:
//   cd mingla-business && npx jest --config jest.issue1484.web.render.cjs --runInBand

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
    "**/__tests__/stayDesktopWidth.issue1484.web.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|react-native-web|@react-native-community|react-native-svg|lucide-react-native|expo|@expo)",
  ],
  moduleNameMapper: {
    // #1532 — the Stay editor now mounts inside the canonical `Sheet`, which
    // pulls `react-native-safe-area-context` / `-gesture-handler` /
    // `-keyboard-controller` into the graph. Under the WEB resolver those still
    // resolve to their NATIVE implementations and reach for the RN bridge, so
    // the whole suite fails to LOAD. Boundary stubs, in the config, so no
    // existing test file had to change.
    "^react-native-safe-area-context$": path.join(
      businessRoot,
      "jest.issue1532.safearea-stub.cjs",
    ),
    "^react-native-gesture-handler$": path.join(
      businessRoot,
      "jest.issue1532.gesture-handler-stub.cjs",
    ),
    "^react-native-keyboard-controller$": path.join(
      businessRoot,
      "node_modules",
      "react-native-keyboard-controller",
      "jest",
    ),
    "^react-native$": "react-native-web",
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
  },
};
