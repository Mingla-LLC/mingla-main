// Issue #1930 — the only edge-facing adapter for database-owned checkout
// admission. It intentionally returns bounded states and never logs or stores a
// continuation/client secret.

// deno-lint-ignore no-explicit-any
type ServiceClient = any;

export type TicketProvider = "stripe" | "paystack";
export type TicketProviderFlow =
  | "stripe_native"
  | "stripe_checkout"
  | "paystack_redirect";

export interface TicketAttemptClaim {
  outcome:
    | "fresh_claim"
    | "existing_ready"
    | "provider_unknown"
    | "in_progress"
    | "flow_conflict"
    | "revoked";
  attemptId?: string;
  epoch?: number;
  idempotencyKey?: string;
  providerObjectId?: string | null;
  providerCheckoutId?: string | null;
  providerReference?: string | null;
}

export async function claimTicketProviderAttempt(
  client: ServiceClient,
  input: {
    checkoutSessionId: string;
    eventId: string;
    provider: TicketProvider;
    flow: TicketProviderFlow;
    requestFingerprint: string;
  },
): Promise<TicketAttemptClaim> {
  const { data, error } = await client.rpc(
    "issue_1930_claim_ticket_provider_attempt",
    {
      p_checkout_session_id: input.checkoutSessionId,
      p_event_id: input.eventId,
      p_provider: input.provider,
      p_flow: input.flow,
      p_request_fingerprint: input.requestFingerprint,
    },
  );
  if (error || !data) throw new Error("checkout_admission_unavailable");
  return data as TicketAttemptClaim;
}

export async function commitTicketProviderAttempt(
  client: ServiceClient,
  input: {
    attemptId: string;
    claimedEpoch: number;
    providerObjectId?: string | null;
    providerCheckoutId?: string | null;
    providerReference?: string | null;
    continuationFingerprint: string;
  },
): Promise<"ready" | "revoked"> {
  const { data, error } = await client.rpc(
    "issue_1930_commit_ticket_provider_attempt",
    {
      p_attempt_id: input.attemptId,
      p_claimed_epoch: input.claimedEpoch,
      p_provider_object_id: input.providerObjectId ?? null,
      p_provider_checkout_id: input.providerCheckoutId ?? null,
      p_provider_reference: input.providerReference ?? null,
      p_continuation_fingerprint: input.continuationFingerprint,
    },
  );
  if (error || !data) throw new Error("checkout_admission_commit_failed");
  return data.outcome === "ready" ? "ready" : "revoked";
}

export async function markTicketProviderUnknown(
  client: ServiceClient,
  input: { attemptId: string; claimedEpoch: number },
): Promise<void> {
  const { error } = await client.rpc(
    "issue_1930_mark_ticket_provider_unknown",
    {
      p_attempt_id: input.attemptId,
      p_claimed_epoch: input.claimedEpoch,
    },
  );
  if (error) throw new Error("checkout_provider_unknown_commit_failed");
}

export async function ticketCheckoutPreflight(
  client: ServiceClient,
  input: { checkoutSessionId: string; buyerStatusTokenHash: string },
): Promise<"present_allowed" | "in_progress" | "unavailable" | "forbidden"> {
  const { data, error } = await client.rpc(
    "issue_1930_ticket_checkout_preflight",
    {
      p_checkout_session_id: input.checkoutSessionId,
      p_buyer_status_token_hash: input.buyerStatusTokenHash,
    },
  );
  if (error) return "unavailable";
  return data === "present_allowed" || data === "in_progress" ||
      data === "forbidden"
    ? data
    : "unavailable";
}

export function checkoutUnavailableResponse(): Record<string, string> {
  return {
    error: "checkout_unavailable",
    message: "This sale is no longer available.",
  };
}
