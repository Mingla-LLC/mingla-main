import type { TicketStub } from "../store/draftEventStore";
import type { OrderRecord } from "../store/orderStore";
import { formatCount, formatCurrencyRound, currencyCodeOrNull } from "./currency";
import {
  summarizeEventMoney,
  type CurrencyMismatch,
} from "./moneySummary";

export interface EventSalesSummary {
  eventId: string;
  soldCount: number | null;
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

export const getEventTicketsSold = (orders: OrderRecord[]): number =>
  orders.reduce((sum, order) => {
    if (!liveOrderStatuses.has(order.status)) return sum;
    return (
      sum +
      order.lines.reduce(
        (lineSum, line) =>
          lineSum + Math.max(0, line.quantity - line.refundedQuantity),
        0,
      )
    );
  }, 0);

export const buildEventSalesSummary = ({
  eventId,
  tickets,
  eventCurrency,
  brandDefaultCurrency,
  orders,
  readStatus: suppliedReadStatus,
  isRefreshing = false,
  hasError = false,
}: EventSalesSummaryInput): EventSalesSummary => {
  const readStatus: EventOrdersReadStatus =
    suppliedReadStatus ?? (hasError ? "error" : "ready");
  // #962 G3 — null-safe: null when the brand has no established currency.
  // summarizeEventMoney accepts null and normalizes internally for its
  // (0-order, pre-bank) computation; the DISPLAY label hides when null.
  const displayCurrency = currencyCodeOrNull(eventCurrency ?? brandDefaultCurrency);
  const { finiteCapacity, hasUnlimitedTickets } = summarizeTicketCapacity(tickets);
  const isReady =
    orders !== null && !(suppliedReadStatus === undefined && hasError);
  if (!isReady) {
    const isLoading = readStatus === "loading" || readStatus === "disabled";
    return {
      eventId,
      soldCount: null,
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
  const moneySummary = summarizeEventMoney({
    expectedCurrency: displayCurrency,
    orders: readyOrders,
    doorSales: [],
  });

  const soldLabel =
    finiteCapacity !== null
      ? `${formatCount(readySoldCount)} / ${formatCount(finiteCapacity)}`
      : `${formatCount(readySoldCount)} sold`;
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
