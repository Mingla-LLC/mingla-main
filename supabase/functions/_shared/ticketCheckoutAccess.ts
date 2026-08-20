type RpcResult = {
  data: unknown;
  error: { message?: string } | null;
};

export type TicketCheckoutAccessClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
};

export type TicketCheckoutAccessDecision =
  | "allowed_unrestricted"
  | "allowed_named"
  | "sign_in_required"
  | "checkout_restricted"
  | "snapshot_stale"
  | "event_unavailable";

export type TicketCheckoutAccessGate =
  | { allowed: true; decision: "allowed_unrestricted" | "allowed_named" }
  | { allowed: false; status: 401 | 403 | 404; error: string };

const DECISIONS = new Set<TicketCheckoutAccessDecision>([
  "allowed_unrestricted",
  "allowed_named",
  "sign_in_required",
  "checkout_restricted",
  "snapshot_stale",
  "event_unavailable",
]);

export const classifyTicketCheckoutAccessDecision = (
  value: unknown,
): TicketCheckoutAccessGate => {
  if (typeof value !== "string" || !DECISIONS.has(value as TicketCheckoutAccessDecision)) {
    throw new Error("ticket_checkout_access_decision_invalid");
  }
  const decision = value as TicketCheckoutAccessDecision;
  if (decision === "allowed_unrestricted" || decision === "allowed_named") {
    return { allowed: true, decision };
  }
  if (decision === "sign_in_required") {
    return { allowed: false, status: 401, error: "sign_in_required" };
  }
  if (decision === "event_unavailable") {
    return { allowed: false, status: 404, error: "event_unavailable" };
  }
  return { allowed: false, status: 403, error: "checkout_restricted" };
};

export async function authorizeFreshTicketCheckout(
  client: TicketCheckoutAccessClient,
  eventId: string,
  tokenDerivedUserId: string | null,
): Promise<TicketCheckoutAccessGate> {
  const { data, error } = await client.rpc(
    "issue_2101_ticket_checkout_access_decision",
    {
      p_event_id: eventId,
      p_buyer_user_id: tokenDerivedUserId,
      p_snapshot_mode: null,
      p_snapshot_restrictive_epoch: null,
      p_snapshot_membership_id: null,
      p_snapshot_membership_epoch: null,
    },
  );
  if (error !== null) {
    throw new Error(error.message ?? "ticket_checkout_access_decision_failed");
  }
  return classifyTicketCheckoutAccessDecision(data);
}
