/**
 * #4490 spec 08 O1 (T20) — pure display state for the guest's Till receipt
 * page. Every number is the server's (the receipt snapshot taken when the
 * payment landed, plus refunds since); this only puts them in rows. Money is
 * formatted with the receipt's own currency (rule 10); dates are day-first,
 * 24-hour, in the venue's time zone.
 */
import { formatCurrency } from "../../../utils/currency";

type Json = Record<string, unknown>;

const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export const TILL_RECEIPT_PAGE_COPY = {
  tabTitle: "Your receipt · Mingla",
  title: (venue: string): string => `Receipt from ${venue}`,
  receiptNo: (n: number): string => `Receipt ${n}`,
  reference: (ref: string): string => `Ref ${ref}`,
  subtotal: "Subtotal",
  serviceCharge: "Service charge",
  taxIncluded: "Includes tax",
  total: "Total",
  paidBefore: "Paid before",
  tip: "Tip",
  change: "Change",
  leftToPay: "Left to pay",
  refunded: "Refunded",
  paidLate: "This payment came in after the bill was closed. The venue will refund it or keep it as payment.",
  notFoundTitle: "We couldn't find this receipt",
  notFoundBody: "The link may be incomplete. Ask the venue to send your receipt again.",
  errorTitle: "Couldn't load your receipt",
  errorBody: "Check your connection and try again.",
  retry: "Try again",
  loading: "Loading your receipt",
} as const;

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

export interface TillReceiptRow {
  key: string;
  label: string;
  detail: string | null;
  amount: string;
  strong?: boolean;
}

export interface TillReceiptView {
  venueName: string;
  heading: string;
  meta: string;
  when: string | null;
  checkLabel: string | null;
  lines: TillReceiptRow[];
  totals: TillReceiptRow[];
  payment: TillReceiptRow[];
  paidLate: boolean;
  footer: string | null;
  address: string | null;
}

/** "22 Nov 2026, 21:40" in the venue's zone (falls back to the device zone). */
export function receiptWhen(iso: unknown, timeZone: unknown): string | null {
  const raw = text(iso);
  if (!raw) return null;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return null;
  const zone = text(timeZone);
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  try {
    return new Intl.DateTimeFormat("en-GB", zone ? { ...options, timeZone: zone } : options).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-GB", options).format(at);
  }
}

/** The page's rows, or null when the server's receipt is unreadable. */
export function tillReceiptView(raw: unknown): TillReceiptView | null {
  const r = obj(raw);
  const currency = text(r.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  const money = (minor: number): string => formatCurrency(minor, currency, true);
  const venueName = text(r.venueName) || "the venue";
  const payment = obj(r.payment);
  const receiptNo = num(r.receiptNo);
  const reference = text(payment.reference);

  const lines: TillReceiptRow[] = (Array.isArray(r.lines) ? r.lines : []).map((lineRaw, i) => {
    const line = obj(lineRaw);
    const qty = num(line.quantity) ?? 1;
    const mods = Array.isArray(line.modifiers) ? (line.modifiers as unknown[]).map(text).filter(Boolean) : [];
    return {
      key: `line-${i}`,
      label: `${qty > 1 ? `${qty} × ` : ""}${text(line.label) || "Item"}`,
      detail: mods.length > 0 ? mods.join(", ") : null,
      amount: money(num(line.amountMinor) ?? 0),
    };
  });

  const totals: TillReceiptRow[] = [
    { key: "subtotal", label: TILL_RECEIPT_PAGE_COPY.subtotal, detail: null, amount: money(num(r.subtotalMinor) ?? 0) },
  ];
  const service = num(r.serviceChargeMinor) ?? 0;
  if (service > 0) totals.push({ key: "service", label: TILL_RECEIPT_PAGE_COPY.serviceCharge, detail: null, amount: money(service) });
  const tax = num(r.taxIncludedMinor) ?? 0;
  if (tax > 0) totals.push({ key: "tax", label: TILL_RECEIPT_PAGE_COPY.taxIncluded, detail: null, amount: money(tax) });
  const total = num(r.totalMinor) ?? 0;
  totals.push({ key: "total", label: TILL_RECEIPT_PAGE_COPY.total, detail: null, amount: money(total), strong: true });

  const paidLate = payment.paidLate === true;
  const before = num(r.paidBeforeMinor) ?? 0;
  const paid = num(payment.amountMinor) ?? 0;
  const rows: TillReceiptRow[] = [];
  if (before > 0) rows.push({ key: "before", label: TILL_RECEIPT_PAGE_COPY.paidBefore, detail: null, amount: money(before) });
  rows.push({ key: "paid", label: tillReceiptMethodLabel(payment.method), detail: null, amount: money(paid), strong: true });
  const tip = num(payment.tipMinor) ?? 0;
  if (tip > 0) rows.push({ key: "tip", label: TILL_RECEIPT_PAGE_COPY.tip, detail: null, amount: money(tip) });
  const change = num(payment.changeMinor);
  if (change !== null && change > 0) rows.push({ key: "change", label: TILL_RECEIPT_PAGE_COPY.change, detail: null, amount: money(change) });
  const left = total - before - paid;
  if (!paidLate && left > 0) rows.push({ key: "left", label: TILL_RECEIPT_PAGE_COPY.leftToPay, detail: null, amount: money(left) });
  const refunded = num(r.refundedMinor) ?? 0;
  if (refunded > 0) rows.push({ key: "refunded", label: TILL_RECEIPT_PAGE_COPY.refunded, detail: null, amount: money(refunded) });

  return {
    venueName,
    heading: TILL_RECEIPT_PAGE_COPY.title(venueName),
    meta: [
      receiptNo !== null ? TILL_RECEIPT_PAGE_COPY.receiptNo(receiptNo) : null,
      reference ? TILL_RECEIPT_PAGE_COPY.reference(reference) : null,
    ].filter((x): x is string => x !== null).join(" · "),
    when: receiptWhen(r.paidAt, r.timezone),
    checkLabel: text(r.checkLabel) || null,
    lines,
    totals,
    payment: rows,
    paidLate,
    footer: text(r.footer) || null,
    address: text(r.venueAddress) || null,
  };
}
