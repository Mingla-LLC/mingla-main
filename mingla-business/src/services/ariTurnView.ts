/**
 * Issue #3429 REWORK-1 — pure, unmocked view rules for Ari turns.
 *
 * `useAgentChat.ts` may only import the committed seams from the Ari service
 * modules (their Jest mocks stub exactly those names), so the rules that decide
 * what a turn shows live here as plain functions.
 *
 * D-1 (I-3429-ARI-ACTIVITY-ENDS-WITH-ITS-WORK): an activity label is visible only
 * while its backing work is in flight. `response_ready` or a completed attempt
 * ends an ordinary turn; `finalizing_started` alone never creates confirmation
 * state.
 * D-2 (I-3429-ARI-LOCAL-TURNS-SCOPED-TO-CONVERSATION): a local turn renders only
 * inside the conversation that owns it; a null-owned turn only in New
 * conversation.
 */

import type {
  AriActivityEvent,
  AriActivityEventType,
  AriAttemptStatus,
} from "./ariTurnService";

export type AriLocalDelivery = "sending" | "sent" | "failed" | "stopped";

/** Events that never carry an activity label of their own. */
export const ARI_UNLABELLED_ACTIVITY_EVENTS: readonly AriActivityEventType[] = Object.freeze([
  "accepted",
  "response_ready",
  "reconciliation_started",
  "reconciliation_finished",
  "stopped",
  "failed",
]);

export interface AriActivityWatermark {
  attemptNumber: number;
  sequence: number;
}

function isAfter(event: AriActivityEvent, watermark: AriActivityWatermark | null): boolean {
  if (!watermark) return true;
  return event.attempt_number > watermark.attemptNumber ||
    (event.attempt_number === watermark.attemptNumber && event.sequence > watermark.sequence);
}

/** The newest labelled event of the current attempt (after an optional watermark). */
export function latestLabelledActivityEvent(
  events: readonly AriActivityEvent[],
  attemptNumber: number,
  after: AriActivityWatermark | null = null,
): AriActivityEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.attempt_number !== attemptNumber || !isAfter(event, after)) continue;
    if (ARI_UNLABELLED_ACTIVITY_EVENTS.includes(event.event_type)) continue;
    return event;
  }
  return null;
}

export function hasCurrentAttemptEvent(
  events: readonly AriActivityEvent[],
  attemptNumber: number,
  eventType: AriActivityEventType,
): boolean {
  return events.some((event) => event.attempt_number === attemptNumber && event.event_type === eventType);
}

/** P2-1: the user row reads Sent as soon as the turn is accepted. */
export function ariRowDelivery(delivery: AriLocalDelivery, accepted: boolean): AriLocalDelivery {
  return delivery === "sending" && accepted ? "sent" : delivery;
}

export interface AriTurnActivityInput {
  delivery: AriLocalDelivery;
  accepted: boolean;
  attemptStatus: AriAttemptStatus | null;
  attemptNumber: number;
  events: readonly AriActivityEvent[];
}

/**
 * Whether an ordinary (non-confirmation) turn still owns the activity callout:
 * its dispatch is in flight and not yet answered, or it ended stopped/failed
 * and needs its recovery callout.
 */
export function isOrdinaryTurnActivityVisible(turn: AriTurnActivityInput): boolean {
  if (turn.delivery === "stopped") return true;
  if (turn.accepted && turn.attemptStatus === "failed") return true;
  if (turn.delivery !== "sending") return false;
  if (turn.attemptStatus === "completed") return false;
  return !hasCurrentAttemptEvent(turn.events, turn.attemptNumber, "response_ready");
}

/**
 * #3355 — the one turn that owns the activity callout. A turn still in
 * flight always may; a failed or stopped turn's callout ("Ari couldn't finish
 * this response") belongs ONLY to the newest turn, so a later turn — answered
 * or still going — clears an older failure's banner instead of leaving it on
 * screen. Turns are given oldest first.
 */
export function activityTurnOf<T extends AriTurnActivityInput>(
  turns: readonly T[],
): T | null {
  const newest = turns[turns.length - 1];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (!isOrdinaryTurnActivityVisible(turn)) continue;
    const ended = turn.delivery === "stopped" ||
      (turn.accepted && turn.attemptStatus === "failed");
    return ended && turn !== newest ? null : turn;
  }
  return null;
}

/**
 * #3355 — Discard is offered on a failed turn, including one the server
 * accepted and then could not answer. Discarding removes the row and, with
 * it, its "couldn't finish" banner; an answered or running turn is never
 * discarded.
 */
export function isAriTurnDiscardable(
  turn: Pick<AriTurnActivityInput, "delivery" | "accepted" | "attemptStatus">,
): boolean {
  if (turn.delivery === "failed") return true;
  return turn.accepted && turn.attemptStatus === "failed";
}

/** Stop is only ever offered for an attempt that can still be stopped. */
export function isAriTurnStoppable(turn: Pick<AriTurnActivityInput, "delivery" | "attemptStatus">): boolean {
  return turn.delivery === "sending" &&
    !["completed", "failed", "stopped"].includes(turn.attemptStatus ?? "");
}

/** D-2: local turns render only inside the conversation that owns them. */
export function isTurnInSelectedConversation(
  turnConversationId: string | null,
  selectedConversationId: string | null,
): boolean {
  return turnConversationId === selectedConversationId;
}

/**
 * D-2 / SC-R1-D2-3: a completed or reconciled turn moves the selection to its
 * canonical conversation only while the person is still looking at the
 * conversation the turn was sent from.
 */
export function shouldFollowTurnConversation(
  selectedConversationId: string | null,
  turnOriginConversationId: string | null,
): boolean {
  return selectedConversationId === turnOriginConversationId;
}
