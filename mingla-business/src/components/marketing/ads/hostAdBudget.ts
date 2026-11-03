/**
 * #4238 media-buyer — budget as a total for the run (default) or per day,
 * split so every app gets its own minimum first and the rest evenly.
 * Pure: amounts are whole minor units in the brand's money.
 */
import { platformName, platformNames } from "./hostAdCopy";

/** "YYYY-MM-DD" → whole days from start to end, both counted (≥ 1). */
export function hostAdDaysInRun(startDay: string, endDay: string): number | null {
  const re = /^(\d{4})-(\d{2})-(\d{2})$/;
  const a = re.exec(startDay);
  const b = re.exec(endDay);
  if (!a || !b) return null;
  const start = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const end = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  if (end < start) return null;
  return Math.round((end - start) / 86_400_000) + 1;
}

/** A total for the run → the daily amount the apps are given (rounded down). */
export function hostAdDailyFromTotal(totalCents: number, days: number): number {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || days <= 0) return 0;
  return Math.floor(totalCents / days);
}

export type HostAdSplitRow = {
  platform: string;
  dailyCents: number;
  minimumCents: number;
};

export type HostAdSplit = {
  ok: boolean;
  rows: HostAdSplitRow[];
  minimumTotalCents: number;
  /** The first app whose minimum the daily amount can't cover. */
  short: { platform: string; minimumCents: number } | null;
};

/**
 * Minimums first, the rest evenly (largest remainder), so the rows add up to
 * the daily amount exactly. When the daily amount can't cover every minimum,
 * `ok` is false and the even split is shown (money is not set aside).
 */
export function hostAdSplitWithMinimums(
  dailyCents: number,
  apps: readonly string[],
  minimums: Readonly<Record<string, number | undefined>>,
): HostAdSplit {
  const mins = apps.map((app) => Math.max(0, Math.ceil(minimums[app] ?? 0)));
  const minimumTotalCents = mins.reduce((sum, value) => sum + value, 0);
  const even = (total: number): number[] => {
    if (apps.length === 0 || total <= 0) return apps.map(() => 0);
    const base = Math.floor(total / apps.length);
    const rest = total - base * apps.length;
    return apps.map((_, index) => base + (index < rest ? 1 : 0));
  };
  if (dailyCents < minimumTotalCents) {
    const shares = even(dailyCents);
    const shortIndex = apps.findIndex((_, index) => shares[index] < mins[index]);
    return {
      ok: false,
      rows: apps.map((platform, index) => ({
        platform,
        dailyCents: shares[index],
        minimumCents: mins[index],
      })),
      minimumTotalCents,
      short: shortIndex >= 0
        ? { platform: apps[shortIndex], minimumCents: mins[shortIndex] }
        : null,
    };
  }
  const extra = even(dailyCents - minimumTotalCents);
  return {
    ok: true,
    rows: apps.map((platform, index) => ({
      platform,
      dailyCents: mins[index] + extra[index],
      minimumCents: mins[index],
    })),
    minimumTotalCents,
    short: null,
  };
}

/**
 * #4238 r8 P3: the plain line when the daily amount can't cover every app's
 * minimum. One app short: that app and its minimum. Several: the combined
 * minimum, so the Host isn't told one amount and then refused again.
 */
export function hostAdBudgetShortMessage(
  split: Pick<HostAdSplit, "ok" | "rows" | "minimumTotalCents" | "short">,
  money: (cents: number) => string,
): string | null {
  if (split.ok || !split.short) return null;
  const shortRows = split.rows.filter((row) => row.dailyCents < row.minimumCents);
  if (shortRows.length <= 1) {
    return `${platformName(split.short.platform)} needs about ${money(split.short.minimumCents)} a day. Raise the budget, or turn it off.`;
  }
  return `Your ${split.rows.length} apps need about ${money(split.minimumTotalCents)} a day together (${platformNames(shortRows.map((row) => row.platform))} are short). Raise the budget, or turn an app off.`;
}

/** Split a total in proportion to the daily shares (largest remainder). */
export function hostAdProportionalCents(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, value) => acc + value, 0);
  if (weights.length === 0 || total <= 0) return weights.map(() => 0);
  if (sum <= 0) {
    const base = Math.floor(total / weights.length);
    return weights.map((_, i) => base + (i < total - base * weights.length ? 1 : 0));
  }
  const raw = weights.map((weight) => (total * weight) / sum);
  const floors = raw.map(Math.floor);
  let rest = total - floors.reduce((acc, value) => acc + value, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - floors[index] }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const item of order) {
    if (rest <= 0) break;
    floors[item.index] += 1;
    rest -= 1;
  }
  return floors;
}

/**
 * A starting point that clears every app's minimum with room to learn:
 * 1.6 × the minimums, rounded up to a round step.
 */
export function hostAdRecommendedDaily(minimumTotalCents: number): number {
  if (minimumTotalCents <= 0) return 0;
  const raw = minimumTotalCents * 1.6;
  const step = raw >= 10_000_000 ? 1_000_000 : raw >= 1_000_000 ? 100_000 : raw >= 100_000 ? 10_000 : 1_000;
  return Math.ceil(raw / step) * step;
}

export type HostAdBudgetMode = "total" | "daily";

/**
 * What the plan freezes: per-app daily delivery and per-app share of the
 * hard cap. Total mode: cap = the total; daily = total ÷ days.
 */
export function hostAdAllocations(input: {
  mode: HostAdBudgetMode;
  totalCents: number;
  dailyCents: number;
  days: number | null;
  apps: readonly string[];
  minimums: Readonly<Record<string, number | undefined>>;
}): {
  ok: boolean;
  dailyTotalCents: number;
  capTotalCents: number;
  split: HostAdSplit;
  capShares: number[];
} {
  const dailyTotalCents = input.mode === "total"
    ? hostAdDailyFromTotal(input.totalCents, input.days ?? 0)
    : input.dailyCents;
  const capTotalCents = input.mode === "total" ? input.totalCents : input.totalCents;
  const split = hostAdSplitWithMinimums(dailyTotalCents, input.apps, input.minimums);
  const capShares = hostAdProportionalCents(
    capTotalCents,
    split.rows.map((row) => Math.max(1, row.dailyCents)),
  );
  return {
    ok: split.ok && dailyTotalCents > 0 && capTotalCents >= dailyTotalCents,
    dailyTotalCents,
    capTotalCents,
    split,
    capShares,
  };
}
