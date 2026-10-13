/**
 * toward #3697 Wave 2 — D1 platform minimums + hard-cap helpers (#3709 / #3701).
 *
 * One owner for Admin create, Ari plan (later), and builder validation.
 * Host minimums add Mingla's 15% fee on top of ad-budget floors; Admin has no fee.
 *
 * Table (USD minor / day) from Ads Design Contract v1.3:
 *   tiktok $50 · snapchat $20 · reddit $5 · google $0 · meta from connection (live)
 */

import type { Platform } from "./adChannelCore.ts";

export type BudgetMode = "daily" | "lifetime";
export type OwnerKind = "mingla" | "host";

/** USD cents per day used in the D1 sum (Seth's safer floor, contract v1.3). */
export const AD_PLATFORM_MINIMUMS_USD_CENTS_PER_DAY: Readonly<
  Record<Exclude<Platform, "meta">, number>
> = {
  tiktok: 5000,
  snapchat: 2000,
  reddit: 500,
  google: 0,
};

/** Google refuses a total/lifetime budget shorter than this many calendar days. */
export const GOOGLE_MIN_TOTAL_DAYS = 3;

/** Mingla pauses delivery at this fraction of the hard cap (contract). */
export const CAP_PAUSE_RATIO = 0.98;

/** Host pays this share as Mingla fee; ad budget = pay × (1 − fee). */
export const HOST_FEE_RATIO = 0.15;

/**
 * toward #3697 Wave 6 — standalone Ads credit top-up limits (Seth 2026-09-30):
 * at least $25 / £20 / ₦25,000; at most $5,000 (or currency peer).
 * Amounts are pay-cents (what the host is charged), not credit after fee.
 */
export const AD_CREDIT_TOP_UP_LIMITS_CENTS: Readonly<
  Record<"USD" | "GBP" | "NGN", { min_pay_cents: number; max_pay_cents: number }>
> = {
  USD: { min_pay_cents: 2500, max_pay_cents: 500_000 },
  GBP: { min_pay_cents: 2000, max_pay_cents: 500_000 },
  NGN: { min_pay_cents: 2_500_000, max_pay_cents: 750_000_000 },
};

export type AdCreditCurrency = keyof typeof AD_CREDIT_TOP_UP_LIMITS_CENTS;

export type AdCreditEntryKind = "top_up" | "withdraw" | "unspend_return";

/** Credit that lands in the wallet after the 15% fee is taken at top-up. */
export function creditCentsFromPay(payCents: number): number {
  if (!Number.isInteger(payCents) || payCents <= 0) return 0;
  return Math.floor(payCents * (1 - HOST_FEE_RATIO));
}

/** Fee Mingla keeps from a top-up payment (pay − credit). */
export function feeCentsFromPay(payCents: number): number {
  if (!Number.isInteger(payCents) || payCents <= 0) return 0;
  return payCents - creditCentsFromPay(payCents);
}

/**
 * Estimate-only inverse (single aggregate). Live withdraw uses FIFO lots via
 * `allocateWithdrawFromLots` so floor rounding on each top-up is preserved.
 */
export function refundCentsFromCredit(creditCents: number): number {
  if (!Number.isInteger(creditCents) || creditCents <= 0) return 0;
  return Math.ceil(creditCents / (1 - HOST_FEE_RATIO));
}

/** Remaining refundable slice of one top-up (matches `ad_credit_lots`). */
export interface AdCreditLotRemaining {
  id: string;
  credit_remaining_cents: number;
  pay_remaining_cents: number;
  fee_remaining_cents: number;
}

export interface AdCreditLotAllocation {
  lot_id: string;
  credit_cents: number;
  pay_cents: number;
  fee_cents: number;
}

/**
 * FIFO withdraw against top-up lots. Full lot drain returns exact remaining
 * pay/fee; partial drain scales pay by credit share (floor) and clamps fee.
 */
