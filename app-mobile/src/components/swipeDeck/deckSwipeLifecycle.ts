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

export interface DeckSwipeCompletionGuard {
  finished: boolean;
  mounted: boolean;
  phase: DeckSwipePhase;
  expectedEpoch: number;
  currentEpoch: number;
  expectedCardId: string;
  currentCardId: string | null;
}

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

export function deckCommitTokenKey(token: DeckSwipeCommitToken): string {
  return `${token.epoch}:${token.cardId}:${token.direction}`;
}
