/**
 * SupportThread (web / default) — META-ORCH-1104 Phase 1.
 *
 * Web variant: the composer's keyboard wrapper is a passthrough Fragment.
 * The native keyboard library has NO web entry point (ORCH-0892-A §7.3), and
 * browsers handle soft-keyboard avoidance via viewport behavior — no library is
 * needed. Metro picks THIS file on web (and any non-native default); native
 * picks SupportThread.native.tsx.
 *
 * Mirrors the KeyboardRoot.tsx / SmartScrollView.tsx quarantine precedent. This
 * file deliberately pulls in NO native keyboard primitive (I-1104-NO-KBC-ON-WEB,
 * §2.10) so the web bundle stays clean — the keyboard module lives only in the
 * .native sibling.
 */

import React from "react";

import {
  SupportThreadCore,
  type KeyboardWrapProps,
} from "./SupportThreadCore";

const WebKeyboardWrap: React.FC<KeyboardWrapProps> = ({ children }) => (
  <>{children}</>
);

export const SupportThread: React.FC<{ ticketId: string }> = ({ ticketId }) => (
  <SupportThreadCore ticketId={ticketId} KeyboardWrap={WebKeyboardWrap} />
);

export default SupportThread;
