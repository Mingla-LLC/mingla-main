/**
 * ISSUE-864 WP4 [Campaign Builder] — blueprint §1.8: the launch-confirmation
 * summary model. Per-channel rows (allocated $/day · status · goal), blocked/
 * excluded channels WITH the reason inline, destination + creative + copy
 * check lines, and the amber warnings (billing, learning-phase) — all
 * rendered BEFORE the separate Launch action.
 */

import { learningLimitedWarning } from "./budgetRules.js";
import { formatResolvedObjective } from "./objectiveResolver.js";

function dollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * @param {object} input
 * @param {Array}  input.channelRows   planChannels() output
 * @param {Array}  input.allocations   splitBudget() output [{platform, dailyCents}]
 * @param {object|null} input.resolvedGoal  resolveGoalForPayload() output — the
 *   SAME coherent per-platform objective resolution runCreate uses (ISSUE-980
 *   finding #3). Each channel row's `objectiveLabel` comes from here — never a
 *   single string repeated across every platform.
 * @param {object} input.destination   { title, dest_url }
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
    creative = null,
    copyCheck = { policyFindings: 0, copyHardBlocks: 0 },
    totalDailyCents = 0,
  } = input;

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
        dailyLabel: `${dollars(allocated)}/day`,
        statusLine: "Paused → will go live on Launch",
        objectiveLabel: objectiveLabelFor(row.platform),
        amber: row.amber ?? null,
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

  return {
    headline: `Ready to create across ${channelLines.length} channel${channelLines.length === 1 ? "" : "s"} · ${dollars(totalDailyCents)}/day total`,
    channels: channelLines,
    blocked: blockedLines,
    destinationLine: destination
      ? `${destination.title} — ${destination.dest_url}`
      : "No destination picked.",
    creativeLine: creative
      ? `1 ${creative.kind ?? "image"}${creative.width ? ` (${creative.width}×${creative.height})` : ""} — ${creative.name ?? "unnamed"}`
      : "No creative attached.",
    copyLine,
    warnings,
  };
}
