/**
 * META-ORCH-1148 sub-ORCH 2.1b — reservationViews unit tests (T-RES).
 *
 * Fails-on-revert anchors:
 *  - I-PROPOSED-1148-RESERVATION-LIFECYCLE-TRANSITIONS-GUARDED-SERVER-SIDE
 *    (the CLIENT mirror isTransitionLegal must reject illegal moves — terminal
 *    states locked, no_show only from confirmed/seated). If isTransitionLegal is
 *    loosened these flip to FAIL.
 *  - view filtering correctness (segmented Today/Upcoming/Completed/etc.).
 */

import type { Reservation, ReservationStatus } from "../../../types/venueReservation";
import {
  ACTION_TARGET,
  filterReservationsForView,
  isTransitionLegal,
  legalActionsFor,
} from "../reservationViews";

const baseRes = (over: Partial<Reservation>): Reservation => ({
  id: "r1",
  brandId: "b1",
  placePoolId: null,
  tableId: null,
  reservedFor: new Date().toISOString(),
  partySize: 2,
  status: "confirmed",
  source: "phone",
  createdVia: "operator",
  guestName: "Guest",
  guestPhoneE164: null,
  guestEmail: null,
  consumerUserId: null,
  occasion: null,
  guestNotes: null,
  tags: [],
  feeCents: null,
  feeCurrency: null,
  paymentStatus: "none",
  createdAt: new Date().toISOString(),
  ...over,
});

describe("reservation lifecycle guard (client mirror)", () => {
  it("T-RES-1 — terminal states allow NO transition", () => {
    const terminal: ReservationStatus[] = [
      "completed",
      "no_show",
      "cancelled_by_guest",
      "cancelled_by_venue",
    ];
    for (const from of terminal) {
      expect(legalActionsFor(from)).toHaveLength(0);
      expect(isTransitionLegal(from, "seated")).toBe(false);
      expect(isTransitionLegal(from, "confirmed")).toBe(false);
    }
  });

  it("T-RES-2 — a cancelled reservation can NOT be seated or completed", () => {
    expect(isTransitionLegal("cancelled_by_venue", "seated")).toBe(false);
    expect(isTransitionLegal("cancelled_by_guest", "completed")).toBe(false);
  });

  it("T-RES-3 — no_show is ONLY reachable from confirmed or seated", () => {
    expect(isTransitionLegal("confirmed", "no_show")).toBe(true);
    expect(isTransitionLegal("seated", "no_show")).toBe(true);
    expect(isTransitionLegal("requested", "no_show")).toBe(false);
    expect(isTransitionLegal("waitlisted", "no_show")).toBe(false);
  });

  it("T-RES-4 — the happy path confirmed→seated→completed is legal", () => {
    expect(isTransitionLegal("confirmed", "seated")).toBe(true);
    expect(isTransitionLegal("seated", "completed")).toBe(true);
    expect(isTransitionLegal("requested", "confirmed")).toBe(true);
  });

  it("T-RES-5 — seated can NOT regress to confirmed", () => {
    expect(isTransitionLegal("seated", "confirmed")).toBe(false);
  });

  it("T-RES-6 — legalActionsFor maps to legal targets only", () => {
    for (const a of legalActionsFor("confirmed")) {
      expect(isTransitionLegal("confirmed", ACTION_TARGET[a])).toBe(true);
    }
    // confirmed → seat/no_show/complete/cancel are all legal (4 actions).
    expect(legalActionsFor("confirmed").sort()).toEqual(
      ["cancel", "complete", "no_show", "seat"].sort(),
    );
    // requested → confirm + cancel (no seat/no_show/complete).
    expect(legalActionsFor("requested").sort()).toEqual(["cancel", "confirm"].sort());
  });
});

describe("reservation view filtering", () => {
  const now = new Date("2026-06-16T12:00:00Z");

  it("T-RES-7 — today shows only LIVE reservations dated today", () => {
    const list = [
      baseRes({ id: "a", status: "confirmed", reservedFor: "2026-06-16T19:00:00Z" }),
      baseRes({ id: "b", status: "completed", reservedFor: "2026-06-16T13:00:00Z" }),
      baseRes({ id: "c", status: "confirmed", reservedFor: "2026-06-17T19:00:00Z" }),
    ];
    const today = filterReservationsForView(list, "today", now).map((r) => r.id);
    expect(today).toEqual(["a"]);
  });

  it("T-RES-8 — upcoming shows future LIVE reservations not today", () => {
    const list = [
      baseRes({ id: "a", status: "confirmed", reservedFor: "2026-06-16T19:00:00Z" }),
      baseRes({ id: "c", status: "confirmed", reservedFor: "2026-06-18T19:00:00Z" }),
    ];
    const up = filterReservationsForView(list, "upcoming", now).map((r) => r.id);
    expect(up).toEqual(["c"]);
  });

  it("T-RES-9 — terminal buckets route by status", () => {
    const list = [
      baseRes({ id: "d", status: "completed" }),
      baseRes({ id: "e", status: "no_show" }),
      baseRes({ id: "f", status: "cancelled_by_guest" }),
      baseRes({ id: "g", status: "cancelled_by_venue" }),
      baseRes({ id: "h", status: "waitlisted" }),
    ];
    expect(filterReservationsForView(list, "completed", now).map((r) => r.id)).toEqual(["d"]);
    expect(filterReservationsForView(list, "no_shows", now).map((r) => r.id)).toEqual(["e"]);
    expect(filterReservationsForView(list, "canceled", now).map((r) => r.id).sort()).toEqual(["f", "g"]);
    expect(filterReservationsForView(list, "waitlist", now).map((r) => r.id)).toEqual(["h"]);
  });
});
