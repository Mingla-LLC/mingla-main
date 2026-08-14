/**
 * paystackWebhookRouter — routes verified Paystack webhook events to the
 * existing order-finalize path (META-ORCH-1076 Phase 1).
 *
 * Mirrors the Stripe router split (_shared/stripeWebhookRouter.ts): the webhook
 * edge fn owns signature verify + the idempotent inbox; this module owns the
 * per-event business logic. charge.success → verify-by-reference → finalize via
 * the EXISTING biz_ticket_checkout_finalize RPC (no parallel finalize logic).
 *
 * Paystack docs cited inline (COMMS-0003):
 *   - Event envelope { event, data } + charge.success (NOT charge.succeeded):
 *       https://paystack.com/docs/payments/webhooks/
 *   - Verify Transaction (GET /transaction/verify/:reference; gate on
 *     data.status==="success" AND amount AND currency):
 *       https://paystack.com/docs/api/transaction/#verify
 *       https://paystack.com/docs/payments/verify-payments/
 *   - amount in subunits (kobo for NGN): https://paystack.com/docs/api/transaction/
 * Reference: Mingla_Artifacts/PAYSTACK_INTEGRATION_REFERENCE.md (Part 1.2, Part 4).
 */

// @ts-ignore — Deno ESM import; types resolved at runtime
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { writeAudit } from "./audit.ts";
import { qrTokenPepper } from "./ticketCheckout.ts";
// ISSUE-865 WP-B — post-finalize ad-conversion hook (idempotent + fail-open).
import { fireAdConversion } from "./adConversionFire.ts";
// ISSUE-1326 — the ONE finalize path for a paid NG (Paystack) venue reservation
// (shared with venue-reservation-confirm). Guards + idempotent-mints + fires.
import {
  finalizeVerifiedPaystackReservation,
  type ReservationFinalizeSession,
} from "./reservationPaystackFinalize.ts";
// Issue #1790 (SPEC #1788 P-28) — the NG venue-menu-order rail, discriminated by
// the `mingla_vo_` reference prefix (the way the stay arm is discriminated).
import {
  handleVenueOrderPaystackCharge,
  isVenueOrderPaystackReference,
} from "./venueOrderWebhook.ts";

// Verifier is injected so tests can stub the network call deterministically.
export type PaystackVerifier = (
  reference: string,
) => Promise<Record<string, unknown>>;

export interface PaystackChargeResult {
  status:
    | "finalized"
    | "replayed"
    | "orphan"
    | "amount_mismatch"
    | "currency_mismatch"
    | "verify_not_success"
    | "paid_reversal_pending"
    // ISSUE-1326 — the paid-NG-reservation rail. These are DISTINCT from the
    // ticket "finalized"/"replayed" statuses so the edge fn NEVER treats a
    // reservation as an order (no dispatchTicketConfirmation, no partner-split
    // fan-out on a reservation). No orderId is set for these.
    | "reservation_finalized"
    | "reservation_replayed"
    /** Slot taken between charge and finalize — manual refund owed (#1175 dark). */
    | "reservation_refund_due"
    // Issue #1790 — the venue-menu-order rail. DISTINCT from the ticket
    // statuses so the edge fn never treats a venue order as a ticket order (no
    // dispatchTicketConfirmation, no partner-split fan-out). No orderId is set.
    | "venue_order_finalized"
    | "venue_order_replayed";
  orderId?: string;
  /** ORCH-1331 — verified txn paid_at (ISO), plumbed to the partner-split
   * fan-out so the partner relationship pins at sale time. Additive/optional. */
  paidAtIso?: string;
}

/**
 * Handle a Paystack `charge.success` event.
 *
 * Defense in depth (never trust the webhook body alone — §1.2):
 *   1. reference present (else throw → inbox marks retryable).
 *   2. verify-by-reference: data.status==="success".
 *   3. lookup session by stripe_payment_intent_id == reference.
 *   4. amount==session.total_cents (both kobo) AND currency=="NGN".
 *   5. finalize via biz_ticket_checkout_finalize (idempotent: order_id early-return).
 */
