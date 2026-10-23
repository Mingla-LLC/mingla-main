/**
 * ISSUE-864 WP4 [Campaign Builder] — the config-driven goal step (SPEC A1 as
 * corrected by A4.0(5) + blueprint §1.1).
 *
 * Rules encoded here:
 *  - Goals are an ARRAY, not hardcoded branches (A1 extensibility contract):
 *    #865 adds Reservations/Retargeting by appending entries, no rewrite.
 *  - Sales spans Meta, Snapchat and TikTok. Snapchat/TikTok require at least
 *    20 live provider purchase events in 28 days.
 *  - Traffic uses loaded page views on every supported platform, never shallow
 *    swipe/click optimization when a page-view goal exists.
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
      snapchat: { objective: "TRAFFIC", optimization_goal: "PIXEL_PAGE_VIEW" },
    },
    honestyNote: "Meta, Snapchat and TikTok optimise for loaded landing pages, not taps or swipes.",
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
    description: "Optimise delivery for completed ticket purchases.",
    visible: true,
    requiresMetaPixelSignal: true,
    platforms: {
      meta: { objective: "OUTCOME_SALES", optimization_goal: "OFFSITE_CONVERSIONS" },
      snapchat: { objective: "SALES", optimization_goal: "PIXEL_PURCHASE" },
      tiktok: { objective: "WEB_CONVERSIONS", optimization_goal: "CONVERT" },
    },
    honestyNote:
      "Meta needs a live pixel signal. Snapchat and TikTok each need at least 20 purchase events in the last 28 days.",
  },
  {
    id: "retargeting",
    label: "Bring back past visitors",
    description:
      "Run only the retargeting and checkout-recovery stages, with buyers excluded.",
    visible: true,
    platforms: {
      meta: {
        objective: "OUTCOME_TRAFFIC",
        optimization_goal: "LANDING_PAGE_VIEWS",
      },
      snapchat: { objective: "TRAFFIC", optimization_goal: "PIXEL_PAGE_VIEW" },
      tiktok: { objective: "TRAFFIC" },
    },
    honestyNote:
      "Any audience below 1,000 widens event → brand → market; if none qualifies, that stage is skipped.",
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
export const PURCHASE_SIGNAL_MIN_28D = 20;

export function purchaseSignalEligible(count) {
  return Number.isFinite(count) && count >= PURCHASE_SIGNAL_MIN_28D;
}

export function salesPlatformEligible(platform, signals = null) {
  if (signals === null) return true;
  if (platform === "meta") return signals.metaPixelHasSignal === true;
  if (platform === "snapchat") return purchaseSignalEligible(signals.snapPurchaseEvents28d);
  if (platform === "tiktok") return purchaseSignalEligible(signals.tiktokPurchaseEvents28d);
  return true;
}

export function platformsForGoal(goalId, signals = null) {
  const goal = goalById(goalId);
  if (!goal) return [];
  return Object.keys(goal.platforms).filter((platform) =>
    goalId !== "conversions" || salesPlatformEligible(platform, signals)
  );
}

/**
 * Platforms that can express EVERY selected goal (intersection), plus the
 * disjoint warning (blueprint §1.1): two goals with no shared channel run as
 * separate campaigns under one budget plan — fine, but say so.
 */
export function platformsForGoals(goalIds, signals = null) {
  const sets = goalIds.map((id) => new Set(platformsForGoal(id, signals)));
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
