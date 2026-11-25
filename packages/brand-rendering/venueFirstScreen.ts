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
 * NO RUNTIME IMPORTS beyond the pure resolvers and formatters. No React, no
 * react-native, no platform surface — this module is data.
 *
 * #1562 CLOSED BOTH SLOTS THIS FILE LEFT OPEN. It shipped with two named gaps,
 * each a total `Record<…>` arm rather than a branch, so that filling them in
 * was an edit to one arrow function rather than a hunt through a renderer:
 *   - the Stay "from" rate — `VENUE_PRICE_CELL.nightlyFrom`, which returned
 *     null behind a `[TRANSITIONAL]` marker. It now resolves through
 *     `resolveVenueStayRate` over the offerings already on the wire, and the
 *     quoted total replaces it in the SAME slot the moment dates are chosen.
 *   - "open now" against the venue's own timezone — `VENUE_TIME_CELL.
 *     tradingHours`, which stated only what the venue's row said for today and
 *     made no claim. It now reads a `VenueOpenState` resolved in the venue's
 *     zone, and falls back to exactly the old behaviour when that zone is
 *     unusable, so an unknown timezone can never manufacture a claim.
 * Both arms are still arms: a fifth pricing model or a third timekeeping model
 * does not compile until it says how it prices and how it keeps time.
 */
import type { PublicVenueTab } from "./publicVenueTabState";
import {
  stayClockLabel,
  type VenueCategoryProfile,
  type VenuePricingModel,
  type VenueTimekeeping,
} from "./venueCategoryProfile";
import { formatSourceRange } from "./venueMoney";
import {
  VENUE_WEEKDAY_LABELS,
  type VenueOpenState,
} from "./venueOpenState";
import {
  venueStayQuoteValue,
  venueStayRateQualifier,
  venueStayRateValue,
  type VenueStayQuoteView,
  type VenueStayRate,
} from "./venueStayRate";

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
  /**
   * #1562 — the venue's OWN clock, resolved in its OWN zone by
   * `resolveVenueOpenState`. Null (or `status: "unknown"`) means no open-now
   * claim can be made, and the time cell falls back to stating the published
   * row. The screen resolves this once and hands the SAME object to the bar
   * and to the desktop sticky panel, so the two cannot disagree.
   */
  openState: VenueOpenState | null;
  /** #1562 — the Stay nightly from-rate, resolved from the loaded offerings. */
  stayRate: VenueStayRate | null;
  /**
   * #1562 — the guest's REAL quoted total, once dates are chosen. When present
   * it replaces the from-rate in this same cell rather than appearing anywhere
   * else on the page.
   */
  stayQuote: VenueStayQuoteView | null;
  /** The page's own fail-closed reserve gate. Never re-derived here. */
  canBook: boolean;
}

/**
 * THE PRICE SLOT. Total over `VenuePricingModel`, so a fifth pricing model does
 * not compile until it says how it prices — the same antidote the category
 * table itself is built on.
 *
 * #1562 CLOSED THE `nightlyFrom` ARM. It is no longer `[TRANSITIONAL]`.
 *
 * THE TENSION THIS ARM CARRIES, AND THE THREE THINGS THAT HOLD IT. Mingla
 * prices all-in; a from-rate is not all-in. #1550 approved showing one anyway,
 * on three conditions, and all three live in this one function rather than
 * being scattered where any of them could be dropped independently:
 *
 *   1. THE QUALIFIER IS IN THE SAME BLOCK AS THE NUMBER. `note` is a line of
 *      the SAME cell as `value` — one `<View>`, one accessibility label built
 *      from both. There is no arrangement of this page on any surface at any
 *      width in which a guest reads "$275" without reading "before taxes and
 *      fees", because the two are not separable elements.
 *   2. THE HONEST NUMBER TAKES OVER. `stayQuote` is checked FIRST. The instant
 *      the guest picks dates and the server quotes a real total, that total
 *      occupies this slot — same cell, same `answerValue` style, same size —
 *      and the from-rate is gone. The guest is not shown a small number here
 *      and a bigger one at checkout; the number in front of them becomes the
 *      true one as soon as it can be known.
 *   3. THE QUALIFIER READS ITSELF FROM THE DATA. `venueStayRateQualifier` is
 *      driven by `rate.allIn`, which `resolveVenueStayRate` computes from
 *      `fees[].displayMode` on the rows themselves. A hotel that has marked
 *      its fees included gets "all-in, taxes and fees included" without anyone
 *      editing this file.
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
            // W3 fix 4 (W3-N31): ₦ like the rest of the page, no stray code.
            display: "venue",
          }),
          note: "a head",
        },
  nightlyFrom: ({ stayRate, stayQuote }) => {
    // (2) The quoted total wins the slot the moment it exists.
    const quoted = venueStayQuoteValue(stayQuote);
    if (quoted !== null) {
      return {
        id: "price",
        label: "Your dates",
        value: quoted,
        note: "total · taxes and fees included",
      };
    }
    if (stayRate === null) return null;
    const value = venueStayRateValue(stayRate);
    // `formatStayRate` fails loud rather than inventing a number; a cell
    // reading "Price unavailable" in the largest type on the first screen is
    // worse than no cell, and the design's rule for absent data is that the
    // bar shrinks rather than showing a blank.
    if (value === "Price unavailable") return null;
    return {
      id: "price",
      label: "From",
      value,
      // (1) + (3): the qualifier is this cell's own third line, and it is read
      // from `fees[].displayMode` rather than hardcoded.
      note: venueStayRateQualifier(stayRate),
    };
  },
};

/**
 * THE TIME SLOT. Total over `VenueTimekeeping`.
 *
 * `checkInOut` is what a HOTEL has instead of trading hours (#1558's category
 * profile). A hotel does not open and close; its front desk is the whole point.
 * Publishing "09:00–17:00" beside its own "Check-in 15:00" was the self-
 * contradiction #1550 Leg C photographed on a live Miami property, and the
 * profile table is what makes that unrepresentable rather than merely fixed.
 *
 * `tradingHours` is where #1562's open-now lands, and it is layered so the
 * claim is never stronger than the evidence:
 *
 *   openState.status = "open"       → "Right now · Open · until 22:30"
 *                    = "opensLater" → "Right now · Closed · opens 18:00"
 *                                     (or "opens Tue 09:00" on another day)
 *                    = "closed"     → "Right now · Closed"
 *                    = "unknown"    → EXACTLY #1561's behaviour: state the
 *                                     published row for today and claim
 *                                     nothing. This is the arm a venue with no
 *                                     usable timezone lands in, and it is the
 *                                     reason exposing the timezone can only
 *                                     ever ADD certainty to this page.
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
  tradingHours: ({ openState, todayHours }) => {
    if (openState !== null && openState.status === "open") {
      return {
        id: "time",
        label: "Right now",
        value: "Open",
        note:
          openState.closesAt === null ? null : `until ${openState.closesAt}`,
      };
    }
    if (openState !== null && openState.status === "opensLater") {
      const day =
        openState.opensWeekday === null
          ? ""
          : `${VENUE_WEEKDAY_LABELS[openState.opensWeekday] ?? ""} `;
      return {
        id: "time",
        label: "Right now",
        value: "Closed",
        note: openState.opensAt === null ? null : `opens ${day}${openState.opensAt}`,
      };
    }
    if (openState !== null && openState.status === "closed") {
      return { id: "time", label: "Right now", value: "Closed", note: null };
    }
    // UNKNOWN — no timezone, an unusable one, or no published hours. Claim
    // nothing beyond what the venue itself stated for today.
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
// The fact rows (#4420 D-V1) — the same answers, read as a list
// ═══════════════════════════════════════════════════════════════════════════

/**
 * What a fact row's one action does. The screen owns the handlers. `lead` is
 * #4490's: the lead row's button opens the tab the venue's features chose.
 */
export type VenueFactAction = "hours" | "map" | "reserve" | "lead";

/** One fact row, as data. `icon` names an `OfferingFactIcon`. */
export interface VenueFactView {
  readonly key: "time" | "where" | "price" | "booking";
  readonly icon: "clock" | "pin" | "price" | "calendar";
  readonly value: string;
  readonly detail: string | null;
  readonly action: VenueFactAction | null;
  /** #4490 — the lead row's button label and the tab it opens. */
  readonly actionLabel?: string;
  readonly actionTab?: PublicVenueTab;
}

export interface VenueFactsInput {
  /** `buildVenueAnswerBar`'s cells: the facts restate them, never re-derive. */
  cells: readonly VenueAnswerCell[];
  profile: Pick<VenueCategoryProfile, "timekeeping" | "bookingBody">;
  /** The street line and the rest of the address (district, city). */
  place: { street: string | null; area: string | null };
  /** "Thursday 12:00 – 23:00": today's published row, for the open fact. */
  todayHoursLine: string | null;
  /** The page has an hours card to scroll to. */
  hasHoursCard: boolean;
  /** The page can open a maps chooser. */
  hasMap: boolean;
  /** Stays: how many room types are on sale (null = unknown). */
  roomTypeCount: number | null;
  /**
   * #4490 — the page's lead (the one thing its features sell). `undefined` =
   * today's behaviour (the category decides the booking row). `null` = the
   * venue's features sell nothing the page can book: no booking row. An object
   * replaces the booking row; `keepPriceRow: false` also drops the "Typically"
   * spend row, because the lead row carries the price.
   */
  featureLead?: {
    row: {
      value: string;
      detail: string | null;
      actionLabel: string;
      icon: "calendar" | "price";
    } | null;
    tab: PublicVenueTab;
    keepPriceRow: boolean;
  } | null;
}

const capitalise = (s: string): string =>
  s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);

/** The nightly half of the Stay qualifier (`venueStayRateQualifier`). */
const PER_NIGHT_PREFIX = "per night · ";

/** The check-out half of the Stay time cell's note (`check-out 11:00`). */
const CHECK_OUT_NOTE_PREFIX = "check-out ";

const timeFact = (
  cell: VenueAnswerCell,
  input: VenueFactsInput,
): VenueFactView => {
  if (input.profile.timekeeping === "checkInOut") {
    const checkOut =
      cell.note !== null && cell.note.startsWith(CHECK_OUT_NOTE_PREFIX)
        ? cell.note.slice(CHECK_OUT_NOTE_PREFIX.length)
        : null;
    return {
      key: "time",
      icon: "clock",
      value: `Check-in from ${cell.value}`,
      detail: checkOut === null ? null : `Check-out by ${checkOut}`,
      action: null,
    };
  }
  const action: VenueFactAction | null = input.hasHoursCard ? "hours" : null;
  if (cell.label === "Right now" && cell.value === "Open") {
    return {
      key: "time",
      icon: "clock",
      value: cell.note === null ? "Open" : `Open · ${cell.note}`,
      detail: input.todayHoursLine,
      action,
    };
  }
  if (cell.value === "Closed") {
    return {
      key: "time",
      icon: "clock",
      value: cell.label === "Today" ? "Closed today" : "Closed now",
      detail: cell.note === null ? null : capitalise(cell.note),
      action,
    };
  }
  // "Today" — the published row, with no open-now claim (unknown zone).
  return {
    key: "time",
    icon: "clock",
    value: `Today · ${cell.value}`,
    detail: cell.note,
    action,
  };
};

const priceFact = (
  cell: VenueAnswerCell,
  input: VenueFactsInput,
): VenueFactView => {
  if (cell.label === "Typically") {
    return {
      key: "price",
      icon: "price",
      value: `Typically ${cell.value}`,
      detail: cell.note,
      action: null,
    };
  }
  if (cell.label === "From") {
    // The qualifier is read from the data (#1562): "per night · before taxes
    // and fees", or the all-in wording. Its "per night" joins the number.
    const perNight = cell.note !== null && cell.note.startsWith(PER_NIGHT_PREFIX);
    const qualifier = perNight
      ? (cell.note as string).slice(PER_NIGHT_PREFIX.length)
      : cell.note;
    const rooms =
      input.roomTypeCount !== null && input.roomTypeCount > 0
        ? `${input.roomTypeCount} room ${input.roomTypeCount === 1 ? "type" : "types"}`
        : null;
    const detail = [qualifier === null ? null : capitalise(qualifier), rooms]
      .filter((p): p is string => p !== null)
      .join(" · ");
    return {
      key: "price",
      icon: "price",
      value: perNight ? `From ${cell.value} a night` : `From ${cell.value}`,
      detail: detail.length > 0 ? detail : null,
      action: null,
    };
  }
  // "Your dates" — the quoted total has taken the slot.
  return {
    key: "price",
    icon: "price",
    value: cell.value,
    detail: cell.note === null ? null : capitalise(cell.note),
    action: null,
  };
};

/**
 * #4420 D-V1 — the answer bar's cells, as the shared fact rows. The bar's
 * honesty rules all survive because these rows only RESTATE its cells: the
 * Stay qualifier stays on the price row, the quoted total still takes that
 * row's place, and an unknown clock still claims nothing. The place row is
 * the one fact the bar never carried (the chips did).
 *
 * Order: trading venues read open state, where, spend, booking; a Stay reads
 * price, check-in, where (its booking is the Reservations tab itself).
 */
export function venueFacts(input: VenueFactsInput): VenueFactView[] {
  const byId = (id: VenueAnswerCellId): VenueAnswerCell | null =>
    input.cells.find((cell) => cell.id === id) ?? null;
  const time = byId("time");
  const price = byId("price");
  const booking = byId("booking");
  const street = input.place.street?.trim() ?? "";
  const area = input.place.area?.trim() ?? "";
  const where: VenueFactView | null =
    street.length === 0 && area.length === 0
      ? null
      : {
          key: "where",
          icon: "pin",
          value: street.length > 0 ? street : area,
          detail: street.length > 0 && area.length > 0 ? area : null,
          action: input.hasMap ? "map" : null,
        };
  const timeRow = time === null ? null : timeFact(time, input);
  const priceRow = price === null ? null : priceFact(price, input);
  if (input.profile.bookingBody === "stay") {
    return [priceRow, timeRow, where].filter(
      (f): f is VenueFactView => f !== null,
    );
  }
  if (input.featureLead !== undefined) {
    const lead = input.featureLead;
    const leadRow: VenueFactView | null =
      lead === null || lead.row === null
        ? null
        : {
            key: "booking",
            icon: lead.row.icon,
            value: lead.row.value,
            detail: lead.row.detail,
            action: lead.tab === "reservations" ? "reserve" : "lead",
            actionLabel: lead.row.actionLabel,
            actionTab: lead.tab,
          };
    const keptPrice = lead !== null && !lead.keepPriceRow ? null : priceRow;
    return [timeRow, where, keptPrice, leadRow].filter(
      (f): f is VenueFactView => f !== null,
    );
  }
  const bookingRow: VenueFactView | null =
    booking === null
      ? null
      : {
          key: "booking",
          icon: "calendar",
          value:
            input.profile.bookingBody === "table"
              ? "Tables through Mingla"
              : "Visits through Mingla",
          detail: null,
          action: "reserve",
        };
  return [timeRow, where, priceRow, bookingRow].filter(
    (f): f is VenueFactView => f !== null,
  );
}

/**
 * #4420 — an address split for the place row: the first comma part is the
 * street line, the rest (district, city) its detail. With no address, the
 * city alone is the row.
 */
export function venueAddressLines(venue: {
  address: string | null;
  city: string | null;
}): { street: string | null; area: string | null } {
  const address = venue.address?.trim() ?? "";
  const city = venue.city?.trim() ?? "";
  if (address.length === 0) {
    return { street: null, area: city.length > 0 ? city : null };
  }
  const [first = "", ...rest] = address.split(",").map((p) => p.trim());
  const restLine = rest.filter((p) => p.length > 0).join(", ");
  const area =
    restLine.length > 0
      ? restLine
      : city.length > 0 && city.toLowerCase() !== first.toLowerCase()
        ? city
        : null;
  return { street: first.length > 0 ? first : null, area };
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
