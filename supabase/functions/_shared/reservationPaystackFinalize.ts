/**
 * reservationPaystackFinalize — ISSUE-1326 · the ONE finalize code path for a
 * paid Nigerian (Paystack) venue reservation.
 *
 * Both the Paystack webhook router (`paystackWebhookRouter.ts`,
 * charge.success → primary source of truth) AND `venue-reservation-confirm`
 * (the native-app poll fast-path) call this SINGLE helper so there is exactly
 * ONE place that guards + mints + fires — never two divergent finalize paths.
 *
 * It mirrors the shipped ticket / RSVP-contribution finalize arms on the same
 * router:
 *   • amount(kobo) == session.amount_cents AND currency == 'NGN' guard,
 *   • finalize via the EXISTING, provider-neutral, idempotent
 *     `pg_finalize_guest_reservation(p_session_id, p_payment_intent_id)` RPC
 *     (the Paystack reference goes in the text PI/idempotency slot),
 *   • fire the #865 two-tier ad-conversion on the minted reservation id
 *     (fire-and-forget / fail-open — a conversion failure NEVER affects the
 *     finalize or the webhook ack).
 *
 * Idempotency (money-critical): a redelivered webhook must do NOTHING. The RPC
 * itself is idempotent (session FOR UPDATE + reservation_id early-return + the
 * reservations(payment_intent_id) unique index), and this helper additionally
 * short-circuits an already-linked / completed / terminal session before it
 * ever re-guards or re-fires.
 *
 * SLOT-TAKEN-AFTER-CHARGE (known manual-refund gap): if the slot was taken
 * between charge and finalize the RPC raises `slot_unavailable`. A refund is
 * owed, but the #1175 Paystack venue-refund rail is currently DARK — so this
 * helper does NOT attempt an auto-refund through the dark rail. It marks the
 * session failed with a clear failure_reason AND writes an audit marker that
 * flags "paid reservation needs MANUAL refund", then lets the caller ack. This
 * is the documented open gap for #1326 until the #1175 rail un-darkens.
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { writeAudit } from "./audit.ts";
// ISSUE-865 WP-B — post-finalize ad-conversion hook (idempotent + fail-open).
import { fireAdConversion } from "./adConversionFire.ts";

/** The subset of a reservation_checkout_sessions row this helper needs. */
export interface ReservationFinalizeSession {
  id: string;
  status: string | null;
  reservation_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  attribution_click_id: string | null;
}

/** Normalized outcome — each caller maps it to its own response shape. */
export type ReservationFinalizeOutcome =
  | { kind: "finalized"; reservationId: string }
  /** Already minted / terminal — a redelivery: do nothing. reservationId when known. */
  | { kind: "replayed"; reservationId: string | null }
  | { kind: "amount_mismatch" }
  | { kind: "currency_mismatch" }
  /** Slot taken between charge and finalize — refund owed (manual; #1175 dark). */
  | { kind: "slot_unavailable_refund_due" }
  /** Any other finalize RPC error — the caller decides (webhook: retry; confirm: 409). */
  | { kind: "finalize_error"; message: string };

/**
 * Guard + idempotent-finalize + fire a VERIFIED Paystack reservation charge.
 *
 * The caller is responsible for verifying the Paystack transaction FIRST (the
 * webhook via its injected verifier; confirm via `paystackVerifyTransaction`)
 * and passing the verified amount (subunits/kobo) + currency. This helper never
 * trusts an unverified amount.
 *
 * @param supabase          service-role client.
 * @param session           the reservation_checkout_sessions row (already fetched).
 * @param reference         the Paystack reference (the text PI/idempotency key).
 * @param verifiedAmountSubunits  verified txn amount in kobo.
 * @param verifiedCurrency  verified txn currency (any case).
 * @param awaitConversion   whether to AWAIT the post-mint ad-conversion fire.
 *   The mint / guards / idempotency are identical either way — ONLY the fire's
 *   await differs:
 *     • WEBHOOK (true): await it. The webhook is the reliable background sender
 *       with no human waiting, and awaiting keeps the fire inside the webhook's
 *       lifecycle so it actually runs to completion.
 *     • CONFIRM (false): fire-and-forget. Confirm is the guest's tap→confirm
 *       fast poll (it usually WINS the race vs the webhook), so the response
 *       must NEVER block on the conversion fan-out (up to ~8s per live channel).
 *       Mirrors confirm's Stripe path (`void fireAdConversion(...)`); the browser
 *       reservation pixel fires the same event_id client-side (deduped), so the
 *       void'd server fire is belt-and-suspenders.
 *   Either way the fire is fail-open and never affects the mint/outcome.
 */
