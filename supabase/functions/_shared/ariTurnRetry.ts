/**
 * Issue #3355 P1 (D-1, D-2) — which turn failures a Retry can never fix.
 *
 * Retrying re-runs the stored, immutable turn payload. For these codes the
 * same payload is refused the same way every time (a stale choice, a plan
 * that moved on, a cap, a typed refusal), so a Retry button only replays the
 * refusal. The server refuses such retries (agent-turn-control) and the Host
 * shows the response's own next action instead of Retry.
 *
 * The Host mirrors this list in
 * `mingla-business/src/hooks/ariTurnRetryPolicy.ts`; a parity test keeps
 * them equal.
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

export function isDeterministicTurnRefusal(code: unknown): boolean {
  return typeof code === "string" && DETERMINISTIC.has(code.toUpperCase());
}
