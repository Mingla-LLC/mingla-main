/**
 * #4490 Explorer W3 — what a venue CARD says (the deck now; the Discover venue
 * card in W6 reuses it).
 *
 * The facts come from ONE server owner, `issue_4490_venue_card_facts` (read on
 * the deck through `pg_deck_venue_facts`). This module only words them:
 *
 *   - the OFFER chip follows the venue page's own lead: the facts are turned
 *     into the page's features view and handed to `deriveVenuePage`, the single
 *     owner of "what this venue leads with", so a card and the page it opens
 *     can never disagree about the lead or its tab;
 *   - the price is the server's smallest live "from" price for the lead's
 *     feature, formatted with the shared money formatter; a lead with no price
 *     shows the lead's own verb and NO amount (never invented);
 *   - the EVENT chip says "On tonight" when something is on now or starts from
 *     17:00 to 04:59 (venue time), "On today" when it starts later today before
 *     17:00. It is decided against `now` at render from the start AND end times
 *     the facts carry, so a cached row never claims an event that has ended.
 *     Rooms never lead a card: a Stay with nothing else bookable gets no offer
 *     chip (decision 2).
 *   - plans carry their own period ("a month" / "a year"): the server's lead
 *     plan is the cheapest one a guest can join today, the same one the page
 *     shows.
 *
 * Pure: no React, no network, no i18n runtime.
 */
import {
  deriveVenuePage,
  formatVenueMoney,
  venuePlanPeriodWords,
  venueTabLabel,
  venueTypeLeadsWithTables,
  VENUE_FEATURE_KEYS,
  type PublicVenueFeaturesView,
  type VenueFeatureKey,
  type VenueFeatureOfferView,
  type VenueLeadKind,
  type VenueOfferKind,
} from "./venueFeaturePage";
import { isIanaZoneName, venueWallClock } from "./venueOpenState";
import type { PublicVenueTab } from "./publicVenueTabState";

/** `priceFrom` per feature, in minor units; null = no live price. */
export interface DeckVenuePriceFrom {
  entry: number | null;
  group_packages: number | null;
  private_hire: number | null;
  by_the_hour: number | null;
  /**
   * The cheapest plan a guest can join today (its period is
   * `membershipsPeriod`); null when no plan can be joined.
   */
  memberships: number | null;
}

/** One `issue_4490_venue_card_facts` row, parsed. */
export interface DeckVenueFacts {
  venueId: string;
  venueName: string;
  venueSlug: string;
  brandId: string | null;
  brandSlug: string;
  brandName: string;
  venueType: string | null;
  /** The venue's IANA zone (null when unknown: no "tonight" is then claimed). */
  timezone: string | null;
  features: VenueFeatureKey[];
  isBookable: boolean;
  tablesReservable: boolean;
  /** Live plans are listed on the page (even when none can be joined today). */
  plansLive: boolean;
  priceFrom: DeckVenuePriceFrom;
  /** The period of `priceFrom.memberships`. */
  membershipsPeriod: "month" | "year" | null;
  currencyCode: string;
  minorUnitExponent: number;
  onTodayStartsAt: string | null;
  /** The end of the date that starts at `onTodayStartsAt`. */
  onTodayEndsAt: string | null;
  onTodayLive: boolean;
  /** When the date running now ends. */
  onTodayLiveUntil: string | null;
}

export type DeckVenueEventChip = "On tonight" | "On today";

export interface DeckVenueOfferChip {
  /** The venue page tab the card opens (`?tab=`). */
  tab: PublicVenueTab;
  /** The page's own name for that tab ("Entry", "Plans", "Tables"). */
  tabLabel: string;
  /** "Entry from ₦4,000", "Book a table", "Plans from ₦25,000 a month". */
  label: string;
  /**
   * The plate tile's value under `tabLabel`, so the tile reads once
   * ("Entry" over "from ₦4,000", "Plans" over "from ₦25,000 a month").
   */
  tileValue: string;
  leadKind: VenueLeadKind;
  /** The offer kind behind the lead (null for tables and plans). */
  offerKind: VenueOfferKind | null;
}

