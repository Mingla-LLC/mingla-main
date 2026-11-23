// #4490 spec 08 O3 — venue-floor-pdf: Mingla makes a floor PDF (a kitchen or
// bar ticket, a Till receipt, a test ticket) and the device prints it with its
// own viewer. Printing always takes a tap: there is no automatic, background or
// Bluetooth printing.
//
// POST { kind: "kitchen_ticket" | "receipt" | "test_ticket" | "day_close",
//        venueId, orderId?, station?, paymentId? }
//   -> 200 { signedUrl, expiresAt, filename } | { code } with a status.
//
// verify_jwt is false at the gateway (function-policy.json) so the 401 body is
// ours; a Bearer is REQUIRED here and the verified user is passed to the
// service-only issue_4490_floor_pdf_source, which checks the venue gate and the
// person's rights at that venue BEFORE anything is read for printing:
//   kitchen_ticket / test_ticket -> stations on + issue_4490_can_kitchen
//   receipt                      -> the Till on + issue_4490_can_sell, paid payment
//   day_close                    -> O5; refused with floor_pdf_kind_not_ready
// Objects go to the PRIVATE venue-floor-pdfs bucket at <brand>/<venue>/<uuid>.pdf
// (listed in venue_floor_pdfs first, so venue-offer-sweep deletes every one
// after 24 hours) and are reached only by a 60-second signed URL. A kitchen
// ticket PDF counts one print (issue_4490_station_mark_printed).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { wrapEdgeHandler } from "../_shared/structuredLog.ts";
import { ticketCorsHeaders } from "../_shared/ticketCheckout.ts";
import {
  buildKitchenTicketPdf,
  buildTillReceiptPdf,
  floorPaperFrom,
  type KitchenTicketPdfInput,
  type TicketPdfResult,
  type TillReceiptPdfInput,
} from "../_shared/ticketPdf.ts";
import { deliverPdf, type PdfStorage } from "../_shared/pdfDelivery.ts";
import { tillReceiptMethodLabel } from "../_shared/email/tillReceiptEmail.ts";

export const FLOOR_PDF_BUCKET = "venue-floor-pdfs";
export const FLOOR_PDF_TTL_SECONDS = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(["kitchen_ticket", "receipt", "test_ticket", "day_close"]);

// deno-lint-ignore no-explicit-any
export type FloorPdfClient = any;

export type VenueFloorPdfDeps = {
  env?: (name: string) => string | undefined;
  client?: () => FloorPdfClient;
  storage?: (client: FloorPdfClient) => PdfStorage;
  uuid?: () => string;
  now?: () => number;
};

type RpcError = { code?: string; message?: string };

// Database refusal -> status. Anything not listed is a 500 (logged).
const SAFE: Record<string, number> = {
  not_authorized: 403,
  stations_not_enabled: 422,
  till_not_enabled: 422,
  floor_pdf_kind_not_ready: 422,
  floor_pdf_invalid: 400,
  floor_pdf_not_found: 404,
  venue_not_found: 404,
  floor_pdf_not_ready: 409,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...ticketCorsHeaders, "Content-Type": "application/json" },
  });
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value);
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

type Source = Record<string, unknown>;

export function kitchenTicketInput(source: Source, test: boolean): KitchenTicketPdfInput {
  const ticket = (source.ticket ?? {}) as Source;
  const station = str(source.station);
  return {
    paper: floorPaperFrom(source.paper),
    venueName: str(source.venueName),
    station: station === "bar" ? "bar" : station === "all" ? "all" : "kitchen",
    ticketNo: test ? "TEST" : str(ticket.ticketNo),
    destination: str(ticket.destination),
    movedFrom: str(ticket.movedFrom) || null,
    sentAtLocal: str(source.sentAtLocal),
    sellerName: str(ticket.sellerName) || null,
    guestOrder: ticket.guestOrder === true,
    lines: (Array.isArray(ticket.lines) ? ticket.lines as Source[] : []).map((line) => ({
      quantity: num(line.quantity),
      name: str(line.name),
      modifiers: strList(line.modifiers),
      notes: str(line.notes) || null,
      voided: line.voided === true,
    })),
    printedAtLocal: str(source.printedAtLocal),
    printNumber: num(ticket.printedCount) + 1,
    test,
  };
}

export function tillReceiptInput(source: Source): TillReceiptPdfInput {
  const receipt = (source.receipt ?? {}) as Source;
  const payment = (receipt.payment ?? {}) as Source;
  return {
    paper: floorPaperFrom(source.paper),
    venueName: str(receipt.venueName) || str(source.venueName),
    venueAddress: str(receipt.venueAddress) || null,
    checkLabel: str(receipt.checkLabel) || null,
    paidAtLocal: str(source.paidAtLocal),
    receiptNo: numOrNull(receipt.receiptNo),
    currency: str(receipt.currency) || "NGN",
    lines: (Array.isArray(receipt.lines) ? receipt.lines as Source[] : []).map((line) => ({
      label: str(line.label),
      quantity: num(line.quantity),
      amountMinor: num(line.amountMinor),
      modifiers: strList(line.modifiers),
    })),
    subtotalMinor: num(receipt.subtotalMinor),
    serviceChargeMinor: num(receipt.serviceChargeMinor),
    taxIncludedMinor: num(receipt.taxIncludedMinor),
    totalMinor: num(receipt.totalMinor),
    paidBeforeMinor: num(receipt.paidBeforeMinor),
    paymentAmountMinor: num(payment.amountMinor),
    tipMinor: num(payment.tipMinor),
    methodLabel: tillReceiptMethodLabel(payment.method),
    cashGivenMinor: numOrNull(payment.cashGivenMinor),
    changeMinor: numOrNull(payment.changeMinor),
    refundedMinor: num(receipt.refundedMinor),
    paidLate: payment.paidLate === true,
    reference: str(payment.reference),
    footer: str(receipt.footer) || null,
  };
}

