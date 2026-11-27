// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// #4630 tester adversarial suite for the brand chat banner: state boundaries
// the implementor's suite does not pin (end exactly now, tomorrow at 00:00, a
// multi-day booking in progress, unsorted server rows, ended rows inside the
// list, Removed beating an error, an in-progress brand offering).
//
// FAILS-ON-REVERT: drop the `start <= now` clause of isBookingLiveToday
// (T-BANNER-3 fails), drop the client re-sort of myBookings (T-BANNER-4 fails),
// count ended bookings in "+N more" (T-BANNER-5 fails), or let an error beat
// Removed (T-BANNER-7 fails).
import { brandChatBannerState, parseBrandChatSummary } from "../brandChatBannerModel.ts";

function eq(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n  expected ${b}\n  actual   ${a}`);
}

const now = new Date(2026, 10, 26, 15, 30, 0); // local 15:30
const local = (dayOffset: number, h: number, m = 0) => new Date(2026, 10, 26 + dayOffset, h, m, 0).toISOString();
const booking = (id: string, startsAt: string | null, endsAt: string | null, extra = {}) => ({
  kind: "order", id, eventId: `ev-${id}`, eventSlug: `slug-${id}`, offeringType: "event", title: `E ${id}`,
  coverMediaUrl: null, startsAt, endsAt, timezone: "UTC", ticketCount: 1, ...extra,
});
const summary = (extra = {}) => parseBrandChatSummary({
  member: true, brandSlug: "vibe", brandName: "Vibe", myBookings: [], hasPastBookings: false, brandUpcoming: [], ...extra,
});
const state = (s, extra = {}) => brandChatBannerState({ summary: s, now, ...extra });

Deno.test("T-BANNER-1 a booking ending exactly now is still live today", () => {
  eq(state(summary({ myBookings: [booking("a", local(0, 13), now.toISOString())] })).kind, "live_today", "end == now is not ended");
});

Deno.test("T-BANNER-2 tomorrow at 00:00 is next up in 1 day, not today", () => {
  const s = state(summary({ myBookings: [booking("a", local(1, 0), local(1, 2))] }));
  eq([s.kind, s.days], ["next_with_ticket", 1], "midnight belongs to tomorrow");
});

Deno.test("T-BANNER-3 a multi-day booking that started yesterday and ends tomorrow is live today", () => {
  eq(state(summary({ myBookings: [booking("trip", local(-1, 10), local(1, 18), { offeringType: "trip" })] })).kind,
    "live_today", "in progress counts as today");
});

Deno.test("T-BANNER-4 unsorted server rows: the soonest leads, the rest are +N", () => {
  const s = state(summary({ myBookings: [booking("late", local(9, 20), local(9, 23)), booking("soon", local(2, 20), local(2, 23))] }));
  eq([s.kind, s.booking.id, s.moreCount], ["multiple_with_ticket", "soon", 1], "soonest first");
});

Deno.test("T-BANNER-5 an ended booking inside the list never counts toward +N more", () => {
  const s = state(summary({ myBookings: [booking("gone", local(-3, 20), local(-3, 23)), booking("next", local(4, 20), local(4, 23))] }));
  eq([s.kind, s.booking.id], ["next_with_ticket", "next"], "one upcoming booking: no +N");
});

Deno.test("T-BANNER-6 a plus-one RSVP's ticket pill opens its own guest row", () => {
  const s = state(summary({ myBookings: [booking("guest-row-1", local(5, 20), local(5, 22), { kind: "rsvp" })] }));
  eq(s.bookingHref, "/purchases/rsvp/guest-row-1", "the id the server returns (guest row) is the route");
});

Deno.test("T-BANNER-7 Removed beats an error and a non-member's stale data never shows an error", () => {
  eq(brandChatBannerState({ summary: undefined, now, isError: true, removed: true }).kind, "hidden", "Removed: nothing, not even retry");
  eq(brandChatBannerState({ summary: parseBrandChatSummary({ member: false }), now, isError: true }).kind, "hidden",
    "a non-member with a failed refresh: nothing");
});

Deno.test("T-BANNER-8 an offering already under way is skipped for the next one (brandUpcoming has no end)", () => {
  const offering = (id: string, startsAt: string) => ({ offeringId: id, offeringType: "event", offeringSlug: id, title: id, coverMediaUrl: null, startsAt });
  const s = state(summary({ brandUpcoming: [offering("running", local(0, 14)), offering("friday", local(2, 21))] }));
  eq([s.kind, s.offering.offeringId], ["next_no_ticket", "friday"], "the next one that has not started");
  eq(state(summary({ brandUpcoming: [offering("running", local(0, 14))] })).kind, "nothing_upcoming",
    "only an under-way offering: the slim line");
});

Deno.test("T-BANNER-9 a booking with no start is never shown (no dead pill)", () => {
  eq(state(summary({ myBookings: [booking("nostart", null, null)] })).kind, "nothing_upcoming", "no start, no end: ignored");
});
