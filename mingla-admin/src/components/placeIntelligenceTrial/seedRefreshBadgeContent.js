/**
 * Pure-JS badge content helpers — ORCH-1014 Finding B
 *
 * Extracted from SeedStatusBadge.jsx + RefreshStatusBadge.jsx so the text +
 * state contracts can be unit-tested with plain `node --test` (no JSDOM,
 * no JSX loader, no new deps per ORCH-1014 hard guard). The JSX wrappers
 * are thin renderers around these descriptors.
 *
 * Contracts mirror SPEC §3 B.3 verbatim.
 */

import { timeAgo } from "../../lib/formatters.js";

/**
 * @typedef {Object} SeedStatusContent
 * @property {"never-seeded"|"single-pass"|"ranged"} state
 * @property {string} primaryText      // e.g. "Never seeded", "Seeded 5d ago"
 * @property {string} primaryColorVar  // CSS var token for primary text color
 * @property {string|null} subText     // e.g. "First: 60d ago"; null when none
 * @property {string|null} primaryTitle // tooltip / ISO date; null for never-seeded
 * @property {string|null} subTitle     // tooltip / ISO date for the First: sub-line
 */

/**
 * Compute the visual content for SeedStatusBadge.
 *
 * @param {Object} args
 * @param {string|null} args.firstSeededAt - ISO; MIN(place_pool.created_at) for city
 * @param {string|null} args.lastSeededAt  - ISO; MAX(place_pool.created_at) for city
 * @returns {SeedStatusContent}
 */
export function getSeedStatusContent({ firstSeededAt, lastSeededAt }) {
  if (!lastSeededAt) {
    return {
      state: "never-seeded",
      primaryText: "Never seeded",
      primaryColorVar: "var(--color-warning-700)",
      subText: null,
      primaryTitle: null,
      subTitle: null,
    };
  }

  const showFirst = firstSeededAt && firstSeededAt !== lastSeededAt;
  return {
    state: showFirst ? "ranged" : "single-pass",
    primaryText: `Seeded ${timeAgo(lastSeededAt)}`,
    primaryColorVar: "var(--color-text-primary)",
    subText: showFirst ? `First: ${timeAgo(firstSeededAt)}` : null,
    primaryTitle: new Date(lastSeededAt).toISOString(),
    subTitle: showFirst ? new Date(firstSeededAt).toISOString() : null,
  };
}

/**
 * @typedef {Object} RefreshStatusContent
 * @property {"all-current"|"missing-only"|"missing-and-stale"} state
 * @property {string} primaryText      // e.g. "✓ all current", "1,706 places missing fields"
 * @property {string} primaryColorVar  // CSS var token
 * @property {string|null} subText     // e.g. "(12 stale)"; null when none
 * @property {string} tooltip          // hover tooltip on primary line
 */

const REFRESH_TOOLTIP =
  "Missing one of: generative_summary, editorial_summary, reviews (with ≥1 review). " +
  "Stale = last refreshed > 90 days ago. Refresh in Place Pool.";

/**
 * Compute the visual content for RefreshStatusBadge.
 *
 * @param {Object} args
 * @param {number} args.missingFieldsCount  - count of servable places missing summaries/reviews
 * @param {number} args.staleRefreshCount   - count of servable places with last_detail_refresh > 90d
 * @returns {RefreshStatusContent}
 */
export function getRefreshStatusContent({
  missingFieldsCount = 0,
  staleRefreshCount = 0,
}) {
  if (missingFieldsCount === 0) {
    return {
      state: "all-current",
      primaryText: "✓ all current",
      primaryColorVar: "var(--color-success-700)",
      subText: null,
      tooltip: REFRESH_TOOLTIP,
    };
  }
  return {
    state: staleRefreshCount > 0 ? "missing-and-stale" : "missing-only",
    primaryText: `${missingFieldsCount.toLocaleString()} places missing fields`,
    primaryColorVar: "var(--color-warning-700)",
    subText: `(${staleRefreshCount.toLocaleString()} stale)`,
    tooltip: REFRESH_TOOLTIP,
  };
}
