// ORCH-0785 — Mingla buyer ticket PDF renderer.
// Produces one A4 page per ticket with a scannable QR code embedded.
// I-PROPOSED-AG TICKET_PDF_PRIVACY: PDF must not contain qr_token_hash, QR
// pepper, stripe payment ids, or buyer phone numbers. The PDF QR encodes the
// SAME `tickets.qr_code` string that powers `scan-ticket`; no new secret
// material is introduced.

import {
  PDFDocument,
  // deno-lint-ignore camelcase
  StandardFonts,
  rgb,
} from "https://esm.sh/pdf-lib@1.17.1";
// deno-lint-ignore no-explicit-any
//
// issue #2160 CI: esm.sh advertises @types/qrcode, which is a CommonJS
// `export =` and therefore has NO default export — a stricter checker rejects
// the default import below with TS2613. The RUNTIME specifier is unchanged and
// still correct (the ?bundle build does expose the API as the default), so the
// emitted PDF is byte-identical; only the types are redirected. See the header
// of qrcodeModule.d.ts for why local types beat pinning a @types version.
//
// The directive MUST be the line IMMEDIATELY above the import — Deno ignores it
// otherwise, silently falling back to the upstream .d.ts (verified with
// `deno info`, which showed the binding unchanged when a comment sat between).
// @ts-types="./qrcodeModule.d.ts"
import QRCode from "https://esm.sh/qrcode@1.5.4?bundle";
import { formatEventDateLine } from "./email/dateLine.ts";
// ORCH-1195 FIX 2 — pdf-lib StandardFonts use WinAnsi encoding which throws on
// U+202F (Intl narrow NBSP before AM/PM) + other non-WinAnsi glyphs. EVERY
// data-derived string drawn below is run through sanitizeForWinAnsi so the
// render can never hard-fail (which previously killed the whole email).
import { sanitizeForWinAnsi } from "./winAnsiSanitize.ts";

export interface TicketPdfInput {
  event: {
    title: string;
    startAtIso: string | null;
    // ORCH-0877 — end-instant ISO for cross-midnight aware date-line on the
    // PDF ticket. Null when the event has no master end_at (Constitution #9
    // — no fabrication; renders start only).
    endAtIso: string | null;
    timezone: string;
    locationText: string | null;
    brandName: string;
    /** #3281 PR6 — multi-date list; when set, drawn instead of a single range. */
    dateLines?: string[];
  };
  order: { shortId: string };
  tickets: Array<{
    ticketId: string;
    ticketName: string;
    qrPayload: string;
  }>;
  attendeeNameHint: string | null;
  // Optional Mingla wordmark PNG URL. When provided the renderer fetches the
  // image and embeds it in the top band instead of the text "Mingla".
  // If fetch fails (network/HTTP error) we silently fall back to the text
  // rendering so PDF generation never blocks ticket dispatch.
  logoUrl?: string;
}

export interface TicketPdfResult {
  filename: string;
  contentBase64: string;
  pageCount: number;
  byteLength: number;
}

const BRAND_ORANGE_R = 0xFF / 255;
const BRAND_ORANGE_G = 0x6B / 255;
const BRAND_ORANGE_B = 0x2C / 255;

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const SIZE_CAP_BYTES = 5 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked btoa to avoid call-stack overflow on large arrays.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(binary);
}

