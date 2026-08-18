import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { logError, wrapEdgeHandler } from "../_shared/structuredLog.ts";
import {
  jsonResponse,
  serviceClient,
  sha256Hex,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";
import { attachQrImageDataUrls } from "../_shared/ticketQrImage.ts";
import {
  checkoutUnavailableResponse,
  ticketCheckoutPreflight,
} from "../_shared/checkoutSaleTruth.ts";
// issue #2198 [paystack-return-verify] — the NATIVE half of the same defect.
// `nativeCheckoutFlow` polls THIS function ~17 times over ~25s after the
// in-app browser returns from Paystack, then gives up with "We couldn't
// confirm your payment yet." On bank transfer the webhook took 4m 06s, so the
// native buyer was guaranteed that message on a fully paid charge. Verify here
// too; the resolver is a no-op on every non-Paystack session.
import { paystackVerifyTransaction } from "../_shared/paystack.ts";
import { resolvePaystackTicketReturn } from "../_shared/paystackTicketReturnVerify.ts";

serve(wrapEdgeHandler("ticket-checkout-status", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const body = await req.json().catch(() => ({}));
  const checkoutSessionId = typeof body.checkoutSessionId === "string"
    ? body.checkoutSessionId
    : "";
  const buyerStatusToken = typeof body.buyerStatusToken === "string"
    ? body.buyerStatusToken
    : "";
  if (!checkoutSessionId) {
    return jsonResponse({ error: "checkout_session_required" }, 400);
  }
  if (!buyerStatusToken) {
    return jsonResponse({ error: "buyer_status_token_required" }, 401);
  }

  const supabase = serviceClient();
  const { data: session, error } = await supabase
    .from("ticket_checkout_sessions")
    .select(
      "id, status, order_id, event_id, total_cents, currency, buyer_status_token_hash, revoked_at, reversal_state, stripe_payment_intent_id",
    )
    .eq("id", checkoutSessionId)
    .maybeSingle();
  if (error) {
    logError("ticket-checkout-status session lookup failed", error, {
      fn: "ticket-checkout-status",
      checkoutSessionId,
    });
    return jsonResponse({
      error: "status_lookup_failed",
      detail: error.message,
    }, 500);
  }
  if (!session) {
    return jsonResponse({ error: "checkout_session_not_found" }, 404);
  }
  if (session.buyer_status_token_hash !== await sha256Hex(buyerStatusToken)) {
    return jsonResponse({ error: "buyer_status_token_invalid" }, 403);
  }

  // #1930: updated native clients ask for this immediately before presenting
  // PaymentSheet. It narrows stale-secret exposure but is not represented as a
  // server-authorized Stripe confirm; finalize/reversal remains the race owner.
  if (body.preflight === true) {
    const outcome = await ticketCheckoutPreflight(supabase, {
      checkoutSessionId,
      buyerStatusTokenHash: String(session.buyer_status_token_hash),
    });
    if (outcome !== "present_allowed") {
      return jsonResponse(
        outcome === "forbidden"
          ? { error: "buyer_status_token_invalid" }
          : checkoutUnavailableResponse(),
        outcome === "forbidden" ? 403 : 409,
      );
    }
    return jsonResponse({ checkoutSessionId, status: "present_allowed" });
  }

  if (
    session.revoked_at != null ||
    session.reversal_state === "paid_reversal_pending" ||
    session.reversal_state === "paid_reversed"
  ) {
    return jsonResponse(checkoutUnavailableResponse(), 409);
  }

  // issue #2198 — ask Paystack before answering "no order yet". Authoritative
  // verification; the webhook stays a backstop and both remain idempotent
  // against each other (one shared finalize RPC). `not_paystack` short-circuits
  // before any network I/O, so the Stripe/free rails are unchanged.
  let orderId = session.order_id as string | null;
  let sessionStatus = session.status as string;
  if (!orderId) {
    const paystackReturn = await resolvePaystackTicketReturn(
      supabase,
      {
        id: String(session.id),
        stripe_payment_intent_id: session.stripe_payment_intent_id,
      },
      paystackVerifyTransaction,
    );
    if (paystackReturn.kind === "finalized") {
      orderId = paystackReturn.orderId;
      sessionStatus = "paid";
    } else if (paystackReturn.kind === "failed") {
      // Terminal. The bounded token lets the native/web caller say what
      // actually happened instead of spinning to the end of its poll budget.
      return jsonResponse({
        checkoutSessionId,
        status: "failed",
        order: null,
        error: paystackReturn.code,
      });
    }
  }

  if (!orderId) {
    return jsonResponse({
      checkoutSessionId,
      status: sessionStatus,
      order: null,
    });
  }

  const { data: tickets, error: ticketError } = await supabase
    .from("tickets")
    .select(`
      id,
      ticket_type_id,
      qr_code,
      status,
      ticket_types(name)
    `)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (ticketError) {
    logError("ticket-checkout-status ticket lookup failed", ticketError, {
      fn: "ticket-checkout-status",
      orderId,
    });
    return jsonResponse({
      error: "ticket_lookup_failed",
      detail: ticketError.message,
    }, 500);
  }

  // ORCH-0804 — pull Stripe Tax amount from the orders row. Defaults to 0
  // when missing (free order, door sale, brand not registered in buyer
  // jurisdiction, or the race where checkout.session.completed arrived
  // before payment_intent.succeeded finalized the row).
  const { data: orderRow } = await supabase
    .from("orders")
    .select("tax_amount_cents")
    .eq("id", orderId)
    .maybeSingle();
  const taxAmountCents = Number(orderRow?.tax_amount_cents ?? 0);

  return jsonResponse({
    checkoutSessionId,
    status: sessionStatus,
    order: {
      orderId,
      eventId: session.event_id,
      paymentStatus: "paid",
      totalCents: session.total_cents,
      currency: String(session.currency ?? "GBP").trim(),
      taxAmountCents,
      // issue #2216 — ONE owner for "ticket → ticket + rendered QR" across
      // create/confirm/status (`_shared/ticketQrImage.ts`). A single ticket
      // that fails to render degrades to the carousel placeholder AND emits a
      // structured error line, instead of silently answering with a blank.
      tickets: await attachQrImageDataUrls(
        (tickets ?? []).map((ticket: Record<string, unknown>) => ({
          ticketId: String(ticket.id ?? ""),
          ticketTypeId: ticket.ticket_type_id,
          ticketName: (ticket.ticket_types as { name?: string } | null)?.name ??
            "Ticket",
          qrPayload: String(ticket.qr_code ?? ""),
          status: ticket.status,
        })),
      ),
      notificationStatus: "queued",
    },
  });
}, {
  onError: (_err, requestId) =>
    jsonResponse({ error: "internal_error", requestId }, 500),
}));
