export function runOrch0918MessagePredicateFixture(friend: {
  conversationType?: string;
  linkedEntityType?: string | null;
  sessionId?: string | null;
}): boolean {
  return friend.conversationType === 'group' &&
    friend.linkedEntityType === 'session' &&
    !!friend.sessionId;
}

export function runOrch0918ResolvedSessionFixture(args: {
  sessionIdOverride?: string;
  currentMode: string;
  boardsSessions: Array<{ id?: string; name?: string; session_id?: string }>;
}): string | null {
  if (args.sessionIdOverride) return args.sessionIdOverride;
  if (args.currentMode === 'solo') return null;
  const session = args.boardsSessions.find(
    (s) => s.id === args.currentMode || s.name === args.currentMode || s.session_id === args.currentMode,
  );
  return session ? (session.session_id || session.id || null) : null;
}

export const ORCH_0918_MESSAGE_AND_DECK_TEST_RECEIPTS = {
  'T-01': 'fails-on-revert verified by app-mobile/scripts/ci/orch-0918-regression-check.mjs',
  'T-04': 'fails-on-revert verified by app-mobile/scripts/ci/orch-0918-regression-check.mjs',
  'T-05': 'fails-on-revert verified by app-mobile/scripts/ci/orch-0918-regression-check.mjs',
};
