/**
 * issue #1562 [hours-and-price], step 6 of #1550 — THE CLOCK, FAKED ON PURPOSE.
 *
 * WHY THIS FILE IS SEPARATE FROM THE RENDER PROOF. "Open now" is a claim about
 * a MOMENT. A test that reads the real clock can only ever exercise whichever
 * arm happens to be true while it runs, and would flip colour at 09:00 and
 * 17:00 every day — the V8 date-rolling trap this repo has a standing memory
 * about. So every case below passes an EXPLICIT `now`, and the resolver takes
 * `now` as a parameter precisely so that is possible. Nothing here calls
 * `Date.now()`.
 *
 * WHAT EACH GROUP WOULD CATCH, stated so no test here can be mistaken for
 * decoration:
 *
 *   TZ        a resolver that read the MACHINE's zone instead of the venue's
 *             would place the same instant on a different weekday and a
 *             different hour. Every case names a zone the CI runner is not in,
 *             and two cases put the same instant in two zones and require the
 *             answers to DIFFER — which is impossible for an implementation
 *             that ignores the parameter.
 *   BOUNDARY  `open <= now < close`. Asserted at four minutes: one before open
 *             (closed), open exactly (OPEN), one before close (open), close
 *             exactly (CLOSED). An off-by-one at either end changes exactly one
 *             of the four.
 *   OVERNIGHT a bar open 21:00–02:00 has `close <= open`. At 01:00 Saturday it
 *             is open on FRIDAY's row. An implementation that compares within
 *             one day reports Closed and fails here.
 *   MULTI     two ranges on one weekday (lunch + dinner). The gap between them
 *             must read Closed with the DINNER opening as the next one.
 *   ABSENCE   no hours ⇒ unknown (claims nothing); all-closed ⇒ closed (claims
 *             something we actually know). Conflating the two is the failure
 *             this distinction exists to prevent.
 *   FAILSAFE  a zone `Intl` rejects, a blank zone, `undefined` (the shape a
 *             pre-migration payload has) — all unknown, none throwing.
 *
 * VACUITY GUARDS. Several cases assert a NEGATIVE ("not open"). Each is paired
 * with a positive control on the SAME fixture at a different instant, so "not
 * open" can never pass because the fixture was empty or the resolver was
 * returning `unknown` for everything. The DST group additionally asserts that
 * two readings DIFFER, which no constant-returning implementation can satisfy.
 *
 * APPEND-ONLY — new file; modifies/deletes no existing test.
 *
 * Run:
 *   cd mingla-business && npx jest venueOpenState.issue1562 --runInBand
 */
import { describe, expect, test } from "@jest/globals";

import {
  isIanaZoneName,
  resolveVenueOpenState,
  venueClockLabel,
  venueClockMinutes,
  venueLocalClock,
  venueOpenStateLine,
  VENUE_WEEKDAY_LABELS,
  type VenueHourRow,
} from "@mingla/brand-rendering/venueOpenState";

// ---------------------------------------------------------------------------
// Fixtures. `weekday` is 0 = Monday, matching `brand_hours`.
// ---------------------------------------------------------------------------

const row = (
  weekday: number,
  openTime: string | null,
  closeTime: string | null,
): VenueHourRow => ({
  weekday,
  openTime,
  closeTime,
  isClosed: openTime === null,
});

/** Mon–Fri 09:00–17:00, Sat 10:00–23:00, Sun closed. */
const WEEKDAY_HOURS: VenueHourRow[] = [
  row(0, "09:00", "17:00"),
  row(1, "09:00", "17:00"),
  row(2, "09:00", "17:00"),
  row(3, "09:00", "17:00"),
  row(4, "09:00", "17:00"),
  row(5, "10:00", "23:00"),
  row(6, null, null),
];

/** Every day closed — a venue we KNOW is shut, not one we know nothing about. */
const ALL_CLOSED: VenueHourRow[] = [0, 1, 2, 3, 4, 5, 6].map((d) =>
  row(d, null, null),
);

