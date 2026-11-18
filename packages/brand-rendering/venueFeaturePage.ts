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
import { formatMinorCurrency } from "./venueMoney";
import {
  isIanaZoneName,
  venueClockMinutes,
  type VenueHourRow,
} from "./venueOpenState";

// ═══════════════════════════════════════════════════════════════════════════
// The read model — what `pg_public_venue_page` returns, as the client wants it
// ═══════════════════════════════════════════════════════════════════════════

export type VenueFeatureKey =
  | "entry"
  | "group_packages"
  | "private_hire"
  | "by_the_hour"
  | "table_reservations"
  | "floor_plan"
  | "pick_a_table"
  | "menu"
  | "table_ordering"
  | "min_spend_tables"
  | "guest_list"
  | "memberships"
  | "stays"
  | "events_here"
  | "waitlist";

export const VENUE_FEATURE_KEYS: readonly VenueFeatureKey[] = [
  "entry",
  "group_packages",
  "private_hire",
  "by_the_hour",
  "table_reservations",
  "floor_plan",
  "pick_a_table",
  "menu",
  "table_ordering",
  "min_spend_tables",
  "guest_list",
  "memberships",
  "stays",
  "events_here",
  "waitlist",
];

/** A feature that only works when its parent feature is on (fail closed). */
const FEATURE_PARENTS: Partial<Record<VenueFeatureKey, VenueFeatureKey>> = {
  table_ordering: "menu",
  pick_a_table: "floor_plan",
  floor_plan: "table_reservations",
  min_spend_tables: "table_reservations",
};

/** A feature that needs at least one space to mean anything. */
const FEATURES_NEEDING_A_SPACE: readonly VenueFeatureKey[] = [
  "private_hire",
  "floor_plan",
];

export type VenueOfferKind =
  | "entry"
  | "group_package"
  | "private_hire"
  | "by_the_hour";
export type VenueEntryStyle = "walk_in" | "day_pass" | "timed_session";
export type VenueOfferUnit = "guest" | "booking" | "hour" | "unit";

export interface VenueFeatureOfferView {
  id: string;
  kind: VenueOfferKind;
  entryStyle: VenueEntryStyle | null;
  name: string;
  summary: string | null;
  fromMinor: number;
  unit: VenueOfferUnit;
  guestMin: number | null;
  guestMax: number | null;
  confirmationMode: "instant" | "request";
  spaceIds: string[] | null;
  sortOrder: number;
}

export interface VenueFeatureEventView {
  id: string;
  kind: string;
  title: string;
  /** ISO timestamp. */
  startsAt: string;
  spaceName: string | null;
  fromMinor: number | null;
  /** Relative public path: `/e/…`, `/exp/…` or `/t/…`. */
  href: string;
}

/** One `brand_hours` window. 0 = Monday. `isClosed` rows carry no times. */
export interface VenueHoursWindowRow {
  weekday: number;
  windowOrdinal: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
}

export interface VenueHoursWindow {
  open: string;
  close: string;
}

export interface VenueSpecialDayView {
  /** `YYYY-MM-DD`, the venue's own calendar day. */
  date: string;
  label: string | null;
  isClosed: boolean;
  windows: VenueHoursWindow[];
}

export interface VenueFeatureSpaceView {
  id: string;
  name: string;
  setting: "indoor" | "covered" | "outdoor";
  capacityStanding: number | null;
  capacitySeated: number | null;
}

export interface VenueFeatureTablesView {
  partyMax: number | null;
  pickATable: boolean | null;
  holdFromMinor: number | null;
  minSpendFromMinor: number | null;
  largePartyRequest: boolean | null;
  guestWaitlist: boolean | null;
}

export interface PublicVenueFeaturesView {
  version: number;
  /** Enabled, dependencies met, and shipped: the only features the page may use. */
  features: VenueFeatureKey[];
  currencyCode: string;
  minorUnitExponent: number;
  offers: VenueFeatureOfferView[];
  tables: VenueFeatureTablesView | null;
  memberships: { fromMinor: number; interval: "month" } | null;
  events: VenueFeatureEventView[];
  hours: { weekly: VenueHoursWindowRow[]; specialDays: VenueSpecialDayView[] };
  spaces: VenueFeatureSpaceView[];
}

// ── parsing: wire → read model, fail closed ────────────────────────────────

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;
const asInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;
const asBoolOrNull = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const FEATURE_KEY_SET: ReadonlySet<string> = new Set(VENUE_FEATURE_KEYS);

/**
 * Keep a feature only when its parent is on and, for the two that need one, the
 * venue has a space. The server already does this; the client repeats it so a
 * stale or hand-built payload can never switch on a half-configured feature.
 */
