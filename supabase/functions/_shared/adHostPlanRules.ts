import { metaBudgetCategoryForBillingEvent } from "./adChannelCore.ts";
import { hostAdGoalFields, type HostAdOptimization } from "./adHostGoal.ts";
import { AD_PLATFORM_MINIMUMS_USD_CENTS_PER_DAY } from "./adMoney.ts";

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
 * #4238 P1: each app's daily minimum for ONE ad set / ad group / ad squad, in
 * the provider account's currency (USD floors from adMoney; Meta from the
 * connection's own floors). Null when the account bills in a currency the
 * floors are not written in.
 *
 * #4238 I-4238-META-FLOOR-FOLLOWS-BILLING: Meta's category comes from the
 * billing event the Host goal really sends (hostAdGoalFields), the same rule
 * admin-ad-create-campaign checks.
 */
export function providerDailyMinimumCents(
  platform: string,
  connection: { currency?: unknown; extra?: unknown },
  optimization: HostAdOptimization,
): number | null {
  const currency = String(connection.currency ?? "").toUpperCase();
  if (currency !== "USD") return null;
  if (platform === "meta") {
    const floors = (connection.extra as Record<string, unknown> | null)
      ?.minimum_budgets as Record<string, unknown> | undefined;
    const billingEvent = hostAdGoalFields("meta", optimization)?.billing_event;
    const category = metaBudgetCategoryForBillingEvent(billingEvent ?? "");
    const raw = floors?.[category];
    // Same fallback as perDayFloorCents until the connection floors load.
    return typeof raw === "number" && raw > 0 ? Math.ceil(raw) : 500;
  }
  if (platform in AD_PLATFORM_MINIMUMS_USD_CENTS_PER_DAY) {
    return AD_PLATFORM_MINIMUMS_USD_CENTS_PER_DAY[
      platform as keyof typeof AD_PLATFORM_MINIMUMS_USD_CENTS_PER_DAY
    ];
  }
  return null;
}

/**
 * #4238 item 6b / I-4238-HOST-ONE-ADSET: Host and Ari ads (owner_kind
 * "host") are built as ONE ad set / ad group / ad squad per app. Only Admin
 * (owner_kind "mingla") event ads are split into staged ad sets at create.
 * admin-ad-create-campaign calls this at every paid-social stage branch.
 */
export function paidSocialStagesApply(
  ownerKind: string,
  eventId: unknown,
): boolean {
  return ownerKind !== "host" && typeof eventId === "string" &&
    eventId.trim() !== "";
}

/**
 * #4238 binding floor rule (16 Nov): the daily minimum a Host plan must clear
 * on one app is the price of ONE ad set, in the provider account's money
 * (ad credit, after the fee). Nothing is added on top: no staged worst case
 * (Host ads are one ad set, paidSocialStagesApply) and no retargeting share.
 * The pay-terms figure the Host sees is hostMinimumPayCents of this.
 */
export function hostDailyMinimumCents(
  platform: string,
  connection: { currency?: unknown; extra?: unknown },
  optimization: HostAdOptimization,
): number | null {
  return providerDailyMinimumCents(platform, connection, optimization);
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
export function splitProportional(
  total: number,
  weights: readonly number[],
): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0 || total <= 0 || sum <= 0) {
    const base = weights.length ? Math.floor(total / weights.length) : 0;
    return weights.map((_, i) =>
      base + (i < total - base * weights.length ? 1 : 0)
    );
  }
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  raw.map((v, i) => ({ i, f: v - out[i] })).sort((a, b) =>
    b.f - a.f || a.i - b.i
  )
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
    const row = raw && typeof raw === "object"
      ? raw as Record<string, unknown>
      : {};
    const platform = String(row.platform ?? "");
    const goal = goals[platform];
    const value = goal === "sales" || goal === "signups"
      ? row[`${goal}_daily_minimum_cents`]
      : row.visits_daily_minimum_cents;
    if (platform && typeof value === "number") out[platform] = value;
  }
  return out;
}

/** #4238 6b: a Host or Ari ad set carries 1–5 videos (photos come in W3). */
export const HOST_CREATIVES_MAX = 5;
/** The builder suggests at least this many videos (the creatives_hint). */
export const HOST_CREATIVES_SUGGESTED = 3;

const CREATIVE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * #4238 6b: the canonical creative list. Absent = the single
 * `creative_library_id` (older clients). Present = 1–5 distinct ids, and
 * `creative_library_id` (kept for older readers) must be the first.
 */
