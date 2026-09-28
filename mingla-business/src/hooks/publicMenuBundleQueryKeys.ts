/**
 * Lean public-menu-bundle cache identities.
 *
 * Kept separate from the data hook so authenticated authoring mutations can
 * invalidate the buyer-web bundle without importing its fetch/runtime graph.
 */
export const publicMenuBundleKeys = {
  all: ["publicMenuBundle"] as const,
  detail: (brandSlug: string, venueSlug: string) =>
    ["publicMenuBundle", brandSlug, venueSlug] as const,
};
