// ORCH-1211 [business notifications inbox crashes on mobile web] — WEB render
// proof config.
//
// Renders the REAL BusinessNotificationsScreen through react-native-web (the
// deployed business web target) via ReactDOMServer, with reanimated pinned to the
// proven WEB module-eval condition (LinearTransition === undefined) so the render
// is a TRUE fails-on-revert proof of the actual /notifications web crash:
//   - FIXED: the `isWeb ? undefined : LinearTransition…` guard short-circuits →
//     the screen imports + renders the inbox states (T-1 populated / T-2 empty /
//     T-6 error) with NO throw and NO "Something broke".
//   - REVERTED (line 145 unguarded): `LinearTransition.duration(...)` reads
//     `.duration` on `undefined` at import → throws → the test FAILS.
//
// `react-native` → `react-native-web`; reanimated → the ORCH-1211 web stub;
// expo-blur/expo-haptics → committed no-op stubs; ReanimatedSwipeable (native-only
// subpath, never on web) → passthrough stub so the top-level import resolves.
// The hook is mocked in the test file. If a fresh worktree lacks react-native-web:
//   cd mingla-business && npm i react-native-web react-dom
//
// Run:
//   npx jest --config jest.orch1211.notifweb.render.cjs --runInBand

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
    "**/__tests__/notifWebRender.orch1211.web.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|react-native-web|@react-native-community|react-native-svg|expo|@expo)",
  ],
  moduleNameMapper: {
    // Render the WEB build (the deployed business web target's components).
    "^react-native$": "react-native-web",
    // Pin reanimated to the proven web module-eval condition (LinearTransition
    // undefined) — the faithful fails-on-revert reproduction.
    "^react-native-reanimated$": path.join(
      businessRoot,
      "jest.orch1211.reanimated-web-stub.cjs",
    ),
    // ReanimatedSwipeable is the native-only swipe panel (web never renders it —
    // the `if (isWeb) return` guard branches off). Stub the top-level import so
    // it resolves under the web render without pulling native gesture-handler.
    "^react-native-gesture-handler/ReanimatedSwipeable$": path.join(
      businessRoot,
      "jest.orch1211.swipeable-stub.cjs",
    ),
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
  },
};
