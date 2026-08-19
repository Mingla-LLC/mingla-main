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
// ISSUE-1001 — canonical logo resolution. Was `?? null` → text-only PDF
// wordmark when the secret was unset; PDFs now always embed the logo
// (ticketPdf.ts still degrades to text if the fetch itself fails).
import { minglaLogoUrl } from "../_shared/brandAssets.ts";
// ── issue #2347 ───────────────────────────────────────────────────────────
// THE SAME resolver `ticket-confirmation-dispatch` uses (#2162), not a second
// copy of it. This endpoint read `is_master` and therefore handed a multi-day
// guest the wrong day's PDF — and then cached it.
import {
  resolveChosenOccurrence,
  ticketDaysForOrder,
} from "../_shared/chosenOccurrence.ts";
import {
  isDayAwareTicketPdfPath,
  shouldRerenderCachedTicketPdf,
  ticketPdfStoragePath,
} from "../_shared/ticketPdfPath.ts";

const MINGLA_LOGO_URL = minglaLogoUrl();
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
  // issue #2347 — the buyer's BOOKED occurrence. Rung 2 of the chosen-day
  // ladder (#2135 single-select / #2160 anchor); NULL is legitimate.
  event_date_id: string | null;
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
  // ORCH-0877 — end-instant for cross-midnight aware PDF date line.
  end_at: string | null;
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
  // issue #2347 — the #2135 single-select fallback in the chosen-day ladder.
  orderEventDateId: string | null,
): Promise<string> {
  // Reload the inputs ticketPdf.ts expects, mirroring the assembly inside
  // ticket-confirmation-dispatch's buildRenderContext.
  //
  // ORCH-1188 FIX 4b: use LEFT joins on brands + ticket_types. Trip/experience
  // orders can have a ticket whose ticket_type row is filtered/absent, or a
  // brand row that an !inner join would DROP — which made the whole event/ticket
  // lookup return empty and surfaced as a generic "render failed". Left joins +
  // safe fallbacks let the PDF render for every offering type on first fetch.
  const { data: eventRaw, error: eventErr } = await supabase
    .from("events")
    .select(`
      id, title, timezone, location_text,
      brands!left ( id, name )
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
    .select("id, qr_code, ticket_types!left ( name )")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (ticketsErr) {
    throw new Error(
      `lazy_backfill_tickets_lookup_failed:${ticketsErr.message}`,
    );
  }
  if (!ticketRows || ticketRows.length === 0) {
    // No tickets is a genuine data problem (a paid order must have tickets) —
    // surface it distinctly so the caller's `detail` is actionable.
    throw new Error("lazy_backfill_tickets_lookup_failed:no_tickets_for_order");
  }
  const tickets = ticketRows as unknown as TicketRow[];

  // ══ issue #2347 — THE PDF MUST NAME THE DAY THE GUEST ACTUALLY BOUGHT ═══
  // This block read `is_master` alone — the EARLIEST occurrence — so every
  // guest who bought day 2 of a multi-day event downloaded a PDF dated day 1,
  // and the upload below made that the permanent artifact. `#2162` fixed the
  // identical defect in `ticket-confirmation-dispatch`; this endpoint received
  // none of it.
  //
  // Precedence is #2162's, unchanged, because it is the SAME function:
  //   chosen (ticket days -> order anchor)  ??  master.
  // `masterDate ?? chosenDate` would compile, render a date, and re-ship the
  // defect verbatim.
  const { data: masterDate } = await supabase
    .from("event_dates")
    .select("start_at, end_at, timezone")
    .eq("event_id", event.id)
    .eq("is_master", true)
    .maybeSingle();
  const chosenDate = await resolveChosenOccurrence(
    supabase,
    orderId,
    event.id,
    orderEventDateId,
    "[ticket-pdf-fetch]",
  );
  const md = (chosenDate ?? masterDate ?? null) as EventDateRow | null;

  const pdf = await buildTicketPdf({
    event: {
      title: event.title ?? "your event",
      startAtIso: md?.start_at ?? null,
      // ORCH-0877 — propagate master end_at into the PDF date line so
      // cross-midnight events render correctly on the downloaded ticket.
      endAtIso: md?.end_at ?? null,
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
  // issue #2347 — versioned so a cached object from the is_master era is
  // distinguishable from a day-aware one. See `_shared/ticketPdfPath.ts`.
  const pdfPath = ticketPdfStoragePath(orderId);
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
      "id, buyer_user_id, payment_status, ticket_pdf_path, event_id, buyer_name, event_date_id",
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

  // ══ issue #2347 — INVALIDATE A PDF THAT MAY NAME THE WRONG DAY ══════════
  // The wrong-day PDF this endpoint used to render was written back to
  // `orders.ticket_pdf_path`, so it is the permanent artifact and WILL NOT
  // regenerate on its own. It is repaired here rather than by a one-off
  // UPDATE, deliberately: an UPDATE run even a minute before this function is
  // deployed is undone by the very next download, whereas this ships and
  // repairs atomically.
  //
  // NARROW ON PURPOSE. A re-render is forced only when BOTH hold:
  //   * the cached path predates day-aware rendering (no version token), AND
  //   * the order is actually DAY-SCOPED — its passes carry
  //     `ticket_event_dates` rows, i.e. it is exactly the population that
  //     could have been rendered against the wrong day.
  // A single-date, legacy, trip, experience or RSVP order has ZERO day rows,
  // so it takes neither branch: its object and its pointer are untouched and
  // it never re-renders. That is the "single-day behaviour is unchanged"
  // guarantee, enforced here rather than asserted.
  // The path-shape test runs FIRST purely to avoid a ticket-ledger read on
  // every download once an order has been re-rendered; it is a short-circuit,
  // not the decision. `shouldRerenderCachedTicketPdf` below is the authority
  // and re-checks it.
  if (pdfPath !== null && !isDayAwareTicketPdfPath(pdfPath)) {
    const days = await ticketDaysForOrder(
      supabase,
      order.id,
      "[ticket-pdf-fetch]",
    );
    if (
      shouldRerenderCachedTicketPdf({
        cachedPath: pdfPath,
        isDayScoped: days !== null && days.length > 0,
      })
    ) {
      console.log(
        `[ticket-pdf-fetch] issue-2347 stale day-scoped pdf, re-rendering order=${order.id}`,
      );
      // Fall into the backfill below, which renders day-aware and repoints.
      pdfPath = null;
    }
  }

  // Lazy backfill for pre-cutover orders OR for orders whose dispatch
  // upload step failed.
  if (!pdfPath) {
    try {
      pdfPath = await lazyBackfillPdf(
        supabase,
        order.id,
        order.event_id,
        order.buyer_name,
        order.event_date_id ?? null,
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
        order.event_date_id ?? null,
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
