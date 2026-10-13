/**
 * issue #3645 — a cancelled event's manage screen says CANCELLED and still
 * shows when it was.
 *
 * Live test, 2026-10-13: after cancelling, the screen read "ENDED" and
 * "Date TBD".
 *
 *  - "Date TBD": the cancel (and end-ticket-sales) RPCs answer with the event
 *    row and tickets but no dates, and that dateless event was written straight
 *    over the cached one. `keepEventDatesAcrossLifecycleWrite` is executed here.
 *  - "ENDED": cancelled was folded into the "past" state. The pill is a React
 *    Native component; that it says CANCELLED first, that both manage screens
 *    tell it, and that cancel and end-ticket-sales write the cache through the
 *    date keeper, is enforced by the strict-grep gate
 *    .github/scripts/strict-grep/issue-3645-paid-drafts-stop-at-publish.mjs, group E-k.
 */

import { describe, expect, test } from "@jest/globals";

import { keepEventDatesAcrossLifecycleWrite } from "../lifecycleWriteKeepsDates";

interface TestEvent {
  id: string;
  status: string;
  date: string | null;
  doorsOpen: string | null;
  endsAt: string | null;
  masterStartAtUtc: string | null;
  masterEndAtUtc: string | null;
  timezone: string;
}

const dated: TestEvent = {
  id: "evt-1",
  status: "scheduled",
  date: "2026-11-20",
  doorsOpen: "19:00",
  endsAt: "23:00",
  masterStartAtUtc: "2026-11-20T18:00:00Z",
  masterEndAtUtc: "2026-11-20T22:00:00Z",
  timezone: "Africa/Lagos",
};
/** What the cancel RPC's answer maps to: the row's own timezone, no dates. */
const cancelledAnswer: TestEvent = {
  id: "evt-1",
  status: "cancelled",
  date: null,
  doorsOpen: null,
  endsAt: null,
  masterStartAtUtc: null,
  masterEndAtUtc: null,
  timezone: "UTC",
};

describe("#3645 keepEventDatesAcrossLifecycleWrite", () => {
  test("a cancelled event keeps the date it had, and takes the new status", () => {
    const merged = keepEventDatesAcrossLifecycleWrite(cancelledAnswer, dated);
    expect(merged).toEqual({
      id: "evt-1",
      status: "cancelled",
      date: "2026-11-20",
      doorsOpen: "19:00",
      endsAt: "23:00",
      masterStartAtUtc: "2026-11-20T18:00:00Z",
      masterEndAtUtc: "2026-11-20T22:00:00Z",
      timezone: "Africa/Lagos",
    });
  });

  test("an answer that DOES carry a date wins (a publish, an edit)", () => {
    const answer: TestEvent = { ...cancelledAnswer, date: "2026-12-01", doorsOpen: "20:00" };
    expect(keepEventDatesAcrossLifecycleWrite(answer, dated)).toBe(answer);
    const instantOnly: TestEvent = { ...cancelledAnswer, masterStartAtUtc: "2026-12-01T19:00:00Z" };
    expect(keepEventDatesAcrossLifecycleWrite(instantOnly, dated)).toBe(instantOnly);
  });

  test("nothing cached, or nothing dated cached: the answer is used as it is", () => {
    expect(keepEventDatesAcrossLifecycleWrite(cancelledAnswer, null)).toBe(cancelledAnswer);
    expect(keepEventDatesAcrossLifecycleWrite(cancelledAnswer, undefined)).toBe(cancelledAnswer);
    const undated: TestEvent = { ...dated, date: null, masterStartAtUtc: null };
    expect(keepEventDatesAcrossLifecycleWrite(cancelledAnswer, undated)).toBe(cancelledAnswer);
  });

  test("a different event's date is never borrowed", () => {
    expect(
      keepEventDatesAcrossLifecycleWrite(cancelledAnswer, { ...dated, id: "evt-2" }),
    ).toBe(cancelledAnswer);
  });

  test("the cached event is not mutated", () => {
    const before = JSON.stringify(dated);
    keepEventDatesAcrossLifecycleWrite(cancelledAnswer, dated);
    expect(JSON.stringify(dated)).toBe(before);
  });
});