export function satisfiedVenueFeatures(
  features: readonly VenueFeatureKey[],
  spaceCount: number,
): VenueFeatureKey[] {
  const on = new Set(features);
  const ok = (key: VenueFeatureKey, seen: Set<VenueFeatureKey>): boolean => {
    if (!on.has(key) || seen.has(key)) return false;
    seen.add(key);
    if (FEATURES_NEEDING_A_SPACE.includes(key) && spaceCount === 0) return false;
    const parent = FEATURE_PARENTS[key];
    return parent === undefined ? true : ok(parent, seen);
  };
  return VENUE_FEATURE_KEYS.filter(
    (key) => on.has(key) && ok(key, new Set<VenueFeatureKey>()),
  );
}

const parseOffer = (raw: unknown): VenueFeatureOfferView | null => {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const name = asString(raw.name);
  const fromMinor = asInt(raw.fromMinor);
  const kind = raw.kind;
  if (
    id === null ||
    name === null ||
    fromMinor === null ||
    fromMinor < 0 ||
    (kind !== "entry" &&
      kind !== "group_package" &&
      kind !== "private_hire" &&
      kind !== "by_the_hour")
  ) {
    return null;
  }
  const unit = raw.unit;
  const style = raw.entryStyle;
  return {
    id,
    kind,
    entryStyle:
      style === "walk_in" || style === "day_pass" || style === "timed_session"
        ? style
        : null,
    name,
    summary: asString(raw.summary),
    fromMinor,
    unit:
      unit === "guest" || unit === "booking" || unit === "hour" || unit === "unit"
        ? unit
        : "booking",
    guestMin: asInt(raw.guestMin),
    guestMax: asInt(raw.guestMax),
    confirmationMode: raw.confirmationMode === "request" ? "request" : "instant",
    spaceIds: Array.isArray(raw.spaceIds)
      ? raw.spaceIds.filter((v): v is string => typeof v === "string")
      : null,
    sortOrder: asInt(raw.sortOrder) ?? 0,
  };
};

const EVENT_HREF = /^\/(e|exp|t)\/[^\s/]+\/[^\s/]+$/;

const parseEvent = (raw: unknown): VenueFeatureEventView | null => {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const title = asString(raw.title);
  const startsAt = asString(raw.startsAt);
  const href = asString(raw.href);
  if (
    id === null ||
    title === null ||
    startsAt === null ||
    href === null ||
    Number.isNaN(Date.parse(startsAt)) ||
    !EVENT_HREF.test(href)
  ) {
    return null;
  }
  return {
    id,
    kind: asString(raw.kind) ?? "event",
    title,
    startsAt,
    spaceName: asString(raw.spaceName),
    fromMinor: asInt(raw.fromMinor),
    href,
  };
};

