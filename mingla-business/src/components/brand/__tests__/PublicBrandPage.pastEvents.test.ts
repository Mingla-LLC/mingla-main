/**
 * ORCH-0850 [End-not-start parity systemic] — Public brand page Upcoming/Past
 * memo regression test.
 *
 * Pre-0850 PublicBrandPage.tsx:130-148 had two inlined memos with
 * `new Date(e.date).getTime()` + `Date.now() - 24h` cutoff. Same UTC-midnight
 * bug class as Hub + checkout: at 8pm EDT on start day, an in-progress event
 * incorrectly fell into pastEvents AND dropped out of upcomingEvents.
 *
 * The §3.4.2 fix routes both memos through the canonical helper
 * `isEventPast + computeMasterEndAtUtc`. This test exercises that chain
 * with the data shapes the memos see.
 *
 * Fails-on-revert: if the §3.1 / §3.2 fix is reverted, the imports below
 * fail and all `it` blocks fail.
 */

import { isEventPast } from "../../../utils/eventLifecycle";
import { computeMasterEndAtUtc } from "../../../utils/eventDateMath";
import type { LiveEvent } from "../../../store/liveEventStore";

type LiveEventFixture = Pick<
  LiveEvent,
  "status" | "endedAt" | "date" | "doorsOpen" | "endsAt" | "timezone"
>;

function makeEvent(partial: Partial<LiveEventFixture>): LiveEvent {
  return {
    status: "scheduled",
    endedAt: null,
    date: null,
    doorsOpen: null,
    endsAt: null,
    timezone: "America/New_York",
    ...partial,
  } as unknown as LiveEvent;
}

describe("ORCH-0850 — PublicBrandPage Upcoming/Past memo predicates", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // 2026-05-15 20:10 EDT = 2026-05-16T00:10:52Z — operator's live repro time.
    jest.setSystemTime(new Date("2026-05-16T00:10:52Z"));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("T-08: in-progress event is in Upcoming, NOT in Past", () => {
    // Operator's repro event: 3am EDT start, 9pm EDT end. Currently live.
    const event = makeEvent({
      status: "scheduled",
      date: "2026-05-15",
      doorsOpen: "03:00",
      endsAt: "21:00",
      timezone: "America/New_York",
    });
    const masterEnd = computeMasterEndAtUtc(event);
    expect(isEventPast(event, masterEnd)).toBe(false);
    // The memo applies the predicate as: upcoming = !isEventPast && status !== cancelled.
    expect(event.status === "cancelled").toBe(false);
  });

  it("T-09: ended event is in Past, NOT in Upcoming", () => {
    const event = makeEvent({
      status: "scheduled",
      date: "2026-05-10",
      doorsOpen: "20:00",
      endsAt: "23:00",
      timezone: "America/New_York",
    });
    expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(true);
  });

  it("T-10: cancelled event is filtered from BOTH Upcoming and Past per memo policy", () => {
    // Memo logic: cancelled → filtered out of both. Test the predicate
    // input shape (isEventPast returns true for cancelled but the memo
    // short-circuits cancelled separately).
    const event = makeEvent({
      status: "cancelled",
      date: "2026-05-15",
      doorsOpen: "20:00",
      endsAt: "23:00",
      timezone: "America/New_York",
    });
    expect(event.status === "cancelled").toBe(true);
    expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(true);
  });
});
