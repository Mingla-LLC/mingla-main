/**
 * #4490 [venue features] — the public venue page is decided by what a venue
 * SELLS (its features), never by its category.
 *
 * The live two-column `PublicVenueScreen` stays. Exactly three things become
 * feature-driven, and this module is the ONE place they are worked out:
 *
 *   1. the third info row (the "lead" row under the facts),
 *   2. the tabs (which exist, in what order, with what label),
 *   3. the floating booking bar's label and the tab it opens.
 *
 * Overview also gains "Ways to come" (rows that open a tab) and a "What's on"
 * card (events held at the venue). Hours show several windows a day and special
 * days.
 *
 * PURE. No React, no react-native, no platform surface: data in, page model
 * out, so a node test can drive every venue type without a browser. The only
 * runtime imports are two pure helpers (`venueMoney`, `venueOpenState`), which
 * themselves import nothing. Everything here fails CLOSED: a payload that does
 * not parse yields null, and null yields TODAY's page (tabs: Overview, Menu,
 * Reservations; the category's own button), so the page never gets worse than
 * it was.
 *
 * `venueCategory` is read nowhere in this file. A venue type is a label and a
 * starting preset only (see `venueCategoryProfile.ts`).
 */
import type { PublicVenueTab } from "./publicVenueTabState";
import { formatVenueMoney } from "./venueMoney";
import { venueDateLabel } from "./venueValues";

// #4490 — the money, date and plan-charge helpers live in small leaves
// (venueMoney.ts, venueValues.ts) so the Guest and Host venue screens that
// only format a price or a date never load this page model.
export { formatVenueMoney } from "./venueMoney";
export { parsePlanCharge, venueDateLabel, type VenuePlanCharge } from "./venueValues";
import {
  type PublicVenueFeaturesView,
  type VenueFeatureEventView,
  type VenueFeatureKey,
  type VenueFeatureOfferView,
  type VenueHoursWindow,
  type VenueHoursWindowRow,
  type VenueOfferKind,
  type VenueOfferUnit,
  type VenueSpecialDayView,
  venueEntryFromWords,
  venuePlanPeriodWords,
} from "./venueFeatureRead";

// #4490 — the read model (what `pg_public_venue_page` returns, parsed) lives in
// venueFeatureRead.ts so the guest pages and the Host preview that only read a
// venue's features never load the page model below.
export * from "./venueFeatureRead";
import {
  venueClockMinutes,
  venueWallClock,
  type VenueHourRow,
} from "./venueOpenState";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// ═══════════════════════════════════════════════════════════════════════════
// Hours: several windows a day, and special days
// ═══════════════════════════════════════════════════════════════════════════

export interface VenueHoursDay {
  weekday: number;
  isClosed: boolean;
  windows: VenueHoursWindow[];
}

/** Weekly rows → one entry per weekday, windows in order. */
export function groupVenueHours(
  rows: readonly VenueHoursWindowRow[],
): VenueHoursDay[] {
  const byDay = new Map<number, VenueHoursDay>();
  const ordered = [...rows].sort(
    (a, b) => a.weekday - b.weekday || a.windowOrdinal - b.windowOrdinal,
  );
  for (const row of ordered) {
    const day = byDay.get(row.weekday) ?? {
      weekday: row.weekday,
      isClosed: true,
      windows: [],
    };
    if (!row.isClosed && row.openTime !== null && row.closeTime !== null) {
      day.windows.push({ open: row.openTime, close: row.closeTime });
      day.isClosed = false;
    }
    byDay.set(row.weekday, day);
  }
  return [...byDay.values()];
}

/** The old one-window-a-day entries (`PublicVenueHourEntry`) as days. */
export function venueHoursDaysFromEntries(
  entries: readonly {
    weekday: number;
    openTime: string | null;
    closeTime: string | null;
    isClosed: boolean;
  }[],
): VenueHoursDay[] {
  return entries.map((entry) => {
    const closed =
      entry.isClosed || entry.openTime === null || entry.closeTime === null;
    return {
      weekday: entry.weekday,
      isClosed: closed,
      windows: closed
        ? []
        : [{ open: entry.openTime as string, close: entry.closeTime as string }],
    };
  });
}

