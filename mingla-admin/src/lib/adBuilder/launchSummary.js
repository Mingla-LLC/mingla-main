/**
 * ISSUE-864 WP4 [Campaign Builder] — blueprint §1.8: the launch-confirmation
 * summary model. Per-channel rows (allocated $/day · status · goal), blocked/
 * excluded channels WITH the reason inline, destination + creative + copy
 * check lines, and the amber warnings (billing, learning-phase) — all
 * rendered BEFORE the separate Launch action.
 */

import { learningLimitedWarning } from "./budgetRules.js";
import { formatResolvedObjective } from "./objectiveResolver.js";

/**
 * @param {object} input
 * @param {Array}  input.channelRows   planChannels() output
 * @param {Array}  input.allocations   splitBudget() output [{platform, dailyCents}]
 * @param {object|null} input.resolvedGoal  resolveGoalForPayload() output — the
 *   SAME coherent per-platform objective resolution runCreate uses (ISSUE-980
 *   finding #3). Each channel row's `objectiveLabel` comes from here — never a
 *   single string repeated across every platform.
 * @param {object} input.destination   { title, dest_url } — legacy single (kept
 *   for backward compatibility; a single-destination build renders identically).
 * @param {Array}  input.destinations  ISSUE-1002 [multi-destination fan-out] —
 *   [{ title, dest_url }]. When present it supersedes `destination`; length > 1
 *   renders a "N destinations — …" line. Absent → falls back to `destination`.
 * @param {object} input.creative      { name, width, height, kind, validation }
 * @param {object} input.copyCheck     { policyFindings, copyHardBlocks }
 * @param {number} input.totalDailyCents
 */
