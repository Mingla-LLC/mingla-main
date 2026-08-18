/**
 * issue #2198 [paystack-return-verify] — the buyer's return leg from Paystack
 * asks Paystack whether the payment succeeded, instead of waiting for the
 * `charge.success` webhook.
 *
 * WHAT WAS BROKEN. `ticket-checkout-create` returns the guest to
 * `…/confirm?cs=paystack&csi={sessionId}&bst={token}` and the confirm surface
 * polls `ticket-checkout-status` / calls `ticket-checkout-confirm`. Neither
 * function contained a single reference to Paystack, so the session sat at
 * `awaiting_web_redirect` until `charge.success` arrived and flipped it
 * server-side. Measured on a real ₦100 bank-transfer charge (2026-08-18,
 * session 06fd4518-…): Paystack `paid_at` 01:41:05, webhook 01:45:11 — the
 * buyer watched a spinner for 4m 06s having already paid. On card the webhook
 * lands in seconds, which is why it hid. Worse than the wait: the webhook was
 * the ONLY completion path, so a dropped or permanently-failing delivery meant
 * a paid buyer with no tickets and no client-side recovery.
 *
 * WHAT THIS IS. The return-leg resolver. Verification is AUTHORITATIVE; the
 * webhook stays a backstop, and both remain safe to run — they already race.
 *
 * FIVE PROPERTIES, and where each is enforced:
 *
 *  1. NEVER TRUST THE CLIENT. The decision to verify comes from
 *     `ticket_checkout_provider_attempts.provider = 'paystack'` — a
 *     service-role row written by `ticket-checkout-create`. The `?cs=paystack`
 *     query parameter is never read here or by either caller. Success comes
 *     only from Paystack's own API response. A guest who hand-writes
 *     `?cs=paystack` on an unpaid session reaches `not_paystack` (no attempt)
 *     or `pending` (Paystack says not-success) and gets nothing.
 *     Paystack's own Magento plugin holds the same line — its callback test
 *     asserts the order is loaded from the VERIFY RESPONSE, never the caller's
 *     query string (PaystackHQ/plugin-magento-2 Test/Unit/Controller/Payment/
 *     CallbackTest.php::testOrderIsLoadedFromTheVerifyResponseNotTheRequest).
 *
 *  2. EXACTLY ONE ORDER. This module mints nothing. It delegates to
 *     `handlePaystackChargeSuccess` — the SAME function the webhook routes
 *     through — which calls the SAME idempotent `biz_ticket_checkout_finalize`
 *     RPC. That RPC takes `FOR UPDATE` on the session and returns the existing
 *     order whenever `order_id` is non-null, and enforces the
 *     `admission_epoch` CAS against `event_checkout_admission_state`. No second
 *     mechanism is introduced: verify-then-finalize and webhook-then-finalize
 *     are the same finalize, serialized by the database.
 *
 *  3. AMOUNT + CURRENCY MUST MATCH, FAIL CLOSED. Also delegated — the shared
 *     handler compares the verified `amount` (kobo) to `total_cents` and the
 *     verified `currency` to NGN, marks the session failed and audits on a
 *     mismatch. A mismatch surfaces here as a TERMINAL failure, never as value.
 *
 *  4. A REAL REASON, NOT A SPINNER. `failed` / `abandoned` / `reversed` are
 *     terminal and carry a bounded token the client maps through #2188's
 *     `paidCheckoutErrorMessage`. Every other verify status (`ongoing`,
 *     `pending`, `processing`, `queued`, `send_otp`, …) is still in flight and
 *     stays `pending` so the poll — and the webhook backstop — continue.
 *
 *  5. ONE NETWORK CALL. `verify` is invoked exactly once per resolve; the
 *     delegate re-reads the SAME payload through a memoised verifier, so the
 *     shared handler re-applies its own status/amount/currency gates to the
 *     identical bytes without a second round trip.
 *
 * PAYSTACK CONTRACT (checked against Paystack's own published sources, not
 * assumed — their rendered docs site 403s every non-browser client):
 *   - `GET https://api.paystack.co/transaction/verify/:reference`, secret key
 *     as `Authorization: Bearer …`, and the explicit rule "check for
 *     `data.status==='success'` not `status==='success'`" — the top-level
 *     `status` only says the API CALL worked:
 *       PaystackHQ/documentation → receiving-payments/verifying-the-transaction.md
 *       https://paystack.com/docs/api/transaction/#verify
 *       https://paystack.com/docs/payments/verify-payments/
 *   - `data.status` is an enum whose non-success members include `abandoned`
 *     (PaystackHQ/checkout-android PaystackApiRepositoryTest.kt uses
 *     `transactionStatus = "abandoned"`; PaystackHQ/plugin-magento-2 tests the
 *     "abandoned and never paid for" case) and `failed` (this repo already
 *     treats `failed`/`abandoned` as terminal in
 *     `partner-paystack-split-retry/index.ts:217`).
 *   - `data.amount` is in subunits (kobo for NGN), `data.currency` is the ISO
 *     code, `data.channel` is `card|bank|ussd|bank_transfer`. These are the
 *     exact fields `paystackWebhookRouter` has been gating LIVE charges on
 *     since META-ORCH-1076 — this module deliberately reuses that reader
 *     rather than re-deriving the shape.
 */

