/**
 * stayDateRules — the SINGLE source of truth for every Stay date computation.
 * Issue #1503 [stay-date-pickers], SPEC §4.1 / §5.
 *
 * READ THIS BEFORE CHANGING ANY LINE BELOW.
 *
 * 1. EVERY STAY DATE IS A VENUE-LOCAL CALENDAR DATE, serialized `YYYY-MM-DD`.
 *    It is NEVER an instant, never UTC-derived, and never device-timezone
 *    derived. `stay_quote_lines.room_check_in`, `stay_reservation_lines`,
 *    `stay_room_nights.local_date` and `stay_place_windows.local_date` are all
 *    Postgres `date` columns, and every server-side guard compares against
 *      (now() AT TIME ZONE stay_settings.timezone)::date
 *    A client that disagrees with that definition will silently shift a
 *    booking by one night — the guest pays for the wrong night and nobody
 *    notices until check-in. That is exactly the bug #1503 fixed: the old
 *    `isoDateFromOffset` in StayGuestBooking.tsx seeded defaults from
 *    `setUTCDate` + `toISOString().slice(0, 10)`, so a guest in Los Angeles at
 *    18:00 got a form pre-filled TWO days past their own tomorrow.
 *
 * 2. NOON ANCHORING IS DELIBERATE. `parseStayDate` builds
 *    `new Date(y, m - 1, d, 12, 0, 0, 0)`. Midnight anchoring rolls the date
 *    backwards or forwards across DST transitions and across any host offset,
 *    so `formatStayDate(parseStayDate(d))` would stop being the identity.
 *    Noon is 11+ hours away from every real-world transition. Mirrors the
 *    proven-good pattern in app-mobile/src/components/discover/StayFilterChips.tsx.
 *
 * 3. FORBIDDEN IN THIS FILE AND IN EVERY STAY DATE PATH:
 *      - `new Date("YYYY-MM-DD")`  (parses as UTC midnight — gate
 *        `.github/scripts/strict-grep/orch-0828-no-date-only-string-constructor.mjs`)
 *      - `toISOString()`, `setUTCDate()`, `getUTCDate()`
 *      - letting a `Date` object cross a component or network boundary
 *    `Date.UTC` appears once below, inside the timezone-offset solver, where it
 *    is a pure arithmetic helper and never produces a StayDate.
 *
 * 4. `venueToday()` is the ONLY sanctioned way to compute "today". It must
 *    exactly reproduce `(now() AT TIME ZONE settings.timezone)::date`.
 *
 * INVARIANTS: I-PROPOSED-1503-STAY-DATE-IS-VENUE-LOCAL-YMD,
 *             I-PROPOSED-1503-STAY-DATES-ARE-PICKED-NOT-TYPED.
 */

/** An opaque venue-local calendar date, serialized `YYYY-MM-DD`. */
export type StayDate = string;

/** The two-date guest selection. `""` means "not chosen yet". */
export interface StayDateRange {
  checkIn: StayDate | "";
  checkOut: StayDate | "";
}

export type StayDateError =
  | "checkout_not_after_checkin"
  | "check_in_in_past"
  | "check_in_beyond_horizon"
  | "check_in_too_soon"
  | "stay_too_long"
  | "malformed";

export interface StayDateBoundsInput {
  /** IANA zone from `PublicStayDetail.timezone`. */
  timezone: string;
  /** `HH:MM:SS` from `PublicStayDetail.checkInTime`. */
  checkInTime: string;
  /** `PublicStayDetail.bookingHorizonDays`. */
  bookingHorizonDays: number;
  /** MIN of `maxAdvanceDays` across selected offerings; null when none. */
  maxAdvanceDays: number | null;
  /** MAX of `minNoticeMinutes` across selected offerings; 0 when none. */
  minNoticeMinutes: number;
  checkIn: StayDate | "" | null;
  checkOut?: StayDate | "" | null;
  /** Injectable for tests. Defaults to the real clock. */
  now?: Date;
}

export interface StayDateBounds {
  minCheckIn: StayDate;
  maxCheckIn: StayDate;
  minCheckOut: StayDate;
  maxCheckOut: StayDate;
  error: StayDateError | null;
}

/** Longest bookable stay, matching the discovery RPC's 1–365 night band. */
export const MAX_STAY_NIGHTS = 365;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FALLBACK_TIMEZONE = "UTC";
const MS_PER_DAY = 86_400_000;

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * `YYYY-MM-DD` -> a Date anchored at NOON LOCAL on that calendar day.
 * Returns null for anything that is not a real calendar date.
 */
