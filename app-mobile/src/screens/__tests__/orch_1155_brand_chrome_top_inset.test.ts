// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1155 [public-brand-page] Known-Issue #1 — implementor happy-path
// regression for the consumer brand-page chrome top-inset.
//
// BUG: the consumer brand-page screen mounted the shared PublicBrandPage without
// feeding the device safe-area top inset, so safeAreaTop defaulted to 0 and the
// X / Share chrome rendered at +12px (under the notch / status bar) on native.
// Every other Direction-A consumer page (trip/event/experience) passes the top
// inset into its chrome. The fix passes chromeTopOffset={insets.top}; the shared
// shell adds its own +12 gap → effective insets.top + 12, identical to
// ConsumerTripDetailScreen / ConsumerExperienceDetailScreen native chrome.
//
// app-mobile has no jest/RTL runner; the repo convention is node:assert
// source-assertions (see orch_1155_brand_badge_nav.test.ts). Each assertion
// FAILS on a true LINE-DELETION of the wiring it protects (fails-on-revert),
// NOT on a comment-out.
//
// Run with:
//   node app-mobile/src/screens/__tests__/orch_1155_brand_chrome_top_inset.test.ts

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) =>
  fs.readFileSync(path.join(__dirname, "..", "..", "..", rel), "utf8");

const screen = read("src/screens/ConsumerBrandProfileScreen.tsx");

// 1) The screen imports useSafeAreaInsets (the established consumer pattern,
//    mirroring ConsumerTripDetailScreen / ConsumerExperienceDetailScreen).
assert.ok(
  /import\s*\{\s*useSafeAreaInsets\s*\}\s*from\s*["']react-native-safe-area-context["']/.test(
    screen,
  ),
  "ConsumerBrandProfileScreen must import useSafeAreaInsets from react-native-safe-area-context",
);

// 2) It reads the live insets.
assert.ok(
  /const\s+insets\s*=\s*useSafeAreaInsets\(\)/.test(screen),
  "ConsumerBrandProfileScreen must read insets via useSafeAreaInsets()",
);

// 3) It feeds a NON-ZERO top inset into the shared page's chrome via
//    chromeTopOffset={insets.top} (regression guard: dropping this drops the
//    notch clearance → the X / Share chrome collides with the status bar).
assert.ok(
  /chromeTopOffset=\{insets\.top\}/.test(screen),
  "ConsumerBrandProfileScreen must pass chromeTopOffset={insets.top} so the chrome clears the notch on native",
);

console.log(
  "orch_1155_brand_chrome_top_inset: PASS — consumer brand page feeds insets.top into the shared chrome (X / Share clear the notch on native).",
);
