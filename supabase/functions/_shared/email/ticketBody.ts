// ORCH-0785 — Ticket confirmation body renderer.
// Renders the buyer-facing email body (hero, event meta, line items, ticket
// block). All caller-supplied strings flow through escapeHtml first.

import { escapeHtml } from "./escape.ts";
import { formatEventDateLine } from "./dateLine.ts";
import { formatMoneyFromCents, formatMoneyOrFree } from "./currency.ts";
import { SHELL_TOKENS } from "./shell.ts";
import { ticketCopyFor } from "./copy.ts";
import type { TicketBodyInput } from "./types.ts";

const { BRAND_ORANGE, BRAND_INK, BRAND_MUTED, BRAND_BG_SOFT, BRAND_BORDER } =
  SHELL_TOKENS;

function isRenderableImage(
  url: string | null,
  type: "image" | "video" | "gif" | null,
): boolean {
  if (!url) return false;
  if (type === null) return true; // legacy rows pre-cover_media_type
  return type === "image";
}

function renderHero(input: TicketBodyInput): string {
  const { event } = input;
  if (isRenderableImage(event.coverMediaUrl, event.coverMediaType)) {
    return `<img src="${escapeHtml(event.coverMediaUrl!)}" alt="${
      escapeHtml(event.title)
    }" width="600" style="display:block;width:100%;max-width:600px;height:auto;border-radius:12px;border:0;outline:none;text-decoration:none;" />`;
  }
  // Branded fallback — orange-tinted block + event title centred. No <img> tag,
  // no <video> tag, no broken-image marker.
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_BG_SOFT};border-radius:12px;">
    <tr>
      <td align="center" style="padding:48px 24px;border:1px solid ${BRAND_BORDER};border-radius:12px;">
        <p style="margin:0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND_ORANGE};font-weight:700;">Mingla event</p>
        <p style="margin:12px 0 0 0;font-size:22px;font-weight:700;color:${BRAND_INK};">${
    escapeHtml(input.event.title)
  }</p>
      </td>
    </tr>
  </table>`;
}

function renderLocationLine(event: TicketBodyInput["event"]): string {
  if (event.isOnline) {
    return `<p style="margin:6px 0 0 0;font-size:14px;color:${BRAND_MUTED};">Online event</p>`;
  }
  if (event.locationText && event.locationText.trim().length > 0) {
    return `<p style="margin:6px 0 0 0;font-size:14px;color:${BRAND_MUTED};">${
      escapeHtml(event.locationText)
    }</p>`;
  }
  return `<p style="margin:6px 0 0 0;font-size:14px;color:${BRAND_MUTED};font-style:italic;">Location revealed after confirmation</p>`;
}

function renderDateLine(event: TicketBodyInput["event"]): string {
  const dateLine = formatEventDateLine(event.startAt, event.timezone);
  if (!dateLine) return "";
  return `<p style="margin:6px 0 0 0;font-size:14px;color:${BRAND_MUTED};">${
    escapeHtml(dateLine)
  }</p>`;
}

function renderLineItems(order: TicketBodyInput["order"]): string {
  const rows = order.lineItems.map((item) => {
    const qtyName = `${item.quantity}× ${item.ticketName}`;
    const unit = formatMoneyOrFree(item.unitPriceCents, order.currency);
    const lineTotal = formatMoneyOrFree(item.totalCents, order.currency);
    return `<tr>
      <td style="padding:10px 0;font-size:14px;color:${BRAND_INK};border-bottom:1px solid ${BRAND_BORDER};">${
      escapeHtml(qtyName)
    }</td>
      <td align="right" style="padding:10px 0;font-size:14px;color:${BRAND_MUTED};border-bottom:1px solid ${BRAND_BORDER};">${
      escapeHtml(unit)
    }</td>
      <td align="right" style="padding:10px 0;font-size:14px;color:${BRAND_INK};border-bottom:1px solid ${BRAND_BORDER};font-weight:600;">${
      escapeHtml(lineTotal)
    }</td>
    </tr>`;
  }).join("");
  const totalLabel = order.totalCents > 0
    ? formatMoneyFromCents(order.totalCents, order.currency)
    : "Free";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;border-top:1px solid ${BRAND_BORDER};">
    ${rows}
    <tr>
      <td style="padding:14px 0 0 0;font-size:15px;color:${BRAND_INK};font-weight:700;">Total</td>
      <td></td>
      <td align="right" style="padding:14px 0 0 0;font-size:15px;color:${BRAND_INK};font-weight:700;">${
    escapeHtml(totalLabel)
  }</td>
    </tr>
  </table>`;
}

