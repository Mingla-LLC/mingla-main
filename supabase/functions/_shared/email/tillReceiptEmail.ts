// #4490 spec 08 O1 — the Till receipt message (category buyer_till_receipt).
//
// The itemised email body is built from the receipt the drain reads when the
// message is SENT (issue_4490_till_receipt_link_facts → payload.receipt): the
// snapshot taken when the payment landed, plus any refunds since. Pure and
// Deno-safe; no contact, token or link is ever part of the payload.
import { formatMoneyFromCents } from "./currency.ts";

export const TILL_RECEIPT_CATEGORY = "buyer_till_receipt";

type Json = Record<string, unknown>;

const obj = (v: unknown): Json =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const text = (v: unknown): string =>
  typeof v === "string" ? v.replace(/[\r\n\t]+/g, " ").trim() : "";

/** The tender in words (no vendor names). */
export function tillReceiptMethodLabel(method: unknown): string {
  switch (method) {
    case "cash":
      return "Cash";
    case "own_machine":
      return "Card (venue's machine)";
    case "tap":
      return "Card (tap to pay)";
    case "scan":
      return "Paid on your phone";
    case "room":
      return "Charged to your room";
    default:
      return "Paid";
  }
}

/** The itemised body; null when the receipt could not be read. */
export function renderTillReceiptEmailBody(receiptRaw: unknown): string | null {
  const r = obj(receiptRaw);
  const currency = text(r.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  const money = (minor: number): string =>
    formatMoneyFromCents(minor, currency);
  const out: string[] = [];
  const venue = text(r.venueName) || "the venue";
  out.push(`Thanks for coming to ${venue}.`);
  const no = num(r.receiptNo);
  const ref = text(obj(r.payment).reference);
  out.push(
    [no !== null ? `Receipt ${no}` : "", ref ? `Ref ${ref}` : ""].filter(
      Boolean,
    ).join(" · "),
  );
  out.push("");
  for (const lineRaw of Array.isArray(r.lines) ? r.lines : []) {
    const line = obj(lineRaw);
    const qty = num(line.quantity) ?? 1;
    const amount = num(line.amountMinor) ?? 0;
    const mods = Array.isArray(line.modifiers)
      ? (line.modifiers as unknown[]).map(text).filter(Boolean)
      : [];
    const label = `${qty > 1 ? `${qty} × ` : ""}${text(line.label) || "Item"}${
      mods.length ? ` (${mods.join(", ")})` : ""
    }`;
    out.push(`${label}  ${money(amount)}`);
  }
  out.push("");
  out.push(`Subtotal  ${money(num(r.subtotalMinor) ?? 0)}`);
  const service = num(r.serviceChargeMinor) ?? 0;
  if (service > 0) out.push(`Service charge  ${money(service)}`);
  const tax = num(r.taxIncludedMinor) ?? 0;
  if (tax > 0) out.push(`Includes tax  ${money(tax)}`);
  out.push(`Total  ${money(num(r.totalMinor) ?? 0)}`);
  const payment = obj(r.payment);
  const before = num(r.paidBeforeMinor) ?? 0;
  if (before > 0) out.push(`Paid before  ${money(before)}`);
  const paid = num(payment.amountMinor) ?? 0;
  out.push(`${tillReceiptMethodLabel(payment.method)}  ${money(paid)}`);
  const tip = num(payment.tipMinor) ?? 0;
  if (tip > 0) out.push(`Tip  ${money(tip)}`);
  const change = num(payment.changeMinor);
  if (change !== null && change > 0) out.push(`Change  ${money(change)}`);
  const total = num(r.totalMinor) ?? 0;
  const left = total - before - paid;
  if (payment.paidLate !== true && left > 0) {
    out.push(`Left to pay  ${money(left)}`);
  }
  const refunded = num(r.refundedMinor) ?? 0;
  if (refunded > 0) out.push(`Refunded  ${money(refunded)}`);
  const footer = text(r.footer);
  if (footer) {
    out.push("");
    out.push(footer);
  }
  const address = text(r.venueAddress);
  if (address) out.push(address);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The text that carries the private receipt link (when one was built). */
export function tillReceiptSms(
  categoryKey: unknown,
  payload: Json,
  receiptUrl: string | undefined,
): string | null {
  if (categoryKey !== TILL_RECEIPT_CATEGORY || !receiptUrl) return null;
  const venue = text(payload.venue_name) || "the venue";
  return `Mingla: Thanks for coming to ${venue}. Your receipt: ${receiptUrl}`;
}

/** The email button for the private receipt link. */
export function tillReceiptEmailCta(receiptUrl: string | undefined): {
  label: string;
  url: string;
  note: string;
} | undefined {
  if (!receiptUrl) return undefined;
  return {
    label: "See your receipt",
    url: receiptUrl,
    note: "The link is private to you, so please don't forward this email.",
  };
}
