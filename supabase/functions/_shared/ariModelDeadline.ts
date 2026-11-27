// Issue #4637 — one model-call deadline policy for every Ari answer call.

export const ARI_MODEL_CALL_MAX_MS = 25_000;
export const ARI_MODEL_COMMIT_RESERVE_MS = 6_000;
export const ARI_MODEL_RETRY_MIN_REMAINING_MS = 8_000;

export interface AriModelCallBudget {
  timeoutMs: number;
  turnRemainingMs: number;
  canRetry: boolean;
}

export function ariModelCallBudget(args: {
  turnStartedAtMs: number;
  turnDeadlineMs: number;
  nowMs?: number;
}): AriModelCallBudget {
  const nowMs = args.nowMs ?? Date.now();
  const elapsedMs = Math.max(0, nowMs - args.turnStartedAtMs);
  const turnRemainingMs = Math.max(0, args.turnDeadlineMs - elapsedMs);
  const availableForCall = Math.max(
    0,
    turnRemainingMs - ARI_MODEL_COMMIT_RESERVE_MS,
  );
  return {
    timeoutMs: Math.min(ARI_MODEL_CALL_MAX_MS, availableForCall),
    turnRemainingMs,
    canRetry: turnRemainingMs >= ARI_MODEL_RETRY_MIN_REMAINING_MS,
  };
}

export function ariModelCallSignal(
  budget: Pick<AriModelCallBudget, "timeoutMs">,
): AbortSignal {
  return budget.timeoutMs > 0
    ? AbortSignal.timeout(budget.timeoutMs)
    : AbortSignal.abort(new DOMException("Ari model deadline", "TimeoutError"));
}
