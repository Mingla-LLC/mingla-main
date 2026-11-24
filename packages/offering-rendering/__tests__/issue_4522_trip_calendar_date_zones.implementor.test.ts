/**
 * issue #4522 W-1 — a trip's dates are CALENDAR DATES stored as UTC midnight
 * (#4420) and read as the stored Y-M-D everywhere; the trip time zone gives
 * only the times (booking day, 09:00 due instants, when the plan closes).
 *
 * The schedule mirror read the start in the trip zone instead, so a New York
 * trip on 12 Mar (stored 2027-03-12T00:00Z = 11 Mar 19:00 New York) put "last
 * one 30 days before departure" on 9 Feb, 31 days before the date shown. The
 * pg17 suite pins the same answers for `issue_4522_plan_v2_schedule`.
 *
 * Fails without the fix: the New York and DST cases land a day early.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  computeTripPlanV2Schedule,
  tripBookingClosesAt,
  tripCalendarDayAt,
  type TripPaymentPlanV2,
} from "../tripPlanV2Math.ts";

const PLAN: TripPaymentPlanV2 = {
  v: 2,
  deposit: { mode: "amount", amount_minor: 30_000 },
  count: 3,
  final_due_days_before_start: 30,
  auto_adjust: true,
};

const finalDue = (startUtcMidnight: string, timeZone: string, booked: string) =>
  computeTripPlanV2Schedule({
    lineNetMinor: 120_000,
    units: 1,
    plan: PLAN,
    tripStartAt: new Date(startUtcMidnight),
    timeZone,
    bookedAt: new Date(booked),
  });

Deno.test("W-1: 30 days before a 12 Mar trip is 10 Feb at 09:00 local, in every zone", () => {
  // West of UTC (the defect), on UTC, east of UTC.
  const cases: Array<[string, string]> = [
    ["America/New_York", "2027-02-10T14:00:00Z"],
    ["Africa/Lagos", "2027-02-10T08:00:00Z"],
    ["Asia/Tokyo", "2027-02-10T00:00:00Z"],
    ["UTC", "2027-02-10T09:00:00Z"],
  ];
  for (const [zone, expected] of cases) {
    const s = finalDue("2027-03-12T00:00:00Z", zone, "2026-11-23T15:00:00Z");
    assertEquals(s.availability, "plan", zone);
    assertEquals(s.final_due_at, expected, zone);
    assertEquals(s.rows[s.rows.length - 1].due_at, expected, zone);
  }
});

Deno.test("W-1: across a DST change the final row stays on the calendar date, 09:00 local", () => {
  // New York springs forward on 14 Mar 2027: a 15 Apr trip, final 30 days
  // before = 16 Mar, already on daylight time (UTC-4).
  const s = finalDue("2027-04-15T00:00:00Z", "America/New_York", "2026-11-23T15:00:00Z");
  assertEquals(s.final_due_at, "2027-03-16T13:00:00Z");
});

Deno.test("W-1: the plan closes when the departure day begins in the trip zone", () => {
  // 11 Mar 20:00 New York is after the stored instant (11 Mar 19:00 New York)
  // but still the day before departure: inside the final window, not closed.
  const evening = finalDue("2027-03-12T00:00:00Z", "America/New_York", "2027-03-12T01:00:00Z");
  assertEquals(evening.availability, "full_window");
  const departureDay = finalDue("2027-03-12T00:00:00Z", "America/New_York", "2027-03-12T05:00:00Z");
  assertEquals(departureDay.availability, "closed");
});

Deno.test("W-1: tripCalendarDayAt books on the calendar date in the zone", () => {
  const start = new Date("2027-03-12T00:00:00Z");
  assertEquals(tripCalendarDayAt(start, 60, "America/New_York", 12).toISOString(), "2027-01-11T17:00:00.000Z");
  assertEquals(tripCalendarDayAt(start, 60, "Asia/Tokyo", 12).toISOString(), "2027-01-11T03:00:00.000Z");
  assertEquals(tripCalendarDayAt(start, 0, "Africa/Lagos", 0).toISOString(), "2027-03-11T23:00:00.000Z");
});

// issue #4522 G-6 (S2) — bookings close when the departure day begins in the
// trip's zone; public.issue_4522_trip_booking_closed (pg17 section L of the
// refunds suite) answers from the same instants. Before: the buyer page added
// 24 hours to the stored end (UTC midnight based) and the server compared the
// end instant, so New York stopped at 19:59 on the last day and Tokyo sold
// until 08:59 the next day.
Deno.test("G-6: a trip stops taking bookings at 00:00 on its departure day in its zone", () => {
  const start = new Date("2027-03-20T00:00:00Z"); // departs 20 Mar (calendar date)
  assertEquals(tripBookingClosesAt(start, "America/New_York").toISOString(), "2027-03-20T04:00:00.000Z");
  assertEquals(tripBookingClosesAt(start, "Africa/Lagos").toISOString(), "2027-03-19T23:00:00.000Z");
  assertEquals(tripBookingClosesAt(start, "Asia/Tokyo").toISOString(), "2027-03-19T15:00:00.000Z");
  // across the New York DST change (8 Mar 2027 is still EST, 15 Mar EDT)
  assertEquals(tripBookingClosesAt(new Date("2027-03-14T00:00:00Z"), "America/New_York").toISOString(),
    "2027-03-14T05:00:00.000Z");
  assertEquals(tripBookingClosesAt(new Date("2027-03-15T00:00:00Z"), "America/New_York").toISOString(),
    "2027-03-15T04:00:00.000Z");
});

