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


/**
 * #4624: the list row's usage line. A ticket cap (ends_after_count) counts
 * tickets ("2 of 5 tickets used"); otherwise checkouts ("12 of 50 used").
 * When both limits are set the row shows tickets (the bar follows the cap).
 */
export const discountUsageLabel = (
  consumed: number,
  limit: number,
  ticketCapped: boolean,
): string =>
  ticketCapped
    ? `${consumed} of ${limit} tickets used`
    : `${consumed} of ${limit} used`;