export function parseStayDate(value: StayDate): Date | null {
  if (!ISO_DATE.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  // Rejects rolled-over dates such as 2026-02-31 (which JS would silently
  // normalise to 2026-03-03).
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** A Date -> `YYYY-MM-DD` using LOCAL getters only. Never UTC getters. */
export function formatStayDate(date: Date): StayDate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** True when `value` is a syntactically and calendrically real `YYYY-MM-DD`. */
export function isStayDate(value: unknown): value is StayDate {
  if (typeof value !== "string") return false;
  const parsed = parseStayDate(value);
  return parsed !== null && formatStayDate(parsed) === value;
}

/**
 * The venue's own current calendar date. `en-CA` formats as `YYYY-MM-DD`
 * directly, so this is a one-call reproduction of
 * `(now() AT TIME ZONE settings.timezone)::date`.
 *
 * An invalid IANA name makes `Intl` throw; fall back to `"UTC"`, which is the
 * `stay_settings.timezone` column default.
 */
export function venueToday(timezone: string, now?: Date): StayDate {
  const instant = now ?? new Date();
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: FALLBACK_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  }
}

/** Shift a StayDate by whole days. DST-safe because of the noon anchor. */
export function addStayDays(value: StayDate, days: number): StayDate {
  const parsed = parseStayDate(value);
  if (parsed === null) return value;
  parsed.setDate(parsed.getDate() + days);
  return formatStayDate(parsed);
}

/**
 * Lexicographic compare. `YYYY-MM-DD` is lexicographically ordered, so no Date
 * is needed and no timezone can interfere.
 */
export function compareStayDates(a: StayDate, b: StayDate): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Whole nights between two StayDates. Check-out is exclusive, as in SQL. */
export function nightsBetween(checkIn: StayDate, checkOut: StayDate): number {
  const start = parseStayDate(checkIn);
  const end = parseStayDate(checkOut);
  if (start === null || end === null) return 0;
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
}

/**
 * Offset (ms) of `timezone` from UTC at `instant`, derived by formatting the
 * instant in that zone and reading the wall clock back. No hardcoded tables.
 */
function timezoneOffsetMs(timezone: string, instant: Date): number | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(instant);
  } catch {
    return null;
  }
  const read = (type: string): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? Number.NaN : Number(part.value);
  };
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  if (!Number.isFinite(asUtc)) return null;
  return asUtc - instant.getTime();
}

/**
 * The real instant of a venue-local wall time — the client-side twin of
 * `(date::timestamp + check_in_time) AT TIME ZONE settings.timezone`.
 * Returns null when the zone cannot be resolved, so callers can fail open.
 */
function venueWallTimeInstant(
  date: StayDate,
  timeOfDay: string,
  timezone: string,
): number | null {
  const parsed = parseStayDate(date);
  if (parsed === null) return null;
  const [hourRaw, minuteRaw, secondRaw] = timeOfDay.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw ?? "0");
  const second = Number(secondRaw ?? "0");
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) {
    return null;
  }
  const wallAsUtc = Date.UTC(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
    hour,
    minute,
    second,
  );
  const firstOffset = timezoneOffsetMs(timezone, new Date(wallAsUtc));
  if (firstOffset === null) return null;
  let instant = wallAsUtc - firstOffset;
  // One refinement pass: near a DST boundary the first guess can land on the
  // other side of the transition, so re-read the offset at the guessed instant.
  const secondOffset = timezoneOffsetMs(timezone, new Date(instant));
  if (secondOffset !== null && secondOffset !== firstOffset) {
    instant = wallAsUtc - secondOffset;
  }
  return instant;
}

/**
 * The whole rule set (SPEC §5, R-1…R-6). Every bound derives from
 * `venueToday(timezone)` — never from the device's own calendar.
 */
