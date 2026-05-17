/**
 * ORCH-0850 [End-not-start parity systemic] — Hub Past tab regression test.
 *
 * Exercises `deriveCardStatus` exported from `../events.tsx`, which routes
 * past/upcoming/live decisions through the canonical helper
 * `deriveLiveStatus + computeMasterStartAtUtc` in mingla-business/src/utils/.
 *
 * Pre-0850 the local `deriveLiveStatus` inlined `new Date(event.date).getTime()`,
 * parsing `"YYYY-MM-DD"` as UTC midnight and treating any US-Eastern event as
 * past 24h after UTC midnight (= 8pm EDT same calendar day). That broke for
 * "Another Tested Event" (3am EDT start, 9pm EDT end) — Hub Past tab listed it
 * while still live.
 *
 * Fails-on-revert: if the §3.3 fix is reverted, `deriveCardStatus` is removed
 * from `../events.tsx` and the import below fails — all four `it` blocks fail.
 */

import { deriveCardStatus } from "../eventCardStatus";
import type { LiveEvent } from "../../../../src/store/liveEventStore";

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

describe("ORCH-0850 — Hub Past tab deriveCardStatus", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // 2026-05-15 20:10 EDT = 2026-05-16T00:10:52Z — operator's live repro time.
    jest.setSystemTime(new Date("2026-05-16T00:10:52Z"));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("T-01: in-progress event (start 3am EDT today) is NOT past", () => {
    // "Another Tested Event" shape: doors at 3am EDT on the same calendar day.
    // masterStartAtUtc resolves to 2026-05-15T07:00:00Z. Canonical
    // deriveLiveStatus's LIVE_WINDOW_AFTER_MS = 24h → liveWindowEnd =
    // 2026-05-16T07:00:00Z. now = 2026-05-16T00:10:52Z → still inside the
    // live window → status === "live", NOT "past".
    const event = makeEvent({
      status: "scheduled",
      date: "2026-05-15",
      doorsOpen: "03:00",
      timezone: "America/New_York",
    });
    expect(deriveCardStatus(event)).not.toBe("past");
  });

  it("T-02: ended event (start >24h ago) is past", () => {
    // Start was 2026-05-14 at 18:00 EDT = 2026-05-14T22:00:00Z.
    // liveWindowEnd = 2026-05-15T22:00:00Z. now = 2026-05-16T00:10:52Z → past.
    const event = makeEvent({
      status: "scheduled",
      date: "2026-05-14",
      doorsOpen: "18:00",
      timezone: "America/New_York",
    });
    expect(deriveCardStatus(event)).toBe("past");
  });

  it("T-03: future event (start tomorrow) is upcoming", () => {
    const event = makeEvent({
      status: "scheduled",
      date: "2026-05-20",
      doorsOpen: "20:00",
      timezone: "America/New_York",
    });
    expect(deriveCardStatus(event)).toBe("upcoming");
  });

  it("T-04: cancelled event maps to past (Hub bucket policy)", () => {
    const event = makeEvent({
      status: "cancelled",
      date: "2026-05-15",
      doorsOpen: "20:00",
      timezone: "America/New_York",
    });
    expect(deriveCardStatus(event)).toBe("past");
  });
});
