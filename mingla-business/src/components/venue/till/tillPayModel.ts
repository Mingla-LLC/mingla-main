/**
 * #4490 spec 08 O2 — pure display state for Tap to pay and Scan to pay: the
 * staff sheet's scan panel, the late-money banner and the guest's pay page.
 * No React, no network: every rule here is tested on its own.
 */
import type { TillPayment, TillSale } from "../../../services/venueTillService";
import { randomUuid } from "../../../utils/randomId";
import { TILL_COPY } from "./tillCopy";

/**
 * 08-O3 fix 4 (O3-S2): the one id every Till payment and refund carries
 * (`clientRequestId`). venue-till refuses anything that is not a UUID (its
 * `UUID` pattern; the column is PostgreSQL uuid), so this is `randomUuid()`,
 * never `randomId()`, which on Hermes is not a UUID. It only has to be unique
 * per attempt (a retry reuses it); it is not a secret.
 */
export const newTillRequestId = (): string => randomUuid();

/**
 * 08-O3 fix 5 (O3-S3): one request id per payment or refund ATTEMPT.
 *
 * An attempt is named by the money facts it sends (`tillAttemptKey`): for a
 * payment the method, amount, tip and cash given (tap / scan: the method and
 * tip; the server takes what is left); for a refund the payment (or line), the
 * amount and the tip. The same facts again, after a network failure or a
 * timeout, reuse the id, so the server answers the first try instead of taking
 * the money twice. Any other facts get a fresh id.
 *
 * The check version is NOT part of the key on purpose: when a first try did
 * land and only its answer was lost, the check's version has moved (that
 * payment moved it); keying on the version would mint a new id and take the
 * money a second time. Every call still sends the version it saw (T10), so a
 * new attempt against a check changed elsewhere is refused, not taken.
 *
 * The id is dropped (`null`) once the server has answered: after a payment or
 * refund is taken, after a definite refusal (nothing moved), and whenever the
 * sheet goes back to the methods after a card payment was started, cancelled or
 * declined. Only an unclear failure (`tillAttemptKeepsId`) keeps it.
 */
export interface TillAttempt {
  readonly id: string;
  readonly key: string;
}

export const tillAttemptKey = (facts: Readonly<Record<string, string | number | null>>): string =>
  JSON.stringify(Object.keys(facts).sort().map((k) => [k, facts[k]]));

export const tillAttemptFor = (current: TillAttempt | null, key: string, makeId: () => string = newTillRequestId): TillAttempt =>
  current !== null && current.key === key ? current : { id: makeId(), key };

/** Only these failures may have reached the server: the retry keeps the id. */
export const tillAttemptKeepsId = (code: string): boolean => code === "network" || code === "till_failed";

/**
 * The amount the server RECORDED for a payment it answered (cash / own
 * machine: amount + tip, as the button said it), never the amount the sheet
 * typed: from the answer, else from the check's own payment row, else null
 * (the sheet then shows no figure rather than a guessed one).
 */
export const recordedPaidMinor = (paid: {
  paymentId: string;
  amountMinor: number | null;
  tipMinor: number | null;
  sale: Pick<TillSale, "payments"> | null;
}): number | null => {
  if (paid.amountMinor !== null) return paid.amountMinor + (paid.tipMinor ?? 0);
  const row = paid.sale?.payments.find((p) => p.id === paid.paymentId);
  return row !== undefined ? row.amountMinor + row.tipMinor : null;
};