export function hostCreativeLibraryIds(
  raw: unknown,
  first: unknown,
): { ok: true; ids: string[] } | { ok: false; detail: string } {
  const single = typeof first === "string" ? first : "";
  if (raw === undefined || raw === null) {
    return CREATIVE_UUID.test(single)
      ? { ok: true, ids: [single] }
      : { ok: false, detail: "creative_library_id_required" };
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, detail: "creative_library_ids_invalid" };
  }
  if (raw.length > HOST_CREATIVES_MAX) {
    return { ok: false, detail: "creative_library_ids_too_many" };
  }
  const ids: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string" || !CREATIVE_UUID.test(value)) {
      return { ok: false, detail: "creative_library_ids_invalid" };
    }
    if (ids.includes(value)) {
      return { ok: false, detail: "creative_library_ids_duplicate" };
    }
    ids.push(value);
  }
  if (single && single !== ids[0]) {
    return { ok: false, detail: "creative_library_id_not_first" };
  }
  return { ok: true, ids };
}

/**
 * #4238 6c + amendment A decision 4: Meta's Advantage+ audience is on for a
 * Host ad set unless a list or lookalike audience is attached, or the Host
 * set a top age, a gender or a language (their explicit choice is kept).
 * The age minimum stays a hard limit either way.
 */
export function hostMetaAdvantageAudience(input: {
  listOrLookalikeAttached: boolean;
  targeting: Record<string, unknown> | null | undefined;
}): 0 | 1 {
  if (input.listOrLookalikeAttached) return 0;
  const t = input.targeting ?? {};
  // Meta keeps only a minimum age up to 25 as a hard limit under Advantage+.
  const ageMin = Number(t.age_min);
  if (Number.isFinite(ageMin) && ageMin > 25) return 0;
  const ageMax = Number(t.age_max);
  if (Number.isFinite(ageMax) && ageMax > 0 && ageMax < 65) return 0;
  const genders = t.genders;
  if (Array.isArray(genders) && genders.length > 0 && genders.length < 2) {
    return 0;
  }
  const locales = t.locales ?? t.languages;
  if (Array.isArray(locales) && locales.length > 0) return 0;
  return 1;
}

/**
 * #4238 5a: apps whose create path sends a lifetime (total-for-the-run)
 * budget for the one-ad-set structure. Every other app runs daily plus
 * Mingla's cap (the spend sync stops it at the total).
 *
 * Meta only in W2: the Meta adapter and create path already send a CBO
 * `lifetime_budget` with the ad set end time. TikTok's adapter knows
 * BUDGET_MODE_TOTAL and Snap's knows lifetime_budget_micro (Z-2 confirmed),
 * but admin-ad-create-campaign still hard-codes daily on both paths and the
 * live edit can't push a lifetime amount yet — carried to W4 (live-edit
 * code). A "total" never becomes a per-day budget of the total.
 */
export const HOST_LIFETIME_PLATFORMS: ReadonlySet<string> = new Set(["meta"]);

/** The provider budget mode a Host plan's app runs on. */
export function hostBudgetModeFor(
  platform: string,
  canonicalPlan: Record<string, unknown> | null | undefined,
): "daily" | "lifetime" {
  return canonicalPlan?.budget_mode === "total" &&
      HOST_LIFETIME_PLATFORMS.has(platform)
    ? "lifetime"
    : "daily";
}

/**
 * #4238 6c: frequency caps only where the app accepts them on the goal used.
 * Meta, TikTok and Snap refuse caps on conversion goals (Spec v2 correction),
 * so the only Host cap is Snap visits-type goals: 3 impressions per 7 days.
 * `capGoals` is the adapter's own list (SNAPCHAT_FREQUENCY_CAP_GOALS).
 */
export function hostFrequencyCap(
  platform: string,
  optimizationGoal: string,
  capGoals: readonly string[],
): { impressions: number; days: number } | null {
  return platform === "snapchat" && capGoals.includes(optimizationGoal)
    ? { impressions: 3, days: 7 }
    : null;
}

/**
 * #4238 T-2 (amendment A decisions 1–2): the ONE Host/Ari ad-set split.
 * One prospecting ad set always. One retarget ad set (page viewers and
 * checkout starters, codes M1–M5 / S1–S3 / T1–T3) is added on Meta, Snap or
 * TikTok only when the app's daily ad spend S is at least 2F (F = the
 * one-ad-set floor) AND the retarget audience is ready (≥ 1,000 people,
 * event → brand → market) AND the pixel buyer exclusion (M6/S4/T4) is ready.
 * Retarget R = max(F, floor(0.2·S)), prospecting S − R; both stay ≥ F.
 *
 * Setup/guidance, create_version (preflight) and create all call this, so
 * create never refuses a split preflight accepted (X-1). It never changes the
 * Host minimum: the minimum stays the one-ad-set price (binding floor rule).
 *
 * MINGLA-INVARIANT: I-4238-RETARGET-NEVER-RAISES-MINIMUM | issue #4238 | hostAdSetSplit adds the retarget ad set only at S >= 2F with a ready >=1,000 audience and a ready buyer exclusion, keeps every ad set >= F, and the Host minimum is never derived from it (hostDailyMinimumCents is the one-ad-set floor).
 */