function renderTicketBlock(
  order: TicketBodyInput["order"],
  badge: string,
): string {
  if (order.tickets.length === 0) return "";
  const rows = order.tickets.map((t) => {
    return `<tr>
      <td style="padding:12px 16px;border:1px solid ${BRAND_BORDER};border-radius:10px;">
        <p style="margin:0;font-size:14px;font-weight:600;color:${BRAND_INK};">${
      escapeHtml(t.ticketName)
    }</p>
        <p style="margin:4px 0 0 0;font-size:12px;color:${BRAND_ORANGE};font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">${
      escapeHtml(badge)
    }</p>
      </td>
    </tr>
    <tr><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
    ${rows}
  </table>`;
}

export function renderTicketBody(input: TicketBodyInput): {
  html: string;
  text: string;
  subject: string;
  preheader: string;
} {
  const copy = ticketCopyFor(input.variant);
  const dateLine = formatEventDateLine(
    input.event.startAt,
    input.event.timezone,
  );
  const heroHtml = renderHero(input);
  const orderShortLineHtml =
    `<p style="margin:24px 0 0 0;font-size:12px;color:${BRAND_MUTED};letter-spacing:0.04em;">Order #${
      escapeHtml(input.order.shortId)
    }</p>`;
  const greeting = input.order.buyerName
    ? `<p style="margin:0 0 8px 0;font-size:14px;color:${BRAND_MUTED};">Hi ${
      escapeHtml(input.order.buyerName)
    },</p>`
    : "";
  const body = `${heroHtml}
    <div style="margin-top:24px;">
      ${greeting}
      <h1 style="margin:0;font-size:24px;line-height:1.25;color:${BRAND_INK};font-weight:700;">${
    escapeHtml(copy.heading)
  }</h1>
      <p style="margin:8px 0 0 0;font-size:15px;line-height:1.55;color:${BRAND_MUTED};">${
    escapeHtml(copy.intro)
  }</p>
    </div>
    <div style="margin-top:24px;padding-top:20px;border-top:1px solid ${BRAND_BORDER};">
      <h2 style="margin:0;font-size:18px;color:${BRAND_INK};font-weight:700;">${
    escapeHtml(input.event.title)
  }</h2>
      <p style="margin:6px 0 0 0;font-size:14px;color:${BRAND_MUTED};">Hosted by ${
    escapeHtml(input.brand.name)
  }</p>
      ${renderDateLine(input.event)}
      ${renderLocationLine(input.event)}
    </div>
    ${renderTicketBlock(input.order, copy.attachmentBadge)}
    ${renderLineItems(input.order)}
    ${orderShortLineHtml}`;

  const totalText = input.order.totalCents > 0
    ? formatMoneyFromCents(input.order.totalCents, input.order.currency)
    : "Free";
  const textLines = [
    copy.heading,
    "",
    input.event.title,
    `Hosted by ${input.brand.name}`,
    dateLine,
    input.event.isOnline ? "Online event" : (input.event.locationText ?? ""),
    "",
    ...input.order.lineItems.map((li) =>
      `${li.quantity}× ${li.ticketName} — ${
        formatMoneyOrFree(li.totalCents, input.order.currency)
      }`
    ),
    `Total: ${totalText}`,
    "",
    `Order #${input.order.shortId}`,
    "",
    "Your tickets are attached as a PDF — each one has a unique QR code for entry.",
  ].filter((line) => line !== null && line !== undefined);

  return {
    html: body,
    text: textLines.join("\n"),
    subject: copy.subjectFor(input.event.title),
    preheader: copy.preheader,
  };
}
