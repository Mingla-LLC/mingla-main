/**
 * ISSUE-864 WP4 [Campaign Builder] — budget floors, pacing truths, the
 * learning-limited formula and the frequency-cap gate (SPEC A4.0(4), A4.e,
 * A4.g; blueprint §1.4).
 *
 * Money contract: dollars-in / CENTS-AT-REST. Conversion to micro/dollars is
 * the ADAPTER's job at the API boundary — never the builder's (the 10,000×
 * cents-vs-micro money bug, blueprint §1.4 Discovery 3).
 */

// ── Meta per-category floors (A4.0(4) / PROOF M-P8) ───────────────────────────
// NEVER hardcoded: read from ad_connections.extra.minimum_budgets, fetched
// live at connect (GET /act_{id}/minimum_budgets). This map mirrors the
// server's metaBudgetCategoryForGoal (supabase/functions/_shared/adChannel.ts)
// — LINK_CLICKS is HIGH-FREQUENCY (=$5/day floor live-probed), not $1.
export function metaBudgetCategoryForGoal(goal) {
  switch (goal) {
    case "IMPRESSIONS":
    case "REACH":
    case "AD_RECALL_LIFT":
      return "imp";
    case "THRUPLAY":
    case "VIDEO_VIEWS":
    case "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS":
      return "video_views";
    case "LINK_CLICKS":
    case "LANDING_PAGE_VIEWS":
    case "POST_ENGAGEMENT":
    case "PAGE_LIKES":
    case "EVENT_RESPONSES":
    case "PROFILE_VISIT":
    case "VISIT_INSTAGRAM_PROFILE":
    case "REMINDERS_SET":
      return "high_freq";
    default:
      return "low_freq";
  }
}

/**
 * Meta's floor for the chosen goal, from the CONNECTION row (extra.
 * minimum_budgets) — null when the connection hasn't stored floors yet
 * (the server then 424s create with "re-run admin-ad-connect").
 */
export function metaFloorCents(connection, goal) {
  const floors = connection?.extra?.minimum_budgets;
  if (!floors || typeof floors !== "object") return null;
  const value = floors[metaBudgetCategoryForGoal(goal)];
  return typeof value === "number" ? value : null;
}

/**
 * Per-channel floor in cents (blueprint §1.4 floor table):
 *  - Meta: per-CATEGORY from the connection row (never hardcoded).
 *  - TikTok: $20/day per ad group (confirmed verbatim).
 *  - Snapchat: $5/day squad ($20/day campaign — we build one squad).
 *  - Google: NO hard API floor; practical $5–10/day → floor null, viability 500¢.
 *  - Reddit: NO floor in the OpenAPI — never invent one; let the API 400.
 */
export function channelFloorCents(platform, { connection = null, metaGoal = "LINK_CLICKS" } = {}) {
  switch (platform) {
    case "meta":
      return metaFloorCents(connection, metaGoal);
    case "tiktok":
      return 2000;
    case "snapchat":
      return 500;
    case "google":
      return null; // no hard API floor — practical guidance only
    case "reddit":
      return null; // the OpenAPI encodes none — do not hardcode $5/day
    default:
      return null;
  }
}

export function floorLabel(platform, floorCents) {
  if (typeof floorCents === "number") {
    return `$${(floorCents / 100).toFixed(2)}/day`;
  }
  if (platform === "google") return "no hard minimum (practical $5–10/day)";
  if (platform === "reddit") return "no published minimum";
  return "unknown until connected";
}

// ── Pacing truths (A4.e — honest badges, exact figures) ──────────────────────
export const PACING_DISCLOSURES = {
  meta:
    "Meta may spend up to 175% of your daily budget on a single day (not the folklore 2×), averaging out Sunday–Saturday — never more than 7× your daily budget in a week.",
  google:
    "Google can spend up to 2× your daily budget on one day; the month is capped at about 30.4× the daily budget, with overdelivery refunded as credit.",
};

/** The launch-confirm modal line (blueprint §1.8, verbatim shape). */
export function launchConfirmCopy({ channelCount, totalDailyCents }) {
  const dollars = (totalDailyCents / 100).toFixed(2);
  return `Launch across ${channelCount} channel${channelCount === 1 ? "" : "s"}? This starts spending up to $${dollars}/day (Meta can spend up to 175% of that on a busy day, evening out across the week). You can pause any time.`;
}

// ── Learning-phase honesty (A4.e / GR-47) ─────────────────────────────────────
// Meta's learning exit bar is ~50 optimization events / ad set / rolling 7
// days. Warn at create when daily × 7 ÷ estimated_CPA < 50. The CPA estimate
// is the Travel/Arts CPC consensus (~$0.50) — an ESTIMATE, labeled as such.
export const DEFAULT_ESTIMATED_CPA_CENTS = 50;
export const LEARNING_EXIT_EVENTS_PER_WEEK = 50;

export function learningLimitedWarning(dailyCents, estimatedCpaCents = DEFAULT_ESTIMATED_CPA_CENTS) {
  if (!dailyCents || dailyCents <= 0 || !estimatedCpaCents) return null;
  const weeklyEvents = (dailyCents * 7) / estimatedCpaCents;
  if (weeklyEvents >= LEARNING_EXIT_EVENTS_PER_WEEK) return null;
  return (
    `This ad set is unlikely to reach the ~50 results per week Meta needs to leave its learning phase at this budget (est. ${Math.round(weeklyEvents)}/week). ` +
    "Treat the numbers as directional only — they are not a verdict on the channel."
  );
}

// ── Frequency-cap gate (A4.g / GR-63) ─────────────────────────────────────────
// Meta's frequency_control_specs is writable ONLY on REACH/THRUPLAY ad sets —
// on LINK_CLICKS it 400s. When the control ships (flags.FREQUENCY_CAP_
// CONTROL_ENABLED), it renders ONLY when this returns true; otherwise it is
// ABSENT (not disabled — absent).
export function frequencyCapAllowed(optimizationGoal) {
  return optimizationGoal === "REACH" || optimizationGoal === "THRUPLAY";
}

// ── Budget validation (blueprint §1.4 messages) ───────────────────────────────
export function validateBudget({ totalDailyCents, channelRows }) {
  const errors = [];
  if (!totalDailyCents || totalDailyCents <= 0) {
    errors.push("Enter a daily budget.");
    return errors;
  }
  const eligible = channelRows.filter((r) => r.eligible);
  if (eligible.length === 0) {
    const floors = channelRows
      .map((r) => ({ label: r.label, floorCents: r.floorCents }))
      .filter((r) => typeof r.floorCents === "number")
      .sort((a, b) => a.floorCents - b.floorCents);
    if (floors.length > 0 && totalDailyCents < floors[0].floorCents) {
      errors.push(
        `$${(totalDailyCents / 100).toFixed(2)}/day is below every channel's minimum. The cheapest we can run is $${(floors[0].floorCents / 100).toFixed(2)}/day on ${floors[0].label}.`,
      );
    } else {
      errors.push("No channel can run this campaign right now — fix the blockers above.");
    }
  }
  return errors;
}