/** "09:00–12:00, 14:00–17:00", or "Closed". */
export function venueHoursText(
  day: Pick<VenueHoursDay, "isClosed" | "windows">,
): string {
  return day.isClosed || day.windows.length === 0
    ? "Closed"
    : day.windows.map((w) => `${w.open}–${w.close}`).join(", ");
}

export interface VenueSpecialDayRow {
  date: string;
  /** "Fri 25 Dec". */
  dateLabel: string;
  /** "Christmas Day", or null. */
  label: string | null;
  /** "Closed" or the windows. */
  text: string;
}

/**
 * The venue's own calendar day (`YYYY-MM-DD`) and weekday, or null.
 * W3 fix 3: read through `venueWallClock` (one `format()` string), never
 * `formatToParts`, which Hermes on iOS mistypes (W3-N21).
 */
export function venueLocalDay(
  now: Date,
  timeZone: string | null | undefined,
): { date: string; weekday: number } | null {
  const clock = venueWallClock(now, timeZone);
  if (clock === null) return null;
  const pad = (n: number): string => String(n).padStart(2, "0");
  const date = `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`;
  if (!DATE_ONLY.test(date)) return null;
  return { date, weekday: clock.weekday };
}

/** Upcoming special days (today onward when the venue's zone is known). */
export function venueSpecialDayRows(
  days: readonly VenueSpecialDayView[],
  today: string | null,
): VenueSpecialDayRow[] {
  return days
    .filter((d) => today === null || d.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((d) => ({
      date: d.date,
      dateLabel: venueDateLabel(d.date),
      label: d.label,
      text: d.isClosed
        ? "Closed"
        : d.windows.map((w) => `${w.open}–${w.close}`).join(", "),
    }));
}

/**
 * The rows `resolveVenueOpenState` reads: every weekly window, with today's
 * replaced by a special day's own windows (or none, when it is closed). A
 * venue closed for a public holiday must not say "Open now".
 */
export function venueOpenStateRows(
  weekly: readonly VenueHoursWindowRow[],
  specialDays: readonly VenueSpecialDayView[],
  now: Date,
  timeZone: string | null | undefined,
): VenueHourRow[] {
  const local = venueLocalDay(now, timeZone);
  const special =
    local === null ? undefined : specialDays.find((d) => d.date === local.date);
  const rows: VenueHourRow[] = [];
  for (const row of weekly) {
    if (special !== undefined && local !== null && row.weekday === local.weekday) {
      continue;
    }
    rows.push({
      weekday: row.weekday,
      openTime: row.openTime,
      closeTime: row.closeTime,
      isClosed: row.isClosed,
    });
  }
  if (special !== undefined && local !== null) {
    if (special.isClosed) {
      rows.push({
        weekday: local.weekday,
        openTime: null,
        closeTime: null,
        isClosed: true,
      });
    } else {
      for (const w of special.windows) {
        rows.push({
          weekday: local.weekday,
          openTime: w.open,
          closeTime: w.close,
          isClosed: false,
        });
      }
    }
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// Events: "Fri 28 Nov · 18:00 · The Lounge Side"
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The date and time in the venue's own zone. Null when the zone is unknown:
 * guessing a clock would be a wrong time on a ticket, so the row then names the
 * space and leaves the time to the event page.
 */
export function venueEventWhen(
  startsAt: string,
  timeZone: string | null | undefined,
): string | null {
  // W3 fix 3 (W3-N21): one `format()` string read in the venue's zone, never
  // `formatToParts` (Hermes on iOS typed the hour and minute of
  // "Sat 28 Nov at 19:00" as literals, so the row said "Sat 28 Nov · :").
  // Day-first English words from the page's own date label.
  const clock = venueWallClock(new Date(startsAt), timeZone);
  if (clock === null) return null;
  const pad = (n: number): string => String(n).padStart(2, "0");
  const day = venueDateLabel(`${clock.year}-${pad(clock.month)}-${pad(clock.day)}`);
  return `${day} · ${pad(clock.hour)}:${pad(clock.minute)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// The page model
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tabs whose flow is built in this release. A feature whose tab is not here
 * shows nothing (no dead tab). Widens with each phase: P2 adds `entry`,
 * P3 `groups`, P4 `hire`, P5 `by_the_hour`, P6 `plans`.
 */
export const BUILT_VENUE_TABS: ReadonlySet<PublicVenueTab> = new Set<PublicVenueTab>([
  "overview",
  "entry",
  "groups",
  // #4490 P4 — private hire.
  "hire",
  // #4490 P5 — by the hour.
  "by_the_hour",
  // #4490 P6 — monthly plans.
  "plans",
  "whats_on",
  "menu",
  "reservations",
  "rooms",
]);

/** Every tab, for tests of the whole table. */
export const ALL_VENUE_TABS: ReadonlySet<PublicVenueTab> = new Set<PublicVenueTab>([
  "overview",
  "entry",
  "groups",
  "hire",
  "by_the_hour",
  "plans",
  "rooms",
  "whats_on",
  "guest_list",
  "menu",
  "reservations",
]);

/** The tab order is fixed; a tab appears only when its condition holds. */
const TAB_ORDER: readonly PublicVenueTab[] = [
  "overview",
  "rooms",
  "guest_list",
  "entry",
  "by_the_hour",
  "plans",
  "groups",
  "hire",
  "whats_on",
  "menu",
  "reservations",
];

const TAB_LABELS: Record<PublicVenueTab, string> = {
  overview: "Overview",
  rooms: "Rooms",
  guest_list: "Guest list",
  entry: "Entry",
  by_the_hour: "By the hour",
  plans: "Plans",
  groups: "Groups",
  hire: "Private hire",
  whats_on: "What's on",
  menu: "Menu",
  reservations: "Reservations",
};

/** The page's own gate for the table flow. */
export type VenueTablesGate =
  /** Still checking, or the check failed: keep the tab (it has retry states). */
  | "pending"
  /** Reservable right now. */
  | "ready"
  /** Checked, and not reservable: no tab, no button. */
  | "blocked";

export interface VenuePageContext {
  /** Real menu items exist (the existing Menu-tab gate, already resolved). */
  menuTabVisible: boolean;
  tablesGate: VenueTablesGate;
  /** A preview shows every tab the venue will have, ready or not. */
  preview?: boolean;
  /** Tabs this release builds. Default `BUILT_VENUE_TABS`. */
  built?: ReadonlySet<PublicVenueTab>;
  /**
   * #4490 fix 2 (N90): the venue's type leads with tables (a bar or a
   * restaurant): when its tables can be booked they are the lead, ahead of an
   * Entry deal. Other types keep Entry first.
   */
  tablesFirst?: boolean;
}

/** #4490 fix 2 (N90): venue types whose first feature is their tables. */
export function venueTypeLeadsWithTables(category: string | null | undefined): boolean {
  return category === "bar_lounge" || category === "restaurant";
}

export interface VenueLeadRow {
  value: string;
  detail: string | null;
  /** The row's one action label ("Reserve", "Buy entry", "Ask"). */
  actionLabel: string;
  icon: "calendar" | "price";
}

export type VenueLeadKind =
  | "stays"
  | "entry"
  | "tables"
  | "by_the_hour"
  | "memberships"
  | "group_packages"
  | "private_hire";

export interface VenueLead {
  kind: VenueLeadKind;
  /** The tab the bar's button opens. */
  tab: PublicVenueTab;
  /** The bar's button label. */
  ctaLabel: string;
  /** The third info row. Null for stays (they keep today's rows). */
  row: VenueLeadRow | null;
  /** Keep the "Typically …" price row (only tables and stays do). */
  keepPriceRow: boolean;
}

export interface VenueWayRow {
  tab: PublicVenueTab;
  title: string;
  line: string | null;
  price: string | null;
}

export interface VenuePageModel {
  /** True when there is no features payload: today's page. */
  legacy: boolean;
  tabs: PublicVenueTab[];
  /** Label overrides; fall back to `venueTabLabel`. */
  labels: Partial<Record<PublicVenueTab, string>>;
  lead: VenueLead | null;
  showWays: boolean;
  ways: VenueWayRow[];
  events: VenueFeatureEventView[];
  /** For formatting event prices. Null on the legacy page. */
  currency: { code: string; exponent: number } | null;
  /** The words the table and stay flows are named with (sheet titles, a11y). */
  verbs: { table: string; stay: string };
  /**
   * W3 fix 3 (W3-N22/N27): the action of EACH tab, in one place. The docked
   * bar and a tab's own buttons read the ACTIVE tab's verb (a Tables tab never
   * borrows the lead's "Buy entry"); the lead's `ctaLabel` is its tab's verb.
   */
  tabVerbs: Partial<Record<PublicVenueTab, string>>;
  /** Feature facts the screen needs to pick bodies and gates. */
  has: { stays: boolean; tables: boolean; menu: boolean };
}

export function venueTabLabel(
  tab: PublicVenueTab,
  model: Pick<VenuePageModel, "labels">,
): string {
  return model.labels[tab] ?? TAB_LABELS[tab];
}

const WAYS_FEATURES: readonly VenueFeatureKey[] = [
  "entry",
  "group_packages",
  "private_hire",
  "by_the_hour",
  "memberships",
  "guest_list",
  "events_here",
];

const minFrom = (offers: readonly VenueFeatureOfferView[]): number | null =>
  offers.length === 0 ? null : Math.min(...offers.map((o) => o.fromMinor));

/**
 * #4490 W3 fix 2 (W3-N17): the words after a hire "from" price for its own
 * unit: " an hour" for a row priced by the hour (existing words); otherwise
 * none, as spec 03's "Hire from {min}".
 */
export function venueUnitWords(unit: VenueOfferUnit): string {
  return unit === "hour" ? " an hour" : "";
}

/** #4490 W3 fix 2 (W3-N17): the cheapest hire offer, whose unit its price words carry. */
export function venueHireFrom(offers: readonly VenueFeatureOfferView[]): VenueFeatureOfferView | null {
  return offers.length === 0 ? null : offers.reduce((a, b) => (b.fromMinor < a.fromMinor ? b : a));
}

/**
 * #4490 W3 fix 2 (W3-N17): the groups "from" across packages, in ONE unit: the
 * cheapest per-guest package when there is one, else the cheapest per-booking
 * package (the server's rule inside one package, and the card's
 * `priceFrom.group_packages`). A per-booking price is never compared with a
 * per-guest one as if they were the same.
 */
export function venueGroupsFrom(
  offers: readonly VenueFeatureOfferView[],
): { offer: VenueFeatureOfferView; perGuest: boolean } | null {
  const perGuest = offers.filter((o) => o.unit !== "booking");
  const pool = perGuest.length > 0 ? perGuest : offers;
  if (pool.length === 0) return null;
  const offer = pool.reduce((a, b) => (b.fromMinor < a.fromMinor ? b : a));
  return { offer, perGuest: perGuest.length > 0 };
}

const capitalise = (s: string): string =>
  s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);

/** Today's page: Overview, Menu (with items), Reservations. */
function legacyModel(ctx: VenuePageContext): VenuePageModel {
  const hasMenu = ctx.menuTabVisible;
  return {
    legacy: true,
    tabs: hasMenu
      ? ["overview", "menu", "reservations"]
      : ["overview", "reservations"],
    labels: {},
    lead: null,
    showWays: false,
    ways: [],
    events: [],
    currency: null,
    verbs: { table: "Reserve a table", stay: "Reserve this Stay" },
    tabVerbs: { reservations: "Reserve a table" },
    has: { stays: false, tables: true, menu: hasMenu },
  };
}

/**
 * THE DERIVATION. Features in, page out. Deterministic: the same payload and
 * context always give the same tabs, lead and button.
 */
export function deriveVenuePage(
  view: PublicVenueFeaturesView | null,
  ctx: VenuePageContext,
): VenuePageModel {
  if (view === null) return legacyModel(ctx);
  const built = ctx.built ?? BUILT_VENUE_TABS;
  const on = new Set<VenueFeatureKey>(view.features);
  const money = (minor: number): string =>
    formatVenueMoney(minor, view.currencyCode, view.minorUnitExponent);

  const offersOf = (kind: VenueOfferKind): VenueFeatureOfferView[] =>
    view.offers.filter((o) => o.kind === kind);
  const entryOffers = offersOf("entry");
  const groupOffers = offersOf("group_package");
  const hireOffers = offersOf("private_hire");
  const hourOffers = offersOf("by_the_hour");

  const tablesFeature = on.has("table_reservations");
  const tablesShown =
    tablesFeature && (ctx.preview === true || ctx.tablesGate !== "blocked");
  const tablesReady = tablesFeature && (ctx.preview === true || ctx.tablesGate === "ready");

  const wants: Record<PublicVenueTab, boolean> = {
    overview: true,
    rooms: false, // decided below: it shares the stay body with `reservations`
    guest_list: false, // not built: the switch is hidden (reconciliation 6)
    entry: on.has("entry") && entryOffers.length > 0,
    by_the_hour: on.has("by_the_hour") && hourOffers.length > 0,
    plans: on.has("memberships") && view.memberships !== null,
    groups: on.has("group_packages") && groupOffers.length > 0,
    hire: on.has("private_hire") && hireOffers.length > 0,
    whats_on: on.has("events_here") && view.events.length > 0,
    menu: on.has("menu") && ctx.menuTabVisible,
    reservations: tablesShown,
  };
  const stays = on.has("stays");
  const present = (tab: PublicVenueTab): boolean =>
    wants[tab] && built.has(tab);

  // Stays: one bookable tab keeps today's key and label; beside any other
  // bookable tab it becomes "Rooms".
  const otherBookable = (
    ["entry", "by_the_hour", "plans", "groups", "hire", "guest_list"] as const
  ).some(present);
  const roomsAsOwnTab = stays && (otherBookable || present("reservations"));
  const stayAsReservations = stays && !roomsAsOwnTab;
  const tabSet = new Set<PublicVenueTab>(
    TAB_ORDER.filter((tab) => {
      if (tab === "rooms") return roomsAsOwnTab && built.has("rooms");
      if (tab === "reservations") {
        return present("reservations") || (stayAsReservations && built.has("reservations"));
      }
      return present(tab);
    }),
  );
  const tabs: PublicVenueTab[] = TAB_ORDER.filter((tab) => tabSet.has(tab));

  // The table tab reads "Reservations" when the table family is all a venue
  // sells (today's Gogi), otherwise "Tables". A stay keeps "Reservations".
  const labels: Partial<Record<PublicVenueTab, string>> = {};
  if (tabSet.has("reservations") && !stayAsReservations && otherBookable) {
    labels.reservations = "Tables";
  }

  const minSpend = on.has("min_spend_tables");
  const tableVerb = minSpend ? "Book a table" : "Reserve a table";

  // ── each tab's action (W3 fix 3, W3-N22/N27) ────────────────────────────
  const entryStyles = entryOffers.map((o) => o.entryStyle);
  const entryVerb = entryStyles.every((s) => s === "day_pass")
    ? "Buy a day pass"
    : entryStyles.every((s) => s === "timed_session")
      ? "Book a visit"
      : "Buy entry";
  const hireVerb = hireOffers.some((o) => o.confirmationMode === "request")
    ? "Ask about a date"
    : "Book a date";
  const tabVerbs: Partial<Record<PublicVenueTab, string>> = {};
  if (tabSet.has("entry")) tabVerbs.entry = entryVerb;
  if (tabSet.has("groups")) tabVerbs.groups = "Book for a group";
  if (tabSet.has("hire")) tabVerbs.hire = hireVerb;
  // W3-N27: a pool table, phone booth or desk is not "a room": the by-the-hour
  // action is the pane's own "Book" (spec 06 §6 names no by-the-hour verb).
  if (tabSet.has("by_the_hour")) tabVerbs.by_the_hour = "Book";
  if (tabSet.has("plans")) tabVerbs.plans = "Join";
  if (tabSet.has("reservations")) {
    tabVerbs.reservations = stayAsReservations ? "Reserve this Stay" : tableVerb;
  }
  if (tabSet.has("rooms")) tabVerbs.rooms = "Reserve this Stay";

  // ── the lead: the one thing the bar sells ───────────────────────────────
  let lead: VenueLead | null = null;
  if (stays && (tabSet.has("rooms") || stayAsReservations)) {
    lead = {
      kind: "stays",
      tab: tabSet.has("rooms") ? "rooms" : "reservations",
      ctaLabel: "Reserve this Stay",
      row: null,
      keepPriceRow: true,
    };
  } else if (tabSet.has("entry") && !(ctx.tablesFirst === true && tabSet.has("reservations") && tablesReady && tablesFeature)) {
    const verb = entryVerb;
    const clauses: string[] = [];
    if (tabSet.has("groups")) {
      const groups = venueGroupsFrom(groupOffers);
      if (groups !== null) {
        clauses.push(`groups from ${money(groups.offer.fromMinor)}${groups.perGuest ? " a guest" : ""}`);
      }
    }
    if (tabSet.has("hire")) {
      const hire = venueHireFrom(hireOffers);
      if (hire !== null) clauses.push(`private hire from ${money(hire.fromMinor)}${venueUnitWords(hire.unit)}`);
    }
    if (tabSet.has("by_the_hour")) {
      clauses.push(`from ${money(minFrom(hourOffers) as number)} an hour`);
    }
    if (tabSet.has("plans") && view.memberships !== null) {
      clauses.push(`plans from ${money(view.memberships.fromMinor)} ${venuePlanPeriodWords(view.memberships.interval)}`);
    }
    lead = {
      kind: "entry",
      tab: "entry",
      ctaLabel: verb,
      row: {
        value: venueEntryFromWords(minFrom(entryOffers) as number, money, true),
        detail:
          clauses.length === 0
            ? null
            : capitalise(clauses.slice(0, 2).join(" · ")),
        actionLabel: verb,
        icon: "price",
      },
      keepPriceRow: false,
    };
  } else if (tabSet.has("reservations") && tablesReady && tablesFeature) {
    const t = view.tables;
    const priced =
      minSpend && t !== null && t.holdFromMinor !== null && t.minSpendFromMinor !== null;
    lead = {
      kind: "tables",
      tab: "reservations",
      ctaLabel: tableVerb,
      row: priced
        ? {
            value: `Tables from ${money(t.holdFromMinor as number)}`,
            detail: `Spend at least ${money(t.minSpendFromMinor as number)}`,
            actionLabel: "Book a table",
            icon: "calendar",
          }
        : {
            value: "Tables through Mingla",
            detail: null,
            actionLabel: "Reserve",
            icon: "calendar",
          },
      keepPriceRow: true,
    };
  } else if (tabSet.has("plans") && view.memberships !== null) {
    // #4490 spec 06 decision 13.2 (Seth, 19 Nov): Plans lead By the hour.
    lead = {
      kind: "memberships",
      tab: "plans",
      ctaLabel: "Join",
      row: {
        value: `Plans from ${money(view.memberships.fromMinor)} ${venuePlanPeriodWords(view.memberships.interval)}`,
        detail: null,
        actionLabel: "Join",
        icon: "price",
      },
      keepPriceRow: false,
    };
  } else if (tabSet.has("by_the_hour")) {
    lead = {
      kind: "by_the_hour",
      tab: "by_the_hour",
      ctaLabel: tabVerbs.by_the_hour ?? "Book",
      row: {
        value: `From ${money(minFrom(hourOffers) as number)} an hour`,
        detail: null,
        actionLabel: "Book",
        icon: "price",
      },
      keepPriceRow: false,
    };
  } else if (tabSet.has("groups")) {
    const groups = venueGroupsFrom(groupOffers);
    const min = groups?.offer.fromMinor ?? (minFrom(groupOffers) as number);
    const perGuest = groups?.perGuest ?? false;
    const mins = groupOffers.map((o) => o.guestMin).filter((n): n is number => n !== null);
    const maxes = groupOffers.map((o) => o.guestMax).filter((n): n is number => n !== null);
    lead = {
      kind: "group_packages",
      tab: "groups",
      ctaLabel: "Book for a group",
      row: {
        value: perGuest ? `Groups from ${money(min)} a guest` : `Groups from ${money(min)}`,
        detail:
          mins.length > 0 && maxes.length > 0
            ? `${Math.min(...mins)} to ${Math.max(...maxes)} guests`
            : null,
        actionLabel: "Book",
        icon: "price",
      },
      keepPriceRow: false,
    };
  } else if (tabSet.has("hire")) {
    const request = hireOffers.some((o) => o.confirmationMode === "request");
    const maxes = hireOffers.map((o) => o.guestMax).filter((n): n is number => n !== null);
    lead = {
      kind: "private_hire",
      tab: "hire",
      ctaLabel: hireVerb,
      row: {
        value: `Hire from ${money(minFrom(hireOffers) as number)}${venueUnitWords(venueHireFrom(hireOffers)?.unit ?? "booking")}`,
        detail: maxes.length > 0 ? `Up to ${Math.max(...maxes)} guests` : null,
        actionLabel: request ? "Ask" : "Book",
        icon: "price",
      },
      keepPriceRow: false,
    };
  }
  // `table_ordering` with a menu keeps today's ordering bar: no lead of its own.

  // ── Ways to come ────────────────────────────────────────────────────────
  const ways: VenueWayRow[] = [];
  for (const tab of tabs) {
    if (tab === "overview" || tab === "whats_on") continue;
    switch (tab) {
      case "entry": {
        const first = entryOffers[0];
        ways.push({
          tab,
          title: "Entry",
          line: first?.summary ?? null,
          price: venueEntryFromWords(minFrom(entryOffers) as number, money, false),
        });
        break;
      }
      case "groups": {
        // #4490 N50: the line and the price come from the same package (the
        // cheapest), and the price says "from" when there is more than one.
        // W3 fix 2 (W3-N17): per-guest packages first, so the unit is the price's own.
        const groups = venueGroupsFrom(groupOffers);
        const cheapest = groups?.offer ?? null;
        const min = cheapest?.fromMinor ?? (minFrom(groupOffers) as number);
        const perGuest = groups?.perGuest ?? false;
        const several = groupOffers.length > 1;
        ways.push({
          tab,
          title: "Groups & parties",
          line: several
            ? `${groupOffers.length} packages: ${groupOffers.slice(0, 3).map((o) => o.name).join(", ")}`
            : cheapest?.summary ?? null,
          // W3 fix 3 (W3-N28): "from" like every other Ways row (one package
          // still has a minimum group and dearer options).
          price: `from ${money(min)}${perGuest ? " a guest" : ""}`,
        });
        break;
      }
      case "hire":
        ways.push({
          tab,
          title: "Private hire",
          line: hireOffers[0]?.summary ?? null,
          price: `from ${money(minFrom(hireOffers) as number)}${venueUnitWords(venueHireFrom(hireOffers)?.unit ?? "booking")}`,
        });
        break;
      case "by_the_hour":
        ways.push({
          tab,
          title: "By the hour",
          line: hourOffers[0]?.summary ?? null,
          price: `from ${money(minFrom(hourOffers) as number)} an hour`,
        });
        break;
      case "plans":
        ways.push({
          tab,
          title: "Plans",
          line:
            (view.memberships?.plans ?? []).length > 0
              ? (view.memberships?.plans ?? []).slice(0, 3).map((p) => p.name).join(" · ")
              : null,
          price:
            view.memberships === null
              ? null
              : `from ${money(view.memberships.fromMinor)} ${venuePlanPeriodWords(view.memberships.interval)}`,
        });
        break;
      case "reservations":
        ways.push({
          tab,
          title: stayAsReservations ? "Rooms" : tableVerb,
          line: null,
          price: null,
        });
        break;
      case "rooms":
        ways.push({ tab, title: "Rooms", line: null, price: null });
        break;
      case "menu":
        ways.push({ tab, title: "Menu", line: null, price: null });
        break;
      default:
        break;
    }
  }
  // #4490 N50: what the venue leads with comes first (a restaurant's tables
  // were listed last).
  if (lead !== null) {
    const at = ways.findIndex((w) => w.tab === lead.tab);
    if (at > 0) ways.unshift(...ways.splice(at, 1));
  }
  // #4490 N117: the same for the tab strip. When the tables lead the page and
  // sit beside other ways to come (they read "Tables"), the Tables tab comes
  // right after Overview, not last. A table-only venue keeps its order.
  if (lead !== null && lead.kind === "tables" && labels.reservations === "Tables") {
    const at = tabs.indexOf("reservations");
    const after = tabs.indexOf("overview") + 1;
    if (at > after) tabs.splice(after, 0, ...tabs.splice(at, 1));
  }
  const showWays =
    !stays && ways.length > 0 && WAYS_FEATURES.some((key) => on.has(key));

  return {
    legacy: false,
    tabs,
    labels,
    lead,
    showWays,
    ways,
    events: tabSet.has("whats_on") ? view.events : [],
    currency: { code: view.currencyCode, exponent: view.minorUnitExponent },
    verbs: {
      table: tablesFeature ? tableVerb : "Book",
      stay: stays ? "Reserve this Stay" : "Book",
    },
    tabVerbs,
    has: { stays, tables: tablesFeature, menu: on.has("menu") },
  };
}

/**
 * #4490 W3 fix 3 (W3-N22) — the page's verbs, in one place for both surfaces.
 *  - `lead`: what the docked bar sells off its own tab (the lead's verb).
 *  - `rail`: the table/stay rail's own action: the Reservations body's button,
 *    its sheet title and the host bar's reserve words. Never the lead's verb.
 *  - `table` / `stay`: what each rail body names its button.
 * Today's page (no features) uses the category's one verb everywhere.
 */
export function venuePageVerbs(
  page: VenuePageModel,
  ctx: { reservationsKind: "table" | "stay"; legacyReserveAction: string },
): { lead: string; rail: string; table: string; stay: string } {
  if (page.legacy) {
    const v = ctx.legacyReserveAction;
    return { lead: v, rail: v, table: v, stay: v };
  }
  const rail = ctx.reservationsKind === "stay" ? page.verbs.stay : page.verbs.table;
  return {
    lead: page.lead?.ctaLabel ?? (page.has.stays ? page.verbs.stay : page.verbs.table),
    rail,
    table: page.verbs.table,
    stay: page.verbs.stay,
  };
}

/**
 * #4490 W3 fix 3 (W3-N22) — may the lead's docked bar show on this tab? Not
 * on a tab that sells something of its own (its pane reports its own bar, or
 * its body carries its own button): Entry, Groups, Private hire, By the hour,
 * Plans, and on a features page Tables and Rooms. Today's page keeps its rule
 * (the Reservations tab is its lead, which the caller already excludes).
 */
export function venueLeadBarAllowedOn(page: VenuePageModel, activeTab: PublicVenueTab): boolean {
  switch (activeTab) {
    case "entry":
    case "groups":
    case "hire":
    case "by_the_hour":
    case "plans":
      return false;
    case "reservations":
    case "rooms":
      return page.legacy;
    default:
      return true;
  }
}

/**
 * #4490 W3 fix 5 (W3-N37) — the order bar a host's ordering surface reported,
 * docked at the page's bottom edge: only on the Menu tab, and never while a
 * reservation sheet is up. Leaving the Menu tab takes it away; the other tabs
 * keep their own bars.
 */
export function venueMenuOrderBarOn<Bar>(
  activeTab: PublicVenueTab,
  bar: Bar | null,
  reservationSheetOpen: boolean,
): Bar | null {
  if (activeTab !== "menu" || reservationSheetOpen) return null;
  return bar;
}

/** The tab a venue page opens on for a `?tab=` value. */
export function venueTabFromParam(value: string | null | undefined): PublicVenueTab | null {
  switch (value) {
    case "menu":
    case "reservations":
    case "entry":
    case "groups":
    case "hire":
    case "by_the_hour":
    case "plans":
    case "rooms":
    case "whats_on":
      return value;
    default:
      return null;
  }
}