export interface DeckVenueChips {
  offerChip: DeckVenueOfferChip | null;
  eventChip: DeckVenueEventChip | null;
}

type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const minor = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const FEATURE_SET: ReadonlySet<string> = new Set(VENUE_FEATURE_KEYS);

/** Wire → facts. Null for anything that is not a usable row (the card then stays as today). */
export function parseDeckVenueFacts(raw: unknown): DeckVenueFacts | null {
  if (!isRecord(raw)) return null;
  const venueId = text(raw.venueId);
  const venueSlug = text(raw.venueSlug);
  const brandSlug = text(raw.brandSlug);
  if (venueId === null || venueSlug === null || brandSlug === null) return null;
  const price = isRecord(raw.priceFrom) ? raw.priceFrom : {};
  const exponent =
    typeof raw.minorUnitExponent === "number" && Number.isInteger(raw.minorUnitExponent) &&
    raw.minorUnitExponent >= 0 && raw.minorUnitExponent <= 4
      ? raw.minorUnitExponent
      : 2;
  const instant = (value: unknown): string | null => {
    const at = text(value);
    return at !== null && !Number.isNaN(Date.parse(at)) ? at : null;
  };
  return {
    venueId,
    venueName: text(raw.venueName) ?? "",
    venueSlug,
    brandId: text(raw.brandId),
    brandSlug,
    brandName: text(raw.brandName) ?? "",
    venueType: text(raw.venueType),
    timezone: text(raw.timezone),
    features: (Array.isArray(raw.features) ? raw.features : []).filter(
      (k): k is VenueFeatureKey => typeof k === "string" && FEATURE_SET.has(k),
    ),
    isBookable: raw.isBookable === true,
    tablesReservable: raw.tablesReservable === true,
    plansLive: raw.plansLive === true,
    priceFrom: {
      entry: minor(price.entry),
      group_packages: minor(price.group_packages),
      private_hire: minor(price.private_hire),
      by_the_hour: minor(price.by_the_hour),
      memberships: minor(price.memberships),
    },
    membershipsPeriod: raw.membershipsPeriod === "year" ? "year" : raw.membershipsPeriod === "month" ? "month" : null,
    currencyCode: text(raw.currencyCode)?.toUpperCase() ?? "NGN",
    minorUnitExponent: exponent,
    onTodayStartsAt: instant(raw.onTodayStartsAt),
    onTodayEndsAt: instant(raw.onTodayEndsAt),
    onTodayLive: raw.onTodayLive === true,
    onTodayLiveUntil: instant(raw.onTodayLiveUntil),
  };
}

const OFFER_KIND_OF: Record<keyof Omit<DeckVenuePriceFrom, "memberships">, VenueOfferKind> = {
  entry: "entry",
  group_packages: "group_package",
  private_hire: "private_hire",
  by_the_hour: "by_the_hour",
};

/** The facts as the page's features view: one priced offer per feature with a live price. */
function factsAsView(facts: DeckVenueFacts, withStays: boolean): PublicVenueFeaturesView {
  const offers: VenueFeatureOfferView[] = [];
  for (const key of Object.keys(OFFER_KIND_OF) as Array<keyof typeof OFFER_KIND_OF>) {
    const from = facts.priceFrom[key];
    if (from === null) continue;
    offers.push({
      id: `card-${key}`,
      kind: OFFER_KIND_OF[key],
      entryStyle: null,
      name: key,
      summary: null,
      fromMinor: from,
      unit: key === "by_the_hour" ? "hour" : "guest",
      guestMin: null,
      guestMax: null,
      confirmationMode: "instant",
      spaceIds: null,
      sortOrder: 0,
    });
  }
  return {
    version: 0,
    features: withStays ? [...facts.features] : facts.features.filter((k) => k !== "stays"),
    currencyCode: facts.currencyCode,
    minorUnitExponent: facts.minorUnitExponent,
    offers,
    tables: null,
    // Live plans lead like the page's, priced or not (a priceless lead shows its verb).
    memberships:
      facts.priceFrom.memberships === null && !facts.plansLive
        ? null
        : {
            fromMinor: facts.priceFrom.memberships ?? 0,
            interval: facts.membershipsPeriod === "year" ? "year" : "month",
            plans: [],
          },
    events: [],
    hours: { weekly: [], specialDays: [] },
    spaces: [],
  };
}

