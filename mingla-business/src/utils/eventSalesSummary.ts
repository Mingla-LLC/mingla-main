import type { TicketStub } from "../store/draftEventStore";
import type { OrderRecord } from "../store/orderStore";
import { guestListTicketCount, isCompOrder } from "./compOrders";
import { formatCount, formatCurrencyRound, currencyCodeOrNull } from "./currency";
import {
  summarizeEventMoney,
  type CurrencyMismatch,
} from "./moneySummary";

export interface EventSalesSummary {
  eventId: string;
  soldCount: number | null;
  /** issue #3827 — unique server tickets with a successful first admission. */
  scannedCount?: number | null;
  /** issue #3827 — live guest-list tickets (take a place, never sold). */
  guestListCount?: number | null;
  /** issue #3827 — sold + guest list: every place issued. */
  issuedCount?: number | null;
  onlineRevenue: number | null;
  // #962 G3 — null when the brand has no established currency (pre-bank);
  // the revenue label is then "—" (never a fabricated GBP).
  displayCurrency: string | null;
  mismatches: CurrencyMismatch[];
  finiteCapacity: number | null;
  hasUnlimitedTickets: boolean;
  soldLabel: string;
  revenueLabel: string;
  readStatus: EventOrdersReadStatus;
  isRefreshing: boolean;
  /** Compatibility projection; new consumers must branch on readStatus. */
  hasError: boolean;
}

export type EventOrdersReadStatus =
  | "disabled"
  | "loading"
  | "error"
  | "ready"
  | "stale-error";

export interface EventSalesSummaryInput {
  eventId: string;
  tickets: TicketStub[];
  eventCurrency?: string | null;
  brandDefaultCurrency?: string | null;
  orders: OrderRecord[] | null;
  readStatus?: EventOrdersReadStatus;
  isRefreshing?: boolean;
  /** Compatibility input for existing pure tests; hooks use readStatus. */
  hasError?: boolean;
  /**
   * issue #3313 — true on a recurring event, where capacity is PER NIGHT. The
   * run's total sold is then not comparable with the capacity, so no
   * sold / capacity figure or progress is produced: the label reads
   * "{sold} sold · {capacity} per night".
   */
  capacityPerNight?: boolean;
}

const liveOrderStatuses = new Set<OrderRecord["status"]>([
  "paid",
  "refunded_partial",
]);

export const summarizeTicketCapacity = (
  tickets: TicketStub[],
): Pick<EventSalesSummary, "finiteCapacity" | "hasUnlimitedTickets"> => {
  let finiteCapacity = 0;
  let hasUnlimitedTickets = false;

  for (const ticket of tickets) {
    if (ticket.isUnlimited) {
      hasUnlimitedTickets = true;
      continue;
    }
    finiteCapacity += ticket.capacity ?? 0;
  }

  return {
    finiteCapacity: finiteCapacity > 0 ? finiteCapacity : null,
    hasUnlimitedTickets,
  };
};

// issue #3827 — sales only: guest-list tickets are never "sold".
export const getEventTicketsSold = (orders: OrderRecord[]): number =>
  orders.reduce((sum, order) => {
    if (!liveOrderStatuses.has(order.status)) return sum;
    if (isCompOrder(order)) return sum;
    return (
      sum +
      order.lines.reduce(
        (lineSum, line) =>
          lineSum + Math.max(0, line.quantity - line.refundedQuantity),
        0,
      )
    );
  }, 0);

/**
 * issue #3827 — `usedAt` is written by the authoritative ticket-scan RPC on
 * the first successful admission, including a partly consumed multi-day pass.
 * Count unique ticket ids so a joined or duplicated order row cannot inflate
 * the live Home metric.
 */
export const getEventTicketsScanned = (orders: OrderRecord[]): number => {
  const ticketIds = new Set<string>();
  for (const order of orders) {
    for (const ticket of order.ticketDays ?? []) {
      if (ticket.usedAt !== null) ticketIds.add(ticket.ticketId);
    }
  }
  return ticketIds.size;
};

