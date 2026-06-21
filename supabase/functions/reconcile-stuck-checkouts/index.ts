// ORCH-0849 (round 5, 2026-05-16) — one-shot reconciliation for stuck
// ticket_checkout_sessions whose PaymentIntent succeeded but never
// reached our backend because the Connect webhook wasn't subscribed to
// payment_intent.* events. Webhook subscription is now fixed; this
// function back-fills the historical 17 stuck sessions.
//
// Replicates the exact logic of stripe-webhook's
// `handleTicketCheckoutPaymentIntent` for `payment_intent.succeeded`:
//   1. Fetch PI from Stripe to confirm `status=succeeded` + read charge.
//   2. Call `biz_ticket_checkout_finalize` with same params the webhook
//      would have passed.
//   3. Dispatch ticket-confirmation if an orderId is returned.
//
// Auth: service-role only. Invoke via:
//   curl -X POST <fn-url> -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
//
// Safe to re-run: `biz_ticket_checkout_finalize` is idempotent — sessions
// already at `completed` are skipped by the RPC.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import { qrTokenPepper } from "../_shared/ticketCheckout.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0?target=denonext";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

  const { data: sessions, error: listError } = await supabase
    .from("ticket_checkout_sessions")
    .select(
      "id, stripe_payment_intent_id, stripe_account_id, brand_id, buyer_email",
    )
    .eq("status", "processing_payment")
    .not("stripe_payment_intent_id", "is", null);

  if (listError) {
    return new Response(JSON.stringify({ error: listError.message }), {
      status: 500,
    });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const s of sessions ?? []) {
    const sessionId = s.id as string;
    const piId = s.stripe_payment_intent_id as string;
    const stripeAccountId = s.stripe_account_id as string | null;
    try {
      // Fetch PI from the connected account (direct charges).
      // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (no side effects, no state mutation); idempotency keys protect mutating ops (create/update/capture), not GETs. This is a one-shot historical reconcile that just reads PI status to drive the local finalize RPC.
      const pi = stripeAccountId
        // @ts-ignore — Stripe SDK signature
        ? await stripe.paymentIntents.retrieve(piId, {
          stripeAccount: stripeAccountId,
        }) // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve
        // @ts-ignore
        : await stripe.paymentIntents.retrieve(piId); // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve

      if (pi.status !== "succeeded") {
        results.push({ sessionId, piId, skip: `pi_status_${pi.status}` });
        continue;
      }

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
            pdfError = dispatchResp.error.message ?? String(dispatchResp.error);
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
    } catch (err) {
      results.push({
        sessionId,
        piId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return new Response(
    JSON.stringify(
      {
        reconciled: results.filter((r) => r.status === "finalized").length,
        skipped: results.filter((r) => r.skip).length,
        errors: results.filter((r) => r.error).length,
        results,
      },
      null,
      2,
    ),
    { headers: { "content-type": "application/json" } },
  );
});
