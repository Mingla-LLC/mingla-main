// #4339 — Support › Links page: each strip has its own time zone.
//
//   Z-1 the zone search finds a zone by city, zone id, country or offset
//       ("GMT+1"), puts Mingla cities and common zones first, offers only
//       zones the database knows, and highlights the match
//   Z-2 the combobox keyboard rules (ARIA 1.2): arrows open and move with
//       wrap, Enter picks the highlighted (or only) option, Escape closes
//   Z-3 a draft needs a valid zone; the save sends p_time_zone; a server
//       links_time_zone_invalid maps to the field in plain words
//   Z-4 the editor's window line (00:00 first day to 23:59 last day in the
//       strip's zone, across a clock change) and the list's status pill and
//       zone come from the server's answer
//   Z-5 one zone source (scheduleTime.js COMMON_ZONES / SERVER_ZONES), and
//       the stale city-switcher copy is gone from the editor
//
// Pure modules and source only: run with `node --test` from mingla-admin.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LINKS_STRIP_MESSAGES, stripSaveArgs, stripStartsLine, stripStatus, stripWindowLine, stripZoneLine, validateStripDraft,
} from "../lib/linksStrips.js";
import { COMMON_ZONES, SERVER_ZONES } from "../lib/scheduleTime.js";
import {
  TIME_ZONE_REST_LIMIT, comboboxKeyStep, highlightParts, searchTimeZones, zoneLabel, zoneMatches, zoneOffset,
} from "../lib/timeZoneSearch.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const AT = new Date("2026-11-14T12:00:00Z");
const all = (query) => { const r = searchTimeZones(query, { at: AT }); return [...r.common, ...r.rest]; };

describe("Z-1 zone search", () => {
  it("finds a zone by city, zone id, country and offset", () => {
    assert.deepEqual(all("lagos"), ["Africa/Lagos"]);
    assert.deepEqual(all("Africa/Lag"), ["Africa/Lagos"]);
    assert.deepEqual(all("nigeria"), ["Africa/Lagos"]);
    assert.ok(all("new york").includes("America/New_York"), "spaces match the underscore");
    assert.ok(all("finland").includes("Europe/Helsinki"));
    for (const query of ["GMT+1", "gmt +1", "UTC+1", "+1", "+01:00"]) {
      const found = all(query);
      assert.ok(found.includes("Africa/Lagos"), query);
      assert.ok(found.every((zone) => zoneOffset(zone, AT) === "GMT+1"), `${query}: only GMT+1 zones`);
    }
    assert.ok(all("utc-5").includes("America/New_York"));
    assert.equal(zoneMatches("Asia/Tokyo", "GMT+1", AT), false);
    assert.deepEqual(all("zzzz-nowhere"), []);
  });

  it("puts the Mingla cities and common zones first, in their order, and caps the rest", () => {
    const empty = searchTimeZones("", { at: AT });
    assert.deepEqual(empty.common, COMMON_ZONES.filter((zone) => SERVER_ZONES.has(zone)));
    assert.equal(empty.common[0], "Africa/Lagos");
    assert.ok(empty.rest.length <= TIME_ZONE_REST_LIMIT);
    assert.ok(empty.rest.every((zone) => !COMMON_ZONES.includes(zone)));
    const us = searchTimeZones("united states", { at: AT });
    assert.deepEqual(us.common, ["America/New_York", "America/Chicago", "America/Los_Angeles"]);
  });

  it("offers only zones the database knows", () => {
    for (const query of ["", "a", "america", "GMT+3", "pacific"]) {
      assert.ok(all(query).every((zone) => SERVER_ZONES.has(zone)), query);
    }
  });

  it("highlights the first match, case-insensitively, and labels the chosen zone", () => {
    assert.deepEqual(highlightParts("Lagos", "AG"), [{ text: "L", match: false }, { text: "ag", match: true }, { text: "os", match: false }]);
    assert.deepEqual(highlightParts("Lagos", ""), [{ text: "Lagos", match: false }]);
    assert.deepEqual(highlightParts("Lagos", "x"), [{ text: "Lagos", match: false }]);
    assert.equal(zoneLabel("Africa/Lagos", AT), "Lagos — Africa/Lagos (GMT+1)");
    assert.equal(zoneLabel("America/New_York", AT), "New York — America/New_York (GMT-5)");
  });
});

