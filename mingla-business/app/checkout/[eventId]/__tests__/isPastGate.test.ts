/**
 * ORCH-0850 [End-not-start parity systemic] — Checkout isPast gate regression test.
 *
 * Pre-0850 the checkout screen had a local `computeIsPast(event)` that did
 * `new Date(event.date).getTime() + 24h < Date.now()`. For any US-Eastern
 * event, that fired at 8pm EDT on the start day, blocking ticket purchases
 * on still-live events and rendering the "This event isn't taking new
 * tickets" empty state. S0 revenue impact.
 *
 * The §3.4.1 fix replaces the call site with
 * `isEventPast(event, computeMasterEndAtUtc(event))` — canonical helpers in
 * `mingla-business/src/utils/`. This test exercises that exact chain.
 *
 * Fails-on-revert: if the §3.1 or §3.2 fix (adding `computeMasterEndAtUtc` /
 * `isEventPast`) is reverted, the imports below fail — all three `it` blocks
 * fail. Naming the file `isPastGate.test.ts` (not the SPEC-suggested
 * `computeIsPast.test.tsx`) because the local `computeIsPast` was DELETED per
 * SPEC §3.4.1 — what we test is the canonical chain that replaced it.
 */

import { isEventPast } from "../../../../src/utils/eventLifecycle";
import { computeMasterEndAtUtc } from "../../../../src/utils/eventDateMath";
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

describe("ORCH-0850 — Checkout isPast gate (canonical isEventPast + computeMasterEndAtUtc)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // 2026-05-15 20:10 EDT = 2026-05-16T00:10:52Z — operator's live repro time.
    jest.setSystemTime(new Date("2026-05-16T00:10:52Z"));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("T-05: in-progress event (3am-9pm EDT today) is NOT past — checkout opens", () => {
    // "Another Tested Event": doors 3am EDT, endsAt 21:00 → masterEndAtUtc
    // = 2026-05-16T01:00:00Z. now = 2026-05-16T00:10:52Z → end_at is 49min
    // in the future → not past → checkout renders ticket UI, NOT empty state.
    const event = makeEvent({
      status: "scheduled",
      date: "2026-05-15",
      doorsOpen: "03:00",
      endsAt: "21:00",
      timezone: "America/New_York",
    });
    expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(false);
  });

  it("T-06: ended event (endsAt was 6h ago) is past — empty state shown", () => {
    // Event ended 2026-05-15 at 18:00 EDT = 2026-05-15T22:00:00Z, which is
    // ~2h before now (2026-05-16T00:10:52Z) → past.
    const event = makeEvent({
      status: "scheduled",
      date: "2026-05-15",
      doorsOpen: "12:00",
      endsAt: "18:00",
      timezone: "America/New_York",
    });
    expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(true);
  });

  it("T-07: cancelled event is past (short-circuit, end time irrelevant)", () => {
    const event = makeEvent({
      status: "cancelled",
      date: "2026-05-15",
      doorsOpen: "20:00",
      endsAt: "23:59",
      timezone: "America/New_York",
    });
    expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(true);
  });
});
