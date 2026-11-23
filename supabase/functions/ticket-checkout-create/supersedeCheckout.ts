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
 *
 * Pass 5 (F-1 / F-2) — the server is the authority, not what the browser
 * remembered:
 * - a held checkout is only ever the SAME buyer's (same email and phone as
 *   this create): another buyer's checkout held by the same browser tab is
 *   never closed and never answered for (`other_buyer`), so the new buyer
 *   gets their own checkout and never sees the earlier buyer's booking;
 * - every other OPEN provider page of the same buyer for this event (a card
 *   page or a second-provider page whose session is unpaid and not revoked)
 *   is closed the same way before a new checkout opens, whatever the browser
 *   still holds (`supersedeOpenBuyerCheckouts`). One buyer, one payable page.
 *
 * Deploy window: on a database without the #4522 schema (the shared probe)
 * nothing is closed and the create goes on exactly as main.
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
  | { kind: "unavailable"; reason: string }
  /** The #4522 schema is not applied yet: main's behaviour, nothing closed. */
  | { kind: "not_applied" }
  /** Pass 5 (F-2) — the held checkout is another buyer's: left as it is. */
  | { kind: "other_buyer" };

/** The buyer of the checkout being created (as the create handler normalised it). */
export interface SupersedeBuyer {
  email: string;
  phoneE164: string | null;
}