const NY = "America/New_York";
const LAGOS = "Africa/Lagos";
const TOKYO = "Asia/Tokyo";

/**
 * A UTC instant, written as an ISO string so every case states the moment it
 * is testing in one readable place. `Date.UTC` avoids the local-parse ambiguity
 * that bare `new Date("2026-08-05 09:00")` has across engines.
 */
const utc = (iso: string): Date => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`the fixture instant "${iso}" is not a date`);
  }
  return parsed;
};

// ---------------------------------------------------------------------------

describe("#1562 — the venue's clock, not the visitor's", () => {
  /**
   * THE HEADLINE CASE. One instant, two venues, two different answers. An
   * implementation that read the machine's zone (or ignored `timeZone`) would
   * give the SAME answer twice, so the inequality below is the assertion that
   * cannot be satisfied by accident.
   */
  test("ONE instant, two zones, two different answers", () => {
    expect.assertions(5);
    // 2026-08-05 is a Wednesday. 21:00 UTC is 17:00 in New York (EDT, UTC-4)
    // and 22:00 in Lagos (WAT, UTC+1).
    const instant = utc("2026-08-05T21:00:00Z");

    const newYork = resolveVenueOpenState({
      hours: WEEKDAY_HOURS,
      timeZone: NY,
      now: instant,
    });
    const lagos = resolveVenueOpenState({
      hours: WEEKDAY_HOURS,
      timeZone: LAGOS,
      now: instant,
    });

    // New York: exactly 17:00 on a Wednesday — the CLOSING minute, so shut,
    // and the next opening is Thursday 09:00.
    expect(newYork.status).toBe("opensLater");
    expect(newYork.opensAt).toBe("09:00");
    // Lagos: 22:00 on the same Wednesday — also shut, same next opening.
    expect(lagos.status).toBe("opensLater");
    expect(lagos.opensAt).toBe("09:00");
    // …and the two venues are on DIFFERENT weekdays' clocks at other instants,
    // which is the property no zone-ignoring implementation can produce.
    const tokyo = resolveVenueOpenState({
      hours: WEEKDAY_HOURS,
      // 21:00 UTC Wednesday is 06:00 THURSDAY in Tokyo (UTC+9).
      timeZone: TOKYO,
      now: instant,
    });
    expect([newYork.weekday, tokyo.weekday]).toEqual([2, 3]);
  });

  test("DST is the platform's problem, and the platform solves it", () => {
    expect.assertions(3);
    // 14:00 UTC. In New York that is 10:00 in AUGUST (EDT, UTC-4) and 09:00 in
    // JANUARY (EST, UTC-5). A fixed-offset implementation gets one of them
    // wrong by an hour, which is the exact defect ORCH-1148 P3-3 fixed in the
    // availability engine and the reason the tz is IANA rather than a number.
    const summer = venueLocalClock(utc("2026-08-05T14:00:00Z"), NY);
    const winter = venueLocalClock(utc("2026-01-07T14:00:00Z"), NY);
    if (summer === null || winter === null) {
      throw new Error(
        "Intl refused America/New_York — the whole open-now feature is " +
          "unavailable on this runtime and every case below is meaningless",
      );
    }
    expect(summer.minutes).toBe(10 * 60);
    expect(winter.minutes).toBe(9 * 60);
    // …and they differ, so neither reading is a constant.
    expect(summer.minutes).not.toBe(winter.minutes);
  });
});

