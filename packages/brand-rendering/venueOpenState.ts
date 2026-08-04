/**
 * issue #1562 [hours-and-price], step 6 of #1550 — IS IT OPEN, RIGHT NOW,
 * WHERE THE VENUE IS.
 *
 * WHAT THIS REPLACES, precisely. The public venue page shipped three separate
 * hours surfaces and every one of them read `new Date()` on the VISITOR's
 * device:
 *
 *   1. the desktop sticky panel's `Open today · 09:00–17:00`
 *      (`PublicVenueScreen.tsx:937`) — a literal open-now CLAIM made from a
 *      WEEKDAY match, with no comparison of the current clock to the open or
 *      close time at all. It fires at 03:00. It fires on a venue that shut four
 *      hours ago. And it rendered ONLY on desktop, so a phone — the surface
 *      every advert and every share actually lands on — got a bare 24-hour
 *      table and no indicator whatsoever.
 *   2. the week table's "today" accent bar, keyed on the device weekday, which
 *      is the wrong ROW for any visitor whose date has already rolled over
 *      relative to the venue's.
 *   3. #1561's answer-bar time cell, which deliberately said only "Today" and
 *      made no claim, because making one honestly is this step's work.
 *
 * THE FIX IS A TIMEZONE, AND THE TIMEZONE ALREADY EXISTED. `venue_availability_
 * config.iana_timezone` (`20261008000000_orch_1148_availability_iana_timezone
 * .sql`, `NOT NULL DEFAULT 'UTC'`, UNIQUE per `venue_id` since the ORCH-1255
 * re-key) has been the availability engine's DST-correct clock since 2026-10.
 * It was simply never selected by `venue_public_view`, so no anon surface could
 * see it. #1562 exposes that ONE column — it does not add one.
 *
 * WHY EVERY EDGE CASE IS DESIGNED HERE RATHER THAN DISCOVERED IN PRODUCTION:
 *
 *   - NO HOURS AT ALL          → `unknown`. Nothing is claimed and the cell is
 *                                dropped. Absent data is never a "Closed".
 *   - A CLOSED DAY             → contributes no span. A week of closed days is
 *                                `closed` (we KNOW), not `unknown` (we don't).
 *   - OVERNIGHT SPANS          → a bar open 21:00–02:00 has `close <= open`.
 *                                The span runs into the FOLLOWING day, so at
 *                                01:00 on Saturday the venue is open on
 *                                FRIDAY's row. Treated by extending the span
 *                                past midnight and testing the week as a ring.
 *   - MULTIPLE RANGES PER DAY  → the resolver unions every row it is given and
 *                                never assumes one row per weekday. Today
 *                                `brand_hours` carries a UNIQUE (venue_id,
 *                                weekday) index so the second row cannot exist
 *                                — but the wire is a jsonb ARRAY, the parser
 *                                does not dedupe, and a lunch/dinner split is
 *                                the obvious next schema change. Designing for
 *                                it costs one `for` loop.
 *   - THE BOUNDARY MINUTE      → `open <= now < close`. A venue that opens at
 *                                09:00 IS open at 09:00; one that closes at
 *                                17:00 is NOT open at 17:00. Stated once, here,
 *                                and asserted at both ends.
 *   - AN UNUSABLE TIMEZONE     → `unknown`, never a guess. `Intl` throws a
 *                                RangeError on an unrecognised zone, and some
 *                                Hermes builds have historically shipped a
 *                                `timeZone`-less `Intl`. Both land in the same
 *                                honest place: no claim, and the page falls
 *                                back to stating the venue's own published row.
 *
 * NO RUNTIME IMPORTS AT ALL — no React, no react-native, no date library. This
 * module is arithmetic over `Intl`, which is what lets the same resolver serve
 * buyer web, both consumer apps and both business apps from one implementation,
 * and lets the regression fake the clock rather than wait for one.
 */

/** Minutes in a day, and in a week. The ring the resolver walks. */
const DAY_MINUTES = 1440;
const WEEK_MINUTES = DAY_MINUTES * 7;