export type DeckMoneyFormatter = (minor: number, currencyCode: string, exponent: number) => string;

/** The offer chip: the page's lead, worded with its server price. */
export function deckVenueOfferChip(
  facts: DeckVenueFacts,
  formatMoney: DeckMoneyFormatter = formatVenueMoney,
): DeckVenueOfferChip | null {
  if (!facts.isBookable) return null;
  const ctx = {
    menuTabVisible: false,
    tablesGate: facts.tablesReservable ? ("ready" as const) : ("blocked" as const),
    tablesFirst: venueTypeLeadsWithTables(facts.venueType),
  };
  let page = deriveVenuePage(factsAsView(facts, true), ctx);
  // Rooms never lead a card (decision 2): a Stay's card leads with what else
  // it sells, or with nothing.
  if (page.lead !== null && page.lead.kind === "stays") {
    page = deriveVenuePage(factsAsView(facts, false), ctx);
  }
  const lead = page.lead;
  if (lead === null || lead.kind === "stays") return null;
  const money = (value: number): string =>
    formatMoney(value, facts.currencyCode, facts.minorUnitExponent);
  const p = facts.priceFrom;
  let label: string;
  // The tile under the tab's own name: the price part only, so no word repeats.
  let tileValue: string | null = null;
  let offerKind: VenueOfferKind | null = null;
  switch (lead.kind) {
    case "entry":
      offerKind = "entry";
      label = p.entry === 0 ? "Free entry" : p.entry !== null ? `Entry from ${money(p.entry)}` : lead.ctaLabel;
      tileValue = p.entry === 0 ? "Free" : p.entry !== null ? `from ${money(p.entry)}` : null;
      break;
    case "group_packages":
      offerKind = "group_package";
      label = p.group_packages !== null ? `Groups from ${money(p.group_packages)}` : lead.ctaLabel;
      tileValue = p.group_packages !== null ? `from ${money(p.group_packages)}` : null;
      break;
    case "private_hire":
      offerKind = "private_hire";
      label = p.private_hire !== null ? `Hire from ${money(p.private_hire)}` : lead.ctaLabel;
      tileValue = p.private_hire !== null ? `from ${money(p.private_hire)}` : null;
      break;
    case "by_the_hour":
      offerKind = "by_the_hour";
      label = p.by_the_hour !== null ? `${money(p.by_the_hour)} an hour` : lead.ctaLabel;
      tileValue = p.by_the_hour !== null ? `from ${money(p.by_the_hour)}` : null;
      break;
    case "memberships": {
      const period = venuePlanPeriodWords(facts.membershipsPeriod === "year" ? "year" : "month");
      label = p.memberships !== null ? `Plans from ${money(p.memberships)} ${period}` : lead.ctaLabel;
      tileValue = p.memberships !== null ? `from ${money(p.memberships)} ${period}` : null;
      break;
    }
    case "tables":
      // W3 fix 4 (W3-N32): the venue's one table verb (deriveVenuePage: "Book
      // a table" with minimum-spend tables, otherwise "Reserve a table"), the
      // same words as its Tables button and the sheet that button opens.
      label = lead.ctaLabel;
      break;
    default: {
      const never: never = lead.kind;
      return never;
    }
  }
  return {
    tab: lead.tab,
    tabLabel: venueTabLabel(lead.tab, page),
    label,
    tileValue: tileValue ?? label,
    leadKind: lead.kind,
    offerKind,
  };
}

function zonedParts(at: Date, timeZone: string): { date: string; hour: number; minute: number } | null {
  // W3 fix 3 (W3-N21): one `format()` string (venueWallClock), never
  // `formatToParts`, which Hermes on iOS can mistype.
  const clock = venueWallClock(at, timeZone);
  if (clock === null) return null;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return { date: `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`, hour: clock.hour, minute: clock.minute };
}

