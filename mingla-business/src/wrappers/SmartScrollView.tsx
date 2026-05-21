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
