// Issue #4063 — one QR-free, one-button purchase email body skeleton.

import { formatMoneyFromCents, formatMoneyOrFree } from "./currency.ts";
import { escapeHtml } from "./escape.ts";
import type { PurchaseEmailCopy } from "./purchaseCopy.ts";
import { SHELL_TOKENS } from "./shell.ts";

const {
  BRAND_BORDER,
  BRAND_INK,
  BRAND_MUTED,
  BRAND_ORANGE,
  BRAND_ORANGE_BUTTON,
} = SHELL_TOKENS;

export interface PurchaseClaimBlock {
  claimed: boolean;
  email?: string | null;
  phoneLast4?: string | null;
}

export interface PurchaseDetails {
  title: string;
  hostOrVenue: string;
  when?: string | null;
  place?: string | null;
  lines?: string[];
  manageUrl?: string | null;
  managePrivateNote?: boolean;
}

export interface PurchaseReceiptItem {
  label: string;
  quantity?: number;
  amountCents: number;
}

export interface PurchaseReceiptRow {
  label: string;
  value: string;
}

export interface PurchaseReceipt {
  currency: string;
  items?: PurchaseReceiptItem[];
  discountRows: Array<{ label: string; amountCents: number }>;
  extraRows?: PurchaseReceiptRow[];
  feesAndTaxCents?: number;
  paidCents?: number;
  totalRow?: PurchaseReceiptRow | null;
  orderId?: string | null;
  orderLabel?: string | null;
  cardDisplay?: string | null;
}

export interface PurchaseBodyInput {
  variant: "purchase_message";
  copy: PurchaseEmailCopy;
  claim?: PurchaseClaimBlock | null;
  buttonUrl?: string | null;
  details?: PurchaseDetails | null;
  receipt?: PurchaseReceipt | null;
}

export interface PurchaseBodyResult {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

function safeActionUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "mailto:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function claimContent(claim: PurchaseClaimBlock): {
  html: string;
  text: string;
} {
  if (claim.claimed) {
    const text = "It's on your Mingla account.";
    return { html: escapeHtml(text), text };
  }
  const email = claim.email?.trim() ?? "";
  const digits = claim.phoneLast4?.replace(/\D/g, "").slice(-4) ?? "";
  if (email.length > 0 && digits.length === 4) {
    return {
      html: `Sign in with <strong>${
        escapeHtml(email)
      }</strong> or the number ending ${escapeHtml(digits)}`,
      text: `Sign in with ${email} or the number ending ${digits}`,
    };
  }
  if (email.length > 0) {
    return {
      html: `Sign in with <strong>${escapeHtml(email)}</strong>`,
      text: `Sign in with ${email}`,
    };
  }
  if (digits.length === 4) {
    const text = `Sign in with the number ending ${digits}`;
    return { html: escapeHtml(text), text };
  }
  throw new Error("purchase_body_claim_contact_missing");
}

function orderReference(orderId: string): string {
  const ref = orderId.replaceAll("-", "").slice(0, 8).toUpperCase();
  if (!/^[0-9A-F]{8}$/.test(ref)) {
    throw new Error("purchase_body_order_reference_invalid");
  }
  return ref;
}