export function createVenueFloorPdfHandler(deps: VenueFloorPdfDeps = {}) {
  const env = deps.env ?? ((name: string) => Deno.env.get(name));
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => Date.now());
  const storageOf = deps.storage ?? ((client: FloorPdfClient) => client.storage as PdfStorage);

  return async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") return json(405, { code: "method_not_allowed" });

    let client: FloorPdfClient;
    if (deps.client) {
      client = deps.client();
    } else {
      const url = env("SUPABASE_URL") ?? "";
      const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      if (!url || !serviceKey) return json(500, { code: "unavailable" });
      client = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }

    // Bearer REQUIRED, verified before anything is read.
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!jwt || jwt === env("SUPABASE_SERVICE_ROLE_KEY")) {
      return json(401, { code: "auth_required" });
    }
    const { data: userData, error: userError } = await client.auth.getUser(jwt);
    const userId: string | null = userData?.user?.id ?? null;
    if (userError || !userId) return json(401, { code: "auth_required" });

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json(400, { code: "invalid_request" });
    const kind = str(body.kind);
    const venueId = str(body.venueId).toLowerCase();
    if (!KINDS.has(kind) || !UUID.test(venueId)) return json(400, { code: "invalid_request" });
    // The day-close PDF ships with the close (O5).
    if (kind === "day_close") return json(422, { code: "floor_pdf_kind_not_ready" });
    const orderId = str(body.orderId).toLowerCase();
    const paymentId = str(body.paymentId).toLowerCase();
    const station = str(body.station);
    if (kind === "kitchen_ticket" && (!UUID.test(orderId) || (station !== "kitchen" && station !== "bar"))) {
      return json(400, { code: "invalid_request" });
    }
    if (kind === "test_ticket" && station !== "kitchen" && station !== "bar" && station !== "all") {
      return json(400, { code: "invalid_request" });
    }
    if (kind === "receipt" && !UUID.test(paymentId)) return json(400, { code: "invalid_request" });

    const { data: sourceData, error: sourceError } = await client.rpc("issue_4490_floor_pdf_source", {
      p_kind: kind,
      p_venue_id: venueId,
      p_order_id: kind === "kitchen_ticket" ? orderId : null,
      p_station: kind === "receipt" ? null : station,
      p_payment_id: kind === "receipt" ? paymentId : null,
      p_actor: userId,
    });
    if (sourceError) {
      const code = str((sourceError as RpcError).message);
      if (SAFE[code] !== undefined) return json(SAFE[code], { code });
      console.error("[venue-floor-pdf] source failed", (sourceError as RpcError).code ?? "unknown");
      return json(500, { code: "floor_pdf_failed" });
    }
    const source = (sourceData ?? {}) as Source;
    const brandId = str(source.brandId).toLowerCase();
    if (!UUID.test(brandId)) {
      console.error("[venue-floor-pdf] source had no brand");
      return json(500, { code: "floor_pdf_failed" });
    }

    let pdf: TicketPdfResult;
    try {
      pdf = kind === "receipt"
        ? await buildTillReceiptPdf(tillReceiptInput(source))
        : await buildKitchenTicketPdf(kitchenTicketInput(source, kind === "test_ticket"));
    } catch (err) {
      console.error("[venue-floor-pdf] render failed", err instanceof Error ? err.message.slice(0, 120) : "unknown");
      return json(502, { code: "floor_pdf_failed" });
    }

    // Listed BEFORE upload: an object the sweep does not know about would never
    // be deleted. A listed path whose upload then fails is removed harmlessly.
    const objectPath = `${brandId}/${venueId}/${uuid().toLowerCase()}.pdf`;
    const recorded = await client.rpc("issue_4490_floor_pdf_record", {
      p_brand_id: brandId,
      p_kind: kind,
      p_object_path: objectPath,
      p_actor: userId,
    });
    if (recorded.error) {
      console.error("[venue-floor-pdf] ledger write failed", (recorded.error as RpcError).code ?? "unknown");
      return json(500, { code: "floor_pdf_failed" });
    }
    const delivered = await deliverPdf(storageOf(client), {
      bucket: FLOOR_PDF_BUCKET,
      objectPath,
      contentBase64: pdf.contentBase64,
      ttlSeconds: FLOOR_PDF_TTL_SECONDS,
    }, now);
    if (!delivered.ok) {
      console.error(`[venue-floor-pdf] ${delivered.stage} failed`, delivered.message.slice(0, 120));
      return json(502, { code: "floor_pdf_failed" });
    }

    if (kind === "kitchen_ticket") {
      const marked = await client.rpc("issue_4490_station_mark_printed", {
        p_order_id: orderId,
        p_station: station,
        p_actor: userId,
      });
      if (marked.error) {
        // The PDF exists and is downloadable; only the count failed. Never
        // withhold a ticket over its bookkeeping.
        console.warn("[venue-floor-pdf] printed count failed", (marked.error as RpcError).code ?? "unknown");
      }
    }

    return json(200, {
      signedUrl: delivered.signedUrl,
      expiresAt: delivered.expiresAt,
      filename: pdf.filename,
    });
  };
}

if (import.meta.main) {
  serve(wrapEdgeHandler("venue-floor-pdf", createVenueFloorPdfHandler(), {
    onError: (_err, requestId) => json(500, { code: "floor_pdf_failed", requestId }),
  }));
}
