/**
 * Pure-JS readiness badge content helpers — ORCH-1015 Finding A
 *
 * Extracted from BoundaryReadinessBadge.jsx + DetailsReadinessBadge.jsx so the
 * text + state contracts can be unit-tested with plain `node --test` (no JSDOM,
 * no JSX loader, no new deps — same hard guard as ORCH-1014's
 * seedRefreshBadgeContent.js it replaces).
 *
 * Contracts mirror SPEC §3 A.1 + A.2 verbatim.
 */

/**
 * @typedef {Object} BoundaryStatusContent
 * @property {"current"|"needs-reseed"} state
 * @property {string} label    // "✓ current" or "⚠ reseed"
 * @property {string} bgVar    // CSS var token for pill background
 * @property {string} fgVar    // CSS var token for pill text
 * @property {string} tooltip
 */

/**
 * @param {Object} args
 * @param {boolean} args.regeocoded - true ⇔ seeding_cities.coverage_radius_km = 0
 * @returns {BoundaryStatusContent}
 */
export function boundaryStatus({ regeocoded }) {
  if (regeocoded) {
    return {
      state: "current",
      label: "✓ current",
      bgVar: "var(--color-success-50)",
      fgVar: "var(--color-success-700)",
      tooltip:
        "Re-seeded under the bbox model (coverage_radius_km = 0). Ready for evaluation.",
    };
  }
  return {
    state: "needs-reseed",
    label: "⚠ reseed",
    bgVar: "var(--color-warning-50)",
    fgVar: "var(--color-warning-700)",
    tooltip:
      "Still on the deprecated radius model. Re-seed in Place Pool before evaluating.",
  };
}

/**
 * @typedef {Object} DetailsStatusContent
 * @property {"current"|"needs-refresh"} state
 * @property {string} label    // "✓ current" or "⚠ N places need refresh"
 * @property {string} bgVar
 * @property {string} fgVar
 * @property {string} tooltip
 */

/**
 * @param {Object} args
 * @param {boolean} args.refreshed - true ⇔ MIN(last_detail_refresh for servable) >= 2026-03-19
 * @param {number}  args.needs_refresh_count - count of servable rows below cutover (rendered when !refreshed)
 * @returns {DetailsStatusContent}
 */
export function detailsStatus({ refreshed, needs_refresh_count = 0 }) {
  if (refreshed) {
    return {
      state: "current",
      label: "✓ current",
      bgVar: "var(--color-success-50)",
      fgVar: "var(--color-success-700)",
      tooltip:
        "All servable places refreshed under the 48-field mask (post 2026-03-19).",
    };
  }
  const n = Number(needs_refresh_count) || 0;
  return {
    state: "needs-refresh",
    label: `⚠ ${n.toLocaleString()} places need refresh`,
    bgVar: "var(--color-warning-50)",
    fgVar: "var(--color-warning-700)",
    tooltip: `${n} servable places haven't been refreshed since 2026-03-19 when the 48-field DETAIL_FIELD_MASK shipped. Refresh in Place Pool.`,
  };
}