function renderDetails(
  details: PurchaseDetails,
): { html: string; text: string[] } {
  const first = `${details.title} · ${details.hostOrVenue}`;
  const timing = details.when?.trim()
    ? `${details.when.trim()}${
      details.place?.trim() ? ` · ${details.place.trim()}` : ""
    }`
    : details.place?.trim() ?? "";
  const lines = [first, ...(timing ? [timing] : []), ...(details.lines ?? [])]
    .map((line) => line.trim()).filter(Boolean);
  const manageUrl = details.manageUrl?.trim()
    ? safeActionUrl(details.manageUrl.trim())
    : null;
  if (details.manageUrl?.trim() && manageUrl === null) {
    throw new Error("purchase_body_manage_url_invalid");
  }
  const htmlLines = lines.map((line) => escapeHtml(line)).join("<br>");
  const manageHtml = manageUrl
    ? `<p style="margin:12px 0 0 0;font-size:14px;line-height:1.55;color:${BRAND_MUTED};">Manage or cancel: <a href="${
      escapeHtml(manageUrl)
    }" style="color:${BRAND_ORANGE};text-decoration:underline;">${
      escapeHtml(manageUrl)
    }</a></p>${
      details.managePrivateNote
        ? `<p style="margin:8px 0 0 0;font-size:13px;line-height:1.55;color:${BRAND_MUTED};">The link is private to you, so please don't forward this email.</p>`
        : ""
    }`
    : "";
  return {
    html:
      `<div style="margin:24px 0 0 0;padding:18px;border:1px solid ${BRAND_BORDER};border-radius:12px;font-size:14px;line-height:1.65;color:${BRAND_INK};">${htmlLines}${manageHtml}</div>`,
    text: [
      ...lines,
      ...(manageUrl ? [`Manage or cancel: ${manageUrl}`] : []),
      ...(manageUrl && details.managePrivateNote
        ? ["The link is private to you, so please don't forward this email."]
        : []),
    ],
  };
}

function receiptRows(receipt: PurchaseReceipt): PurchaseReceiptRow[] {
  const rows: PurchaseReceiptRow[] = [];
  for (const item of receipt.items ?? []) {
    const quantity = Number.isFinite(item.quantity) && (item.quantity ?? 0) > 0
      ? Math.floor(item.quantity ?? 1)
      : 1;
    rows.push({
      label: `${quantity}× ${item.label}`,
      value: formatMoneyOrFree(item.amountCents, receipt.currency),
    });
  }
  for (const discount of receipt.discountRows) {
    rows.push({
      label: discount.label,
      value: `−${
        formatMoneyFromCents(Math.abs(discount.amountCents), receipt.currency)
      }`,
    });
  }
  rows.push(...(receipt.extraRows ?? []));
  if ((receipt.feesAndTaxCents ?? 0) > 0) {
    rows.push({
      label: "Fees & tax",
      value: formatMoneyFromCents(
        receipt.feesAndTaxCents ?? 0,
        receipt.currency,
      ),
    });
  }
  if (receipt.totalRow !== null) {
    rows.push(
      receipt.totalRow ?? {
        label: (receipt.paidCents ?? 0) > 0 ? "Paid" : "Total",
        value: formatMoneyOrFree(receipt.paidCents ?? 0, receipt.currency),
      },
    );
  }
  const orderLabel = receipt.orderLabel?.trim() ||
    (receipt.orderId ? `Order ${orderReference(receipt.orderId)}` : "");
  if (orderLabel) {
    rows.push({
      label: receipt.cardDisplay?.trim()
        ? `${orderLabel} · ${receipt.cardDisplay.trim()}`
        : orderLabel,
      value: "",
    });
  }
  return rows;
}

function renderReceipt(
  receipt: PurchaseReceipt,
): { html: string; text: string[] } {
  const rows = receiptRows(receipt);
  const html = rows.map((row) =>
    `<tr><td style="padding:9px 0;border-bottom:1px solid ${BRAND_BORDER};font-size:14px;line-height:1.4;color:${BRAND_INK};">${
      escapeHtml(row.label)
    }</td><td align="right" style="padding:9px 0;border-bottom:1px solid ${BRAND_BORDER};font-size:14px;line-height:1.4;color:${BRAND_INK};font-weight:600;">${
      escapeHtml(row.value)
    }</td></tr>`
  ).join("");
  return {
    html:
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;border-top:1px solid ${BRAND_BORDER};">${html}</table>`,
    text: rows.map((row) =>
      row.value ? `${row.label}: ${row.value}` : row.label
    ),
  };
}

export function renderPurchaseBody(
  input: PurchaseBodyInput,
): PurchaseBodyResult {
  const claim = input.copy.claimBlock
    ? claimContent(input.claim ?? { claimed: false })
    : null;
  const buttonUrl = input.buttonUrl?.trim()
    ? safeActionUrl(input.buttonUrl.trim())
    : null;
  if (input.copy.buttonLabel !== null && buttonUrl === null) {
    throw new Error("purchase_body_button_url_missing_or_invalid");
  }
  if (input.copy.buttonLabel === null && input.buttonUrl?.trim()) {
    throw new Error("purchase_body_unexpected_button_url");
  }

  const buttonHtml = input.copy.buttonLabel && buttonUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr><td style="background:${BRAND_ORANGE_BUTTON};border-radius:999px;"><a href="${
      escapeHtml(buttonUrl)
    }" style="display:inline-block;padding:12px 22px;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;">${
      escapeHtml(input.copy.buttonLabel)
    }</a></td></tr></table>`
    : "";
  const details = input.details ? renderDetails(input.details) : null;
  const receipt = input.receipt ? renderReceipt(input.receipt) : null;
  const html =
    `<h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;color:${BRAND_INK};font-weight:700;">${
      escapeHtml(input.copy.heading)
    }</h1>
<p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">${
      escapeHtml(input.copy.promise)
    }</p>
${
      claim
        ? `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">${claim.html}</p>`
        : ""
    }
${buttonHtml}${details?.html ?? ""}${receipt?.html ?? ""}`;

  const text = [
    input.copy.heading,
    "",
    input.copy.promise,
    ...(claim ? ["", claim.text] : []),
    ...(input.copy.buttonLabel && buttonUrl
      ? ["", `${input.copy.buttonLabel}: ${buttonUrl}`]
      : []),
    ...(details ? ["", ...details.text] : []),
    ...(receipt ? ["", ...receipt.text] : []),
  ].join("\n");

  return {
    subject: input.copy.subject,
    preheader: input.copy.preheader,
    html,
    text,
  };
}
