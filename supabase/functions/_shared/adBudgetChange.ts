/**
 * Issue #3697 — validate and allocate a governed budget change (pure).
 *
 * The operator enters the plan's new daily budget and/or new hard cap in the
 * plan's provider-account currency. This module refuses what the server must
 * never accept (a cap below spend-to-date, a Host plan, FX or lifetime plans,
 * a daily push to a provider that cannot take one yet) and splits the totals
 * across the plan's provider campaigns in proportion to their current values,
 * conserving every minor unit. The database RPC `ad_plan_amend_budget`
 * re-checks the money rules inside one transaction.
 */

import { MAX_BUDGET_CENTS, type Platform } from "./adChannelCore.ts";

export type BudgetCampaign = {
  id: string;
  platform: Platform;
  owner_kind?: string | null;
  provider_currency: string | null;
  provider_budget_cents: number | null;
  provider_delivery_budget_cents: number | null;
  amended_provider_budget_cents?: number | null;
  amended_provider_delivery_budget_cents?: number | null;
  lifetime_budget_cents?: number | null;
  fx_snapshot_id?: string | null;
  status?: string | null;
  external_campaign_id?: string | null;
};

export type BudgetChangeLine = {
  campaign_id: string;
  platform: Platform;
  previous_cap_cents: number;
  new_cap_cents: number;
  previous_daily_cents: number;
  new_daily_cents: number;
  spend_cents: number;
  daily_changed: boolean;
};

export type BudgetChangePlan =
  | {
    ok: true;
    currency: string;
    spend_cents: number;
    previous: { daily_cents: number; cap_cents: number };
    next: { daily_cents: number; cap_cents: number };
    lines: BudgetChangeLine[];
  }
  | { ok: false; error: string; detail?: string };

/** Providers whose daily budget Mingla can push today. */
export const DAILY_BUDGET_PUSH_PLATFORMS: ReadonlySet<Platform> = new Set([
  "meta",
]);

const positive = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

const amount = (value: unknown): number | null | "invalid" => {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 &&
      number <= MAX_BUDGET_CENTS
    ? number
    : "invalid";
};

/**
 * Split `total` across `weights` (largest remainder), every share ≥ 1 and
 * Σ shares === total exactly.
 */
export function proportionalSplit(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  if (weights.length === 1) return [total];
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  const raw = weights.map((weight) =>
    sum > 0 ? (total * weight) / sum : total / weights.length
  );
  const shares = raw.map((value) => Math.floor(value));
  let left = total - shares.reduce((acc, share) => acc + share, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left -= 1) {
    shares[order[i].index] += 1;
  }
  return shares;
}

