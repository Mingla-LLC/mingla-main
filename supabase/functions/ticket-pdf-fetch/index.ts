// ORCH-0842 — Ticket PDF fetch endpoint.
//
// Returns a 60-second signed URL to the buyer's order PDF in the private
// `ticket-pdfs` bucket. Owner-gated: only auth.uid() == orders.buyer_user_id
// may fetch the URL for that order's PDF.
//
// Invariants enforced here:
//   I-PROPOSED-AK TICKET_PDF_FETCHABLE_BY_OWNER — buyer_user_id check
//     against auth.uid() BEFORE any storage operation.
//   I-PROPOSED-AL TICKET_PDF_SINGLE_SOURCE_OF_TRUTH — lazy backfill calls
//     buildTicketPdf from _shared/ticketPdf.ts. No parallel renderer.
//   I-PROPOSED-AG TICKET_PDF_PRIVACY — preserved by reusing the shared
//     renderer which redacts qr_token_hash, payment ids, and phone numbers.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import { buildTicketPdf } from "../_shared/ticketPdf.ts";

const MINGLA_LOGO_URL = Deno.env.get("MINGLA_LOGO_URL") ?? null;
const SIGNED_URL_TTL_SECONDS = 60;
const STORAGE_BUCKET = "ticket-pdfs";

