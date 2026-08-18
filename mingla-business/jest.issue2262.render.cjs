// #2262 [composer-responsive-layout] — band-contract render config.
//
// Copied VERBATIM from `jest.issue1501.render.cjs`, changing only `testMatch`
// and adding an `expo-linear-gradient` boundary stub. Same RN preset, same
// `jest.orch1118.babel.cjs` transform, same four boundary stubs, same
// `haste.defaultPlatform: "ios"` — so the composer resolves its NATIVE variants
// (`richEditor.native.ts`, `SmartKeyboardAvoidingView.native.tsx`), which is the
// surface where pell genuinely needs a pixel height.
//
// `react-test-renderer@19.1.0` is already a real devDependency — no
// `--no-save` overlay, no new dependency, no lockfile touched.
//
// Run:
//   cd mingla-business && npx jest --config jest.issue2262.render.cjs --runInBand
//
// ─── inherited header from jest.issue1501.render.cjs ────────────────────────
// Issue #1501 [add-rooms-form] — render-proof jest config (react-test-renderer).
//
// The Add Rooms or Places editor mounts real RN components (Pressable,
// ScrollView, TextInput, GlassCard, Button, lucide icons), so it needs the
// react-native preset — NOT the default node/ts-jest config, which excludes
// every `*.render.test.tsx` on purpose (see jest.config.cjs).
//
// `react-test-renderer` IS a real devDependency (19.1.0), so a plain `npm ci`
// is enough — nothing here depends on `@testing-library/react-native` (absent
// from package.json; importing it would add a TS2307 to the issue-1403
// typecheck-delta gate).
//
// Run:
//   cd mingla-business && npx jest --config jest.issue1501.render.cjs --runInBand

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
  testMatch: ["**/__tests__/composerBandContract.issue2262.render.test.tsx"],
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
    "^expo-haptics$": path.join(businessRoot, "jest.orch1147r2.haptics-stub.cjs"),
    "^expo-blur$": path.join(businessRoot, "jest.orch1147r2.blur-stub.cjs"),
  },
  haste: {
    defaultPlatform: "ios",
    platforms: ["ios", "android", "native"],
  },
};
