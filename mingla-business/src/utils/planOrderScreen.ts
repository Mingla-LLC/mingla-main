/**
 * issue #4522 G-7 — what the Host order screen says about a trip order bought
 * on a payment plan (an older plan or the new one).
 *
 * A plan order stores only the DEPOSIT as its total, and a card cancel leaves
 * its payment status at "partial refund" even after everything was refunded,
 * so the generic screen's "Partially refunded $300" / "Total $300" / "Refund
 * again" are all wrong for it. Every figure here is the server's: the balance
 * reader `biz_trip_event_balances` (paid / left / total) and the order's own
 * cancel time. Nothing is added up on the client.
 *
 * Refunds for a plan order are made from the trip's money screen ("Cancel &
 * refund"), which cancels the booking and returns what was paid in one step;
 * the single-order refund sheet cannot size a plan order.
 */
import type { HostTripBalance } from "../services/orderInstallmentsService";
import { formatCurrency } from "./currency";

export const PLAN_ORDER_REFUND_NOTE_COPY =
  "Refunds for a booking on a payment plan are made from the trip's money screen. Open it and use Cancel & refund.";
export const PLAN_ORDER_OPEN_MONEY_COPY = "Open trip money";
export const PLAN_ORDER_CANCELLED_REFUNDS_COPY =
  "Cancelled · refunds are listed below";
export const PLAN_ORDER_CANCELLED_NO_REFUND_COPY =
  "Cancelled · no refund recorded";

export interface PlanOrderBanner {
  tone: "paid" | "cancelled";
  copy: string;
}

export interface PlanOrderView {
  cancelled: boolean;
  banner: PlanOrderBanner;
  /** The server's figures, formatted; the screen shows them as rows. */
  paid: string;
  /** Null once cancelled (nothing is left to collect). */
  left: string | null;
  tripTotal: string | null;
}

export function derivePlanOrderView(
  order: {
    cancelledAt: string | null;
    refunds: readonly unknown[];
    currency: string | null;
  },
  balance: HostTripBalance,
): PlanOrderView {
  const currency = order.currency ?? balance.currency;
  const money = (minor: number): string => formatCurrency(minor, currency, true);
  const cancelled = order.cancelledAt !== null;
  const hasRefunds = order.refunds.length > 0;
  if (cancelled) {
    return {
      cancelled,
      banner: {
        tone: "cancelled",
        copy: hasRefunds
          ? PLAN_ORDER_CANCELLED_REFUNDS_COPY
          : PLAN_ORDER_CANCELLED_NO_REFUND_COPY,
      },
      paid: money(balance.paidMinor),
      left: null,
      tripTotal: null,
    };
  }
  const copy =
    balance.remainingMinor > 0
      ? `Paid ${money(balance.paidMinor)} of ${money(balance.totalMinor)} · ${money(balance.remainingMinor)} left`
      : `Paid in full · ${money(balance.totalMinor)}`;
  return {
    cancelled,
    banner: {
      tone: "paid",
      copy: hasRefunds ? `${copy} · refunds are listed below` : copy,
    },
    paid: money(balance.paidMinor),
    left: money(balance.remainingMinor),
    tripTotal: money(balance.totalMinor),
  };
}