const parseWindowRow = (raw: unknown): VenueHoursWindowRow | null => {
  if (!isRecord(raw)) return null;
  const weekday = asInt(raw.weekday);
  if (weekday === null || weekday < 0 || weekday > 6) return null;
  const isClosed = raw.is_closed === true;
  const open = typeof raw.open_time === "string" ? raw.open_time : null;
  const close = typeof raw.close_time === "string" ? raw.close_time : null;
  if (!isClosed && (venueClockMinutes(open) === null || venueClockMinutes(close) === null)) {
    return null;
  }
  return {
    weekday,
    windowOrdinal: asInt(raw.window_ordinal) ?? 0,
    openTime: isClosed ? null : open,
    closeTime: isClosed ? null : close,
    isClosed,
  };
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const parseSpecialDay = (raw: unknown): VenueSpecialDayView | null => {
  if (!isRecord(raw)) return null;
  const date = asString(raw.local_date);
  if (date === null || !DATE_ONLY.test(date)) return null;
  const isClosed = raw.is_closed === true;
  const windows: VenueHoursWindow[] = [];
  if (!isClosed && Array.isArray(raw.windows)) {
    for (const w of raw.windows) {
      if (!isRecord(w)) continue;
      const open = typeof w.open === "string" ? w.open : null;
      const close = typeof w.close === "string" ? w.close : null;
      if (
        open !== null &&
        close !== null &&
        venueClockMinutes(open) !== null &&
        venueClockMinutes(close) !== null
      ) {
        windows.push({ open, close });
      }
    }
    if (windows.length === 0) return null;
  }
  return { date, label: asString(raw.label), isClosed, windows };
};

const parseSpace = (raw: unknown): VenueFeatureSpaceView | null => {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const name = asString(raw.name);
  const setting = raw.setting;
  if (
    id === null ||
    name === null ||
    (setting !== "indoor" && setting !== "covered" && setting !== "outdoor")
  ) {
    return null;
  }
  return {
    id,
    name,
    setting,
    capacityStanding: asInt(raw.capacityStanding),
    capacitySeated: asInt(raw.capacitySeated),
  };
};

/**
 * The features half of `pg_public_venue_page` / `biz_preview_venue_page`
 * (the venue row is mapped by the host app). Null for anything that is not the
 * documented shape, so the caller falls back to today's page.
 */
export function parsePublicVenueFeatures(
  raw: unknown,
): PublicVenueFeaturesView | null {
  if (!isRecord(raw) || !Array.isArray(raw.features)) return null;
  const spaces = (Array.isArray(raw.spaces) ? raw.spaces : [])
    .map(parseSpace)
    .filter((s): s is VenueFeatureSpaceView => s !== null);
  const declared = raw.features.filter(
    (k): k is VenueFeatureKey => typeof k === "string" && FEATURE_KEY_SET.has(k),
  );
  const hours = isRecord(raw.hours) ? raw.hours : {};
  const eventsBlock = isRecord(raw.events) ? raw.events : {};
  const tables = isRecord(raw.tables) ? raw.tables : null;
  const memberships = isRecord(raw.memberships) ? raw.memberships : null;
  const currencyCode = asString(raw.currencyCode);
  const exponent = asInt(raw.minorUnitExponent);
  return {
    version: asInt(raw.version) ?? 0,
    features: satisfiedVenueFeatures(declared, spaces.length),
    currencyCode: currencyCode ?? "NGN",
    minorUnitExponent: exponent !== null && exponent >= 0 && exponent <= 4 ? exponent : 2,
    offers: (Array.isArray(raw.offers) ? raw.offers : [])
      .map(parseOffer)
      .filter((o): o is VenueFeatureOfferView => o !== null)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    tables:
      tables === null
        ? null
        : {
            partyMax: asInt(tables.partyMax),
            pickATable: asBoolOrNull(tables.pickATable),
            holdFromMinor: asInt(tables.holdFromMinor),
            minSpendFromMinor: asInt(tables.minSpendFromMinor),
            largePartyRequest: asBoolOrNull(tables.largePartyRequest),
            guestWaitlist: asBoolOrNull(tables.guestWaitlist),
          },
    memberships:
      memberships !== null && asInt(memberships.fromMinor) !== null
        ? { fromMinor: memberships.fromMinor as number, interval: "month" }
        : null,
    events: (Array.isArray(eventsBlock.upcoming) ? eventsBlock.upcoming : [])
      .map(parseEvent)
      .filter((e): e is VenueFeatureEventView => e !== null),
    hours: {
      weekly: (Array.isArray(hours.weekly) ? hours.weekly : [])
        .map(parseWindowRow)
        .filter((r): r is VenueHoursWindowRow => r !== null),
      specialDays: (Array.isArray(hours.specialDays) ? hours.specialDays : [])
        .map(parseSpecialDay)
        .filter((d): d is VenueSpecialDayView => d !== null),
    },
    spaces,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Money
// ═══════════════════════════════════════════════════════════════════════════

/**
 * "₦4,000" for whole amounts, "₦4,000.50" otherwise. Falls back to the plain
 * formatter when the engine has no narrow symbol for the currency.
 */
export function formatVenueMoney(
  minor: number,
  currencyCode: string,
  exponent: number,
): string {
  if (!Number.isSafeInteger(minor) || minor < 0) return "—";
  const whole = minor % 10 ** exponent === 0;
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: currencyCode,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: whole ? 0 : exponent,
      maximumFractionDigits: whole ? 0 : exponent,
    }).format(minor / 10 ** exponent);
  } catch {
    return formatMinorCurrency(minor, currencyCode, exponent);
  }
}

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

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const WEEKDAY_SHORT_MON_FIRST = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

/** "Fri 25 Dec" from `2026-12-25`, with no timezone maths (a calendar date). */
export function venueDateLabel(date: string): string {
  if (!DATE_ONLY.test(date)) return date;
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(utc.getTime()) || utc.getUTCMonth() !== m - 1) return date;
  const mondayFirst = (utc.getUTCDay() + 6) % 7;
  return `${WEEKDAY_SHORT_MON_FIRST[mondayFirst]} ${d} ${MONTH_SHORT[m - 1]}`;
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

