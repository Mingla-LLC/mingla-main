/**
 * ISSUE-864 WP4 [Campaign Builder] — the config-driven goal step (SPEC A1 as
 * corrected by A4.0(5) + blueprint §1.1).
 *
 * Rules encoded here:
 *  - Goals are an ARRAY, not hardcoded branches (A1 extensibility contract):
 *    #865 adds Reservations/Retargeting by appending entries, no rewrite.
 *  - Sales is shown only as a Meta goal and is disabled by the UI until the
 *    connection's real pixel-signal check passes.
 *  - Meta traffic optimizes for landing-page views; Snap does the same only
 *    after its real pixel-stats read reports a signal (otherwise SWIPES).
 *  - The goal step is MULTI-SELECT (A4.0(1)); disjoint-channel selections get
 *    a warning, not a block (blueprint §1.1 validation).
 */

/** Per-goal per-platform native mapping (blueprint §1.1 table, create-wired rows only). */
export const GOALS = [
  {
    id: "traffic",
    label: "Send people to a page",
    description: "Drive clicks to a live Mingla event or brand page.",
    visible: true,
    // Platforms whose CREATE path can express this goal TODAY (see
    // channelPlan.CREATE_WIRED for the endpoint-support gate).
    platforms: {
      meta: { objective: "OUTCOME_TRAFFIC", optimization_goal: "LANDING_PAGE_VIEWS" },
      google: { channel_type: "SEARCH", strategy: "maximize_clicks" },
      tiktok: { objective: "TRAFFIC" },
      reddit: { objective: "CLICKS" },
      snapchat: { objective: "TRAFFIC", optimization_goal: "SWIPES" },
    },
    honestyNote: "Meta optimizes for landing-page views. Snapchat does when its pixel is detected; otherwise it optimizes for swipes.",
  },
  {
    id: "awareness",
    label: "Build awareness",
    description: "Show the night to as many of the right people as possible.",
    visible: true,
    platforms: {
      meta: { objective: "OUTCOME_AWARENESS", optimization_goal: "REACH" },
      // Google awareness = DISPLAY, which admin-ad-create-campaign does NOT
      // build (SEARCH+RSA only) — so google is absent here, honestly.
      snapchat: { objective: "AWARENESS_AND_ENGAGEMENT", optimization_goal: "IMPRESSIONS" },
      tiktok: { objective: "REACH" },
      reddit: { objective: "IMPRESSIONS" },
    },
    honestyNote:
      "Awareness has no strong success signal — the Brain won't move money on it much.",
  },
  {
    id: "conversions",
    label: "Sales (ticket purchases)",
    description: "Optimise Meta delivery for completed ticket purchases.",
    visible: true,
    requiresMetaPixelSignal: true,
    platforms: {
      meta: { objective: "OUTCOME_SALES", optimization_goal: "OFFSITE_CONVERSIONS" },
    },
    honestyNote: "Available once the connected Meta pixel has recorded a real signal.",
  },
  {
    id: "retargeting",
    label: "Bring back past visitors",
    visible: false,
    shipsWith: "#865",
    hiddenReason:
      "There are 0 custom audiences on every channel and no tracked-visitor seed until #865 Phase B.",
    platforms: {},
  },
];

/** The goal cards the operator sees — hidden goals never render (A4.0(5)). */
export function visibleGoals() {
  return GOALS.filter((g) => g.visible);
}

export function goalById(id) {
  return GOALS.find((g) => g.id === id) ?? null;
}

/** Platforms that can natively express a goal (before endpoint/market/budget gates). */
export function platformsForGoal(goalId) {
  const goal = goalById(goalId);
  if (!goal) return [];
  return Object.keys(goal.platforms);
}

/**
 * Platforms that can express EVERY selected goal (intersection), plus the
 * disjoint warning (blueprint §1.1): two goals with no shared channel run as
 * separate campaigns under one budget plan — fine, but say so.
 */
export function platformsForGoals(goalIds) {
  const sets = goalIds.map((id) => new Set(platformsForGoal(id)));
  if (sets.length === 0) return { platforms: [], disjoint: false };
  const union = new Set(sets.flatMap((s) => [...s]));
  const intersection = [...union].filter((p) => sets.every((s) => s.has(p)));
  return {
    platforms: intersection.length > 0 ? intersection : [...union],
    disjoint: sets.length > 1 && intersection.length === 0,
  };
}

export const DISJOINT_GOALS_WARNING =
  "These two goals don't share a single channel. We'll run them as separate campaigns under one budget plan — that's fine, but each goal gets its own money.";
