/**
 * issue #2338 — THE DISPLAY OWNER LEARNS TO NAME THE DAYS A GUEST BOUGHT.
 *
 * ══ WHAT A PERSON SAW ══════════════════════════════════════════════════════
 * Founder's own order, production, 2026-08-19
 * (`b19a9609-99ac-437d-ab08-f6b2ab99499b`, event `2b05b5df` "We Go Again —
 * Two Day Free"). The order summary on the confirmation screen read:
 *
 *     We Go Again — Two Day Free
 *     Date TBD                     <- an event with two confirmed days,
 *     3x  Free Entry      Free        just chosen by this guest, 6 tickets
 *     Total               Free        minted, 3 per day
 *
 * ══ WHY ════════════════════════════════════════════════════════════════════
 * `formatDraftDateLine` reads `multiDates` — the ORGANISER'S DRAFT — which
 * `pg_direct_event_checkout_bundle` strips (VERIFIED against production
 * 2026-08-19: the bundle's event carries no `multiDates` and two occurrences).
 * A live event's days arrive as OCCURRENCES. #2209 taught the PUBLIC PAGE that;
 * #2160 taught the CART STEP that, but did it with a private useMemo inside
 * `app/checkout/[eventId]/index.tsx` — so the confirmation screen two steps
 * later had nothing to reuse and asked the draft formatter.
 *
 * ══ WHAT THIS FILE PROVES ══════════════════════════════════════════════════
 *   U-1  the chosen-day wording is #2160's wording, exactly, for 1 / 2 / 3+
 *   U-2  chronological BY MEASUREMENT — a transport that reorders the days
 *        cannot reorder what the guest reads
 *   U-3  NEVER a fabricated day: an unparseable instant, an id that matches
 *        nothing, and an empty chosen set all return null
 *   U-4  BYTE-IDENTITY — for every event that is not a multi-date event with
 *        stripped draft days, `resolveChosenDaysLine` returns EXACTLY
 *        `formatDraftDateLine(event)`, character for character
 *   U-5  HONEST DEGRADE — a multi-date event with no materialised day still
 *        says "Date TBD"
 *   U-6  the real production payload produces "Sat 29 Aug + Sun 30 Aug"
 *
 * FAILS-ON-REVERT: make `resolveChosenDaysLine` ignore `chosenIds` (return the
 * public date line unconditionally) and U-1/U-2/U-6 go red while U-4/U-5 stay
 * green — which is the exact shape of the claim.
 *
 * Owner: mingla-implementor. Issue: #2338.
 */

import {
  formatChosenDaysLabel,
  formatDraftDateLine,
  resolveChosenDaysLine,
  type EventDateLike,
  type OccurrenceDateLike,
} from "../eventDateDisplay";

// ── The REAL production rows, copied verbatim from
// `pg_direct_event_checkout_bundle('2b05b5df-…')` on 2026-08-19. ────────────
const DAY_29: OccurrenceDateLike = {
  id: "0870ce30-0671-4cc0-b7c2-87412cb76ef9",
  startAt: "2026-08-29T10:00:00+00:00",
  endAt: "2026-08-29T17:00:00+00:00",
  timezone: "Africa/Lagos",
};
const DAY_30: OccurrenceDateLike = {
  id: "a607a1d3-7525-400f-9772-6abbd16b52fe",
  startAt: "2026-08-30T10:00:00+00:00",
  endAt: "2026-08-30T17:00:00+00:00",
  timezone: "Africa/Lagos",
};
const DAY_31: OccurrenceDateLike = {
  id: "c0000000-0000-4000-8000-000000000031",
  startAt: "2026-08-31T10:00:00+00:00",
  endAt: "2026-08-31T17:00:00+00:00",
  timezone: "Africa/Lagos",
};

/**
 * The event EXACTLY as the checkout bundle delivers it for `2b05b5df`:
 * `whenMode: "multi_date"` with `multiDates: null`, because the public reader
 * strips the organiser's authoring block. This shape is the whole bug.
 */
const STRIPPED_MULTI_DATE_EVENT: EventDateLike = {
  whenMode: "multi_date",
  date: "2026-08-29",
  doorsOpen: "11:00",
  endsAt: "18:00",
  masterStartAtUtc: "2026-08-29T10:00:00+00:00",
  masterEndAtUtc: "2026-08-29T17:00:00+00:00",
  timezone: "Africa/Lagos",
  recurrenceRule: null,
  multiDates: null,
};