/** The venue's own calendar day (`YYYY-MM-DD`) and weekday, or null. */
export function venueLocalDay(
  now: Date,
  timeZone: string | null | undefined,
): { date: string; weekday: number } | null {
  if (typeof timeZone !== "string" || !isIanaZoneName(timeZone)) return null;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone.trim(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (type: string): string =>
      parts.find((p) => p.type === type)?.value ?? "";
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    if (!DATE_ONLY.test(date)) return null;
    const [y, m, d] = date.split("-").map(Number);
    return {
      date,
      weekday: (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7,
    };
  } catch {
    return null;
  }
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
  const at = new Date(startsAt);
  if (Number.isNaN(at.getTime())) return null;
  if (typeof timeZone !== "string" || !isIanaZoneName(timeZone)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone.trim(),
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const get = (type: string): string =>
      parts.find((p) => p.type === type)?.value ?? "";
    const hour = get("hour") === "24" ? "00" : get("hour");
    if (get("weekday") === "" || get("day") === "" || get("month") === "") {
      return null;
    }
    return `${get("weekday")} ${get("day")} ${get("month")} · ${hour}:${get("minute")}`;
  } catch {
    return null;
  }
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
  const tabs = TAB_ORDER.filter((tab) => tabSet.has(tab));

  // The table tab reads "Reservations" when the table family is all a venue
  // sells (today's Gogi), otherwise "Tables". A stay keeps "Reservations".
  const labels: Partial<Record<PublicVenueTab, string>> = {};
  if (tabSet.has("reservations") && !stayAsReservations && otherBookable) {
    labels.reservations = "Tables";
  }

  const minSpend = on.has("min_spend_tables");
  const tableVerb = minSpend ? "Book a table" : "Reserve a table";

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
  } else if (tabSet.has("entry")) {
    const styles = entryOffers.map((o) => o.entryStyle);
    const verb = styles.every((s) => s === "day_pass")
      ? "Buy a day pass"
      : styles.every((s) => s === "timed_session")
        ? "Book a visit"
        : "Buy entry";
    const clauses: string[] = [];
    if (tabSet.has("groups")) {
      const min = minFrom(groupOffers) as number;
      const perGuest = groupOffers.some((o) => o.unit !== "booking");
      clauses.push(`groups from ${money(min)}${perGuest ? " a guest" : ""}`);
    }
    if (tabSet.has("hire")) {
      clauses.push(`private hire from ${money(minFrom(hireOffers) as number)}`);
    }
    if (tabSet.has("by_the_hour")) {
      clauses.push(`from ${money(minFrom(hourOffers) as number)} an hour`);
    }
    if (tabSet.has("plans") && view.memberships !== null) {
      clauses.push(`plans from ${money(view.memberships.fromMinor)} a month`);
    }
    lead = {
      kind: "entry",
      tab: "entry",
      ctaLabel: verb,
      row: {
        value: `Entry from ${money(minFrom(entryOffers) as number)}`,
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
  } else if (tabSet.has("by_the_hour")) {
    lead = {
      kind: "by_the_hour",
      tab: "by_the_hour",
      ctaLabel: "Book a room",
      row: {
        value: `From ${money(minFrom(hourOffers) as number)} an hour`,
        detail: null,
        actionLabel: "Book",
        icon: "price",
      },
      keepPriceRow: false,
    };
  } else if (tabSet.has("plans") && view.memberships !== null) {
    lead = {
      kind: "memberships",
      tab: "plans",
      ctaLabel: "Join",
      row: {
        value: `Plans from ${money(view.memberships.fromMinor)} a month`,
        detail: null,
        actionLabel: "Join",
        icon: "price",
      },
      keepPriceRow: false,
    };
  } else if (tabSet.has("groups")) {
    const min = minFrom(groupOffers) as number;
    const perGuest = groupOffers.some((o) => o.unit !== "booking");
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
      ctaLabel: request ? "Ask about a date" : "Book a date",
      row: {
        value: `Hire from ${money(minFrom(hireOffers) as number)}`,
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
          price: `from ${money(minFrom(entryOffers) as number)}`,
        });
        break;
      }
      case "groups": {
        const min = minFrom(groupOffers) as number;
        const perGuest = groupOffers.some((o) => o.unit !== "booking");
        ways.push({
          tab,
          title: "Groups & parties",
          line: groupOffers[0]?.summary ?? null,
          price: perGuest ? `${money(min)} a guest` : `from ${money(min)}`,
        });
        break;
      }
      case "hire":
        ways.push({
          tab,
          title: "Private hire",
          line: hireOffers[0]?.summary ?? null,
          price: `from ${money(minFrom(hireOffers) as number)}`,
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
          line: null,
          price:
            view.memberships === null
              ? null
              : `from ${money(view.memberships.fromMinor)} a month`,
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
    has: { stays, tables: tablesFeature, menu: on.has("menu") },
  };
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
