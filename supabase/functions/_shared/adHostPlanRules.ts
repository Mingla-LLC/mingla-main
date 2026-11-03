import { metaBudgetCategoryForGoal } from "./adChannelCore.ts";

/**
 * #4238 — Host ad plan rules checked by ad-plan before any money moves.
 * Pure: the caller reads the rows; this decides.
 */

export type CountryAvailabilityRow = {
  platform: string;
  country_code: string;
  status: "works" | "not_available" | string;
  reason?: string | null;
};

/**
 * The first selected app that runs in none of the chosen countries, or null.
 * A missing row means the app works there (staff have not marked it).
 */
export function appUnavailableInEveryCountry(
  platforms: readonly string[],
  countries: readonly string[],
  rows: readonly CountryAvailabilityRow[],
): string | null {
  const wanted = countries.map((code) => code.trim().toUpperCase());
  if (wanted.length === 0) return null;
  for (const platform of platforms) {
    const blocked = wanted.every((country) =>
      rows.some((row) =>
        row.platform === platform &&
        row.country_code.toUpperCase() === country &&
        row.status === "not_available"
      )
    );
    if (blocked) return platform;
  }
  return null;
}

/** Countries one app can't run in (for a plain per-app note). */
export function countriesAppCannotRunIn(
  platform: string,
  countries: readonly string[],
  rows: readonly CountryAvailabilityRow[],
): string[] {
  return countries.map((code) => code.trim().toUpperCase()).filter((country) =>
    rows.some((row) =>
      row.platform === platform &&
      row.country_code.toUpperCase() === country &&
      row.status === "not_available"
    )
  );
}

/**
 * #4238: the reach meter the Host sees next to each app's number. One
 * person can be on several apps, so each app is read on its own.
 */
export function reachMeter(
  lower: number | null,
  upper: number | null,
): "too_narrow" | "good" | "broad" | null {
  if (lower === null || upper === null) return null;
  const mid = (lower + upper) / 2;
  if (mid < 60_000) return "too_narrow";
  if (mid > 6_000_000) return "broad";
  return "good";
}

/** A stable key for the reach cache (same audience → same answer for 10 min). */
export function reachCacheKey(input: unknown): string {
  const seen = new WeakSet<object>();
  const sorted = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value as object)) return null;
    seen.add(value as object);
    if (Array.isArray(value)) return value.map(sorted);
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>).sort().map((key) => [
        key,
        sorted((value as Record<string, unknown>)[key]),
      ]),
    );
  };
  return JSON.stringify(sorted(input));
}

/**
 * #4238 P1: each app's daily minimum in the provider account's currency
 * (USD floors from adMoney; Meta from the connection's own floors). Null
 * when the account bills in a currency the floors are not written in.
 */
export function providerDailyMinimumCents(
  platform: string,
  connection: { currency?: unknown; extra?: unknown },
  optimization: "visits" | "sales",
): number | null {
  const currency = String(connection.currency ?? "").toUpperCase();
  if (currency !== "USD") return null;
  if (platform === "meta") {
    const floors = (connection.extra as Record<string, unknown> | null)
      ?.minimum_budgets as Record<string, unknown> | undefined;
    // The same category the create path checks (metaBudgetCategoryForGoal).
    const category = metaBudgetCategoryForGoal(
      optimization === "sales" ? "OFFSITE_CONVERSIONS" : "LANDING_PAGE_VIEWS",
    );
    const raw = floors?.[category];
    // Same fallback as perDayFloorCents until the connection floors load.
    return typeof raw === "number" && raw > 0 ? Math.ceil(raw) : 500;
  }
  const table: Record<string, number> = {
    tiktok: 5000,
    snapchat: 2000,
    reddit: 500,
    google: 0,
  };
  return table[platform] ?? null;
}

/** The first allocation whose provider daily budget is under its app minimum. */
export function allocationBelowMinimum(
  rows: readonly {
    platform: string;
    provider_delivery_budget_cents: number;
    minimum_cents: number | null;
  }[],
): { platform: string; minimum_cents: number } | null {
  for (const row of rows) {
    if (
      row.minimum_cents !== null &&
      row.provider_delivery_budget_cents < row.minimum_cents
    ) {
      return { platform: row.platform, minimum_cents: row.minimum_cents };
    }
  }
  return null;
}

/**
 * #4238 P1: the daily split Hosts and Ari use — each app's minimum first,
 * the rest evenly (largest remainder); the parts add up exactly. When the
 * daily amount can't cover the minimums, an even split (the server then
 * refuses the plan with budget_below_app_minimum before any money moves).
 */
export function splitDailyWithMinimums(
  daily: number,
  platforms: readonly string[],
  minimums: Readonly<Record<string, number | undefined>>,
): number[] {
  const even = (total: number): number[] => {
    if (platforms.length === 0 || total <= 0) return platforms.map(() => 0);
    const base = Math.floor(total / platforms.length);
    const rest = total - base * platforms.length;
    return platforms.map((_, index) => base + (index < rest ? 1 : 0));
  };
  const mins = platforms.map((p) => Math.max(0, Math.ceil(minimums[p] ?? 0)));
  const sum = mins.reduce((a, b) => a + b, 0);
  if (daily < sum) return even(daily);
  const extra = even(daily - sum);
  return mins.map((min, index) => min + extra[index]);
}

/** Split a total in proportion to weights (largest remainder, exact sum). */
export function splitProportional(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0 || total <= 0 || sum <= 0) {
    const base = weights.length ? Math.floor(total / weights.length) : 0;
    return weights.map((_, i) => base + (i < total - base * weights.length ? 1 : 0));
  }
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  raw.map((v, i) => ({ i, f: v - out[i] })).sort((a, b) => b.f - a.f || a.i - b.i)
    .forEach(({ i }) => {
      if (rest > 0) {
        out[i] += 1;
        rest -= 1;
      }
    });
  return out;
}

/** setup.minimums rows → daily minimum per app for the plan's goals. */
export function minimumsFromSetup(
  rows: unknown,
  goals: Readonly<Record<string, string>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const platform = String(row.platform ?? "");
    const value = goals[platform] === "sales"
      ? row.sales_daily_minimum_cents
      : row.visits_daily_minimum_cents;
    if (platform && typeof value === "number") out[platform] = value;
  }
  return out;
}