/**
 * Monday-first, matching `brand_hours.weekday` (0 = Monday … 6 = Sunday, the
 * Ve1 convention documented at
 * `20260613000000_ve1_physical_venue_brand_onboarding.sql:78`). ONE owner: the
 * screen imports these rather than declaring its own copy, because a second
 * array is how the week table and the open-now line come to disagree.
 */
export const VENUE_WEEKDAY_LABELS: readonly string[] = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
];

/**
 * `Intl` reports an English short weekday; this maps it back to the page's
 * Monday-first index. Keyed on the `en-US` output the resolver explicitly asks
 * for, so a device locale can never rotate the week.
 */
const INTL_WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

/** One published row, in the shape the public view already emits. */
export interface VenueHourRow {
  weekday: number;
  /** "HH:MM" or "HH:MM:SS"; null when closed. */
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
}

/** Where the venue's own clock stands right now. */
export interface VenueLocalClock {
  /** 0 = Monday … 6 = Sunday, in the venue's zone. */
  weekday: number;
  /** Minutes since venue-local midnight, 0..1439. */
  minutes: number;
}

export type VenueOpenStatus = "open" | "opensLater" | "closed" | "unknown";

export interface VenueOpenState {
  status: VenueOpenStatus;
  /** The venue's own weekday, 0..6. Null exactly when the zone is unusable. */
  weekday: number | null;
  /** "HH:MM" the current span ends. Non-null only when `status === "open"`. */
  closesAt: string | null;
  /** "HH:MM" the next span starts. Non-null only when `opensLater`. */
  opensAt: string | null;
  /**
   * The weekday that next opening falls on, when it is NOT the venue's today.
   * Null when it opens later the same venue-day — which is what lets the copy
   * read "opens 18:00" today and "opens Tue 09:00" when it is not today.
   */
  opensWeekday: number | null;
  /** True when the span currently open began on the PREVIOUS venue-day. */
  overnight: boolean;
}

/** The state that claims nothing. Every give-up path returns exactly this. */
const UNKNOWN: VenueOpenState = {
  status: "unknown",
  weekday: null,
  closesAt: null,
  opensAt: null,
  opensWeekday: null,
  overnight: false,
};

/**
 * "HH:MM" / "HH:MM:SS" → minutes since midnight, or null.
 *
 * Deliberately strict. A value that is not a clock is NOT coerced to 0 — a
 * silent 0 would place a venue's opening at midnight and produce a confident,
 * wrong "Open now", which is the exact failure class this file exists to end.
 */
export function venueClockMinutes(value: string | null): number | null {
  if (value === null) return null;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  // 24:00 is a legal wire value for "end of day" in some sources; anything
  // beyond it is not a time.
  if (hours < 0 || hours > 24 || minutes < 0 || minutes > 59) return null;
  const total = hours * 60 + minutes;
  return total > DAY_MINUTES ? null : total;
}

/** Minutes since midnight → "HH:MM", zero-padded. */
export function venueClockLabel(minutes: number): string {
  const wrapped = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hours = Math.floor(wrapped / 60);
  const rest = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/**
 * The venue's own weekday and minute-of-day, resolved through `Intl` so DST is
 * the platform's problem and not ours.
 *
 * FAIL-CLOSED, three ways, all returning null rather than a guess:
 *   - a blank or missing zone;
 *   - a zone `Intl` refuses (it throws `RangeError`);
 *   - a runtime whose `Intl` ignores or lacks `timeZone` support, which some
 *     Hermes builds have shipped — detected because the parts we require come
 *     back missing or unparsable rather than by trusting a version check.
 *
 * `hourCycle: "h23"` is explicit AND the 24 → 0 normalisation is kept: V8 and
 * JavaScriptCore have both, at different times, returned "24" for midnight
 * under `hour12: false`. Only one of the two guards is needed on any given
 * engine; which one is not knowable from here.
 */
export function venueLocalClock(
  now: Date,
  timeZone: string | null | undefined,
): VenueLocalClock | null {
  // `undefined` is a REAL wire state, not a type-system formality: a client
  // running against a deployment whose `venue_public_view` predates #1562's
  // migration receives no `iana_timezone` key at all, and every existing test
  // fixture predates the field too. `typeof` (rather than `=== null`) is what
  // makes the missing-column case land in the honest "unknown" arm instead of
  // throwing on `.trim()` and taking the whole page down with it.
  if (typeof timeZone !== "string") return null;
  const zone = timeZone.trim();
  if (zone.length === 0) return null;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(now);
  } catch {
    return null;
  }
  let weekday: number | null = null;
  let hour: number | null = null;
  let minute: number | null = null;
  for (const part of parts) {
    if (part.type === "weekday") {
      const index = INTL_WEEKDAY_INDEX[part.value];
      weekday = index === undefined ? null : index;
    } else if (part.type === "hour") {
      const value = Number(part.value);
      hour = Number.isInteger(value) && value >= 0 && value <= 24 ? value : null;
    } else if (part.type === "minute") {
      const value = Number(part.value);
      minute = Number.isInteger(value) && value >= 0 && value <= 59 ? value : null;
    }
  }
  if (weekday === null || hour === null || minute === null) return null;
  // h23 should never produce 24, but see the docblock — normalise anyway. A 24
  // at the top of the hour is midnight of the SAME reported weekday under every
  // engine that has emitted it.
  const normalisedHour = hour === 24 ? 0 : hour;
  return { weekday, minutes: normalisedHour * 60 + minute };
}

