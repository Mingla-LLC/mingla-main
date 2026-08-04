/**
 * Issue #1558 [venue-category-profiles] — a venue type is DATA, not a branch.
 * Step 2 of #1550 (one intelligent venue page that adapts to the venue type).
 *
 * THE DEFECT THIS REPLACES. The public venue page asked one boolean question —
 * `venue.venueCategory === "stay"` — in eight places on the buyer web page and
 * again on the consumer screen, and never asked it in the ninth. So a hotel
 * published `Mon–Sat 09:00–17:00` on the same page whose booking tab said
 * check-in is 15:00, and a gallery or a climbing gym was invited to "Reserve a
 * table". Two categories out of four (`play`, `creative_and_arts`) rendered
 * byte-identically to a restaurant, and a NULL category fell silently into the
 * restaurant arm.
 *
 * THE SHAPE OF THE FIX IS THE POINT, not the strings. Everything a venue
 * category IS lives here as pure data:
 *
 *   - `noun`         the word a guest reads for this kind of place
 *   - `pricing`      how it prices
 *   - `timekeeping`  how it keeps time — trading hours vs check-in/check-out
 *   - `reserveAction` the button wording (ONE string per category: CTA, sheet
 *                    heading and accessibility label all read it)
 *   - `overview`     an ORDERED list of section ids that IS the layout
 *
 * `VENUE_CATEGORY_PROFILES` is `Record<VenueCategoryKey, VenueCategoryProfile>`
 * — TOTAL, with no `default:` arm and an EXPLICIT `uncategorised` arm for
 * `venueCategory === null`. Adding a fifth category to the union is a COMPILE
 * ERROR until someone writes its profile. That is the direct antidote to the
 * fall-through still shipping on the operator side (`VenueDeckReadinessSetup`:
 * `return [...FACET_CORE, ...FACET_RESTAURANT]; // restaurant / default`).
 *
 * NO RUNTIME IMPORTS. The only import is `import type`, which the compiler
 * erases — so this module is pure data that can be pulled into any chunk on
 * any surface at effectively zero eager cost (ORCH-1083 bundle budget, ~2,372 B
 * of `__common` headroom per #1509).
 *
 * NOT IN SCOPE HERE (deliberately deferred, see the issue):
 *   - the visual redesign → #1561
 *   - lifting the section RENDERERS into this package → #1559
 *   - locale-aware hours / open-now / the Stay "from" rate → #1562
 *   - per-venue colours → #1564
 */
import type { PublicVenueTab } from "./publicVenueTabState";

/**
 * The four categories a venue row can carry.
 * Authoritative source: `venue_listings.venue_category`
 * (`supabase/migrations/20270131013807_issue_1387_stay_inventory_schema.sql`).
 * ONE owner — `mingla-business/src/types/brand.ts` re-exports this.
 */
export type VenueCategory =
  | "restaurant"
  | "play"
  | "creative_and_arts"
  | "stay";

/**
 * The profile key space. `uncategorised` is the NAMED arm for a venue whose
 * `venue_category` is NULL — the case that used to be silently treated as a
 * restaurant. It is a profile, not a fallback.
 */
export type VenueCategoryKey = VenueCategory | "uncategorised";

/**
 * One block of the Overview pane. The registry that resolves these to renderers
 * is `Record<VenueSectionId, React.FC<VenueSectionProps>>` and is likewise
 * total — there is no lookup that can miss.
 *
 * The list is deliberately limited to sections that HAVE a renderer today.
 * `amenities` and `contact` are named in the #1550 SPEC but have no renderer
 * and no data plumbing yet; adding the id before the renderer would create a
 * dead entry that the vacuity guards in the tests exist to catch.
 */
export type VenueSectionId =
  | "priceLede"
  | "about"
  | "location"
  | "hours"
  | "stayPolicy"
  | "gallery";

/** How a category expresses what it costs. */
export type VenuePricingModel = "typicalSpend" | "nightlyFrom";

/** How a category expresses when it is open / when you arrive. */
export type VenueTimekeeping = "tradingHours" | "checkInOut";

/**
 * Which booking body the Reservations tab mounts. This is a PAYMENT-RAIL fork
 * (Stripe.js Payment Element on web, native PaymentSheet on device), so the
 * component itself stays app-side; the profile only names which one.
 */
export type VenueBookingBody = "table" | "stay";

export interface VenueCategoryProfile {
  /** The profile's own key — lets a resolved profile be logged/asserted. */
  readonly key: VenueCategoryKey;
  /** The word a guest reads for this kind of place. */
  readonly noun: string;
  /** How this kind of place prices. */
  readonly pricing: VenuePricingModel;
  /** How this kind of place keeps time. */
  readonly timekeeping: VenueTimekeeping;
  /** ONE string — the CTA, the sheet heading and the accessibility label. */
  readonly reserveAction: string;
  /** Which booking body the Reservations tab mounts. */
  readonly bookingBody: VenueBookingBody;
  /** The tabs this category can show (menu is further gated on real items). */
  readonly tabs: readonly PublicVenueTab[];
  /** THE ARRAY IS THE LAYOUT ORDER. Editing it is how the layout changes. */
  readonly overview: readonly VenueSectionId[];
}

/**
 * Totality witness for `VenueSectionId`. Typed as a total Record, so adding a
 * section id without listing it here is a compile error — which is what makes
 * `VENUE_SECTION_IDS` below trustworthy enough to test against.
 */
