// issue #2347 — A MULTI-DAY GUEST IS SHOWN THE WRONG DAY'S PASS, STAMPED
// "Valid", AND IS REFUSED AT THE DOOR.
//
// ── THE DEFECT ─────────────────────────────────────────────────────────────
// `calendarService.fetchUserBusinessEventOrders` split a multi-day order into
// one row per day correctly (#2160, `calendarOrderDays.ts`) and then built the
// ticket list ONCE from the whole order and attached that same array to EVERY
// day row. `ticket_event_dates` was already selected by the query and simply
// thrown away. Under `per_day` (D days -> D passes, one entitlement row each)
// the day-2 QR therefore rendered on the day-1 card. `TicketPdfSheet` stamps
// every pass it is handed "Valid". `biz_ticket_scan` then refuses it, and the
// guest is turned away holding a pass the app told them was good.
//
// ── WHY THIS SUITE IS SCAN-LEVEL AND NOT RENDER-LEVEL ──────────────────────
// The broken code RENDERS BEAUTIFULLY. A test asserting "the card has tickets",
// "two cards were emitted", or "the QR component mounted" is GREEN on the
// defect — every one of those is true while the guest is being refused. The
// only assertion that catches it is the door's own question:
//
//     take the QR PAYLOAD off a card, resolve it back to a pass, and ask
//     whether that pass's `ticket_event_dates` set contains THAT CARD'S DAY.
//
// So `scanAtDoor` below takes a QR STRING and nothing else — exactly what the
// scanner has — and looks the pass up in a fixture that stands in for the
// database. A card cannot satisfy it by carrying a well-formed object.
//
// ── FALSIFIABILITY, PROVED IN-SUITE ────────────────────────────────────────
// S-4 re-runs S-1's loop with every pass reattached to every day (the verbatim
// pre-#2347 behaviour) and asserts it THROWS. If the day binding is ever
// reverted, S-1 goes red and S-4 goes red for the opposite reason, so the pair
// cannot both be satisfied by a no-op.

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  calendarDayWindowsForOrder,
  type CalendarOccurrenceRow,
  ticketsAdmittedOnDay,
} from "../calendarOrderDays.ts";

// ── The event: a three-day exhibition ──────────────────────────────────────
const DAY_1: CalendarOccurrenceRow = {
  id: "occ-1",
  start_at: "2026-08-22T10:00:00.000Z",
  end_at: "2026-08-22T18:00:00.000Z",
  is_master: true,
};
const DAY_2: CalendarOccurrenceRow = {
  id: "occ-2",
  start_at: "2026-08-23T10:00:00.000Z",
  end_at: "2026-08-23T18:00:00.000Z",
  is_master: false,
};
const DAY_3: CalendarOccurrenceRow = {
  id: "occ-3",
  start_at: "2026-08-24T10:00:00.000Z",
  end_at: "2026-08-24T18:00:00.000Z",
  is_master: false,
};
const ALL_DAYS = [DAY_1, DAY_2, DAY_3];

/** A `tickets` row exactly as `fetchUserBusinessEventOrders` selects it. */
interface TicketRow {
  id: string;
  ticket_type_id: string;
  qr_code: string;
  status: "valid" | "used" | "void" | "transferred" | "refunded";
  attendee_name: string | null;
  attendee_email: string | null;
  ticket_event_dates?: Array<{ event_date_id: string }> | null;
}

const ticket = (
  id: string,
  qr: string,
  eventDateIds: string[],
  status: TicketRow["status"] = "valid",
): TicketRow => ({
  id,
  ticket_type_id: "tt-ga",
  qr_code: qr,
  status,
  attendee_name: null,
  attendee_email: null,
  ticket_event_dates: eventDateIds.map((event_date_id) => ({ event_date_id })),
});

// ══ THE DOOR ═══════════════════════════════════════════════════════════════
// `biz_ticket_scan`'s day ladder, reduced to the rung that decides admit vs
// refuse (20270420002160_issue_2160_multiday_multiselect.sql §E):
//
//   v_day_count = 0  -> LEGACY PATH: the pre-#2160 any-occurrence window. A
//                       pass with no entitlement rows admits on any day, and
//                       every pass issued before #2160 is on this path.
//   otherwise        -> the pass admits ONLY the days it has rows for. "outside
//                       every day of its set" is a refusal.
//
// The QR payload is the ONLY input, because it is the only thing the scanner
// has. The fixture below is the database.
type ScanOutcome = "success" | "refused_wrong_day" | "refused_unknown_pass";

