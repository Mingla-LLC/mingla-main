/**
 * ISSUE-995 [Campaign Builder creative] Wave 3 of #977 — the PER-PLACEMENT
 * catalog + report.
 *
 * The problem (ISSUE-977 Lane F Q2/Q5): validation is per-PLATFORM, not
 * per-PLACEMENT. adCreativeMatrix.classifyRatio checks the master's single
 * aspect ratio against a platform's allowed-ratio SET (a union of that
 * platform's placements) — so it can say "Meta accepts this ratio" but NEVER
 * "passes Feed 1:1, fails Reels 9:16." Seth's finding #7 asks for exactly that
 * placement-granular answer plus a preview cropped to each placement.
 *
 * This module encodes the placement rows (derived VERBATIM from the same
 * PIPELINE_BLUEPRINT §2 constants adCreativeMatrix.ts encodes — the platform
 * ratio sets, GOOGLE_IMAGE_SLOTS minimums, TikTok floors, Snap 1080×1920) and
 * produces a per-placement pass/fail report against the SERVER byte-probe
 * (never admin-supplied dimensions). A covering pre-cropped VARIANT slot
 * (ad_creatives.variants) makes a placement pass even when the master ratio
 * differs — mirroring the matrix's needs_transcode→warn softening.
 *
 * Local, deterministic, and offline — the platform-rendered preview endpoint
 * (Meta GET /{ad_id}/previews etc.) is still dark (flags.API_AD_PREVIEWS_ENABLED
 * = false); this is the blueprint §1.7a "where no API preview exists, draw one"
 * fallback done accurately per placement.
 */

import { PLATFORM_LABELS } from "./channelPlan.js";

/** Ratio label → numeric target (matches adCreativeMatrix.RATIO_SLOTS). */
export const RATIO_SLOTS = {
  "9:16": 9 / 16,
  "1:1": 1,
  "4:5": 4 / 5,
  "16:9": 16 / 9,
  "1.91:1": 1.91,
};

/**
 * A frontend copy of adCreativeMatrix.classifyRatio (the Vite admin cannot
 * import the Deno .ts). SAME relative-delta device, SAME default tolerance —
 * so a placement's verdict here never disagrees with the server matrix.
 */
