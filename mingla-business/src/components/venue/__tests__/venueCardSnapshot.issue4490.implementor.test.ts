import type { StayStaffReservationList } from "../../../types/stayReservation";
import type { VenueDay, VenueRequestsList } from "../../../types/venueOffers";
import type {
  Reservation,
  WaitlistEntry,
} from "../../../types/venueReservation";
import { featureSetFrom } from "../../../types/venueFeatures";
import {
  doorSnapshot,
  requestSnapshot,
  setupSnapshot,
  staySnapshot,
  tableSnapshot,
  venueCardSnapshotKind,
} from "../venueCardSnapshotModel";

describe("#4490 Hub venue-card operational snapshots", () => {
  test("the feature mix chooses a truthful, useful queue and keeps door priority", () => {
    expect(venueCardSnapshotKind(featureSetFrom({ stays: true }), "stay")).toBe("stay");
    expect(
      venueCardSnapshotKind(
        featureSetFrom({ entry: true, private_hire: true, table_reservations: true }),
        "club",
      ),
    ).toBe("door");
    expect(
      venueCardSnapshotKind(featureSetFrom({ private_hire: true }), "event_space"),
    ).toBe("requests");
    expect(
      venueCardSnapshotKind(featureSetFrom({ table_reservations: true }), "restaurant"),
    ).toBe("tables");
    expect(venueCardSnapshotKind(featureSetFrom({ menu: true }), "restaurant")).toBe(
      "setup",
    );
  });

  test("Entry preserves In now, To arrive and Paying now without losing data", () => {
    const day = {
      pools: [],
      offers: [],
      checkIn: { passes: 8, expected: 12, admitted: 5 },
      bookings: [
        { state: "instant_payment_pending", currencyCode: "NGN" },
        { state: "confirmed", currencyCode: "NGN" },
      ],
    } as unknown as VenueDay;
    expect(doorSnapshot(day)).toEqual([
      { key: "in", label: "In now", value: "5" },
      { key: "arrive", label: "To arrive", value: "7" },
      { key: "paying", label: "Paying now", value: "1" },
    ]);
  });

  test("private hire shows the request inbox that needs action", () => {
    const list = {
      counts: {
        toAnswer: 3,
        waitingForDeposit: 2,
        confirmed: 7,
        closed: 4,
        moneyDue: 1,
      },
      requests: [],
    } satisfies VenueRequestsList;
    expect(requestSnapshot(list).map(({ label, value }) => `${label}:${value}`)).toEqual([
      "To answer:3",
      "Deposit due:2",
      "Confirmed:7",
    ]);
  });

  test("Stay uses its owned reservation states instead of inventing arrival dates", () => {
    const list = {
      permissions: {
        canView: true,
        canCreate: true,
        canRespond: true,
        canCancel: true,
        canViewFinance: true,
      },
      groups: [
        { state: "request_pending" },
        { state: "instant_payment_pending" },
        { state: "approved_payment_required" },
        { state: "finalizing" },
        { state: "confirmed" },
        { state: "partially_cancelled" },
        { state: "cancelled" },
      ],
    } as unknown as StayStaffReservationList;
    expect(staySnapshot(list).map(({ label, value }) => `${label}:${value}`)).toEqual([
      "To answer:1",
      "Payment due:3",
      "Confirmed:2",
    ]);
  });

  test("table venues show today's live floor plus the active waitlist", () => {
    const reservation = (
      id: string,
      reservedFor: string,
      status: Reservation["status"],
    ): Reservation =>
      ({ id, reservedFor, status, createdAt: reservedFor } as unknown as Reservation);
    const wait = (status: WaitlistEntry["status"]): WaitlistEntry =>
      ({ status } as unknown as WaitlistEntry);
    const result = tableSnapshot({
      reservations: [
        reservation("1", "2026-11-25T00:30:00Z", "seated"),
        reservation("2", "2026-11-25T18:00:00Z", "confirmed"),
        reservation("3", "2026-11-24T18:00:00Z", "confirmed"),
        reservation("4", "2026-11-25T20:00:00Z", "cancelled_by_guest"),
      ],
      waitlist: [wait("waiting"), wait("notified"), wait("converted")],
      timeZone: "Africa/Lagos",
      now: new Date("2026-11-25T12:00:00Z"),
    });
    expect(result.map(({ label, value }) => `${label}:${value}`)).toEqual([
      "Seated now:1",
      "Today:2",
      "Waitlist:2",
    ]);
  });

  test("unavailable data is explicit and the aligned setup snapshot remains useful", () => {
    expect(doorSnapshot(undefined).every((metric) => metric.value === "--")).toBe(true);
    expect(
      tableSnapshot({ reservations: undefined, waitlist: [], timeZone: undefined }).map(
        (metric) => metric.value,
      ),
    ).toEqual(["--", "--", "0"]);
    expect(
      setupSnapshot({ enabledFeatures: 2, menuItems: 14, openFixes: 1 }).map(
        ({ label, value }) => `${label}:${value}`,
      ),
    ).toEqual(["Features:2", "Menu items:14", "To fix:1"]);
  });
});
