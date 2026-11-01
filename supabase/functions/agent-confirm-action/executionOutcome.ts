/**
 * agent-confirm-action — how an executor failure is answered.
 *
 * Kept out of index.ts so tests can execute the decisions without starting
 * the server (#2113: a check that only reads source text carries no
 * information).
 */

import { ToolError } from "../_shared/agentToolHelpers.ts";

/**
 * Did this executor failure possibly commit? Only a receipt-backed write whose
 * failure is transport-shaped (or untyped) is ambiguous: it stays `executing`
 * so a retry replays the operation receipt. A typed refusal — including
 * #3355's DOMAIN_REFUSED, re-typed from the RPC's raise code — is terminal.
 */
export function isAmbiguousExecutionFailure(
  receiptBacked: boolean,
  err: unknown,
): boolean {
  return receiptBacked &&
    (!(err instanceof ToolError) ||
      ["RPC_FAILED", "EDGE_FAILED", "WRITE_FAILED"].includes(err.code));
}

/**
 * The HTTP status for a `ToolError` raised by a tool executor.
 *
 * 4xx = recoverable validation errors that the user can resolve by adjusting
 * their request (rename the brand, pick a different event, choose a different
 * visibility). 5xx is reserved for genuine server-side issues.
 *
 * Hoisted out of the catch block so it is CALLABLE by a test. Per #2113 a check
 * that can only read source text carries no information; the status mapping is
 * proven by executing this function, in
 * `supabase/functions/agent-confirm-action/__tests__/issue_2009_private_visibility_status.test.ts`.
 * The mapping itself is unchanged apart from the one branch named below.
 */
export function toolErrorHttpStatus(code: string): number {
  if (
    ["OWNERSHIP_DENIED", "ROLE_DENIED", "BRAND_ACCESS_DENIED"].includes(code)
  ) return 403;
  if (["ROLE_CHECK_UNAVAILABLE", "PAYOUT_CHECK_FAILED"].includes(code)) {
    return 503;
  }
  if (code === "INVALID_ARGS" || code === "SLUG_TAKEN") return 400;
  if (
    [
      "PAYOUT_NOT_READY",
      "TAX_REGISTRATION_REQUIRED",
      "EVENT_CURRENCY_REQUIRED",
    ].includes(code)
  ) return 409;
  // ORCH-1103 — delete refused because the brand has upcoming/live events.
  // Recoverable, user-actionable conflict (cancel/transfer first) → 409.
  if (code === "DELETE_BLOCKED_BY_EVENTS") return 409;
  // #1981 — paid cancel refused; organiser clears it by calling refund_order
  // instead (same Host money-screen routing). Conflict / adjust-request → 409,
  // never 500 (safe_to_retry).
  if (code === "PAID_ORDER_MUST_REFUND") return 409;
  if (code === "REFUND_PREVIEW_UNPRICED") return 409;
  if (code === "DOMAIN_ACTION_REFUSED") return 409;
  // issue #3645 — a paid publish by a member who has not accepted the Organiser
  // Terms. Refused before any write; the member clears it by accepting in the
  // app. A conflict the user resolves elsewhere, never a 500 (safe_to_retry).
  if (code === "ORGANISER_TERMS_REQUIRED") return 409;
  // issue #3355 P1 (D-9) — a deterministic publish/money refusal from the
  // database (ariRefusalCopy.ts). Nothing was saved; the owner clears it by
  // fixing the named thing, so it is a conflict, never a 500 or a 202.
  if (code === "DOMAIN_REFUSED") return 409;
  // issue #2592 — an optimistic-concurrency conflict. The resource moved under
  // the caller, so the request is CORRECTLY refused and the caller resolves it
  // by re-reading the current version. That is the same 409 the Edge-owned
  // version-conflict siblings already return (`manage-stay-inventory`,
  // `stay-reservations`, `manage-brand-discovery-currency` all map their stable
  // conflict literal to 409). Before this branch a stale version fell through
  // to 500 — a server fault, and the one status the Ari envelope contract
  // classifies `safe_to_retry: true`, which is precisely what a deterministic
  // caller mistake must never be told.
  if (code === "VERSION_CONFLICT") return 409;
  // issue #2009 (BINDING SPEC AMENDMENT 3B, Defect 4) — `business_set_event_visibility`
  // refuses every transition entering or leaving Private while #1931's private-access
  // release stays frozen. This is a KNOWN, EXPECTED, CORRECTLY-REFUSED request, not a
  // server fault, and it previously fell through to 500.
  //
  // 400 rather than 403/409, to match this map's own semantics: the organiser resolves
  // it by adjusting the requested value — the shipped copy is literally "Choose Public
  // or Unlisted for now" — which is exactly the SLUG_TAKEN shape (a value the server
  // will not accept in its current state). 403 is reserved here for access denial, and
  // 409 for a conflict the user clears by acting on OTHER resources first
  // (cancel/transfer the brand's events), neither of which describes this.
  //
  // CASE-INSENSITIVE ON PURPOSE, and this is the whole reason the branch works.
  // Amendment 3B names the RPC's stable code `private_visibility_unavailable`, but the
  // code that actually ARRIVES here is the UPPERCASED one: agentTools.ts's
  // `issue2009VisibilityToolError` builds `new ToolError(code.toUpperCase(), copy)`.
  // A branch matching only the lowercase literal would read correctly, pass a
  // source-text check, and never once fire — the exact unfalsifiable-check bug class
  // #2113 exists to stop. One condition, one branch, either spelling.
  if (code.toUpperCase() === "PRIVATE_VISIBILITY_UNAVAILABLE") return 400;
  return 500;
}