// @ts-ignore — Deno ESM import; types resolved at runtime
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  handlePaystackChargeSuccess,
  type PaystackVerifier,
} from "./paystackWebhookRouter.ts";
import { dispatchTicketConfirmation } from "./ticketCheckout.ts";

/**
 * Terminal, buyer-visible verify statuses. Everything NOT in this set and not
 * `success` is treated as still-in-flight (keep polling), which is the safe
 * direction: a slow transaction resolves via the next poll or the webhook,
 * whereas wrongly calling an in-flight charge "failed" strands a paying buyer.
 */
const TERMINAL_VERIFY_STATUSES = new Set(["failed", "abandoned", "reversed"]);

export type PaystackReturnOutcome =
  /** Not a Paystack checkout — the caller's existing (Stripe) path is untouched. */
  | { kind: "not_paystack" }
  /** One order exists for this session. Idempotent across verify vs webhook. */
  | { kind: "finalized"; orderId: string }
  /** Still resolving. The caller keeps polling; the webhook remains the backstop. */
  | { kind: "pending"; reason: string }
  /** Terminal. `code` is the bounded token the client maps to guest-facing copy. */
  | { kind: "failed"; code: string };

interface ReturnSession {
  id: string;
  stripe_payment_intent_id?: string | null;
}

/**
 * Resolve a buyer's return from Paystack for a ticket checkout session.
 *
 * Callers pass the session row they already hold and the verifier (injected so
 * tests drive it deterministically). Safe to call on EVERY session: a non-
 * Paystack session short-circuits to `not_paystack` before any network I/O.
 */