async function qrPayloadAsPngBytes(payload: string): Promise<Uint8Array> {
  // qrcode toBuffer is Node-only; in Deno we go via toDataURL and decode.
  const dataUrl = await (QRCode as unknown as {
    toDataURL: (text: string, opts: Record<string, unknown>) => Promise<string>;
  }).toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 2,
    type: "image/png",
    width: 480,
  });
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function buildTicketPdf(
  input: TicketPdfInput,
): Promise<TicketPdfResult> {
  if (!input.tickets || input.tickets.length === 0) {
    throw new Error("ticket_pdf_no_tickets");
  }
  const pdf = await PDFDocument.create();
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  // ORCH-1195 FIX 2 — sanitize at the source: formatEventDateLine uses
  // Intl.DateTimeFormat, which inserts a U+202F narrow-no-break-space before
  // "AM/PM" that WinAnsi cannot encode (the live drawText crash). This is the one
  // drawText arg NOT routed through `truncate` (which already sanitizes), so it
  // must be sanitized here.
  const multiDateLines = (input.event.dateLines ?? [])
    .filter((line) => typeof line === "string" && line.trim().length > 0)
    .map((line) => sanitizeForWinAnsi(line));
  const dateLine = multiDateLines.length > 0
    ? null
    : sanitizeForWinAnsi(
      formatEventDateLine(
        input.event.startAtIso,
        input.event.endAtIso,
        input.event.timezone,
      ),
    );

  // Try to embed the wordmark. Failures fall back to the text "Mingla".
  let logoImage: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (input.logoUrl) {
    try {
      const res = await fetch(input.logoUrl);
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        logoImage = await pdf.embedPng(bytes);
      }
    } catch (_err) {
      logoImage = null;
    }
  }

  for (const ticket of input.tickets) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    // Top header band. Logo on the white area, slim orange accent strip below.
    if (logoImage) {
      const targetWidth = 140;
      const scaled = logoImage.scaleToFit(targetWidth, 56);
      page.drawImage(logoImage, {
        x: 32,
        y: PAGE_HEIGHT - 24 - scaled.height,
        width: scaled.width,
        height: scaled.height,
      });
    } else {
      page.drawText("Mingla", {
        x: 32,
        y: PAGE_HEIGHT - 56,
        size: 28,
        font: fontBold,
        color: rgb(BRAND_ORANGE_R, BRAND_ORANGE_G, BRAND_ORANGE_B),
      });
    }
    page.drawText("TICKET", {
      x: PAGE_WIDTH - 96,
      y: PAGE_HEIGHT - 46,
      size: 11,
      font: fontBold,
      color: rgb(BRAND_ORANGE_R, BRAND_ORANGE_G, BRAND_ORANGE_B),
    });
    // Slim orange accent strip
    page.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - 92,
      width: PAGE_WIDTH,
      height: 4,
      color: rgb(BRAND_ORANGE_R, BRAND_ORANGE_G, BRAND_ORANGE_B),
    });

    // Event block
    let cursorY = PAGE_HEIGHT - 130;
    page.drawText(truncate(input.event.title, 60), {
      x: 32,
      y: cursorY,
      size: 20,
      font: fontBold,
      color: rgb(0.06, 0.07, 0.09),
    });
    cursorY -= 28;
    if (multiDateLines.length > 0) {
      for (const line of multiDateLines.slice(0, 24)) {
        page.drawText(truncate(line, 80), {
          x: 32,
          y: cursorY,
          size: 11,
          font: fontRegular,
          color: rgb(0.36, 0.38, 0.45),
        });
        cursorY -= 16;
      }
      cursorY -= 2;
    } else if (dateLine) {
      page.drawText(dateLine, {
        x: 32,
        y: cursorY,
        size: 12,
        font: fontRegular,
        color: rgb(0.36, 0.38, 0.45),
      });
      cursorY -= 18;
    }
    if (input.event.locationText) {
      page.drawText(truncate(input.event.locationText, 80), {
        x: 32,
        y: cursorY,
        size: 12,
        font: fontRegular,
        color: rgb(0.36, 0.38, 0.45),
      });
      cursorY -= 18;
    }
    page.drawText(`Hosted by ${truncate(input.event.brandName, 60)}`, {
      x: 32,
      y: cursorY,
      size: 12,
      font: fontRegular,
      color: rgb(0.36, 0.38, 0.45),
    });
    cursorY -= 28;

    // Ticket name + order line
    page.drawText(truncate(ticket.ticketName, 60), {
      x: 32,
      y: cursorY,
      size: 14,
      font: fontBold,
      color: rgb(0.06, 0.07, 0.09),
    });
    cursorY -= 18;
    page.drawText(`Order #${input.order.shortId}`, {
      x: 32,
      y: cursorY,
      size: 11,
      font: fontRegular,
      color: rgb(0.36, 0.38, 0.45),
    });

    if (input.attendeeNameHint) {
      cursorY -= 16;
      page.drawText(`Buyer: ${truncate(input.attendeeNameHint, 60)}`, {
        x: 32,
        y: cursorY,
        size: 11,
        font: fontRegular,
        color: rgb(0.36, 0.38, 0.45),
      });
    }

    // QR block
    const qrBytes = await qrPayloadAsPngBytes(ticket.qrPayload);
    const qrImage = await pdf.embedPng(qrBytes);
    const qrSize = 240;
    const qrX = (PAGE_WIDTH - qrSize) / 2;
    const qrY = 200;
    page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });

    // Footer
    page.drawText(
      "Present this ticket at the door. The QR code is unique to this ticket.",
      {
        x: 32,
        y: 120,
        size: 10,
        font: fontItalic,
        color: rgb(0.36, 0.38, 0.45),
      },
    );
    page.drawText("support@usemingla.com", {
      x: 32,
      y: 100,
      size: 10,
      font: fontRegular,
      color: rgb(BRAND_ORANGE_R, BRAND_ORANGE_G, BRAND_ORANGE_B),
    });
  }

  const bytes = await pdf.save();
  if (bytes.byteLength > SIZE_CAP_BYTES) {
    throw new Error("ticket_pdf_size_exceeded");
  }
  return {
    filename: `tickets-${input.order.shortId}.pdf`,
    contentBase64: bytesToBase64(bytes),
    pageCount: input.tickets.length,
    byteLength: bytes.byteLength,
  };
}

function truncate(value: string, max: number): string {
  // ORCH-1195 FIX 2 — sanitize FIRST so a narrow-NBSP / emoji / curly-quote in
  // the source string can never reach drawText (WinAnsi throws otherwise). The
  // ellipsis appended on overflow is the ASCII "..." for the same reason.
  const safe = sanitizeForWinAnsi(value);
  if (!safe) return "";
  if (safe.length <= max) return safe;
  return `${safe.slice(0, max - 1)}...`;
}

