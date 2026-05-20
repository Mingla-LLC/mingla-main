// ORCH-0892-A v2 (post-QA rework per QA report §11 Path A): KAV
// native variant — re-export the library's frame-perfect
// KeyboardAvoidingView. Metro picks this file on iOS + Android.
//
// The library's KAV subscribes to native keyboard frame events via
// the KeyboardProvider (mounted at root via KeyboardRoot.native.tsx)
// and adjusts padding at 60fps. Consumers import from this wrapper,
// NOT from 'react-native-keyboard-controller' directly, so Metro
// keeps the library out of the web bundle.
//
// Per SPEC_ORCH-0892-A §7.4/§7.5/§7.6 + QA_ORCH-0892-A §11 Path A.
// Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY.

export { KeyboardAvoidingView } from "react-native-keyboard-controller";
