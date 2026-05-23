import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  jsonResponse,
  serviceClient,
  sha256Hex,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";
import { qrPayloadToDataUrl } from "../_shared/ticketQrImage.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: ticketCorsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => ({}));
  const checkoutSessionId =
    typeof body.checkoutSessionId === "string" ? body.checkoutSessionId : "";
  const buyerStatusToken =
    typeof body.buyerStatusToken === "string" ? body.buyerStatusToken : "";
  if (!checkoutSessionId) return jsonResponse({ error: "checkout_session_required" }, 400);
  if (!buyerStatusToken) return jsonResponse({ error: "buyer_status_token_required" }, 401);

  const supabase = serviceClient();
  const { data: session, error } = await supabase
    .from("ticket_checkout_sessions")
    .select("id, status, order_id, event_id, total_cents, currency, buyer_status_token_hash")
    .eq("id", checkoutSessionId)
    .maybeSingle();
  if (error) return jsonResponse({ error: "status_lookup_failed", detail: error.message }, 500);
  if (!session) return jsonResponse({ error: "checkout_session_not_found" }, 404);
  if (session.buyer_status_token_hash !== await sha256Hex(buyerStatusToken)) {
    return jsonResponse({ error: "buyer_status_token_invalid" }, 403);
  }

  if (!session.order_id) {
    return jsonResponse({
      checkoutSessionId,
      status: session.status,
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
    .eq("order_id", session.order_id)
    .order("created_at", { ascending: true });
  if (ticketError) {
    return jsonResponse({ error: "ticket_lookup_failed", detail: ticketError.message }, 500);
  }

  // ORCH-0804 — pull Stripe Tax amount from the orders row. Defaults to 0
  // when missing (free order, door sale, brand not registered in buyer
  // jurisdiction, or the race where checkout.session.completed arrived
  // before payment_intent.succeeded finalized the row).
  const { data: orderRow } = await supabase
    .from("orders")
    .select("tax_amount_cents")
    .eq("id", session.order_id)
    .maybeSingle();
  const taxAmountCents = Number(orderRow?.tax_amount_cents ?? 0);

  return jsonResponse({
    checkoutSessionId,
    status: session.status,
    order: {
      orderId: session.order_id,
      eventId: session.event_id,
      paymentStatus: "paid",
      totalCents: session.total_cents,
      currency: String(session.currency ?? "GBP").trim(),
      taxAmountCents,
      tickets: await Promise.all((tickets ?? []).map(async (ticket: Record<string, unknown>) => ({
        ticketId: ticket.id,
        ticketTypeId: ticket.ticket_type_id,
        ticketName: (ticket.ticket_types as { name?: string } | null)?.name ?? "Ticket",
        qrPayload: ticket.qr_code,
        qrImageDataUrl: await qrPayloadToDataUrl(String(ticket.qr_code ?? "")),
        status: ticket.status,
      }))),
      notificationStatus: "queued",
    },
  });
});
