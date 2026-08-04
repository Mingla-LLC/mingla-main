// issue #1561 [first-screen-rebuild] — WEB render-proof config.
//
// WHY A SEPARATE CONFIG. Three of this step's claims are web-visible and
// INVISIBLE to react-test-renderer, which reports the JS style objects rather
// than what react-native-web's style compiler emits:
//
//   1. the hero CAP — `coverAspectRatio` only actually constrains the hero if
//      RNW turns it into a real `aspect-ratio` declaration on the pinned cover
//      AND on its flow spacer (the spacer is what holds the seam in place; a
//      ratio that reached one and not the other would leave a gap or an
//      overlap on live web and look fine in every headless RN test);
//   2. the ANSWER BAR being a ROW — `flexDirection: "row"` with `flex: 1`
//      cells. On web this is the difference between three cells side by side
//      and three cells stacked down the page, which would push the bar below
//      the fold and undo the measurement this whole step is about;
//   3. the placeholder no longer reading `COVER` — the string has to reach the
//      DOM.
//
// So: `react-native` → `react-native-web`, rendered through RNW's own
// `AppRegistry.getApplication`, which yields BOTH the markup and the compiled
// stylesheet. The assertions read the emitted CSS declarations, not class-name
// hashes, so they stay readable and cannot drift with an RNW version bump.
//
// Run:
//   cd mingla-business && npx jest --config jest.issue1561.web.render.cjs --runInBand

const path = require("path");

const businessRoot = __dirname;

module.exports = {
  rootDir: businessRoot,
  testEnvironment: "node",
  // RNW's dev-only invariant helpers read the RN `__DEV__` global, which only
  // the metro/RN jest preset defines. This config is node-env, so declare it.
  globals: { __DEV__: true },
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(businessRoot, "jest.orch1118.babel.cjs") },
    ],
  },
  testMatch: [
    "**/__tests__/venueFirstScreen.issue1561.web.render.test.tsx",
  ],
  // RESOLUTION REPAIR, not a mock — the same problem `jest.config.cjs` documents
  // at its `^react$` map. This suite mounts the REAL `ParallaxCoverShell`, which
  // lives in `packages/offering-rendering/`; node resolution walks up from THERE
  // and never reaches `mingla-business/node_modules`, which is the only place
  // `react`, `react-native-web`, `@babel/runtime` and the expo/svg peers are
  // installed. Adding that directory as an absolute module path makes every
  // dependency resolve to the ONE real copy the app ships.
  modulePaths: [path.join(businessRoot, "node_modules")],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|react-native-web|@react-native-community|react-native-svg|lucide-react-native|expo|@expo)",
  ],
  moduleNameMapper: {
    "^react-native-safe-area-context$": path.join(
      businessRoot,
      "jest.issue1532.safearea-stub.cjs",
    ),
    "^react-native-gesture-handler$": path.join(
      businessRoot,
      "jest.issue1532.gesture-handler-stub.cjs",
    ),
    "^react-native$": "react-native-web",
    // `react-native-svg` publishes both a native and a WEB implementation and
    // picks between them with a metro platform extension, which jest does not
    // apply. Point the bare specifier at the WEB build — the one buyer web
    // actually loads — or `ReactNativeSVG.ts` pulls the Fabric native component
    // registry in and the whole suite dies on `__fbBatchedBridgeConfig`.
    "^react-native-svg$": path.join(businessRoot, "jest.issue1561.svg-stub.cjs"),
    "^lottie-react-native$": path.join(
      businessRoot,
      "jest.issue1561.lottie-stub.cjs",
    ),
    "^expo-video$": path.join(businessRoot, "jest.issue1561.expo-video-stub.cjs"),
    "^expo-linear-gradient$": path.join(
      businessRoot,
      "jest.issue1561.linear-gradient-stub.cjs",
    ),
    "^expo-modules-core$": path.join(
      businessRoot,
      "__manual_mocks__",
      "expo-modules-core.js",
    ),
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
  },
};
