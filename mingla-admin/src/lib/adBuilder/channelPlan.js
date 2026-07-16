/**
 * ISSUE-864 WP4 [Campaign Builder] — A4.0(1): the channel picker is an OUTPUT
 * of `preflight ∩ goal ∩ market ∩ budget`, never an operator step. The
 * operator says what they want; this module says which channels can do it and
 * why the others can't. Manual override survives in Advanced via the
 * channel allowlist (narrow-only — it can never force a blocked channel in).
 *
 * Exclusion-reason precedence (most structural first):
 *   1. create endpoint gap  — admin-ad-create-campaign has NO branch for the
 *      platform today (deployed truth: Meta generic + Google dedicated only)
 *   2. preflight red / not_connected (hard blockers B1–B5)
 *   3. goal unsupported on the platform
 *   4. market unreachable (TikTok can't target GB — live-proven T-P2)
 *   5. budget below the channel's floor
 *   6. Advanced allowlist (operator narrowed it)
 *
 * Preflight AMBER never excludes — it annotates ("Continue anyway (build
 * paused)" semantics: everything is created PAUSED, so building while a human
 * clears billing is legitimate — blueprint §1.0 buttons).
 */

import { platformsForGoals } from "./goals.js";
import { channelFloorCents, floorLabel } from "./budgetRules.js";

export const ALL_PLATFORMS = ["meta", "tiktok", "snapchat", "google", "reddit"];

export const PLATFORM_LABELS = {
  meta: "Meta",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  google: "Google",
  reddit: "Reddit",
};

/**
 * The deployed-endpoint truth (read from supabase/functions/admin-ad-create-
 * campaign on main): ONLY these platforms have a create branch. TikTok (#863)
 * and Reddit (#916) shipped live ADAPTERS + preflight + connect, but the
 * create endpoint routes them through Meta-shaped validations that
 * structurally 422/424 them. FLAGGED as an endpoint gap in the WP4 report —
 * do not widen this set until admin-ad-create-campaign gains their branches.
 */
export const CREATE_WIRED = ["meta", "google"];

export const CREATE_GAP_REASONS = {
  tiktok:
    "TikTok's adapter is live but admin-ad-create-campaign has no TikTok create branch yet — creating would fail. (Endpoint gap, flagged.)",
  reddit:
    "Reddit's adapter is live but admin-ad-create-campaign has no Reddit create branch yet — creating would fail. (Endpoint gap, flagged.)",
  snapchat: "Snapchat ships in WP5 (#867) — the adapter is a fail-close stub today.",
};

/**
 * TikTok cannot target GB — live tool_region_get returned 33 countries for
 * BOTH TRAFFIC and APP_PROMOTION with GB absent (PROOF T-P2, escalated to
 * TikTok). Fail loudly on an unavailable market, never drop it silently.
 */
export const MARKET_GAPS = {
  tiktok: { unavailable: ["GB"], reason: "TikTok can't target the UK from our ad account (live tool/region proof — escalated to TikTok)." },
  // Reddit can't BILL NGN (8-currency enum, no NGN) — Lagos is geo-targetable,
  // billed USD; the Nigeria LANE never routes to Reddit. Countries stay OK.
};

/**
 * One row per platform: { platform, eligible, excludedReason?, amber?, floorCents }.
 *
 * @param {object} input
 * @param {Array}  input.preflightRows  rows from admin-ad-preflight ({platform, overall, checks})
 * @param {Array}  input.goalIds        selected goal ids (≥1)
 * @param {Array}  input.countries      ISO country codes targeted
 * @param {number} input.totalDailyCents total daily budget in cents (0 = not yet entered)
 * @param {Array}  [input.allowlist]    Advanced channel allowlist (narrow-only)
 * @param {object} [input.connections]  platform → connection row (extra.minimum_budgets for Meta)
 * @param {string} [input.metaGoal]     Meta optimization_goal (drives the per-category floor)
 */
