/**
 * #4490 — the deck place sheet's main button, decided by what the venue SELLS.
 *
 * Before: "Reserve a table" whenever the venue took reservations, otherwise
 * Directions. That is wrong for a venue that sells entry, groups, private hire,
 * by-the-hour rooms or plans: it either offered tables it does not have or hid
 * what it does sell.
 *
 * Now the button is the page's own lead (the SAME derivation the venue page's
 * booking bar uses: `deriveVenuePage` in `@mingla/brand-rendering`):
 *
 *   - a TABLE lead keeps opening the in-place `VenueReserveSheet`;
 *   - any other lead opens the venue page IN THE APP on the lead's tab
 *     (`?tab=`): #4490 Explorer W3 built the native tabs, so the in-app web
 *     browser path (`webUrl`, the buyer web origin) is deleted (rule 8);
 *   - no lead (the venue sells nothing the page can book) is Directions;
 *   - features not loaded / not a claimed venue / read failed is TODAY's
 *     button, unchanged: Reserve a table when `useVenueReservable` says so,
 *     else Directions. The card is never worse than before.
 *
 * Pure: no React, no i18n runtime. The sheet turns `labelKey` into words and
 * falls back to `fallbackLabel` for a language without the key yet.
 */
import {
  deriveVenuePage,
  type PublicVenueFeaturesView,
} from "@mingla/brand-rendering/venueFeaturePage";
import type { PublicVenueTab } from "@mingla/brand-rendering/publicVenueTabState";

export interface DeckReservableGate {
  readonly reservable: boolean;
  readonly brand_id: string | null;
  readonly venue_id: string | null;
}

/** Venue-page labels the deck can show, with their `cards:` i18n keys. */
export const DECK_CTA_LABEL_KEYS: Readonly<Record<string, string>> = {
  "Reserve a table": "sheet.reserve",
  "Book a table": "sheet.book_table",
  "Buy entry": "sheet.buy_entry",
  "Buy a day pass": "sheet.buy_day_pass",
  "Book a visit": "sheet.book_visit",
  "Book for a group": "sheet.book_group",
  "Ask about a date": "sheet.ask_date",
  "Book a date": "sheet.book_date",
  "Join": "sheet.join",
  "Book": "sheet.book",
  "Reserve this Stay": "sheet.reserve_stay",
};

export type DeckVenueCta =
  | {
      /** Opens the in-place reservation sheet (a table lead, or today's gate). */
      readonly kind: "reserve";
      readonly labelKey: string;
      readonly fallbackLabel: string;
    }
  | {
      /** Opens the venue page on the lead's tab, in the app. */
      readonly kind: "venue";
      readonly tab: PublicVenueTab;
      readonly path: string;
      readonly labelKey: string;
      readonly fallbackLabel: string;
    }
  | { readonly kind: "directions" };

const reservableNow = (gate: DeckReservableGate | null | undefined): boolean =>
  gate?.reservable === true && gate.brand_id !== null && gate.venue_id !== null;

export function deckVenueCta(input: {
  /** Null/undefined: not loaded, not a claimed venue, or the read failed. */
  readonly place:
    | {
        readonly brandSlug: string;
        readonly venueSlug: string;
        readonly features: PublicVenueFeaturesView;
      }
    | null
    | undefined;
  /** `useVenueReservable`'s row (the reserve sheet needs its ids). */
  readonly reservable: DeckReservableGate | null | undefined;
}): DeckVenueCta {
  const canReserve = reservableNow(input.reservable);
  const todays: DeckVenueCta = canReserve
    ? { kind: "reserve", labelKey: "sheet.reserve", fallbackLabel: "Reserve a table" }
    : { kind: "directions" };
  if (input.place === null || input.place === undefined) return todays;

  const page = deriveVenuePage(input.place.features, {
    // The deck never reads the menu: a lead is something to book.
    menuTabVisible: false,
    tablesGate: input.reservable === undefined ? "pending" : canReserve ? "ready" : "blocked",
  });
  const lead = page.lead;
  if (lead === null) return { kind: "directions" };
  // Stays keep their own flow: the card behaves exactly as it did.
  if (lead.kind === "stays") return todays;

  const labelKey = DECK_CTA_LABEL_KEYS[lead.ctaLabel];
  if (labelKey === undefined) return { kind: "directions" }; // never an unnamed button
  // A table lead opens the sheet, which needs the reservable ids.
  if (lead.kind === "tables") {
    return canReserve
      ? { kind: "reserve", labelKey, fallbackLabel: lead.ctaLabel }
      : { kind: "directions" };
  }
  const { brandSlug, venueSlug } = input.place;
  const path = `/b/${encodeURIComponent(brandSlug)}/v/${encodeURIComponent(venueSlug)}?tab=${encodeURIComponent(lead.tab)}`;
  return {
    kind: "venue",
    tab: lead.tab,
    path,
    labelKey,
    fallbackLabel: lead.ctaLabel,
  };
}
