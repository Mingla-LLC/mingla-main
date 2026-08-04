export const DECK_SWIPE_PHASES = [
  'IDLE',
  'DRAGGING',
  'SNAPPING',
  'EXITING',
  'COMMITTING',
] as const;

export type DeckSwipePhase = (typeof DECK_SWIPE_PHASES)[number];
export type DeckSwipeDirection = 'left' | 'right';

export interface DeckSwipeCommitToken {
  cardId: string;
  direction: DeckSwipeDirection;
  epoch: number;
}

export type DeckCommitSettlement =
  | { nextCardId: string }
  | { exhausted: true };

export interface DeckSwipeCompletionGuard {
  finished: boolean;
  mounted: boolean;
  phase: DeckSwipePhase;
  expectedEpoch: number;
  currentEpoch: number;
  expectedCardId: string;
  currentCardId: string | null;
}

export type DeckExitFastForwardGuard = Omit<DeckSwipeCompletionGuard, 'finished'>;

export function canAdmitDeckInput(phase: DeckSwipePhase): boolean {
  return phase === 'IDLE';
}

/**
 * #1579 — A TAP is a press whose own pan never activated. Gesture.Pan().onBegin claims
 * the DRAGGING lease at touch-DOWN, ~106-117ms before TouchableOpacity.onPress runs at
 * touch-UP, so gating expand on canAdmitDeckInput (IDLE-only) is unsatisfiable by
 * construction — 100% of taps rejected, deterministically. This is NOT a widening of
 * admission: SNAPPING/EXITING/COMMITTING stay rejected, and the only lease being
 * tolerated is the one held by this very touch. See
 * I-PROPOSED-1579-GESTURE-LEASE-RELEASE-COMPLETENESS.
 */
export function canAdmitDeckTapExpand(phase: DeckSwipePhase, panActivated: boolean): boolean {
  return phase === 'IDLE' || (phase === 'DRAGGING' && !panActivated);
}

/**
 * #1579 — MEASURED (RNGH 2.28.0 / RN 0.81.5 / iOS 26.5): RNGH delivers NO onStart, onEnd
 * or onFinalize for a pan that never activates, so nothing returns the phase to IDLE
 * after a tap and the next swipe rides a stale epoch. onTouchesUp/onTouchesCancelled DO
 * fire, and are the release signal.
 * The `!panActivated` term is LOAD-BEARING, not defensive: on a real swipe onTouchesUp
 * arrives BEFORE onFinalize (same millisecond), so releasing unconditionally would leave
 * finalizeGesture to early-return on phase !== 'DRAGGING' and would kill EVERY swipe.
 */
export function shouldReleaseUnactivatedPress(phase: DeckSwipePhase, panActivated: boolean): boolean {
  return phase === 'DRAGGING' && !panActivated;
}

export function canHandleDeckPanFrame(phase: DeckSwipePhase): boolean {
  return phase === 'DRAGGING';
}

export function isCurrentDeckCompletion(guard: DeckSwipeCompletionGuard): boolean {
  return (
    guard.finished &&
    guard.mounted &&
    guard.phase === 'EXITING' &&
    guard.expectedEpoch === guard.currentEpoch &&
    guard.expectedCardId === guard.currentCardId
  );
}

/**
 * A new native BEGAN may finish the already-validated outgoing card before
 * admitting the successor. It must never bless a stale epoch or another card.
 */
export function canFastForwardDeckExit(guard: DeckExitFastForwardGuard): boolean {
  return (
    guard.mounted &&
    guard.phase === 'EXITING' &&
    guard.expectedEpoch === guard.currentEpoch &&
    guard.expectedCardId === guard.currentCardId
  );
}

export function deckCommitTokenKey(token: DeckSwipeCommitToken): string {
  return `${token.epoch}:${token.cardId}:${token.direction}`;
}

/** Every admitted pan/swipe receives a fresh identity, even for the same card. */
export function nextDeckGestureEpoch(currentEpoch: number): number {
  return currentEpoch + 1;
}

export interface DeckTokenIntentResult {
  shouldRun: boolean;
  pending: null;
}

/** Consume a deferred action only for the exact card/direction/generation. */
export function consumeDeckTokenIntent(
  pending: DeckSwipeCommitToken | null,
  completed: DeckSwipeCommitToken,
): DeckTokenIntentResult {
  return {
    shouldRun:
      pending !== null &&
      pending.epoch === completed.epoch &&
      pending.cardId === completed.cardId &&
      pending.direction === completed.direction,
    pending: null,
  };
}