export async function resolvePaystackTicketReturn(
  supabase: SupabaseClient,
  session: ReturnSession,
  verify: PaystackVerifier,
): Promise<PaystackReturnOutcome> {
  // 1. Provider identity from the SERVER's own row, never from the client.
  //    `checkout_session_id` is UNIQUE on this table, so this is the one
  //    attempt for this session.
  const { data: attempt, error: attemptError } = await supabase
    .from("ticket_checkout_provider_attempts")
    .select("id, provider, flow, provider_reference, state")
    .eq("checkout_session_id", session.id)
    .maybeSingle();
  if (attemptError) {
    // A transient read failure must not be reported as "not Paystack" (that
    // would silently drop the buyer back onto the webhook-only path) nor as a
    // failure. Keep the caller polling.
    return { kind: "pending", reason: "attempt_lookup_failed" };
  }
  if (!attempt || attempt.provider !== "paystack") {
    return { kind: "not_paystack" };
  }

  // 2. The reference to verify. `provider_reference` is stamped by
  //    `issue_1930_commit_ticket_provider_attempt` once Paystack initialize
  //    returned; `stripe_payment_intent_id` carries the SAME `mingla_{sessionId}`
  //    value, persisted just before initialize. Both are server-written. The
  //    fallback matters for the attempt that initialized but never committed
  //    (network truncation) — the buyer may still have paid, and verification
  //    is exactly how we find out. It can never manufacture value: Paystack has
  //    to say `success` AND the amount and currency still have to match.
  const reference = typeof attempt.provider_reference === "string" &&
      attempt.provider_reference.length > 0
    ? attempt.provider_reference
    : typeof session.stripe_payment_intent_id === "string" &&
        session.stripe_payment_intent_id.length > 0
    ? session.stripe_payment_intent_id
    : null;
  if (reference === null) {
    return { kind: "pending", reason: "no_provider_reference" };
  }

  // 3. Ask Paystack. This — not any query parameter — is the source of truth.
  let txn: Record<string, unknown>;
  try {
    txn = await verify(reference);
  } catch (err) {
    // Verify unavailable (network, 404-not-yet-visible, provider blip). NOT
    // terminal: keep polling, and the webhook backstop still lands.
    console.warn(
      "[paystack-return-verify] verify unavailable (poll again)",
      reference,
      err instanceof Error ? err.message : String(err),
    );
    return { kind: "pending", reason: "verify_unavailable" };
  }

  const verifyStatus = String(txn?.status ?? "").toLowerCase();
  if (verifyStatus !== "success") {
    if (TERMINAL_VERIFY_STATUSES.has(verifyStatus)) {
      // #2188 error mapper reads these bounded tokens.
      return {
        kind: "failed",
        code: verifyStatus === "abandoned"
          ? "paystack_charge_abandoned"
          : "paystack_charge_failed",
      };
    }
    return {
      kind: "pending",
      reason: `verify_status_${verifyStatus || "unknown"}`,
    };
  }

  // 4. Finalize through the ONE existing owner. The memoised verifier hands it
  //    the payload we already fetched, so its own `data.status === "success"`,
  //    amount and currency gates run against the identical bytes with no second
  //    round trip. Everything downstream — the idempotent finalize RPC, the
  //    admission-epoch CAS, the mismatch audit + fail-closed marking, the
  //    ad-conversion fire — is the webhook's code path, unchanged.
  const memoised: PaystackVerifier = (ref: string) =>
    ref === reference ? Promise.resolve(txn) : verify(ref);

  let result: Awaited<ReturnType<typeof handlePaystackChargeSuccess>>;
  try {
    result = await handlePaystackChargeSuccess(
      supabase,
      { reference },
      memoised,
    );
  } catch (err) {
    // The shared handler throws only on RETRYABLE conditions (transient DB
    // read, finalize error) — exactly the cases where the webhook backstop
    // should get its turn. Never terminal.
    console.warn(
      "[paystack-return-verify] finalize deferred to webhook backstop",
      reference,
      err instanceof Error ? err.message : String(err),
    );
    return { kind: "pending", reason: "finalize_retryable" };
  }

  switch (result.status) {
    case "finalized":
    case "replayed": {
      // `replayed` = the webhook (or a concurrent poll) already minted it. Same
      // single order, returned to the buyer either way.
      const orderId = result.orderId ?? "";
      if (orderId.length === 0) {
        return { kind: "pending", reason: "order_mid_mint" };
      }
      if (result.status === "finalized") {
        // THIS call minted the order, so THIS call owns the confirmation
        // dispatch. On the Stripe rail the webhook is always in flight and owns
        // it; here the webhook is exactly what may never arrive. The dispatcher
        // is idempotency-keyed per (order_id, channel), so a webhook that DOES
        // land later still produces one email and one SMS. Fire-and-forget —
        // the buyer's screen never waits on the fan-out.
        void dispatchTicketConfirmation(orderId).catch((err: unknown) => {
          console.warn(
            "[paystack-return-verify] confirmation dispatch failed (non-fatal):",
            err instanceof Error ? err.message : String(err),
          );
        });
      }
      return { kind: "finalized", orderId };
    }
    case "amount_mismatch":
    case "currency_mismatch":
      // Fail CLOSED. The shared handler already marked the session failed and
      // wrote the audit row; the buyer is told plainly that money moved.
      return { kind: "failed", code: "paystack_payment_mismatch" };
    case "paid_reversal_pending":
      // Current-sale truth moved under the charge (#1930). The revocation
      // machinery owns the refund; the buyer must not see a spinner.
      return { kind: "failed", code: "checkout_unavailable" };
    default:
      // `orphan`, `verify_not_success` (raced), and the reservation / venue-order
      // arms — none reachable from a ticket session's own reference. Keep polling.
      return { kind: "pending", reason: `unresolved_${result.status}` };
  }
}
