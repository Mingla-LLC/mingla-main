// ORCH-0828 — deriveLiveStatus timezone-aware verification.
//
// Pre-0828: `deriveLiveStatus(event)` did `new Date(event.date).getTime()`
// which parses "YYYY-MM-DD" as UTC midnight. For Big Party in
// America/New_York with date "2026-05-14" the parser returned
// 2026-05-14T00:00:00Z. At NOW=2026-05-14T05:38Z the helper placed the
// event in its "live" window even though the real start was 14+ hours
// later (20:00 UTC). The pill on the home tab read "LIVE NOW" while the
// event was unambiguously scheduled.
//
// Post-0828: caller passes `masterStartAtUtc: string | null` — the exact
// UTC instant — and the helper does pure UTC arithmetic with no implicit
// timezone interpretation. These tests pin the contract.

import { describe, expect, test } from "@jest/globals";

import type { LiveEvent } from "../../store/liveEventStore";
import { deriveLiveStatus } from "../eventLifecycle";

const BASE: Partial<LiveEvent> = {
  id: "evt-big-party",
  name: "Big Party",
  status: "scheduled",
  endedAt: null,
  date: "2026-05-14",
  doorsOpen: "16:00",
  endsAt: null,
  timezone: "America/New_York",
};

const cast = (patch: Partial<LiveEvent>): LiveEvent =>
  ({ ...BASE, ...patch }) as LiveEvent;

describe("deriveLiveStatus — ORCH-0828 timezone-aware contract", () => {
  test("T-12 upcoming when now is well before master start", () => {
    const realDateNow = Date.now;
    Date.now = (): number => Date.parse("2026-05-14T05:38:39.000Z");
    try {
      const status = deriveLiveStatus(cast({}), "2026-05-14T20:00:00.000Z");
      expect(status).toBe("upcoming");
    } finally {
      Date.now = realDateNow;
    }
  });

  test("T-13 live when now is inside the live window", () => {
    const realDateNow = Date.now;
    Date.now = (): number => Date.parse("2026-05-14T20:30:00.000Z");
    try {
      const status = deriveLiveStatus(cast({}), "2026-05-14T20:00:00.000Z");
      expect(status).toBe("live");
    } finally {
      Date.now = realDateNow;
    }
  });

  test("T-14 past when now is after live-window end", () => {
    const realDateNow = Date.now;
    Date.now = (): number => Date.parse("2026-05-16T00:00:00.000Z");
    try {
      const status = deriveLiveStatus(cast({}), "2026-05-14T20:00:00.000Z");
      expect(status).toBe("past");
    } finally {
      Date.now = realDateNow;
    }
  });

  test("T-15 cancelled overrides time math", () => {
    const status = deriveLiveStatus(
      cast({ status: "cancelled" }),
      "2026-05-14T20:00:00.000Z",
    );
    expect(status).toBe("cancelled");
  });

  test("T-16 upcoming when masterStartAtUtc is null", () => {
    const status = deriveLiveStatus(cast({ date: null }), null);
    expect(status).toBe("upcoming");
  });

  test("Bug C regression — date-only string no longer triggers premature 'live'", () => {
    // The pre-0828 bug: at NOW=2026-05-14T05:38Z, with event.date="2026-05-14",
    // the helper used to do `new Date("2026-05-14")` → 00:00 UTC → live window
    // ±4h/24h placed NOW *inside* the window. Post-0828, the helper must take
    // the UTC instant directly and refuse to interpret the date-only string
    // on its own.
    const realDateNow = Date.now;
    Date.now = (): number => Date.parse("2026-05-14T05:38:39.000Z");
    try {
      const status = deriveLiveStatus(cast({}), "2026-05-14T20:00:00.000Z");
      expect(status).not.toBe("live");
      expect(status).toBe("upcoming");
    } finally {
      Date.now = realDateNow;
    }
  });

  test("endedAt overrides time math", () => {
    const status = deriveLiveStatus(
      cast({ endedAt: "2026-05-14T22:00:00.000Z" }),
      "2026-05-14T20:00:00.000Z",
    );
    expect(status).toBe("past");
  });
});