// ORCH-1163 [rsvp-shared-body] — RSVP entry-pass PDF. Modeled on buildTicketPdf
// (same qrPayloadAsPngBytes primitive + brand band), but RSVP has NO order/price
// fields. One page: event title + date + venue + "Hosted by {brand}" + the signed
// `mingla:v1:rsvp:` QR. The QR encodes the SAME `event_rsvps.qr_code` /
// `event_rsvp_guests.qr_code` string that powers RSVP entry scan; no new secret
// material (mirror I-PROPOSED-AG TICKET_PDF_PRIVACY — no token_hash / pepper).
export interface RsvpPassPdfInput {
  eventTitle: string;
  dateLine: string | null;
  venueLine: string | null;
  brandName: string;
  attendeeName: string | null;
  qrPayload: string;
  // Optional Mingla wordmark PNG URL (same fallback-to-text behavior as tickets).
  logoUrl?: string;
}

export async function buildRsvpPassPdf(
  input: RsvpPassPdfInput,
): Promise<TicketPdfResult> {
  if (!input.qrPayload || input.qrPayload.length === 0) {
    throw new Error("rsvp_pass_pdf_no_qr");
  }
  const pdf = await PDFDocument.create();
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  // Try to embed the wordmark; failures fall back to the text "Mingla".
  let logoImage: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (input.logoUrl) {
    try {
      const res = await fetch(input.logoUrl);
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        logoImage = await pdf.embedPng(bytes);
      }
    } catch (_err) {
      logoImage = null;
    }
  }

  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  // Top header band.
  if (logoImage) {
    const targetWidth = 140;
    const scaled = logoImage.scaleToFit(targetWidth, 56);
    page.drawImage(logoImage, {
      x: 32,
      y: PAGE_HEIGHT - 24 - scaled.height,
      width: scaled.width,
      height: scaled.height,
    });
  } else {
    page.drawText("Mingla", {
      x: 32,
      y: PAGE_HEIGHT - 56,
      size: 28,
      font: fontBold,
      color: rgb(BRAND_ORANGE_R, BRAND_ORANGE_G, BRAND_ORANGE_B),
    });
  }
  page.drawText("RSVP", {
    x: PAGE_WIDTH - 84,
    y: PAGE_HEIGHT - 46,
    size: 11,
    font: fontBold,
    color: rgb(BRAND_ORANGE_R, BRAND_ORANGE_G, BRAND_ORANGE_B),
  });
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 92,
    width: PAGE_WIDTH,
    height: 4,
    color: rgb(BRAND_ORANGE_R, BRAND_ORANGE_G, BRAND_ORANGE_B),
  });

  // Event block — title + date + venue + host. NO price/order fields.
  let cursorY = PAGE_HEIGHT - 130;
  page.drawText(truncate(input.eventTitle, 60), {
    x: 32,
    y: cursorY,
    size: 20,
    font: fontBold,
    color: rgb(0.06, 0.07, 0.09),
  });
  cursorY -= 28;
  if (input.dateLine) {
    page.drawText(truncate(input.dateLine, 80), {
      x: 32,
      y: cursorY,
      size: 12,
      font: fontRegular,
      color: rgb(0.36, 0.38, 0.45),
    });
    cursorY -= 18;
  }
  if (input.venueLine) {
    page.drawText(truncate(input.venueLine, 80), {
      x: 32,
      y: cursorY,
      size: 12,
      font: fontRegular,
      color: rgb(0.36, 0.38, 0.45),
    });
    cursorY -= 18;
  }
  page.drawText(`Hosted by ${truncate(input.brandName, 60)}`, {
    x: 32,
    y: cursorY,
    size: 12,
    font: fontRegular,
    color: rgb(0.36, 0.38, 0.45),
  });
  cursorY -= 28;

  if (input.attendeeName) {
    page.drawText(truncate(input.attendeeName, 60), {
      x: 32,
      y: cursorY,
      size: 14,
      font: fontBold,
      color: rgb(0.06, 0.07, 0.09),
    });
  }

  // QR block (same primitive as the ticket renderer).
  const qrBytes = await qrPayloadAsPngBytes(input.qrPayload);
  const qrImage = await pdf.embedPng(qrBytes);
  const qrSize = 240;
  const qrX = (PAGE_WIDTH - qrSize) / 2;
  const qrY = 200;
  page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });

  page.drawText(
    "Present this RSVP pass at the door. The QR code is unique to you.",
    {
      x: 32,
      y: 120,
      size: 10,
      font: fontItalic,
      color: rgb(0.36, 0.38, 0.45),
    },
  );
  page.drawText("support@usemingla.com", {
    x: 32,
    y: 100,
    size: 10,
    font: fontRegular,
    color: rgb(BRAND_ORANGE_R, BRAND_ORANGE_G, BRAND_ORANGE_B),
  });

  const bytes = await pdf.save();
  if (bytes.byteLength > SIZE_CAP_BYTES) {
    throw new Error("rsvp_pass_pdf_size_exceeded");
  }
  return {
    filename: "rsvp-pass.pdf",
    contentBase64: bytesToBase64(bytes),
    pageCount: 1,
    byteLength: bytes.byteLength,
  };
}