export async function finalizeVerifiedPaystackReservation(
  supabase: SupabaseClient,
  session: ReservationFinalizeSession,
  reference: string,
  verifiedAmountSubunits: number,
  verifiedCurrency: string,
  awaitConversion = true,
): Promise<ReservationFinalizeOutcome> {
  // 1. IDEMPOTENT SHORT-CIRCUIT (before any guard / mint / fire). A redelivered
  //    webhook (or a confirm racing the webhook) must re-mint NOTHING and
  //    re-fire NOTHING.
  if (session.reservation_id) {
    return { kind: "replayed", reservationId: session.reservation_id };
  }
  if (session.status === "completed") {
    return { kind: "replayed", reservationId: session.reservation_id ?? null };
  }
  if (session.status === "failed" || session.status === "expired") {
    // Already terminally handled (a prior mismatch / slot-taken / create fail).
    // Do NOT re-audit or re-mint — just no-op.
    return { kind: "replayed", reservationId: session.reservation_id ?? null };
  }

  // 2. AMOUNT + CURRENCY GUARD (mirror the ticket / contribution arms). The
  //    verified subunit amount MUST equal the session's persisted kobo total,
  //    and the currency MUST be NGN. On mismatch: mark failed + audit, do NOT
  //    finalize.
  const verifiedAmount = Number(verifiedAmountSubunits);
  const sessionTotal = Number(session.amount_cents ?? NaN);
  if (!Number.isFinite(verifiedAmount) || verifiedAmount !== sessionTotal) {
    await markReservationSessionFailed(
      supabase,
      session.id,
      "paystack_amount_mismatch",
    );
    await writeAudit(supabase, {
      user_id: null,
      brand_id: null,
      action: "paystack.reservation_amount_mismatch",
      target_type: "reservation_checkout_session",
      target_id: session.id,
      after: {
        reference,
        verified_amount: verifiedAmount,
        session_total: sessionTotal,
      },
    });
    return { kind: "amount_mismatch" };
  }
  if (String(verifiedCurrency ?? "").toUpperCase() !== "NGN") {
    await markReservationSessionFailed(
      supabase,
      session.id,
      "paystack_currency_mismatch",
    );
    await writeAudit(supabase, {
      user_id: null,
      brand_id: null,
      action: "paystack.reservation_currency_mismatch",
      target_type: "reservation_checkout_session",
      target_id: session.id,
      after: {
        reference,
        verified_currency: String(verifiedCurrency ?? "").toUpperCase(),
      },
    });
    return { kind: "currency_mismatch" };
  }

  // 3. FINALIZE via the EXISTING provider-neutral, idempotent RPC. The Paystack
  //    reference rides the text payment_intent_id slot (idempotency key). We do
  //    NOT fork or modify the RPC.
  const { data: finalized, error: finalizeErr } = await supabase.rpc(
    "pg_finalize_guest_reservation",
    {
      p_session_id: session.id,
      p_payment_intent_id: reference,
    },
  );
  if (finalizeErr) {
    const msg = (finalizeErr as { message?: string } | null)?.message ?? "";
    if (msg.includes("slot_unavailable")) {
      // SLOT TAKEN AFTER CHARGE → refund owed. The #1175 Paystack venue-refund
      // rail is DARK — do NOT auto-refund through it. Mark the session failed +
      // write a MANUAL-refund marker so ops can reconcile, then let the caller
      // ack (money is captured; nothing to mint).
      await markReservationSessionFailed(
        supabase,
        session.id,
        "slot_unavailable_after_charge_refund_due",
      );
      await writeAudit(supabase, {
        user_id: null,
        brand_id: null,
        action: "paystack.reservation_slot_unavailable_refund_due",
        target_type: "reservation_checkout_session",
        target_id: session.id,
        after: {
          reference,
          note:
            "PAID Paystack reservation: slot taken between charge and finalize. MANUAL REFUND REQUIRED (#1175 venue-refund rail is dark).",
          refund_due: true,
        },
      });
      return { kind: "slot_unavailable_refund_due" };
    }
    // Any other RPC error is (potentially) transient — surface it so the caller
    // can retry (webhook inbox) or 409 (confirm). No partial state was written.
    return { kind: "finalize_error", message: msg };
  }

  // The RPC returns TABLE(reservation reservations, session_id uuid); PostgREST
  // surfaces it as a one-row array with a nested `reservation` composite.
  const finalRow = (Array.isArray(finalized) ? finalized[0] : finalized) as
    | { reservation?: Record<string, unknown> | null }
    | null;
  const reservationId = String(finalRow?.reservation?.id ?? "");
  if (!reservationId) {
    return {
      kind: "finalize_error",
      message: "finalize_returned_no_reservation_id",
    };
  }

  // 4. FIRE the #865 two-tier ad-conversion on the minted reservation. Fail-open
  //    (this wrapper never throws — a conversion failure NEVER affects the
  //    finalize/outcome). surface 'web', eventType 'purchase' (the paid/value'd
  //    branch). The caller decides whether to AWAIT it (see @param
  //    awaitConversion): the webhook awaits (reliable background sender); confirm
  //    fire-and-forgets so the guest's fast poll is never blocked on the fan-out.
  const firePromise = (async () => {
    try {
      await fireAdConversion(supabase as never, {
        reservationId,
        surface: "web",
        eventType: "purchase",
        clickId: session.attribution_click_id ?? null,
      });
    } catch (adConvErr) {
      console.warn(
        "[reservationPaystackFinalize] ad-conversion fire threw (non-fatal):",
        adConvErr instanceof Error ? adConvErr.message : String(adConvErr),
      );
    }
  })();
  if (awaitConversion) {
    await firePromise;
  }

  return { kind: "finalized", reservationId };
}

async function markReservationSessionFailed(
  supabase: SupabaseClient,
  sessionId: string,
  reason: string,
): Promise<void> {
  await supabase
    .from("reservation_checkout_sessions")
    .update({
      status: "failed",
      failure_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
}