const scanAtDoor = (
  db: readonly TicketRow[],
  qrPayload: string,
  dayEventDateId: string,
): ScanOutcome => {
  const pass = db.find((t) => t.qr_code === qrPayload);
  if (pass === undefined) return "refused_unknown_pass";
  const admits = (pass.ticket_event_dates ?? []).map((l) => l.event_date_id);
  if (admits.length === 0) return "success";
  return admits.includes(dayEventDateId) ? "success" : "refused_wrong_day";
};

// ══ THE SURFACE UNDER TEST ═════════════════════════════════════════════════
// The two lines `calendarService.ts` runs per emitted row, calling the REAL
// rule functions. S-10 pins that the service really runs them, which is all a
// source pin is honestly good for — the behaviour is proved here.
interface DayCard {
  eventDateId: string | null | undefined;
  masterDateUtc: string | null;
  masterDateEndUtc: string | null;
  ticketCount: number;
  ticketCountValid: number;
  qrPayloads: string[];
}

const buildDayCards = (
  input: {
    occurrences: CalendarOccurrenceRow[] | null;
    tickets: TicketRow[];
    fallback: { masterDateUtc: string | null; masterDateEndUtc: string | null };
  },
  // The pre-#2347 behaviour, kept executable so S-4 can prove the suite is
  // falsifiable rather than merely asserting that it is.
  opts: { reattachEveryTicketToEveryDay?: boolean } = {},
): DayCard[] => {
  const tickets = input.tickets.map((t) => ({
    id: t.id,
    qrCode: t.qr_code,
    status: t.status,
    eventDateIds: (t.ticket_event_dates ?? [])
      .map((link) => link?.event_date_id)
      .filter((id): id is string => typeof id === "string"),
  }));
  const daysToEmit = calendarDayWindowsForOrder({
    occurrences: input.occurrences,
    tickets: input.tickets,
    fallback: input.fallback,
  });
  return daysToEmit.map((day) => {
    const dayTickets = opts.reattachEveryTicketToEveryDay === true
      ? [...tickets]
      : ticketsAdmittedOnDay(tickets, day.eventDateId);
    return {
      eventDateId: day.eventDateId,
      masterDateUtc: day.masterDateUtc,
      masterDateEndUtc: day.masterDateEndUtc,
      ticketCount: dayTickets.length,
      ticketCountValid: dayTickets.filter((t) => t.status === "valid").length,
      qrPayloads: dayTickets.map((t) => t.qrCode),
    };
  });
};

/**
 * THE ASSERTION THAT MATTERS. For every card and every QR the card would
 * render, resolve the payload back to a pass and ask the door.
 */
const assertEveryShownPassScansOnItsOwnCard = (
  db: readonly TicketRow[],
  cards: readonly DayCard[],
): void => {
  let scanned = 0;
  for (const card of cards) {
    // A card with no day is a not-day-scoped window; the door's legacy rung
    // covers it and there is no "that card's day" to check against.
    if (card.eventDateId === null || card.eventDateId === undefined) continue;
    for (const qr of card.qrPayloads) {
      assertEquals(
        scanAtDoor(db, qr, card.eventDateId),
        "success",
        `pass ${qr} is rendered on the ${card.eventDateId} card, stamped ` +
          `"Valid", and the door refuses it — this is issue #2347`,
      );
      scanned += 1;
    }
  }
  assert(scanned > 0, "the proof scanned nothing — it would pass on anything");
};

// ── the order at the centre of the issue: per_day, day 1 + day 2 ──────────
const PER_DAY_TICKETS = [
  ticket("tkt-day2", "QR-DAY-2", ["occ-2"]),
  ticket("tkt-day1", "QR-DAY-1", ["occ-1"]),
];
// What ORCH-1188 resolves for this order: `orders.event_date_id` is the
// LATEST-ending chosen day (the #2160 payout anchor), i.e. day 2.
const ANCHOR_FALLBACK = {
  masterDateUtc: DAY_2.start_at,
  masterDateEndUtc: DAY_2.end_at,
};

Deno.test("S-1 SCAN-LEVEL: every pass shown on a card is admitted by the door on that card's day", () => {
  const cards = buildDayCards({
    occurrences: ALL_DAYS,
    tickets: PER_DAY_TICKETS,
    fallback: ANCHOR_FALLBACK,
  });
  assertEquals(cards.length, 2, "#2160: a two-day guest gets two cards");
  assertEveryShownPassScansOnItsOwnCard(PER_DAY_TICKETS, cards);
});

