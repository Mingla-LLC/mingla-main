/**
 * #4238 item 2 — the Host budget guidance model: the least each app accepts,
 * the "enough to learn" budget, and the results a budget should bring.
 *
 * @invariant I-4238-GUIDANCE-ONE-SOURCE
 *   owner: this module (hostBudgetGuidance)
 *   rule: Host and Ari budget numbers (minimum, recommended, expected results)
 *         come only from hostBudgetGuidance, served by ad-plan
 *         host_budget_guidance. Declared beside its test
 *         (_shared/__tests__/issue_4238_budget_guidance.test.ts).
 *
 * Money (F-1 / R-1): every amount the Host sees is in what the Host pays.
 * The model works on ad spend (credit = pay after the fee, from adMoney) and
 * grosses Host-facing figures up only through hostMinimumPayCents. Amounts
 * are minor units of the brand's currency (2 decimals, the ads convention).
 * Pure: the caller reads benchmarks inputs, own results and stock.
 */

import { creditCentsFromPay, hostMinimumPayCents } from "./adMoney.ts";
import {
  BAND_HIGH,
  BAND_LOW,
  LANDING_TO_RSVP,
  landingToTicket,
  typicalCpc,
  typicalCpcKnown,
} from "./adResultBenchmarks.ts";
import { splitDailyWithMinimums } from "./adHostPlanRules.ts";

export type GuidanceGoal = "sales" | "signups" | "visits";
export type GuidanceRunGoal = "purchase" | "checkout" | "signup" | "visit";
export type GuidanceResultKind = "tickets" | "sign_ups" | "visits";

/** Optimisation events a week an ad set needs to learn (Meta / TikTok ~50). */
export const LEARNING_EVENTS_PER_WEEK = 50;
/** Own results needed at a scope before they count (A1 / D-1). */
export const OWN_RESULTS_MIN = 5;
/** Own data weighs as much as the benchmark at this many results. */
export const OWN_RESULTS_PRIOR_WEIGHT = 20;
/** Started checkouts per purchase (stated default; used by the W2 ladder). */
export const CHECKOUT_PER_PURCHASE = 3;
/** Per-app cost factor on the benchmark (all 1.0 until Mingla data says otherwise). */
export const APP_COST_FACTOR: Readonly<Record<string, number>> = {
  meta: 1,
  tiktok: 1,
  snapchat: 1,
  google: 1,
  reddit: 1,
};

const MINOR_PER_MAJOR = 100;

export type GuidanceInput = {
  currency: string;
  goal: GuidanceGoal;
  /** What the Host pays per day, in total across the apps (pay terms). */
  dailyPayCents: number;
  /** Typical on-sale ticket price in USD major units (sales); null = unknown. */
  priceUsd: number | null;
  /** Each app's one-ad-set minimum in credit terms, brand currency. */
  apps: readonly { platform: string; minimumCreditCents: number }[];
  /** Mingla's own cost per result at the first scope with enough results. */
  own: { results: number; costPerResultCents: number } | null;
  /** Tickets / places left and the run length; null fields = unknown. */
  stock: { remaining: number | null; runDays: number | null } | null;
};

export type GuidanceWeek = {
  low: number;
  high: number;
  result: GuidanceResultKind;
};

export type GuidanceApp = {
  platform: string;
  minimum_daily_cents: number;
  minimum_daily_credit_cents: number;
  recommended_daily_cents: number;
  recommended_daily_credit_cents: number;
  run_goal: GuidanceRunGoal;
  expected_week: GuidanceWeek;
  /** #4238 W2: the uncapped mid estimate a week (the ladder's start rule). */
  expected_week_mid: number;
  learning_ok: boolean;
};

export type GuidanceResult =
  | {
    ok: true;
    currency: string;
    source: "benchmark" | "blended";
    cpc_assumed: boolean;
    price_assumed: boolean;
    cost_per_result_cents: number;
    per_app: GuidanceApp[];
    total: {
      minimum_daily_cents: number;
      recommended_daily_cents: number;
      expected_week: GuidanceWeek;
    };
    stock_limited: boolean;
  }
  | { ok: false; detail: "budget_invalid" | "apps_required" };

const RESULT_KIND: Record<GuidanceGoal, GuidanceResultKind> = {
  sales: "tickets",
  signups: "sign_ups",
  visits: "visits",
};
const RUN_GOAL: Record<GuidanceGoal, GuidanceRunGoal> = {
  sales: "purchase",
  signups: "signup",
  visits: "visit",
};

