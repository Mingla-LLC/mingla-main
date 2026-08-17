// Issue #2101 — the ONE edge-facing adapter for the database-owned named-buyer
// checkout decision.
//
// This module holds NO policy logic. It calls the sole database authority
// `issue_2101_ticket_checkout_access_decision` and maps its bounded vocabulary
// onto the bounded HTTP contract. There is deliberately no parallel decision
// path here: an Edge-only check would be bypassable by a direct RPC call, so
// the database re-decides inside `biz_ticket_checkout_create_session`,
// `issue_1930_ticket_session_authorized`, the claim/commit/preflight wrappers
// and `biz_ticket_checkout_finalize` as well.
//
// PRIVACY: the decision is derived exclusively from the token-derived caller
// UUID. No request-body field, buyer email, buyer name, buyer phone, cookie,
// public link, or tier visibility may ever reach this function.

// deno-lint-ignore no-explicit-any
type ServiceClient = any;

/** The exact vocabulary returned by the sole database decision owner. */
export type TicketCheckoutAccessDecision =
  | "allowed_unrestricted"
  | "allowed_named"
  | "sign_in_required"
  | "checkout_restricted"
  | "snapshot_stale"
  | "event_unavailable";

export interface TicketCheckoutAccessDenial {
  /** Bounded response body. It never reveals list membership. */
  error: "sign_in_required" | "checkout_restricted";
  status: 401 | 403;
}

/**
 * Fresh decision for an event + token-derived buyer. `buyerUserId` MUST be the
 * value produced by `userIdFromAuthHeader` — never a client-supplied UUID.
 */
export async function ticketCheckoutAccessDecision(
  client: ServiceClient,
  input: { eventId: string; buyerUserId: string | null },
): Promise<TicketCheckoutAccessDecision> {
  const { data, error } = await client.rpc(
    "issue_2101_ticket_checkout_access_decision",
    {
      p_event_id: input.eventId,
      p_buyer_user_id: input.buyerUserId,
      p_snapshot_mode: null,
      p_snapshot_restrictive_epoch: null,
      p_snapshot_membership_id: null,
      p_snapshot_membership_epoch: null,
    },
  );
  // Fail CLOSED. A transport/permission failure must never be read as
  // "unrestricted" — that would be the exact fail-open the fence exists to stop.
  if (error !== null && error !== undefined) {
    throw new Error("checkout_access_decision_unavailable");
  }
  if (typeof data !== "string") {
    throw new Error("checkout_access_decision_unavailable");
  }
  return data as TicketCheckoutAccessDecision;
}

/**
 * Map a decision onto the bounded denial contract, or `null` when checkout may
 * proceed. `sign_in_required` is the ONLY 401; every other access denial is a
 * single indistinguishable 403 so an attacker cannot probe membership.
 */
export function ticketCheckoutAccessDenial(
  decision: TicketCheckoutAccessDecision,
): TicketCheckoutAccessDenial | null {
  if (decision === "allowed_unrestricted" || decision === "allowed_named") {
    return null;
  }
  if (decision === "sign_in_required") {
    return { error: "sign_in_required", status: 401 };
  }
  return { error: "checkout_restricted", status: 403 };
}

/**
 * Map the database RAISE messages that `biz_ticket_checkout_create_session`
 * uses for defense-in-depth onto the same bounded contract. Returns `null` when
 * the message is not an access denial, so existing error handling is unchanged.
 */
export function ticketCheckoutAccessDenialFromDbMessage(
  message: string | null | undefined,
): TicketCheckoutAccessDenial | null {
  if (typeof message !== "string") return null;
  if (message.includes("checkout_sign_in_required")) {
    return { error: "sign_in_required", status: 401 };
  }
  if (message.includes("checkout_restricted")) {
    return { error: "checkout_restricted", status: 403 };
  }
  return null;
}