const SECTION_ID_PRESENCE: Record<VenueSectionId, true> = {
  priceLede: true,
  about: true,
  location: true,
  hours: true,
  stayPolicy: true,
  gallery: true,
};

/** Every section id, derived from the total witness above (never hand-listed). */
export const VENUE_SECTION_IDS: readonly VenueSectionId[] = Object.keys(
  SECTION_ID_PRESENCE,
) as VenueSectionId[];

/**
 * Everything the three non-stay categories share TODAY. They differ only in the
 * words a guest reads, so the shared shape is expressed once and spread — a
 * category that later needs its own order overrides the key, it does not need
 * new code.
 */
const NON_STAY_SHAPE = {
  pricing: "typicalSpend",
  timekeeping: "tradingHours",
  bookingBody: "table",
  tabs: ["overview", "menu", "reservations"],
  overview: ["priceLede", "about", "location", "hours", "gallery"],
} as const;

/**
 * THE TABLE. Total over `VenueCategoryKey`, no `default:` arm, explicit
 * `uncategorised`. A fifth category does not compile until it appears here.
 */
export const VENUE_CATEGORY_PROFILES: Record<
  VenueCategoryKey,
  VenueCategoryProfile
> = {
  restaurant: {
    key: "restaurant",
    noun: "restaurant",
    reserveAction: "Reserve a table",
    ...NON_STAY_SHAPE,
  },
  play: {
    key: "play",
    noun: "venue",
    // A climbing gym, a bowling alley and a pool hall do not have tables to
    // reserve. They have visits to book.
    reserveAction: "Book a visit",
    ...NON_STAY_SHAPE,
  },
  creative_and_arts: {
    key: "creative_and_arts",
    noun: "venue",
    reserveAction: "Book a visit",
    ...NON_STAY_SHAPE,
  },
  stay: {
    key: "stay",
    noun: "hotel",
    pricing: "nightlyFrom",
    // `brand_hours` is NEVER read for a Stay. A hotel does not have trading
    // hours; it has a check-in time and a check-out time, and publishing
    // "09:00–17:00" next to "Check-in 15:00" is the contradiction #1550 Leg C
    // measured on a live Miami property.
    timekeeping: "checkInOut",
    reserveAction: "Reserve this Stay",
    bookingBody: "stay",
    // No Menu tab. #1536 owns whether that should change — after this, it is
    // ONE array element in ONE file rather than a hardcoded boolean in two
    // forks.
    tabs: ["overview", "reservations"],
    overview: ["priceLede", "about", "location", "stayPolicy", "gallery"],
  },
  /**
   * `venue_category IS NULL`. It gets a NAME rather than falling into the
   * restaurant arm: we do not know this is a restaurant, so we do not tell a
   * guest to reserve a table at it. Everything else matches the non-stay shape,
   * which is what shipped before — the change is that it is now a decision.
   */
  uncategorised: {
    key: "uncategorised",
    noun: "venue",
    reserveAction: "Book a visit",
    ...NON_STAY_SHAPE,
  },
};

/** NULL is a category key, not a missing one. */
export function venueCategoryKey(
  category: VenueCategory | null,
): VenueCategoryKey {
  return category ?? "uncategorised";
}

/** The one resolver every surface calls. Total by construction — never null. */
export function venueCategoryProfile(
  category: VenueCategory | null,
): VenueCategoryProfile {
  return VENUE_CATEGORY_PROFILES[venueCategoryKey(category)];
}

/**
 * The Menu tab gate, in ONE place for all five surfaces.
 * Was `!isStay && menuItemCount > 0`, hardcoded twice
 * (`PublicVenuePage.tsx:180` + `ConsumerPublicVenueScreen.tsx:314`).
 * #1536 flips this by editing `tabs` in the table above — not by editing code.
 */
export function venueMenuTabVisible(
  profile: VenueCategoryProfile,
  menuItemCount: number,
): boolean {
  return profile.tabs.includes("menu") && menuItemCount > 0;
}

/**
 * The typical-spend lede gate. Was `!isStay && discoveryPrice !== null`.
 * A Stay prices per night, not in a spend band; its "from" rate is #1562, so
 * until then the Stay lede has a MODEL but no data and renders nothing —
 * honestly empty rather than wrong.
 */
export function typicalSpendVisible(
  profile: VenueCategoryProfile,
  hasRange: boolean,
): boolean {
  return profile.pricing === "typicalSpend" && hasRange;
}

/**
 * Whether this category publishes trading hours at all. Gates the desktop
 * sticky panel's "Open today · …" line, which had NO category guard and is the
 * second place a hotel advertised a closing time.
 */
export function venueShowsTradingHours(profile: VenueCategoryProfile): boolean {
  return profile.timekeeping === "tradingHours";
}

/**
 * The honest empty-reservations line, in the guest's words for this kind of
 * place: "This restaurant isn't taking reservations right now."
 */
export function venueNotTakingReservationsCopy(
  profile: VenueCategoryProfile,
): string {
  return `This ${profile.noun} isn’t taking reservations right now.`;
}

/**
 * Trim a stay clock (`"15:00:00"` / `"15:00"`) to `HH:MM` for display.
 * Locale-aware formatting ("3:00 PM" in the US, "15:00" in the UK) is #1562;
 * this preserves exactly what the surrounding surfaces render today.
 * A value that is not a clock is returned trimmed, never faked.
 */
export function stayClockLabel(value: string): string {
  const trimmed = value.trim();
  const match = /^(\d{1,2}):(\d{2})/.exec(trimmed);
  if (match === null) return trimmed;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}