export async function handlePaystackChargeSuccess(
  supabase: SupabaseClient,
  data: Record<string, unknown>,
  verify: PaystackVerifier,
): Promise<PaystackChargeResult> {
  const reference = typeof data?.reference === "string" ? data.reference : "";
  if (!reference) {
    // Retryable — a charge.success with no reference is malformed.
    throw new Error("paystack_charge_success_missing_reference");
  }

  // 2. Verify-by-reference. Authoritative confirmation (the webhook body is a
  // hint; the verify call is the truth). Gate on data.status==="success".
  const txn = await verify(reference);
  const txnStatus = String(txn?.status ?? "").toLowerCase();
  if (txnStatus !== "success") {
    await writeAudit(supabase, {
      user_id: null,
      brand_id: null,
      action: "paystack.charge_verify_not_success",
      target_type: "paystack_transaction",
      target_id: reference,
      after: { verify_status: txnStatus },
    });
    return { status: "verify_not_success" };
  }

  // ORCH-1291 [rsvp-chip-in] — a voluntary RSVP contribution shares the reference
  // slot (stripe_payment_intent_id, UNIQUE) on this rail. Look it up FIRST; if the
  // reference belongs to a contribution, finalize it via finalize_rsvp_contribution
  // (NO order minted) and return. Else fall through to the ticket path unchanged
  // (SC-10). Amount + currency guard mirrors the ticket path (verified kobo ==
  // buyer_total_cents; currency NGN).
  const { data: contribution, error: contributionError } = await supabase
    .from("event_rsvp_contributions")
    .select("id, status, buyer_total_cents, currency")
    .eq("stripe_payment_intent_id", reference)
    .maybeSingle();
  if (contributionError) {
    throw new Error(
      `paystack_contribution_lookup_failed: ${contributionError.message}`,
    );
  }
  if (contribution) {
    if (contribution.status === "paid") {
      return { status: "replayed" };
    }
    const cAmount = Number(txn?.amount ?? NaN);
    const cTotal = Number(contribution.buyer_total_cents ?? NaN);
    const cCurrency = String(txn?.currency ?? "").toUpperCase();
    if (!Number.isFinite(cAmount) || cAmount !== cTotal) {
      await markContributionFailed(supabase, String(contribution.id));
      await writeAudit(supabase, {
        user_id: null,
        brand_id: null,
        action: "paystack.contribution_amount_mismatch",
        target_type: "event_rsvp_contribution",
        target_id: String(contribution.id),
        after: {
          reference,
          verified_amount: cAmount,
          contribution_total: cTotal,
        },
      });
      return { status: "amount_mismatch" };
    }
    if (cCurrency !== "NGN") {
      await markContributionFailed(supabase, String(contribution.id));
      await writeAudit(supabase, {
        user_id: null,
        brand_id: null,
        action: "paystack.contribution_currency_mismatch",
        target_type: "event_rsvp_contribution",
        target_id: String(contribution.id),
        after: { reference, verified_currency: cCurrency },
      });
      return { status: "currency_mismatch" };
    }
    const cChannel = typeof txn?.channel === "string" ? txn.channel : "card";
    const cTxnId = txn?.id !== undefined && txn?.id !== null
      ? String(txn.id)
      : null;
    const { data: cFinalized, error: cFinalizeError } = await supabase.rpc(
      "issue_1930_finalize_rsvp_contribution",
      {
        p_contribution_id: String(contribution.id),
        p_provider_ref: reference,
        p_charge_id: cTxnId,
        p_payment_method_type: cChannel,
      },
    );
    if (cFinalizeError) {
      throw new Error(
        `paystack_contribution_finalize_failed: ${cFinalizeError.message}`,
      );
    }
    if (cFinalized?.outcome === "paid_reversal_pending") {
      return { status: "paid_reversal_pending" };
    }
    return { status: "finalized" };
  }

  // Issue #1790 [venue menu orders] — a venue order's reference lives in
  // venue_orders.paystack_reference (its OWN column, UNIQUE) and matches
  // NEITHER the ticket nor the contribution slot, so without this arm it would
  // fall straight to orphan: charged, never finalized, never refunded — the
  // exact hole #1326 found on the reservation rail. Discriminated by the
  // `mingla_vo_` prefix BEFORE any other lookup, so the ticket and contribution
  // arms and their tests are untouched. Paystack's verify response carries the
  // real `fees`, so this rail lands its payout fee snapshot immediately.
  if (isVenueOrderPaystackReference(reference)) {
    const outcome = await handleVenueOrderPaystackCharge(
      supabase,
      reference,
      txn,
    );
    if (!outcome.matched) {
      await writeAudit(supabase, {
        user_id: null,
        brand_id: null,
        action: "paystack.charge_orphan_reference",
        target_type: "paystack_transaction",
        target_id: reference,
        after: { note: "venue-order reference matches no venue_orders row" },
      });
      return { status: "orphan" };
    }
    if (outcome.status === "amount_or_currency_mismatch") {
      // The EXISTING slug, deliberately: ORCH-0806 keeps a closed vocabulary of
      // audit action labels, and "a verified Paystack charge did not match what
      // we priced" is the same operational fact whatever was being sold.
      // `target_type` is what distinguishes the subject.
      await writeAudit(supabase, {
        user_id: null,
        brand_id: null,
        action: "paystack.charge_amount_mismatch",
        target_type: "venue_order",
        target_id: outcome.orderId ?? reference,
        after: { reference, verified_amount: Number(txn?.amount ?? NaN) },
      });
      return { status: "amount_mismatch" };
    }
    return {
      status: outcome.status === "replayed"
        ? "venue_order_replayed"
        : "venue_order_finalized",
    };
  }

  // 3. Lookup the session by the persisted reference.
  const { data: session, error: sessionError } = await supabase
    .from("ticket_checkout_sessions")
    .select("id, status, order_id, total_cents, currency")
    .eq("stripe_payment_intent_id", reference)
    .maybeSingle();
  if (sessionError) {
    // Retryable — transient DB error.
    throw new Error(`paystack_session_lookup_failed: ${sessionError.message}`);
  }
  if (!session) {
    // ISSUE-1326 [ng-reservation-finalize] — BEFORE declaring an orphan, try the
    // paid-reservation rail. venue-reservation-create persists a paid NG
    // reservation's reference in reservation_checkout_sessions.paystack_reference
    // (NOT the stripe_payment_intent_id slot the ticket/contribution paths use),
    // so a reservation reference matches NEITHER path above — it fell straight to
    // orphan (charged, never minted, never refunded). Look it up here; if it is a
    // reservation, finalize via the SHARED provider-neutral + idempotent path
    // (the same one venue-reservation-confirm uses) and return a reservation-
    // specific status. Only reached when the ticket session is null, so the
    // ticket / contribution arms and their tests are untouched.
    const { data: rSession, error: rSessionError } = await supabase
      .from("reservation_checkout_sessions")
      .select(
        "id, status, reservation_id, amount_cents, currency, attribution_click_id",
      )
      .eq("paystack_reference", reference)
      .maybeSingle();
    if (rSessionError) {
      // Retryable — transient DB error.
      throw new Error(
        `paystack_reservation_lookup_failed: ${rSessionError.message}`,
      );
    }
    // Guard on a real row id: a genuine match always carries `id`. (A missing
    // row is null; a malformed/empty shape is ignored → true orphan.)
    if (
      rSession && typeof (rSession as { id?: unknown }).id === "string" &&
      (rSession as { id: string }).id
    ) {
      const verifiedAmount = Number(txn?.amount ?? NaN);
      const verifiedCurrency = String(txn?.currency ?? "");
      const outcome = await finalizeVerifiedPaystackReservation(
        supabase,
        rSession as ReservationFinalizeSession,
        reference,
        verifiedAmount,
        verifiedCurrency,
        // AWAIT the conversion fire: the webhook is the reliable background
        // sender with no human waiting, and awaiting keeps it inside the
        // webhook's lifecycle so it actually runs.
        true,
      );
      switch (outcome.kind) {
        case "finalized":
          return { status: "reservation_finalized" };
        case "replayed":
          return { status: "reservation_replayed" };
        case "amount_mismatch":
          return { status: "amount_mismatch" };
        case "currency_mismatch":
          return { status: "currency_mismatch" };
        case "slot_unavailable_refund_due":
          return { status: "reservation_refund_due" };
        case "finalize_error":
          // Retryable — let the inbox retry the finalize (the RPC is idempotent).
          throw new Error(
            `paystack_reservation_finalize_failed: ${outcome.message}`,
          );
      }
    }

    await writeAudit(supabase, {
      user_id: null,
      brand_id: null,
      action: "paystack.charge_orphan_reference",
      target_type: "paystack_transaction",
      target_id: reference,
      after: { note: "no session matches this reference" },
    });
    return { status: "orphan" };
  }

  // ORCH-1331 — the verified txn's paid_at pins the partner relationship for
  // the split fan-out. Additive; absent on malformed payloads.
  const paidAtIso = typeof txn?.paid_at === "string" ? txn.paid_at : undefined;

  // Idempotent fast-path: already finalized → return the order (mirrors the
  // finalize RPC's order_id early-return; cheap short-circuit).
  if (session.order_id) {
    return { status: "replayed", orderId: String(session.order_id), paidAtIso };
  }

  // 4. Amount + currency must match (§1.2 step 2 — "if the amount doesn't
  // match, don't deliver value"). amount is in subunits (kobo); session
  // total_cents is the all-in NGN total in kobo persisted at create.
  const verifiedAmount = Number(txn?.amount ?? NaN);
  const sessionTotal = Number(session.total_cents ?? NaN);
  const verifiedCurrency = String(txn?.currency ?? "").toUpperCase();

  if (!Number.isFinite(verifiedAmount) || verifiedAmount !== sessionTotal) {
    await markSessionFailed(supabase, String(session.id));
    await writeAudit(supabase, {
      user_id: null,
      brand_id: null,
      action: "paystack.charge_amount_mismatch",
      target_type: "ticket_checkout_session",
      target_id: String(session.id),
      after: {
        reference,
        verified_amount: verifiedAmount,
        session_total: sessionTotal,
      },
    });
    return { status: "amount_mismatch" };
  }
  if (verifiedCurrency !== "NGN") {
    await markSessionFailed(supabase, String(session.id));
    await writeAudit(supabase, {
      user_id: null,
      brand_id: null,
      action: "paystack.charge_currency_mismatch",
      target_type: "ticket_checkout_session",
      target_id: String(session.id),
      after: { reference, verified_currency: verifiedCurrency },
    });
    return { status: "currency_mismatch" };
  }

  // 5. Finalize via the EXISTING RPC — order + line items + tickets + chat +
  // notifications, all reused. The Paystack reference goes in the PI-id slot
  // (text column, UNIQUE → idempotency); the Paystack txn id in the charge-id
  // slot; data.channel → payment_method type (card|bank|ussd|bank_transfer all
  // fall to online_card inside the RPC, acceptable v1).
  const channel = typeof txn?.channel === "string" ? txn.channel : "card";
  const txnId = txn?.id !== undefined && txn?.id !== null
    ? String(txn.id)
    : null;
  const { data: finalized, error: finalizeError } = await supabase.rpc(
      "biz_ticket_checkout_finalize",
    {
      p_checkout_session_id: String(session.id),
      p_stripe_payment_intent_id: reference,
      p_stripe_charge_id: txnId,
      p_stripe_payment_method_type: channel,
      p_qr_token_pepper: qrTokenPepper(),
      // Paystack Phase 1 has no installment plans — single full payment only
      // (ORCH-0921 gate: finalize callers must pass p_installment_plan_root).
      p_installment_plan_root: false,
    },
  );
  if (finalizeError || !finalized) {
    // Retryable — let the inbox retry the finalize.
    throw new Error(
      `paystack_finalize_failed: ${finalizeError?.message ?? "no result"}`,
    );
  }
  if (
    (finalized as Record<string, unknown>).outcome ===
      "paid_reversal_pending"
  ) {
    return { status: "paid_reversal_pending", paidAtIso };
  }

  const orderId = String((finalized as Record<string, unknown>).orderId ?? "");

  // ISSUE-865 WP-B — ad-conversion CAPI send for the Paystack/NGN arm (this is
  // the ONLY finalize for Paystack orders — never reachable from the Stripe
  // webhook / confirm sites). Awaited (webhook handler, no human waiting) but
  // idempotent + fail-open: a CAPI failure never blocks the finalize. event_id
  // = orderId. Belt-and-suspenders try/catch (the helper already never throws).
  try {
    if (orderId) {
      await fireAdConversion(supabase as never, { orderId, surface: "web" });
    }
  } catch (adConvErr) {
    console.warn(
      "[paystack-webhook] ad-conversion fire threw (non-fatal):",
      adConvErr instanceof Error ? adConvErr.message : String(adConvErr),
    );
  }

  return { status: "finalized", orderId, paidAtIso };
}

async function markSessionFailed(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<void> {
  await supabase
    .from("ticket_checkout_sessions")
    .update({
      status: "failed",
      failed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
}

// ORCH-1291 — mark a contribution row failed on an amount/currency mismatch.
async function markContributionFailed(
  supabase: SupabaseClient,
  contributionId: string,
): Promise<void> {
  await supabase
    .from("event_rsvp_contributions")
    .update({
      status: "failed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", contributionId);
}
