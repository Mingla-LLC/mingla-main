import type { TicketStub } from "../store/draftEventStore";
import type { OrderRecord } from "../store/orderStore";
import { formatCount, formatCurrencyRound, currencyCodeOrNull } from "./currency";
import {
  summarizeEventMoney,
  type CurrencyMismatch,
} from "./moneySummary";

export interface EventSalesSummary {
  eventId: string;
  soldCount: number;
  onlineRevenue: number;
  // #962 G3 — null when the brand has no established currency (pre-bank);
  // the revenue label is then "—" (never a fabricated GBP).
  displayCurrency: string | null;
  mismatches: CurrencyMismatch[];
  finiteCapacity: number | null;
  hasUnlimitedTickets: boolean;
  soldLabel: string;
  revenueLabel: string;
  hasError: boolean;
}

export interface EventSalesSummaryInput {
  eventId: string;
  tickets: TicketStub[];
  eventCurrency?: string | null;
  brandDefaultCurrency?: string | null;
  orders: OrderRecord[];
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
  hasError = false,
}: EventSalesSummaryInput): EventSalesSummary => {
  // #962 G3 — null-safe: null when the brand has no established currency.
  // summarizeEventMoney accepts null and normalizes internally for its
  // (0-order, pre-bank) computation; the DISPLAY label hides when null.
  const displayCurrency = currencyCodeOrNull(eventCurrency ?? brandDefaultCurrency);
  const { finiteCapacity, hasUnlimitedTickets } = summarizeTicketCapacity(tickets);
  const soldCount = getEventTicketsSold(orders);
  const moneySummary = summarizeEventMoney({
    expectedCurrency: displayCurrency,
    orders,
    doorSales: [],
  });

  if (hasError) {
    return {
      eventId,
      soldCount: 0,
      onlineRevenue: 0,
      displayCurrency,
      mismatches: [],
      finiteCapacity,
      hasUnlimitedTickets,
      soldLabel: "Unable to load",
      revenueLabel: "Unable to load",
      hasError: true,
    };
  }

  const soldLabel =
    finiteCapacity !== null
      ? `${formatCount(soldCount)} / ${formatCount(finiteCapacity)}`
      : `${formatCount(soldCount)} sold`;
  const revenueLabel =
    displayCurrency === null
      ? "—"
      : moneySummary.mismatches.length > 0 && moneySummary.onlineRevenue === 0
        ? "Currency review"
        : formatCurrencyRound(moneySummary.onlineRevenue, displayCurrency);

  return {
    eventId,
    soldCount,
    onlineRevenue: moneySummary.onlineRevenue,
    displayCurrency,
    mismatches: moneySummary.mismatches,
    finiteCapacity,
    hasUnlimitedTickets,
    soldLabel,
    revenueLabel,
    hasError: false,
  };
};
