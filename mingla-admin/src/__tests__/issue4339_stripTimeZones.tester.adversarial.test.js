// #4339 tester (adversarial) — the Admin's picture of a strip's window must be
// the database's window, in the zones and on the days where it is easiest to
// get wrong, and the picker must never offer a zone the save would refuse.
//
//   T-A the editor's live line (stripWindowLine) gives the same instants as
//       public.links_strip_window() for days the implementor's suite does not
//       cover: the New York fall-back day (25 hours), zones whose clocks jump
//       AT midnight (America/Santiago, Asia/Beirut: the day starts 01:00), a
//       30-minute change (Australia/Lord_Howe), +05:45 (Asia/Kathmandu), and
//       the two ends of the calendar (Pacific/Kiritimati, Pacific/Pago_Pago).
//       Expected instants were read from PostgreSQL 17 after the full replay
//       (issue_4339_links_strip_time_zone.tester.pg17.test.sql T2 asserts the
//       same numbers on the database side).
//   T-B the line never depends on the admin's own zone: only the "your time"
//       sentence changes.
//   T-C the picker offers only zones the save accepts by that exact name:
//       nothing outside SERVER_ZONES, no Etc/ (sign-inverted) or posix/ names,
//       no lower-case spellings; every Mingla city is offered first.
//   T-D a draft with a zone the database would refuse never reaches the save.
//
// FAILS-ON-REVERT: before #4339 stripWindowLine, the timeZone check in
// validateStripDraft and p_time_zone do not exist.
// Pure modules only: run with `node --test` from mingla-admin.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LINKS_STRIP_MESSAGES, stripSaveArgs, stripWindowLine, validateStripDraft } from "../lib/linksStrips.js";
import { COMMON_ZONES, SERVER_ZONES, isValidTimeZone, timeZoneOptions } from "../lib/scheduleTime.js";
import { searchTimeZones } from "../lib/timeZoneSearch.js";

const DB_WINDOWS = [
  ["New York fall-back (25 h)", "2026-11-01", "", "America/New_York", "2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z"],
  ["Santiago, no 00:00 on 6 Sep", "2026-09-06", "", "America/Santiago", "2026-09-06T04:00:00.000Z", "2026-09-07T03:00:00.000Z"],
  ["Beirut, no 00:00 on 29 Mar", "2026-03-29", "", "Asia/Beirut", "2026-03-28T22:00:00.000Z", "2026-03-29T21:00:00.000Z"],
  ["Lord Howe 30-minute change", "2026-10-04", "", "Australia/Lord_Howe", "2026-10-03T13:30:00.000Z", "2026-10-04T13:00:00.000Z"],
  ["Kathmandu +05:45, two days", "2026-11-16", "2026-11-17", "Asia/Kathmandu", "2026-11-15T18:15:00.000Z", "2026-11-17T18:15:00.000Z"],
  ["Kiritimati +14", "2026-11-16", "", "Pacific/Kiritimati", "2026-11-15T10:00:00.000Z", "2026-11-16T10:00:00.000Z"],
  ["Pago Pago -11", "2026-11-16", "", "Pacific/Pago_Pago", "2026-11-16T11:00:00.000Z", "2026-11-17T11:00:00.000Z"],
];

describe("T-A the editor's window is the database's window", () => {
  for (const [label, showsOn, showsUntil, timeZone, startsAt, endsAt] of DB_WINDOWS) {
    it(label, () => {
      const line = stripWindowLine({ showsOn, showsUntil, timeZone }, "UTC");
      assert.ok(line, `no window line for ${timeZone}`);
      assert.equal(line.startsAt, startsAt, `${label}: start`);
      assert.equal(line.endsAt, endsAt, `${label}: end`);
      assert.match(line.from, /^00:00 /);
      assert.match(line.to, /^23:59 /);
    });
  }
});

describe("T-B the admin's own zone changes only the 'your time' sentence", () => {
  it("Kiritimati and Pago Pago admins see the same Lagos window", () => {
    const draft = { showsOn: "2026-11-16", showsUntil: "2026-11-28", timeZone: "Africa/Lagos" };
    const east = stripWindowLine(draft, "Pacific/Kiritimati");
    const west = stripWindowLine(draft, "Pacific/Pago_Pago");
    for (const key of ["from", "to", "zone", "startsAt", "endsAt"]) assert.equal(east[key], west[key], key);
    assert.notEqual(east.viewer, west.viewer);
    assert.equal(east.startsAt, "2026-11-15T23:00:00.000Z");
    assert.equal(east.endsAt, "2026-11-28T23:00:00.000Z");
  });

  it("a Show until before Shows on reads as the one day, never a backwards window", () => {
    const line = stripWindowLine({ showsOn: "2026-11-16", showsUntil: "2026-11-10", timeZone: "UTC" }, "UTC");
    assert.equal(line.startsAt, "2026-11-16T00:00:00.000Z");
    assert.equal(line.endsAt, "2026-11-17T00:00:00.000Z");
  });
});

describe("T-C the picker offers only zones the save accepts", () => {
  const offered = timeZoneOptions();
  it("every offered zone is a database name, spelled exactly", () => {
    assert.ok(offered.length > 300, `only ${offered.length} zones offered`);
    for (const zone of offered) {
      assert.ok(SERVER_ZONES.has(zone), `${zone} is offered but the database does not know it`);
      assert.ok(!/^(Etc|posix)\//.test(zone), `${zone} is a sign-inverted or POSIX name`);
    }
    for (const bad of ["africa/lagos", " Africa/Lagos", "UTC+1", "Etc/GMT+1", "posix/Africa/Lagos", "", null]) {
      assert.equal(isValidTimeZone(bad), false, `${JSON.stringify(bad)} must not be valid`);
    }
  });

  it("the Mingla cities come first in an empty search and in a matching one", () => {
    assert.deepEqual(searchTimeZones("").common, COMMON_ZONES.filter((zone) => isValidTimeZone(zone)));
    assert.deepEqual(searchTimeZones("new york").common, ["America/New_York"]);
    assert.deepEqual([...searchTimeZones("GMT+14").common, ...searchTimeZones("GMT+14").rest], ["Pacific/Kiritimati"]);
    assert.ok(searchTimeZones("GMT-11").rest.includes("Pacific/Pago_Pago"));
  });
});

describe("T-D a zone the database would refuse never reaches the save", () => {
  const base = { id: null, showsOn: "2026-11-16", showsUntil: "", title: "Zone check", label: "New", opens: "host", url: "", blogPostId: "" };
  for (const timeZone of ["Africa/lagos", "Etc/GMT+12", "posix/Africa/Lagos", "Lagos", "", undefined]) {
    it(`refuses ${JSON.stringify(timeZone)}`, () => {
      assert.deepEqual(validateStripDraft({ ...base, timeZone }), { field: "timeZone", message: LINKS_STRIP_MESSAGES.timeZone });
    });
  }
  it("a valid zone passes and is sent as p_time_zone, unchanged", () => {
    assert.equal(validateStripDraft({ ...base, timeZone: "Pacific/Pago_Pago" }), null);
    assert.equal(stripSaveArgs({ ...base, timeZone: "Pacific/Pago_Pago" }).p_time_zone, "Pacific/Pago_Pago");
  });
});
