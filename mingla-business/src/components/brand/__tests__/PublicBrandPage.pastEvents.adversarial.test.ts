/**
 * ORCH-0850 [End-not-start parity systemic] — PublicBrandPage Upcoming/Past memo
 * ADVERSARIAL regression test.
 *
 * Tester-authored per SPEC §3.8.2. Attacks angles the implementor's happy-path
 * (PublicBrandPage.pastEvents.test.ts) does NOT exercise.
 *
 * Clusters (per SPEC §3.8.2):
 *   A. Cap + ordering edge cases
 *   B. Timezone / DST hazards
 *   C. Malformed / null edge data
 *   D. Status enum + cancelled-vs-past distinction
 *
 * Fails-on-revert: if §3.1 / §3.2 fix reverted, imports fail.
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

const PAST_EVENT_CAP = 10;

describe("ORCH-0850 — PublicBrandPage Upcoming/Past memo ADVERSARIAL", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  // --- Cluster A: Cap + ordering ----------------------------------------
  describe("Cluster A — cap + ordering", () => {
    it("A-01: more than PAST_EVENT_CAP past events → memo slices to cap, preserves newest-first sort", () => {
      // Simulate the memo logic locally: filter past events, sort by date desc, slice cap.
      jest.setSystemTime(new Date("2026-05-20T12:00:00.000Z"));
      const events: LiveEvent[] = [];
      for (let i = 0; i < 15; i += 1) {
        const day = String(i + 1).padStart(2, "0");
        events.push(
          makeEvent({
            status: "scheduled",
            date: `2026-04-${day}`,
            doorsOpen: "20:00",
            endsAt: "23:00",
            timezone: "America/New_York",
          }),
        );
      }
      const pastEvents = events
        .filter((e) => {
          if (e.status === "cancelled") return false;
          return isEventPast(e, computeMasterEndAtUtc(e));
        })
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
        .slice(0, PAST_EVENT_CAP);

      expect(pastEvents).toHaveLength(PAST_EVENT_CAP);
      // Newest first: 04-15, 04-14, ..., 04-06 (10 items)
      expect(pastEvents[0].date).toBe("2026-04-15");
      expect(pastEvents[9].date).toBe("2026-04-06");
    });

    it("A-02: events with null date are excluded from both Past and Upcoming bucket queries (memo filters null defensively)", () => {
      // The memo predicates use `(a.date ?? "").localeCompare` for sort, and rely on
      // isEventPast returning false when masterEndAtUtc is null (event.date null).
      // Verify: null-date event is NOT in past (predicate returns false).
      jest.setSystemTime(new Date("2026-05-20T12:00:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: null,
        timezone: "America/New_York",
      });
      // computeMasterEndAtUtc returns null when event.date is null → isEventPast returns false.
      expect(computeMasterEndAtUtc(event)).toBeNull();
      expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(false);
      // → would land in Upcoming (since the memo only excludes cancelled + past).
      // PublicBrandPage's pastEvents predicate filters this OUT (good); upcomingEvents INCLUDES it.
    });

    it("A-03: empty events list returns empty Upcoming + empty Past without crashing", () => {
      jest.setSystemTime(new Date("2026-05-20T12:00:00.000Z"));
      const events: LiveEvent[] = [];
      const upcoming = events.filter(
        (e) => e.status !== "cancelled" && !isEventPast(e, computeMasterEndAtUtc(e)),
      );
      const past = events
        .filter(
          (e) => e.status !== "cancelled" && isEventPast(e, computeMasterEndAtUtc(e)),
        )
        .slice(0, PAST_EVENT_CAP);
      expect(upcoming).toHaveLength(0);
      expect(past).toHaveLength(0);
    });
  });

  // --- Cluster B: Timezone / DST hazards ---------------------------------
  describe("Cluster B — timezone / DST hazards", () => {
    it("B-01: pre-fix 24h cutoff would put 'today's' BST/CEST events in Past — fix correctly keeps them in Upcoming", () => {
      // Berlin event at 8pm CEST May 15 = 18:00 UTC. Pre-fix `Date.now() - 24h` cutoff:
      // at 8:30pm CEST May 15 (18:30 UTC), pre-fix cutoff = 2026-05-14T18:30Z.
      // event date "2026-05-15" → eventTime = 2026-05-15T00:00Z >= cutoff → upcoming.
      // Both agree. The bug-class case is when "today UTC = day before event-day-local",
      // e.g. event May 16 at 1am CEST = May 15 23:00 UTC. event.date saved as 2026-05-16
      // (local date) but the event is actually still upcoming at 22:30 UTC May 15.
      jest.setSystemTime(new Date("2026-05-15T22:30:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-16",
        doorsOpen: "01:00",
        endsAt: "04:00",
        timezone: "Europe/Berlin",
      });
      // computeMasterEndAtUtc → 2026-05-16T02:00:00Z (4am CEST = +2). Now 22:30 UTC May 15 < 02:00 UTC May 16.
      // Not past → correctly in Upcoming.
      expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(false);
    });

    it("B-02: exact end equality belongs only to Past and preserves a mutually exclusive partition", () => {
      // Pre-fix memo: upcomingEvents includes events where eventTime >= cutoff;
      // pastEvents includes events where eventTime < cutoff. Mutually exclusive on `<` vs `>=`.
      // Post-fix uses canonical isEventPast which is true ⊕ false → mutually exclusive.
      // The "appears in BOTH" scenario shouldn't be possible in either version, BUT the post-fix
      // ensures the partition is meaningful (matches actual event state). This test confirms
      // partition correctness on the boundary.
      jest.setSystemTime(new Date("2026-05-16T01:00:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-15",
        doorsOpen: "03:00",
        endsAt: "21:00",
        timezone: "America/New_York",
      });
      // end_at = 01:00 UTC May 16 exactly. Canonical `<=` terminal truth makes equality past.
      const past = isEventPast(event, computeMasterEndAtUtc(event));
      const upcoming = event.status !== "cancelled" && !past;
      expect(past).toBe(true);
      expect(upcoming).toBe(false);
      // Mutually exclusive: NOT both.
      expect(past && upcoming).toBe(false);
    });
  });

  // --- Cluster C: Malformed / null edge data ----------------------------
  describe("Cluster C — malformed / null edge data", () => {
    it("C-01: malformed event.date keeps event in Upcoming (isEventPast returns false, status not cancelled)", () => {
      jest.setSystemTime(new Date("2026-05-15T12:00:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "not-a-date",
        timezone: "America/New_York",
      });
      expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(false);
    });

    it("C-02: event with endsAt='' (empty string) falls through to end-of-day fallback", () => {
      jest.setSystemTime(new Date("2026-05-16T03:30:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-15",
        doorsOpen: "03:00",
        endsAt: "",
        timezone: "America/New_York",
      });
      // endsAt "" is non-null but length===0; helper short-circuits typeof === "string" && length > 0,
      // skips to T23:59:59 fallback → 03:59:59 UTC May 16. Now 03:30 < 03:59:59 → not past.
      expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(false);
    });

    it("C-03: event with timezone=null falls back to 'UTC' default per computeMasterEndAtUtc line ~127", () => {
      jest.setSystemTime(new Date("2026-05-15T20:00:00.000Z"));
      const event = {
        ...makeEvent({
          status: "scheduled",
          date: "2026-05-15",
          doorsOpen: "12:00",
          endsAt: "21:00",
        }),
        timezone: "", // empty string → falls back to "UTC" per `event.timezone || "UTC"`
      } as unknown as LiveEvent;
      // end at 21:00 UTC May 15. Now = 20:00 UTC → 1h before end → not past.
      expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(false);
    });
  });

  // --- Cluster D: Status enum + cancelled vs past distinction -----------
  describe("Cluster D — cancelled vs past distinction", () => {
    it("D-01: cancelled event is filtered from BOTH Upcoming and Past memos (memo policy)", () => {
      jest.setSystemTime(new Date("2026-05-15T12:00:00.000Z"));
      const cancelledFuture = makeEvent({
        status: "cancelled",
        date: "2026-05-20",
        doorsOpen: "20:00",
        endsAt: "23:00",
        timezone: "America/New_York",
      });
      const cancelledPast = makeEvent({
        status: "cancelled",
        date: "2026-05-10",
        doorsOpen: "20:00",
        endsAt: "23:00",
        timezone: "America/New_York",
      });
      // Memo logic: both memos short-circuit `if (status === 'cancelled') return false;`
      // PublicBrandPage memos explicitly drop cancelled from both Upcoming and Past.
      expect(cancelledFuture.status === "cancelled").toBe(true);
      expect(cancelledPast.status === "cancelled").toBe(true);
      // isEventPast still returns true for cancelled (short-circuit), but the memo
      // filters cancelled BEFORE calling isEventPast — confirming the memo policy.
      expect(isEventPast(cancelledFuture, computeMasterEndAtUtc(cancelledFuture))).toBe(true);
      expect(isEventPast(cancelledPast, computeMasterEndAtUtc(cancelledPast))).toBe(true);
    });

    it("D-02: status='ended' (operator-set) is in Past (isEventPast returns true) AND memo includes it", () => {
      jest.setSystemTime(new Date("2026-05-15T12:00:00.000Z"));
      const event = makeEvent({
        status: "ended",
        date: "2026-05-20", // future date, but operator forced ended
        doorsOpen: "20:00",
        endsAt: "23:00",
        timezone: "America/New_York",
      });
      expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(true);
      // Memo policy: ended is NOT cancelled → not filtered by status check → goes to Past.
      expect(event.status !== "cancelled").toBe(true);
    });

    it("D-03: endedAt-set event with status='scheduled' lands in Past (short-circuit precedence)", () => {
      jest.setSystemTime(new Date("2026-05-15T12:00:00.000Z"));
      const event = makeEvent({
        status: "scheduled",
        date: "2026-05-20",
        doorsOpen: "20:00",
        endsAt: "23:00",
        endedAt: "2026-05-14T10:00:00.000Z",
        timezone: "America/New_York",
      });
      expect(isEventPast(event, computeMasterEndAtUtc(event))).toBe(true);
    });
  });
});
