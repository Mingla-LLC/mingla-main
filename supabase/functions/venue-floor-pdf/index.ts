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
//   day_close                    -> the Till on + money rights (issue_4490_day_close_pdf,
//                                   O5 part B); { date } names the business day
// Objects go to the PRIVATE venue-floor-pdfs bucket at <brand>/<venue>/<uuid>.pdf
// (listed in venue_floor_pdfs first, so venue-offer-sweep deletes every one
// after 24 hours) and are reached only by a 60-second signed URL. A kitchen
// ticket PDF counts one print (issue_4490_station_mark_printed).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { wrapEdgeHandler } from "../_shared/structuredLog.ts";
import { ticketCorsHeaders } from "../_shared/ticketCheckout.ts";
import {
  buildDayClosePdf,
  buildKitchenTicketPdf,
  buildTillReceiptPdf,
  floorPaperFrom,
  type DayClosePdfInput,
  type DayClosePdfRow,
  type KitchenTicketPdfInput,
  type TicketPdfResult,
  type TillReceiptPdfInput,
} from "../_shared/ticketPdf.ts";
import { deliverPdf, type PdfStorage } from "../_shared/pdfDelivery.ts";
import { tillReceiptMethodLabel } from "../_shared/email/tillReceiptEmail.ts";
import { requireStepUp, resolveTillActor } from "../_shared/venueTillStaffSession.ts";

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
  // O5 part B: the day close comes from issue_4490_day_close_pdf (the day summary).
  day_out_of_range: 400,
  pin_session_required: 401,
  pin_session_invalid: 401,
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

const DAY_METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  own_machine: "Card machine (yours)",
  tap: "Tap to pay",
  scan_card: "Scan to pay - card",
  scan_transfer: "Scan to pay - bank transfer",
  scan_other: "Scan to pay - other",
  room: "Charge to room",
  door_cash: "Cash at the door",
  door_transfer: "Transfer at the door",
  door_card: "Card at the door",
  door_other: "Other at the door",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-21" -> "Sat 21 Nov 2026" (a calendar day, no time zone involved). */
