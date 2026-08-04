/**
 * issue #1561 [first-screen-rebuild], step 5 of #1550 — the first screen's
 * DATA, separated from its pixels.
 *
 * WHY THIS FILE EXISTS AT ALL. The acceptance criterion for this step is a
 * MEASUREMENT, not a look: #1550 Leg C scored the live page against the four
 * questions a stranger asks before they scroll — *what is this place, where is
 * it, what does it cost, can I book it* — and it scored **0 of 4 at every
 * width, on every venue, on every surface**. A criterion phrased as a number
 * has to be checkable as a number, so everything the first screen ANSWERS is
 * resolved here, purely, from the same view model the renderer receives. The
 * renderer below (`PublicVenueScreen`) draws exactly what these functions
 * return and nothing else, so a test can score the page without a browser and
 * a browser can confirm the same score without a second source of truth.
 *
 * NO RUNTIME IMPORTS beyond the two pure formatters. No React, no
 * react-native, no platform surface — this module is data.
 *
 * WHAT IS DELIBERATELY NOT HERE — #1562 owns both, and implementing either
 * early would be building another step's work:
 *   - the Stay "from" rate (min of `offerings[].price.amountMinor`);
 *   - "open now" against the venue's own timezone.
 * The price cell is therefore a SLOT with a total resolver per pricing model:
 * `typicalSpend` resolves TODAY from `discoveryPrice` (already loaded, already
 * rendered by the price lede); `nightlyFrom` resolves to null until #1562
 * fills it in. See `VENUE_PRICE_CELL` below — that one function is #1562's
 * whole surface area on this bar.
 */
import {
  stayClockLabel,
  type VenueCategoryProfile,
  type VenuePricingModel,
  type VenueTimekeeping,
} from "./venueCategoryProfile";
import { formatSourceRange } from "./venueMoney";

// ═══════════════════════════════════════════════════════════════════════════
// The hero cap (#1550 R9 — the 768-1023 band nobody had looked at)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The tablet band's lower edge. Below it a device's viewport height is roughly
 * twice its width (390x844, 360x800), so one ratio serves every phone; at and
 * above it the viewport gets much wider without getting proportionally taller
 * (820x1180), and the SAME ratio would eat the screen.
 */
export const VENUE_HERO_TABLET_MIN_WIDTH = 768;

/**
 * Phone. `4/5` (the shell's default, which this page inherited by passing no
 * ratio at all) puts the hero at 1.25x the viewport width — 488pt on a 390pt
 * iPhone, i.e. **57.8%** of the 844pt first screen, measured on live production
 * by Leg C. `1.2` puts it at 325pt = **38.5%**, which is the design's 38%.
 */
export const VENUE_HERO_ASPECT_PHONE = 1.2;

/**
 * Tablet (768-1023). This band is served the PHONE layout at desktop width, so
 * at 820pt the 4/5 default rendered the hero 820 x 1025 on an 1180pt screen —
 * **86.9% of the entire first screen was one photograph**, with the address,
 * the tabs and the map all below the fold, on both venue categories. `2.28`
 * puts it at 360pt = **30.5%**, which is the design's number.
 */
export const VENUE_HERO_ASPECT_TABLET = 2.28;

/**
 * The phone/tablet cover ratio (width / height) for a given viewport width.
 * Desktop (web >= 1024) never reads this — `ParallaxCoverShell` renders a
 * CONTAINED 21/9 hero capped at 520px there, which is why 1440 and 2560 were
 * already the two least-broken widths in Leg C's table.
 */
export function venueHeroAspectRatio(width: number): number {
  return width >= VENUE_HERO_TABLET_MIN_WIDTH
    ? VENUE_HERO_ASPECT_TABLET
    : VENUE_HERO_ASPECT_PHONE;
}

/**
 * The hero's share of a viewport, as a fraction. This is the number Leg C
 * measured off the live DOM and the number the design commits to; expressing
 * it as a function is what lets the regression assert the budget rather than
 * assert a constant it also wrote.
 */
export function venueHeroScreenFraction(
  width: number,
  viewportHeight: number,
): number {
  if (viewportHeight <= 0) return 0;
  return width / venueHeroAspectRatio(width) / viewportHeight;
}

// ═══════════════════════════════════════════════════════════════════════════
// The answer bar
// ═══════════════════════════════════════════════════════════════════════════

