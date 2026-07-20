/**
 * ISSUE-864 WP4 [Campaign Builder] — A4.0(1): the channel picker is an OUTPUT
 * of `preflight ∩ goal ∩ market ∩ budget`, never an operator step. The
 * operator says what they want; this module says which channels can do it and
 * why the others can't. Manual override survives in Advanced via the
 * channel allowlist (narrow-only — it can never force a blocked channel in).
 *
 * Exclusion-reason precedence (most structural first):
 *   1. create endpoint gap  — admin-ad-create-campaign has NO branch for the
 *      platform (EMPTY since ISSUE-927 — all five channels are create-wired;
 *      the gate stays first for any future adapter-first channel)
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
 * campaign): every platform now has a self-contained create branch — Meta
 * (WP1 generic path), Google (WP2), Snapchat (WP5), and TikTok + Reddit
 * (ISSUE-927 closed the WP4 endpoint gap). Downstream gates (preflight /
 * goal / market / budget) do the real narrowing; Snapchat additionally
 * fail-closes server-side (424 snapchat_profile_missing) until the
 * SNAPCHAT_PROFILE_ID secret is seeded — the slot ISSUE-927's secret
 * consolidation frees.
 */
export const CREATE_WIRED = ["meta", "google", "tiktok", "reddit", "snapchat"];

/**
 * Empty since ISSUE-927 — no platform sits behind the endpoint gap. Kept (with
 * planChannels' generic fallback copy) for the day a sixth channel lands
 * adapter-first again; StepPreflight renders these only for un-wired rows.
 */
export const CREATE_GAP_REASONS = {};

/**
 * TikTok cannot target GB — live tool_region_get returned 33 countries for
 * BOTH TRAFFIC and APP_PROMOTION with GB absent (PROOF T-P2, escalated to
 * TikTok). Fail loudly on an unavailable market, never drop it silently.
 */
export const MARKET_GAPS = {
  tiktok: { unavailable: ["GB"], reason: "TikTok can't target the UK from our ad account (live tool/region proof — escalated to TikTok)." },
  // QA P2-1 (blueprint §1.3): Reddit can't BILL NGN — funding currencies are
  // an 8-value enum with no NGN, and the languages enum has no Nigerian
  // language. "Don't route the Nigeria lane to Reddit." Encoded HERE (not
  // just prose) — LIVE in the default plan since ISSUE-927 wired Reddit's
  // create branch (the endpoint gap no longer pre-empts this rule).
  reddit: { unavailable: ["NG"], reason: "Reddit can't bill in naira (its funding-currency enum has no NGN) — Nigeria campaigns don't route to Reddit." },
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
 * @param {Array}  [input.createWired]  TEST-INJECTION ONLY (defaults to CREATE_WIRED) —
 *                                      lets the suite prove the downstream gates
 *                                      (market/floor) fire when a channel's create
 *                                      branch lands (QA P2-1: the NG/Reddit rule must
 *                                      not be dead code behind the endpoint gap).
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
    createWired = CREATE_WIRED,
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
    if (!createWired.includes(platform)) {
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

/**
 * ISSUE-979 Bug 4 [Campaign Builder correctness] — the channels that
 * planChannels marked ELIGIBLE but splitBudget funded at $0 (dropped from the
 * allocation entirely because the total can't jointly fund them at each
 * channel's learning minimum, or because Concentrate puts everything on the top
 * channel). The wizard used to leave these silent — the operator saw a green,
 * eligible channel, wrote copy for it, and it was never created, with no reason
 * on screen and Next still enabled. Surface them WITH an explicit reason so the
 * budget step can warn instead of silently proceeding.
 *
 * @param {object} input
 * @param {Array}  input.channelRows    planChannels() output.
 * @param {Array}  input.allocations    splitBudget() output.
 * @param {number} input.totalDailyCents total daily budget in cents.
 * @param {string} [input.strategy]     the split strategy in effect.
 * @returns {Array<{platform, label, viabilityCents, reason}>}
 */
export function unfundedEligibleChannels({ channelRows = [], allocations = [], totalDailyCents = 0, strategy = "auto" }) {
  if (!totalDailyCents || totalDailyCents <= 0) return [];
  const fundedSet = new Set((allocations ?? []).map((a) => a.platform));
  const totalLabel = `$${(totalDailyCents / 100).toFixed(2)}/day`;
  return (channelRows ?? [])
    .filter((r) => r.eligible && !fundedSet.has(r.platform))
    .map((r) => {
      const viabilityCents = Math.max(r.floorCents ?? 0, 500); // mirrors splitBudget's viability
      const viabilityLabel = `$${(viabilityCents / 100).toFixed(2)}/day`;
      const reason = strategy === "concentrate"
        ? `Concentrate funds only the top channel, so ${r.label} gets $0/day. Switch to Auto or Diversify, or raise the budget, to fund it.`
        : `At ${totalLabel} the plan can't also fund ${r.label} at its ~${viabilityLabel} learning minimum, so it gets $0/day. Raise the budget or drop a channel to include it.`;
      return { platform: r.platform, label: r.label, viabilityCents, reason };
    });
}