export function buildLaunchSummary(input) {
  const {
    channelRows = [],
    allocations = [],
    resolvedGoal = null,
    destination = null,
    destinations = null,
    creative = null,
    copyCheck = { policyFindings: 0, copyHardBlocks: 0 },
    totalDailyCents = 0,
    preparationByPlatform = {},
    budgetMode = "daily",
    capCents = null,
    startsAt = null,
    endsAt = null,
    // Legacy pure-helper callers omitted currency before #3697; keep their
    // explicit test contract while the live builder always passes a value (or
    // null, which renders unavailable and blocks create).
    currency = "USD",
  } = input;

  const currencyCode = typeof currency === "string" && /^[A-Z]{3}$/.test(currency)
    ? currency
    : null;
  const moneyLabel = (cents) => {
    if (!currencyCode) return "Currency unavailable";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode,
      }).format(cents / 100);
    } catch {
      return `${currencyCode} ${(cents / 100).toFixed(2)}`;
    }
  };

  // ISSUE-1002 [multi-destination fan-out] — the effective destination list. The
  // new `destinations[]` array wins when supplied; otherwise fall back to the
  // legacy single `destination` (so pre-1002 callers and single-destination
  // builds render byte-identically).
  const destList = Array.isArray(destinations)
    ? destinations
    : (destination ? [destination] : []);

  const allocationByPlatform = new Map(allocations.map((a) => [a.platform, a.dailyCents]));

  // ISSUE-980 finding #3: the Goal step's "Advanced" copy promises Review
  // shows the resolved per-platform objective — it used to render the same
  // blanket goal-label string on every row instead. Meta's pair always comes
  // from resolveMetaObjective's own coherent fallback (never null); every
  // other platform reads its own resolved entry, or an honest "not resolved"
  // string when a funded channel genuinely has none (never borrows another
  // platform's value).
  const objectiveLabelFor = (platform) => {
    if (!resolvedGoal) return formatResolvedObjective(platform, null);
    if (platform === "meta") {
      return formatResolvedObjective("meta", {
        objective: resolvedGoal.metaObjective,
        optimization_goal: resolvedGoal.metaOptimizationGoal,
      });
    }
    return formatResolvedObjective(platform, resolvedGoal.platforms?.[platform] ?? null);
  };

  const channelLines = [];
  const blockedLines = [];
  for (const row of channelRows) {
    const allocated = allocationByPlatform.get(row.platform);
    if (row.eligible && typeof allocated === "number" && allocated > 0) {
      channelLines.push({
        platform: row.platform,
        label: row.label,
        dailyCents: allocated,
        dailyLabel: `${moneyLabel(allocated)}/day`,
        statusLine: "Paused → will go live on Launch",
        objectiveLabel: objectiveLabelFor(row.platform),
        amber: row.amber ?? null,
        videoReadiness: creative?.kind === "video"
          ? row.platform === "meta"
            ? preparationByPlatform.meta?.state === "ready"
              ? "Video ready · real preview available"
              : "Video not ready"
            : row.platform === "snapchat"
            ? preparationByPlatform.snapchat?.state === "ready"
              ? "Video ready · Mingla approximation"
              : "Video not ready"
            : null
          : null,
      });
    } else if (row.eligible) {
      blockedLines.push({ platform: row.platform, label: row.label, reason: "Not funded by the split." });
    } else {
      blockedLines.push({ platform: row.platform, label: row.label, reason: row.excludedReason });
    }
  }

  const warnings = [];
  for (const line of channelLines) {
    if (line.amber) warnings.push(`${line.label}: ${line.amber}`);
    const learning = learningLimitedWarning(line.dailyCents);
    if (learning) warnings.push(`${line.label}: ${learning}`);
  }

  const copyLine = copyCheck.copyHardBlocks > 0
    ? `Copy has ${copyCheck.copyHardBlocks} unresolved hard block(s) — fix before creating.`
    : copyCheck.policyFindings > 0
    ? `Checked: ${copyCheck.policyFindings} policy warning(s) — reviewed, warn-only.`
    : "Checked: no personal-attribute risk, no editorial flags";

  // toward #3697 Wave 2 (#3707): one page per campaign — never multiply budgets silently.
  const destCount = Math.min(destList.length, 1);
  const campaignCount = channelLines.length * destCount;
  const multiDestBlocked = destList.length > 1
    ? "Pick one page per campaign. Multi-select used to multiply spend silently."
    : null;

  // toward #3697 Wave 3 — Review shows the same hard-cap / schedule truths the server enforces.
  const cap = typeof capCents === "number" && Number.isFinite(capCents) ? capCents : null;
  const scheduleBits = [];
  if (startsAt) scheduleBits.push(`starts ${new Date(startsAt).toLocaleString()}`);
  if (endsAt) scheduleBits.push(`ends ${new Date(endsAt).toLocaleString()}`);
  const scheduleLine = scheduleBits.length > 0 ? scheduleBits.join(" · ") : null;
  const hardCapLine = cap != null
    ? `Hard cap ${moneyLabel(cap)} — pauses at 98% of cap (server-enforced)`
    : null;
  const budgetLine = budgetMode === "lifetime"
    ? `Lifetime budget · ${moneyLabel(totalDailyCents > 0 && cap != null ? cap : totalDailyCents)}`
    : `${moneyLabel(totalDailyCents)}/day total`;

  return {
    campaignCount,
    headline: creative?.kind === "video"
      ? `Ready to create ${campaignCount} paused video campaign${campaignCount === 1 ? "" : "s"} across ${channelLines.length} platform${channelLines.length === 1 ? "" : "s"}`
      : `Ready to create across ${channelLines.length} channel${channelLines.length === 1 ? "" : "s"} · ${budgetMode === "lifetime" ? "lifetime" : `${moneyLabel(totalDailyCents)}/day`} total`,
    primaryActionLabel: creative?.kind === "video"
      ? `Create ${campaignCount} campaign${campaignCount === 1 ? "" : "s"} (paused)`
      : "Create campaign (paused)",
    channels: channelLines,
    blocked: blockedLines,
    destinationLine: destList.length === 0
      ? "No destination picked."
      : destList.length === 1
      ? `${destList[0].title} — ${destList[0].dest_url}`
      : multiDestBlocked,
    creativeLine: creative
      ? `1 ${creative.kind ?? "image"}${creative.width ? ` (${creative.width}×${creative.height})` : ""} — ${creative.name ?? "unnamed"}`
      : "No creative attached.",
    copyLine,
    budgetLine,
    hardCapLine,
    scheduleLine,
    warnings,
  };
}