export function classifyRatio(ratio, allowed, tolerance = 0.03) {
  if (ratio === null || ratio === undefined || ratio <= 0) return null;
  let best = null;
  let bestDelta = Infinity;
  for (const label of allowed) {
    const target = RATIO_SLOTS[label];
    if (!target) continue;
    const delta = Math.abs(ratio - target) / target;
    if (delta <= tolerance && delta < bestDelta) {
      best = label;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * One row per real ad PLACEMENT. `min` is the hard resolution floor (a right
 * ratio below it still fails); `recommended` is the soft target. Numbers are
 * the §2 constants adCreativeMatrix.ts encodes — this module does not
 * re-derive them.
 */
export const PLACEMENTS = [
  // ── Meta (ratios {4:5, 1:1, 1.91:1, 9:16}; min width 600; rec 1440-wide). ──
  { platform: "meta", id: "meta_feed_1x1", name: "Feed (square)", ratioLabel: "1:1", min: [600, 600], recommended: [1440, 1440] },
  { platform: "meta", id: "meta_feed_4x5", name: "Feed (portrait)", ratioLabel: "4:5", min: [600, 750], recommended: [1440, 1800] },
  { platform: "meta", id: "meta_reels_9x16", name: "Stories & Reels", ratioLabel: "9:16", min: [600, 1067], recommended: [1440, 2560] },
  { platform: "meta", id: "meta_right_191x1", name: "Right column / Search", ratioLabel: "1.91:1", min: [600, 314], recommended: [1200, 628] },

  // ── TikTok (ratios {9:16, 1:1, 16:9}; floors per orientation). ──
  { platform: "tiktok", id: "tiktok_infeed_9x16", name: "In-feed (vertical)", ratioLabel: "9:16", min: [540, 960], recommended: [720, 1280] },
  { platform: "tiktok", id: "tiktok_1x1", name: "Square", ratioLabel: "1:1", min: [640, 640], recommended: [640, 640] },
  { platform: "tiktok", id: "tiktok_16x9", name: "Landscape", ratioLabel: "16:9", min: [960, 540], recommended: [1280, 720] },

  // ── Snapchat (Top Snap: 9:16 exact, 1080×1920). ──
  { platform: "snapchat", id: "snap_top_9x16", name: "Top Snap", ratioLabel: "9:16", min: [1080, 1920], recommended: [1080, 1920] },

  // ── Google marketing image slots (GOOGLE_IMAGE_SLOTS). ──
  { platform: "google", id: "google_landscape_191x1", name: "Landscape", ratioLabel: "1.91:1", min: [600, 314], recommended: [1200, 628] },
  { platform: "google", id: "google_square_1x1", name: "Square", ratioLabel: "1:1", min: [300, 300], recommended: [1200, 1200] },
  { platform: "google", id: "google_portrait_4x5", name: "Portrait", ratioLabel: "4:5", min: [480, 600], recommended: [960, 1200] },

  // ── Reddit (image dims are [3P] — advisory; still shown per placement). ──
  { platform: "reddit", id: "reddit_1x1", name: "Feed (square)", ratioLabel: "1:1", min: null, recommended: [1080, 1080] },
  { platform: "reddit", id: "reddit_4x5", name: "Feed (portrait)", ratioLabel: "4:5", min: null, recommended: [1080, 1350] },
];

/** All placements for a platform. */
export function placementsForPlatform(platform) {
  return PLACEMENTS.filter((p) => p.platform === platform);
}

/**
 * Per-placement verdict for ONE placement against the probed master.
 *
 * status:
 *   "pass"    — the master natively fits this placement (ratio matches + min ok)
 *   "variant" — a pre-cropped variant slot covers this placement's ratio
 *   "crop"    — the master ratio differs; it must be cropped or given a variant
 *               (the preview shows the crop so the operator can eyeball it)
 *   "small"   — right ratio but below the placement's resolution floor
 * ok = pass | variant.
 */
export function placementVerdict(placement, probe, variantRatios = []) {
  const ratio = probe?.aspect_ratio ?? null;
  const width = probe?.width ?? null;
  const height = probe?.height ?? null;
  const platformName = PLATFORM_LABELS[placement.platform] ?? placement.platform;

  if (variantRatios.includes(placement.ratioLabel)) {
    return {
      ...placement,
      platformName,
      status: "variant",
      ok: true,
      reason: `A pre-cropped ${placement.ratioLabel} variant covers this placement.`,
    };
  }

  const matched = classifyRatio(ratio, [placement.ratioLabel], 0.03);
  if (matched === null) {
    return {
      ...placement,
      platformName,
      status: "crop",
      ok: false,
      reason: `Your creative is ${ratio ?? "an unknown"} shape — ${placement.name} needs ${placement.ratioLabel}. Crop it to ${placement.ratioLabel} or add a ${placement.ratioLabel} variant below.`,
    };
  }

  if (placement.min && width !== null && height !== null && (width < placement.min[0] || height < placement.min[1])) {
    return {
      ...placement,
      platformName,
      status: "small",
      ok: false,
      reason: `The shape is right, but ${width}×${height} is below ${platformName}'s ${placement.ratioLabel} floor of ${placement.min[0]}×${placement.min[1]}. Export it larger.`,
    };
  }

  return {
    ...placement,
    platformName,
    status: "pass",
    ok: true,
    reason: `Fits ${placement.name} (${placement.ratioLabel}) natively.`,
  };
}

/**
 * The per-placement report for the funded platforms.
 *
 * @param {object} input
 * @param {object|null} input.probe        the server byte-probe (validation.probe)
 * @param {string[]}    input.platforms    funded/eligible platform ids
 * @param {string[]}    [input.variantRatios] ratio labels with a pre-cropped variant
 * @returns {Array} placement verdicts (empty when there is no probe yet).
 */
export function perPlacementReport({ probe, platforms = [], variantRatios = [] }) {
  if (!probe) return [];
  const set = new Set(platforms);
  return PLACEMENTS
    .filter((p) => set.has(p.platform))
    .map((p) => placementVerdict(p, probe, variantRatios));
}

/**
 * Roll the per-placement verdicts into a per-platform pass/fail summary —
 * "passes Feed 1:1, fails Reels 9:16" made explicit: which placements pass and
 * which fail, per platform.
 */
export function placementSummaryByPlatform(report) {
  const byPlatform = new Map();
  for (const v of report) {
    if (!byPlatform.has(v.platform)) {
      byPlatform.set(v.platform, { platform: v.platform, platformName: v.platformName, passing: [], failing: [] });
    }
    const bucket = byPlatform.get(v.platform);
    (v.ok ? bucket.passing : bucket.failing).push(v);
  }
  return [...byPlatform.values()];
}