Deno.test("S-2 the day-2 QR never appears on the day-1 card, and vice versa", () => {
  const cards = buildDayCards({
    occurrences: ALL_DAYS,
    tickets: PER_DAY_TICKETS,
    fallback: ANCHOR_FALLBACK,
  });
  const [dayOne, dayTwo] = cards;
  assertEquals(dayOne.eventDateId, "occ-1");
  assertEquals(dayTwo.eventDateId, "occ-2");
  assertEquals(dayOne.qrPayloads, ["QR-DAY-1"]);
  assertEquals(dayTwo.qrPayloads, ["QR-DAY-2"]);
  // The negative, stated as the defect: the broken code put BOTH on BOTH.
  assertNotEquals(
    dayOne.qrPayloads.slice().sort(),
    ["QR-DAY-1", "QR-DAY-2"],
    "the day-1 card carried the day-2 QR — that is the refusal at the door",
  );
  assert(!dayOne.qrPayloads.includes("QR-DAY-2"));
  assert(!dayTwo.qrPayloads.includes("QR-DAY-1"));
});

Deno.test("S-3 ticketCount and ticketCountValid describe THAT day, not the order", () => {
  const cards = buildDayCards({
    occurrences: ALL_DAYS,
    tickets: PER_DAY_TICKETS,
    fallback: ANCHOR_FALLBACK,
  });
  // `BusinessEventCalendarRow.tsx` renders `${ticketCountValid} tickets`. It
  // read "2 tickets" on BOTH days for a guest holding one pass per day.
  assertEquals(cards[0].ticketCount, 1);
  assertEquals(cards[1].ticketCount, 1);
  assertEquals(cards[0].ticketCountValid, 1);
  assertEquals(cards[1].ticketCountValid, 1);
  assertNotEquals(cards[0].ticketCount, PER_DAY_TICKETS.length);
});

Deno.test("S-4 FALSIFIABILITY: reattaching every pass to every day makes S-1 go red", () => {
  const broken = buildDayCards(
    {
      occurrences: ALL_DAYS,
      tickets: PER_DAY_TICKETS,
      fallback: ANCHOR_FALLBACK,
    },
    { reattachEveryTicketToEveryDay: true },
  );
  // Rendering is unaffected — this is precisely why a render-level test misses
  // it. Two cards, both populated, every pass "Valid".
  assertEquals(broken.length, 2);
  assertEquals(broken[0].ticketCount, 2);
  assertEquals(broken[1].ticketCount, 2);
  // And the door refuses.
  assertThrows(
    () => assertEveryShownPassScansOnItsOwnCard(PER_DAY_TICKETS, broken),
    Error,
    "the door refuses it",
  );
  assertEquals(
    scanAtDoor(PER_DAY_TICKETS, "QR-DAY-2", "occ-1"),
    "refused_wrong_day",
  );
});

Deno.test("S-5 all_days: ONE pass admitting both days shows on both, and scans on both", () => {
  // `all_days` mints one pass with N entitlement rows. It is legitimately the
  // same pass on both cards, and the door admits it once per day.
  const db = [ticket("tkt-both", "QR-BOTH", ["occ-1", "occ-2"])];
  const cards = buildDayCards({
    occurrences: ALL_DAYS,
    tickets: db,
    fallback: ANCHOR_FALLBACK,
  });
  assertEquals(cards.length, 2);
  assertEquals(cards[0].qrPayloads, ["QR-BOTH"]);
  assertEquals(cards[1].qrPayloads, ["QR-BOTH"]);
  assertEquals(cards[0].ticketCount, 1);
  assertEveryShownPassScansOnItsOwnCard(db, cards);
});

Deno.test("S-6 SINGLE-DAY IS UNCHANGED: byte-identical to the pre-#2347 assembly", () => {
  // A single-date event mints ZERO `ticket_event_dates` rows, so the order is
  // "not day-scoped": one window, from the caller's fallback, carrying every
  // pass. Proved by computing the pre-#2347 result and asserting equality
  // rather than by asserting a count and hoping.
  const db = [
    ticket("tkt-1", "QR-1", []),
    ticket("tkt-2", "QR-2", []),
    ticket("tkt-3", "QR-3", [], "used"),
  ];
  const input = {
    occurrences: [DAY_1],
    tickets: db,
    fallback: {
      masterDateUtc: DAY_1.start_at,
      masterDateEndUtc: DAY_1.end_at,
    },
  };
  const after = buildDayCards(input);
  const before = buildDayCards(input, { reattachEveryTicketToEveryDay: true });
  assertEquals(after, before, "a single-day order must not move at all");
  assertEquals(after.length, 1);
  assertEquals(after[0].qrPayloads, ["QR-1", "QR-2", "QR-3"]);
  assertEquals(after[0].ticketCount, 3);
  assertEquals(after[0].ticketCountValid, 2);
});