/** The three questions the bar answers, in render order. */
export type VenueAnswerCellId = "price" | "time" | "booking";

/**
 * One cell. Three lines, exactly as the design draws them: a quiet label, the
 * value a stranger is actually looking for, and the qualifier that keeps the
 * value honest. `note` is nullable because not every cell has one; it is never
 * a footnote somewhere else on the page (#1550's from-rate decision: "it is not
 * possible to see one without the other").
 */
export interface VenueAnswerCell {
  readonly id: VenueAnswerCellId;
  readonly label: string;
  readonly value: string;
  readonly note: string | null;
}

/** Everything the answer bar needs, and nothing else. */
export interface VenueAnswerBarInput {
  profile: VenueCategoryProfile;
  discoveryPrice: {
    minMinor: number;
    maxMinor: number | null;
    currencyCode: string;
    minorUnitExponent: number;
  } | null;
  stay: { checkInTime: string; checkOutTime: string } | null;
  todayHours: { openTime: string | null; closeTime: string | null; isClosed: boolean } | null;
  /** The page's own fail-closed reserve gate. Never re-derived here. */
  canBook: boolean;
}

/**
 * THE PRICE SLOT. Total over `VenuePricingModel`, so a fifth pricing model does
 * not compile until it says how it prices — the same antidote the category
 * table itself is built on.
 *
 * `nightlyFrom` is [TRANSITIONAL] — it returns null until #1562 lands the Stay
 * from-rate. EXIT CONDITION: #1562 replaces that one arrow function with the
 * min over `stayDetail.offerings[].price`, and every surface gains the cell on
 * the same day. Returning null here is not a placeholder and not a fabrication:
 * the cell simply is not rendered, which is the design's own stated rule for
 * absent data ("it disappears silently; the answer bar shrinks from three cells
 * to two rather than showing a blank").
 */
const VENUE_PRICE_CELL: Record<
  VenuePricingModel,
  (input: VenueAnswerBarInput) => VenueAnswerCell | null
> = {
  typicalSpend: ({ discoveryPrice }) =>
    discoveryPrice === null
      ? null
      : {
          id: "price",
          label: "Typically",
          value: formatSourceRange({
            minMinor: discoveryPrice.minMinor,
            maxMinor: discoveryPrice.maxMinor,
            currencyCode: discoveryPrice.currencyCode,
            exponent: discoveryPrice.minorUnitExponent,
          }),
          note: "a head",
        },
  // [TRANSITIONAL] #1561 — the Stay from-rate is #1562's. Exit condition:
  // #1562 implements this arm from `stayDetail.offerings[].price`.
  nightlyFrom: () => null,
};

/**
 * THE TIME SLOT. Total over `VenueTimekeeping`.
 *
 * Both arms render data ALREADY on the page and already drawn further down it
 * (`VenueStayPolicySection` renders check-in/check-out; `VenueHoursSection`
 * renders the week). Neither arm makes an open-now CLAIM: "Today" states what
 * the venue's own row says for today's weekday, which is strictly weaker than
 * the "Open today" line #1550 Leg C found firing at 03:00 against the VISITOR's
 * device weekday. Turning that into a real open-now against the venue's
 * timezone is #1562.
 */
const VENUE_TIME_CELL: Record<
  VenueTimekeeping,
  (input: VenueAnswerBarInput) => VenueAnswerCell | null
> = {
  checkInOut: ({ stay }) =>
    stay === null
      ? null
      : {
          id: "time",
          label: "Check-in",
          value: stayClockLabel(stay.checkInTime),
          note: `check-out ${stayClockLabel(stay.checkOutTime)}`,
        },
  tradingHours: ({ todayHours }) => {
    if (todayHours === null) return null;
    if (todayHours.isClosed) {
      return { id: "time", label: "Today", value: "Closed", note: null };
    }
    if (todayHours.openTime === null || todayHours.closeTime === null) {
      return null;
    }
    return {
      id: "time",
      label: "Today",
      value: todayHours.openTime,
      note: `until ${todayHours.closeTime}`,
    };
  },
};

