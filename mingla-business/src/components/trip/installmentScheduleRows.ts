import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";
import type { InstallmentChargeSchedule } from "@mingla/offering-rendering/discountQuote";

import { formatCalendarDate } from "../../utils/calendarDate";

export interface InstallmentScheduleDisplaySchedule {
  fullPriceCents: number;
  depositCents: number;
  /** 3-letter ISO 4217 currency code from the trip. */
  currency: string;
  installments: {
    ordinal: number;
    pct: number;
    amountCents: number;
    /** ISO 8601 UTC. */
    dueAt: string;
    /**
     * True when dueAt is a calendar date pinned to UTC rather than a moment.
     * Calendar dates render as the same day in every timezone.
     */
    dueIsCalendarDate?: boolean;
  }[];
}

export interface InstallmentScheduleDisplayRows {
  deposit: { label: string; amount: string };
  installments: { ordinal: number; label: string; amount: string }[];
  total: string;
  depositFormatted: string;
  remainingFormatted: string;
}

function formatCurrency(cents: number, currency: string): string {
  try {
    return withCurrencyGlyph(
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency.toUpperCase(),
      }).format(cents / 100),
      currency,
    );
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);
  } catch {
    return iso;
  }
}

function formatDueDate(inst: { dueAt: string; dueIsCalendarDate?: boolean }): string {
  if (inst.dueIsCalendarDate === true) {
    const label = formatCalendarDate(inst.dueAt);
    if (label.length > 0) return label;
  }
  return formatDate(inst.dueAt);
}

/**
 * Pure row builder used by the renderer and regression tests. A server-locked
 * charge schedule always wins over client projection math and may represent a
 * mixed cart, so it is consumed as one aggregate schedule rather than copied
 * into each tier card.
 */
export function buildInstallmentScheduleRows(input: {
  schedule: InstallmentScheduleDisplaySchedule;
  lockedChargeSchedule?: InstallmentChargeSchedule;
  depositChargeCents?: number;
}): InstallmentScheduleDisplayRows {
  const { schedule, lockedChargeSchedule, depositChargeCents } = input;
  if (lockedChargeSchedule !== undefined) {
    const deposit = depositChargeCents ?? schedule.depositCents;
    const remaining = lockedChargeSchedule.payments.reduce(
      (sum, payment) => sum + payment.buyerTotalCents,
      0,
    );
    return {
      deposit: { label: "Today", amount: formatCurrency(deposit, lockedChargeSchedule.currency) },
      installments: lockedChargeSchedule.payments.map((payment) => ({
        ordinal: payment.ordinal,
        label: formatDate(payment.dueAt),
        amount: formatCurrency(payment.buyerTotalCents, lockedChargeSchedule.currency),
      })),
      total: formatCurrency(deposit + remaining, lockedChargeSchedule.currency),
      depositFormatted: formatCurrency(deposit, lockedChargeSchedule.currency),
      remainingFormatted: formatCurrency(remaining, lockedChargeSchedule.currency),
    };
  }

  // #3645 — before the server quote locks each all-in NGN charge, do not imply
  // a naira amount from client projection math. Show plan percentages and dates.
  const ngnPreQuote = schedule.currency.toUpperCase() === "NGN";
  const remainingPct = schedule.installments.reduce((sum, inst) => sum + inst.pct, 0);
  const depositPct = Math.max(0, 100 - remainingPct);
  return {
    deposit: {
      label: "Deposit today",
      amount: ngnPreQuote
        ? `${depositPct}%`
        : formatCurrency(depositChargeCents ?? schedule.depositCents, schedule.currency),
    },
    installments: schedule.installments.map((inst) => ({
      ordinal: inst.ordinal,
      label: formatDueDate(inst),
      amount: ngnPreQuote ? `${inst.pct}%` : formatCurrency(inst.amountCents, schedule.currency),
    })),
    total: ngnPreQuote ? "100%" : formatCurrency(schedule.fullPriceCents, schedule.currency),
    depositFormatted: ngnPreQuote
      ? `${depositPct}%`
      : formatCurrency(depositChargeCents ?? schedule.depositCents, schedule.currency),
    remainingFormatted: ngnPreQuote
      ? `${remainingPct}%`
      : formatCurrency(
        schedule.installments.reduce((sum, inst) => sum + inst.amountCents, 0),
        schedule.currency,
      ),
  };
}