export function planChannels(input) {
  const {
    preflightRows = [],
    goalIds = [],
    countries = [],
    totalDailyCents = 0,
    allowlist = null,
    connections = {},
    metaGoal = "LINK_CLICKS",
  } = input;

  const preflightByPlatform = new Map(preflightRows.map((r) => [r.platform, r]));
  const { platforms: goalPlatforms } = platformsForGoals(goalIds);
  const goalSet = new Set(goalPlatforms);

  return ALL_PLATFORMS.map((platform) => {
    const floorCents = channelFloorCents(platform, {
      connection: connections[platform] ?? null,
      metaGoal,
    });
    const row = {
      platform,
      label: PLATFORM_LABELS[platform],
      eligible: false,
      excludedReason: null,
      amber: null,
      floorCents,
      floorLabel: floorLabel(platform, floorCents),
    };

    // 1. Create-endpoint gap — the most structural gate.
    if (!CREATE_WIRED.includes(platform)) {
      row.excludedReason = CREATE_GAP_REASONS[platform] ??
        `${PLATFORM_LABELS[platform]} create is not wired yet.`;
      return row;
    }

    // 2. Preflight hard state.
    const preflight = preflightByPlatform.get(platform);
    if (!preflight) {
      row.excludedReason = "Preflight hasn't run for this channel — run it above.";
      return row;
    }
    if (preflight.overall === "not_connected") {
      row.excludedReason = `${PLATFORM_LABELS[platform]} isn't connected.`;
      return row;
    }
    if (preflight.overall === "red") {
      const firstFail = (preflight.checks ?? []).find((c) => c.status === "fail");
      row.excludedReason = firstFail?.detail ??
        `${PLATFORM_LABELS[platform]} preflight has a hard blocker.`;
      return row;
    }

    // 3. Goal support.
    if (goalIds.length > 0 && !goalSet.has(platform)) {
      row.excludedReason =
        `${PLATFORM_LABELS[platform]} can't run the selected goal${goalIds.length > 1 ? "s" : ""} today.`;
      return row;
    }

    // 4. Market reachability (fail loudly, never silently drop).
    const gap = MARKET_GAPS[platform];
    if (gap && countries.some((c) => gap.unavailable.includes(c))) {
      row.excludedReason = `Not available: ${gap.reason}`;
      return row;
    }

    // 5. Budget floor (only once a budget is entered).
    if (totalDailyCents > 0 && floorCents !== null && totalDailyCents < floorCents) {
      row.excludedReason =
        `At $${(totalDailyCents / 100).toFixed(2)}/day we're leaving ${PLATFORM_LABELS[platform]} out — its minimum is ${row.floorLabel}, and we'd rather put your money where it can actually run.`;
      return row;
    }

    // 6. Advanced allowlist (narrow-only).
    if (Array.isArray(allowlist) && !allowlist.includes(platform)) {
      row.excludedReason = "Excluded by the Advanced channel allowlist.";
      return row;
    }

    row.eligible = true;
    // Amber annotations ride along (never exclude — "Continue anyway (build
    // paused)" semantics).
    if (preflight.overall === "amber") {
      const warns = (preflight.checks ?? []).filter((c) => c.status === "warn");
      row.amber = warns.map((c) => c.detail).filter(Boolean).join(" ") ||
        "Preflight has warnings — the build is fine, delivery may be gated.";
    }
    return row;
  });
}

/**
 * Client-side split of one total daily budget across eligible channels.
 * Blueprint §1.4 [DESIGN DECISION]: concentrate by default — a channel is
 * funded only at ≥ max(floor, viability); "diversify into starvation" is the
 * proven failure mode of the naive 2×median rule. This is a LOCAL estimate
 * (admin-ad-budget-plan-preview does not exist — flags.js); the create call
 * sends each channel its allocated amount as that campaign's daily budget.
 *
 * Priority order mirrors the blueprint's greedy fill: Meta > Google.
 */
export function splitBudget({ totalDailyCents, channelRows, strategy = "auto" }) {
  const eligible = channelRows.filter((r) => r.eligible);
  if (eligible.length === 0 || totalDailyCents <= 0) return [];

  const PRIORITY = ["meta", "tiktok", "google", "snapchat", "reddit"];
  const ordered = [...eligible].sort(
    (a, b) => PRIORITY.indexOf(a.platform) - PRIORITY.indexOf(b.platform),
  );
  const viability = (row) => Math.max(row.floorCents ?? 0, 500); // ≥$5/day to plausibly learn

  if (strategy === "concentrate") {
    return [{ platform: ordered[0].platform, dailyCents: totalDailyCents }];
  }

  // auto: concentrate unless the total funds ≥2 channels at viability.
  // diversify: fund as many as viability allows, evenly over the remainder.
  const fundable = [];
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
