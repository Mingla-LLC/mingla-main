/**
 * edgeFunctionErrors — the ONE place the shape of a permission denial is defined.
 *
 * #1863 [error-toast-covers-bank-field] §4.5.1. Leaf module: ZERO imports, no
 * React, no Supabase, no side effects — so `src/config/queryClient.ts` can
 * import it at boot without creating a cycle through the service layer.
 *
 * WHY THIS EXISTS. `brand-stripe-refresh-status` and `brand-stripe-balances`
 * both return `403 {error:"forbidden", detail:"permission_denied"}` from
 * `requirePaymentsManager` when the caller's role cannot manage payments. The
 * client used to flatten that into a plain `Error("forbidden: permission_denied")`
 * with no status, so:
 *   - React Query retried it forever (retry:2 × refetchInterval:30_000 →
 *     ~2,650 futile edge invocations in eight idle hours on ONE device), and
 *   - the UI classified it as `failed-network` and told the user to check their
 *     connection, which could never help: their ROLE is the problem.
 *
 * A permission denial is TERMINAL. It is never retried, never classified as a
 * transport failure, and never surfaced with copy that advises checking a
 * connection. See `I-PROPOSED-1863-CLIENT-PAYMENTS-PERMISSION-PARITY` clause B
 * in `docs/INVARIANT_REGISTRY.md`.
 */

/**
 * Thrown by the Stripe service layer when an edge function refuses the caller
 * at its own permission gate (`supabase/functions/_shared/stripeEdgeAuth.ts`
 * `requirePaymentsManager`).
 */
export class EdgeFunctionPermissionDeniedError extends Error {
  readonly code = "permission_denied";
  readonly status = 403;
  readonly functionName: string;
  readonly detail: string | null;

  constructor(functionName: string, detail?: string | null) {
    super(
      `${functionName}: permission denied${
        detail != null && detail.length > 0 ? ` (${detail})` : ""
      }`,
    );
    this.name = "EdgeFunctionPermissionDeniedError";
    this.functionName = functionName;
    this.detail = detail ?? null;
  }
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * True for — and ONLY for — a terminal permission denial.
 *
 * 1. an `EdgeFunctionPermissionDeniedError`; OR
 * 2. an object whose `status` or `context.status` is the number 403 — this
 *    clause exists because a raw Supabase `FunctionsHttpError` carries the
 *    status on `context` and nothing else; OR
 * 3. an object whose `code` is `"42501"` — PostgreSQL `insufficient_privilege`
 *    as PostgREST surfaces it. A predicate named "is this a permission denial"
 *    that answered "no" to the database's own permission denial would be a lie
 *    the next hook trips over.
 *
 * Everything else is `false`: a 5xx, a timeout, a malformed payload and a
 * genuine network failure are all still retried exactly as before. That inverse
 * is not optional — swallowing real transport errors would replace one lie with
 * another (SC-8).
 */
export function isPermissionDeniedError(error: unknown): boolean {
  if (error instanceof EdgeFunctionPermissionDeniedError) return true;
  if (!isRecordLike(error)) return false;
  if (error.status === 403) return true;
  const context = error.context;
  if (isRecordLike(context) && context.status === 403) return true;
  if (error.code === "42501") return true;
  return false;
}