describe("#1562 — the boundary minute, at both ends", () => {
  /**
   * Four instants around one 09:00–17:00 Wednesday. The contract is
   * `open <= now < close`: the opening minute IS open, the closing minute is
   * NOT. Each row states the instant, the venue-local time it lands on, and
   * the status it must produce.
   */
  const cases: { iso: string; local: string; status: string }[] = [
    { iso: "2026-08-05T12:59:00Z", local: "08:59", status: "opensLater" },
    { iso: "2026-08-05T13:00:00Z", local: "09:00", status: "open" },
    { iso: "2026-08-05T20:59:00Z", local: "16:59", status: "open" },
    { iso: "2026-08-05T21:00:00Z", local: "17:00", status: "opensLater" },
  ];

  test.each(cases)(
    "at $local New York time the venue is $status",
    ({ iso, local, status }) => {
      expect.assertions(2);
      const state = resolveVenueOpenState({
        hours: WEEKDAY_HOURS,
        timeZone: NY,
        now: utc(iso),
      });
      // Positive control on the SAME instant: the resolver really did read this
      // clock, so a `status` assertion cannot pass against an unknown state.
      const clock = venueLocalClock(utc(iso), NY);
      expect(clock === null ? "unresolved" : venueClockLabel(clock.minutes)).toBe(
        local,
      );
      expect(state.status).toBe(status);
    },
  );

  test("the open minute and the close minute disagree — the guard is real", () => {
    expect.assertions(2);
    const atOpen = resolveVenueOpenState({
      hours: WEEKDAY_HOURS,
      timeZone: NY,
      now: utc("2026-08-05T13:00:00Z"),
    });
    const atClose = resolveVenueOpenState({
      hours: WEEKDAY_HOURS,
      timeZone: NY,
      now: utc("2026-08-05T21:00:00Z"),
    });
    expect(atOpen.status).toBe("open");
    // If the comparison were `<=` at both ends these would be equal.
    expect(atClose.status).not.toBe(atOpen.status);
  });
});

describe("#1562 — a span that crosses midnight", () => {
  /** A bar: Friday 21:00 → 02:00, Saturday 21:00 → 02:00. */
  const BAR: VenueHourRow[] = [
    row(4, "21:00", "02:00"),
    row(5, "21:00", "02:00"),
  ];

  test("01:00 on Saturday is OPEN, on Friday's row", () => {
    expect.assertions(3);
    // 2026-08-08 is a Saturday. 05:00 UTC = 01:00 New York.
    const state = resolveVenueOpenState({
      hours: BAR,
      timeZone: NY,
      now: utc("2026-08-08T05:00:00Z"),
    });
    expect(state.status).toBe("open");
    expect(state.closesAt).toBe("02:00");
    // The span began on the PREVIOUS venue-day; that is what `overnight` says.
    expect(state.overnight).toBe(true);
  });

  test("03:00 on Saturday is CLOSED — the span really did end", () => {
    expect.assertions(2);
    const state = resolveVenueOpenState({
      hours: BAR,
      timeZone: NY,
      now: utc("2026-08-08T07:00:00Z"),
    });
    expect(state.status).toBe("opensLater");
    // …and it reopens the same venue-day at 21:00, so the day is not named.
    expect(state.opensAt).toBe("21:00");
  });

  test("SUNDAY 01:00 is open on SATURDAY's span — the week wraps", () => {
    expect.assertions(2);
    // 2026-08-09 is a Sunday; 05:00 UTC = 01:00 New York. Saturday's span runs
    // to Sunday 02:00, which lies PAST the end of the Mon..Sun ring. An
    // implementation that does not test the wrap reports Closed here.
    const state = resolveVenueOpenState({
      hours: BAR,
      timeZone: NY,
      now: utc("2026-08-09T05:00:00Z"),
    });
    expect(state.status).toBe("open");
    expect(state.overnight).toBe(true);
  });

  test("open == close is read as a full 24 hours", () => {
    expect.assertions(1);
    const state = resolveVenueOpenState({
      hours: [0, 1, 2, 3, 4, 5, 6].map((d) => row(d, "00:00", "00:00")),
      timeZone: TOKYO,
      now: utc("2026-08-05T14:23:00Z"),
    });
    expect(state.status).toBe("open");
  });
});