export function allocateWithdrawFromLots(
  lots: readonly AdCreditLotRemaining[],
  creditCents: number,
): {
  ok: true;
  allocations: AdCreditLotAllocation[];
  refund_cents: number;
  fee_returned_cents: number;
} | {
  ok: false;
  error: string;
  detail: string;
} {
  if (!Number.isInteger(creditCents) || creditCents <= 0) {
    return { ok: false, error: "validation_error", detail: "credit_cents_invalid" };
  }
  let need = creditCents;
  const allocations: AdCreditLotAllocation[] = [];
  let refund = 0;
  let feeReturned = 0;
  for (const lot of lots) {
    if (need <= 0) break;
    if (
      !Number.isInteger(lot.credit_remaining_cents) ||
      lot.credit_remaining_cents <= 0
    ) {
      continue;
    }
    const take = Math.min(lot.credit_remaining_cents, need);
    let payTake: number;
    let feeTake: number;
    if (take === lot.credit_remaining_cents) {
      payTake = lot.pay_remaining_cents;
      feeTake = lot.fee_remaining_cents;
    } else {
      payTake = Math.floor(
        (lot.pay_remaining_cents * take) / lot.credit_remaining_cents,
      );
      feeTake = payTake - take;
      if (feeTake < 0) {
        feeTake = 0;
        payTake = take;
      }
      if (feeTake > lot.fee_remaining_cents) {
        feeTake = lot.fee_remaining_cents;
        payTake = take + feeTake;
      }
    }
    allocations.push({
      lot_id: lot.id,
      credit_cents: take,
      pay_cents: payTake,
      fee_cents: feeTake,
    });
    refund += payTake;
    feeReturned += feeTake;
    need -= take;
  }
  if (need > 0) {
    return { ok: false, error: "insufficient_credit", detail: "lots_exhausted" };
  }
  return {
    ok: true,
    allocations,
    refund_cents: refund,
    fee_returned_cents: feeReturned,
  };
}

export function quoteTopUp(payCents: number, currency: string): {
  ok: true;
  currency: AdCreditCurrency;
  pay_cents: number;
  credit_cents: number;
  fee_cents: number;
} | {
  ok: false;
  error: string;
  detail: string;
} {
  const cur = currency.toUpperCase();
  if (!(cur in AD_CREDIT_TOP_UP_LIMITS_CENTS)) {
    return { ok: false, error: "validation_error", detail: "currency_unsupported" };
  }
  const limits = AD_CREDIT_TOP_UP_LIMITS_CENTS[cur as AdCreditCurrency];
  if (!Number.isInteger(payCents) || payCents <= 0) {
    return { ok: false, error: "validation_error", detail: "pay_cents_invalid" };
  }
  if (payCents < limits.min_pay_cents) {
    return { ok: false, error: "validation_error", detail: "pay_below_minimum" };
  }
  if (payCents > limits.max_pay_cents) {
    return { ok: false, error: "validation_error", detail: "pay_above_maximum" };
  }
  const credit = creditCentsFromPay(payCents);
  if (credit <= 0) {
    return { ok: false, error: "validation_error", detail: "credit_zero" };
  }
  return {
    ok: true,
    currency: cur as AdCreditCurrency,
    pay_cents: payCents,
    credit_cents: credit,
    fee_cents: feeCentsFromPay(payCents),
  };
}

export function quoteWithdraw(creditCents: number): {
  ok: true;
  credit_cents: number;
  refund_cents: number;
  fee_returned_cents: number;
} | {
  ok: false;
  error: string;
  detail: string;
} {
  if (!Number.isInteger(creditCents) || creditCents <= 0) {
    return { ok: false, error: "validation_error", detail: "credit_cents_invalid" };
  }
  const refund = refundCentsFromCredit(creditCents);
  return {
    ok: true,
    credit_cents: creditCents,
    refund_cents: refund,
    fee_returned_cents: refund - creditCents,
  };
}

export interface AdMinimumBreakdownRow {
  platform: Platform;
  per_day_cents: number;
  days: number;
  subtotal_cents: number;
}

export interface AdMinimumResult {
  min_budget_cents: number;
  min_pay_cents: number;
  breakdown: AdMinimumBreakdownRow[];
  message: string;
}

export interface ComputeAdMinimumInput {
  platforms: readonly Platform[];
  /** Calendar days in the schedule (≥1). Ignored for daily mode (treated as 1). */
  days: number;
  mode: BudgetMode;
  ownerKind?: OwnerKind;
  /** Meta floor from ad_connections.extra.minimum_budgets (cents/day). */
  metaFloorCents?: number | null;
}

