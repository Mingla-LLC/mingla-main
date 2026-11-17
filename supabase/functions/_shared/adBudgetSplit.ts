/**
 * #4238 T-6 (amendment A) + amendment B item 3: fewer apps for small budgets.
 *
 * `splitBudget` is ported UNCHANGED from
 * mingla-admin/src/lib/adBuilder/channelPlan.js (Admin keeps its browser
 * copy); the parity test (_shared/__tests__/issue_4238_budget_split.test.ts)
 * runs both over one table and fails on any difference.
 *
 * `hostAppsForBudget` is the Host and Ari wrapper used by "Let Mingla
 * choose", in ad spend (pay × (1 − HOST_FEE_RATIO)), one currency:
 *   1. an app is funded only when its share is at least max(F, 500)
 *      (viability); the eligible set passed to splitBudget is the apps whose
 *      viability the total can reach, so its "concentrate" answer is always a
 *      viable app;
 *   2. otherwise (amendment B §3 step 2) the highest-priority app with
 *      spend ≥ F runs alone, learning "slow";
 *   3. otherwise fit "none" (the caller refuses 422
 *      host_ad_budget_below_every_minimum).
 * Amounts always add up to the total exactly. F is the one-ad-set floor; this
 * never raises a minimum (the binding floor rule).
 *
 * MINGLA-INVARIANT: I-4238-FEWER-APPS-VIABLE | issue #4238 | Under "Let Mingla choose" an app is funded only at max(F, 500) ad spend a day (or alone at F with learning "slow" when nothing reaches that); the split conserves the total and matches Admin splitBudget.
 */

export type SplitChannelRow = {
  platform: string;
  eligible: boolean;
  floorCents?: number | null;
};
export type SplitStrategy = "auto" | "concentrate" | "diversify";
export type SplitAllocation = { platform: string; dailyCents: number };

/** Admin's priority order (channelPlan.js). */
export const SPLIT_PRIORITY = [
  "meta",
  "tiktok",
  "google",
  "snapchat",
  "reddit",
] as const;

/** ≥5 major account-currency units a day to plausibly learn (Admin). */
export const SPLIT_VIABILITY_FLOOR_CENTS = 500;

export function splitBudget(
  { totalDailyCents, channelRows, strategy = "auto" }: {
    totalDailyCents: number;
    channelRows: readonly SplitChannelRow[];
    strategy?: SplitStrategy;
  },
): SplitAllocation[] {
  const eligible = channelRows.filter((r) => r.eligible);
  if (eligible.length === 0 || totalDailyCents <= 0) return [];

  const PRIORITY = ["meta", "tiktok", "google", "snapchat", "reddit"];
  const ordered = [...eligible].sort(
    (a, b) => PRIORITY.indexOf(a.platform) - PRIORITY.indexOf(b.platform),
  );
  const viability = (row: SplitChannelRow): number =>
    Math.max(row.floorCents ?? 0, 500); // ≥5 major account-currency units/day to plausibly learn

  if (strategy === "concentrate") {
    return [{ platform: ordered[0].platform, dailyCents: totalDailyCents }];
  }

  // auto: concentrate unless the total funds ≥2 channels at viability.
  // diversify: fund as many as viability allows, evenly over the remainder.
  const fundable: { row: SplitChannelRow; v: number }[] = [];
  let committed = 0;
  for (const row of ordered) {
    const v = viability(row);
    if (committed + v <= totalDailyCents) {
      fundable.push({ row, v });
      committed += v;
    }
  }
  const shouldSplit = strategy === "diversify"
    ? fundable.length >= 2
    : fundable.length >= 2 && strategy === "auto" &&
      totalDailyCents >= fundable.slice(0, 2).reduce((s, f) => s + f.v, 0) &&
      fundable.length >= 2;
  if (!shouldSplit) {
    return [{ platform: ordered[0].platform, dailyCents: totalDailyCents }];
  }

  // Even split of the remainder on top of each channel's viability base;
  // conservation: Σ allocations === totalDailyCents exactly (remainder to the
  // first/priority channel).
  const remainder = totalDailyCents - committed;
  const perChannelExtra = Math.floor(remainder / fundable.length);
  const allocations = fundable.map(({ row, v }) => ({
    platform: row.platform,
    dailyCents: v + perChannelExtra,
  }));
  const allocated = allocations.reduce((s, a) => s + a.dailyCents, 0);
  allocations[0].dailyCents += totalDailyCents - allocated;
  return allocations;
}

