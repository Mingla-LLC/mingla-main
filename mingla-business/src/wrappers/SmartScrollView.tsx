// ORCH-0892-B v2: SmartScrollView — web variant. Passthrough re-export of
// react-native's ScrollView. Re-exporting RN's ScrollView keeps the web bundle
// library-free (preserves ORCH-0892-A TA-1 anchor: zero
// react-native-keyboard-controller strings in web bundle).
//
// #2262 CORRECTION — this file used to claim "web has no soft keyboard that
// overlaps content". That is FALSE on mobile web, and it is the documented
// reason the marketing composer's keyboard migration was recorded as complete
// while the screen had no keyboard-aware container at all.
//
// Mobile web DOES have a soft keyboard and it DOES overlap content. What it does
// not do is shrink the CSS layout viewport — no mobile browser has since Chrome
// 108 matched Mobile Safari. It shrinks `window.visualViewport`, which
// react-native-web's `Dimensions` already reads and subscribes to
// (`dist/exports/Dimensions/index.js`), so the signal is published today and
// simply was not consumed. The correct compensation on web is a
// VIEWPORT-HEIGHT PIN at the screen root — see
// `app/(tabs)/marketing/_layout.tsx` — not a scroll wrapper, and not this
// library: `react-native-keyboard-controller` is a verified no-op on web
// (`lib/module/bindings.js` is all NOOP), so this file's behaviour is correct
// and unchanged. Only the stated reason was wrong.
//
// Per SPEC_ORCH-0892-B_v2 §7.A. Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY
// + I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY (both DRAFT — flip ACTIVE on
// ORCH-0892-C close).

export { ScrollView } from "react-native";
export type { ScrollViewProps } from "react-native";

/**
 * #1850 [quarantined-checkout-pins] — the web half of the Done-bar budget.
 *
 * `DONE_BAR_OCCUPIED` is DERIVED on native in SmartScrollView.native.tsx (#1834):
 * the keyboard toolbar's own height minus the library's OPENED_OFFSET, i.e. 53 on
 * iOS 26+ and 42 elsewhere. Four platform-agnostic screens now budget clearance
 * against that name instead of hand-typing a number, and Metro resolves THIS file
 * for them on web — so the name must exist on both sides of the split or the web
 * bundle reads `undefined` and silently budgets NaN.
 *
 * Zero is the honest web value, not a placeholder: web has no soft keyboard that
 * overlaps content (the reason this whole variant is a passthrough), so there is
 * no Done bar above it and nothing to clear. It is NOT measured-and-rounded-down
 * — there is no bar to measure (Constitution rule 9: missing is zero-by-argument,
 * never a fabricated number).
 */
export const DONE_BAR_OCCUPIED = 0;