// ---------------------------------------------------------------------------
// Issue #1789 (#1767 Phase 1) — VENUE QR SHEET (SPEC #1788 P-27, DESIGN D-5).
//
// One A4 card per orderable spot: venue name, spot label, the QR, and the
// Mingla seal. Bulk (every active spot) and single-spot re-print use the SAME
// builder — a re-print is just a one-element array, so a re-printed card can
// never drift from the sheet it came off.
//
// It lives in THIS file because pdf-lib may be imported from nowhere else under
// supabase/functions/ (I-PROPOSED-AL TICKET_PDF_SINGLE_SOURCE_OF_TRUTH, gated by
// .github/scripts/strict-grep/i-ticket-pdf-single-renderer.mjs). It reuses
// qrPayloadAsPngBytes, truncate (which sanitises for WinAnsi so a render can
// never hard-fail), bytesToBase64 and the shared brand band.
//
// The QR is drawn at near-black on solid white and is never tinted: that is a
// scanner-hardware requirement, not a style choice
// (mingla-business/src/components/event/GateQr.web.tsx:7-9).
// ---------------------------------------------------------------------------
export interface VenueQrSpotCard {
  /** The venue whose name is printed on the card (the spot's physical home). */
  venueName: string;
  /** "Table 12", "Room 204", "Roof Bar" — re-pointable; never the identity. */
  spotLabel: string;
  /** Human hint under the label, e.g. "Serving: Brasserie · In-room dining". */
  servingLine: string | null;
  /** The canonical scan URL (SPEC P-10). Encoded verbatim into the QR. */
  url: string;
}

export interface VenueQrSheetPdfInput {
  brandName: string;
  spots: VenueQrSpotCard[];
  /** Optional Mingla wordmark PNG URL; falls back to the text wordmark. */
  logoUrl?: string;
}

export async function buildVenueQrSheetPdf(
  input: VenueQrSheetPdfInput,
): Promise<TicketPdfResult> {
  if (!input.spots || input.spots.length === 0) {
    throw new Error("venue_qr_sheet_no_spots");
  }

  const pdf = await PDFDocument.create();
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  // Same fetch-with-silent-fallback posture as the ticket + RSVP renderers: a
  // logo failure must never cost a venue their printable sheet.
  let logoImage: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (input.logoUrl) {
    try {
      const res = await fetch(input.logoUrl);
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        logoImage = await pdf.embedPng(bytes);
      }
    } catch (_err) {
      logoImage = null;
    }
  }

  for (const spot of input.spots) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    if (logoImage) {
      const scaled = logoImage.scaleToFit(140, 56);
      page.drawImage(logoImage, {
        x: 32,
        y: PAGE_HEIGHT - 24 - scaled.height,
        width: scaled.width,
        height: scaled.height,
      });
    } else {
      page.drawText("Mingla", {
        x: 32,
        y: PAGE_HEIGHT - 56,
        size: 28,
        font: fontBold,
        color: rgb(BRAND_ORANGE_R, BRAND_ORANGE_G, BRAND_ORANGE_B),
      });
    }
    page.drawText("ORDER HERE", {
      x: PAGE_WIDTH - 140,
      y: PAGE_HEIGHT - 46,
      size: 11,
      font: fontBold,
      color: rgb(BRAND_ORANGE_R, BRAND_ORANGE_G, BRAND_ORANGE_B),
    });
    page.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - 92,
      width: PAGE_WIDTH,
      height: 4,
      color: rgb(BRAND_ORANGE_R, BRAND_ORANGE_G, BRAND_ORANGE_B),
    });

    // The spot IS the headline — a member of staff reading a stack of these
    // needs to see "Table 12" from across the room.
    let cursorY = PAGE_HEIGHT - 150;
    page.drawText(truncate(spot.spotLabel, 28), {
      x: 32,
      y: cursorY,
      size: 34,
      font: fontBold,
      color: rgb(0.06, 0.07, 0.09),
    });
    cursorY -= 30;
    page.drawText(truncate(spot.venueName, 60), {
      x: 32,
      y: cursorY,
      size: 14,
      font: fontRegular,
      color: rgb(0.36, 0.38, 0.45),
    });
    if (spot.servingLine) {
      cursorY -= 20;
      page.drawText(truncate(spot.servingLine, 70), {
        x: 32,
        y: cursorY,
        size: 12,
        font: fontRegular,
        color: rgb(0.36, 0.38, 0.45),
      });
    }

    // QR block — near-black on solid white, centred, generous quiet zone.
    const qrBytes = await qrPayloadAsPngBytes(spot.url);
    const qrImage = await pdf.embedPng(qrBytes);
    const qrSize = 300;
    const qrX = (PAGE_WIDTH - qrSize) / 2;
    const qrY = 230;
    page.drawRectangle({
      x: qrX - 16,
      y: qrY - 16,
      width: qrSize + 32,
      height: qrSize + 32,
      color: rgb(1, 1, 1),
    });
    page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });

    page.drawText("Scan to see the menu and order", {
      x: 32,
      y: 180,
      size: 15,
      font: fontBold,
      color: rgb(0.06, 0.07, 0.09),
    });
    page.drawText(`Hosted by ${truncate(input.brandName, 60)}`, {
      x: 32,
      y: 156,
      size: 11,
      font: fontItalic,
      color: rgb(0.36, 0.38, 0.45),
    });
    page.drawText("support@usemingla.com", {
      x: 32,
      y: 100,
      size: 10,
      font: fontRegular,
      color: rgb(BRAND_ORANGE_R, BRAND_ORANGE_G, BRAND_ORANGE_B),
    });
  }

  const bytes = await pdf.save();
  if (bytes.byteLength > SIZE_CAP_BYTES) {
    throw new Error("venue_qr_sheet_size_exceeded");
  }
  return {
    filename: input.spots.length === 1
      ? "mingla-qr-spot.pdf"
      : "mingla-qr-spots.pdf",
    contentBase64: bytesToBase64(bytes),
    pageCount: input.spots.length,
    byteLength: bytes.byteLength,
  };
}

