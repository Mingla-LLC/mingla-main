/**
 * issue #4522 E-3 — one cart, one payable checkout.
 *
 * A buyer who comes back from the provider page (Back, a refresh) and changes
 * the cart (plan choice, quantity, add-on choice) presses Pay again. The
 * replacement checkout is opened only after the one they were handed is
 * closed:
 *
 * - card provider (Stripe Checkout): the page is expired at the provider
 *   first, with the revocation worker's own idempotency key. If it cannot be
 *   expired because it was already paid, the answer is `paid` (the buyer goes
 *   to that checkout's confirmation) and nothing new is opened. Any other
 *   failure is `unavailable` and nothing new is opened either.
 * - second provider (Paystack, no cancel): the reference is verified first (a
 *   success finalizes that order through the one shared owner → `paid`).
 *   Otherwise the session is superseded on our side, so a payment that still
 *   lands on that page finalizes into the existing reversal
 *   (paid_reversal_pending → queued late-payment refund), never a second
 *   order.
 *
 * Then `issue_4522_supersede_checkout_session` revokes the old session under
 * finalize's locks (revocation outbox + one audit row). The caller proves it
 * holds the old session by its buyer status token; a token that does not match
 * changes nothing.
 */
// @ts-ignore — Deno ESM import; types resolved at runtime
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface SupersedeRequest {
  checkoutSessionId: string;
  buyerStatusToken: string;
}

export type SupersedeOutcome =
  | { kind: "superseded" }
  | { kind: "paid"; checkoutSessionId: string }
  | { kind: "closed" }
  | { kind: "not_found" }
  | { kind: "unavailable"; reason: string };

export interface SupersedeDeps {
  sha256Hex: (value: string) => Promise<string>;
  /** Stripe Checkout Session expire on the connected account. */
  expireStripeCheckout: (input: {
    checkoutSessionId: string;
    stripeAccountId: string;
    idempotencyKey: string;
  }) => Promise<void>;
  /** Stripe Checkout Session read-back (status: open | complete | expired). */
  retrieveStripeCheckout: (input: {
    checkoutSessionId: string;
    stripeAccountId: string;
  }) => Promise<{ status: string | null; paymentStatus: string | null }>;
  /** The second provider's authoritative verify + finalize (ticket-checkout-status's). */
  resolvePaystackReturn: (session: {
    id: string;
    stripe_payment_intent_id: string | null;
  }) => Promise<{ kind: string; reason?: string; orderId?: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The request field, or null when absent or malformed (then nothing is closed). */
export function parseSupersedeRequest(value: unknown): SupersedeRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.checkoutSessionId === "string" ? record.checkoutSessionId.trim() : "";
  const token = typeof record.buyerStatusToken === "string" ? record.buyerStatusToken.trim() : "";
  if (!UUID_RE.test(id) || token.length < 16 || token.length > 256) return null;
  return { checkoutSessionId: id, buyerStatusToken: token };
}

const OPEN_STATUSES = new Set([
  "pending_free",
  "requires_payment",
  "processing_payment",
  "awaiting_web_redirect",
]);

export async function supersedeHeldCheckout(
  supabase: SupabaseClient,
  eventId: string,
  request: SupersedeRequest,
  deps: SupersedeDeps,
): Promise<SupersedeOutcome> {
  const tokenHash = await deps.sha256Hex(request.buyerStatusToken);
  const { data: session, error: sessionError } = await supabase
    .from("ticket_checkout_sessions")
    .select(
      "id, event_id, buyer_status_token_hash, order_id, status, revoked_at, stripe_account_id, stripe_payment_intent_id",
    )
    .eq("id", request.checkoutSessionId)
    .maybeSingle();
  if (sessionError !== null) return { kind: "unavailable", reason: "session_lookup_failed" };
  if (
    session === null || session.event_id !== eventId ||
    session.buyer_status_token_hash !== tokenHash
  ) {
    return { kind: "not_found" };
  }
  if (session.order_id !== null && session.order_id !== undefined) {
    return { kind: "paid", checkoutSessionId: request.checkoutSessionId };
  }
  if (session.revoked_at !== null && session.revoked_at !== undefined) return { kind: "closed" };
  if (!OPEN_STATUSES.has(String(session.status))) return { kind: "closed" };

  const { data: attempt, error: attemptError } = await supabase
    .from("ticket_checkout_provider_attempts")
    .select("provider, flow, provider_checkout_id, provider_idempotency_key")
    .eq("checkout_session_id", request.checkoutSessionId)
    .maybeSingle();
  if (attemptError !== null) return { kind: "unavailable", reason: "attempt_lookup_failed" };

  if (
    attempt?.provider === "stripe" && attempt.flow === "stripe_checkout" &&
    typeof attempt.provider_checkout_id === "string" && attempt.provider_checkout_id.length > 0
  ) {
    if (typeof session.stripe_account_id !== "string" || session.stripe_account_id.length === 0) {
      return { kind: "unavailable", reason: "stripe_account_missing" };
    }
    const target = {
      checkoutSessionId: attempt.provider_checkout_id,
      stripeAccountId: session.stripe_account_id,
    };
    try {
      await deps.expireStripeCheckout({
        ...target,
        // The revocation worker's key: its later expire replays this one.
        idempotencyKey: `${attempt.provider_idempotency_key}:expire`,
      });
    } catch {
      // Not expirable: only the provider's read-back says why.
      let read: { status: string | null; paymentStatus: string | null };
      try {
        read = await deps.retrieveStripeCheckout(target);
      } catch {
        return { kind: "unavailable", reason: "stripe_checkout_unreadable" };
      }
      if (read.status === "complete" || read.paymentStatus === "paid") {
        return { kind: "paid", checkoutSessionId: request.checkoutSessionId };
      }
      if (read.status !== "expired") {
        return { kind: "unavailable", reason: "stripe_checkout_not_expired" };
      }
    }
  } else if (attempt?.provider === "paystack") {
    const verdict = await deps.resolvePaystackReturn({
      id: request.checkoutSessionId,
      stripe_payment_intent_id: typeof session.stripe_payment_intent_id === "string"
        ? session.stripe_payment_intent_id
        : null,
    });
    if (verdict.kind === "finalized") {
      return { kind: "paid", checkoutSessionId: request.checkoutSessionId };
    }
    // Paid at the provider but our finalize did not land yet: never close a
    // paid checkout on a guess; the buyer tries again in a moment.
    if (verdict.kind === "pending" && verdict.reason === "finalize_retryable") {
      return { kind: "unavailable", reason: "paystack_finalize_pending" };
    }
  }

  const { data: revoked, error: revokeError } = await supabase.rpc(
    "issue_4522_supersede_checkout_session",
    {
      p_checkout_session_id: request.checkoutSessionId,
      p_event_id: eventId,
      p_buyer_status_token_hash: tokenHash,
    },
  );
  if (revokeError !== null) return { kind: "unavailable", reason: "supersede_failed" };
  const outcome = String((revoked as { outcome?: unknown } | null)?.outcome ?? "");
  if (outcome === "superseded") return { kind: "superseded" };
  if (outcome === "paid") return { kind: "paid", checkoutSessionId: request.checkoutSessionId };
  if (outcome === "closed") return { kind: "closed" };
  return { kind: "not_found" };
}
