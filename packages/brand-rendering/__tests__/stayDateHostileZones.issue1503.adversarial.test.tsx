/**
 * Issue #1503 [stay-date-pickers] — TESTER ADVERSARIAL suite.
 * Append-only: NEW file. Modifies and deletes nothing.
 *
 * ============================================================================
 * WHY THIS IS NOT A RENAMED COPY OF THE IMPLEMENTOR'S SUITES
 * ============================================================================
 * The implementor's three suites assert that the module returns the values the
 * SPEC's table says it should, and re-run the whole file three times from a CI
 * matrix (TZ=UTC / America/New_York / Pacific/Auckland). Both halves of that are
 * self-referential: the expectations are transcribed from the same document the
 * code was written from, and three well-behaved whole-hour zones cannot expose a
 * bound that is off by a day.
 *
 * This suite attacks from the opposite side.
 *
 *  A. INDEPENDENT SERVER ORACLE, NOT A SPEC TRANSCRIPT. `serverAcceptsCheckIn`
 *     below is a from-scratch re-derivation of the ONLY authority that matters —
 *     the SQL guard in 20270131013811_issue_1388_stay_reservation_management.sql
 *     :426-443, which raises `stay_date_outside_horizon`:
 *         v_check_in < (now() AT TIME ZONE tz)::date
 *      OR v_check_in > (now() AT TIME ZONE tz)::date
 *                      + LEAST(booking_horizon_days,
 *                              COALESCE(max_advance_days, booking_horizon_days))
 *      OR ((v_check_in::timestamp + check_in_time) AT TIME ZONE tz)
 *                      < now() + min_notice_minutes
 *     It resolves the venue wall-clock instant by BRUTE-FORCE INVERSION (scan
 *     candidate offsets, keep the one whose formatted wall clock in the zone is
 *     the target) — structurally different from stayDateRules' two-pass offset
 *     refinement, so a shared bug cannot cancel out. The suite then proves SET
 *     EQUALITY: the days the picker makes selectable (min..max) are EXACTLY the
 *     days the server accepts. Not "min is present" — "min is right".
 *
 *  B. HOSTILE ZONES, ROTATED IN-PROCESS. Node re-reads `process.env.TZ` on
 *     assignment, so the DEVICE zone is rotated inside a single run across the
 *     zones that break naive date maths and that the implementor never ran:
 *     Pacific/Kiritimati (UTC+14), Pacific/Niue (UTC-11), Australia/Lord_Howe
 *     (30-MINUTE DST shift), Asia/Kathmandu (UTC+05:45), Pacific/Chatham
 *     (+12:45/+13:45), America/St_Johns (-03:30). The assertion is stronger than
 *     "it passes in this zone": every bound must be BYTE-IDENTICAL across all of
 *     them, because a Stay night is date-only and the guest's device has no
 *     say in it.
 *
 *  C. DST TRANSITIONS IN THE VENUE'S OWN ZONE, not the device's — spring-forward
 *     and fall-back for America/New_York, America/Los_Angeles, Australia/
 *     Lord_Howe (the half-hour one) and Pacific/Chatham, swept day-by-day across
 *     the transition.
 *
 *  D. THE VALUE CONTRACT AS BYTES. Every string that can reach
 *     `payload.lines[].checkIn` is asserted to be exactly 10 chars, `::date`
 *     castable, and never an instant — no `T`, no `Z`, no offset, no space. A
 *     picker that silently changes the format breaks booking, and the edge
 *     function validates NOTHING (stay-reservations/index.ts:160-167).
 *
 *  E. THE RENDERED CONTROL vs THE ORACLE. The emitted `<input type="date">`
 *     min/max attributes are compared to the oracle's accept set — proving the
 *     browser cannot offer a day the server would reject, and does not withhold
 *     a day the server would take.
 *
 *  F. BLACKOUT RULE DIVERGENCE. VenueBlackoutSheet must NOT inherit the Stay
 *     strictly-after rule; a single-day blackout is legal. Pinned at source.
 *
 * FAILS-ON-REVERT (verified by TRUE LINE DELETION at the hash in the QA report):
 *   - drop the horizon clamp (ignore maxAdvanceDays)     -> A2 RED
 *   - shift maxCheckIn by one day (addStayDays(today, h+1)) -> A1/A2/E1 RED
 *   - seed venueToday() from the DEVICE zone instead of the venue's -> B1 RED
 *   - remove min/max from the web check-in input          -> E1 RED
 *   - make the blackout `To` floor `dateStart + 1`        -> F1 RED
 *
 * Run: cd mingla-business && npx jest --config jest.issue1503.cfg.cjs --runInBand
 */

import { readFileSync } from "fs";
import { join } from "path";

