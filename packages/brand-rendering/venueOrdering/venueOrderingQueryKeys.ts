// Issue #1793 — one query-key owner for the guest ordering entity family.
// Both native consumer and buyer web use these keys. In particular, modifier
// identity is the sorted set of menu-item ids, never merely the item count:
// two same-sized menus must not share cached modifier rows.

const root = ["venueOrdering"] as const;

export const venueOrderingQueryKeys = {
  all: root,
  state: (
    brandSlug: string,
    venueSlug: string,
    spotCode: string | null,
  ) => [...root, "state", brandSlug, venueSlug, spotCode] as const,
  modifiers: (venueSlug: string, menuItemIds: readonly string[]) =>
    [...root, "modifiers", venueSlug, [...menuItemIds].sort()] as const,
  preview: (priceSignature: string) =>
    [...root, "preview", priceSignature] as const,
};