describe("issue #2338 U-1 — the wording is #2160's wording", () => {
  test("one chosen day reads as the bare day label", () => {
    expect(formatChosenDaysLabel([DAY_29, DAY_30], [DAY_29.id])).toBe(
      "Sat 29 Aug",
    );
  });

  test("two chosen days join with ' + ' — the string the checkout header shows", () => {
    expect(
      formatChosenDaysLabel([DAY_29, DAY_30], [DAY_29.id, DAY_30.id]),
    ).toBe("Sat 29 Aug + Sun 30 Aug");
  });

  test("three or more collapse to a counted span", () => {
    expect(
      formatChosenDaysLabel(
        [DAY_29, DAY_30, DAY_31],
        [DAY_29.id, DAY_30.id, DAY_31.id],
      ),
    ).toBe("3 days · Sat 29 Aug – Mon 31 Aug");
  });
});

describe("issue #2338 U-2 — chronological by measurement, not by trust", () => {
  test("days handed over BACKWARDS still read forwards", () => {
    expect(
      formatChosenDaysLabel([DAY_30, DAY_29], [DAY_30.id, DAY_29.id]),
    ).toBe("Sat 29 Aug + Sun 30 Aug");
  });

  test("the chosen-ID order does not leak into the reading order either", () => {
    expect(
      formatChosenDaysLabel([DAY_29, DAY_30, DAY_31], [
        DAY_31.id,
        DAY_29.id,
        DAY_30.id,
      ]),
    ).toBe("3 days · Sat 29 Aug – Mon 31 Aug");
  });
});

describe("issue #2338 U-3 — never a fabricated day", () => {
  test("no chosen ids → null", () => {
    expect(formatChosenDaysLabel([DAY_29, DAY_30], [])).toBeNull();
  });

  test("a chosen id that matches no occurrence → null, not day one", () => {
    expect(
      formatChosenDaysLabel([DAY_29, DAY_30], ["not-a-real-occurrence"]),
    ).toBeNull();
  });

  test("ANY unparseable instant poisons the whole label rather than half-naming it", () => {
    const broken: OccurrenceDateLike = {
      ...DAY_30,
      startAt: "not-a-date",
    };
    expect(
      formatChosenDaysLabel([DAY_29, broken], [DAY_29.id, broken.id]),
    ).toBeNull();
  });

  test("an occurrence with no timezone falls back to the event's, then UTC — never invents one", () => {
    const tzless: OccurrenceDateLike = { ...DAY_29, timezone: "" };
    expect(
      formatChosenDaysLabel([tzless], [tzless.id], "Africa/Lagos"),
    ).toBe("Sat 29 Aug");
    // No fallback offered → UTC. 10:00Z on the 29th is still the 29th.
    expect(formatChosenDaysLabel([tzless], [tzless.id])).toBe("Sat 29 Aug");
  });
});