export function normalizeDays(days: unknown): number {
  const n = typeof days === "number" ? days : Number(days);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

/**
 * Inclusive calendar-day span between two ISO timestamps (UTC date parts).
 * Returns null when either side is missing/invalid or end is before start.
 */
export function calendarDaysBetween(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
): number | null {
  if (!startsAt || !endsAt) return null;
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  const startDay = Date.UTC(
    new Date(start).getUTCFullYear(),
    new Date(start).getUTCMonth(),
    new Date(start).getUTCDate(),
  );
  const endDay = Date.UTC(
    new Date(end).getUTCFullYear(),
    new Date(end).getUTCMonth(),
    new Date(end).getUTCDate(),
  );
  return Math.floor((endDay - startDay) / 86_400_000) + 1;
}

export function parseCampaignSchedule(raw: unknown): {
  starts_at: string | null;
  ends_at: string | null;
  days: number | null;
} {
  const obj = raw && typeof raw === "object"
    ? raw as Record<string, unknown>
    : {};
  const starts = typeof obj.starts_at === "string" && obj.starts_at.trim()
    ? obj.starts_at.trim()
    : typeof obj.schedule_start_at === "string" && obj.schedule_start_at.trim()
    ? obj.schedule_start_at.trim()
    : null;
  const ends = typeof obj.ends_at === "string" && obj.ends_at.trim()
    ? obj.ends_at.trim()
    : typeof obj.schedule_end_at === "string" && obj.schedule_end_at.trim()
    ? obj.schedule_end_at.trim()
    : null;
  return {
    starts_at: starts,
    ends_at: ends,
    days: calendarDaysBetween(starts, ends),
  };
}

export function perDayFloorCents(
  platform: Platform,
  metaFloorCents: number | null | undefined,
): number {
  if (platform === "meta") {
    return typeof metaFloorCents === "number" && metaFloorCents > 0
      ? Math.floor(metaFloorCents)
      : 500; // LINK_CLICKS high-freq fallback until connection floors load
  }
  return AD_PLATFORM_MINIMUMS_USD_CENTS_PER_DAY[platform];
}

/**
 * D1: sum(per-platform daily floor) × days for lifetime; daily mode uses days=1.
 * Host min_pay = ceil(min_budget / 0.85).
 */
export function computeAdMinimum(
  input: ComputeAdMinimumInput,
): AdMinimumResult {
  const days = input.mode === "daily" ? 1 : normalizeDays(input.days);
  const ownerKind = input.ownerKind ?? "mingla";
  const breakdown: AdMinimumBreakdownRow[] = [];
  let minBudget = 0;
  for (const platform of input.platforms) {
    const perDay = perDayFloorCents(platform, input.metaFloorCents);
    const subtotal = perDay * days;
    breakdown.push({
      platform,
      per_day_cents: perDay,
      days,
      subtotal_cents: subtotal,
    });
    minBudget += subtotal;
  }
  const minPay = ownerKind === "host"
    ? Math.ceil(minBudget / (1 - HOST_FEE_RATIO))
    : minBudget;
  const platformList = input.platforms.join(", ") || "platforms";
  const message = input.mode === "daily"
    ? `${platformList} need at least $${(minBudget / 100).toFixed(2)} a day.`
    : `${platformList} for ${days} day${days === 1 ? "" : "s"} need at least $${
      (minBudget / 100).toFixed(2)
    } of ad budget.`;
  return {
    min_budget_cents: minBudget,
    min_pay_cents: minPay,
    breakdown,
    message,
  };
}

/** Hard cap: lifetime amount, or explicit cap, or daily × days when dates exist. */
export function computeCapCents(input: {
  mode: BudgetMode;
  amountCents: number;
  days: number | null;
  capCents?: number | null;
}): number {
  if (
    typeof input.capCents === "number" && Number.isInteger(input.capCents) &&
    input.capCents > 0
  ) {
    return input.capCents;
  }
  if (input.mode === "lifetime") return input.amountCents;
  const days = input.days != null ? normalizeDays(input.days) : null;
  if (days != null) return input.amountCents * days;
  // Daily with no end date: cap = daily amount (Mingla still pauses at 98% of that).
  return input.amountCents;
}

export function capPauseThresholdCents(capCents: number): number {
  if (!Number.isInteger(capCents) || capCents <= 0) return 0;
  return Math.floor(capCents * CAP_PAUSE_RATIO);
}

export function shouldPauseForCap(
  spendCents: number,
  capCents: number | null | undefined,
): boolean {
  if (
    typeof capCents !== "number" || !Number.isInteger(capCents) || capCents <= 0
  ) {
    return false;
  }
  if (!Number.isFinite(spendCents) || spendCents < 0) return false;
  return spendCents >= capPauseThresholdCents(capCents);
}

export function googleTotalDaysOk(
  mode: BudgetMode,
  days: number | null,
): boolean {
  if (mode !== "lifetime") return true;
  if (days == null) return false;
  return days >= GOOGLE_MIN_TOTAL_DAYS;
}