Deno.test("S-7 LEGACY multi-date order with no entitlement rows keeps every pass on its one card", () => {
  // Every order issued before #2160 is on this path and nothing is backfilled.
  const db = [ticket("tkt-a", "QR-A", []), ticket("tkt-b", "QR-B", [])];
  const input = {
    occurrences: ALL_DAYS,
    tickets: db,
    fallback: ANCHOR_FALLBACK,
  };
  const after = buildDayCards(input);
  assertEquals(after, buildDayCards(input, {
    reattachEveryTicketToEveryDay: true,
  }));
  assertEquals(after.length, 1);
  assertEquals(after[0].qrPayloads, ["QR-A", "QR-B"]);
  // And the door's legacy rung admits them on any day of the event.
  assertEquals(scanAtDoor(db, "QR-A", "occ-3"), "success");
});

Deno.test("S-8 an order NEVER shows zero passes, even when the day ids are unresolvable", () => {
  // #2160 E-6: the entitlement rows reference occurrences this query did not
  // return, so the rule falls back to one anchor window. That window is NOT
  // day-scoped, so it must still carry every pass — a calendar entry with no
  // pass at all is worse than one dated from its anchor.
  const db = [ticket("tkt-x", "QR-X", ["occ-not-loaded"])];
  const cards = buildDayCards({
    occurrences: [DAY_1],
    tickets: db,
    fallback: ANCHOR_FALLBACK,
  });
  assertEquals(cards.length, 1);
  assertEquals(cards[0].eventDateId, undefined, "the fallback is not a day");
  assertEquals(cards[0].qrPayloads, ["QR-X"]);
});

Deno.test("S-9 MIXED: a not-day-scoped comp pass rides every day alongside day-bound ones", () => {
  // A pass with zero rows is "admits any occurrence" at the door, so hiding it
  // from a day card would strand a guest who is genuinely entitled.
  const db = [
    ticket("tkt-day1", "QR-DAY-1", ["occ-1"]),
    ticket("tkt-day2", "QR-DAY-2", ["occ-2"]),
    ticket("tkt-comp", "QR-COMP", []),
  ];
  const cards = buildDayCards({
    occurrences: ALL_DAYS,
    tickets: db,
    fallback: ANCHOR_FALLBACK,
  });
  assertEquals(cards.length, 2);
  assertEquals(cards[0].qrPayloads.slice().sort(), ["QR-COMP", "QR-DAY-1"]);
  assertEquals(cards[1].qrPayloads.slice().sort(), ["QR-COMP", "QR-DAY-2"]);
  assertEveryShownPassScansOnItsOwnCard(db, cards);
});

Deno.test("S-10 SOURCE PIN — calendarService really binds passes to the emitted day", () => {
  const src = Deno.readTextFileSync(
    new URL("../calendarService.ts", import.meta.url),
  );
  assert(
    /const dayTickets = ticketsAdmittedOnDay\(tickets, day\.eventDateId\);/
      .test(src),
    "each emitted row must select the passes bound to ITS OWN day",
  );
  assert(
    /tickets: dayTickets,/.test(src),
    "the row must carry that day's passes, not the order's",
  );
  assert(
    /ticketCount: dayTickets\.length,/.test(src),
    "the count must describe that day's passes",
  );
  // The defect, spelled out, so a revert cannot be quietly reintroduced.
  assert(
    !/^\s*tickets,\s*$/m.test(src),
    "`tickets,` shorthand attaches the WHOLE order to every day — issue #2347",
  );
  assert(
    !/ticketCount: tickets\.length,/.test(src),
    "`ticketCount: tickets.length` reads the whole order — issue #2347",
  );
  assert(
    /eventDateIds: \(t\.ticket_event_dates \?\? \[\]\)/.test(src),
    "the selected `ticket_event_dates` must reach the row, not be discarded",
  );
});
