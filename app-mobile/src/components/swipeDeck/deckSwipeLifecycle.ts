export const DECK_SWIPE_PHASES = [
  'IDLE',
  'DRAGGING',
  'SNAPPING',
  'EXITING',
  'COMMITTING',
] as const;

export type DeckSwipePhase = (typeof DECK_SWIPE_PHASES)[number];
export type DeckSwipeDirection = 'left' | 'right';
export type DeckGestureSequenceDisposition = 'admitted' | 'rejected' | null;

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

export interface DeckTerminalRecoveryGuard {
  mounted: boolean;
  phase: DeckSwipePhase;
  currentCardId: string | null;
  disposition: DeckGestureSequenceDisposition;
  endedFromActive: boolean;
}

/**
 * Android may deliver a native ACTIVE -> END sequence while its intermediate
 * BEGAN state-change notification is coalesced before JS observes it. Recover
 * only that unobserved sequence; an explicitly rejected BEGAN stays rejected.
 */
export function canRecoverUnobservedDeckEnd(
  guard: DeckTerminalRecoveryGuard,
): boolean {
  return (
    guard.mounted &&
    guard.phase === 'IDLE' &&
    guard.currentCardId !== null &&
    guard.disposition === null &&
    guard.endedFromActive
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