function shortId(id: string): string {
  return String(id).slice(0, 8);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

interface OrderRow {
  id: string;
  buyer_user_id: string | null;
  payment_status: string | null;
  ticket_pdf_path: string | null;
  event_id: string;
  buyer_name: string | null;
}

interface EventRow {
  id: string;
  title: string | null;
  timezone: string | null;
  location_text: string | null;
  brands: { id: string; name: string | null } | null;
}

interface TicketRow {
  id: string;
  qr_code: string;
  ticket_types: { name: string | null } | null;
}

interface EventDateRow {
  start_at: string | null;
  timezone: string | null;
}

/**
 * Lazy backfill: re-render the PDF from canonical inputs and upload it to
 * storage. Used for pre-cutover paid orders whose ticket_pdf_path is null.
 * Returns the storage path on success, throws on render/upload failure.
 */
async function lazyBackfillPdf(
  supabase: ReturnType<typeof serviceClient>,
  orderId: string,
  eventId: string,
  buyerName: string | null,
): Promise<string> {
  // Reload the inputs ticketPdf.ts expects, mirroring the assembly inside
  // ticket-confirmation-dispatch's buildRenderContext.
  const { data: eventRaw, error: eventErr } = await supabase
    .from("events")
    .select(`
      id, title, timezone, location_text,
      brands!inner ( id, name )
    `)
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr || !eventRaw) {
    throw new Error(
      `lazy_backfill_event_lookup_failed:${eventErr?.message ?? "missing"}`,
    );
  }
  const event = eventRaw as unknown as EventRow;

  const { data: ticketRows, error: ticketsErr } = await supabase
    .from("tickets")
    .select("id, qr_code, ticket_types!inner ( name )")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (ticketsErr || !ticketRows || ticketRows.length === 0) {
    throw new Error(
      `lazy_backfill_tickets_lookup_failed:${ticketsErr?.message ?? "empty"}`,
    );
  }
  const tickets = ticketRows as unknown as TicketRow[];

  const { data: masterDate } = await supabase
    .from("event_dates")
    .select("start_at, timezone")
    .eq("event_id", event.id)
    .eq("is_master", true)
    .maybeSingle();
  const md = (masterDate ?? null) as EventDateRow | null;

  const pdf = await buildTicketPdf({
    event: {
      title: event.title ?? "your event",
      startAtIso: md?.start_at ?? null,
      timezone: (md?.timezone && md.timezone.length > 0
        ? md.timezone
        : event.timezone) ?? "UTC",
      locationText: event.location_text ?? null,
      brandName: event.brands?.name ?? "your host",
    },
    order: { shortId: shortId(orderId) },
    tickets: tickets.map((t) => ({
      ticketId: t.id,
      ticketName: t.ticket_types?.name ?? "Ticket",
      qrPayload: t.qr_code,
    })),
    attendeeNameHint: buyerName,
    logoUrl: MINGLA_LOGO_URL ?? undefined,
  });

  const pdfBytes = Uint8Array.from(
    atob(pdf.contentBase64),
    (c) => c.charCodeAt(0),
  );
  const pdfPath = `tickets/${orderId}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(pdfPath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadError) {
    throw new Error(`lazy_backfill_upload_failed:${uploadError.message}`);
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      ticket_pdf_path: pdfPath,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);
  if (updateError) {
    // The object IS in storage; the pointer write failed. Still return the
    // path so the caller gets a working signed URL — next fetch will retry
    // the pointer update or hit the same path.
    console.warn(
      `[ticket-pdf-fetch] lazy_backfill pointer update failed order=${orderId}: ${updateError.message}`,
    );
  }
  return pdfPath;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  // I-PROPOSED-AK: extract auth.uid() from the caller JWT BEFORE any
  // storage operation. Reject anonymous and service-role callers — this
  // endpoint exists exclusively for the order's buyer.
  const callerUserId = await userIdFromAuthHeader(req);
  if (!callerUserId) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const orderId = body?.orderId;
  if (!isUuid(orderId)) {
    return jsonResponse(
      { error: "bad_request", field: "orderId" },
      400,
    );
  }

  const supabase = serviceClient();

  const { data: orderRaw, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, buyer_user_id, payment_status, ticket_pdf_path, event_id, buyer_name",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (orderError || !orderRaw) {
    return jsonResponse({ error: "not_found" }, 404);
  }
  const order = orderRaw as OrderRow;

  // I-PROPOSED-AK: enforce buyer_user_id == auth.uid(). The comparison is
  // intentionally explicit; do NOT collapse into the SELECT WHERE clause
  // because we want the 403 vs 404 distinction.
  if (order.buyer_user_id !== callerUserId) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const status = order.payment_status ?? "";
  if (status === "pending" || status === "failed") {
    return jsonResponse(
      { error: "not_paid", paymentStatus: status },
      409,
    );
  }
  if (
    status === "refunded" ||
    status === "cancelled" ||
    status === "partial_refund"
  ) {
    return jsonResponse(
      { error: "gone", paymentStatus: status },
      410,
    );
  }

  let pdfPath = order.ticket_pdf_path;

  // Lazy backfill for pre-cutover orders OR for orders whose dispatch
  // upload step failed.
  if (!pdfPath) {
    try {
      pdfPath = await lazyBackfillPdf(
        supabase,
        order.id,
        order.event_id,
        order.buyer_name,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[ticket-pdf-fetch] lazy_backfill_failed order=${order.id}: ${message}`,
      );
      return jsonResponse(
        { error: "render_failed", detail: message },
        500,
      );
    }
  }

  const { data: signedData, error: signError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(pdfPath, SIGNED_URL_TTL_SECONDS);
  if (signError || !signedData?.signedUrl) {
    // Object missing despite a non-null path → defensively backfill once
    // more.
    try {
      pdfPath = await lazyBackfillPdf(
        supabase,
        order.id,
        order.event_id,
        order.buyer_name,
      );
      const { data: retryData, error: retryError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(pdfPath, SIGNED_URL_TTL_SECONDS);
      if (retryError || !retryData?.signedUrl) {
        return jsonResponse(
          {
            error: "render_failed",
            detail: retryError?.message ?? "sign_failed_after_backfill",
          },
          500,
        );
      }
      return jsonResponse({
        signedUrl: retryData.signedUrl,
        expiresAt: new Date(
          Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
        ).toISOString(),
        filename: `tickets-${shortId(order.id)}.pdf`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[ticket-pdf-fetch] sign+backfill_failed order=${order.id}: ${message}`,
      );
      return jsonResponse(
        { error: "render_failed", detail: message },
        500,
      );
    }
  }

  return jsonResponse({
    signedUrl: signedData.signedUrl,
    expiresAt: new Date(
      Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
    ).toISOString(),
    filename: `tickets-${shortId(order.id)}.pdf`,
  });
});
