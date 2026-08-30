/**
 * ORCH-0850 [End-not-start parity systemic] — Checkout isPast gate ADVERSARIAL test.
 *
 * Tester-authored per SPEC §3.8.2. Attacks angles the implementor's happy-path
 * (isPastGate.test.ts) does NOT exercise. S0 revenue path — adversarial coverage
 * is the most critical of the four surfaces.
 *
 * Clusters (per SPEC §3.8.2):
 *   A. Boundary equality on the end_at edge (`>` vs `>=`)
 *   B. Timezone / DST hazards
 *   C. Malformed / edge data
 *   D. Cross-mode parity (multi-date events, hydrated field, status enum)
 *
 * Fails-on-revert: if §3.1 (computeMasterEndAtUtc) or §3.2 (isEventPast) is
 * reverted, the imports below fail and all `it` blocks fail.
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

describe("ORCH-0850 — Checkout isPast gate ADVERSARIAL", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  // --- Cluster A: Boundary equality on end_at edge -----------------------
  describe("Cluster A — boundary equality on end_at", () => {
    it("A-01: now exactly equal to end_at returns true (past — canonical `<=` terminal rule)", () => {
      // end_at = 9pm EDT May 15 = 2026-05-16T01:00Z. Set now exactly equal.
      // Canonical terminal truth is `endTime <= Date.now()` → true → past/closed.
      // Checkout closes at the exact terminal instant, not one millisecond later.
      jest.setSystemTime(new Date("2026-05-16T01:00:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-15",
        doorsOpen: "03:00",
        endsAt: "21:00",
        timezone: "America/New_York",
      });
      expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(true);
    });

    it("A-02: now exactly 1ms after end_at returns true (past)", () => {
      jest.setSystemTime(new Date("2026-05-16T01:00:00.001Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-15",
        doorsOpen: "03:00",
        endsAt: "21:00",
        timezone: "America/New_York",
      });
      expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(true);
    });

    it("A-03: now exactly 1ms before end_at returns false (not past)", () => {
      jest.setSystemTime(new Date("2026-05-16T00:59:59.999Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-15",
        doorsOpen: "03:00",
        endsAt: "21:00",
        timezone: "America/New_York",
      });
      expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(false);
    });
  });

  // --- Cluster B: Timezone / DST hazards ---------------------------------
  describe("Cluster B — timezone / DST hazards", () => {
    it("B-01: event in fall-back DST window (Nov 1 2026 in America/New_York) computes correct end", () => {
      // 2026-11-01 02:00 occurs TWICE (DST ends — clocks set back from 2am EDT to 1am EST).
      // Wall-clock "2026-11-01T02:30:00" in America/New_York → ambiguous but Intl typically resolves to EST (2nd occurrence) = 06:30 UTC.
      // computeMasterEndAtUtc's two-pass re-anchor handles this. Set end-time well after start.
      jest.setSystemTime(new Date("2026-11-01T05:00:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-11-01",
        doorsOpen: "01:00",
        endsAt: "04:00",
        timezone: "America/New_York",
      });
      // The event ends at 4am local (post-DST-jump = EST) = 09:00 UTC. Now (05:00 UTC) is 4h before end → not past.
      expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(false);
    });

    it("B-02: non-Eastern timezone (Europe/London) — event yesterday in London, now next day evening UTC, end_at long past", () => {
      // London event: date "2026-05-14", endsAt 23:00 BST = 22:00 UTC May 14.
      // Now = May 15 20:00 UTC. Actual end was ~22h ago → past on time axis.
      // Pre-fix `new Date("2026-05-14")` + 24h = May 15 00:00 UTC < now → also past.
      // Both versions agree on this case; the adversarial angle is that the helper
      // correctly computes the BST offset and produces an authoritative end instant.
      jest.setSystemTime(new Date("2026-05-15T20:00:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-14",
        doorsOpen: "21:00",
        endsAt: "23:00",
        timezone: "Europe/London",
      });
      const masterEnd = computeMasterEndAtUtc(event);
      // Sanity: helper resolved to a real UTC instant ~22h before now.
      expect(masterEnd).not.toBeNull();
      expect(Date.parse(masterEnd as string)).toBeLessThan(Date.now());
      expect(isEventPast(event, masterEnd)).toBe(true);
    });

    it("B-03: missing event.endsAt falls back to local-end-of-day (23:59:59 in timezone)", () => {
      // No endsAt set; helper falls back to event.date + "T23:59:59" in timezone.
      // For NYC: 23:59:59 EDT May 15 = 03:59:59 UTC May 16.
      jest.setSystemTime(new Date("2026-05-16T03:00:00.000Z")); // 59min before fallback end
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-15",
        doorsOpen: "03:00",
        endsAt: null,
        timezone: "America/New_York",
      });
      expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(false);
    });

    it("B-04: invalid timezone returns null masterEndAtUtc → isEventPast returns false (unknown)", () => {
      jest.setSystemTime(new Date("2026-05-15T12:00:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-15",
        doorsOpen: "03:00",
        endsAt: "21:00",
        timezone: "Not/A_Real_Timezone",
      });
      // Per SPEC §3.2: null masterEndAtUtc → isEventPast returns false (don't declare past on time-axis alone).
      expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(false);
    });
  });

  // --- Cluster C: Malformed / edge data ---------------------------------
  describe("Cluster C — malformed / edge data", () => {
    it("C-01: malformed event.date returns null masterEndAtUtc → checkout opens (not past)", () => {
      jest.setSystemTime(new Date("2026-05-15T12:00:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "not-a-date",
        doorsOpen: "03:00",
        endsAt: "21:00",
        timezone: "America/New_York",
      });
      expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(false);
    });

    it("C-02: endsAt with seconds component (HH:MM:SS) is parsed correctly", () => {
      jest.setSystemTime(new Date("2026-05-16T01:00:30.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-15",
        doorsOpen: "03:00",
        endsAt: "21:00:45", // 01:00:45 UTC May 16
        timezone: "America/New_York",
      });
      // Now = 01:00:30 UTC, end_at = 01:00:45 UTC → 15ms before end → not past.
      expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(false);
    });

    it("C-03: endsAt malformed string falls through to 23:59:59 fallback", () => {
      jest.setSystemTime(new Date("2026-05-16T03:00:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-15",
        doorsOpen: "03:00",
        endsAt: "garbage",
        timezone: "America/New_York",
      });
      // Helper rejects garbage → falls through to 23:59:59 fallback = 03:59:59 UTC May 16. Not past.
      expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(false);
    });
  });

  // --- Cluster D: Status enum coverage + hydrated-field precedence ------
  describe("Cluster D — status enum + hydrated field precedence", () => {
    it("D-01: status='ended' short-circuits regardless of end_at being in future", () => {
      jest.setSystemTime(new Date("2026-05-15T12:00:00.000Z"));
      const event = makeEvent({
        status: "ended",
        date: "2026-05-20", // tomorrow, end far in future
        doorsOpen: "20:00",
        endsAt: "23:00",
        timezone: "America/New_York",
      });
      expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(true);
    });

    it("D-02: endedAt non-null short-circuits regardless of status or time", () => {
      jest.setSystemTime(new Date("2026-05-15T12:00:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-20",
        doorsOpen: "20:00",
        endsAt: "23:00",
        endedAt: "2026-05-15T10:00:00.000Z",
        timezone: "America/New_York",
      });
      expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(true);
    });

    it("D-03: hydrated event.masterEndAtUtc field takes precedence over wall-clock fallback", () => {
      // computeMasterEndAtUtc prefers the direct field if present and non-empty.
      jest.setSystemTime(new Date("2026-05-16T00:00:00.000Z"));
      const event = {
        ...makeEvent({
          status: "scheduled",
          date: "2026-05-15",
          doorsOpen: "03:00",
          endsAt: "21:00", // would compute to 01:00 UTC May 16
          timezone: "America/New_York",
        }),
        masterEndAtUtc: "2026-05-17T00:00:00.000Z", // hydrated value: tomorrow, overrides
      } as unknown as LiveEvent;
      expect(computeMasterEndAtUtc(event)).toBe("2026-05-17T00:00:00.000Z");
      expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(false);
    });
  });
});