// ---------------------------------------------------------------------------
// #4490 spec 08 O3 — floor PDFs (kitchen and bar tickets, Till receipts, test
// tickets). Mingla makes the PDF; the device prints it (browser viewer, or the
// phone's own viewer › Share › Print). Paper size comes from
// venue_till_settings.print_paper: A4/letter, or a receipt roll 80 mm
// (226.77 pt) or 58 mm (164.41 pt) wide whose height is fitted to the content.
//
// Every data string goes through sanitizeForWinAnsi (StandardFonts). Because
// that turns every character above 0x7E into a space (₦, £, €, "Café" ->
// "Caf "), money is ALWAYS written with the currency code ("NGN 18,500.00").
// The day-close PDF is O5.
// ---------------------------------------------------------------------------
export type FloorPaper = "a4" | "roll_80" | "roll_58";

export const FLOOR_PAPER_WIDTH_PT: Record<FloorPaper, number> = {
  a4: 595.28,
  roll_80: 226.77,
  roll_58: 164.41,
};
const A4_HEIGHT_PT = 841.89;

export function floorPaperFrom(value: unknown): FloorPaper {
  return value === "roll_80" || value === "roll_58" ? value : "a4";
}

// ISO 4217 minor units for the currencies that are not 2.
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX",
  "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

/** "NGN 18,500.00", "GBP 12.50", "JPY 1,200": always the code, never a symbol. */
export function formatMoneyCode(minor: number, currency: string): string {
  const code = /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "XXX";
  const digits = ZERO_DECIMAL.has(code) ? 0 : THREE_DECIMAL.has(code) ? 3 : 2;
  const safe = Number.isFinite(minor) ? Math.round(minor) : 0;
  const negative = safe < 0;
  const abs = Math.abs(safe);
  const unit = 10 ** digits;
  const whole = Math.floor(abs / unit);
  const fraction = abs % unit;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const amount = digits === 0 ? grouped : `${grouped}.${String(fraction).padStart(digits, "0")}`;
  return `${negative ? "-" : ""}${code} ${amount}`;
}

type PdfFontLike = {
  widthOfTextAtSize: (text: string, size: number) => number;
};

interface FloorRow {
  /** Left text (wrapped to the column). */
  left: string;
  /** Right-aligned text (money), never wrapped. */
  right?: string;
  size?: number;
  bold?: boolean;
  center?: boolean;
  /** Draw a rule instead of text. */
  rule?: boolean;
  indent?: number;
  gapBefore?: number;
}

// The middle dot and the other separators used in copy are not WinAnsi: write
// them as ASCII first so a ticket reads "Pickup 41 - Tolu", not "Pickup 41   Tolu".
function floorText(value: string | null | undefined): string {
  const ascii = String(value ?? "").replace(/\s*·\s*/g, " - ").replace(/×/g, "x");
  return sanitizeForWinAnsi(ascii).replace(/\s+/g, " ").trim();
}

function wrapToWidth(text: string, font: PdfFontLike, size: number, width: number): string[] {
  const words = text.split(" ").filter((w) => w.length > 0);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate;
      continue;
    }
    if (current.length > 0) lines.push(current);
    // A single word wider than the column is cut, never overflowed.
    let rest = word;
    while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    current = rest;
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

