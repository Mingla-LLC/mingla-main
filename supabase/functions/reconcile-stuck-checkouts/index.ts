// ORCH-1388 [checkout-session honest expiry] — the PERMANENT */15-min cron
// safety net for ticket_checkout_sessions (cron job
// `orch_1187_reconcile_stuck_checkouts`, migration 20261116000000; lineage:
// ORCH-0849 one-shot backfill → ORCH-1187 cron promotion → ORCH-1388
// non-succeeded branch). TWO branches, decided by the pure partition in
// ./classify.ts against Stripe truth re-checked per row:
//
//   1. FINALIZE — the PaymentIntent succeeded (webhook-lost paid session):
//      call `biz_ticket_checkout_finalize` with the same params the webhook
//      would have passed, then render the ticket PDF via
//      ticket-confirmation-dispatch in skipNotify mode (ORCH-1188). This
//      branch predates ORCH-1388 and is MOVED, not modified.
//   2. EXPIRE — a genuinely-unpaid in-flight session past its 15-minute
//      `expires_at` (the ORCH-0829-B abandonment line): stamp
//      status='expired' + failed_at + failure_reason='abandoned_past_expiry'
//      via a rowcount-verified compare-and-swap UPDATE. Mid-flight /
//      ambiguous / unverifiable rows (PI processing / requires_action /
//      requires_capture, Paystack `mingla_*` refs, unknown statuses) are
//      SKIPPED fail-safe — never expired.
//
// Stripe posture: DB-ONLY honesty. This function performs READ-ONLY Stripe
// retrieves (PaymentIntent / Checkout Session) and NEVER mutates Stripe
// state — no cancel/update/confirm/create/capture (Seth ruling 4, ORCH-1388).
//
// WHY a DB-only expiry can never strand real money (LOAD-BEARING — do NOT
// "harden" this by adding status guards downstream): a late payment through a
// never-canceled PI still finalizes. The stripe-webhook session lookup
// (_shared/stripeWebhookRouter.ts) matches by stripe_payment_intent_id with
// NO status filter, and `biz_ticket_checkout_finalize` guards only on
// order_id — so an `expired` session receiving payment_intent.succeeded
// still transitions to `paid_completed`. Honest expiry and late-payment
// safety coexist by design (SPEC ORCH-1388 §1 keystone).
//
// Idempotent + capped: the sweep reads at most SWEEP_BATCH_LIMIT oldest-first
// rows per run (the */15 cadence drains any backlog); the finalize RPC skips
// already-completed sessions; the expiry CAS re-checks status + order_id +
// expires_at server-side. Repeated runs are safe.
//
// Auth: service-role only (the cron sends the service-role bearer). Invoke:
//   curl -X POST <fn-url> -H "Authorization: Bearer <SERVICE_ROLE_KEY>"

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import { qrTokenPepper } from "../_shared/ticketCheckout.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0?target=denonext";
import { classify, classifyRef } from "./classify.ts";
import type { StripeTruth } from "./classify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Capped batch (SPEC §4.2a): oldest-first so a backlog drains deterministically
// across successive */15 runs. Current stuck population is 5.
const SWEEP_BATCH_LIMIT = 50;

/** Minimal structural shape of the retrieved PaymentIntent fields we read. */
interface PaymentIntentLike {
  status: string;
  payment_method_types?: unknown;
}

/** Minimal structural shape of the retrieved Checkout Session fields we read. */
interface CheckoutSessionLike {
  payment_intent?: string | { id?: string } | null;
  payment_status?: string;
}

type StripeClient = ReturnType<typeof stripeTicketCheckout>;

/**
 * READ-ONLY PaymentIntent retrieve. Direct charges live on the CONNECTED
 * account, so the `Stripe-Account` header is REQUIRED when stripe_account_id
 * is set — a plain platform retrieve 404s on these PIs (investigation F-5).
 */
async function retrievePaymentIntentReadOnly(
  stripe: StripeClient,
  piId: string,
  stripeAccountId: string | null,
): Promise<PaymentIntentLike> {
  // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (no side effects, no state mutation); idempotency keys protect mutating ops (create/update/capture), not GETs. The sweep only reads PI status to drive the local finalize/expire decision.
  const pi = stripeAccountId
    // @ts-ignore — Stripe SDK signature
    ? await stripe.paymentIntents.retrieve(piId, {
      stripeAccount: stripeAccountId,
    }) // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve
    // @ts-ignore
    : await stripe.paymentIntents.retrieve(piId); // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve
  return pi as unknown as PaymentIntentLike;
}

/**
 * READ-ONLY Checkout Session retrieve (web arm; same Stripe-Account header
 * rule as the PI path).
 */
async function retrieveCheckoutSessionReadOnly(
  stripe: StripeClient,
  csId: string,
  stripeAccountId: string | null,
): Promise<CheckoutSessionLike> {
  // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (Checkout Session GET; no mutation)
  const cs = stripeAccountId
    // @ts-ignore — Stripe SDK signature
    ? await stripe.checkout.sessions.retrieve(csId, {
      stripeAccount: stripeAccountId,
    }) // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve
    // @ts-ignore
    : await stripe.checkout.sessions.retrieve(csId); // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve
  return cs as unknown as CheckoutSessionLike;
}

