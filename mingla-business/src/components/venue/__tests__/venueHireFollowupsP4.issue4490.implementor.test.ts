/**
 * #4490 P4 follow-ups (UI) — "Hours you set" on the Host (draft, checks,
 * payload, per-hour rows) and for the guest (the day's start times, lengths,
 * which places are free, the request address), changing a hire's guests
 * within its place, and the refundable damage deposit in plain words for
 * the Host and the guest.
 */
import {
  damageDepositGuestLine,
  hireChangeRange,
  hireRequestPath,
  hourLengthsFor,
  hourPlaceFree,
  parseHireBooking,
  parseHireHourDay,
  parseHireRequestParams,
  venueClockRange,
} from "@mingla/brand-rendering/venueOffers/hireModel";

import { damageDepositWords, hireGuestRangeFor } from "../features/bookings/bookingModel";
import { flexIssue, flexPayload, hireChangeRulesPayload, hireChangeWords, hireDraftFrom, rowPayload, sameFlex } from "../features/offers/hireModel";
import { mapDamageDeposit } from "../../../services/venueOffersService";

describe("P4 follow-up: Hours you set (Host)", () => {
  const base = hireDraftFrom(null);

  it("starts off, and checks the hours in plain words", () => {
    expect(base.flexOn).toBe(false);
    expect(flexIssue(base)).toBeNull();
    const on = { ...base, flexOn: true, flexStart: "10:00", flexEnd: "22:00", flexStep: 60, flexMinMinutes: 240, flexMaxMinutes: 0 };
    expect(flexIssue(on)).toBeNull();
    expect(flexIssue({ ...on, flexEnd: "10:00" })).toMatch(/different start and end/);
    expect(flexIssue({ ...on, flexStart: "20:00", flexEnd: "22:00" })).toMatch(/longer than the hours/);
    expect(flexIssue({ ...on, flexMaxMinutes: 120 })).toMatch(/can't be shorter/);
    // Past midnight counts as one stretch: 20:00–02:00 is 6 hours.
    expect(flexIssue({ ...on, flexStart: "20:00", flexEnd: "02:00" })).toBeNull();
  });

  it("sends the server's set_flexible shape and only when something changed", () => {
    const on = { ...base, flexOn: true, weekdays: [5, 4], flexStart: "10:00", flexEnd: "22:00", flexStep: 30, flexMinMinutes: 180, flexMaxMinutes: 0 };
    expect(flexPayload(on)).toEqual({ enabled: true, weekdays: [4, 5], startTime: "10:00", endTime: "22:00", stepMinutes: 30, minMinutes: 180, maxMinutes: null });
    expect(flexPayload(base)).toEqual({ enabled: false });
    const saved = { ruleId: "r", weekdays: [4, 5], startTime: "10:00", endTime: "22:00", pastMidnight: false, minMinutes: 180, maxMinutes: null, stepMinutes: 30 };
    expect(sameFlex(saved, on)).toBe(true);
    expect(sameFlex(saved, { ...on, flexMinMinutes: 240 })).toBe(false);
    expect(sameFlex(null, base)).toBe(true);
    expect(sameFlex(saved, base)).toBe(false);
  });

  it("prices a row per hour when asked", () => {
    const row = { key: "k", optionId: null, place: "s:space-1", guestMin: 10, guestMax: 50, priceMinor: 5000000, weekdays: [], perHour: true };
    expect(rowPayload(row, base, [], 0).unit).toBe("hour");
    expect(rowPayload({ ...row, perHour: false }, base, [], 0).unit).toBe("booking");
  });
});

describe("P4 follow-up: Hours you set (guest)", () => {
  const day = parseHireHourDay({
    status: "open",
    windowId: "w-flex",
    opensAt: "2026-12-12T09:00:00Z",
    closesAt: "2026-12-12T21:00:00Z",
    stepMinutes: 60,
    minMinutes: 180,
    maxMinutes: null,
    setupMinutes: 60,
    cleanupMinutes: 60,
    places: [
      { key: "a", name: "The Lounge Side", spaceIds: ["l"], priceOptionId: "o1", busy: [{ from: "2026-12-12T15:00:00Z", to: "2026-12-12T18:00:00Z" }] },
      { key: "b", name: "Green Area North", spaceIds: ["n"], priceOptionId: "o2", busy: [] },
    ],
    starts: [
      { startsAt: "2026-12-12T09:00:00Z", maxMinutes: 720, places: 2 },
      { startsAt: "2026-12-12T17:00:00Z", maxMinutes: 240, places: 1 },
    ],
  })!;

  it("reads the day and lists lengths from the shortest up to the longest free booking", () => {
    expect(day.status).toBe("open");
    expect(day.starts[1].startsAt).toBe("2026-12-12T17:00:00.000Z");
    expect(hourLengthsFor(day, "2026-12-12T17:00:00.000Z")).toEqual([180, 240]);
    expect(hourLengthsFor(day, "2026-12-12T09:00:00.000Z")).toHaveLength(10);
    expect(hourLengthsFor(day, null)).toEqual([]);
    expect(venueClockRange(day.opensAt, day.closesAt, "Africa/Lagos")).toBe("10:00–22:00");
    expect(parseHireHourDay({ status: "nope" })).toBeNull();
  });

  it("frees a place only when its busy times miss the booking with setup and cleanup", () => {
    // 09:00–12:00 needs 08:00–13:00: the Lounge's 15:00 hire is clear.
    expect(hourPlaceFree(day.places[0], "2026-12-12T09:00:00Z", 180, 60, 60)).toBe(true);
    // 11:00–14:00 needs until 15:00: touches the next hire's setup start, still free.
    expect(hourPlaceFree(day.places[0], "2026-12-12T11:00:00Z", 180, 60, 60)).toBe(true);
    expect(hourPlaceFree(day.places[0], "2026-12-12T12:00:00Z", 180, 60, 60)).toBe(false);
  });

  it("carries the start and length in the request address and back", () => {
    const path = hireRequestPath({
      brandSlug: "harmattan-qa-local",
      venueSlug: "gamelandqa",
      offerId: "11111111-1111-4111-8111-111111111111",
      date: "2026-12-12",
      windowId: "22222222-2222-4222-8222-222222222222",
      guests: 40,
      priceOptionId: "33333333-3333-4333-8333-333333333333",
      startsAt: "2026-12-12T09:00:00Z",
      minutes: 240,
    });
    expect(path).toContain("&s=2026-12-12T09%3A00%3A00.000Z&m=240");
    const params = Object.fromEntries(new URL(`https://x${path}`).searchParams.entries());
    expect(parseHireRequestParams(params)).toEqual({
      date: "2026-12-12",
      windowId: "22222222-2222-4222-8222-222222222222",
      guests: 40,
      priceOptionId: "33333333-3333-4333-8333-333333333333",
      startsAt: "2026-12-12T09:00:00.000Z",
      minutes: 240,
    });
    expect(parseHireRequestParams({ ...params, m: "5" })).not.toHaveProperty("minutes");
  });
});

describe("P4 follow-up: changing a hire", () => {
  it("starts with no online changes and sends only what the Host turned on", () => {
    const d = hireDraftFrom(null);
    expect(hireChangeRulesPayload(d)).toEqual({ allowedUntilMinutesBefore: null, maxChanges: null, feeBps: null, guestChangeUntilMinutesBefore: null });
    expect(hireChangeWords(d)).toBe("Changes are agreed with you, not online");
    const on = { ...d, guestChangeOn: true, guestChangeCutoffMinutes: 10080, dateChange: true, moveCutoffMinutes: 4320, maxChanges: 2, changeFeePercent: 10 };
    expect(hireChangeRulesPayload(on)).toEqual({ allowedUntilMinutesBefore: 4320, maxChanges: 2, feeBps: 1000, guestChangeUntilMinutesBefore: 10080 });
    expect(hireChangeWords(on)).toBe("Numbers up to 7 days before · Another day up to 3 days before, 2 times, 10% fee");
  });

  const rows = [{ optionId: "o1", unit: "booking" as const, guestMin: 60, guestMax: 150, capacity: 200 }];
  it("lets the guests go up to the place's capacity only when extra guests are sold", () => {
    expect(hireChangeRange({ rows: rows as never, extraGuestMinor: null }, "o1")).toEqual({ min: 60, max: 150 });
    expect(hireChangeRange({ rows: rows as never, extraGuestMinor: 500000 }, "o1")).toEqual({ min: 60, max: 200 });
    expect(hireChangeRange({ rows: rows as never, extraGuestMinor: null }, "nope")).toBeNull();
    expect(hireGuestRangeFor({ rows: rows as never, extraGuestMinor: 500000 }, "o1")).toEqual({ min: 60, max: 200 });
    expect(hireGuestRangeFor(null, "o1")).toBeNull();
  });
});

describe("P4 follow-up: the damage deposit", () => {
  const raw = {
    amountMinor: 50000000,
    paidMinor: 50000000,
    status: "collected",
    hireEndsAt: "2026-12-12T22:00:00Z",
    releaseAt: "2026-12-19T22:00:00Z",
  };

  it("reads the server state; none is no deposit", () => {
    expect(mapDamageDeposit(raw)?.status).toBe("collected");
    expect(mapDamageDeposit({ ...raw, status: "none" })).toBeNull();
    expect(mapDamageDeposit(null)).toBeNull();
  });

  it("tells the Host when it goes back and whether it can be returned yet", () => {
    const d = mapDamageDeposit(raw)!;
    const before = damageDepositWords(d, "NGN", "Africa/Lagos", Date.parse("2026-12-12T12:00:00Z"));
    expect(before.pill).toBe("Held");
    expect(before.ended).toBe(false);
    expect(before.body).toContain("₦500,000 held. It goes back to the guest by itself on Sat 19 Dec");
    expect(damageDepositWords(d, "NGN", "Africa/Lagos", Date.parse("2026-12-13T12:00:00Z")).ended).toBe(true);
    const kept = mapDamageDeposit({ ...raw, status: "released", refundedMinor: 30000000, keptMinor: 20000000, keptReason: "Broken table", releasedAt: "2026-12-14T10:00:00Z", releaseAt: null })!;
    const words = damageDepositWords(kept, "NGN", "Africa/Lagos", Date.now());
    expect(words.pill).toBe("Partly returned");
    expect(words.body).toBe("₦300,000 returned on Mon 14 Dec. Kept ₦200,000: Broken table.");
    const held = damageDepositWords(mapDamageDeposit({ ...raw, status: "held_by_venue", heldReason: "Checking a stain", releaseAt: null })!, "NGN", "Africa/Lagos", Date.now());
    expect(held.body).toBe("₦500,000 held: Checking a stain. It won't go back by itself.");
  });

  it("tells the guest in plain words", () => {
    const booking = parseHireBooking({ totalMinor: 1, hire: { damageDeposit: raw } })!;
    expect(booking.damageDeposit?.status).toBe("collected");
    expect(damageDepositGuestLine(booking.damageDeposit!, "NGN", 2, "Africa/Lagos")).toBe(
      "₦500,000 damage deposit held. It comes back to you by Sat 19 Dec if nothing was damaged.",
    );
    const part = parseHireBooking({ hire: { damageDeposit: { ...raw, status: "released", refundedMinor: 30000000, keptMinor: 20000000, keptReason: "Broken table" } } })!;
    expect(damageDepositGuestLine(part.damageDeposit!, "NGN", 2, null)).toBe(
      "₦300,000 of your damage deposit is on its way back. The venue kept ₦200,000: Broken table.",
    );
    expect(parseHireBooking({ hire: { damageDeposit: { status: "none" } } })?.damageDeposit).toBeNull();
  });
});