/** One opening span, flattened onto the week ring in minutes from Mon 00:00. */
interface VenueSpan {
  start: number;
  end: number;
}

/**
 * Every published row → its span on the week ring.
 *
 * A row whose close is at or before its open CROSSES MIDNIGHT and is extended
 * by a day: 21:00–02:00 on Friday becomes Friday 21:00 → Saturday 02:00. An
 * open equal to its close is read as a full 24 hours, which is the convention
 * "00:00–00:00" is written in.
 */
function venueSpans(hours: readonly VenueHourRow[]): VenueSpan[] {
  const spans: VenueSpan[] = [];
  for (const row of hours) {
    if (row.isClosed) continue;
    if (!Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6) {
      continue;
    }
    const open = venueClockMinutes(row.openTime);
    const close = venueClockMinutes(row.closeTime);
    if (open === null || close === null) continue;
    const start = row.weekday * DAY_MINUTES + open;
    const end =
      close > open
        ? row.weekday * DAY_MINUTES + close
        : row.weekday * DAY_MINUTES + close + DAY_MINUTES;
    spans.push({ start, end });
  }
  return spans;
}

/**
 * THE RESOLVER. Pure: the same inputs always give the same answer, and `now` is
 * a parameter rather than a call to the clock, which is the whole reason the
 * boundary minute and a non-machine timezone are testable at all.
 */
export function resolveVenueOpenState(input: {
  hours: readonly VenueHourRow[];
  timeZone: string | null | undefined;
  now: Date;
}): VenueOpenState {
  const clock = venueLocalClock(input.now, input.timeZone);
  if (clock === null) return UNKNOWN;
  // Same reasoning as the `typeof` guard above — this resolver sits directly on
  // a wire boundary, and a payload that is not what the type says it is must
  // produce "unknown" rather than a TypeError inside a render.
  const hours = Array.isArray(input.hours) ? input.hours : [];
  // No published rows is not a closure — it is an absence. Saying "Closed"
  // here would be fabricating a fact about a venue that has stated none.
  if (hours.length === 0) {
    return { ...UNKNOWN, weekday: clock.weekday };
  }
  const spans = venueSpans(hours);
  const nowAbs = clock.weekday * DAY_MINUTES + clock.minutes;

  // OPEN? Test `nowAbs` and `nowAbs + WEEK_MINUTES`: the second reading is what
  // catches a Sunday-night span that runs into Monday morning, whose `end`
  // exceeds the ring.
  for (const span of spans) {
    for (const t of [nowAbs, nowAbs + WEEK_MINUTES]) {
      if (span.start <= t && t < span.end) {
        return {
          status: "open",
          weekday: clock.weekday,
          closesAt: venueClockLabel(span.end),
          opensAt: null,
          opensWeekday: null,
          // The span began on a different venue-day than the one we are in.
          overnight: Math.floor(span.start / DAY_MINUTES) % 7 !== clock.weekday,
        };
      }
    }
  }

  // NOT OPEN. The nearest span start, walking the ring forward.
  let bestDelta: number | null = null;
  let bestStart = 0;
  for (const span of spans) {
    const delta = (((span.start - nowAbs) % WEEK_MINUTES) + WEEK_MINUTES) %
      WEEK_MINUTES;
    if (bestDelta === null || delta < bestDelta) {
      bestDelta = delta;
      bestStart = span.start;
    }
  }
  if (bestDelta === null) {
    // Rows exist and every one of them is closed (or unusable). That IS a
    // known state, and it is the one honest "Closed" on this page.
    return { ...UNKNOWN, status: "closed", weekday: clock.weekday };
  }
  const opensWeekday = Math.floor(bestStart / DAY_MINUTES) % 7;
  return {
    status: "opensLater",
    weekday: clock.weekday,
    closesAt: null,
    opensAt: venueClockLabel(bestStart),
    // Only name the day when it is not the venue's today — "opens 18:00" reads
    // better than "opens Fri 18:00" when it IS Friday where the venue is.
    opensWeekday: opensWeekday === clock.weekday ? null : opensWeekday,
    overnight: false,
  };
}

