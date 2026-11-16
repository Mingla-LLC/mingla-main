/**
 * #4420 (R8 P15) — the Reservations "Tables" view model: who holds each table
 * at one time on one day, grouped by zone. Pure; no hooks.
 */
import { describe, expect, test } from "@jest/globals";

import type { Reservation, VenueTable } from "../../../types/venueReservation";
import {
  DEFAULT_TURN_MINUTES,
  defaultMinuteOfDay,
  stepMinuteOfDay,
  tableSlotsAt,
  turnMinutesFor,
  venueMinuteOfDay,
} from "../reservationTableSlots";

const table = (id: string, zone: VenueTable["zone"], isActive = true): VenueTable => ({
  id,
  brandId: "b",
  placePoolId: null,
  name: id,
  capacity: 4,
  minParty: null,
  maxParty: null,
  zone,
  seatingType: null,
  combinable: false,
  accessible: false,
  isActive,
  reservationPolicy: "reservable",
  sortOrder: 0,
  notes: null,
});

const booking = (over: Partial<Reservation>): Reservation => ({
  id: "r",
  brandId: "b",
  placePoolId: null,
  tableId: "t1",
  reservedFor: "2026-11-13T19:00:00.000Z",
  partySize: 2,
  status: "confirmed",
  source: "mingla",
  createdVia: "operator",
  guestName: "Chris",
  guestPhoneE164: null,
  guestEmail: null,
  consumerUserId: null,
  occasion: null,
  guestNotes: null,
  tags: [],
  feeCents: null,
  feeCurrency: null,
  paymentStatus: "none",
  createdAt: "2026-11-01T00:00:00.000Z",
  ...over,
});

const at = (reservations: Reservation[], minute: number, tables = [table("t1", "indoor"), table("t2", "indoor"), table("p1", "patio")]) =>
  tableSlotsAt({ tables, reservations, dayKey: "2026-11-13", minuteOfDay: minute, timeZone: "UTC", turnTimes: { p2: 75, p4: 90 } });

describe("#4420 reservation tables view", () => {
  test("a booking holds its table from its start for its party's turn, then frees it", () => {
    const r = [booking({})];
    expect(at(r, 19 * 60)[0].slots[0].state).toBe("booked");
    expect(at(r, 19 * 60 + 74)[0].slots[0].state).toBe("booked");
    expect(at(r, 19 * 60 + 75)[0].slots[0].state).toBe("free");
    expect(at(r, 18 * 60 + 59)[0].slots[0].state).toBe("free");
  });

  test("status maps to pending, seated and walk-in; released statuses hold nothing", () => {
    expect(at([booking({ status: "requested" })], 19 * 60)[0].slots[0].state).toBe("pending");
    expect(at([booking({ status: "seated" })], 19 * 60)[0].slots[0].state).toBe("seated");
    expect(at([booking({ source: "walk_in", status: "seated" })], 19 * 60)[0].slots[0].state).toBe("walkin");
    for (const status of ["completed", "no_show", "cancelled_by_guest", "cancelled_by_venue", "waitlisted"] as const) {
      expect(at([booking({ status })], 19 * 60)[0].slots[0].state).toBe("free");
    }
  });

  test("other days, unassigned bookings and inactive tables are left out; zones count free tables", () => {
    const zones = at(
      [booking({ reservedFor: "2026-11-14T19:00:00.000Z" }), booking({ id: "x", tableId: null })],
      19 * 60,
      [table("t1", "indoor"), table("t2", "indoor", false), table("p1", "patio")],
    );
    expect(zones.map((z) => [z.label, z.slots.length, z.freeCount])).toEqual([
      ["Indoor", 1, 1],
      ["Patio", 1, 1],
    ]);
  });

  test("turn length picks the smallest bucket that fits, else the largest, else the default", () => {
    expect(turnMinutesFor(2, { p2: 75, p4: 90, p6: 120 })).toBe(75);
    expect(turnMinutesFor(3, { p2: 75, p4: 90, p6: 120 })).toBe(90);
    expect(turnMinutesFor(9, { p2: 75, p4: 90, p6: 120 })).toBe(120);
    expect(turnMinutesFor(2, {})).toBe(DEFAULT_TURN_MINUTES);
    expect(turnMinutesFor(2, null)).toBe(DEFAULT_TURN_MINUTES);
  });

  test("minute of day reads the venue zone; the stepper stays inside the day", () => {
    expect(venueMinuteOfDay("2026-11-13T19:30:00.000Z", "UTC")).toBe(19 * 60 + 30);
    expect(venueMinuteOfDay("2026-11-14T00:30:00.000Z", "America/New_York")).toBe(19 * 60 + 30);
    expect(stepMinuteOfDay(0, -30)).toBe(0);
    expect(stepMinuteOfDay(23 * 60 + 30, 30)).toBe(23 * 60 + 30);
    expect(defaultMinuteOfDay(true, 19 * 60 + 47)).toBe(19 * 60 + 30);
    expect(defaultMinuteOfDay(false, 9 * 60)).toBe(19 * 60);
  });
});