export type HostAppFit = "ok" | "slow" | "none";

export type HostAppsPlan = {
  fit: HostAppFit;
  funded: SplitAllocation[];
  trimmed: {
    platform: string;
    reason: "budget_funds_fewer_apps" | "below_app_minimum";
    /** Extra ad spend a day this app would need to be funded (viability). */
    needs_more_cents: number;
  }[];
  smallest_overall: { platform: string; spend_cents: number } | null;
};

/** The viability amount for an app (Admin's rule): max(F, 500). */
export function viabilityCents(floorCents: number): number {
  return Math.max(
    Math.max(0, Math.ceil(floorCents)),
    SPLIT_VIABILITY_FLOOR_CENTS,
  );
}

export function hostAppsForBudget(input: {
  spendCents: number;
  /**
   * floorCents = F; viabilityCents = max(F, 500) already converted into the
   * same money as spendCents (defaults to viabilityCents(F) for USD).
   */
  apps: readonly {
    platform: string;
    floorCents: number;
    viabilityCents?: number;
  }[];
}): HostAppsPlan {
  const spend = Number.isSafeInteger(input.spendCents) && input.spendCents > 0
    ? input.spendCents
    : 0;
  const ordered = [...input.apps].sort((a, b) =>
    SPLIT_PRIORITY.indexOf(a.platform as typeof SPLIT_PRIORITY[number]) -
    SPLIT_PRIORITY.indexOf(b.platform as typeof SPLIT_PRIORITY[number])
  );
  const smallest = ordered.length === 0
    ? null
    : ordered.reduce((best, app) =>
      app.floorCents < best.floorCents ? app : best
    );
  const smallestOverall = smallest
    ? {
      platform: smallest.platform,
      spend_cents: Math.ceil(smallest.floorCents),
    }
    : null;
  const viabilityOf = (
    app: { floorCents: number; viabilityCents?: number } | undefined,
  ): number =>
    !app ? 0 : typeof app.viabilityCents === "number" &&
        Number.isSafeInteger(app.viabilityCents) && app.viabilityCents > 0
      ? Math.max(app.viabilityCents, Math.ceil(app.floorCents))
      : viabilityCents(app.floorCents);
  // needs_more: the extra spend a day at which this app is funded too, at
  // viability, next to the apps already funded.
  const trim = (funded: SplitAllocation[]): HostAppsPlan["trimmed"] => {
    const fundedViability = funded.reduce(
      (sum, row) =>
        sum + viabilityOf(ordered.find((app) => app.platform === row.platform)),
      0,
    );
    return ordered
      .filter((app) => !funded.some((row) => row.platform === app.platform))
      .map((app) => ({
        platform: app.platform,
        reason: spend >= app.floorCents
          ? "budget_funds_fewer_apps" as const
          : "below_app_minimum" as const,
        needs_more_cents: Math.max(
          1,
          fundedViability + viabilityOf(app) - spend,
        ),
      }));
  };
  // 1. Some app is viable at this total.
  const viable = ordered.filter((app) => viabilityOf(app) <= spend);
  if (viable.length > 0) {
    const funded = splitBudget({
      totalDailyCents: spend,
      channelRows: viable.map((app) => ({
        platform: app.platform,
        eligible: true,
        // splitBudget's own max(floor, 500) then keeps the converted figure.
        floorCents: viabilityOf(app),
      })),
      strategy: "auto",
    });
    return {
      fit: "ok",
      funded,
      trimmed: trim(funded),
      smallest_overall: smallestOverall,
    };
  }
  // 2. Nothing is viable: the highest-priority app that clears its floor.
  const alone = ordered.find((app) => spend >= app.floorCents);
  if (alone) {
    const funded = [{ platform: alone.platform, dailyCents: spend }];
    return {
      fit: "slow",
      funded,
      trimmed: trim(funded),
      smallest_overall: smallestOverall,
    };
  }
  // 3. Nothing can run.
  return {
    fit: "none",
    funded: [],
    trimmed: trim([]),
    smallest_overall: smallestOverall,
  };
}