export function dayLabelFrom(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** A person on the close: never a device as a person, never an email. */
export function dayPersonName(person: Source | null | undefined): string {
  const kind = str(person?.kind);
  const name = str(person?.name);
  if (kind === "device") return "Till device";
  if (kind === "system") return "Cleared by the Till";
  // #4490 after #4579: the name already reads "Kunle from Mingla" (never an email).
  if (kind === "mingla_support") return name || "Mingla Team";
  return name || "Team member";
}

function rowsOf(value: unknown): Source[] {
  return Array.isArray(value) ? value as Source[] : [];
}

/** The day-close PDF from the summary the server computed (nothing added up here). */
export function dayCloseInput(summary: Source): DayClosePdfInput {
  const totals = (summary.totals ?? {}) as Source;
  const takings = (totals.takings ?? {}) as Source;
  const cash = (totals.cash ?? {}) as Source;
  const card = (totals.card ?? {}) as Source;
  const close = (summary.close ?? null) as Source | null;
  const state = str(summary.state);
  const currency = str(summary.currency) || str(totals.currency) || "NGN";
  const method = (r: Source): DayClosePdfRow => ({
    label: DAY_METHOD_LABEL[str(r.method)] ?? "Other",
    amountMinor: num(r.amountMinor),
    detail: num(r.count) > 0 ? `${num(r.count)}` : null,
  });
  const pair = (label: string, minor: number, detail?: string | null): DayClosePdfRow => ({ label, amountMinor: minor, detail: detail ?? null });
  const lines: DayClosePdfRow[] = [
    pair("Service charge (inside takings)", num(totals.serviceChargeMinor)),
    pair("Refunds", num((totals.refunds as Source | undefined)?.amountMinor), `${num((totals.refunds as Source | undefined)?.count)}`),
    pair("Voids before payment", num((totals.voids as Source | undefined)?.amountMinor), `${num((totals.voids as Source | undefined)?.count)}`),
    pair("Deposits used (paid when booked)", num((totals.depositsUsed as Source | undefined)?.amountMinor)),
    pair("Deposit refunded to guests", num((totals.depositRefunded as Source | undefined)?.amountMinor)),
    pair("Ordered online at the venue (not in the drawer)", num((totals.orderedOnline as Source | undefined)?.amountMinor)),
    pair("Sold at the door outside the Till", num((totals.door as Source | undefined)?.amountMinor)),
    pair("Guest-paid card fees", num(takings.guestFeesMinor)),
    pair("Mingla fees", num(card.minglaFeesMinor)),
    pair("Card money to your bank", num(card.toBankMinor)),
  ];
  const drawer: DayClosePdfRow[] = [
    pair("Float", num(cash.floatMinor)),
    pair("Cash payments", num(cash.cashPaymentsMinor)),
    pair("Cash tips", num(cash.cashTipsMinor)),
  ];
  if (num(cash.doorCashMinor) > 0) drawer.push(pair("Cash at the door", num(cash.doorCashMinor)));
  drawer.push(pair("Cash refunds", -num(cash.cashRefundsMinor)), pair("Paid out", -num(cash.paidOutMinor)),
    pair("Expected in the drawer", num(close?.cashExpectedMinor ?? cash.expectedMinor)));
  const late = (summary.late ?? {}) as Source;
  return {
    paper: floorPaperFrom(summary.paper),
    venueName: str(summary.venueName),
    dayLabel: dayLabelFrom(str(summary.businessDate)),
    currency,
    statusLine: state === "closed" && close
      ? `Closed ${str(close.closedAtLocal)} by ${dayPersonName(close.closedBy as Source)}`
      : state === "reopened" ? "Reopened, not closed again yet" : "Not closed yet",
    takingsMinor: num(takings.amountMinor),
    paymentCount: num(takings.count),
    tipsMinor: num(takings.tipMinor),
    byMethod: rowsOf(totals.byMethod).map(method),
    people: rowsOf(totals.people).filter((p) => num(p.salesCount) > 0 || num(p.refundCount) > 0 || num(p.voidCount) > 0)
      .map((p) => ({
        name: dayPersonName(p),
        salesMinor: num(p.salesMinor),
        tipsMinor: num(p.tipsTakenMinor),
        cashTakenMinor: num(p.cashTakenMinor),
        voidCount: num(p.voidCount),
        refundMinor: num(p.refundMinor),
      })),
    tipsByServer: rowsOf(totals.tipsByServer).map((p) => pair(dayPersonName(p), num(p.tipsServedMinor))),
    lines,
    cash: drawer,
    countedMinor: state === "closed" && close ? num(close.cashCountedMinor) : null,
    differenceMinor: state === "closed" && close ? num(close.differenceMinor) : null,
    late: rowsOf(late.payments).map((p) => pair(`${DAY_METHOD_LABEL[str(p.method)] ?? "Other"} ${str(p.paidAtLocal)}`,
      num(p.amountMinor) + num(p.tipMinor), str(p.checkLabel) || null)),
    printedAtLocal: str(summary.printedAtLocal),
  };
}

/** "21/11/2026 23:48" in the venue's zone (en-GB digits; never formatToParts). */
export function printedAtLocalFor(timezone: string, epochMs: number): string {
  try {
    const text = new Date(epochMs).toLocaleString("en-GB", {
      timeZone: timezone || "UTC",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return text.replace(",", "");
  } catch {
    return new Date(epochMs).toISOString().slice(0, 16).replace("T", " ");
  }
}

/**
 * The only environment names this function reads, each read literally so the
 * function secret contract can attribute them (#2241). Tests inject `deps.env`.
 */
function runtimeEnv(name: string): string | undefined {
  switch (name) {
    case "SUPABASE_SERVICE_ROLE_KEY":
      return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    case "SUPABASE_URL":
      return Deno.env.get("SUPABASE_URL");
    default:
      return undefined;
  }
}

export function createVenueFloorPdfHandler(deps: VenueFloorPdfDeps = {}) {
  const env = deps.env ?? runtimeEnv;
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
    const dayDate = str(body.date);
    if (kind === "day_close" && !/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) return json(400, { code: "invalid_request" });
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

    // #4490 O5: a receipt is a Till action, so on a Till device login it needs
    // a live PIN session (staffSession in the body) and is made as that
    // member. Kitchen and test tickets are station work: the device itself.
    // O5 part B: the day close is money: a PIN session on a Till device, money
    // rights (checked by issue_4490_day_close_pdf with the device recorded).
    let pdfActor = userId;
    let pdfDevice: string | null = null;
    if (kind === "receipt" || kind === "day_close") {
      const who = await resolveTillActor(client, { venueId, userId, jwt, staffSession: body.staffSession });
      if (!who.ok) return json(who.status, { code: who.code });
      pdfActor = who.actor.actorUserId;
      pdfDevice = who.actor.isDevice ? who.actor.deviceUserId : null;
      // #4490 08-O5 fix 3: the day-close PDF is an export of the day: on a
      // Till device it needs the same fresh PIN as the CSV (stepUp in the
      // body; purpose export, this venue's day) and is made as the approver.
      if (kind === "day_close" && who.actor.isDevice) {
        const step = await requireStepUp(client, {
          venueId,
          actor: who.actor,
          stepUp: body.stepUp,
          purpose: "export",
          target: `${venueId}:${dayDate}`,
        });
        if (!step.ok) return json(step.status, step.body);
        pdfActor = step.approverUserId;
      }
    }

    let sourceData: unknown;
    let sourceError: unknown;
    if (kind === "day_close") {
      // #4490 08-O5 fix 3: issue_4490_day_close_pdf consumes the export
      // approval made above (single use, in the database), so the PDF's PIN
      // can never also authorise a CSV export of the same day.
      const r = await client.rpc("issue_4490_day_close_pdf", {
        p_venue_id: venueId,
        p_date: dayDate,
        p_actor: pdfActor,
        p_device_user: pdfDevice,
      });
      sourceData = r.data;
      sourceError = r.error;
    } else {
      const r = await client.rpc("issue_4490_floor_pdf_source", {
        p_kind: kind,
        p_venue_id: venueId,
        p_order_id: kind === "kitchen_ticket" ? orderId : null,
        p_station: kind === "receipt" ? null : station,
        p_payment_id: kind === "receipt" ? paymentId : null,
        p_actor: pdfActor,
      });
      sourceData = r.data;
      sourceError = r.error;
    }

    if (sourceError) {
      const code = str((sourceError as RpcError).message);
      if (SAFE[code] !== undefined) return json(SAFE[code], { code });
      console.error("[venue-floor-pdf] source failed", (sourceError as RpcError).code ?? "unknown");
      return json(500, { code: "floor_pdf_failed" });
    }
    const source = (sourceData ?? {}) as Source;
    if (kind === "day_close" && !source.printedAtLocal) {
      source.printedAtLocal = printedAtLocalFor(str(source.timezone), now());
    }
    const brandId = str(source.brandId).toLowerCase();
    if (!UUID.test(brandId)) {
      console.error("[venue-floor-pdf] source had no brand");
      return json(500, { code: "floor_pdf_failed" });
    }

    let pdf: TicketPdfResult;
    try {
      pdf = kind === "receipt"
        ? await buildTillReceiptPdf(tillReceiptInput(source))
        : kind === "day_close"
        ? await buildDayClosePdf(dayCloseInput(source))
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
      p_actor: pdfActor,
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
        p_actor: pdfActor,
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
