/**
 * #4490 [venue features] — the public venue page's READ MODEL: what
 * `pg_public_venue_page` returns (features, offers, events, hours, spaces,
 * plans), parsed fail-closed. Split from venueFeaturePage.ts (which re-exports
 * all of it) so a screen that only reads a venue's features never loads the
 * page model. PURE: no React, no platform, never the venue type, never auth.
 */
import { venueClockMinutes } from "./venueOpenState";
import { parsePlanCharge, type VenuePlanCharge } from "./venueValues";

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
  /** #4490 P5 — "Tell me if a table opens" (a day and a time range). */
  notifyMe?: boolean | null;
  /** #4490 P5 — the spaces that have bookable tables (the "Where would you like to sit?" chips). */
  seatingAreas?: Array<{ spaceId: string; name: string }>;
}

/** #4490 P6 — one monthly plan on the public page (`pg_public_venue_page.memberships.plans`). */
export interface VenueFeaturePlanView {
  id: string;
  name: string;
  summary: string | null;
  priceMinor: number;
  period: "month" | "year";
  joinMode: "instant" | "request";
  assignedDeskAvailable: boolean;
  /** What's included, as the host wrote it (≤ 6 lines). */
  inclusions: string[];
  entryIncluded: boolean;
  roomHours: number;
  guestPasses: number;
  discountBps: number;
  discountKinds: string[];
  minMonths: number;
  noticeDays: number;
  graceDays: number;
  renewalNoticeDays: number;
  /** No places left: shown, not joinable. */
  full: boolean;
  /**
   * #4490 06-W4 fix 1 (W4-N2): what one payment for this plan charges, the
   * server's own numbers (`issue_4490_member_charge`: VAT added or included,
   * fees). Null when the server did not send it: then no total is shown.
   */
  charge?: VenuePlanCharge | null;
}

export interface PublicVenueFeaturesView {
  version: number;
  /** Enabled, dependencies met, and shipped: the only features the page may use. */
  features: VenueFeatureKey[];
  currencyCode: string;
  minorUnitExponent: number;
  offers: VenueFeatureOfferView[];
  tables: VenueFeatureTablesView | null;
  memberships: { fromMinor: number; interval: "month" | "year"; plans?: VenueFeaturePlanView[] } | null;
  /** #4490 P6 — the venue's VAT (for showing a plan's monthly total before joining). */
  vat?: { mode: "added" | "included" | "none"; ratePct: number } | null;
  events: VenueFeatureEventView[];
  hours: { weekly: VenueHoursWindowRow[]; specialDays: VenueSpecialDayView[] };
  spaces: VenueFeatureSpaceView[];
}

/**
 * #4490 W3 fix 1 — the plans headline with its own period: "a month" or
 * "a year" (the server's `memberships.interval` travels with `fromMinor`).
 */
export function venuePlanPeriodWords(interval: "month" | "year"): string {
  return interval === "year" ? "a year" : "a month";
}

/** #4490 W3 fix 1 — free entry reads "Free entry" (§6), never "from ₦0". */
export function venueEntryFromWords(minor: number, money: (minor: number) => string, lead: boolean): string {
  if (minor === 0) return "Free entry";
  return lead ? `Entry from ${money(minor)}` : `from ${money(minor)}`;
}

// ── parsing: wire → read model, fail closed ────────────────────────────────

/** #4490 P6 — a plan row; a row without an id, name or price is dropped. */
export function parsePlan(raw: unknown): VenueFeaturePlanView | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  const price = asInt(raw.priceMinor);
  if (price === null || price <= 0) return null;
  const n = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : fallback;
  return {
    id: raw.id,
    name: raw.name,
    summary: typeof raw.summary === "string" && raw.summary.length > 0 ? raw.summary : null,
    priceMinor: price,
    period: raw.interval === "year" ? "year" : "month",
    joinMode: raw.joinMode === "request" ? "request" : "instant",
    assignedDeskAvailable: raw.assignedDeskAvailable === true,
    inclusions: (Array.isArray(raw.inclusions) ? raw.inclusions : []).filter((l): l is string => typeof l === "string" && l.length > 0).slice(0, 6),
    entryIncluded: raw.entryIncluded === true,
    roomHours: n(raw.roomHours, 0),
    guestPasses: n(raw.guestPasses, 0),
    discountBps: n(raw.discountBps, 0),
    discountKinds: (Array.isArray(raw.discountKinds) ? raw.discountKinds : []).filter((k): k is string => typeof k === "string"),
    minMonths: n(raw.minMonths, 1),
    noticeDays: n(raw.noticeDays, 0),
    graceDays: n(raw.graceDays, 7),
    renewalNoticeDays: n(raw.renewalNoticeDays, 7),
    full: raw.full === true,
    charge: parsePlanCharge(raw.charge),
  };
}

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
            notifyMe: asBoolOrNull(tables.notifyMe),
            seatingAreas: (Array.isArray(tables.seatingAreas) ? tables.seatingAreas : [])
              .map((a) => (isRecord(a) && typeof a.spaceId === "string" && typeof a.name === "string" ? { spaceId: a.spaceId, name: a.name } : null))
              .filter((a): a is { spaceId: string; name: string } => a !== null),
          },
    memberships:
      memberships !== null && asInt(memberships.fromMinor) !== null
        ? {
            fromMinor: memberships.fromMinor as number,
            interval: memberships.interval === "year" ? "year" : "month",
            plans: (Array.isArray(memberships.plans) ? memberships.plans : [])
              .map(parsePlan)
              .filter((p): p is VenueFeaturePlanView => p !== null),
          }
        : null,
    vat:
      isRecord(raw.vat) && (raw.vat.mode === "added" || raw.vat.mode === "included" || raw.vat.mode === "none")
        ? {
            mode: raw.vat.mode,
            ratePct: typeof raw.vat.ratePct === "number" && Number.isFinite(raw.vat.ratePct) ? raw.vat.ratePct : Number(raw.vat.ratePct) || 0,
          }
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
