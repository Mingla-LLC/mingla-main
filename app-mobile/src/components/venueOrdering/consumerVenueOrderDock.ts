/**
 * #4490 W3 fix 5 (W3-N37) — what the Explorer venue page docks at the Menu
 * tab's bottom edge for ordering. Pure, so the rule is testable without a
 * renderer.
 *
 * The order bar ("1 item · ₦7,000 · View order") is docked while the guest can
 * order, the basket has something in it and no order window is up. An empty
 * basket docks nothing (and, with ordering on, the venue's lead bar is not
 * drawn on the Menu tab either: `venueOrderingOwnsBottomEdge`). While the
 * review or a live order's status is open, that window is the order's surface
 * and covers the page, so nothing is docked under it. The words are buyer
 * web's (`venueOrderingBarCopy`), spot included.
 */
import { venueOrderingBarCopy } from "@mingla/brand-rendering/venueOrdering/VenueOrderingStickyBar";
import type { VenueOrderingView } from "@mingla/brand-rendering/venueOrdering/venueOrderingTypes";

export interface ConsumerVenueOrderDockInput {
  canOrder: boolean;
  view: VenueOrderingView;
  count: number;
  /** The SERVER's total for this basket, or null while it is unpriced. */
  totalCents: number | null;
  currency: string | null;
  /** The scanned spot's label when the order goes to that spot. */
  spotLabel: string | null;
}

export interface ConsumerVenueOrderDockBar {
  title: string;
  subtitle: string;
  ctaLabel: string;
}

export function consumerVenueOrderDock(
  input: ConsumerVenueOrderDockInput,
): ConsumerVenueOrderDockBar | null {
  if (!input.canOrder) return null;
  if (input.view !== "browse") return null;
  if (input.count <= 0) return null;
  const copy = venueOrderingBarCopy({
    count: input.count,
    totalCents: input.totalCents,
    currency: input.currency,
    spotLabel: input.spotLabel,
  });
  if (copy.ctaLabel === null) return null;
  return { title: copy.title, subtitle: copy.subtitle, ctaLabel: copy.ctaLabel };
}
