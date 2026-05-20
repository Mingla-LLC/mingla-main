// ORCH-0892-A v2 (post-QA rework per QA report §11 Path A): KAV web
// variant — re-export react-native's own KeyboardAvoidingView. This
// works on react-native-web (it was the pre-ORCH-0892 production
// behavior on web). Metro picks this file on web.
//
// Why this exists: ORCH-0892-A v1 had the three pilot files import
// KAV directly from the keyboard library in regular .tsx files,
// which Metro bundled for ALL platforms — leaking ~67 library
// references into the web bundle (QA TA-1 RED). This wrapper pair
// mirrors the KeyboardRoot.{tsx,native.tsx} pattern: web variant is
// the lightweight react-native KAV, native variant is the library.
//
// Per SPEC_ORCH-0892-A §7.4/§7.5/§7.6 + QA_ORCH-0892-A §11 Path A.
// Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY (DRAFT).

export { KeyboardAvoidingView } from "react-native";