export function stayDateBounds(input: StayDateBoundsInput): StayDateBounds {
  const {
    timezone,
    checkInTime,
    bookingHorizonDays,
    maxAdvanceDays,
    minNoticeMinutes,
    now,
  } = input;
  const instant = now ?? new Date();
  const today = venueToday(timezone, instant);

  // R-1 + R-3 — the earliest selectable check-in. Start at venue-local today,
  // then walk forward while the venue's own check-in moment is already inside
  // the minimum-notice window. R-3 fails OPEN (server stays the authority) when
  // the zone offset cannot be resolved; R-1/R-2/R-4/R-5 always hold.
  let minCheckIn = today;
  if (minNoticeMinutes > 0) {
    const threshold = instant.getTime() + minNoticeMinutes * 60_000;
    for (let step = 0; step <= MAX_STAY_NIGHTS; step += 1) {
      const candidateInstant = venueWallTimeInstant(minCheckIn, checkInTime, timezone);
      if (candidateInstant === null || candidateInstant >= threshold) break;
      minCheckIn = addStayDays(minCheckIn, 1);
    }
  }

  // R-2 — horizon is anchored at venue-local TODAY (matching the server's
  // `today + LEAST(...)`), not at the notice-advanced floor. Inclusive.
  const horizon = Math.min(
    bookingHorizonDays,
    maxAdvanceDays ?? bookingHorizonDays,
  );
  const maxCheckIn = addStayDays(today, Math.max(0, horizon));

  const rawCheckIn = input.checkIn ?? "";
  const rawCheckOut = input.checkOut ?? "";
  const checkInAnchor = isStayDate(rawCheckIn) ? rawCheckIn : minCheckIn;

  // R-4 + R-5 — check-out is strictly after check-in, at most 365 nights out.
  const minCheckOut = addStayDays(checkInAnchor, 1);
  const maxCheckOut = addStayDays(checkInAnchor, MAX_STAY_NIGHTS);

  const error = ((): StayDateError | null => {
    if (rawCheckIn !== "" && !isStayDate(rawCheckIn)) return "malformed";
    if (rawCheckOut !== "" && !isStayDate(rawCheckOut)) return "malformed";
    if (rawCheckIn === "") return null;
    if (compareStayDates(rawCheckIn, today) < 0) return "check_in_in_past";
    if (compareStayDates(rawCheckIn, maxCheckIn) > 0) {
      return "check_in_beyond_horizon";
    }
    if (compareStayDates(rawCheckIn, minCheckIn) < 0) return "check_in_too_soon";
    if (rawCheckOut === "") return null;
    if (compareStayDates(rawCheckOut, rawCheckIn) <= 0) {
      return "checkout_not_after_checkin";
    }
    if (nightsBetween(rawCheckIn, rawCheckOut) > MAX_STAY_NIGHTS) {
      return "stay_too_long";
    }
    return null;
  })();

  return { minCheckIn, maxCheckIn, minCheckOut, maxCheckOut, error };
}

/** The exact guest-facing copy for each rule violation (SPEC §6). */
export function stayDateErrorMessage(
  error: StayDateError | null,
  bounds: Pick<StayDateBounds, "maxCheckIn">,
): string | null {
  switch (error) {
    case "checkout_not_after_checkin":
      return "Check-out must be after check-in.";
    case "check_in_in_past":
      return "Choose a date from today onward.";
    case "check_in_beyond_horizon":
      return `This Stay takes bookings up to ${bounds.maxCheckIn}.`;
    case "check_in_too_soon":
      return "This Stay needs more notice. Choose a later date.";
    case "stay_too_long":
      return `Stays can be up to ${MAX_STAY_NIGHTS} nights.`;
    case "malformed":
      return "Check-out must be after check-in.";
    case null:
      return null;
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}

/**
 * Commit a new check-in. Clearing check-in clears the whole range; choosing a
 * check-in at or after the current check-out CLEARS check-out rather than
 * leaving an invalid range on screen (mirrors StayFilterChips.tsx:187-190).
 */
export function applyCheckInChange(
  range: StayDateRange,
  next: StayDate | "",
): StayDateRange {
  if (next === "") return { checkIn: "", checkOut: "" };
  if (range.checkOut !== "" && compareStayDates(range.checkOut, next) <= 0) {
    return { checkIn: next, checkOut: "" };
  }
  return { checkIn: next, checkOut: range.checkOut };
}

/** Commit a new check-out. `""` clears it; check-in is untouched. */
export function applyCheckOutChange(
  range: StayDateRange,
  next: StayDate | "",
): StayDateRange {
  return { checkIn: range.checkIn, checkOut: next };
}

/** Short display form (`Aug 4`) for the native rows. `""` -> `"Choose"`. */
export function formatStayDateShort(value: StayDate | ""): string {
  const parsed = value === "" ? null : parseStayDate(value);
  if (parsed === null) return "Choose";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Long display form for accessibility labels (`August 4, 2026`). */
export function formatStayDateLong(value: StayDate | ""): string {
  const parsed = value === "" ? null : parseStayDate(value);
  if (parsed === null) return "not set";
  return parsed.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