export function planBudgetChange(input: {
  ownerKind: string | null | undefined;
  campaigns: BudgetCampaign[];
  /** Spend-to-date per campaign id in provider minor units; null = unknown. */
  spendByCampaign: Record<string, number | null>;
  newDailyCents?: unknown;
  newCapCents?: unknown;
}): BudgetChangePlan {
  if (input.ownerKind !== "mingla") {
    return {
      ok: false,
      error: "host_budget_change_not_available_yet",
      detail: "Changing the budget is not available for Host campaigns yet.",
    };
  }
  const campaigns = input.campaigns ?? [];
  if (campaigns.length === 0) {
    return { ok: false, error: "plan_campaigns_missing" };
  }
  const newDaily = amount(input.newDailyCents);
  const newCap = amount(input.newCapCents);
  if (newDaily === "invalid" || newCap === "invalid") {
    return { ok: false, error: "budget_amount_invalid" };
  }
  if (newDaily === null && newCap === null) {
    return { ok: false, error: "budget_change_empty" };
  }
  const currencies = new Set(campaigns.map((row) => row.provider_currency));
  const currency = campaigns[0].provider_currency;
  if (
    currencies.size !== 1 || typeof currency !== "string" ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    return { ok: false, error: "provider_currency_unresolved" };
  }
  if (campaigns.some((row) => row.fx_snapshot_id)) {
    return { ok: false, error: "fx_budget_change_not_supported_yet" };
  }
  if (campaigns.some((row) => row.lifetime_budget_cents != null)) {
    return { ok: false, error: "lifetime_budget_change_not_supported_yet" };
  }
  const current = campaigns.map((row) => ({
    row,
    cap: positive(row.amended_provider_budget_cents) ??
      positive(row.provider_budget_cents),
    daily: positive(row.amended_provider_delivery_budget_cents) ??
      positive(row.provider_delivery_budget_cents),
  }));
  if (current.some((line) => line.cap === null || line.daily === null)) {
    return { ok: false, error: "provider_money_unresolved" };
  }
  const spends = campaigns.map((row) => input.spendByCampaign[row.id]);
  if (spends.some((spend) => spend === null || spend === undefined)) {
    return {
      ok: false,
      error: "spend_unknown",
      detail: "Spend-to-date is not synced for every provider. Sync first.",
    };
  }
  const spendTotal = (spends as number[]).reduce((acc, s) => acc + s, 0);
  const previousCap = current.reduce(
    (acc, line) => acc + (line.cap as number),
    0,
  );
  const previousDaily = current.reduce(
    (acc, line) => acc + (line.daily as number),
    0,
  );
  const nextCap = newCap ?? previousCap;
  const nextDaily = newDaily ?? previousDaily;
  if (nextCap < spendTotal) {
    return {
      ok: false,
      error: "cap_below_spend",
      detail: `The new cap is below the ${spendTotal} already spent.`,
    };
  }
  if (nextDaily > nextCap) {
    return { ok: false, error: "daily_above_cap" };
  }
  const caps = newCap === null
    ? current.map((line) => line.cap as number)
    : proportionalSplit(nextCap, current.map((line) => line.cap as number));
  const dailies = newDaily === null
    ? current.map((line) => line.daily as number)
    : proportionalSplit(nextDaily, current.map((line) => line.daily as number));
  const lines: BudgetChangeLine[] = current.map((line, index) => ({
    campaign_id: line.row.id,
    platform: line.row.platform,
    previous_cap_cents: line.cap as number,
    new_cap_cents: caps[index],
    previous_daily_cents: line.daily as number,
    new_daily_cents: dailies[index],
    spend_cents: spends[index] as number,
    daily_changed: dailies[index] !== line.daily,
  }));
  if (lines.some((line) => line.new_cap_cents < line.spend_cents)) {
    return { ok: false, error: "cap_split_below_platform_spend" };
  }
  if (
    lines.some((line) =>
      line.new_daily_cents < 1 || line.new_daily_cents > line.new_cap_cents
    )
  ) {
    return { ok: false, error: "daily_above_cap" };
  }
  const unsupported = lines.find((line) =>
    line.daily_changed && !DAILY_BUDGET_PUSH_PLATFORMS.has(line.platform)
  );
  if (unsupported) {
    return {
      ok: false,
      error: `budget_change_not_supported_for_${unsupported.platform}`,
      detail:
        `Changing the daily budget on ${unsupported.platform} is not supported yet.`,
    };
  }
  return {
    ok: true,
    currency,
    spend_cents: spendTotal,
    previous: { daily_cents: previousDaily, cap_cents: previousCap },
    next: { daily_cents: nextDaily, cap_cents: nextCap },
    lines,
  };
}

/** Sum spend-sync rows in the provider currency; mixed currency = unknown. */
export function spendToDate(
  rows: Array<{ spend_cents?: unknown; currency?: unknown }>,
  providerCurrency: string | null,
): number | null {
  if (!providerCurrency) return null;
  let total = 0;
  for (const row of rows) {
    const currency = typeof row.currency === "string"
      ? row.currency.trim().toUpperCase()
      : "";
    const cents = Number(row.spend_cents);
    if (currency !== providerCurrency || !Number.isFinite(cents) || cents < 0) {
      return null;
    }
    total += cents;
  }
  return total;
}