export const HOST_RETARGET_PLATFORMS: ReadonlySet<string> = new Set([
  "meta",
  "snapchat",
  "tiktok",
]);
export const HOST_RETARGET_SHARE = 0.2;
export const HOST_RETARGET_MIN_AUDIENCE = 1000;

export type HostRetargetReadiness = {
  /** The page-viewer / checkout-starter audience has ≥ 1,000 people. */
  audienceReady: boolean;
  /** The pixel buyer exclusion exists for this app. */
  buyerExclusionReady: boolean;
};

export type HostAdSetSplit = {
  ad_sets: 1 | 2;
  prospecting_cents: number;
  retarget_cents: number;
  retarget: {
    added: boolean;
    reason:
      | null
      | "retarget_not_supported"
      | "budget_below_retarget_threshold"
      | "retarget_audience_not_ready";
  };
};

export function hostAdSetSplit(
  platform: string,
  spendCents: number,
  floorCents: number | null,
  readiness: HostRetargetReadiness | null,
): HostAdSetSplit {
  const spend = Number.isSafeInteger(spendCents) && spendCents > 0
    ? spendCents
    : 0;
  const one = (
    reason: HostAdSetSplit["retarget"]["reason"],
  ): HostAdSetSplit => ({
    ad_sets: 1,
    prospecting_cents: spend,
    retarget_cents: 0,
    retarget: { added: false, reason },
  });
  if (!HOST_RETARGET_PLATFORMS.has(platform)) {
    return one("retarget_not_supported");
  }
  const floor = floorCents !== null && Number.isFinite(floorCents) &&
      floorCents > 0
    ? Math.ceil(floorCents)
    : null;
  // Retargeting never runs without leaving out buyers (SC-T2.2).
  if (
    !readiness || readiness.audienceReady !== true ||
    readiness.buyerExclusionReady !== true
  ) {
    return one("retarget_audience_not_ready");
  }
  if (floor === null || spend < 2 * floor) {
    return one("budget_below_retarget_threshold");
  }
  const retarget = Math.max(floor, Math.floor(HOST_RETARGET_SHARE * spend));
  return {
    ad_sets: 2,
    prospecting_cents: spend - retarget,
    retarget_cents: retarget,
    retarget: { added: true, reason: null },
  };
}

/**
 * #4238 T-2: readiness from the existing stage resolver's plan
 * (buildAdStagePlan, read-only): not blocked (buyer exclusion ready) and the
 * retarget or checkout-starter stage has a ≥ 1,000-person audience.
 */
export function hostRetargetReadiness(
  plan:
    | {
      blocked: boolean;
      stages: readonly { stage: string; executable: boolean }[];
    }
    | null,
): HostRetargetReadiness {
  if (!plan) return { audienceReady: false, buyerExclusionReady: false };
  const warm = plan.stages.some((stage) =>
    (stage.stage === "retarget" || stage.stage === "abandoners") &&
    stage.executable
  );
  return {
    audienceReady: !plan.blocked && warm,
    buyerExclusionReady: !plan.blocked,
  };
}

/**
 * #4238 T-3 (amendment A decision 3): the past-guests starting audience for
 * "Let Mingla choose". It is added ONLY when the audience choice is Mingla's,
 * EVERY chosen app has the staff switch on (ad_connections.extra
 * .past_guest_seed_enabled === true, set only through
 * admin_set_ad_past_guest_seed with a privacy-review reference), and the brand
 * has a ready past-guests list or lookalike. With the switch off, no list id
 * enters a Host plan unless the Host picked it (SC-T3).
 */
export function hostPastGuestSeedKeys(input: {
  audienceChoice: unknown;
  platforms: readonly string[];
  connections: readonly { platform: string; extra?: unknown }[];
  readyListKeys: readonly string[];
}): string[] {
  if (input.audienceChoice !== "mingla") return [];
  if (input.platforms.length === 0 || input.readyListKeys.length === 0) {
    return [];
  }
  const on = input.platforms.every((platform) => {
    const row = input.connections.find((item) => item.platform === platform);
    const extra = row?.extra && typeof row.extra === "object"
      ? row.extra as Record<string, unknown>
      : {};
    return extra.past_guest_seed_enabled === true;
  });
  return on ? [...new Set(input.readyListKeys)] : [];
}
