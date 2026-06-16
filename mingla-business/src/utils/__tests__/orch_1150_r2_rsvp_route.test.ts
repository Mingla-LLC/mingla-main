/**
 * ORCH-1150-R2 (D-3) [RSVP event wizard — edit/resume opens the right wizard]
 * — happy-path regression test for the RSVP routing branch.
 *
 * Pins:
 *   - routeForEventRow event_type='rsvp' → /rsvp/{id}/edit (draft) | /rsvp/{id}.
 *   - routeForEventRowDefensive honors the camelCase `isRsvp` signal (the
 *     DraftEvent shape has NO event_type field) and coerces it to event_type
 *     'rsvp' → /rsvp/{id}/edit.
 *   - ticketed/event/trip/experience routing stays unchanged (no RSVP leak).
 *
 * Fails-on-revert: deleting the `rsvp` branch in routeForEventRow OR the
 * `isRsvp` coercion in routeForEventRowDefensive flips these assertions to the
 * ticketed `/event/...` route → the matching expect fails.
 */

import { describe, expect, test } from "@jest/globals";

import {
  routeForEventRow,
  routeForEventRowDefensive,
} from "../routeForEventRow";

describe("ORCH-1150-R2 D-3 — routeForEventRow RSVP branch", () => {
  test("rsvp draft → /rsvp/{id}/edit (resume RSVP wizard, NOT /event)", () => {
    expect(
      routeForEventRow({ id: "r1", event_type: "rsvp", status: "draft" }),
    ).toBe("/rsvp/r1/edit");
  });

  test("rsvp scheduled → /rsvp/{id} (RSVP dashboard)", () => {
    expect(
      routeForEventRow({ id: "r2", event_type: "rsvp", status: "scheduled" }),
    ).toBe("/rsvp/r2");
  });

  test("rsvp live → /rsvp/{id}", () => {
    expect(
      routeForEventRow({ id: "r3", event_type: "rsvp", status: "live" }),
    ).toBe("/rsvp/r3");
  });

  test("rsvp ended → /rsvp/{id}", () => {
    expect(
      routeForEventRow({ id: "r4", event_type: "rsvp", status: "ended" }),
    ).toBe("/rsvp/r4");
  });

  // DO-NOT-REGRESS: the ticketed event path is byte-identical.
  test("ticketed event draft still → /event/{id}/edit (no RSVP leak)", () => {
    expect(
      routeForEventRow({ id: "e1", event_type: "event", status: "draft" }),
    ).toBe("/event/e1/edit");
  });

  test("trip + experience routing unchanged", () => {
    expect(
      routeForEventRow({ id: "t1", event_type: "trip", status: "draft" }),
    ).toBe("/trip/t1/edit");
    expect(
      routeForEventRow({ id: "x1", event_type: "experience", status: "draft" }),
    ).toBe("/experience/x1");
  });
});

describe("ORCH-1150-R2 D-3 — routeForEventRowDefensive honors isRsvp", () => {
  test("isRsvp:true + draft → /rsvp/{id}/edit (DraftEvent has no event_type)", () => {
    expect(
      routeForEventRowDefensive({ id: "r1", isRsvp: true, status: "draft" }),
    ).toBe("/rsvp/r1/edit");
  });

  test("isRsvp:true + scheduled → /rsvp/{id}", () => {
    expect(
      routeForEventRowDefensive({ id: "r2", isRsvp: true, status: "scheduled" }),
    ).toBe("/rsvp/r2");
  });

  test("event_type:'rsvp' (live LiveEvent) + scheduled → /rsvp/{id}", () => {
    expect(
      routeForEventRowDefensive({
        id: "r3",
        event_type: "rsvp",
        status: "scheduled",
      }),
    ).toBe("/rsvp/r3");
  });

  test("isRsvp:true wins over a stale event_type='event'", () => {
    expect(
      routeForEventRowDefensive({
        id: "r4",
        isRsvp: true,
        event_type: "event",
        status: "draft",
      }),
    ).toBe("/rsvp/r4/edit");
  });

  // DO-NOT-REGRESS: isRsvp:false / absent routes ticketed exactly as before.
  test("isRsvp:false + draft → /event/{id}/edit (ticketed unchanged)", () => {
    expect(
      routeForEventRowDefensive({ id: "e1", isRsvp: false, status: "draft" }),
    ).toBe("/event/e1/edit");
  });

  test("no isRsvp, no event_type → defaults to event", () => {
    expect(routeForEventRowDefensive({ id: "e2", status: "draft" })).toBe(
      "/event/e2/edit",
    );
  });
});
