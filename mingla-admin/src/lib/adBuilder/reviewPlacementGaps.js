/**
 * Issue #3697 — "Won't show in …" on the Builder review step (pure).
 *
 * Placement gaps come only from the per-placement report against the server
 * byte-probe (placements.js). That report models image placements; a video is
 * judged by the provider at create time, so video gaps are omitted rather
 * than guessed.
 */

import { perPlacementReport } from "./placements.js";

/**
 * @param {{ kind: string|null, probe: object|null, platforms: string[],
 *   variants?: Record<string, { source_url?: string }> }} input
 * @returns {Array<{ platform: string, placement: string, need: string }>}
 */
export function reviewPlacementGaps({
  kind = null,
  probe = null,
  platforms = [],
  variants = {},
} = {}) {
  if (kind !== "image" || !probe) return [];
  const variantRatios = Object.entries(variants ?? {})
    .filter(([, value]) => value && value.source_url)
    .map(([ratio]) => ratio);
  return perPlacementReport({ probe, platforms, variantRatios })
    .filter((verdict) => !verdict.ok)
    .map((verdict) => ({
      platform: verdict.platform,
      placement: `${verdict.platformName} ${verdict.name}`,
      need:
        verdict.status === "small" && Array.isArray(verdict.min)
          ? `needs at least ${verdict.min[0]}×${verdict.min[1]}`
          : `needs a ${verdict.ratioLabel} version`,
    }));
}

/** "Won't show in 2 places: Meta Feed (square) (needs a 1:1 version), …" */
export function placementGapsLine(gaps) {
  if (!Array.isArray(gaps) || gaps.length === 0) return null;
  const list = gaps.map((gap) => `${gap.placement} (${gap.need})`).join(", ");
  return `Won't show in ${gaps.length} place${gaps.length === 1 ? "" : "s"}: ${list}.`;
}