export const buildEventSalesSummary = ({
  eventId,
  tickets,
  eventCurrency,
  brandDefaultCurrency,
  orders,
  readStatus: suppliedReadStatus,
  isRefreshing = false,
  hasError = false,
  capacityPerNight = false,
}: EventSalesSummaryInput): EventSalesSummary => {
  const readStatus: EventOrdersReadStatus =
    suppliedReadStatus ?? (hasError ? "error" : "ready");
  // #962 G3 — null-safe: null when the brand has no established currency.
  // summarizeEventMoney accepts null and normalizes internally for its
  // (0-order, pre-bank) computation; the DISPLAY label hides when null.
  const displayCurrency = currencyCodeOrNull(eventCurrency ?? brandDefaultCurrency);
  const ticketCapacity = summarizeTicketCapacity(tickets);
  // issue #3281 — a listed ticket's capacity is per date, so a sum mixes units.
  const anyDayLimited = tickets.some((ticket) => ticket.validDayIds != null);
  const perNightCapacity =
    capacityPerNight && !anyDayLimited ? ticketCapacity.finiteCapacity : null;
  // issue #3313 — a per-night capacity is never a denominator for the run.
  const finiteCapacity =
    capacityPerNight || anyDayLimited ? null : ticketCapacity.finiteCapacity;
  const { hasUnlimitedTickets } = ticketCapacity;
  const isReady =
    orders !== null && !(suppliedReadStatus === undefined && hasError);
  if (!isReady) {
    const isLoading = readStatus === "loading" || readStatus === "disabled";
    return {
      eventId,
      soldCount: null,
      scannedCount: null,
      guestListCount: null,
      issuedCount: null,
      onlineRevenue: null,
      displayCurrency,
      mismatches: [],
      finiteCapacity,
      hasUnlimitedTickets,
      soldLabel: isLoading ? "Loading…" : "Unable to load",
      revenueLabel: isLoading ? "Loading…" : "Unable to load",
      readStatus,
      isRefreshing: false,
      hasError: readStatus === "error",
    };
  }
  const readyOrders = orders ?? [];
  const readySoldCount = getEventTicketsSold(readyOrders);
  const readyScannedCount = getEventTicketsScanned(readyOrders);
  const readyGuestListCount = guestListTicketCount(readyOrders);
  // issue #3827 — "12 sold · 30 guest list / 100" once anyone is on the list.
  const guestListFragment =
    readyGuestListCount > 0 ? ` · ${formatCount(readyGuestListCount)} guest list` : "";
  const moneySummary = summarizeEventMoney({
    expectedCurrency: displayCurrency,
    orders: readyOrders,
    doorSales: [],
  });

  const soldLabel =
    finiteCapacity !== null
      ? readyGuestListCount > 0
        ? `${formatCount(readySoldCount)} sold${guestListFragment} / ${formatCount(finiteCapacity)}`
        : `${formatCount(readySoldCount)} / ${formatCount(finiteCapacity)}`
      : perNightCapacity !== null
        ? `${formatCount(readySoldCount)} sold${guestListFragment} · ${formatCount(perNightCapacity)} per night`
        : `${formatCount(readySoldCount)} sold${guestListFragment}`;
  const revenueLabel =
    displayCurrency === null
      ? "—"
      : readStatus === "stale-error"
        ? "Unable to refresh"
        : moneySummary.mismatches.length > 0 && moneySummary.onlineRevenue === 0
        ? "Currency review"
        : formatCurrencyRound(moneySummary.onlineRevenue, displayCurrency);

  return {
    eventId,
    soldCount: readySoldCount,
    scannedCount: readyScannedCount,
    guestListCount: readyGuestListCount,
    issuedCount: readySoldCount + readyGuestListCount,
    onlineRevenue: moneySummary.onlineRevenue,
    displayCurrency,
    mismatches: moneySummary.mismatches,
    finiteCapacity,
    hasUnlimitedTickets,
    soldLabel,
    revenueLabel,
    readStatus,
    isRefreshing,
    hasError: readStatus === "error",
  };
};
