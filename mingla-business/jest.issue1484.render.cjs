// Issue #1484 [stay-desktop-shell] — render-proof jest config.
//
// The Stay/Venue suite shells mount real RN components (Pressable, ScrollView,
// GlassCard, Button, lucide icons), so they need the react-native preset —
// NOT the default node/ts-jest config, which excludes every
// `*.render.test.tsx` on purpose (see jest.config.cjs).
//
// The suites render through `react-test-renderer`, which IS a real devDependency
// (19.1.0), so a plain `npm ci` is enough — no `--no-save` overlay, and nothing
// here depends on `@testing-library/react-native` (which is NOT in package.json
// and would add a TS2307 to the issue-1403 typecheck-delta gate).
//
// Run:
//   cd mingla-business && npx jest --config jest.issue1484.render.cjs --runInBand

const path = require("path");

const businessRoot = __dirname;

// #1532 [stay-manager-ux] — the Stay offering editor now lives inside the
// canonical `Sheet`, so every suite that mounts the Stay manager pulls
// `Sheet -> SheetMobile -> react-native-gesture-handler / -keyboard-controller /
// -safe-area-context` into its import graph. Those are native bindings with no
// jest side. Wiring the BOUNDARY STUBS here — in the config — rather than as
// `jest.mock` blocks inside each suite means no existing test file had to be
// touched to keep passing (the append-only gate stays untroubled, and the
// assertions are untouched).
module.exports = {
  rootDir: businessRoot,
  preset: "react-native",
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(businessRoot, "jest.orch1118.babel.cjs") },
    ],
  },
  testMatch: [
    "**/__tests__/staySuiteShell.issue1484.desktopShell.render.test.tsx",
    "**/__tests__/stayInventoryManager.issue1484.formMeasure.render.test.tsx",
    // TESTER-owned adversarial suite (issue #1484 verdict). Registered here so
    // it runs in the SAME `Issue #1484 Stay Desktop Shell` workflow job and is
    // never dark — the exact failure mode this branch had to report for
    // `venueSuiteShell.orch1184.fullwidth.adversarial.render.test.tsx` (#1486).
    "**/__tests__/suiteDesktopShell.issue1484.boundary.adversarial.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom|react-native-svg|lucide-react-native|react-native-keyboard-controller)",
  ],
  moduleNameMapper: {
    // #1532 — `Sheet`'s drag band mounts a real `<GestureDetector>`, which
    // wants a native binary AND reanimated 4's removed `useEvent`. Boundary
    // stub; an inline `jest.mock` in a suite still wins over this.
    "^react-native-gesture-handler$": path.join(
      businessRoot,
      "jest.issue1532.gesture-handler-stub.cjs",
    ),
    // #1532 — the library ships its own jest mock (`useKeyboardState` -> not
    // visible), which is what `useKeyboardIsVisible()` reads.
    "^react-native-keyboard-controller$": path.join(
      businessRoot,
      "node_modules",
      "react-native-keyboard-controller",
      "jest",
    ),
    // #1532 — `useSafeAreaInsets` throws outside a provider; zero insets.
    "^react-native-safe-area-context$": path.join(
      businessRoot,
      "jest.issue1532.safearea-stub.cjs",
    ),
    // `Button` → hapticFeedback → expo-haptics has no native side under jest;
    // reuse the committed no-op stub.
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
    // `GlassCard` → expo-blur (BlurView) needs expo-modules-core's native
    // EventEmitter (absent under jest); render children through a plain View.
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
  },
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
