/**
 * #1627 [keyboard-guard-vacuity]: SmartKeyboardAvoidingView — NATIVE variant.
 *
 * A re-export, and nothing else. `KeyboardAvoidingView` here IS the library's
 * component, so the rendered element tree on iOS and Android is byte-identical
 * to what the call sites rendered before the split: same component, same
 * props, same position. That identity is the whole anti-regression argument —
 * the bank picker's measured 377pt lift (#1834) and the group-chat composer's
 * 42pt lift (ORCH-1165) are preserved BY CONSTRUCTION, not by re-testing a
 * reimplementation.
 *
 * Subtracting logic rather than adding a shim is deliberate: any behaviour
 * written here would be behaviour that CAN drift from the web variant.
 *
 * orch-strict-grep-allow orch-0892 — native keyboard wrapper; the library IS the
 * canonical primitive here (I-PROPOSED-KEYBOARD-LIBRARY-ONLY). Written in the
 * ` * ` JSDoc form on purpose, mirroring SupportThread.native.tsx:13: this file
 * trips none of orch-0892's four patterns (its KeyboardAvoidingView comes from
 * the LIBRARY, not from "react-native"), so it needs no honoured exemption. The
 * gate recognises only `//` and `/*` markers, so this line records the reason
 * for a human without registering a marker TA-V3-5 would then demand be listed
 * in EXPECTED_ALLOWLISTED_FILES — a constant #1841 owns.
 *
 * Invariants: I-PROPOSED-1627-NO-NATIVE-KEYBOARD-LIBRARY-IN-THE-WEB-GRAPH
 * (DRAFT) · I-PROPOSED-KEYBOARD-LIBRARY-ONLY.
 */

export { KeyboardAvoidingView } from "react-native-keyboard-controller";
export type { KeyboardAvoidingViewProps as SmartKeyboardAvoidingViewProps } from "react-native-keyboard-controller";
