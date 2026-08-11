// ORCH-0892-B v2: SmartScrollView — web variant. Passthrough re-export of
// react-native's ScrollView. Web has no soft keyboard that overlaps content;
// the library's KeyboardAwareScrollView is a no-op there. Re-exporting RN's
// ScrollView keeps the web bundle library-free (preserves ORCH-0892-A TA-1
// anchor: zero react-native-keyboard-controller strings in web bundle).
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
