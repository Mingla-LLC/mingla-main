/**
 * issue #2590 — the caution must fire on the event that motivated it.
 *
 * THIS TEST EXISTS BECAUSE I GOT IT WRONG. The first version of this rule lived
 * inline in `TicketTierEditSheet` and compared the sale end against the event's
 * FIRST occurrence only. Against We Go Again Exhibition — the live event whose
 * broken cut-off started this whole issue — that comparison reports nothing:
 * sales close at 07:00 on the 30th, which is a day AFTER Day 1 opened. Day 2 is
 * the unbuyable day, and only the event's END reveals it.
 *
 * A rule that misses its own motivating case is worse than no rule: it looks
 * like coverage. Every number below is the real row.
 *
 * DIFFERENT ANGLE from the guard-copy tests, which cover what the SERVER
 * refuses. This covers what the CLIENT warns about before anything is sent.
 *
 * FAILS ON REVERT: drop the `closes-mid-event` arm and the We Go Again case
 * fails; compare against the first occurrence alone and it fails the same way.
 */
import { describe, expect, test } from "@jest/globals";

import { saleWindowCaution } from "../saleWindowCaution";

// We Go Again Exhibition, exactly as stored.
const WGA_STARTS = "2026-08-29T12:00:00Z"; // Day 1, 13:00 Lagos
const WGA_ENDS = "2026-08-30T19:00:00Z"; // Day 2 ends, 20:00 Lagos
const WGA_SALE_END = "2026-08-30T06:00:44Z"; // 07:00 Lagos on Day 2

describe("issue #2590 — a window that leaves part of the event unbuyable", () => {
  test("WE GO AGAIN: sales stopping mid-run IS caught", () => {
    // The regression this file exists for. A first-occurrence-only rule returns
    // null here, because 30 Aug 06:00 is after 29 Aug 12:00.
    expect(saleWindowCaution(WGA_SALE_END, WGA_STARTS, WGA_ENDS)).toBe(
      "closes-mid-event",
    );
  });

  test("WE GO AGAIN: moving the close to the event's end clears it", () => {
    // The fix Seth would actually apply — 20:00 Lagos on Day 2.
    expect(saleWindowCaution(WGA_ENDS, WGA_STARTS, WGA_ENDS)).toBeNull();
  });

  test("a single-day event closing before doors is caught", () => {
    expect(
      saleWindowCaution(
        "2026-08-29T06:00:00Z",
        "2026-08-29T12:00:00Z",
        "2026-08-29T19:00:00Z",
      ),
    ).toBe("closes-before-doors");
  });

  test("the two shapes are never confused", () => {
    // Before doors must not report as mid-event, or the organiser is told the
    // wrong thing about a worse problem.
    expect(
      saleWindowCaution("2026-08-28T06:00:00Z", WGA_STARTS, WGA_ENDS),
    ).toBe("closes-before-doors");
  });

  test("selling right through the event is silent", () => {
    expect(
      saleWindowCaution("2026-08-31T00:00:00Z", WGA_STARTS, WGA_ENDS),
    ).toBeNull();
  });

  test("closing exactly at the final bell is silent, not a caution", () => {
    // Boundary. Sales open until the last moment is a complete window, and
    // firing here would make the caution noise an organiser learns to ignore.
    expect(saleWindowCaution(WGA_ENDS, WGA_STARTS, WGA_ENDS)).toBeNull();
  });

  test("no sale end at all is silent", () => {
    expect(saleWindowCaution(null, WGA_STARTS, WGA_ENDS)).toBeNull();
  });

  test("missing or unparseable event bounds stay silent", () => {
    // Absence of data is not evidence of a problem — the same principle the
    // #2562 past-event rule is built on. A caution fired on a half-loaded
    // screen trains organisers to dismiss it.
    expect(saleWindowCaution(WGA_SALE_END, null, WGA_ENDS)).toBeNull();
    expect(saleWindowCaution(WGA_SALE_END, "not-a-date", WGA_ENDS)).toBeNull();
    expect(saleWindowCaution(WGA_SALE_END, WGA_STARTS, null)).toBe(null);
  });
});
