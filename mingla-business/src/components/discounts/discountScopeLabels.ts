import type { DiscountScopeKind } from "../../services/discountService";

export const DISCOUNT_SCOPE_OPTIONS: readonly {
  value: DiscountScopeKind;
  label: string;
  description: string;
}[] = Object.freeze([
  {
    value: "brand",
    label: "Entire brand",
    description: "All eligible paid items",
  },
  {
    value: "listing_kinds",
    label: "Offering types",
    description: "Events, trips, venues and more",
  },
  // #4624: whole events, experiences or trips; tickets added later included.
  {
    value: "listings",
    label: "Specific offerings",
    description: "Whole events, experiences or trips",
  },
  {
    value: "items",
    label: "Specific items",
    description: "Individual tickets, menu items or deposits",
  },
]);

/** #4624: plain-words scope label per scope kind (list rows, a11y). */
export const DISCOUNT_SCOPE_LABELS: Readonly<Record<DiscountScopeKind, string>> =
  Object.freeze(
    Object.fromEntries(
      DISCOUNT_SCOPE_OPTIONS.map(({ value, label }) => [value, label]),
    ) as Record<DiscountScopeKind, string>,
  );