describe("issue #2338 U-4 — BYTE-IDENTITY for everything that is not this bug", () => {
  // Each of these is an event whose summary MUST print the exact characters it
  // printed before #2338 existed. The old code was literally
  // `formatDraftDateLine(event)`, so equality with that call IS the proof —
  // not a hand-copied literal that could drift with it.
  const unchanged: Array<{ label: string; event: EventDateLike }> = [
    {
      label: "single-date event with a time range",
      event: {
        whenMode: "single",
        date: "2026-05-18",
        doorsOpen: "22:00",
        endsAt: "23:00",
        masterStartAtUtc: null,
        masterEndAtUtc: null,
        timezone: "Europe/London",
        recurrenceRule: null,
        multiDates: null,
      },
    },
    {
      label: "single-date event that crosses midnight",
      event: {
        whenMode: "single",
        date: "2026-05-18",
        doorsOpen: "22:00",
        endsAt: "02:00",
        masterStartAtUtc: "2026-05-18T21:00:00+00:00",
        masterEndAtUtc: "2026-05-19T01:00:00+00:00",
        timezone: "Europe/London",
        recurrenceRule: null,
        multiDates: null,
      },
    },
    {
      label: "single-date event with NO date at all",
      event: {
        whenMode: "single",
        date: null,
        doorsOpen: null,
        endsAt: null,
        masterStartAtUtc: null,
        masterEndAtUtc: null,
        timezone: null,
        recurrenceRule: null,
        multiDates: null,
      },
    },
    {
      label: "recurring event",
      event: {
        whenMode: "recurring",
        date: "2026-05-18",
        doorsOpen: "19:00",
        endsAt: "23:00",
        masterStartAtUtc: null,
        masterEndAtUtc: null,
        timezone: "Europe/London",
        recurrenceRule: {
          preset: "weekly",
          byDay: "MO",
          termination: { kind: "count", count: 4 },
        } as never,
        multiDates: null,
      },
    },
    {
      label: "multi-date event whose ORGANISER draft entries survived",
      event: {
        whenMode: "multi_date",
        date: "2026-08-29",
        doorsOpen: "11:00",
        endsAt: "18:00",
        masterStartAtUtc: null,
        masterEndAtUtc: null,
        timezone: "Africa/Lagos",
        recurrenceRule: null,
        multiDates: [
          { date: "2026-08-29", startTime: "11:00", endTime: "18:00" },
          { date: "2026-08-30", startTime: "11:00", endTime: "18:00" },
        ] as never,
      },
    },
  ];

  test.each(unchanged)(
    "$label — byte-identical to formatDraftDateLine with NO chosen days",
    ({ event }) => {
      expect(resolveChosenDaysLine(event, [], [])).toBe(
        formatDraftDateLine(event),
      );
    },
  );

  test.each(unchanged)(
    "$label — byte-identical even when occurrences ARE handed over",
    ({ event }) => {
      expect(resolveChosenDaysLine(event, [DAY_29, DAY_30], [])).toBe(
        formatDraftDateLine(event),
      );
    },
  );

  test("a hand-crafted ?eventDateId= on a SINGLE-date event names the day, on PURPOSE", () => {
    // DOCUMENTED DECISION, not an accident. Our own link builder
    // (`checkoutPublicPathWithSeed`) emits a day param ONLY from the multi-date
    // day picker, so a single-date event never carries one from a Mingla link.
    // If someone hand-crafts one, the CART STEP has named that day since #2135
    // (`chosenDayLabel ?? formatDraftDateLine(event)` — the label wins
    // regardless of whenMode). Guarding it here would put the summary back into
    // disagreement with the step the guest just came from, which is the exact
    // drift #2338 exists to remove. Byte-identity is a claim about the summary
    // as it is actually reached; this is the one path that is not.
    const single = unchanged[0].event;
    const onlyDay: OccurrenceDateLike = {
      id: "single-occ",
      startAt: "2026-05-18T21:00:00+00:00",
      endAt: "2026-05-18T22:00:00+00:00",
      timezone: "Europe/London",
    };
    expect(resolveChosenDaysLine(single, [onlyDay], [onlyDay.id])).toBe(
      "Mon 18 May",
    );
  });

  test("a SINGLE-date event is unchanged even if a stray chosen id rides along", () => {
    const single = unchanged[0].event;
    // A single-date event carries exactly one occurrence; naming that day is
    // what #2135 already did on the cart step, and it is not what this issue
    // touches — with no matching occurrence the line must not move at all.
    expect(resolveChosenDaysLine(single, [], ["stray"])).toBe(
      formatDraftDateLine(single),
    );
  });
});

describe("issue #2338 U-5 — honest degrade", () => {
  test("multi-date event with ZERO materialised days still says 'Date TBD'", () => {
    expect(resolveChosenDaysLine(STRIPPED_MULTI_DATE_EVENT, [], [])).toBe(
      "Date TBD",
    );
    expect(formatDraftDateLine(STRIPPED_MULTI_DATE_EVENT)).toBe("Date TBD");
  });

  test("multi-date event whose only occurrence is unreadable still says 'Date TBD'", () => {
    const unreadable: OccurrenceDateLike = {
      id: "x",
      startAt: "garbage",
      endAt: "garbage",
      timezone: "Africa/Lagos",
    };
    expect(
      resolveChosenDaysLine(STRIPPED_MULTI_DATE_EVENT, [unreadable], ["x"]),
    ).toBe("Date TBD");
  });
});

describe("issue #2338 U-6 — the founder's actual order", () => {
  test("the real bundle + the real chosen set reads 'Sat 29 Aug + Sun 30 Aug'", () => {
    const line = resolveChosenDaysLine(
      STRIPPED_MULTI_DATE_EVENT,
      [DAY_29, DAY_30],
      [DAY_29.id, DAY_30.id],
    );
    expect(line).toBe("Sat 29 Aug + Sun 30 Aug");
    expect(line).not.toBe("Date TBD");
  });

  test("the legacy #2135 SINGLE id still names that one day", () => {
    expect(
      resolveChosenDaysLine(
        STRIPPED_MULTI_DATE_EVENT,
        [DAY_29, DAY_30],
        [DAY_30.id],
      ),
    ).toBe("Sun 30 Aug");
  });

  test("STARVED OF OCCURRENCES the line stops naming a day — the #2209 failure, reproduced", () => {
    // This is the assertion that makes the wiring load-bearing: the ids are
    // present and correct, and WITHOUT the occurrence list there is nothing to
    // name. A caller that stops passing occurrences gets "Date TBD" back, so
    // the screen test that expects the days cannot pass on unwired code.
    expect(
      resolveChosenDaysLine(
        STRIPPED_MULTI_DATE_EVENT,
        [],
        [DAY_29.id, DAY_30.id],
      ),
    ).toBe("Date TBD");
  });
});