function ceilToMajor(minor: number): number {
  return Math.ceil(minor / MINOR_PER_MAJOR) * MINOR_PER_MAJOR;
}

/** The benchmark cost of one result, brand-currency minor units. */
export function benchmarkCostPerResultCents(
  currency: string,
  goal: GuidanceGoal,
  priceUsd: number | null,
): number {
  const cpcMinor = typicalCpc(currency) * MINOR_PER_MAJOR;
  if (goal === "visits") return cpcMinor;
  if (goal === "signups") return cpcMinor / LANDING_TO_RSVP;
  // Unknown price: the most conservative paid band (lowest conversion).
  const rate = priceUsd === null
    ? landingToTicket(Number.MAX_SAFE_INTEGER)
    : landingToTicket(priceUsd);
  return cpcMinor / rate;
}

/** (n·own + 20·bench) / (n + 20) once own data has at least 5 results. */
export function blendedCostPerResultCents(
  benchmark: number,
  own: { results: number; costPerResultCents: number } | null,
): { cost: number; source: "benchmark" | "blended" } {
  if (
    !own || !Number.isFinite(own.results) || own.results < OWN_RESULTS_MIN ||
    !Number.isFinite(own.costPerResultCents) || own.costPerResultCents <= 0
  ) return { cost: benchmark, source: "benchmark" };
  const n = own.results;
  return {
    cost: (n * own.costPerResultCents + OWN_RESULTS_PRIOR_WEIGHT * benchmark) /
      (n + OWN_RESULTS_PRIOR_WEIGHT),
    source: "blended",
  };
}

function weekRange(
  dailyCreditCents: number,
  cost: number,
  cap: number | null,
  result: GuidanceResultKind,
): { week: GuidanceWeek; mid: number } {
  const mid = cost > 0 ? (7 * dailyCreditCents) / cost : 0;
  let low = Math.floor(mid * BAND_LOW);
  let high = Math.floor(mid * BAND_HIGH);
  if (cap !== null) {
    low = Math.min(low, cap);
    high = Math.min(high, cap);
  }
  return { week: { low, high, result }, mid };
}

/** The guidance for one plan: per app and in total. */
export function hostBudgetGuidance(input: GuidanceInput): GuidanceResult {
  if (!Number.isSafeInteger(input.dailyPayCents) || input.dailyPayCents <= 0) {
    return { ok: false, detail: "budget_invalid" };
  }
  if (input.apps.length === 0) return { ok: false, detail: "apps_required" };
  const result = RESULT_KIND[input.goal];
  const benchmark = benchmarkCostPerResultCents(
    input.currency,
    input.goal,
    input.priceUsd,
  );
  const blended = blendedCostPerResultCents(benchmark, input.own);
  const dailyCredit = creditCentsFromPay(input.dailyPayCents);
  const platforms = input.apps.map((app) => app.platform);
  const minimums = Object.fromEntries(
    input.apps.map((app) => [app.platform, app.minimumCreditCents]),
  );
  const shares = splitDailyWithMinimums(dailyCredit, platforms, minimums);
  const remaining = input.stock?.remaining ?? null;
  const runDays = input.stock?.runDays ?? null;
  const stockCap = remaining !== null && remaining >= 0 ? remaining : null;
  // Learning needs ~50 a week on EVERY app; when the stock left over the run
  // can't feed that, the recommendation sells the remaining stock instead.
  const learningNeedOverRun = runDays !== null && runDays > 0
    ? (LEARNING_EVENTS_PER_WEEK * platforms.length * runDays) / 7
    : null;
  const stockLimited = stockCap !== null && learningNeedOverRun !== null &&
    learningNeedOverRun > stockCap;

  const perApp: GuidanceApp[] = input.apps.map((app, index) => {
    const cost = blended.cost * (APP_COST_FACTOR[app.platform] ?? 1);
    const costHigh = cost * BAND_HIGH;
    const learnCredit = ceilToMajor(
      (LEARNING_EVENTS_PER_WEEK / 7) * costHigh,
    );
    const stockCredit = stockLimited && runDays !== null
      ? ceilToMajor(
        ((stockCap as number) / platforms.length / runDays) * costHigh,
      )
      : null;
    const recommendedCredit = Math.max(
      app.minimumCreditCents,
      stockCredit ?? learnCredit,
    );
    const { week, mid } = weekRange(shares[index], cost, stockCap, result);
    return {
      platform: app.platform,
      minimum_daily_cents: hostMinimumPayCents(app.minimumCreditCents),
      minimum_daily_credit_cents: app.minimumCreditCents,
      recommended_daily_cents: hostMinimumPayCents(recommendedCredit),
      recommended_daily_credit_cents: recommendedCredit,
      run_goal: RUN_GOAL[input.goal],
      expected_week: week,
      expected_week_mid: Math.floor(mid),
      learning_ok: mid >= LEARNING_EVENTS_PER_WEEK,
    };
  });

  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const capTotal = (value: number) =>
    stockCap === null ? value : Math.min(value, stockCap);
  const minimumCredit = sum(input.apps.map((app) => app.minimumCreditCents));
  const recommendedCredit = sum(
    perApp.map((app) => app.recommended_daily_credit_cents),
  );
  return {
    ok: true,
    currency: input.currency,
    source: blended.source,
    cpc_assumed: !typicalCpcKnown(input.currency),
    price_assumed: input.goal === "sales" && input.priceUsd === null,
    cost_per_result_cents: Math.round(blended.cost),
    per_app: perApp,
    total: {
      minimum_daily_cents: hostMinimumPayCents(minimumCredit),
      recommended_daily_cents: hostMinimumPayCents(recommendedCredit),
      expected_week: {
        low: capTotal(sum(perApp.map((app) => app.expected_week.low))),
        high: capTotal(sum(perApp.map((app) => app.expected_week.high))),
        result,
      },
    },
    stock_limited: stockLimited,
  };
}