describe("#1562 — more than one range in a day", () => {
  /**
   * Lunch 12:00–14:30 and dinner 18:00–23:00 on the same Wednesday.
   *
   * `brand_hours` carries a UNIQUE (venue_id, weekday) index today, so the
   * second row cannot currently exist in the database. It is designed for
   * anyway: the wire column is a jsonb ARRAY, `parseClaimedVenueHours` does not
   * dedupe, and a lunch/dinner split is the obvious next schema move. Union-ing
   * costs one loop; discovering the gap in production costs a release.
   */
  const SPLIT: VenueHourRow[] = [
    row(2, "12:00", "14:30"),
    row(2, "18:00", "23:00"),
  ];

  test("inside lunch: open, closing at 14:30", () => {
    expect.assertions(2);
    const state = resolveVenueOpenState({
      hours: SPLIT,
      timeZone: NY,
      now: utc("2026-08-05T17:00:00Z"), // 13:00 New York
    });
    expect(state.status).toBe("open");
    expect(state.closesAt).toBe("14:30");
  });

  test("in the AFTERNOON GAP: closed, and dinner is the next opening", () => {
    expect.assertions(2);
    const state = resolveVenueOpenState({
      hours: SPLIT,
      timeZone: NY,
      now: utc("2026-08-05T20:00:00Z"), // 16:00 New York
    });
    expect(state.status).toBe("opensLater");
    // The gap is only visible to an implementation that kept BOTH rows. One
    // that overwrote by weekday reports 12:00 (it kept lunch) or is open
    // (it kept dinner and mis-tested).
    expect(state.opensAt).toBe("18:00");
  });

  test("inside dinner: open again on the same day", () => {
    expect.assertions(2);
    const state = resolveVenueOpenState({
      hours: SPLIT,
      timeZone: NY,
      now: utc("2026-08-05T23:00:00Z"), // 19:00 New York
    });
    expect(state.status).toBe("open");
    expect(state.closesAt).toBe("23:00");
  });
});

describe("#1562 — absence is not closure", () => {
  test("NO hours at all ⇒ unknown, and the page claims nothing", () => {
    expect.assertions(3);
    const state = resolveVenueOpenState({
      hours: [],
      timeZone: NY,
      now: utc("2026-08-05T17:00:00Z"),
    });
    expect(state.status).toBe("unknown");
    // The venue's weekday IS known (the zone resolved) — only its hours are not.
    expect(state.weekday).toBe(2);
    expect(venueOpenStateLine(state)).toBeNull();
  });

  test("EVERY day closed ⇒ closed, which is a fact we hold", () => {
    expect.assertions(2);
    const state = resolveVenueOpenState({
      hours: ALL_CLOSED,
      timeZone: NY,
      now: utc("2026-08-05T17:00:00Z"),
    });
    expect(state.status).toBe("closed");
    expect(venueOpenStateLine(state)).toBe("Closed");
  });

  test("the two are NOT the same state — conflating them is the bug", () => {
    expect.assertions(1);
    const noHours = resolveVenueOpenState({
      hours: [],
      timeZone: NY,
      now: utc("2026-08-05T17:00:00Z"),
    });
    const allClosed = resolveVenueOpenState({
      hours: ALL_CLOSED,
      timeZone: NY,
      now: utc("2026-08-05T17:00:00Z"),
    });
    expect(noHours.status).not.toBe(allClosed.status);
  });

  test("SUNDAY closed, Monday named — the next opening crosses a day", () => {
    expect.assertions(3);
    // 2026-08-09 is a Sunday. 16:00 UTC = 12:00 New York.
    const state = resolveVenueOpenState({
      hours: WEEKDAY_HOURS,
      timeZone: NY,
      now: utc("2026-08-09T16:00:00Z"),
    });
    expect(state.status).toBe("opensLater");
    expect(state.opensAt).toBe("09:00");
    // It is NOT today, so the day is named — and Monday is index 0.
    expect(state.opensWeekday).toBe(0);
  });

  test("later the SAME day, the day is NOT named", () => {
    expect.assertions(2);
    // Wednesday 08:00 New York — opens at 09:00 today.
    const state = resolveVenueOpenState({
      hours: WEEKDAY_HOURS,
      timeZone: NY,
      now: utc("2026-08-05T12:00:00Z"),
    });
    expect(state.opensAt).toBe("09:00");
    expect(state.opensWeekday).toBeNull();
  });
});

