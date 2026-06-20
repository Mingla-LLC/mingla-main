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
import QRCode from "https://esm.sh/qrcode@1.5.4?bundle";
import { formatEventDateLine } from "./email/dateLine.ts";

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

  const dateLine = formatEventDateLine(
    input.event.startAtIso,
    input.event.endAtIso,
    input.event.timezone,
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
    if (dateLine) {
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
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
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
