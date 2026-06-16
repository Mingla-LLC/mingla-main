/**
 * ORCH-1150 Step 11 — Hub RSVP "N going" metric (regression).
 *
 * The Hub event list-card shows "N going" for an RSVP event instead of revenue.
 * The count must include each guest's plus_count (a +2 guest is 3 toward the
 * cap), and the label must respect capacity + draft state.
 *
 * Fails-on-revert: dropping the `+ (r.plus_count ?? 0)` term (so plus-ones stop
 * counting) makes the plus-count assertion FAIL.
 */

import {
  sumRsvpGoingCount,
  formatRsvpGoingLabel,
} from "../rsvpHubMetrics";

describe("ORCH-1150 §8 step 11 — Hub RSVP going metric", () => {
  it("counts each guest PLUS their plus_count", () => {
    // guest A solo (1), guest B +2 (3), guest C +0 (1) → 5 going.
    expect(
      sumRsvpGoingCount([
        { plus_count: 0 },
        { plus_count: 2 },
        { plus_count: null },
      ]),
    ).toBe(5);
  });

  it("is 0 for an empty guest list", () => {
    expect(sumRsvpGoingCount([])).toBe(0);
  });

  it("shows 'N going' when capacity is unlimited", () => {
    expect(
      formatRsvpGoingLabel({ kind: "live", goingCount: 7, capacity: null }),
    ).toBe("7 going");
  });

  it("shows 'N / cap going' when capacity is finite", () => {
    expect(
      formatRsvpGoingLabel({ kind: "live", goingCount: 7, capacity: 20 }),
    ).toBe("7 / 20 going");
  });

  it("shows 'Not published' for a draft (no RSVPs yet)", () => {
    expect(
      formatRsvpGoingLabel({ kind: "draft", goingCount: 0, capacity: 10 }),
    ).toBe("Not published");
  });
});