/**
 * THE BOOKING SLOT. This one is not a model lookup because it is not a category
 * property — it is the page's own reserve display gate, which already fails
 * closed on a not-reservable / errored / unknown venue. A venue that cannot be
 * booked through Mingla gets NO booking cell rather than a cell reading "no",
 * because the honest answer to "can I book it" at that point is delivered by
 * the absence of the button, not by a label.
 */
const venueBookingCell = (input: VenueAnswerBarInput): VenueAnswerCell | null =>
  input.canBook
    ? {
        id: "booking",
        label: "Booking",
        value: "Available",
        note: `through Mingla`,
      }
    : null;

/**
 * The bar, in render order, with every absent cell dropped. Length 0..3.
 */
export function buildVenueAnswerBar(
  input: VenueAnswerBarInput,
): VenueAnswerCell[] {
  const cells: (VenueAnswerCell | null)[] = [
    VENUE_PRICE_CELL[input.profile.pricing](input),
    VENUE_TIME_CELL[input.profile.timekeeping](input),
    venueBookingCell(input),
  ];
  return cells.filter((cell): cell is VenueAnswerCell => cell !== null);
}

// ═══════════════════════════════════════════════════════════════════════════
// The identity chips — "what is this place" and "where is it"
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The category chip. `profile.noun` is already the word a guest reads for this
 * kind of place ("hotel", "restaurant", "venue"); this is its display casing.
 *
 * #1550 Leg C: *"'What is this place' is 0/4 on both Stays. Nothing in the
 * first viewport of a hotel page says it is somewhere you sleep. The only
 * descriptor on the page is VERIFIED VENUE, which describes Mingla's process,
 * not the venue."* This chip takes that eyebrow's position, which is why the
 * eyebrow is deleted rather than moved.
 */
export function venueCategoryChip(profile: VenueCategoryProfile): string {
  const noun = profile.noun.trim();
  if (noun.length === 0) return "";
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}

/**
 * The place chip. City when the row has one; otherwise the address, which is
 * the only other human-readable location on the wire. Never coordinates — a
 * lat/lng pair is not an answer to "where is it" (Leg C found one venue whose
 * first-screen location read as an internal note).
 */
export function venuePlaceChip(venue: {
  city: string | null;
  address: string | null;
}): string | null {
  const city = venue.city !== null ? venue.city.trim() : "";
  if (city.length > 0) return city;
  const address = venue.address !== null ? venue.address.trim() : "";
  return address.length > 0 ? address : null;
}

/**
 * The public-page placeholder label for a venue with NO cover media — what
 * replaces the literal word `COVER` that #1550 Leg C photographed at full hero
 * size on a live public page (plate P12).
 */
export function venueCoverPlaceholderLabel(
  profile: VenueCategoryProfile,
  venue: { city: string | null; address: string | null },
): string {
  const chip = venueCategoryChip(profile);
  const place = venuePlaceChip(venue);
  return place === null ? chip : `${chip} · ${place}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// The measurement itself
// ═══════════════════════════════════════════════════════════════════════════

/** One question's answer on the first screen. */
export interface VenueFiveSecondAnswers {
  whatIsThisPlace: boolean;
  whereIsIt: boolean;
  whatDoesItCost: boolean;
  canIBookIt: boolean;
  /** 0..4. */
  score: number;
}

/**
 * The five-second test, scored from the SAME resolved values the first screen
 * renders. This is the model's own claim about itself and is NOT sufficient
 * proof on its own — the regression that consumes it scores the RENDERED TREE
 * and then asserts the two agree, so a divergence between what this says and
 * what the page draws is a failure rather than a silence.
 */
export function venueFiveSecondScore(input: {
  categoryChip: string;
  placeChip: string | null;
  cells: readonly VenueAnswerCell[];
  canBook: boolean;
}): VenueFiveSecondAnswers {
  const whatIsThisPlace = input.categoryChip.length > 0;
  const whereIsIt = input.placeChip !== null && input.placeChip.length > 0;
  const whatDoesItCost = input.cells.some((cell) => cell.id === "price");
  const canIBookIt = input.canBook;
  return {
    whatIsThisPlace,
    whereIsIt,
    whatDoesItCost,
    canIBookIt,
    score:
      (whatIsThisPlace ? 1 : 0) +
      (whereIsIt ? 1 : 0) +
      (whatDoesItCost ? 1 : 0) +
      (canIBookIt ? 1 : 0),
  };
}
