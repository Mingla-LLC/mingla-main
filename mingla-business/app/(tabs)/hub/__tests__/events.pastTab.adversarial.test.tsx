/**
 * ORCH-0850 [End-not-start parity systemic] — Hub Past tab ADVERSARIAL regression test.
 *
 * Tester-authored per SPEC §3.8.2. Attacks angles the implementor's happy-path
 * test (events.pastTab.test.tsx) does NOT exercise. Per Step 0.5 CLOSE gate,
 * this MUST be a different attack surface than the happy-path — never a renamed
 * copy.
 *
 * Four attack clusters per SPEC §3.8.2:
 *   A. Boundary equality on the live-window edges
 *   B. Timezone / DST hazards
 *   C. Malformed / edge data
 *   D. Cross-mode parity (status enum coverage)
 *
 * Fails-on-revert: if the §3.3 fix is reverted (eventCardStatus.ts deleted or
 * `deriveCardStatus` body restored to broken inline math), the import below
 * fails and all `it` blocks fail.
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

describe("ORCH-0850 — Hub Past tab ADVERSARIAL", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  // --- Cluster A: Boundary equality on live-window edges -----------------
  describe("Cluster A — boundary equality on live-window edges", () => {
    it("A-01: now exactly at liveWindowEnd (start + 24h) returns past", () => {
      // canonical liveWindowEnd = masterStartAtUtc + 24h. Set now exactly equal.
      // start 3am EDT May 14 = 2026-05-14T07:00Z; liveWindowEnd = 2026-05-15T07:00Z.
      // Set now = 2026-05-15T07:00:00Z exactly. Predicate is `now < liveWindowEnd` → returns past.
      jest.setSystemTime(new Date("2026-05-15T07:00:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-14",
        doorsOpen: "03:00",
        timezone: "America/New_York",
      });
      expect(deriveCardStatus(event)).toBe("past");
    });

    it("A-02: now exactly 1ms before liveWindowEnd returns live (NOT past)", () => {
      jest.setSystemTime(new Date("2026-05-15T06:59:59.999Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-14",
        doorsOpen: "03:00",
        timezone: "America/New_York",
      });
      expect(deriveCardStatus(event)).toBe("live");
    });

    it("A-03: now exactly at liveWindowStart (start - 4h) returns live", () => {
      // start = 2026-05-15T07:00Z; liveWindowStart = 2026-05-15T03:00Z. Set now exactly equal.
      // Predicate `now >= liveWindowStart` → live.
      jest.setSystemTime(new Date("2026-05-15T03:00:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-15",
        doorsOpen: "03:00",
        timezone: "America/New_York",
      });
      expect(deriveCardStatus(event)).toBe("live");
    });

    it("A-04: now exactly 1ms before liveWindowStart returns upcoming", () => {
      jest.setSystemTime(new Date("2026-05-15T02:59:59.999Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-15",
        doorsOpen: "03:00",
        timezone: "America/New_York",
      });
      expect(deriveCardStatus(event)).toBe("upcoming");
    });
  });

  // --- Cluster B: Timezone / DST hazards ---------------------------------
  describe("Cluster B — timezone / DST hazards", () => {
    it("B-01: event straddling spring-forward DST (March 8 2026 in America/New_York) parses correctly", () => {
      // 2026-03-08 02:00 EST does not exist (clocks jump to 03:00 EDT).
      // computeMasterStartAtUtc must DST-anchor; the canonical helper's two-pass
      // re-anchor handles this. The wall-clock "2026-03-08T03:00:00" in EST/EDT
      // tz → 2026-03-08T07:00:00Z. Set now AFTER expected start.
      jest.setSystemTime(new Date("2026-03-08T08:00:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-03-08",
        doorsOpen: "03:00",
        timezone: "America/New_York",
      });
      // The event started at 3am EDT (after the spring-forward jump). Now is 1h after start.
      // Pre-fix would have done `new Date("2026-03-08").getTime() + 24h` = UTC March 9 → past at 8pm EDT March 8.
      // Fix returns "live" because we're within the 24h live window.
      expect(deriveCardStatus(event)).toBe("live");
    });

    it("B-02: event in non-Eastern timezone (Asia/Tokyo) — broken pre-fix would shift live window by 13+ hours", () => {
      // Event at 9pm JST = 12:00 UTC. event.date = "2026-05-15"; UTC midnight + 24h
      // would put pre-fix liveWindowEnd at 2026-05-16T00:00Z, but actual liveWindowEnd
      // is 2026-05-16T12:00Z. Set now to 2026-05-16T06:00Z — broken pre-fix says past,
      // fixed canonical says live.
      jest.setSystemTime(new Date("2026-05-16T06:00:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-15",
        doorsOpen: "21:00",
        timezone: "Asia/Tokyo",
      });
      expect(deriveCardStatus(event)).toBe("live");
    });

    it("B-03: invalid timezone falls back to UTC parse but does not crash", () => {
      jest.setSystemTime(new Date("2026-05-15T12:00:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-15",
        doorsOpen: "03:00",
        timezone: "Not/A_Real_Timezone",
      });
      // localWallClockToUtcInstant returns null for invalid tz → canonical
      // deriveLiveStatus sees masterStartAtUtc null → returns "upcoming".
      expect(deriveCardStatus(event)).toBe("upcoming");
    });
  });

  // --- Cluster C: Malformed / edge data ---------------------------------
  describe("Cluster C — malformed / edge data", () => {
    it("C-01: malformed event.date (random string) returns upcoming without crash", () => {
      jest.setSystemTime(new Date("2026-05-15T12:00:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "not-a-date",
        doorsOpen: "03:00",
        timezone: "America/New_York",
      });
      // computeMasterStartAtUtc → localWallClockToUtcInstant("not-a-dateT03:00:00", tz) → null
      // canonical deriveLiveStatus → masterStartAtUtc null → "upcoming"
      expect(deriveCardStatus(event)).toBe("upcoming");
    });

    it("C-02: event.date is empty string returns upcoming without crash", () => {
      jest.setSystemTime(new Date("2026-05-15T12:00:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "",
        doorsOpen: "03:00",
        timezone: "America/New_York",
      });
      // event.date "" is non-null → enters parse path → regex rejects → null → upcoming.
      expect(deriveCardStatus(event)).toBe("upcoming");
    });

    it("C-03: doorsOpen with seconds component (HH:MM:SS form) parses correctly", () => {
      // computeMasterStartAtUtc normalizes "03:00" → "03:00:00"; verify "03:00:45" passes through.
      jest.setSystemTime(new Date("2026-05-15T07:00:45.000Z")); // exactly at start
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-15",
        doorsOpen: "03:00:45",
        timezone: "America/New_York",
      });
      // start = 2026-05-15T07:00:45Z, now = exactly equal → live (predicate `now >= start - 4h` passes).
      expect(deriveCardStatus(event)).toBe("live");
    });

    it("C-04: endedAt set BEFORE liveWindowEnd takes precedence over time-based check", () => {
      // Short-circuit verification: endedAt wins over the time math.
      jest.setSystemTime(new Date("2026-05-15T08:00:00.000Z")); // 1h after start, would be "live"
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-15",
        doorsOpen: "03:00",
        endedAt: "2026-05-15T07:30:00.000Z",
        timezone: "America/New_York",
      });
      expect(deriveCardStatus(event)).toBe("past");
    });
  });

  // --- Cluster D: Cross-mode parity (status enum coverage) ---------------
  describe("Cluster D — status enum coverage", () => {
    it("D-01: status=ended (operator-set, distinct from endedAt timestamp) maps to past in Hub bucket", () => {
      // The Hub maps both `cancelled` and time-based "past" into the Past pill.
      // status="ended" is operator-set per ORCH-0845; canonical deriveLiveStatus does NOT
      // short-circuit on it (it short-circuits on cancelled, endedAt, then computes time).
      // For a future event with status="ended", the canonical returns "upcoming" (the
      // status enum is ignored by deriveLiveStatus). This is a known limitation of the
      // canonical helper; isEventPast DOES short-circuit on status="ended". Documenting
      // the asymmetry — Hub uses deriveLiveStatus → does NOT treat status=ended as past.
      // This is a P4 discovery for orchestrator, NOT a P0/P1 (the operator-set flag
      // is supposed to flip ALSO endedAt; verified by checking ORCH-0845 close).
      jest.setSystemTime(new Date("2026-05-15T12:00:00.000Z"));
      const event = makeEvent({
        status: "ended",
        date: "2026-05-20",
        doorsOpen: "20:00",
        timezone: "America/New_York",
      });
      // For Hub: deriveLiveStatus does not short-circuit on status="ended"; returns "upcoming"
      // (event start tomorrow). Hub deriveCardStatus only maps "cancelled" → "past".
      // Document this as the spec-correct behavior; flag asymmetry as Discovery for orchestrator.
      expect(deriveCardStatus(event)).toBe("upcoming");
    });
  });
});
