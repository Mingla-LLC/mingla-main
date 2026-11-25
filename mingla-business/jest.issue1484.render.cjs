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
    // #4490 08-O5 part A: the step-up PIN pad inside the sheet that asked.
    "**/__tests__/tillPin.issue4490.o5a.render.test.tsx",
    "**/__tests__/stayInventoryManager.issue1484.formMeasure.render.test.tsx",
    "**/__tests__/stayLifecycleLayout.issue1944.render.test.tsx",
    // TESTER-owned adversarial suite (issue #1484 verdict). Registered here so
    // it runs in the SAME `Issue #1484 Stay Desktop Shell` workflow job and is
    // never dark — the exact failure mode this branch had to report for
    // `venueSuiteShell.orch1184.fullwidth.adversarial.render.test.tsx` (#1486).
    "**/__tests__/suiteDesktopShell.issue1484.boundary.adversarial.render.test.tsx",
    // #4490 spec 08 O3 fix 3 (O3-S1): the iPhone Till presents one native modal per
    // presenter (Pay from inside the basket's sheet). Native Sheet + iOS platform.
    "**/__tests__/tillSheets.issue4490.o3fix3.render.test.tsx",
    // #4490 spec 08 O3 fix 4 (O3-S2): with no globalThis.crypto (Hermes) every Till
    // payment and refund sends a clientRequestId venue-till accepts (a UUID).
    "**/__tests__/tillRequestIds.issue4490.o3fix4.render.test.tsx",
    // #4490 spec 08 O3 fix 5 (O3-S3): one request id per payment / refund attempt;
    // "Pay <rest>" after a part payment is a new payment; the paid step shows the
    // amount the server recorded.
    "**/__tests__/tillAttempts.issue4490.o3fix5.render.test.tsx",
    "**/__tests__/tillSplit.issue4490.o4.render.test.tsx",
    // #4490 spec 08 O4 fix 1 (O4-T2): a check the table deposit fully pays shows
    // "Close check" and closes with no payment.
    "**/__tests__/tillCloseCheck.issue4490.o4fix1.render.test.tsx",
    // #4490 spec 08 O4 fix 2 (O4-B1, O4-B4): tips on the payment's own part; Pay in full on a split check.
    "**/__tests__/tillTips.issue4490.o4fix2.render.test.tsx",
    // #4490 spec 08 O4 fix 3 (spec 08 §15): a deposit larger than the bill.
    "**/__tests__/tillDepositExcess.issue4490.o4fix3.render.test.tsx",
    // #4490 spec 08 O5 part B: Close the day (one sheet at a time; the reopen PIN inside it).
    "**/__tests__/dayClose.issue4490.o5b.render.test.tsx",
    // #4490 spec 08 O5 fix 2 (O5-B4): the closed-day headline money is never cut off, 390 to 1440.
    "**/__tests__/dayCloseMoney.issue4490.o5fix2.render.test.tsx",
    // #4490 spec 08 O5 fix 2 (O5-B2): stock reads come back from the server after every stock change.
    "**/__tests__/tillStockRefresh.issue4490.o5fix2.render.test.tsx",
    // #4490 spec 08 O5 fix 2 (O5-B1): set your own Till PIN from Brand > Team (your own row).
    "**/__tests__/teamOwnPin.issue4490.o5fix2.render.test.tsx",
    // #4490 spec 08 O5 fix 2 (carried 1): sold out after payment on a Till device (one sheet, PIN asked again).
    "**/__tests__/tillSoldOut.issue4490.o5fix2.render.test.tsx",
    // #4490 spec 08 O5 fix 4: the Till items of the device and browser pass (tile chip, late payment name, split, paid check, web PIN keys, part payment label).
    "**/__tests__/tillDevicePass.issue4490.o5fix4.render.test.tsx",
    // #4490 08-O5 fix 5: the Till, Who's selling, day close and kitchen fixes from the web + iOS re-check.
    "**/__tests__/tillDevicePass2.issue4490.o5fix5.render.test.tsx",
    // #4490 08-O5 fix 6: device pass 3 (kitchen header, day close money and checks, payment rows, PIN pad reach and dismissal, Team role wait).
    "**/__tests__/tillDevicePass3.issue4490.o5fix6.render.test.tsx",
    // #4490: the guest pay pages show the Mingla logo image, not the word typed out.
    "**/__tests__/guestPayWordmark.issue4490.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|test-renderer|react-clone-referenced-element|@react-native-async-storage|expo|@expo|react-native-safe-area-context|@gorhom|react-native-svg|lucide-react-native|react-native-keyboard-controller)",
  ],
  moduleNameMapper: {
    // #4490 venue owners — jest-only lazy stand-ins for the two owner barrels:
    // a suite loads only the screens it opens (see the stub's header).
    "^\\./venueHostScreens$": path.join(businessRoot, "jest.issue4490.venue-host-owner-stub.cjs"),
    "^\\./venueGuestScreens$": path.join(businessRoot, "jest.issue4490.venue-guest-owner-stub.cjs"),
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