import type { PublicStayDetail } from "../stayGuest";
import { StayDateRangeField } from "../StayDateRangeField";
import {
  addStayDays,
  compareStayDates,
  formatStayDate,
  isStayDate,
  nightsBetween,
  parseStayDate,
  stayDateBounds,
  venueToday,
  applyCheckInChange,
  type StayDateRange,
} from "../stayDateRules";
import { BrandRenderingReact as React } from "../PublicVenueTabs";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ReactDOMServer = require("react-dom/server") as {
  renderToStaticMarkup: (element: unknown) => string;
};

const REPO_ROOT = join(__dirname, "..", "..", "..");

/* ==========================================================================
 * Device zones that break naive date maths. Rotated IN-PROCESS.
 * ======================================================================== */
const HOSTILE_DEVICE_ZONES = [
  "Pacific/Kiritimati", // UTC+14 — the furthest-ahead zone on earth
  "Pacific/Niue", // UTC-11 — the furthest-behind inhabited zone
  "Australia/Lord_Howe", // 30-MINUTE DST shift, the only one in the world
  "Asia/Kathmandu", // UTC+05:45 — quarter-hour offset
  "Pacific/Chatham", // UTC+12:45 / +13:45
  "America/St_Johns", // UTC-03:30 / -02:30
  "UTC",
];

/** Venue zones swept across their own DST transitions. */
const VENUE_DST_TRANSITIONS: Array<{
  zone: string;
  label: string;
  around: string;
}> = [
  { zone: "America/New_York", label: "spring forward", around: "2027-03-14" },
  { zone: "America/New_York", label: "fall back", around: "2026-11-01" },
  { zone: "America/Los_Angeles", label: "spring forward", around: "2027-03-14" },
  { zone: "America/Los_Angeles", label: "fall back", around: "2026-11-01" },
  { zone: "Australia/Lord_Howe", label: "30-min forward", around: "2026-10-04" },
  { zone: "Australia/Lord_Howe", label: "30-min back", around: "2027-04-04" },
  { zone: "Pacific/Chatham", label: "forward", around: "2026-09-27" },
];

const ORIGINAL_TZ = process.env.TZ;

function withDeviceZone<T>(zone: string, body: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  // Force V8 to observe the change before any Date is constructed.
  void new Date().getTimezoneOffset();
  try {
    return body();
  } finally {
    process.env.TZ = previous;
    void new Date().getTimezoneOffset();
  }
}

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
  void new Date().getTimezoneOffset();
});

/* ==========================================================================
 * THE INDEPENDENT SERVER ORACLE
 * ======================================================================== */

const ymdParts = (zone: string, instant: Date): Record<string, number> => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const out: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out;
};