describe("Z-1b tester rework (P3-1, P3-2, P3-3, P3-4)", () => {
  it("P3-1: only + and minus signs make an offset query; digits and letters do not", () => {
    assert.deepEqual(all("utc12"), [], "utc12 is not GMT-2");
    assert.deepEqual(all("10"), []);
    assert.ok(all("-5").includes("America/New_York"));
    assert.ok(all("−5").includes("America/New_York"), "a typographic minus works too");
  });

  it("P3-2: today's city names find zones whose id still has the old one, and a country ranks first", () => {
    for (const [query, zone] of [["kolkata", "Asia/Calcutta"], ["kyiv", "Europe/Kiev"], ["ho chi minh", "Asia/Saigon"], ["yangon", "Asia/Rangoon"], ["nuuk", "America/Godthab"]]) {
      const found = all(query);
      assert.ok(found.includes(zone) || found.includes(zone.replace("Calcutta", "Kolkata").replace("Kiev", "Kyiv")), `${query} finds ${zone}`);
    }
    const india = all("india");
    assert.match(india[0], /^Asia\/(Calcutta|Kolkata)$/, "India lists Kolkata before the Indiana zones");
    assert.equal(zoneLabel("Asia/Calcutta", AT), "Kolkata — Asia/Calcutta (GMT+5:30)");
  });

  it("P3-3: the capped list says how many more there are", () => {
    const empty = searchTimeZones("", { at: AT });
    assert.ok(empty.more > 0);
    assert.equal(empty.rest.length + empty.more + empty.common.length >= TIME_ZONE_REST_LIMIT + empty.more, true);
    assert.equal(searchTimeZones("lagos", { at: AT }).more, 0);
    const source = read("components/ui/TimeZoneCombobox.jsx");
    assert.match(source, /"More zones"/);
    assert.doesNotMatch(source, /"All zones"/);
    assert.match(source, /more\. Type a city, country or zone to find them\./);
  });

  it("P3-4: a saved zone the picker does not offer is kept on edit and still named in the list", () => {
    const panel = read("components/links/LinksPagePanel.jsx");
    assert.match(panel, /timeZone: strip\.time_zone \|\| browserTimeZone\(\)/);
    assert.equal(stripZoneLine({ time_zone: "posix/Mars" }), "posix/Mars");
    assert.equal(validateStripDraft({
      id: "s1", showsOn: "2026-11-16", timeZone: "posix/Mars", title: "x", label: "New", opens: "host", url: "", blogPostId: "",
    }).field, "timeZone", "it must be re-picked from the list before saving");
  });

  it("P3-5: leaving the field after typing one exact match picks it", () => {
    const source = read("components/ui/TimeZoneCombobox.jsx");
    assert.match(source, /if \(query !== null && query\.trim\(\) && options\.length === 1\) choose\(options\[0\]\);/);
  });
});