async function renderFloorDocument(
  rows: FloorRow[],
  paper: FloorPaper,
  filename: string,
  sizeError: string,
): Promise<TicketPdfResult> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = FLOOR_PAPER_WIDTH_PT[paper];
  const roll = paper !== "a4";
  const margin = roll ? 10 : 48;
  const base = paper === "roll_58" ? 8.5 : roll ? 9.5 : 11;
  const column = width - margin * 2;

  type Placed = { row: FloorRow; lines: string[]; size: number; lineHeight: number };
  const placed: Placed[] = rows.map((row) => {
    const size = (row.size ?? 1) * base;
    const font = row.bold ? bold : regular;
    const rightWidth = row.right ? font.widthOfTextAtSize(row.right, size) + 6 : 0;
    const lines = row.rule ? [""] : wrapToWidth(row.left, font, size, column - (row.indent ?? 0) - rightWidth);
    return { row, lines, size, lineHeight: size * 1.35 };
  });
  const heightOf = (p: Placed) => (p.row.gapBefore ?? 0) + (p.row.rule ? 8 : p.lines.length * p.lineHeight);
  const contentHeight = placed.reduce((sum, p) => sum + heightOf(p), 0);
  const pageHeight = roll ? Math.max(120, Math.ceil(contentHeight + margin * 2)) : A4_HEIGHT_PT;

  let page = pdf.addPage([width, pageHeight]);
  let pageCount = 1;
  let y = pageHeight - margin;
  const ink = rgb(0.06, 0.07, 0.09);
  for (const p of placed) {
    if (!roll && y - heightOf(p) < margin) {
      page = pdf.addPage([width, pageHeight]);
      pageCount += 1;
      y = pageHeight - margin;
    }
    y -= p.row.gapBefore ?? 0;
    if (p.row.rule) {
      page.drawLine({
        start: { x: margin, y: y - 4 },
        end: { x: width - margin, y: y - 4 },
        thickness: 0.6,
        color: ink,
      });
      y -= 8;
      continue;
    }
    const font = p.row.bold ? bold : regular;
    p.lines.forEach((line, index) => {
      y -= p.lineHeight;
      const textWidth = font.widthOfTextAtSize(line, p.size);
      const x = p.row.center ? (width - textWidth) / 2 : margin + (p.row.indent ?? 0);
      page.drawText(line, { x, y: y + p.lineHeight - p.size, size: p.size, font, color: ink });
      if (index === 0 && p.row.right) {
        const rw = font.widthOfTextAtSize(p.row.right, p.size);
        page.drawText(p.row.right, {
          x: width - margin - rw,
          y: y + p.lineHeight - p.size,
          size: p.size,
          font,
          color: ink,
        });
      }
    });
  }
  const bytes = await pdf.save();
  if (bytes.byteLength > SIZE_CAP_BYTES) throw new Error(sizeError);
  return {
    filename,
    contentBase64: bytesToBase64(bytes),
    pageCount,
    byteLength: bytes.byteLength,
  };
}

export interface KitchenTicketLine {
  quantity: number;
  name: string;
  modifiers: string[];
  notes: string | null;
  voided: boolean;
}

export interface KitchenTicketPdfInput {
  paper: FloorPaper;
  venueName: string;
  /** kitchen | bar (a test ticket may also say all). */
  station: "kitchen" | "bar" | "all";
  ticketNo: string;
  destination: string;
  movedFrom?: string | null;
  sentAtLocal: string;
  sellerName: string | null;
  guestOrder: boolean;
  lines: KitchenTicketLine[];
  printedAtLocal: string;
  /** This print's number (1 for the first PDF of the ticket). */
  printNumber: number;
  /** A test ticket from Start service: no order behind it. */
  test?: boolean;
}

const STATION_HEADING: Record<KitchenTicketPdfInput["station"], string> = {
  kitchen: "KITCHEN",
  bar: "BAR",
  all: "KITCHEN AND BAR",
};

export async function buildKitchenTicketPdf(
  input: KitchenTicketPdfInput,
): Promise<TicketPdfResult> {
  if (!input.test && input.lines.length === 0) {
    throw new Error("kitchen_ticket_no_lines");
  }
  const who = input.guestOrder ? "Guest order" : floorText(input.sellerName) || "Staff";
  const rows: FloorRow[] = [
    {
      left: `${STATION_HEADING[input.station]}  #${floorText(input.ticketNo)}`,
      size: 1.5,
      bold: true,
    },
    { left: floorText(input.venueName), size: 0.9 },
  ];
  if (input.test) {
    rows.push(
      { left: "TEST TICKET", size: 1.3, bold: true, gapBefore: 4 },
      { left: `Printed ${floorText(input.printedAtLocal)}` },
      { rule: true, left: "" },
      { left: "If you can read this, printing works.", size: 1 },
      { left: "1 x Sample dish", size: 1.15, bold: true, gapBefore: 4 },
      { left: "Choice, size", indent: 14 },
      { left: "NOTE: sample note", indent: 14 },
      { rule: true, left: "" },
    );
  } else {
    rows.push(
      { left: `${floorText(input.destination)}   ${floorText(input.sentAtLocal)}   ${who}`, size: 1.1, bold: true },
    );
    if (input.movedFrom) rows.push({ left: `Moved from ${floorText(input.movedFrom)}`, size: 0.9 });
    rows.push({ rule: true, left: "" });
    for (const line of input.lines) {
      const head = `${Math.max(1, Math.round(line.quantity))} x ${floorText(line.name)}`;
      rows.push({ left: line.voided ? `VOID  ${head}` : head, size: 1.15, bold: !line.voided, gapBefore: 2 });
      const mods = line.modifiers.map(floorText).filter((m) => m.length > 0);
      if (mods.length > 0) rows.push({ left: mods.join(", "), indent: 14 });
      const note = floorText(line.notes);
      if (note.length > 0) rows.push({ left: `NOTE: ${note}`, indent: 14, bold: true });
    }
    rows.push({ rule: true, left: "" });
    rows.push({ left: `Printed ${floorText(input.printedAtLocal)}  (${Math.max(1, input.printNumber)})`, size: 0.9 });
  }
  return await renderFloorDocument(
    rows,
    input.paper,
    input.test ? "mingla-test-ticket.pdf" : `ticket-${floorText(input.ticketNo).toLowerCase()}-${input.station}.pdf`,
    "kitchen_ticket_size_exceeded",
  );
}

