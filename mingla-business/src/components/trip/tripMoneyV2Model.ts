/**
 * issue #4522 S-2 (spec §9.11) — the host money screen's view of one plan-v2
 * order. Pure: the route passes the order's installment rows and the server's
 * balance (issue_4522_balance). Every money figure comes from the server
 * balance or a row as stored; nothing here recomputes what is owed.
 */

import type {
  HostTripBalance,
  OrderInstallmentForBrand,
} from "../../services/orderInstallmentsService";

export type TripMoneyV2Chip =
  | "scheduled"
  | "paid"
  | "paid_partial"
  | "failed"
  | "rebalanced"
  | "refunded"
  | "cancelled";

export const TRIP_MONEY_V2_CHIP_LABEL: Record<TripMoneyV2Chip, string> = {
  scheduled: "Scheduled",
  paid: "Paid",
  paid_partial: "Paid · partial",
  failed: "Failed",
  rebalanced: "Rebalanced",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

export interface TripMoneyV2LedgerRow {
  key: string;
  kind: "deposit" | "payment";
  /** null for the deposit (paid at booking). */
  installment: OrderInstallmentForBrand | null;
  dueAt: string | null;
  amountMinor: number;
  chip: TripMoneyV2Chip;
}

export interface TripMoneyV2HistoryItem {
  key: string;
  at: string;
  text: string;
}

export interface TripMoneyV2View {
  termsLine: string;
  ledger: TripMoneyV2LedgerRow[];
  /** Nothing is owed (paid in full). A balance is never written off. */
  settled: boolean;
  /**
   * issue #4522 — what is still owed is below the provider's minimum: it
   * stays owed (Scheduled, its true amount) but cannot be charged, so there
   * is no Charge now; Mingla's ops team follows up.
   */
  belowProviderMinimum: boolean;
  /** A traveler payment (flexible payment or a charge) is still processing. */
  paymentInFlight: boolean;
  /** The row Charge now / Send reminder act on: the next open scheduled row. */
  nextOpenRow: OrderInstallmentForBrand | null;
  nextPayment: { dueAt: string; amountMinor: number } | null;
  overpaymentLines: string[];
  history: TripMoneyV2HistoryItem[];
}

export const TRIP_MONEY_V2_IN_FLIGHT_COPY = "A traveler payment is processing.";
export const TRIP_MONEY_V2_BELOW_MINIMUM_COPY =
  "Too small for the payment provider to charge. Mingla will follow up.";
/** issue #4522 X-8 — an overpayment refund stopped for Mingla support (needs ops). */
export const TRIP_MONEY_V2_NEEDS_OPS_COPY = "Mingla support is handling the refund";

/**
 * issue #4522 X-7 / G-8 — a refunded or cancelled order. The payment status
 * says it for a second-provider order; a card order the host cancelled keeps
 * 'partial_refund' even after every part was refunded, so its cancel time
 * (orders.cancelled_at) says "Cancelled" for it, old plan and new plan alike.
 */
export function closedOrderState(
  paymentStatus: string | undefined,
  cancelledAt?: string | null,
): "refunded" | "cancelled" | null {
  if (paymentStatus === "refunded") return "refunded";
  if (paymentStatus === "cancelled") return "cancelled";
  if (typeof cancelledAt === "string" && cancelledAt.length > 0) return "cancelled";
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function rowChip(row: OrderInstallmentForBrand): TripMoneyV2Chip | null {
  if (row.kind === "flex") {
    // An open flexible payment is "processing", and a closed attempt (failed
    // or abandoned) was never an instalment: neither is a ledger row.
    if (row.status === "collected") return "paid_partial";
    if (row.status === "refunded") return "refunded";
    return null;
  }
  switch (row.status) {
    case "scheduled":
      return "scheduled";
    case "collected":
      return "paid";
    case "failed":
      return "failed";
    case "refunded":
      return "refunded";
    case "cancelled":
      return "cancelled";
    case "superseded":
      return "rebalanced";
    default: {
      const unreachable: never = row.status;
      return unreachable;
    }
  }
}

/**
 * Whole calendar days from the last payment's due date (read in the order's own
 * zone) to the trip's date. A trip date is its stored calendar date (#4522 W-1),
 * so the two dates are compared as dates, not as instants: 09:00 in New York a
 * month before is 30 days, not 29.4.
 */
export function calendarDaysBefore(
  tripStartAt: string,
  finalDueAt: string,
  timeZone: string | null,
): number {
  let dueDate = finalDueAt.slice(0, 10);
  if (timeZone !== null) {
    try {
      dueDate = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(finalDueAt));
    } catch {
      // An unknown zone name: the UTC date is the nearest honest reading.
    }
  }
  return Math.round((Date.parse(tripStartAt.slice(0, 10)) - Date.parse(dueDate)) / DAY_MS);
}

function termsLine(
  balance: HostTripBalance,
  rows: readonly OrderInstallmentForBrand[],
  money: (minor: number) => string,
): string {
  const { terms } = balance;
  const count =
    terms.countGiven ??
    new Set(rows.filter((row) => row.kind !== "flex").map((row) => row.dueAt)).size;
  let line = `${money(balance.depositMinor)} deposit, then ${count} payment${count === 1 ? "" : "s"}`;
  if (terms.finalDueAt !== null && terms.tripStartAt !== null) {
    const days = calendarDaysBefore(terms.tripStartAt, terms.finalDueAt, terms.timeZone ?? null);
    if (days >= 0) {
      line += `, last one ${days} day${days === 1 ? "" : "s"} before departure`;
    }
  }
  if (terms.flexEnabled) line += " · any amount allowed";
  return line;
}

function historyText(
  event: HostTripBalance["balanceEvents"][number],
  rowsById: ReadonlyMap<string, OrderInstallmentForBrand>,
  money: (minor: number) => string,
): string {
  if (event.reason === "missed_rollover") {
    return "Missed payment moved to later payments.";
  }
  if (event.reason === "flex_payment" && event.triggerInstallmentId !== null) {
    const paid = rowsById.get(event.triggerInstallmentId);
    if (paid !== undefined) {
      return `Traveler paid ${money(paid.amountCents)}. Remaining payments updated.`;
    }
  }
  return "Remaining payments updated.";
}

export function buildTripMoneyV2View(input: {
  rows: readonly OrderInstallmentForBrand[];
  balance: HostTripBalance;
  money: (minor: number) => string;
}): TripMoneyV2View {
  const { balance, money } = input;
  const rows = [...input.rows].sort(
    (a, b) => a.dueAt.localeCompare(b.dueAt) || a.ordinal - b.ordinal,
  );
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const ledger: TripMoneyV2LedgerRow[] = [
    {
      key: `${balance.orderId}:deposit`,
      kind: "deposit",
      installment: null,
      dueAt: null,
      amountMinor: balance.depositMinor,
      chip: "paid",
    },
  ];
  for (const row of rows) {
    const chip = rowChip(row);
    if (chip === null) continue;
    ledger.push({
      key: row.id,
      kind: "payment",
      installment: row,
      dueAt: row.dueAt,
      amountMinor: row.amountCents,
      chip,
    });
  }
  const settled = balance.remainingMinor === 0;
  const openFlex = rows.some((row) => row.kind === "flex" && row.status === "scheduled");
  const nextOpenId = balance.openRowIds[0];
  const nextOpenRow =
    settled || nextOpenId === undefined ? null : rowsById.get(nextOpenId) ?? null;
  const overpaymentLines: string[] = [];
  // issue #4522 X-8 — a refund that stopped for Mingla support is not
  // "Refunding": it waits for a person (Admin: needs ops).
  const needsOps = Math.min(balance.needsOpsCreditMinor, balance.heldCreditMinor);
  const refunding = balance.heldCreditMinor - needsOps;
  if (refunding > 0) {
    overpaymentLines.push(
      `Paid ${money(refunding)} more than the balance · Refunding`,
    );
  }
  if (needsOps > 0) {
    overpaymentLines.push(
      `Paid ${money(needsOps)} more than the balance · ${TRIP_MONEY_V2_NEEDS_OPS_COPY}`,
    );
  }
  if (balance.overpaymentRefundedMinor > 0) {
    overpaymentLines.push(
      `Paid ${money(balance.overpaymentRefundedMinor)} more than the balance · Refunded`,
    );
  }
  return {
    termsLine: termsLine(balance, rows, money),
    ledger,
    settled,
    belowProviderMinimum: balance.remainingMinor > 0 &&
      balance.remainingMinor < balance.providerMinimumMinor,
    paymentInFlight: balance.paymentInFlight || openFlex,
    nextOpenRow,
    nextPayment:
      settled || balance.nextPayment === null
        ? null
        : { dueAt: balance.nextPayment.dueAt, amountMinor: balance.nextPayment.amountMinor },
    overpaymentLines,
    history: balance.balanceEvents.map((event, index) => ({
      key: `${balance.orderId}:event:${index}`,
      at: event.createdAt,
      text: historyText(event, rowsById, money),
    })),
  };
}