/**
 * The next 05:00 in the venue's zone strictly after `now` (the end of
 * "tonight"). Counted in whole minutes from the venue's own clock, so a zone
 * with a half-hour offset works too.
 */
export function venueNightEnd(now: Date, timeZone: string): Date | null {
  if (Number.isNaN(now.getTime())) return null;
  const local = zonedParts(now, timeZone);
  if (local === null) return null;
  const sinceMinute = now.getTime() % 60_000;
  let minutes = 5 * 60 - (local.hour * 60 + local.minute);
  if (minutes <= 0) minutes += 24 * 60;
  return new Date(now.getTime() - sinceMinute + minutes * 60_000);
}

const isBefore = (now: Date, at: string | null): boolean => {
  if (at === null) return false;
  const t = Date.parse(at);
  return !Number.isNaN(t) && now.getTime() < t;
};

/**
 * "On tonight": live now, or starting 17:00 today to 04:59 tomorrow (venue
 * time). "On today": starting later today before 17:00. Null when nothing is
 * on before the night ends, when what was on has ended, or when the venue's
 * zone is unknown (rule 12: no guessed clock). Decided against `now` at
 * render: the facts are cached, so a start already past counts only while its
 * end has not passed, and a running date only until its own end.
 */
export function deckVenueEventChip(facts: DeckVenueFacts, now: Date): DeckVenueEventChip | null {
  if (facts.timezone === null || !isIanaZoneName(facts.timezone)) return null;
  if (facts.onTodayLive && isBefore(now, facts.onTodayLiveUntil)) return "On tonight";
  if (facts.onTodayStartsAt === null) return null;
  const startsAt = new Date(facts.onTodayStartsAt);
  if (Number.isNaN(startsAt.getTime())) return null;
  const end = venueNightEnd(now, facts.timezone);
  // A start after tonight's end (the cache crossed 05:00) says nothing.
  if (end === null || startsAt.getTime() >= end.getTime()) return null;
  // Started already: on only until that date's own end (unknown end: nothing).
  if (startsAt.getTime() <= now.getTime()) return isBefore(now, facts.onTodayEndsAt) ? "On tonight" : null;
  const local = zonedParts(startsAt, facts.timezone);
  if (local === null) return null;
  return local.hour >= 17 || local.hour < 5 ? "On tonight" : "On today";
}

export function deckVenueChips(
  facts: DeckVenueFacts,
  now: Date,
  formatMoney?: DeckMoneyFormatter,
): DeckVenueChips {
  return {
    offerChip: deckVenueOfferChip(facts, formatMoney),
    eventChip: deckVenueEventChip(facts, now),
  };
}

/**
 * The deck shows the event chip only while it is browsing today (rule 12):
 * no date option, "today", or a legacy value that loads as today.
 */
export function deckBrowsesToday(dateOption: string | null | undefined): boolean {
  if (dateOption === null || dateOption === undefined || dateOption === "") return true;
  return !["this_weekend", "this-weekend", "weekend", "pick_dates", "pick-a-date", "custom"].includes(dateOption);
}

/**
 * A shared (collab) deck browses the union of every participant's date window
 * (`pg_aggregate_collab_prefs.dateWindows`), so it browses only today when
 * every participant's date option does (spec 06 §5 parity, rule 12). Unknown
 * session preferences (not loaded yet) claim nothing.
 */
export function sessionBrowsesToday(participantPrefs: unknown): boolean {
  const rows: unknown[] = Array.isArray(participantPrefs)
    ? participantPrefs
    : participantPrefs !== null && typeof participantPrefs === "object"
      ? Object.values(participantPrefs as Record<string, unknown>)
      : [];
  if (rows.length === 0) return false;
  return rows.every((row) => {
    const option = isRecord(row) ? row.date_option : undefined;
    return deckBrowsesToday(typeof option === "string" ? option : null);
  });
}