export interface TillReceiptPdfLine {
  label: string;
  quantity: number;
  amountMinor: number;
  modifiers: string[];
}

export interface TillReceiptPdfInput {
  paper: FloorPaper;
  venueName: string;
  venueAddress: string | null;
  checkLabel: string | null;
  paidAtLocal: string;
  receiptNo: number | null;
  currency: string;
  lines: TillReceiptPdfLine[];
  subtotalMinor: number;
  serviceChargeMinor: number;
  taxIncludedMinor: number;
  totalMinor: number;
  paidBeforeMinor: number;
  paymentAmountMinor: number;
  tipMinor: number;
  methodLabel: string;
  cashGivenMinor: number | null;
  changeMinor: number | null;
  refundedMinor: number;
  paidLate: boolean;
  reference: string;
  footer: string | null;
}

export async function buildTillReceiptPdf(
  input: TillReceiptPdfInput,
): Promise<TicketPdfResult> {
  const money = (minor: number) => formatMoneyCode(minor, input.currency);
  const rows: FloorRow[] = [
    { left: floorText(input.venueName), size: 1.35, bold: true, center: true },
  ];
  if (input.venueAddress) rows.push({ left: floorText(input.venueAddress), center: true, size: 0.9 });
  const when = [floorText(input.paidAtLocal), floorText(input.checkLabel)].filter((s) => s.length > 0).join(" - ");
  rows.push({ left: when, center: true, size: 0.9 });
  if (input.receiptNo !== null) rows.push({ left: `Receipt ${input.receiptNo}`, center: true, size: 0.9 });
  rows.push({ rule: true, left: "" });
  for (const line of input.lines) {
    rows.push({
      left: `${Math.max(1, Math.round(line.quantity))} ${floorText(line.label)}`,
      right: money(line.amountMinor),
    });
    const mods = line.modifiers.map(floorText).filter((m) => m.length > 0);
    if (mods.length > 0) rows.push({ left: mods.join(", "), indent: 10, size: 0.85 });
  }
  rows.push({ rule: true, left: "" });
  rows.push({ left: "Subtotal", right: money(input.subtotalMinor) });
  if (input.serviceChargeMinor > 0) rows.push({ left: "Service charge", right: money(input.serviceChargeMinor) });
  if (input.taxIncludedMinor > 0) rows.push({ left: "Includes tax", right: money(input.taxIncludedMinor), size: 0.9 });
  rows.push({ left: "TOTAL", right: money(input.totalMinor), bold: true, size: 1.2 });
  if (input.paidBeforeMinor > 0) rows.push({ left: "Paid before", right: money(input.paidBeforeMinor) });
  rows.push({ left: `Paid - ${floorText(input.methodLabel)}`, right: money(input.paymentAmountMinor) });
  if (input.tipMinor > 0) rows.push({ left: "Tip", right: money(input.tipMinor) });
  if (input.cashGivenMinor !== null) rows.push({ left: "Cash given", right: money(input.cashGivenMinor) });
  if (input.changeMinor !== null && input.changeMinor > 0) rows.push({ left: "Change", right: money(input.changeMinor) });
  if (input.refundedMinor > 0) rows.push({ left: "Refunded", right: money(input.refundedMinor) });
  if (input.paidLate) rows.push({ left: "Paid after the payment was cancelled", size: 0.9 });
  rows.push({ left: "Ref", right: floorText(input.reference) });
  if (input.footer && floorText(input.footer).length > 0) {
    rows.push({ rule: true, left: "" });
    rows.push({ left: floorText(input.footer), center: true, size: 0.9 });
  }
  return await renderFloorDocument(
    rows,
    input.paper,
    `receipt-${floorText(input.reference).toLowerCase()}.pdf`,
    "till_receipt_size_exceeded",
  );
}

// ---------------------------------------------------------------------------
// #4490 spec 08 O5 part B — the day close (Print on "Day closed").
// ---------------------------------------------------------------------------