const TILL_PAY_URL = /^https?:\/\/[^/\s#?]+\/pay\/till\/[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
export const TILL_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

/** Only a /pay/till/<code> link is ever drawn as a Till QR. */
export const toTillPayUrl = (value: unknown): string | null =>
  typeof value === "string" && TILL_PAY_URL.test(value) ? value : null;

/** "K7MP 4XRT": the code as staff read it aloud. */
export const spacedCode = (code: string): string => (TILL_CODE_RE.test(code) ? `${code.slice(0, 4)} ${code.slice(4)}` : code);

/** "14:32" until it runs out, then null. */
export const countdown = (expiresAt: string | null, nowMs: number): string | null => {
  if (expiresAt === null) return null;
  const left = Math.floor((Date.parse(expiresAt) - nowMs) / 1000);
  if (!Number.isFinite(left) || left <= 0) return null;
  const m = Math.floor(left / 60);
  const s = left % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
};

export type ScanPanel = "waiting" | "paying" | "paid" | "expired" | "cancelled";

/**
 * The staff side of one scan payment. A code past its time reads as expired
 * (the server closes it on the next read); money that lands later is late
 * money and shows on the check, never here.
 */
export const scanPanelState = (
  input: { status: string; paymentState: string; payStarted: boolean; expiresAt: string | null },
  nowMs: number,
): ScanPanel => {
  if (input.paymentState === "paid" || input.status === "paid") return "paid";
  if (input.status === "cancelled" || input.paymentState === "cancelled") return "cancelled";
  if (input.status === "expired" || countdown(input.expiresAt, nowMs) === null) return "expired";
  return input.payStarted ? "paying" : "waiting";
};

/** How a card or scan payment was paid, in the Till's words. */
export const paidLabel = (p: Pick<TillPayment, "method" | "providerChannel" | "cardBrand" | "cardLast4">): string => {
  if (p.method === "scan" && p.providerChannel === "bank_transfer") return TILL_COPY.paidByTransfer;
  if (p.method === "tap") {
    const card = [p.cardBrand ? p.cardBrand.charAt(0).toUpperCase() + p.cardBrand.slice(1) : null, p.cardLast4 ? `•••• ${p.cardLast4}` : null]
      .filter(Boolean)
      .join(" ");
    return card.length > 0 ? TILL_COPY.paidByCard(card) : TILL_COPY.tapToPay;
  }
  return TILL_COPY.paidOnPhone;
};

/** What a payment can still give back (amount and tip, less refunds). */
const refundable = (p: TillPayment): number => Math.max(p.amountMinor + p.tipMinor - p.refundedMinor, 0);

/**
 * "A cancelled payment was paid. Refund it or keep it as payment": a payment
 * that landed after it was cancelled (or its code expired), not kept and not
 * refunded yet. Keep is offered only while the check still has something to
 * pay; otherwise the extra is refunded.
 */
export const latePayments = (sale: TillSale | null): Array<{ payment: TillPayment; canKeep: boolean }> => {
  if (sale === null) return [];
  const open = sale.state === "open" || sale.state === "paying";
  return sale.payments
    .filter((p) => p.paidLate && !p.lateKept && (p.state === "paid" || p.state === "partially_refunded") && refundable(p) > 0)
    .map((payment) => ({ payment, canKeep: open && sale.remainingMinor > 0 && payment.refundedMinor === 0 }));
};

/**
 * #4490 O2 fix 3 (O2-B1): what the pay sheet opens on. A check that already has
 * a live card payment (a scan code still open, or a tap not yet finished) lands
 * on that payment's waiting panel, never on the method list the server would
 * refuse. Paid, cancelled, expired and no-payment checks open on the methods as
 * before. Read from the sale's own projection; nothing new is asked of the server.
 */
export type PayResume =
  | { kind: "none" }
  | { kind: "scan"; payment: TillPayment; code: string }
  | { kind: "tap"; payment: TillPayment };

export const resumeLivePayment = (
  sale: TillSale | null,
  nowMs: number,
  /** 08-O4: a share's own live payment; without it, only whole-check payments. */
  shareId: string | null = null,
): PayResume => {
  if (sale === null || (sale.state !== "open" && sale.state !== "paying")) return { kind: "none" };
  for (const payment of sale.payments) {
    if (payment.state !== "pending") continue;
    if ((payment.shareId ?? null) !== shareId) continue;
    if (payment.method === "scan") {
      const pc = payment.payCode;
      if (pc === null || !TILL_CODE_RE.test(pc.code)) continue;
      const panel = scanPanelState(
        { status: pc.status, paymentState: payment.state, payStarted: pc.payStarted, expiresAt: pc.expiresAt },
        nowMs,
      );
      if (panel === "waiting" || panel === "paying") return { kind: "scan", payment, code: pc.code };
    } else if (payment.method === "tap") {
      return { kind: "tap", payment };
    }
  }
  return { kind: "none" };
};

/** "Card {amount}, includes fees" only when the card takes more than the bill. */
export const cardTotalDiffers = (amountMinor: number, tipMinor: number, chargedMinor: number | null): boolean =>
  chargedMinor !== null && chargedMinor > amountMinor + tipMinor;

// The guest's pay page (/pay/till/<code>) model lives in tillGuestPayModel.ts
// (a leaf: the anonymous pay page loads it without the Till's copy).
export {
  GUEST_PAY_POLL_MS,
  GUEST_PAY_POLLS,
  guestPayFormErrors,
  guestPayState,
  mapTillPayView,
  type GuestPayState,
  type TillPayView,
} from "./tillGuestPayModel";