/**
 * The one-line summary the desktop sticky panel and the week table both draw,
 * from the SAME state the answer bar draws. One owner, so the three cannot
 * disagree about a single venue at a single moment.
 *
 * THE `unknown` ARM SAYS NOTHING, AND THAT IS THE DECISION.
 *
 * The tempting degrade is to keep stating "Today · 09:00–17:00" from the
 * DEVICE's weekday whenever the venue's zone cannot be resolved. It was
 * rejected, twice over:
 *
 *   - IT IS THE SAME BUG, QUIETER. Without the venue's zone we do not know what
 *     "today" MEANS for that venue. A guest in Lagos reading a Miami venue at
 *     01:00 is shown Saturday's row for a venue on which it is still Friday.
 *     Weakening the verb from "Open" to "Today" does not make the row correct;
 *     it makes a wrong row harder to notice.
 *   - NOTHING IS ACTUALLY LOST. The week table directly below publishes all
 *     seven days. The only thing that disappears is a one-line DUPLICATE of a
 *     row we cannot vouch for. The answer bar shrinks from three cells to two,
 *     which is the design's own stated behaviour for absent data.
 *
 * It also makes this page's rendered tree DETERMINISTIC — no output anywhere on
 * it now varies with the reader's weekday — which is what lets a byte-frozen
 * parity baseline stay honest instead of quietly passing only on the weekday it
 * was recorded.
 *
 * `todayHours` remains a parameter because `buildVenueAnswerBar` is a public
 * API and a caller that HAS a row and no resolvable clock may legitimately want
 * to state it. `PublicVenueScreen` passes the venue-local row, which is null
 * precisely when the clock is unresolvable — so on the real page this arm
 * returns null, by construction rather than by accident.
 */
export function venueOpenStateLine(
  state: VenueOpenState,
  todayHours?: {
    openTime: string | null;
    closeTime: string | null;
    isClosed: boolean;
  } | null,
): string | null {
  switch (state.status) {
    case "open":
      return state.closesAt === null
        ? "Open now"
        : `Open now · until ${state.closesAt}`;
    case "opensLater": {
      if (state.opensAt === null) return "Closed";
      const day =
        state.opensWeekday === null
          ? ""
          : `${VENUE_WEEKDAY_LABELS[state.opensWeekday] ?? ""} `;
      return `Closed · opens ${day}${state.opensAt}`;
    }
    case "closed":
      return "Closed";
    case "unknown": {
      if (todayHours === undefined || todayHours === null) return null;
      if (todayHours.isClosed) return "Closed today";
      if (todayHours.openTime === null || todayHours.closeTime === null) {
        return null;
      }
      return `Today · ${todayHours.openTime}–${todayHours.closeTime}`;
    }
    default: {
      // Exhaustive: a fifth status does not compile until it is drawn.
      const never: never = state.status;
      return never;
    }
  }
}