export interface DayClosePdfRow {
  label: string;
  amountMinor: number;
  /** Extra words after the label ("3 payments"); never money. */
  detail?: string | null;
}

export interface DayClosePdfPerson {
  name: string;
  salesMinor: number;
  tipsMinor: number;
  cashTakenMinor: number;
  voidCount: number;
  refundMinor: number;
}

export interface DayClosePdfInput {
  paper: FloorPaper;
  venueName: string;
  /** "Sat 21 Nov 2026" in the venue's own day. */
  dayLabel: string;
  currency: string;
  /** "Closed 23:48 by Chioma", "Not closed yet". */
  statusLine: string;
  takingsMinor: number;
  paymentCount: number;
  tipsMinor: number;
  byMethod: DayClosePdfRow[];
  people: DayClosePdfPerson[];
  tipsByServer: DayClosePdfRow[];
  /** Service charge, refunds, voids, deposits, online orders, the door, card money. */
  lines: DayClosePdfRow[];
  /** The drawer: float, cash payments and tips, door, refunds, paid outs, expected. */
  cash: DayClosePdfRow[];
  countedMinor: number | null;
  differenceMinor: number | null;
  late: DayClosePdfRow[];
  printedAtLocal: string;
}

/** "NGN 500.00 short", "NGN 1,200.00 over", "Balanced". */
export function dayCloseDifferenceWords(differenceMinor: number, currency: string): string {
  if (differenceMinor === 0) return "Balanced";
  const amount = formatMoneyCode(Math.abs(differenceMinor), currency);
  return differenceMinor < 0 ? `${amount} short` : `${amount} over`;
}

export async function buildDayClosePdf(input: DayClosePdfInput): Promise<TicketPdfResult> {
  const money = (minor: number) => formatMoneyCode(minor, input.currency);
  const row = (r: DayClosePdfRow, indent = 0): FloorRow => ({
    left: r.detail ? `${floorText(r.label)} (${floorText(r.detail)})` : floorText(r.label),
    right: money(r.amountMinor),
    indent,
  });
  const rows: FloorRow[] = [
    { left: "DAY CLOSE", size: 1.4, bold: true, center: true },
    { left: floorText(input.venueName), center: true, bold: true },
    { left: floorText(input.dayLabel), center: true },
    { left: floorText(input.statusLine), center: true, size: 0.9 },
    { rule: true, left: "" },
    { left: `Takings (${Math.max(0, Math.round(input.paymentCount))} payments)`, right: money(input.takingsMinor), bold: true, size: 1.15 },
    { left: "Tips", right: money(input.tipsMinor), bold: true },
    { left: "By payment type", bold: true, gapBefore: 6 },
    ...input.byMethod.map((r) => row(r, 8)),
  ];
  if (input.people.length > 0) {
    rows.push({ left: "By person (sales)", bold: true, gapBefore: 6 });
    for (const p of input.people) {
      rows.push({ left: floorText(p.name), right: money(p.salesMinor), indent: 8 });
      const extra = [
        p.tipsMinor > 0 ? `tips ${money(p.tipsMinor)}` : "",
        p.cashTakenMinor > 0 ? `cash ${money(p.cashTakenMinor)}` : "",
        p.refundMinor > 0 ? `refunds ${money(p.refundMinor)}` : "",
        p.voidCount > 0 ? `${p.voidCount} void${p.voidCount === 1 ? "" : "s"}` : "",
      ].filter((s) => s.length > 0).join(", ");
      if (extra.length > 0) rows.push({ left: extra, indent: 16, size: 0.85 });
    }
  }
  if (input.tipsByServer.length > 0) {
    rows.push({ left: "Tips by who served", bold: true, gapBefore: 6 });
    rows.push(...input.tipsByServer.map((r) => row(r, 8)));
  }
  if (input.lines.length > 0) {
    rows.push({ rule: true, left: "", gapBefore: 4 });
    rows.push(...input.lines.map((r) => row(r)));
  }
  rows.push({ rule: true, left: "", gapBefore: 4 });
  rows.push({ left: "Cash drawer", bold: true });
  rows.push(...input.cash.map((r) => row(r, 8)));
  if (input.countedMinor !== null) {
    rows.push({ left: "Counted", right: money(input.countedMinor), bold: true });
  }
  if (input.differenceMinor !== null) {
    rows.push({ left: "Difference", right: dayCloseDifferenceWords(input.differenceMinor, input.currency), bold: true, size: 1.15 });
  }
  if (input.late.length > 0) {
    rows.push({ rule: true, left: "", gapBefore: 4 });
    rows.push({ left: "Late payments since close", bold: true });
    rows.push(...input.late.map((r) => row(r, 8)));
  }
  rows.push({ rule: true, left: "", gapBefore: 4 });
  rows.push({ left: `Printed ${floorText(input.printedAtLocal)}`, size: 0.85, center: true });
  const safeDay = floorText(input.dayLabel).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return await renderFloorDocument(rows, input.paper, `day-close-${safeDay || "day"}.pdf`, "day_close_size_exceeded");
}
