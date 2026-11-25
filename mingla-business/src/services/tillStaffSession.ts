/**
 * #4490 spec 08 O5 part A — the PIN session of a shared Till device, IN MEMORY
 * ONLY (Constitution 5 and 14; spec 08 §3 O5).
 *
 * The token never goes to AsyncStorage, localStorage, a persisted store or the
 * query cache: it lives in this module's variables, so an app restart, a page
 * reload, a sign-out (registered cleanup below) or the auto-lock ends it. The
 * server ends it too (expiry, idle lock, device sign-out).
 *
 * A step-up (a fresh PIN at the moment of a refund or a sent void) is asked
 * through `requestStepUp`: the service waits while the open sheet shows the
 * PIN pad inline (never a second native sheet), then retries with the PIN.
 */

import { useSyncExternalStore } from "react";

import { registerSignOutCleanup } from "../utils/signOutCleanups";

export interface TillStaffSession {
  venueId: string;
  token: string;
  memberId: string;
  memberUserId: string;
  name: string;
  /** Whether the person switched in may approve money (refund, sent void). */
  canApprove: boolean;
  autoLockMinutes: number;
  /** Epoch ms of the last touch on the Till (the auto-lock clock). */
  lastActivityAt: number;
}

export interface StepUpAnswer {
  pin: string;
  /** Someone else approving on the spot (a manager); null = the seller. */
  memberId: string | null;
}

export interface StepUpRequest {
  id: number;
  venueId: string;
  /** #4490 O5 part B: reopening a day and exporting it ask for a PIN too. */
  purpose: "refund" | "void_sent" | "reopen" | "export";
  /** Shown after a wrong or refused PIN ("Wrong PIN. 2 tries left"). */
  error: string | null;
}

type State = {
  sessions: Record<string, TillStaffSession>;
  /** Why the last session ended, for the Who's selling banner. */
  ended: Record<string, "auto_lock" | "server" | null>;
  stepUp: StepUpRequest | null;
};

let state: State = { sessions: {}, ended: {}, stepUp: null };
let stepUpResolve: ((answer: StepUpAnswer | null) => void) | null = null;
let nextStepUpId = 1;
const listeners = new Set<() => void>();

function emit(next: State): void {
  state = next;
  for (const l of listeners) l();
}

export function subscribeTillStaff(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTillStaffSession(venueId: string): TillStaffSession | null {
  return state.sessions[venueId] ?? null;
}

export function setTillStaffSession(session: Omit<TillStaffSession, "lastActivityAt">, now = Date.now()): void {
  emit({
    ...state,
    sessions: { ...state.sessions, [session.venueId]: { ...session, lastActivityAt: now } },
    ended: { ...state.ended, [session.venueId]: null },
  });
}

/** Ends the in-memory session (the server is told separately by the caller). */
export function clearTillStaffSession(venueId: string, reason: "auto_lock" | "server" | null = null): void {
  if (!state.sessions[venueId] && state.ended[venueId] === reason) return;
  const sessions = { ...state.sessions };
  delete sessions[venueId];
  cancelStepUp();
  emit({ ...state, sessions, ended: { ...state.ended, [venueId]: reason } });
}

export function tillSessionEndedReason(venueId: string): "auto_lock" | "server" | null {
  return state.ended[venueId] ?? null;
}

/** A touch on the Till restarts the auto-lock clock (no re-render). */
export function noteTillActivity(venueId: string, now = Date.now()): void {
  const s = state.sessions[venueId];
  if (s) s.lastActivityAt = now;
}

/** Pure: is this session past its auto-lock minutes? */
export function tillSessionIdle(session: TillStaffSession, now: number): boolean {
  return now - session.lastActivityAt >= session.autoLockMinutes * 60_000;
}

export function clearAllTillStaffSessions(): void {
  cancelStepUp();
  emit({ sessions: {}, ended: {}, stepUp: null });
}

// Constitution 6: signing out clears every PIN session on this device.
registerSignOutCleanup(clearAllTillStaffSessions);

export function useTillStaffSession(venueId: string): TillStaffSession | null {
  return useSyncExternalStore(
    subscribeTillStaff,
    () => state.sessions[venueId] ?? null,
    () => null,
  );
}

export function useTillStepUp(venueId: string): StepUpRequest | null {
  return useSyncExternalStore(
    subscribeTillStaff,
    () => (state.stepUp !== null && state.stepUp.venueId === venueId ? state.stepUp : null),
    () => null,
  );
}

/** Asks the open sheet for a PIN; null when the person cancels. */
export function requestStepUp(
  venueId: string,
  purpose: StepUpRequest["purpose"],
  error: string | null = null,
): Promise<StepUpAnswer | null> {
  cancelStepUp();
  return new Promise((resolve) => {
    stepUpResolve = resolve;
    emit({ ...state, stepUp: { id: nextStepUpId++, venueId, purpose, error } });
  });
}

export function answerStepUp(answer: StepUpAnswer | null): void {
  const resolve = stepUpResolve;
  stepUpResolve = null;
  emit({ ...state, stepUp: null });
  resolve?.(answer);
}

function cancelStepUp(): void {
  if (stepUpResolve !== null) {
    const resolve = stepUpResolve;
    stepUpResolve = null;
    state = { ...state, stepUp: null };
    resolve(null);
  }
}
