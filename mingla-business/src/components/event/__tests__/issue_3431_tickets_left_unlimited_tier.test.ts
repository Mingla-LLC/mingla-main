/**
 * #3431 (tutorial recording, 2026-09-17) — no event-level "N tickets left" pill
 * when a tier is unlimited.
 *
 * SYMPTOM: the hybrid Lantern Room event (in-person tier capped at 60, "Stream
 * pass" unlimited) showed a "60 tickets left" pill, as if the whole event had
 * 60 places. Once the room filled, the same pill would have said "Sold out"
 * while stream passes were still on sale.
 *
 * CAUSE: `ticketsLeftSummaryLabel` skipped unlimited tiers and summed the
 * capped ones.
 *
 * WHAT IS REAL: the shared helper from packages/offering-rendering, and the
 * source of `EventOfferingBody`, which renders the pill from that helper over
 * the visible tiers (the #3314 suite mounts the body and proves the pill prints
 * the helper's answer).
 *
 * FAILS ON REVERT: restore `if (t.isUnlimited) continue;` and H-1, H-2 go red.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ticketAvailabilityCaption,
  ticketsLeftSummaryLabel,
} from "../../../../../packages/offering-rendering/remainingCountVisibility";

const inPerson = { isUnlimited: false, capacity: 60 };
const streamPass = { isUnlimited: true, capacity: null };

describe("#3431 tickets-left pill with an unlimited tier", () => {
  test("H-1 the recording: 60 in-person places + an unlimited stream pass → no pill", () => {
    expect(ticketsLeftSummaryLabel([inPerson, streamPass], false)).toBeNull();
    expect(ticketsLeftSummaryLabel([streamPass, inPerson], false)).toBeNull();
  });

  test("H-2 a full room is not a sold-out event while the stream pass is on sale", () => {
    expect(
      ticketsLeftSummaryLabel([{ ...inPerson, capacity: 0 }, streamPass], false),
    ).toBeNull();
    expect(
      ticketsLeftSummaryLabel([{ ...inPerson, capacity: 0 }, streamPass], true),
    ).toBeNull();
  });

  test("H-3 each tier keeps its own caption", () => {
    expect(ticketAvailabilityCaption(inPerson, false)).toBe("60 available");
    expect(ticketAvailabilityCaption(streamPass, false)).toBe("Unlimited");
  });

  test("H-4 capped-only events are unchanged (#3314 rules still apply)", () => {
    expect(ticketsLeftSummaryLabel([inPerson], false)).toBe("60 tickets left");
    expect(
      ticketsLeftSummaryLabel([inPerson, { isUnlimited: false, capacity: 40 }], false),
    ).toBe("100 tickets left");
    expect(ticketsLeftSummaryLabel([inPerson], true)).toBeNull();
    expect(ticketsLeftSummaryLabel([{ ...inPerson, capacity: 0 }], false)).toBe("Sold out");
    expect(ticketsLeftSummaryLabel([streamPass], false)).toBeNull();
    expect(ticketsLeftSummaryLabel([], false)).toBeNull();
  });

  test("H-5 the event page pill is this helper over the visible tiers", () => {
    const body = readFileSync(
      path.resolve(__dirname, "../../../../../packages/offering-rendering/EventOfferingBody.tsx"),
      "utf8",
    );
    expect(body).toMatch(
      /ticketsLeftSummaryLabel\(visibleTickets, hideRemainingCount\)/,
    );
    expect(body).toMatch(/ticketsLeftLabel !== null \? \(\s*<Pill/);
  });
});