describe("#1562 — fail-safe, never fail-loud", () => {
  const badZones: { label: string; zone: string | null | undefined }[] = [
    { label: "a zone Intl rejects", zone: "Mars/Olympus_Mons" },
    { label: "an offset, colon form", zone: "-05:00" },
    { label: "an offset, positive", zone: "+05:00" },
    { label: "an offset, compact", zone: "-0500" },
    { label: "an offset, hour only", zone: "+09" },
    { label: "a bare clock", zone: "05:00" },
    { label: "Z", zone: "Z" },
    { label: "blank", zone: "   " },
    { label: "empty", zone: "" },
    { label: "null", zone: null },
    // The shape a client gets from a deployment whose view predates the #1562
    // migration: the key is simply not on the row.
    { label: "undefined (pre-migration payload)", zone: undefined },
  ];

  test.each(badZones)("$label ⇒ unknown, no throw", ({ zone }) => {
    expect.assertions(3);
    let state: ReturnType<typeof resolveVenueOpenState> | null = null;
    expect(() => {
      state = resolveVenueOpenState({
        hours: WEEKDAY_HOURS,
        timeZone: zone,
        now: utc("2026-08-05T17:00:00Z"),
      });
    }).not.toThrow();
    if (state === null) throw new Error("the resolver returned nothing at all");
    const resolved: { status: string; weekday: number | null } = state;
    expect(resolved.status).toBe("unknown");
    expect(resolved.weekday).toBeNull();
  });

  test("POSITIVE CONTROL: the same fixture with a GOOD zone is not unknown", () => {
    expect.assertions(1);
    // Without this, every assertion above would pass against a resolver that
    // returned `unknown` unconditionally.
    const state = resolveVenueOpenState({
      hours: WEEKDAY_HOURS,
      timeZone: NY,
      now: utc("2026-08-05T17:00:00Z"),
    });
    expect(state.status).not.toBe("unknown");
  });

  /**
   * THE PROPERTY, NOT ONE ENGINE'S OPINION.
   *
   * This test previously asserted that `"-05:00"` RESOLVES, because the local
   * Node build's ICU accepts it. CI's ICU does not, and the suite went red —
   * which was the correct outcome, because the red was not a bad expectation,
   * it was a real defect showing through: with the question left to `Intl`, the
   * SAME venue row rendered "Open" on one runtime and "unknown" on another.
   * Offset time zones entered ICU late, so the answer tracks the runtime's ICU
   * version, and Hermes on device is a third engine again.
   *
   * Pinning the assertion to `"unknown"` would have hidden that just as well as
   * pinning it to `"open"` did — it would only have encoded whichever engine
   * ran last. So this asserts the INVARIANT instead: whatever this engine's
   * `Intl` happens to think of an offset string, the resolver's answer is the
   * same one, and it is the same as its answer for a zone that plainly does not
   * exist. That statement is true on a tolerant ICU and on a strict one, which
   * is precisely what makes it worth asserting.
   */
  test("an offset is refused identically on EVERY engine, whatever Intl tolerates", () => {
    expect.assertions(4);
    // Probe what THIS runtime's ICU does. Recorded, never asserted — the point
    // is that the product does not care.
    let intlToleratesOffsets: boolean;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: "-05:00" }).format(new Date());
      intlToleratesOffsets = true;
    } catch {
      intlToleratesOffsets = false;
    }
    expect(typeof intlToleratesOffsets).toBe("boolean");

    const forOffset = resolveVenueOpenState({
      hours: WEEKDAY_HOURS,
      timeZone: "-05:00",
      now: utc("2026-08-05T17:00:00Z"),
    });
    const forNonsense = resolveVenueOpenState({
      hours: WEEKDAY_HOURS,
      timeZone: "Mars/Olympus_Mons",
      now: utc("2026-08-05T17:00:00Z"),
    });
    // An offset is treated exactly like a zone that does not exist, on both a
    // tolerant ICU and a strict one.
    expect(forOffset.status).toBe(forNonsense.status);
    expect(forOffset.status).toBe("unknown");
    // POSITIVE CONTROL on the same runtime: a real IANA NAME still resolves, so
    // the two `unknown`s above are the offset rule and not a dead resolver.
    expect(
      resolveVenueOpenState({
        hours: WEEKDAY_HOURS,
        timeZone: NY,
        now: utc("2026-08-05T17:00:00Z"),
      }).status,
    ).not.toBe("unknown");
  });

  /**
   * THE MECHANISM, asserted rather than inferred.
   *
   * The test above shows the ANSWER is the same on a tolerant and a strict ICU.
   * This shows WHY it cannot differ: for an offset string the engine is never
   * consulted at all. No ICU is asked, so no ICU version can have an opinion —
   * which is a stronger guarantee than "every ICU we have tried agrees".
   */
  test("for an offset, Intl is never even constructed", () => {
    expect.assertions(3);
    const RealDateTimeFormat = Intl.DateTimeFormat;
    const zonesAsked: unknown[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Intl as any).DateTimeFormat = function (
      locale?: string,
      options?: Intl.DateTimeFormatOptions,
    ) {
      zonesAsked.push(options?.timeZone);
      return new (RealDateTimeFormat as unknown as new (
        l?: string,
        o?: Intl.DateTimeFormatOptions,
      ) => Intl.DateTimeFormat)(locale, options);
    };
    try {
      resolveVenueOpenState({
        hours: WEEKDAY_HOURS,
        timeZone: "-05:00",
        now: utc("2026-08-05T17:00:00Z"),
      });
      expect(zonesAsked).toEqual([]);
      // POSITIVE CONTROL: the spy really is installed and really does record —
      // otherwise the empty array above would be vacuously true.
      resolveVenueOpenState({
        hours: WEEKDAY_HOURS,
        timeZone: NY,
        now: utc("2026-08-05T17:00:00Z"),
      });
      expect(zonesAsked).toEqual([NY]);
      expect(zonesAsked).toHaveLength(1);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Intl as any).DateTimeFormat = RealDateTimeFormat;
    }
  });

  /**
   * AND REFUSING IS RIGHT ON THE MERITS, not merely convenient for determinism.
   * An offset cannot express DST: `-05:00` IS New York in January and is an
   * hour WRONG in July. Accepting one would publish "Open until 17:00" an hour
   * out for half the year — a confident wrong answer, which is the failure
   * class this whole file exists to end.
   */
  test("the same zone as a NAME moves with DST; as an offset it could not", () => {
    expect.assertions(3);
    const summer = venueLocalClock(utc("2026-08-05T14:00:00Z"), NY);
    const winter = venueLocalClock(utc("2026-01-07T14:00:00Z"), NY);
    if (summer === null || winter === null) {
      throw new Error("Intl refused America/New_York — nothing below is meaningful");
    }
    // One hour apart for the same wall instant: that difference is exactly what
    // a fixed offset throws away.
    expect(summer.minutes - winter.minutes).toBe(60);
    // The name is accepted; the offset that equals it for HALF the year is not.
    expect(isIanaZoneName("America/New_York")).toBe(true);
    expect(isIanaZoneName("-05:00")).toBe(false);
  });

  /**
   * The acceptance rule, stated directly. `UTC` matters most: it is the
   * column's own `NOT NULL DEFAULT`, so a gate that rejected it would blank the
   * feature for every venue nobody has configured yet — which today is all of
   * them (#1586).
   */
  test("the zone-name rule accepts every shape the system actually produces", () => {
    expect.assertions(2);
    const accepted = [
      "UTC",
      "GMT",
      "America/New_York",
      "America/Los_Angeles",
      "Europe/London",
      "Africa/Lagos",
      "Asia/Tokyo",
      "America/Argentina/Buenos_Aires",
      "Pacific/Honolulu",
    ];
    const refused = ["-05:00", "+05:00", "-0500", "+09", "05:00", "Z", "", "  ", "300"];
    expect(accepted.filter((z) => !isIanaZoneName(z))).toEqual([]);
    expect(refused.filter((z) => isIanaZoneName(z))).toEqual([]);
  });

  test("an invalid `now` yields unknown rather than NaN arithmetic", () => {
    expect.assertions(1);
    expect(venueLocalClock(new Date("not a date"), NY)).toBeNull();
  });

  test("a row whose times are not clocks is DROPPED, never coerced to 0", () => {
    expect.assertions(2);
    // "0" would place the opening at midnight and produce a confident, wrong
    // "Open now" for the whole morning.
    expect(venueClockMinutes("open")).toBeNull();
    const state = resolveVenueOpenState({
      hours: [{ weekday: 2, openTime: "open", closeTime: "late", isClosed: false }],
      timeZone: NY,
      now: utc("2026-08-05T05:00:00Z"), // 01:00 New York
    });
    expect(state.status).toBe("closed");
  });
});