/** The typical on-sale price: the median of the paid tiers (minor units). */
export function typicalPaidPriceCents(
  tiers: readonly { is_free?: unknown; price_cents?: unknown }[],
): number | null {
  const prices = tiers
    .filter((tier) => tier.is_free !== true)
    .map((tier) => Number(tier.price_cents))
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);
  if (prices.length === 0) return null;
  return prices[Math.floor((prices.length - 1) / 2)];
}

/** #4238 item 5d: the slow-sales nudge window and thresholds (A5). */
export const NUDGE_EVENT_MIN_DAYS = 2;
export const NUDGE_EVENT_MAX_DAYS = 10;
export const NUDGE_MIN_DAYS_LIVE = 4;
export const NUDGE_LOOKBACK_DAYS = 4;
export const NUDGE_BELOW_RATIO = 0.5;
export const NUDGE_STOCK_LEFT_RATIO = 0.2;

/**
 * #4238 item 5d: true when sales are slower than the guidance expected: the
 * event is 2–10 days away, the ad has been live 4 days or more, the tickets
 * attributed over the last 4 days are below half of the guidance's LOW figure
 * for those 4 days, and 20% or more of the stock is left (unlimited counts as
 * left). Pure; the sweep records it once (I-4238-LOW-STOCK-ONCE) and W4
 * delivers the notification (business.ad_sales_slow).
 */
export function slowSalesNudgeDue(input: {
  nowMs: number;
  eventStartMs: number | null;
  liveSinceMs: number | null;
  ticketsLast4Days: number;
  /** The guidance's low expected results a week, at the plan's budget. */
  expectedWeekLow: number | null;
  stock:
    | { total: number | null; remaining: number | null; unlimited: boolean }
    | null;
}): boolean {
  const day = 86_400_000;
  if (input.eventStartMs === null || input.liveSinceMs === null) return false;
  const daysAway = (input.eventStartMs - input.nowMs) / day;
  if (daysAway < NUDGE_EVENT_MIN_DAYS || daysAway > NUDGE_EVENT_MAX_DAYS) {
    return false;
  }
  if ((input.nowMs - input.liveSinceMs) / day < NUDGE_MIN_DAYS_LIVE) {
    return false;
  }
  if (input.expectedWeekLow === null || !(input.expectedWeekLow > 0)) {
    return false;
  }
  const expected = (input.expectedWeekLow * NUDGE_LOOKBACK_DAYS) / 7;
  if (!(input.ticketsLast4Days < NUDGE_BELOW_RATIO * expected)) return false;
  const stock = input.stock;
  if (!stock) return false;
  if (stock.unlimited) return true;
  if (stock.total === null || stock.remaining === null || stock.total <= 0) {
    return false;
  }
  return stock.remaining >= NUDGE_STOCK_LEFT_RATIO * stock.total;
}
