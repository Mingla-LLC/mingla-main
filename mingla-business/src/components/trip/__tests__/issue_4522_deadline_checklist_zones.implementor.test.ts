// MINGLA-INVARIANT: I-4522-DEADLINE-ONE-DATE-RULE | issue #4522 | The publish checklist, the deadline picker bounds and the deadline save check agree: a booking deadline is valid up to the end of the day before departure in the trip's time zone (the stored start is a calendar date), in every zone and across clock changes.
/**
 * Issue #4522 X-1 — the publish checklist compared the booking deadline with
 * the trip start as stored (the calendar date at UTC midnight, #4420). A New
 * York trip leaving 12 Mar starts its day at 05:00Z, so a deadline the picker
 * offers (11 Mar 23:45 New York = 12 Mar 04:45Z) kept "Booking deadline before
 * the trip starts" open and Publish locked; in Tokyo the reverse let a
 * deadline after departure began pass.
 *
 * One rule (commit 71be29df2a): a trip date is its stored calendar date and the
 * trip's zone gives the times. Fails without the fix: the New York, DST and
 * Tokyo cases.
 */

import { describe, expect, test } from "@jest/globals";

import {
  buildPublishChecklist,
  deadlineBounds,
  deadlineProblem,
  instantFromWall,
  type ChecklistInput,
} from "../tripBuilderV2Model";

const BASE: ChecklistInput = {
  title: "Trip",
  description: "A trip description long enough.",
  hasCover: true,
  startAt: null,
  endAt: null,
  placesValid: true,
  days: [{ ordinal: 1, title: "Arrive", narrative: "" }],
  packagesOk: true,
  hasPricedPackage: true,
  planOk: true,
  bookingDeadline: null,
  payoutsReady: true,
  invitesReady: true,
};

const deadlineDone = (startAt: string, timeZone: string, deadline: string): boolean =>
  buildPublishChecklist({ ...BASE, startAt, endAt: startAt, bookingDeadline: deadline, timeZone })
    .find((item) => item.key === "deadline")!.done;

// Wall clock in the zone -> the stored instant (what the picker saves).
const at = (date: string, time: string, timeZone: string): string => {
  const iso = instantFromWall(date, time, timeZone);
  if (iso === null) throw new Error(`no instant for ${date} ${time} ${timeZone}`);
  return iso;
};

const NOW = new Date("2026-11-23T12:00:00Z");

describe("#4522 X-1 booking deadline vs departure, one date rule", () => {
  const cases: Array<{ zone: string; start: string; eve: string; day: string }> = [
    { zone: "America/New_York", start: "2027-03-12T00:00:00.000Z", eve: "2027-03-11", day: "2027-03-12" },
    { zone: "Africa/Lagos", start: "2027-03-12T00:00:00.000Z", eve: "2027-03-11", day: "2027-03-12" },
    { zone: "Asia/Tokyo", start: "2027-03-12T00:00:00.000Z", eve: "2027-03-11", day: "2027-03-12" },
    // New York clocks go forward on 14 Mar 2027: departure on that day and the day after.
    { zone: "America/New_York", start: "2027-03-14T00:00:00.000Z", eve: "2027-03-13", day: "2027-03-14" },
    { zone: "America/New_York", start: "2027-03-15T00:00:00.000Z", eve: "2027-03-14", day: "2027-03-15" },
    // London clocks go back on 31 Oct 2027.
    { zone: "Europe/London", start: "2027-11-01T00:00:00.000Z", eve: "2027-10-31", day: "2027-11-01" },
  ];

  test.each(cases)("$zone departing $day: 23:45 on the eve publishes, 00:00 on the day does not", ({ zone, start, eve, day }) => {
    expect(deadlineDone(start, zone, at(eve, "23:45", zone))).toBe(true);
    expect(deadlineDone(start, zone, at(eve, "23:59", zone))).toBe(true);
    expect(deadlineDone(start, zone, at(eve, "19:00", zone))).toBe(true);
    expect(deadlineDone(start, zone, at(day, "00:00", zone))).toBe(false);
    expect(deadlineDone(start, zone, at(day, "09:00", zone))).toBe(false);
  });

  test.each(cases)("$zone departing $day: the latest deadline the picker offers is one the checklist and save accept", ({ zone, start, eve }) => {
    const bounds = deadlineBounds(start, zone, NOW);
    expect(bounds.max).toBe(eve);
    const latest = at(bounds.max!, bounds.maxTime ?? "23:45", zone);
    expect(deadlineDone(start, zone, latest)).toBe(true);
    expect(deadlineProblem(latest, start, NOW.getTime(), zone)).toBeNull();
  });

  test("no deadline, or no dates yet, leaves the item met; no zone reads UTC as before", () => {
    expect(deadlineDone("2027-03-12T00:00:00.000Z", "America/New_York", null as unknown as string)).toBe(true);
    const item = buildPublishChecklist({ ...BASE, bookingDeadline: "2027-03-11T23:45:00.000Z" })
      .find((i) => i.key === "deadline")!;
    expect(item.done).toBe(true);
    const utc = buildPublishChecklist({
      ...BASE,
      startAt: "2027-03-12T00:00:00.000Z",
      endAt: "2027-03-12T00:00:00.000Z",
      bookingDeadline: "2027-03-12T00:00:00.000Z",
    }).find((i) => i.key === "deadline")!;
    expect(utc.done).toBe(false);
  });
});