serve(async (req) => {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.includes(SERVICE_ROLE_KEY)) {
    return new Response("unauthorized", { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stripe = stripeTicketCheckout();
  const pepper = qrTokenPepper();

  // Captured ONCE per run: drives both the classify() cutoff test and the CAS
  // write's server-side `.lt("expires_at", nowIso)` re-check.
  const nowIso = new Date().toISOString();

  // ORCH-1388 widened select — the WHOLE in-flight strand family (ruling 3),
  // not just processing_payment, and no PI-non-null filter (no-ref rows are in
  // scope now: pending_free / pre-mint requires_payment can strand too).
  const { data: sessions, error: listError } = await supabase
    .from("ticket_checkout_sessions")
    .select(
      "id, status, expires_at, order_id, stripe_payment_intent_id, stripe_checkout_session_id, stripe_account_id, brand_id, buyer_email",
    )
    .in("status", [
      "processing_payment",
      "awaiting_web_redirect",
      "requires_payment",
      "pending_free",
    ])
    .order("created_at", { ascending: true })
    .limit(SWEEP_BATCH_LIMIT);

  if (listError) {
    return new Response(JSON.stringify({ error: listError.message }), {
      status: 500,
    });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const s of sessions ?? []) {
    const sessionId = s.id as string;
    const snapshotStatus = s.status as string;
    const expiresAt = s.expires_at as string | null;
    const piRef = s.stripe_payment_intent_id as string | null;
    const csId = s.stripe_checkout_session_id as string | null;
    const stripeAccountId = s.stripe_account_id as string | null;
    try {
      const refClass = classifyRef({
        stripePaymentIntentId: piRef,
        stripeCheckoutSessionId: csId,
      });

      // ── Read-only Stripe truth per ref class (classify.ts stays pure). ────
      // PAYSTACK (`mingla_*` in the PI column) and NO_REF rows perform NO
      // Stripe I/O — a Paystack reference is not a Stripe id and must never
      // reach a retrieve; a no-ref row has no payment object to check.
      let truth: StripeTruth = {};
      let pi: PaymentIntentLike | null = null;
      let piId: string | null = null;

      if (refClass === "STRIPE_PI") {
        piId = piRef as string; // non-null + `pi_`-prefixed by classification
        const retrievedPi = await retrievePaymentIntentReadOnly(
          stripe,
          piId,
          stripeAccountId,
        );
        pi = retrievedPi;
        truth = { piStatus: retrievedPi.status };
      } else if (refClass === "STRIPE_CS") {
        // Web arm: PI column is NULL until payment; the Checkout Session is
        // the truth source (same Stripe-Account header rule).
        const cs = await retrieveCheckoutSessionReadOnly(
          stripe,
          csId as string,
          stripeAccountId,
        );
        const rawCsPi = cs.payment_intent;
        const resolvedPiId = typeof rawCsPi === "string"
          ? rawCsPi
          : rawCsPi?.id ?? null;
        if (
          resolvedPiId !== null && resolvedPiId !== undefined &&
          resolvedPiId !== ""
        ) {
          // cs.payment_intent resolved → retrieve THAT PI and fall through to
          // the PI partition (SPEC §4.2b CS row 1).
          piId = resolvedPiId;
          const retrievedPi = await retrievePaymentIntentReadOnly(
            stripe,
            piId,
            stripeAccountId,
          );
          pi = retrievedPi;
          truth = { piStatus: retrievedPi.status };
        } else {
          truth = { csPaymentStatus: cs.payment_status };
        }
      }

      const decision = classify({ refClass, expiresAt, truth, nowIso });

      if (decision.action === "finalize") {
        if (pi === null || piId === null) {
          // Structurally unreachable (finalize only follows a retrieved PI);
          // fail-safe guard for type-narrowing — never finalize blind.
          results.push({ sessionId, csId, skip: "finalize_without_pi" });
          continue;
        }

        // ── MOVED (not modified) — the pre-ORCH-1388 succeeded→finalize
        // block: finalize RPC + ORCH-1188 skipNotify PDF backfill. ──────────
        const charges =
          (pi as unknown as { charges?: { data?: Array<{ id: string }> } })
            .charges;
        const chargeId = charges?.data?.[0]?.id ??
          (pi as unknown as { latest_charge?: string }).latest_charge ?? null;
        const pmTypes = Array.isArray(pi.payment_method_types)
          ? pi.payment_method_types
          : [];
        const methodType = (pmTypes[0] as string | undefined) ?? "card";

        // ORCH-0924 ROLLBACK of ORCH-0921 — see ticket-checkout-confirm/index.ts
        // for the full rationale. Reverted to pre-ORCH-0921 5-param shape to
        // unblock production. Real fix is ORCH-0925 [ticket-checkout-create
        // must attach Stripe Customer to plan PIs explicitly].
        // orch-strict-grep-allow finalize-no-plan-root — ORCH-0924 rollback of ORCH-0921; real fix is ORCH-0925
        const { data: finalized, error: finalizeError } = await supabase.rpc(
          "biz_ticket_checkout_finalize",
          {
            p_checkout_session_id: sessionId,
            p_stripe_payment_intent_id: piId,
            p_stripe_charge_id: chargeId,
            p_stripe_payment_method_type: methodType,
            p_qr_token_pepper: pepper,
          },
        );

        if (finalizeError) {
          results.push({ sessionId, piId, error: finalizeError.message });
          continue;
        }

        const orderId =
          typeof (finalized as Record<string, unknown> | null)?.orderId ===
              "string"
            ? String((finalized as Record<string, unknown>).orderId)
            : null;

        // ORCH-1188 FIX 4a: render + store the ticket PDF for the recovered order
        // so the consumer ticket renders (orders.ticket_pdf_path was NULL on
        // reconcile-finalized orders → "render failed" on first fetch). We invoke
        // ticket-confirmation-dispatch in `skipNotify` mode: it renders + uploads
        // the PDF and persists ticket_pdf_path, but does NOT email/SMS the buyer
        // (these are historical/test sessions — no notification spam). The webhook
        // path is unchanged.
        let pdfStored: boolean | null = null;
        let pdfError: string | null = null;
        if (orderId) {
          try {
            const dispatchResp = await supabase.functions.invoke(
              "ticket-confirmation-dispatch",
              { body: { orderId, skipNotify: true } },
            );
            if (dispatchResp.error) {
              pdfError = dispatchResp.error.message ??
                String(dispatchResp.error);
            } else {
              const d = (dispatchResp.data ?? {}) as Record<string, unknown>;
              pdfStored = d.pdfStored === true;
              const re = d.renderError as
                | { code?: string; message?: string }
                | null
                | undefined;
              if (re) pdfError = re.code ?? re.message ?? "render_error";
            }
          } catch (dispatchErr) {
            pdfError = dispatchErr instanceof Error
              ? dispatchErr.message
              : String(dispatchErr);
          }
        }

        results.push({
          sessionId,
          piId,
          orderId,
          chargeId,
          methodType,
          status: "finalized",
          pdfStored,
          pdfError,
        });
        // ── end MOVED finalize block ─────────────────────────────────────────
      } else if (decision.action === "expire") {
        // ORCH-1388 EXPIRE — guarded compare-and-swap, rowcount-verified
        // (I-PROPOSED-I). Every guard re-checks server-side at write time:
        //   .eq("status", snapshotStatus) — CAS on the status read THIS run;
        //     a concurrent finalize/create transition makes it 0-row.
        //   .is("order_id", null) — a finalized row can NEVER be expired,
        //     even if status raced.
        //   .lt("expires_at", nowIso) — the cutoff re-checked at write time;
        //     a NULL expires_at never matches — fail-safe.
        const { data: expiredRows, error: expireError } = await supabase
          .from("ticket_checkout_sessions")
          .update({
            status: "expired",
            failed_at: nowIso,
            failure_reason: "abandoned_past_expiry",
            updated_at: nowIso,
          })
          .eq("id", sessionId)
          .eq("status", snapshotStatus)
          .is("order_id", null)
          .lt("expires_at", nowIso)
          .select("id");

        if (expireError) {
          results.push({ sessionId, piId, csId, error: expireError.message });
        } else if ((expiredRows ?? []).length === 0) {
          // A concurrent transition won the race — NOT an error, no second
          // write, the loop continues (SC-11).
          results.push({ sessionId, piId, csId, skip: "raced" });
        } else {
          results.push({ sessionId, piId, csId, status: "expired" });
        }
      } else {
        if (decision.reason === "cs_paid_no_pi") {
          // Error-grade visibility (SPEC §4.2b CS partition): Stripe says paid
          // but no PI is resolvable — never expire; a human must look.
          console.error(
            "[reconcile-stuck-checkouts] cs_paid_no_pi — paid Checkout Session with no resolvable PaymentIntent; needs human review",
            { sessionId, csId },
          );
        }
        results.push({
          sessionId,
          piId: piId ?? piRef,
          csId,
          skip: decision.reason,
        });
      }
    } catch (err) {
      results.push({
        sessionId,
        piId: piRef,
        csId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary = {
    reconciled: results.filter((r) => r.status === "finalized").length,
    expired: results.filter((r) => r.status === "expired").length,
    skipped: results.filter((r) => r.skip).length,
    errors: results.filter((r) => r.error).length,
  };
  // One greppable summary line per run (SC-12).
  console.log("[reconcile-stuck-checkouts] run summary", summary);

  return new Response(
    JSON.stringify(
      {
        reconciled: summary.reconciled,
        expired: summary.expired,
        skipped: summary.skipped,
        errors: summary.errors,
        results,
      },
      null,
      2,
    ),
    { headers: { "content-type": "application/json" } },
  );
});
