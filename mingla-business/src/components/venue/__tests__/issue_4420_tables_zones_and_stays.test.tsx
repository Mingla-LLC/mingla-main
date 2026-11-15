/**
 * #4420 (decisions 11-14) — the zone-grouped Tables view, and Stay always
 * listed on Add a venue.
 *
 * FAILS ON REVERT: tables stop grouping by zone (or a zone's order changes),
 * a table is dropped or duplicated by the grouping, or Add a venue hides Stay
 * again while the STAY_VENUE_AUTHORING switch is off (I-4420-HOST-WIRING).
 *
 * [TEST-MOD-APPROVED #4420] — the source-text half moved to the I-4420-HOST-WIRING
 * strict-grep gate (I-PROPOSED-1047-NO-SOLE-SOURCE-PIN); this file keeps the behaviour.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { describe, expect, test } from "@jest/globals";


import type { VenueTable } from "../../../types/venueReservation";

const { groupTablesByZone } = require("../venueTableZones") as typeof import("../venueTableZones");

const table = (id: string, zone: VenueTable["zone"]): VenueTable =>
  ({ id, name: id, capacity: 2, minParty: null, maxParty: null, zone, seatingType: null, isActive: true }) as unknown as VenueTable;

describe("#4420 — zone-grouped Tables view", () => {
  test("groups by zone in a fixed order, No zone last, server order kept inside a zone", () => {
    const groups = groupTablesByZone([
      table("p1", "patio"),
      table("t1", "indoor"),
      table("x1", null),
      table("b1", "bar"),
      table("t2", "indoor"),
      table("o1", "outdoor"),
      table("r1", "private_room"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Indoor", "Outdoor", "Patio", "Bar", "Private room", "No zone"]);
    expect(groups[0].tables.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  test("never drops or duplicates a table", () => {
    const input = [table("a", "bar"), table("b", null), table("c", "bar"), table("d", "indoor")];
    const out = groupTablesByZone(input).flatMap((g) => g.tables.map((t) => t.id));
    expect(out.sort()).toEqual(["a", "b", "c", "d"]);
  });

  test("an empty list has no groups", () => {
    expect(groupTablesByZone([])).toEqual([]);
  });
});

describe("#4420 round-3 item 12 — time zones never show as slugs", () => {
  const { venueTimezoneLabel } = require("../venueTimezoneLabel") as typeof import("../venueTimezoneLabel");

  test("an IANA zone reads as its city and offset", () => {
    expect(venueTimezoneLabel("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe("New York (GMT-5)");
    expect(venueTimezoneLabel("Africa/Lagos", new Date("2026-01-15T12:00:00Z"))).toBe("Lagos (GMT+1)");
  });

  test("UTC stays UTC and never contains a slash", () => {
    expect(venueTimezoneLabel("UTC")).toBe("UTC");
    expect(venueTimezoneLabel("America/Argentina/Buenos_Aires")).not.toContain("/");
  });
});
