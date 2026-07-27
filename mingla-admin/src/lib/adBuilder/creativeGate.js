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
 * ISSUE-995 REWORK (tester P1/P2) — VIDEO AD CREATE IS NOT WIRED YET.
 * admin-ad-create-campaign never calls resolveCreativeRef (the lazy per-platform
 * video uploader), so a video ad actually FAILS at create on Meta/TikTok/Snap/
 * Reddit (honest 422) and — worse — fires a fabricated "Created" for a text-only
 * ad on Google. Until this flag flips (in #997, when the create endpoint wires
 * video), the builder is PREVIEW-ONLY for video: it validates + previews per
 * placement, but no video channel is ever built. Flip to true ONLY when
 * admin-ad-create-campaign can actually create a video ad.
 */
/**
 * ISSUE-997 C: TikTok paused-video create is wired end-to-end
 * (admin-ad-creative-prepare captures video_id + cover_image_id → the
 * admin-ad-create-campaign TikTok SINGLE_VIDEO branch builds a PAUSED ad).
 * ISSUE-997 D2: Google video create is now wired too — a Google video walks to a
 * READY google ref (D1 YouTube resumable upload → external_ref_extra.
 * youtube_video_id), and the admin-ad-create-campaign Google Demand Gen branch
 * builds a PAUSED demandGenVideoResponsiveAd from it. ONLY Reddit video create
 * remains fail-closed (no wired create path).
 */
export const VIDEO_CREATE_ENABLED = Object.freeze({
  meta: true,
  snapchat: true,
  tiktok: true,
  google: true,
  reddit: false,
});

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
 * @param {"image"|"video"} [input.kind]     creative kind (default "image")
 * @returns {{ buildable: string[], excluded: Array<{platform, reason, channel}> }}
 */
export function partitionFundedCreative({
  fundedPlatforms = [],
  channels = [],
  kind = "image",
  preparationByPlatform = {},
}) {
  const byPlatform = new Map((channels ?? []).map((c) => [c.platform, c]));
  const buildable = [];
  const excluded = [];
  for (const platform of fundedPlatforms) {
    const channel = byPlatform.get(platform) ?? null;
    // ISSUE-995 REWORK (tester P1/P2): video ad create is not wired yet, so NO
    // video channel can build — every funded channel is excluded (preview-only),
    // never a misleading build nor a fabricated Google "Created". This gates the
    // build path itself; validation + placement previews still render.
    if (kind === "video") {
      if (VIDEO_CREATE_ENABLED[platform] !== true) {
        // ISSUE-997 C/D2: tiktok AND google are now VIDEO_CREATE_ENABLED, so they
        // never reach this exclusion branch — only reddit (video_not_creatable)
        // remains unwired for video.
        excluded.push({
          platform,
          reason: "video_not_creatable",
          channel,
        });
        continue;
      }
      if (preparationByPlatform[platform]?.state !== "ready") {
        excluded.push({
          platform,
          reason: `preparation_${preparationByPlatform[platform]?.state ?? "not_started"}`,
          channel,
        });
        continue;
      }
    }
    if (creativeReady(channel)) {
      buildable.push(platform);
    } else {
      excluded.push({ platform, reason: creativeExclusionReason(channel), channel });
    }
  }
  return { buildable, excluded };
}
