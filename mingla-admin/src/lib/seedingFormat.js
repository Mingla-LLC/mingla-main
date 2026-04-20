// ORCH-0553 — Shared seeding/refresh format utilities.
// Extracted from PlacePoolManagementPage.jsx so that both SeedTab and RefreshTab
// (and other consumers like PhotoTab/StatsTab/SeedingTab wrapper) can import
// from a single source. Constitutional #2 (one owner per truth).

export const HARD_CAP_USD = 500;

export function formatCost(n) {
  return `$${(n || 0).toFixed(2)}`;
}

// Tile radius options for SeedTab (also used by future re-tiling flows).
// Spec source: PlacePoolManagementPage.jsx prior to ORCH-0553 extraction.
export const TILE_RADIUS_OPTIONS = [
  { value: "1500", label: "1500m", desc: "Fine" },
  { value: "2000", label: "2000m", desc: "Standard" },
  { value: "2500", label: "2500m", desc: "Coarse" },
];
