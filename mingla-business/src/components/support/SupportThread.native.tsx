/**
 * SupportThread (native) — META-ORCH-1104 Phase 1.
 *
 * Native variant: wires the support thread's composer through the
 * react-native-keyboard-controller `KeyboardAvoidingView` (the canonical Mingla
 * sticky-composer-above-keyboard primitive, per I-PROPOSED-KEYBOARD-LIBRARY-ONLY
 * / ORCH-0892-C). Metro picks this file on iOS + Android.
 *
 * This is the ONLY support file that imports the native keyboard module — the
 * web variant (SupportThread.tsx) is a passthrough, and the shared
 * SupportThreadCore never touches it. Enforced by I-1104-NO-KBC-ON-WEB (§2.10).
 *
 * orch-strict-grep-allow orch-0892 — support composer needs sticky-above-keyboard lift
 */

import React from "react";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import {
  SupportThreadCore,
  type KeyboardWrapProps,
} from "./SupportThreadCore";
// #1850 — the lift is budgeted against the DERIVED Done-bar cost, never a literal.
import { DONE_BAR_OCCUPIED } from "../../wrappers/SmartScrollView";

const NativeKeyboardWrap: React.FC<KeyboardWrapProps> = ({ children }) => (
  // ORCH-1165: lift the composer so the Done bar sits above it.
  // #1850 — this was a literal 42, which is KEYBOARD_TOOLBAR_HEIGHT (the bar's own
  // height), not what the bar OCCUPIES above the keyboard. #1834 measured 53 on
  // iOS 26+, because the library floats the bar 11pt clear of the keyboard's
  // rounded corners — so a 42pt lift left this composer 11pt behind it.
  <KeyboardAvoidingView
    behavior="padding"
    keyboardVerticalOffset={DONE_BAR_OCCUPIED}
  >
    {children}
  </KeyboardAvoidingView>
);

export const SupportThread: React.FC<{ ticketId: string }> = ({ ticketId }) => (
  <SupportThreadCore ticketId={ticketId} KeyboardWrap={NativeKeyboardWrap} />
);

export default SupportThread;