describe("#1562 — the copy every surface shares", () => {
  test("each status renders the line the design specifies", () => {
    expect.assertions(4);
    const open = resolveVenueOpenState({
      hours: WEEKDAY_HOURS,
      timeZone: NY,
      now: utc("2026-08-05T17:00:00Z"), // Wed 13:00
    });
    const laterToday = resolveVenueOpenState({
      hours: WEEKDAY_HOURS,
      timeZone: NY,
      now: utc("2026-08-05T12:00:00Z"), // Wed 08:00
    });
    const anotherDay = resolveVenueOpenState({
      hours: WEEKDAY_HOURS,
      timeZone: NY,
      now: utc("2026-08-09T16:00:00Z"), // Sun 12:00
    });
    expect(venueOpenStateLine(open)).toBe("Open now · until 17:00");
    expect(venueOpenStateLine(laterToday)).toBe("Closed · opens 09:00");
    expect(venueOpenStateLine(anotherDay)).toBe("Closed · opens Mon 09:00");
    // The weekday names come from ONE array, shared with the week table.
    expect(VENUE_WEEKDAY_LABELS[0]).toBe("Mon");
  });

  test("an unknown state states the caller's row only when it HAS one", () => {
    expect.assertions(2);
    const unknown = resolveVenueOpenState({
      hours: [],
      timeZone: null,
      now: utc("2026-08-05T17:00:00Z"),
    });
    // No row ⇒ nothing at all. This is what the real page passes, because the
    // venue-local weekday is unresolvable exactly when the zone is.
    expect(venueOpenStateLine(unknown, null)).toBeNull();
    // A caller that DOES hold a row may state it, with no claim about now.
    expect(
      venueOpenStateLine(unknown, {
        openTime: "09:00",
        closeTime: "17:00",
        isClosed: false,
      }),
    ).toBe("Today · 09:00–17:00");
  });

  test("clock formatting round-trips and pads", () => {
    expect.assertions(4);
    expect(venueClockLabel(9 * 60)).toBe("09:00");
    expect(venueClockLabel(23 * 60 + 59)).toBe("23:59");
    // A span extended past midnight carries minutes >= 1440; the label wraps.
    expect(venueClockLabel(26 * 60)).toBe("02:00");
    expect(venueClockMinutes("15:00:00")).toBe(15 * 60);
  });
});