describe("Z-2 combobox keyboard", () => {
  it("arrows open the list and move with wrap", () => {
    assert.deepEqual(comboboxKeyStep({ open: false, active: -1, count: 3 }, "ArrowDown"), { open: true, active: 0, pick: null, handled: true });
    assert.equal(comboboxKeyStep({ open: true, active: 0, count: 3 }, "ArrowDown").active, 1);
    assert.equal(comboboxKeyStep({ open: true, active: 2, count: 3 }, "ArrowDown").active, 0, "wraps to the top");
    assert.equal(comboboxKeyStep({ open: true, active: 0, count: 3 }, "ArrowUp").active, 2, "wraps to the bottom");
    assert.equal(comboboxKeyStep({ open: false, active: -1, count: 3 }, "ArrowUp").active, 2);
    assert.deepEqual(comboboxKeyStep({ open: true, active: -1, count: 0 }, "ArrowDown"), { open: true, active: -1, pick: null, handled: true });
  });

  it("Enter picks the highlighted option, or the only one, and never submits the form while open", () => {
    assert.deepEqual(comboboxKeyStep({ open: true, active: 1, count: 3 }, "Enter"), { open: false, active: -1, pick: 1, handled: true });
    assert.equal(comboboxKeyStep({ open: true, active: -1, count: 1 }, "Enter").pick, 0);
    assert.deepEqual(comboboxKeyStep({ open: true, active: -1, count: 4 }, "Enter"), { open: true, active: -1, pick: null, handled: true });
    assert.equal(comboboxKeyStep({ open: false, active: -1, count: 4 }, "Enter").handled, false, "closed: Enter submits as usual");
  });

  it("Escape closes; Tab closes and lets focus move on", () => {
    assert.deepEqual(comboboxKeyStep({ open: true, active: 2, count: 3 }, "Escape"), { open: false, active: -1, pick: null, handled: true });
    assert.equal(comboboxKeyStep({ open: false, active: -1, count: 3 }, "Escape").handled, false);
    assert.deepEqual(comboboxKeyStep({ open: true, active: 2, count: 3 }, "Tab"), { open: false, active: -1, pick: null, handled: false });
  });

  it("the component is an ARIA 1.2 combobox driven by these rules", () => {
    const source = read("components/ui/TimeZoneCombobox.jsx");
    for (const re of [/role="combobox"/, /aria-autocomplete="list"/, /aria-expanded=\{open\}/, /aria-controls=\{listId\}/,
      /aria-activedescendant=/, /role="listbox"/, /role="option"/, /aria-selected=\{selected\}/, /comboboxKeyStep\(/, /<mark/]) {
      assert.match(source, re);
    }
  });
});

describe("Z-3 the zone is required and saved", () => {
  const valid = {
    id: null, showsOn: "2026-11-16", showsUntil: "2026-11-28", timeZone: "Africa/Lagos", title: "Lagos: Beach Unwind 2.0",
    label: "Featured", opens: "web", url: "usemingla.com/host", blogPostId: "",
  };

  it("a draft needs a zone the database knows, checked after the dates", () => {
    assert.equal(validateStripDraft(valid), null);
    for (const timeZone of [undefined, "", "Lagos", "africa/lagos", "Mars/Olympus_Mons"]) {
      assert.deepEqual(validateStripDraft({ ...valid, timeZone }), { field: "timeZone", message: LINKS_STRIP_MESSAGES.timeZone }, String(timeZone));
    }
    assert.equal(LINKS_STRIP_MESSAGES.timeZone, "Pick a time zone from the list.");
    assert.equal(validateStripDraft({ ...valid, showsOn: "", timeZone: "" }).field, "showsOn");
  });

  it("the save sends p_time_zone", () => {
    assert.equal(stripSaveArgs(valid).p_time_zone, "Africa/Lagos");
    assert.equal(stripSaveArgs({ ...valid, timeZone: "America/New_York" }).p_time_zone, "America/New_York");
  });

  it("links_time_zone_invalid names the field, in plain words", () => {
    const service = read("services/linksStripsService.js");
    assert.match(service, /links_time_zone_invalid: \{ field: "timeZone", message: "Pick a time zone from the list\." \}/);
    assert.match(service, /links_shows_on_invalid: \{ field: "showsOn", message: "[^"]*time zone[^"]*" \}/);
  });

  it("new strips start in this computer's zone; editing shows the saved one", () => {
    const panel = read("components/links/LinksPagePanel.jsx");
    assert.match(panel, /timeZone: browserTimeZone\(\)/);
    assert.match(panel, /timeZone: strip\.time_zone \|\| browserTimeZone\(\)/);
    assert.match(panel, /<TimeZoneCombobox/);
  });
});

describe("Z-4 window line, status and zone", () => {
  it("reads 00:00 on the first day to 23:59 on the last, in the strip's zone and the admin's", () => {
    const line = stripWindowLine({ showsOn: "2026-11-16", showsUntil: "2026-11-28", timeZone: "Africa/Lagos" }, "America/New_York");
    assert.deepEqual(line, {
      from: "00:00 Mon 16 Nov",
      to: "23:59 Sat 28 Nov",
      zone: "Lagos time (GMT+1)",
      viewer: "That is Sun 15 Nov · 18:00 to Sat 28 Nov · 17:59 your time.",
      startsAt: "2026-11-15T23:00:00.000Z",
      endsAt: "2026-11-28T23:00:00.000Z",
    });
    assert.equal(stripWindowLine({ showsOn: "2026-11-16", timeZone: "Africa/Lagos" }, "Africa/Lagos").viewer, "That is your computer's time zone too.");
    assert.equal(stripWindowLine({ showsOn: "2026-11-16", timeZone: "" }), null);
    assert.equal(stripWindowLine({ showsOn: "", timeZone: "Africa/Lagos" }), null);
  });

  it("matches the database window across the 8 Mar 2026 New York clock change (a 23-hour day)", () => {
    const line = stripWindowLine({ showsOn: "2026-03-08", showsUntil: "", timeZone: "America/New_York" }, "UTC");
    assert.equal(line.startsAt, "2026-03-08T05:00:00.000Z");
    assert.equal(line.endsAt, "2026-03-09T04:00:00.000Z");
    assert.equal(line.to, "23:59 Sun 8 Mar");
  });

  it("the pill is the server's status; unknown or missing shows none", () => {
    assert.equal(stripStatus({ status: "live" }).label, "Live");
    assert.equal(stripStatus({ status: "scheduled" }).label, "Scheduled");
    assert.equal(stripStatus({ status: "ended" }).label, "Ended");
    assert.equal(stripStatus({ status: "paused" }), null);
    assert.equal(stripStatus({}), null);
  });

  it("the list shows the zone with its offset, and when a scheduled strip starts on the admin's clock", () => {
    assert.equal(stripZoneLine({ time_zone: "Africa/Lagos", starts_at: "2026-11-15T23:00:00Z" }), "Lagos GMT+1");
    assert.equal(stripZoneLine({ time_zone: "America/New_York", starts_at: "2026-07-01T04:00:00Z" }), "New York GMT-4");
    assert.equal(stripZoneLine({}), "");
    assert.equal(stripStartsLine({ status: "scheduled", starts_at: "2026-11-15T23:00:00Z" }, "America/New_York"), "starts Sun 15 Nov · 18:00 your time");
    assert.equal(stripStartsLine({ status: "live", starts_at: "2026-11-15T23:00:00Z" }, "America/New_York"), "");
  });
});

describe("Z-5 one zone source, current copy", () => {
  it("the picker reads COMMON_ZONES and timeZoneOptions from scheduleTime.js, not its own list", () => {
    const search = read("lib/timeZoneSearch.js");
    assert.match(search, /import \{ COMMON_ZONES, isValidTimeZone, timeZoneOptions \} from "\.\/scheduleTime\.js";/);
    assert.doesNotMatch(search, /const COMMON|supportedValuesOf/);
  });

  it("the editor no longer mentions the city switcher or listings removed in #4434", () => {
    const panel = read("components/links/LinksPagePanel.jsx");
    assert.doesNotMatch(panel, /city switcher|Live listings|push the listings|in every city/i);
    assert.match(panel, /Each strip shows only between its dates, in its time zone\./);
  });
});
