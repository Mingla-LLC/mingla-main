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

const NativeKeyboardWrap: React.FC<KeyboardWrapProps> = ({ children }) => (
  // ORCH-1165: lift the composer 42pt so the Done bar sits above it.
  <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={42}>
    {children}
  </KeyboardAvoidingView>
);

export const SupportThread: React.FC<{ ticketId: string }> = ({ ticketId }) => (
  <SupportThreadCore ticketId={ticketId} KeyboardWrap={NativeKeyboardWrap} />
);

export default SupportThread;
