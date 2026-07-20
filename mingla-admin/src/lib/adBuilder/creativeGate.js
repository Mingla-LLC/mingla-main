/**
 * ISSUE-995 [Campaign Builder creative] Wave 3 of #977 — the PROCEED-WITH-
 * PASSING gate (Seth finding #7 core) + the needs_transcode reconciliation.
 *
 * Two problems this closes (ISSUE-977 Lane F Q6):
 *
 * 1. HARD-BLOCK ON THE WHOLE FUNDED SET. CampaignBuilderPage gated Next on
 *    `funded.every(c => c.ok)` — one rejected channel disabled Next for the
 *    ENTIRE build, even though the backend create loop is per-channel
 *    independent (runCreate loops allocations and records results[platform]
 *    separately). This partitions the funded set into the channels that CAN
 *    build now and the ones to EXCLUDE — the build proceeds on the passing
 *    ones, with the failing ones named. It never forces a failing channel
 *    through: excluded channels are simply not created.
 *
 * 2. THE `ok` vs needs_transcode MISMATCH. adCreativeMatrix marks a channel
 *    `ok = !checks.some(level==="reject")` (matrix:588) — so a needs_transcode
 *    channel (off-ratio, no covering variant) has `ok=true` and the old badge
 *    showed it "ready" and the gate passed it. But resolveCreativeRef
 *    (adCreative.ts:1523) BLOCKS `needsTranscode` at create — so that channel
 *    was told "ready", proceeded, and then failed at create. `creativeReady`
 *    treats needs_transcode as NOT ready, matching the resolver, so "ready"
 *    can never become a create-time failure.
 */

/**
 * A funded channel is buildable ONLY if its server validation passed with NO
 * reject AND NO outstanding needs_transcode (which resolveCreativeRef blocks
 * at create). A channel with no validation entry yet is not ready.
 */
export function creativeReady(channel) {
  return Boolean(channel && channel.ok === true && channel.needsTranscode !== true);
}

/** Why a funded channel is excluded (drives the on-screen note). */
export function creativeExclusionReason(channel) {
  if (!channel) return "not_validated";
  if (channel.needsTranscode === true) return "needs_transcode";
  if (channel.ok !== true) return "blocked";
  return null;
}

/**
 * Partition the funded platforms into the set that can build with this
 * creative now and the set to exclude (each with a reason).
 *
 * @param {object} input
 * @param {string[]} input.fundedPlatforms   platforms the budget funded (allocations)
 * @param {Array}    input.channels          validation.channels from the byte-probe
 * @returns {{ buildable: string[], excluded: Array<{platform, reason, channel}> }}
 */
export function partitionFundedCreative({ fundedPlatforms = [], channels = [] }) {
  const byPlatform = new Map((channels ?? []).map((c) => [c.platform, c]));
  const buildable = [];
  const excluded = [];
  for (const platform of fundedPlatforms) {
    const channel = byPlatform.get(platform) ?? null;
    if (creativeReady(channel)) {
      buildable.push(platform);
    } else {
      excluded.push({ platform, reason: creativeExclusionReason(channel), channel });
    }
  }
  return { buildable, excluded };
}
