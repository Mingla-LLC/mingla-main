/**
 * ISSUE-979 Bug 1 [Campaign Builder correctness] — the SINGLE SOURCE OF TRUTH
 * that resolves each platform's (objective, optimization_goal) COHERENTLY from
 * a multi-goal selection.
 *
 * The bug this fixes (guaranteed-422, click-order-decides): the wizard used to
 * collapse a multi-goal selection to `goalIds[0]` for TikTok/Reddit/Snap/Google
 * (silently dropping the other goals), and for Meta it derived `objective` from
 * `goalIds[0]` but `optimization_goal` from the WHOLE array — so e.g.
 * [awareness, traffic] produced the INVALID Meta pair
 * OUTCOME_AWARENESS / LINK_CLICKS (guaranteed 422 at create).
 *
 * The invariant established here: for any goal set the UI allows, a platform's
 * objective AND optimization_goal are BOTH read from the SAME goals.js entry —
 * one authored, always-valid pair. Never `goalIds[0]` for one field and the
 * full array for another.
 *
 * Multi-goal precedence: when several goals are selected, the deepest-funnel /
 * strongest-signal goal the platform supports wins (conversions > retargeting >
 * traffic > awareness). For the two live goals this means traffic wins over
 * awareness — which is exactly the valid Meta pairing (OUTCOME_TRAFFIC /
 * LINK_CLICKS), independent of the click order.
 */

import { goalById } from "./goals.js";
import { ALL_PLATFORMS } from "./channelPlan.js";

/**
 * Deepest-funnel first. Goals absent from this list rank LAST (never ahead of a
 * ranked goal). conversions/retargeting are hidden until #865 but are ranked
 * here so they win the day they ship — no re-think needed then.
 */
export const GOAL_PRIORITY = ["conversions", "retargeting", "traffic", "awareness"];

/** Selected goal ids ordered by precedence (highest-priority first). */
export function orderGoalIdsByPriority(goalIds) {
  const rank = (id) => {
    const i = GOAL_PRIORITY.indexOf(id);
    return i === -1 ? GOAL_PRIORITY.length : i;
  };
  // Stable sort by precedence (Array.prototype.sort is stable in modern JS).
  return [...(goalIds ?? [])].sort((a, b) => rank(a) - rank(b));
}

/**
 * The ONE goals.js per-platform entry (a coherent pair) for a multi-goal
 * selection on a given platform: the highest-priority selected goal that the
 * platform can natively express. Returns the whole entry (e.g.
 * { objective, optimization_goal }) so BOTH fields come from a single source —
 * or null when no selected goal is expressible on the platform.
 */
export function resolvePlatformObjective(goalIds, platform) {
  for (const id of orderGoalIdsByPriority(goalIds)) {
    const entry = goalById(id)?.platforms?.[platform];
    if (entry) return entry;
  }
  return null;
}

/**
 * Meta's coherent { objective, optimization_goal } — BOTH from the same entry.
 * This is the pair the create payload and the per-category budget floor both
 * read, so there is exactly one Meta optimization goal in play. Falls back to
 * the valid OUTCOME_TRAFFIC / LINK_CLICKS pair when nothing is expressible.
 */
export function resolveMetaObjective(goalIds) {
  const entry = resolvePlatformObjective(goalIds, "meta");
  if (entry && entry.objective && entry.optimization_goal) {
    return { objective: entry.objective, optimization_goal: entry.optimization_goal };
  }
  return { objective: "OUTCOME_TRAFFIC", optimization_goal: "LINK_CLICKS" };
}

/**
 * The coherent `goal` object buildCreatePayload consumes for the WHOLE admitted
 * channel set — one resolution pass, one source of truth. Meta's objective and
 * optimization_goal come from the same entry; every other platform's native
 * objective (and Snap's optimization_goal) comes from ITS own resolved entry.
 */
export function resolveGoalForPayload(goalIds) {
  const meta = resolveMetaObjective(goalIds);
  const platforms = {};
  for (const platform of ALL_PLATFORMS) {
    const entry = resolvePlatformObjective(goalIds, platform);
    if (entry) platforms[platform] = entry;
  }
  return {
    metaObjective: meta.objective,
    metaOptimizationGoal: meta.optimization_goal,
    platforms,
  };
}

/**
 * ISSUE-980 [Campaign Builder clarity] finding #3 — a short, honest,
 * per-platform string for the Review step's channel rows. Review used to
 * print the SAME goal-label string on every row even though the Goal step's
 * "Advanced" copy promises Review shows the resolved per-platform objective
 * (ISSUE-977 Lane B F-5). This renders what resolveGoalForPayload actually
 * resolved for ONE platform — never a fabricated or borrowed value.
 *
 * Google has no `objective`/`optimization_goal` pair at all (its create path
 * is a fixed Search+RSA strategy, not goal-driven — ISSUE-977 Lane A F-1
 * table) — `channel_type`/`strategy` stand in for it. Every other resolved
 * platform entry carries `objective` (+ `optimization_goal` where the
 * platform has one).
 *
 * @param {"meta"|"google"|"tiktok"|"reddit"|"snapchat"} platform
 * @param {object|null} entry — the resolved goals.js entry for this
 *   platform (or null when no selected goal is expressible on it).
 * @returns {string}
 */
export function formatResolvedObjective(platform, entry) {
  if (!entry) {
    return "No objective resolved for this platform — check the selected goal(s).";
  }
  if (platform === "google") {
    return `${entry.channel_type ?? "SEARCH"} · ${entry.strategy ?? "n/a"}`;
  }
  if (!entry.objective) {
    return "No objective resolved for this platform — check the selected goal(s).";
  }
  return entry.optimization_goal ? `${entry.objective} · ${entry.optimization_goal}` : entry.objective;
}