export interface SupersedeDeps {
  /** The shared #4522 schema probe (planV2Schema). */
  planV2Ready: () => Promise<boolean>;
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

function sameBuyer(
  session: { buyer_email?: unknown; buyer_phone_e164?: unknown },
  buyer: SupersedeBuyer,
): boolean {
  const email = typeof session.buyer_email === "string" ? session.buyer_email.trim().toLowerCase() : "";
  const phone = typeof session.buyer_phone_e164 === "string" ? session.buyer_phone_e164 : null;
  return email.length > 0 && email === buyer.email.trim().toLowerCase() &&
    (phone ?? "") === (buyer.phoneE164 ?? "");
}

const SESSION_COLUMNS =
  "id, event_id, buyer_status_token_hash, buyer_email, buyer_phone_e164, order_id, status, revoked_at, stripe_account_id, stripe_payment_intent_id";

export async function supersedeHeldCheckout(
  supabase: SupabaseClient,
  eventId: string,
  request: SupersedeRequest,
  deps: SupersedeDeps,
  buyer: SupersedeBuyer,
): Promise<SupersedeOutcome> {
  if (!(await deps.planV2Ready())) return { kind: "not_applied" };
  const tokenHash = await deps.sha256Hex(request.buyerStatusToken);
  const { data: session, error: sessionError } = await supabase
    .from("ticket_checkout_sessions")
    .select(SESSION_COLUMNS)
    .eq("id", request.checkoutSessionId)
    .maybeSingle();
  if (sessionError !== null) return { kind: "unavailable", reason: "session_lookup_failed" };
  if (
    session === null || session.event_id !== eventId ||
    session.buyer_status_token_hash !== tokenHash
  ) {
    return { kind: "not_found" };
  }
  // Pass 5 (F-2) — a checkout of a different buyer is not this buyer's to
  // close, and its state (paid or not) is never told to them.
  if (!sameBuyer(session, buyer)) return { kind: "other_buyer" };
  return await closeSession(supabase, eventId, session, tokenHash, deps, false);
}

/**
 * Pass 5 (F-1) — every other open provider page of this buyer for this event
 * is closed before a new checkout opens, whatever the browser still holds
 * (Back, an unchanged Pay answered "in progress", a lost tab). Only sessions
 * with a provider page (card Checkout or second-provider redirect) that are
 * unpaid and not revoked; the same buyer is the same email AND phone. One
 * refusal to close (`unavailable`) stops the create: never two payable pages.
 */
export async function supersedeOpenBuyerCheckouts(
  supabase: SupabaseClient,
  eventId: string,
  buyer: SupersedeBuyer,
  deps: SupersedeDeps,
  exceptSessionId: string | null,
): Promise<{ closed: string[] } | { kind: "unavailable"; reason: string } | { kind: "not_applied" }> {
  if (!(await deps.planV2Ready())) return { kind: "not_applied" };
  if (buyer.email.trim().length === 0) return { closed: [] };
  let query = supabase
    .from("ticket_checkout_sessions")
    .select(SESSION_COLUMNS)
    .eq("event_id", eventId)
    .eq("buyer_email", buyer.email.trim().toLowerCase())
    .is("order_id", null)
    .is("revoked_at", null)
    .in("status", [...OPEN_STATUSES]);
  query = buyer.phoneE164 === null
    ? query.is("buyer_phone_e164", null)
    : query.eq("buyer_phone_e164", buyer.phoneE164);
  const { data: rows, error } = await query.order("created_at", { ascending: false }).limit(10);
  if (error !== null) return { kind: "unavailable", reason: "open_checkout_lookup_failed" };
  const closed: string[] = [];
  for (const row of (Array.isArray(rows) ? rows : []) as Array<Record<string, unknown>>) {
    const id = String(row.id ?? "");
    if (id === "" || id === exceptSessionId || !sameBuyer(row, buyer)) continue;
    const hash = typeof row.buyer_status_token_hash === "string" ? row.buyer_status_token_hash : null;
    if (hash === null) continue;
    const outcome = await closeSession(supabase, eventId, row, hash, deps, true);
    if (outcome.kind === "unavailable") return outcome;
    if (outcome.kind === "superseded") closed.push(id);
  }
  return { closed };
}

async function closeSession(
  supabase: SupabaseClient,
  eventId: string,
  // deno-lint-ignore no-explicit-any
  session: any,
  tokenHash: string,
  deps: SupersedeDeps,
  onlyProviderPages: boolean,
): Promise<SupersedeOutcome> {
  const checkoutSessionId = String(session.id);
  if (session.order_id !== null && session.order_id !== undefined) {
    return { kind: "paid", checkoutSessionId };
  }
  if (session.revoked_at !== null && session.revoked_at !== undefined) return { kind: "closed" };
  if (!OPEN_STATUSES.has(String(session.status))) return { kind: "closed" };

  const { data: attempt, error: attemptError } = await supabase
    .from("ticket_checkout_provider_attempts")
    .select("provider, flow, provider_checkout_id, provider_idempotency_key")
    .eq("checkout_session_id", checkoutSessionId)
    .maybeSingle();
  if (attemptError !== null) return { kind: "unavailable", reason: "attempt_lookup_failed" };
  // A session the server found by buyer (not one the browser named) is
  // closed only when it has a payable provider page.
  if (
    onlyProviderPages &&
    !(attempt?.provider === "stripe" && attempt.flow === "stripe_checkout") &&
    !(attempt?.provider === "paystack")
  ) {
    return { kind: "closed" };
  }

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
        return { kind: "paid", checkoutSessionId: checkoutSessionId };
      }
      if (read.status !== "expired") {
        return { kind: "unavailable", reason: "stripe_checkout_not_expired" };
      }
    }
  } else if (attempt?.provider === "paystack") {
    const verdict = await deps.resolvePaystackReturn({
      id: checkoutSessionId,
      stripe_payment_intent_id: typeof session.stripe_payment_intent_id === "string"
        ? session.stripe_payment_intent_id
        : null,
    });
    if (verdict.kind === "finalized") {
      return { kind: "paid", checkoutSessionId: checkoutSessionId };
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
      p_checkout_session_id: checkoutSessionId,
      p_event_id: eventId,
      p_buyer_status_token_hash: tokenHash,
    },
  );
  if (revokeError !== null) return { kind: "unavailable", reason: "supersede_failed" };
  const outcome = String((revoked as { outcome?: unknown } | null)?.outcome ?? "");
  if (outcome === "superseded") return { kind: "superseded" };
  if (outcome === "paid") return { kind: "paid", checkoutSessionId: checkoutSessionId };
  if (outcome === "closed") return { kind: "closed" };
  return { kind: "not_found" };
}
