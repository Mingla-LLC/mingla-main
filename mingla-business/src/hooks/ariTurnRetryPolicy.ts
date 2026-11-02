/**
 * Issue #3355 P1 (D-1, D-2) — when a failed Ari turn may offer Retry.
 *
 * A Retry used to re-send the identical payload with the identical turn id.
 * For a deterministic refusal (today's cap, a stale choice, a plan that moved
 * on, a typed money/publish refusal) the server answers the same way every
 * time, so Retry only replayed the refusal — the "resets in 24 hours" loop.
 *
 * Mirrors `supabase/functions/_shared/ariTurnRetry.ts` (parity test:
 * `_shared/__tests__/issue_3355_turn_hygiene.implementor.test.ts`).
 *
 * Pure on purpose: no React Native, so every branch is unit-testable.
 */

export const ARI_DETERMINISTIC_TURN_CODES: readonly string[] = Object.freeze([
  "RATE_LIMITED",
  "QUESTION_STALE",
  "CHOICE_STALE",
  "STALE_REVISION",
  "STALE_PROPOSAL",
  "TASK_STATE_CONFLICT",
  "PROPOSAL_EXPIRED",
  "DOMAIN_REFUSED",
  "DOMAIN_ACTION_REFUSED",
  "IDEMPOTENCY_CONFLICT",
]);

const DETERMINISTIC = new Set(ARI_DETERMINISTIC_TURN_CODES);

export function isDeterministicTurnRefusal(
  code: string | null | undefined,
): boolean {
  return typeof code === "string" && DETERMINISTIC.has(code.toUpperCase());
}

/**
 * May this failed turn show Retry right now? Transport and server faults may;
 * a deterministic refusal may not — except today's cap, once its reset time
 * (from the server's database clock) has passed.
 */
export function ariTurnRetryAllowed(
  code: string | null | undefined,
  retryAt: number | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!isDeterministicTurnRefusal(code)) return true;
  return (
    typeof code === "string" &&
    code.toUpperCase() === "RATE_LIMITED" &&
    typeof retryAt === "number" &&
    now >= retryAt
  );
}

/**
 * A retry of a turn the server refused deterministically before accepting it
 * (today's cap, once it has reset) is a fresh attempt under a new turn id,
 * never a replay of the stored refusal. Transient failures — transport, a
 * tenant-scope or server hiccup — keep their id, because the first send may
 * have landed and the same id makes the resend idempotent.
 */
export function ariRetryNeedsFreshTurn(turn: {
  accepted: boolean;
  errorCode: string | null;
}): boolean {
  return !turn.accepted && isDeterministicTurnRefusal(turn.errorCode);
}

/** "4:12 PM" for today, "Tue 4:12 PM" otherwise, in the device's locale. */
export function formatAriResetTime(
  retryAt: number,
  now: number = Date.now(),
): string {
  const at = new Date(retryAt);
  const sameDay = new Date(now).toDateString() === at.toDateString();
  return new Intl.DateTimeFormat(undefined, {
    ...(sameDay ? {} : { weekday: "short" as const }),
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

/** The cap message with the real reset time (never "in 24 hours"). */
export function ariRateLimitCopy(
  retryAfterSeconds: number | null | undefined,
  now: number = Date.now(),
): string {
  if (
    typeof retryAfterSeconds !== "number" ||
    !Number.isFinite(retryAfterSeconds)
  ) {
    return "You've reached today's Ari message limit. Try again later.";
  }
  if (retryAfterSeconds <= 60) {
    return "Ari is finishing another change. Try again in a moment.";
  }
  return `You've reached today's Ari message limit. You can send again at ${formatAriResetTime(
    now + retryAfterSeconds * 1000,
    now,
  )}.`;
}
