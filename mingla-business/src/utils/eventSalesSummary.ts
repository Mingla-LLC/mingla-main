import type { TicketStub } from "../store/draftEventStore";
import type { OrderRecord } from "../store/orderStore";
import { formatCount, formatCurrencyRound, normalizeCurrency } from "./currency";
import {
  summarizeEventMoney,
  type CurrencyMismatch,
} from "./moneySummary";

export interface EventSalesSummary {
  eventId: string;
  soldCount: number;
  onlineRevenue: number;
  displayCurrency: string;
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
  const displayCurrency = normalizeCurrency(eventCurrency ?? brandDefaultCurrency);
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
    moneySummary.mismatches.length > 0 && moneySummary.onlineRevenue === 0
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