/** `(now() AT TIME ZONE tz)::date`, derived WITHOUT touching stayDateRules. */
function sqlToday(zone: string, instant: Date): string {
  const p = ymdParts(zone, instant);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(
    p.day,
  ).padStart(2, "0")}`;
}

/**
 * `(date::timestamp + time) AT TIME ZONE tz` by BRUTE-FORCE INVERSION: try every
 * quarter-hour offset in [-14h, +14h], keep the candidate instant whose wall
 * clock in `zone` reads back as the requested wall time. Deliberately NOT the
 * two-pass refinement stayDateRules uses, so the two cannot share a bug.
 * Returns the EARLIEST match (Postgres' choice for an ambiguous fall-back time).
 */
function sqlWallInstant(date: string, time: string, zone: string): number | null {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss] = time.split(":").map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm, ss ?? 0);
  let earliest: number | null = null;
  for (let offsetMin = -14 * 60; offsetMin <= 14 * 60; offsetMin += 15) {
    const candidate = wallAsUtc - offsetMin * 60_000;
    const p = ymdParts(zone, new Date(candidate));
    if (
      p.year === y &&
      p.month === m &&
      p.day === d &&
      p.hour === hh &&
      p.minute === mm &&
      p.second === (ss ?? 0)
    ) {
      if (earliest === null || candidate < earliest) earliest = candidate;
    }
  }
  return earliest;
}

interface VenueConfig {
  timezone: string;
  checkInTime: string;
  bookingHorizonDays: number;
  maxAdvanceDays: number | null;
  minNoticeMinutes: number;
}

/** Verbatim re-derivation of the SQL `stay_date_outside_horizon` guard. */
function serverAcceptsCheckIn(
  cfg: VenueConfig,
  checkIn: string,
  now: Date,
): boolean {
  const today = sqlToday(cfg.timezone, now);
  if (checkIn < today) return false;
  const span = Math.min(
    cfg.bookingHorizonDays,
    cfg.maxAdvanceDays ?? cfg.bookingHorizonDays,
  );
  // today + span, computed with UTC arithmetic on the calendar label only —
  // no local Date, no dependence on the device zone.
  const [ty, tm, td] = today.split("-").map(Number);
  const limitMs = Date.UTC(ty, tm - 1, td) + span * 86_400_000;
  const limit = new Date(limitMs).toISOString().slice(0, 10);
  if (checkIn > limit) return false;
  if (cfg.minNoticeMinutes > 0) {
    const instant = sqlWallInstant(checkIn, cfg.checkInTime, cfg.timezone);
    if (instant !== null && instant < now.getTime() + cfg.minNoticeMinutes * 60_000) {
      return false;
    }
  }
  return true;
}

/** Enumerate calendar labels around an anchor without any local Date. */
function labelsAround(anchor: string, before: number, after: number): string[] {
  const [y, m, d] = anchor.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const out: string[] = [];
  for (let i = -before; i <= after; i += 1) {
    out.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

function boundsFor(cfg: VenueConfig, checkIn: string | "", now: Date) {
  return stayDateBounds({
    timezone: cfg.timezone,
    checkInTime: cfg.checkInTime,
    bookingHorizonDays: cfg.bookingHorizonDays,
    maxAdvanceDays: cfg.maxAdvanceDays,
    minNoticeMinutes: cfg.minNoticeMinutes,
    checkIn,
    now,
  });
}

/* ==========================================================================
 * A. SET EQUALITY — the selectable days ARE the server-accepted days
 * ======================================================================== */

describe("#1503 A · the picker's selectable set EQUALS the server's accept set", () => {
  const CASES: Array<{ name: string; cfg: VenueConfig; now: Date }> = [
    {
      name: "America/New_York venue, horizon 365, guest at 21:00 local (already tomorrow in UTC)",
      cfg: {
        timezone: "America/New_York",
        checkInTime: "15:00:00",
        bookingHorizonDays: 365,
        maxAdvanceDays: null,
        minNoticeMinutes: 0,
      },
      now: new Date(Date.UTC(2026, 7, 4, 1, 0, 0)),
    },
    {
      name: "America/Los_Angeles venue, offering caps advance at 30 days",
      cfg: {
        timezone: "America/Los_Angeles",
        checkInTime: "15:00:00",
        bookingHorizonDays: 365,
        maxAdvanceDays: 30,
        minNoticeMinutes: 0,
      },
      now: new Date(Date.UTC(2026, 7, 4, 1, 0, 0)),
    },
    {
      name: "Pacific/Kiritimati venue (UTC+14) — venue-local tomorrow is UTC today",
      cfg: {
        timezone: "Pacific/Kiritimati",
        checkInTime: "15:00:00",
        bookingHorizonDays: 45,
        maxAdvanceDays: null,
        minNoticeMinutes: 0,
      },
      now: new Date(Date.UTC(2026, 7, 3, 11, 30, 0)),
    },
    {
      name: "Pacific/Niue venue (UTC-11) — venue-local yesterday is UTC today",
      cfg: {
        timezone: "Pacific/Niue",
        checkInTime: "15:00:00",
        bookingHorizonDays: 45,
        maxAdvanceDays: null,
        minNoticeMinutes: 0,
      },
      now: new Date(Date.UTC(2026, 7, 4, 6, 0, 0)),
    },
    {
      name: "Asia/Kathmandu venue (UTC+05:45) — quarter-hour offset",
      cfg: {
        timezone: "Asia/Kathmandu",
        checkInTime: "14:00:00",
        bookingHorizonDays: 60,
        maxAdvanceDays: null,
        minNoticeMinutes: 0,
      },
      now: new Date(Date.UTC(2026, 7, 3, 18, 20, 0)),
    },
    {
      name: "Australia/Lord_Howe venue — 30-minute DST zone, 24h minimum notice",
      cfg: {
        timezone: "Australia/Lord_Howe",
        checkInTime: "15:00:00",
        bookingHorizonDays: 40,
        maxAdvanceDays: null,
        minNoticeMinutes: 1440,
      },
      now: new Date(Date.UTC(2026, 9, 3, 9, 0, 0)),
    },
    {
      name: "Pacific/Chatham venue (UTC+12:45) with a 3-hour notice window",
      cfg: {
        timezone: "Pacific/Chatham",
        checkInTime: "15:00:00",
        bookingHorizonDays: 40,
        maxAdvanceDays: null,
        minNoticeMinutes: 180,
      },
      now: new Date(Date.UTC(2026, 7, 4, 2, 30, 0)),
    },
  ];

  for (const testCase of CASES) {
    test(`A1 · ${testCase.name}`, () => {
      const bounds = boundsFor(testCase.cfg, "", testCase.now);
      const today = sqlToday(testCase.cfg.timezone, testCase.now);
      const span = Math.min(
        testCase.cfg.bookingHorizonDays,
        testCase.cfg.maxAdvanceDays ?? testCase.cfg.bookingHorizonDays,
      );
      const candidates = labelsAround(today, 4, span + 4);

      // Vacuity guard — the sweep must actually straddle both edges.
      expect(candidates.length).toBe(span + 9);
      expect(candidates.some((d) => d < bounds.minCheckIn)).toBe(true);
      expect(candidates.some((d) => d > bounds.maxCheckIn)).toBe(true);

      const selectable: string[] = [];
      const accepted: string[] = [];
      for (const day of candidates) {
        if (
          compareStayDates(day, bounds.minCheckIn) >= 0 &&
          compareStayDates(day, bounds.maxCheckIn) <= 0
        ) {
          selectable.push(day);
        }
        if (serverAcceptsCheckIn(testCase.cfg, day, testCase.now)) accepted.push(day);
      }
      expect(accepted.length).toBeGreaterThan(0);
      // THE assertion: not one day of drift, in either direction.
      expect(selectable).toEqual(accepted);
    });

    test(`A2 · ${testCase.name} — bounds and the error verdict never disagree`, () => {
      const today = sqlToday(testCase.cfg.timezone, testCase.now);
      const span = Math.min(
        testCase.cfg.bookingHorizonDays,
        testCase.cfg.maxAdvanceDays ?? testCase.cfg.bookingHorizonDays,
      );
      let inRangeSeen = 0;
      let outOfRangeSeen = 0;
      for (const day of labelsAround(today, 4, span + 4)) {
        const bounds = boundsFor(testCase.cfg, day, testCase.now);
        const inRange =
          compareStayDates(day, bounds.minCheckIn) >= 0 &&
          compareStayDates(day, bounds.maxCheckIn) <= 0;
        if (inRange) inRangeSeen += 1;
        else outOfRangeSeen += 1;
        // A date the control lets you select must never produce a date error,
        // and a date it blocks must never come back clean — otherwise min/max
        // is decoration over a post-hoc validator.
        expect({ day, inRange, error: bounds.error === null }).toEqual({
          day,
          inRange,
          error: inRange,
        });
      }
      expect(inRangeSeen).toBeGreaterThan(0);
      expect(outOfRangeSeen).toBeGreaterThan(0);
    });
  }

  test("A3 · the horizon edge is INCLUSIVE and exactly one day wide", () => {
    const cfg: VenueConfig = {
      timezone: "America/New_York",
      checkInTime: "15:00:00",
      bookingHorizonDays: 365,
      maxAdvanceDays: 30,
      minNoticeMinutes: 0,
    };
    const now = new Date(Date.UTC(2026, 7, 4, 1, 0, 0));
    const bounds = boundsFor(cfg, "", now);
    expect(bounds.maxCheckIn).toBe(addStayDays(sqlToday(cfg.timezone, now), 30));
    expect(serverAcceptsCheckIn(cfg, bounds.maxCheckIn, now)).toBe(true);
    expect(
      serverAcceptsCheckIn(cfg, addStayDays(bounds.maxCheckIn, 1), now),
    ).toBe(false);
    expect(boundsFor(cfg, bounds.maxCheckIn, now).error).toBeNull();
    expect(boundsFor(cfg, addStayDays(bounds.maxCheckIn, 1), now).error).toBe(
      "check_in_beyond_horizon",
    );
  });

  test("A4 · the TIGHTEST offering wins — a laxer sibling cannot widen the window", () => {
    const now = new Date(Date.UTC(2026, 7, 4, 1, 0, 0));
    const base = {
      timezone: "America/New_York",
      checkInTime: "15:00:00",
      bookingHorizonDays: 365,
      minNoticeMinutes: 0,
    };
    const tight = boundsFor({ ...base, maxAdvanceDays: 14 }, "", now);
    const loose = boundsFor({ ...base, maxAdvanceDays: 200 }, "", now);
    const none = boundsFor({ ...base, maxAdvanceDays: null }, "", now);
    expect(compareStayDates(tight.maxCheckIn, loose.maxCheckIn)).toBe(-1);
    expect(none.maxCheckIn).toBe(addStayDays(tight.minCheckIn, 365));
    // A venue horizon shorter than the offering cap still wins.
    const venueTighter = boundsFor(
      { ...base, bookingHorizonDays: 7, maxAdvanceDays: 200 },
      "",
      now,
    );
    expect(venueTighter.maxCheckIn).toBe(addStayDays(sqlToday(base.timezone, now), 7));
  });
});

/* ==========================================================================
 * B. HOSTILE DEVICE ZONES — the device must have ZERO influence
 * ======================================================================== */

describe("#1503 B · the guest's device zone cannot move a single bound", () => {
  const cfg: VenueConfig = {
    timezone: "America/New_York",
    checkInTime: "15:00:00",
    bookingHorizonDays: 365,
    maxAdvanceDays: 45,
    minNoticeMinutes: 720,
  };
  const NOW = new Date(Date.UTC(2026, 7, 4, 1, 0, 0)); // 21:00 Aug 3 in New York

  test("B1 · every bound is BYTE-IDENTICAL across UTC+14 … UTC-11, incl. 45- and 30-minute offsets", () => {
    const seen = new Map<string, string[]>();
    for (const zone of HOSTILE_DEVICE_ZONES) {
      const snapshot = withDeviceZone(zone, () => {
        const bounds = boundsFor(cfg, "2026-08-10", NOW);
        return JSON.stringify({
          today: venueToday(cfg.timezone, NOW),
          minCheckIn: bounds.minCheckIn,
          maxCheckIn: bounds.maxCheckIn,
          minCheckOut: bounds.minCheckOut,
          maxCheckOut: bounds.maxCheckOut,
          error: bounds.error,
          seed: addStayDays(venueToday(cfg.timezone, NOW), 1),
        });
      });
      const bucket = seen.get(snapshot) ?? [];
      bucket.push(zone);
      seen.set(snapshot, bucket);
    }
    // Vacuity guard: all seven zones really ran.
    expect([...seen.values()].flat().sort()).toEqual([...HOSTILE_DEVICE_ZONES].sort());
    expect(seen.size).toBe(1);
    // And the one value is the VENUE's date, not UTC's and not any device's.
    expect(JSON.parse([...seen.keys()][0]).today).toBe("2026-08-03");
  });

  test("B2 · the default seed is venue-local tomorrow from every hostile device zone", () => {
    for (const zone of HOSTILE_DEVICE_ZONES) {
      const seeded = withDeviceZone(zone, () =>
        addStayDays(venueToday(cfg.timezone, NOW), 1),
      );
      // UTC would give 2026-08-05 (the shipped defect); a Kiritimati device
      // would give 2026-08-05 too; Niue would give 2026-08-04 by luck.
      expect({ zone, seeded }).toEqual({ zone, seeded: "2026-08-04" });
    }
  });

  test("B3 · parse/format round-trips 800 consecutive days in every hostile zone", () => {
    for (const zone of HOSTILE_DEVICE_ZONES) {
      withDeviceZone(zone, () => {
        let day = "2026-01-01";
        let walked = 0;
        for (let i = 0; i < 800; i += 1) {
          const parsed = parseStayDate(day);
          expect(parsed).not.toBeNull();
          expect(formatStayDate(parsed as Date)).toBe(day);
          expect(isStayDate(day)).toBe(true);
          const next = addStayDays(day, 1);
          expect(nightsBetween(day, next)).toBe(1);
          day = next;
          walked += 1;
        }
        expect(walked).toBe(800);
        expect(day).toBe("2028-03-11");
      });
    }
  });

  test("B4 · a 365-night stay is 365 nights in every hostile zone (no DST rounding drift)", () => {
    for (const zone of HOSTILE_DEVICE_ZONES) {
      withDeviceZone(zone, () => {
        expect(nightsBetween("2026-03-01", addStayDays("2026-03-01", 365))).toBe(365);
        expect(nightsBetween("2026-10-01", addStayDays("2026-10-01", 365))).toBe(365);
        // Straddling a spring-forward and a fall-back in the same span.
        expect(nightsBetween("2026-10-15", "2027-03-20")).toBe(156);
      });
    }
  });
});

/* ==========================================================================
 * C. DST IN THE VENUE'S OWN ZONE
 * ======================================================================== */

describe("#1503 C · a DST transition in the VENUE's zone never shifts a night", () => {
  for (const transition of VENUE_DST_TRANSITIONS) {
    test(`C1 · ${transition.zone} ${transition.label} — venueToday tracks the wall clock hour by hour`, () => {
      const cfg: VenueConfig = {
        timezone: transition.zone,
        checkInTime: "15:00:00",
        bookingHorizonDays: 30,
        maxAdvanceDays: null,
        minNoticeMinutes: 0,
      };
      const [y, m, d] = transition.around.split("-").map(Number);
      const start = Date.UTC(y, m - 1, d - 2, 0, 0, 0);
      let checked = 0;
      // Every hour across a 96-hour window centred on the transition.
      for (let hour = 0; hour < 96; hour += 1) {
        const now = new Date(start + hour * 3_600_000);
        expect(venueToday(cfg.timezone, now)).toBe(sqlToday(cfg.timezone, now));
        const bounds = boundsFor(cfg, "", now);
        expect(bounds.minCheckIn).toBe(sqlToday(cfg.timezone, now));
        expect(bounds.maxCheckIn).toBe(
          addStayDays(sqlToday(cfg.timezone, now), 30),
        );
        checked += 1;
      }
      expect(checked).toBe(96);
    });

    test(`C2 · ${transition.zone} ${transition.label} — the minimum-notice floor matches the server hour by hour`, () => {
      const cfg: VenueConfig = {
        timezone: transition.zone,
        checkInTime: "15:00:00",
        bookingHorizonDays: 30,
        maxAdvanceDays: null,
        minNoticeMinutes: 1440,
      };
      const [y, m, d] = transition.around.split("-").map(Number);
      const start = Date.UTC(y, m - 1, d - 2, 0, 0, 0);
      let advancedAtLeastOnce = 0;
      for (let hour = 0; hour < 96; hour += 2) {
        const now = new Date(start + hour * 3_600_000);
        const bounds = boundsFor(cfg, "", now);
        const today = sqlToday(cfg.timezone, now);
        if (compareStayDates(bounds.minCheckIn, today) > 0) advancedAtLeastOnce += 1;
        // Set equality again, this time with the notice clause live.
        const selectable = labelsAround(today, 3, 33).filter(
          (day) =>
            compareStayDates(day, bounds.minCheckIn) >= 0 &&
            compareStayDates(day, bounds.maxCheckIn) <= 0,
        );
        const accepted = labelsAround(today, 3, 33).filter((day) =>
          serverAcceptsCheckIn(cfg, day, now),
        );
        expect({ hour, selectable }).toEqual({ hour, selectable: accepted });
      }
      // Vacuity guard: a 24-hour notice window MUST have pushed the floor at
      // least once in a 4-day sweep, or this test proved nothing.
      expect(advancedAtLeastOnce).toBeGreaterThan(0);
    });
  }
});

/* ==========================================================================
 * D. THE VALUE CONTRACT, AS BYTES
 * ======================================================================== */

describe("#1503 D · every value that can reach payload.lines[].checkIn is a bare ::date", () => {
  const STRICT = /^\d{4}-\d{2}-\d{2}$/;

  test("D1 · no bound, seed or committed edit is ever an instant", () => {
    const emitted: string[] = [];
    for (const zone of HOSTILE_DEVICE_ZONES) {
      withDeviceZone(zone, () => {
        for (const venueZone of [
          "America/New_York",
          "Pacific/Kiritimati",
          "Pacific/Niue",
          "Asia/Kathmandu",
          "Australia/Lord_Howe",
          "UTC",
        ]) {
          const now = new Date(Date.UTC(2026, 7, 4, 1, 0, 0));
          const today = venueToday(venueZone, now);
          const bounds = stayDateBounds({
            timezone: venueZone,
            checkInTime: "15:00:00",
            bookingHorizonDays: 365,
            maxAdvanceDays: null,
            minNoticeMinutes: 0,
            checkIn: addStayDays(today, 1),
            checkOut: addStayDays(today, 3),
            now,
          });
          emitted.push(
            today,
            bounds.minCheckIn,
            bounds.maxCheckIn,
            bounds.minCheckOut,
            bounds.maxCheckOut,
            addStayDays(today, 1),
            applyCheckInChange(
              { checkIn: addStayDays(today, 1), checkOut: addStayDays(today, 2) },
              addStayDays(today, 5),
            ).checkIn,
          );
        }
      });
    }
    expect(emitted.length).toBe(HOSTILE_DEVICE_ZONES.length * 6 * 7);
    for (const value of emitted) {
      expect(value).toMatch(STRICT);
      expect(value).toHaveLength(10);
      expect(value.includes("T")).toBe(false);
      expect(value.includes("Z")).toBe(false);
      expect(value.includes(" ")).toBe(false);
      expect(value.includes("+")).toBe(false);
    }
  });

  test("D2 · an instant-shaped or malformed value is rejected, never silently truncated", () => {
    // Postgres `::date` would SILENTLY truncate a timestamp and discard the
    // offset — the corruption vector called out in the investigation. The
    // client must never treat one as a date.
    for (const bad of [
      "2026-08-04T00:00:00Z",
      "2026-08-04 00:00:00",
      "2026-8-4",
      "20260804",
      "2026-02-31",
      "2026-13-01",
      "0026-08-04",
      "",
      "  2026-08-04",
    ]) {
      expect(isStayDate(bad)).toBe(false);
      expect(parseStayDate(bad)).toBeNull();
    }
    // ...and the bounds report it rather than pretending.
    const bounds = stayDateBounds({
      timezone: "America/New_York",
      checkInTime: "15:00:00",
      bookingHorizonDays: 365,
      maxAdvanceDays: null,
      minNoticeMinutes: 0,
      checkIn: "2026-08-04T00:00:00Z",
      now: new Date(Date.UTC(2026, 7, 4, 1, 0, 0)),
    });
    expect(bounds.error).toBe("malformed");
  });

  test("D3 · clearing check-in clears the range instead of leaving a half-valid cart", () => {
    const withBoth: StayDateRange = { checkIn: "2026-08-04", checkOut: "2026-08-06" };
    expect(applyCheckInChange(withBoth, "")).toEqual({ checkIn: "", checkOut: "" });
    // Moving check-in onto or past check-out drops the stale end date.
    expect(applyCheckInChange(withBoth, "2026-08-06")).toEqual({
      checkIn: "2026-08-06",
      checkOut: "",
    });
    expect(applyCheckInChange(withBoth, "2026-08-07")).toEqual({
      checkIn: "2026-08-07",
      checkOut: "",
    });
    // ...but a check-in that still precedes it keeps it.
    expect(applyCheckInChange(withBoth, "2026-08-05")).toEqual({
      checkIn: "2026-08-05",
      checkOut: "2026-08-06",
    });
  });
});

/* ==========================================================================
 * E. THE RENDERED CONTROL vs THE ORACLE
 * ======================================================================== */

function stayDetail(overrides: Partial<PublicStayDetail> = {}): PublicStayDetail {
  return {
    venueId: "venue-1503",
    brandId: "brand-1503",
    brandSlug: "smokerhythm",
    brandName: "Smoke & Rhythm",
    venueSlug: "minglastay1503adversarial",
    venueName: "Mingla Stay Adversarial",
    propertyKind: "hotel",
    timezone: "America/New_York",
    defaultBookingMode: "instant",
    checkInTime: "15:00:00",
    checkOutTime: "11:00:00",
    bookingHorizonDays: 365,
    houseRules: null,
    offerings: [],
    ...overrides,
  } as PublicStayDetail;
}

const PALETTE = {
  page: "#0c0e12",
  accent: "#eb7825",
  accentText: "#0c0e12",
  primaryText: "#ffffff",
  secondaryText: "rgba(255,255,255,0.72)",
  tertiaryText: "rgba(255,255,255,0.48)",
  panel: "#14171d",
  panelStrong: "#191d24",
  panelBorder: "#2b3038",
  card: "#14171d",
  cutoutBorder: "#2b3038",
  glass: "rgba(255,255,255,0.06)",
  glassTint: "dark" as const,
  accentWash: "rgba(235,120,37,0.16)",
};

function attrOf(tag: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return match === null ? null : match[1];
}

describe("#1503 E · the emitted <input> bounds match the ORACLE, not just 'are present'", () => {
  test("E1 · min/max on the rendered check-in input equal the server's accept edges", () => {
    const detail = stayDetail({ timezone: "America/Los_Angeles" });
    const cfg: VenueConfig = {
      timezone: detail.timezone,
      checkInTime: detail.checkInTime,
      bookingHorizonDays: detail.bookingHorizonDays,
      maxAdvanceDays: 21,
      minNoticeMinutes: 0,
    };
    const now = new Date(Date.UTC(2026, 7, 4, 1, 0, 0));
    const bounds = boundsFor(cfg, "2026-08-05", now);
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(
        StayDateRangeField as unknown as React.FC<Record<string, unknown>>,
        {
          value: { checkIn: "2026-08-05", checkOut: "2026-08-07" },
          bounds,
          palette: PALETTE,
          onChange: () => undefined,
        },
      ),
    );
    const tags = html.match(/<input\b[^>]*>/g) ?? [];
    expect(tags).toHaveLength(2);
    const [checkInTag, checkOutTag] = tags;
    expect(attrOf(checkInTag, "type")).toBe("date");
    expect(attrOf(checkOutTag, "type")).toBe("date");

    const min = attrOf(checkInTag, "min");
    const max = attrOf(checkInTag, "max");
    expect(min).not.toBeNull();
    expect(max).not.toBeNull();

    // The attribute is the ORACLE's edge — not merely non-empty.
    expect(serverAcceptsCheckIn(cfg, min as string, now)).toBe(true);
    expect(serverAcceptsCheckIn(cfg, addStayDays(min as string, -1), now)).toBe(false);
    expect(serverAcceptsCheckIn(cfg, max as string, now)).toBe(true);
    expect(serverAcceptsCheckIn(cfg, addStayDays(max as string, 1), now)).toBe(false);
    expect(min).toBe("2026-08-03");
    expect(max).toBe("2026-08-24");

    // Check-out is anchored strictly after check-in — one night minimum.
    expect(attrOf(checkOutTag, "min")).toBe("2026-08-06");
    expect(attrOf(checkOutTag, "max")).toBe(addStayDays("2026-08-05", 365));
  });

  test("E2 · the control is the affordance — no hidden-input mechanism sneaks back in", () => {
    const bounds = boundsFor(
      {
        timezone: "America/New_York",
        checkInTime: "15:00:00",
        bookingHorizonDays: 365,
        maxAdvanceDays: null,
        minNoticeMinutes: 0,
      },
      "2026-08-05",
      new Date(Date.UTC(2026, 7, 4, 1, 0, 0)),
    );
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(
        StayDateRangeField as unknown as React.FC<Record<string, unknown>>,
        {
          value: { checkIn: "2026-08-05", checkOut: "2026-08-07" },
          bounds,
          palette: PALETTE,
          onChange: () => undefined,
        },
      ),
    );
    expect(html).toContain('type="date"');
    expect(html).not.toMatch(/opacity:\s*0[;"']/);
    expect(html).not.toMatch(/pointer-events:\s*none/);
    expect(html).not.toContain("showPicker");
    // aria-label is required on BOTH inputs, not just the first.
    expect((html.match(/aria-label="Check-/g) ?? []).length).toBe(2);
  });

  test("E3 · the web twin carries NO native picker import (the .native split holds at source)", () => {
    const webSrc = readFileSync(
      join(REPO_ROOT, "packages/brand-rendering/StayDateRangeField.tsx"),
      "utf8",
    );
    const nativeSrc = readFileSync(
      join(REPO_ROOT, "packages/brand-rendering/StayDateRangeField.native.tsx"),
      "utf8",
    );
    expect(webSrc).not.toContain("@react-native-community/datetimepicker");
    expect(nativeSrc).toContain("@react-native-community/datetimepicker");
    // Both halves must export the same name, or Metro would resolve to a
    // module with no component on one platform.
    expect(webSrc).toContain("export function StayDateRangeField");
    expect(nativeSrc).toContain("export function StayDateRangeField");
    // The native half must render the picker bounded — an unbounded picker
    // would make out-of-range days selectable on iOS/Android only.
    expect(nativeSrc).toContain("minimumDate=");
    expect(nativeSrc).toContain("maximumDate=");
    expect(nativeSrc).toContain("bounds.maxCheckIn");
    expect(nativeSrc).toContain("bounds.minCheckIn");
  });
});

/* ==========================================================================
 * F. BLACKOUTS ARE A DIFFERENT RULE SET
 * ======================================================================== */

describe("#1503 F · venue blackouts keep their own rules", () => {
  const sheetSrc = readFileSync(
    join(REPO_ROOT, "mingla-business/src/components/venue/VenueBlackoutSheet.tsx"),
    "utf8",
  );

  test("F1 · the `To` floor is the START DATE itself, so a single-day blackout stays selectable", () => {
    // The Stay rule is `addStayDays(checkIn, 1)`. Applying it here would make a
    // one-day closure impossible to record.
    expect(sheetSrc).toContain("min={ISO_DATE.test(dateStart) ? dateStart : undefined}");
    expect(sheetSrc).not.toContain("addStayDays(dateStart, 1)");
    expect(sheetSrc).not.toContain("stayDateBounds");
    // The same-day rule itself is untouched.
    expect(sheetSrc).toContain("(dateEnd || dateStart) >= dateStart");
  });

  test("F2 · blackouts have NO past-date floor — operators record historical closures", () => {
    expect(sheetSrc).not.toContain("venueToday");
    const dateFieldUses = sheetSrc.match(/<DateField/g) ?? [];
    expect(dateFieldUses).toHaveLength(2);
    // Neither DateField may carry a `max`, which would cap how far ahead an
    // operator can close the venue.
    expect(sheetSrc).not.toMatch(/<DateField[\s\S]{0,600}?max=/);
  });

  test("F3 · the typed-format crutch is gone from the labels and the error copy", () => {
    // Comments are stripped first (the `stripComments` idiom already used by
    // i-1047-biz-bundle-budget-deferral.mjs). The file header legitimately
    // documents the WIRE format `(YYYY-MM-DD)`, and the change comment names the
    // label it removed — pinning raw text would punish exactly the documentation
    // the SPEC asked for. What must not survive is the format leaking into CODE:
    // a visible label, a placeholder, or the error copy the operator reads.
    const code = sheetSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    // Vacuity guard: stripping must leave the component behind, not blank it.
    expect(code).toContain("export function VenueBlackoutSheet");
    expect(code.length).toBeGreaterThan(2000);

    expect(code).not.toContain("YYYY-MM-DD");
    expect(code).not.toContain("year dash month dash day");
    expect(code).not.toContain('variant="number"');
    expect(code).toContain('label="From"');
    expect(code).toContain('label="To (optional)"');
    expect(code).toContain('testID="venue-blackout-start"');
    expect(code).toContain('testID="venue-blackout-end"');
  });
});
