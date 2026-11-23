// Issue #4571 W5 (the Calendar's Week view) — implementor tests for Admin.
//
//   W-1  the week runs Monday to Sunday in the viewer's zone (the zone's own
//        midnight, including a week with a clock change)
//   W-2  a demo sits on its day and at its time in the viewer's zone
//   W-3  the four layers: address round trip, toggling, counts, grouping
//   W-4  every item opens its card or record; a demo with no card says
//        "Needs linking"
//   W-5  a Work due chip has its own classes and wraps inside its day column
//        (never nowrap, truncate, a line clamp or the due-date pill's class)
//   W-6  the page reads the week's data only for the week, keeps the layers in
//        the address (never local storage) and adds no typed date field
//
// FAILS-ON-REVERT: before W5 lib/calendarWeek.js, WeekView.jsx and the Week
// option do not exist; giving the Work due chip a nowrap or truncate class
// fails W-5.
//
// Run: node --test src/__tests__/issue4571_w5_calendar_week.implementor.test.js (after `npm ci`).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WEEK_CHIP_BASE, WEEK_CHIP_TITLE, WEEK_LAYER_KEYS, WORK_DUE_CHIP_CLASS, addDaysKey, itemsByDay, layerCounts, layersParam, mondayOfKey,
  parseLayers, todayKeyIn, toggleLayer, weekChipClass, weekDayKeys, weekFromParam, weekItems, weekLabel, weekRange, zonedMidnightMs,
} from "../lib/calendarWeek.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const read = (p) => fs.readFileSync(path.join(SRC, p), "utf8");

const MONDAY = "2026-11-23";
const DAYS = weekDayKeys(MONDAY);
const HOST_CARD = "11111111-1111-4111-8111-111111111111";

describe("W-1 the week is Monday to Sunday in the viewer's zone", () => {
  it("any day of the week names its Monday; Sunday belongs to the week before the next Monday", () => {
    for (const day of DAYS) assert.equal(mondayOfKey(day), MONDAY);
    assert.equal(mondayOfKey("2026-11-29"), MONDAY);
    assert.equal(mondayOfKey("2026-11-30"), "2026-11-30");
    assert.equal(mondayOfKey("2026-11-22"), "2026-11-16");
    assert.deepEqual(DAYS, ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
  });
  it("a week address that is not a real day falls back to the week holding today", () => {
    assert.equal(weekFromParam("2026-02-30", "2026-11-25"), MONDAY);
    assert.equal(weekFromParam("soon", "2026-11-25"), MONDAY);
    assert.equal(weekFromParam(null, "2026-11-29"), MONDAY);
    assert.equal(weekFromParam("2026-11-27", "2030-01-01"), MONDAY);
  });
  it("week arithmetic crosses months and years", () => {
    assert.equal(addDaysKey("2026-12-28", 7), "2027-01-04");
    assert.equal(addDaysKey(MONDAY, -7), "2026-11-16");
    assert.equal(weekLabel("2026-11-23"), "23 to 29 Nov 2026");
    assert.equal(weekLabel("2026-11-30"), "30 Nov to 6 Dec 2026");
    assert.equal(weekLabel("2026-12-28"), "28 Dec 2026 to 3 Jan 2027");
  });
  it("the range starts at the zone's own Monday midnight and ends at the next Monday's", () => {
    assert.deepEqual(weekRange(MONDAY, "Africa/Lagos"), { from: "2026-11-23", to: "2026-11-29", fromIso: "2026-11-22T23:00:00.000Z", toIso: "2026-11-29T23:00:00.000Z" });
    assert.equal(weekRange(MONDAY, "America/Los_Angeles").fromIso, "2026-11-23T08:00:00.000Z");
    assert.equal(weekRange(MONDAY, "Pacific/Kiritimati").fromIso, "2026-11-22T10:00:00.000Z");
    assert.equal(weekRange(MONDAY, "UTC").fromIso, "2026-11-23T00:00:00.000Z");
  });
  it("a week with a clock change is 7 days of local days, not 168 hours", () => {
    // London goes back on Sunday 25 Oct 2026: the week of 19 Oct is 169 hours long.
    const back = weekRange("2026-10-19", "Europe/London");
    assert.equal(back.fromIso, "2026-10-18T23:00:00.000Z");
    assert.equal(back.toIso, "2026-10-26T00:00:00.000Z");
    // New York goes forward on Sunday 8 Mar 2026: the week of 2 Mar is 167 hours long.
    const forward = weekRange("2026-03-02", "America/New_York");
    assert.equal(forward.fromIso, "2026-03-02T05:00:00.000Z");
    assert.equal(forward.toIso, "2026-03-09T04:00:00.000Z");
    assert.equal(Date.parse(forward.toIso) - Date.parse(forward.fromIso), 167 * 3_600_000);
  });
  it("midnight of a day is the first instant of that day in the zone", () => {
    for (const zone of ["Africa/Lagos", "America/Los_Angeles", "Pacific/Kiritimati", "Europe/London", "Asia/Kolkata"]) {
      const ms = zonedMidnightMs("2026-11-24", zone);
      assert.equal(todayKeyIn(zone, new Date(ms)), "2026-11-24", zone);
      assert.equal(todayKeyIn(zone, new Date(ms - 1000)), "2026-11-23", zone);
    }
  });
});

const callRow = (extra) => ({ id: "c-1", audience: "host", name: "Femi Ade", call_at: "2026-11-24T23:30:00Z", status: "booked", needs_linking: true, record: null, ...extra });

describe("W-2 a demo is on its day and at its time in the viewer's zone", () => {
  it("23:30 UTC is the next day in Lagos and the same afternoon in Los Angeles", () => {
    const lagos = weekItems({ days: DAYS, calls: [callRow()], zone: "Africa/Lagos" });
    assert.equal(lagos.length, 1);
    assert.equal(lagos[0].day, "2026-11-25");
    assert.equal(lagos[0].time, "12:30 AM");
    const la = weekItems({ days: DAYS, calls: [callRow()], zone: "America/Los_Angeles" });
    assert.equal(la[0].day, "2026-11-24");
    assert.equal(la[0].time, "3:30 PM");
  });
  it("a demo outside the viewer's week is not in it (Sunday night UTC is Monday in Lagos)", () => {
    const sundayNight = callRow({ call_at: "2026-11-29T23:30:00Z" });
    assert.equal(weekItems({ days: DAYS, calls: [sundayNight], zone: "Africa/Lagos" }).length, 0);
    assert.equal(weekItems({ days: DAYS, calls: [sundayNight], zone: "UTC" })[0].day, "2026-11-29");
    assert.equal(weekItems({ days: weekDayKeys("2026-11-30"), calls: [sundayNight], zone: "Africa/Lagos" })[0].day, "2026-11-30");
  });
  it("demos on one day are in time order", () => {
    const rows = [callRow({ id: "b", name: "Later", call_at: "2026-11-24T15:00:00Z" }), callRow({ id: "a", name: "Earlier", call_at: "2026-11-24T08:00:00Z" })];
    assert.deepEqual(weekItems({ days: DAYS, calls: rows, zone: "UTC" }).map((i) => i.title), ["Earlier", "Later"]);
  });
});

const EVENTS = {
  events: [
    { id: "e1", title: "Jazz Nights", start_on: "2026-11-25", host: { name: "Bayo" }, state: { k: "ready" } },
    { id: "e2", title: "Next week event", start_on: "2026-12-01", host: { name: "Ada" } },
  ],
  expected: [{ id: "x1", title: "Promised supper", expected_on: "2026-11-26", host_name: "Ada", repeats: "week", state: { k: "notlive" } }],
};
const CALLBACKS = [
  { record_id: "22222222-2222-4222-8222-222222222222", name: "Lagos Jazz Nights", pipeline: "hosts", due_on: "2026-11-24", stage: "replied", owners: ["Tao"] },
  { record_id: "33333333-3333-4333-8333-333333333333", name: "Ngozi Films", pipeline: "creators", due_on: "2026-11-27", stage: "contacted", owners: ["Tao", "Kemi"] },
];
const WORK = [
  { id: "w1", number: 4571, title: "Send the launch note", due_on: "2026-11-24", owners: [{ name: "Tao" }], overdue: false, parent: null },
  { id: "w2", number: 4572, title: "A subtask", due_on: "2026-11-24", owners: [], overdue: true, parent: { number: 4571, title: "Send the launch note" } },
];
const ALL = weekItems({ days: DAYS, events: EVENTS, calls: [callRow({ record: { id: HOST_CARD, name: "Vault Lounge" }, needs_linking: false }), callRow({ id: "c-2", name: "Loose booking", call_at: "2026-11-26T10:00:00Z" })],
  callbacks: CALLBACKS, work: WORK, zone: "UTC" });

describe("W-3 four layers you switch on and off", () => {
  it("the address round trips: absent is all four, none is none, a list is that list", () => {
    assert.deepEqual([...parseLayers(null)], WEEK_LAYER_KEYS);
    assert.equal(layersParam(parseLayers(null)), null);
    assert.deepEqual([...parseLayers("none")], []);
    assert.equal(layersParam(new Set()), "none");
    assert.deepEqual([...parseLayers("demos,work")], ["demos", "work"]);
    assert.equal(layersParam(parseLayers("work,demos")), "demos,work");
    assert.deepEqual([...parseLayers("bogus")], WEEK_LAYER_KEYS);
    assert.deepEqual([...parseLayers("events,bogus")], ["events"]);
  });
  it("toggling flips one layer and leaves the others", () => {
    const off = toggleLayer(parseLayers(null), "demos");
    assert.deepEqual([...off].sort(), ["callbacks", "events", "work"]);
    assert.equal(layersParam(off), "events,callbacks,work");
    assert.ok(toggleLayer(off, "demos").has("demos"));
    assert.equal(toggleLayer(off, "nonsense").size, off.size);
    assert.equal(layersParam(toggleLayer(new Set(["work"]), "work")), "none");
  });
  it("every layer has items in the week, and the counts do not depend on what is on", () => {
    assert.deepEqual(layerCounts(ALL), { events: 2, demos: 2, callbacks: 2, work: 2 });
  });
  it("events and promised events keep their own day; next week's event is out", () => {
    const ev = ALL.filter((i) => i.layer === "events");
    assert.deepEqual(ev.map((i) => [i.day, i.title]), [["2026-11-25", "Jazz Nights"], ["2026-11-26", "Promised supper"]]);
    assert.equal(ev[1].label, "Promised, repeats");
    assert.ok(ev.every((i) => i.time === ""));
  });
  it("call-backs and Work due are dates: no time, owners by name, a subtask names its parent", () => {
    const cb = ALL.filter((i) => i.layer === "callbacks");
    assert.deepEqual(cb.map((i) => [i.day, i.title, i.sub]), [["2026-11-24", "Lagos Jazz Nights", "Host · Tao"], ["2026-11-27", "Ngozi Films", "Creator · Tao, Kemi"]]);
    assert.ok(cb.every((i) => i.time === "" && i.label === "Call back"));
    const wd = ALL.filter((i) => i.layer === "work");
    assert.deepEqual(wd.map((i) => i.title), ["#4571 Send the launch note", "#4572 A subtask"]);
    assert.equal(wd[1].label, "Subtask due");
    assert.equal(wd[1].sub, "Under #4571");
    assert.equal(wd[1].overdue, true);
  });
  it("only the layers that are on show, on their days", () => {
    const grouped = itemsByDay(ALL, new Set(["work"]), DAYS);
    assert.deepEqual(Object.keys(grouped), DAYS);
    assert.equal(grouped["2026-11-24"].length, 2);
    assert.equal(DAYS.reduce((n, d) => n + grouped[d].length, 0), 2);
    assert.equal(DAYS.reduce((n, d) => n + itemsByDay(ALL, new Set(), DAYS)[d].length, 0), 0);
    assert.equal(DAYS.reduce((n, d) => n + itemsByDay(ALL, parseLayers(null), DAYS)[d].length, 0), 8);
  });
  it("the search filters every layer", () => {
    const some = weekItems({ days: DAYS, events: EVENTS, callbacks: CALLBACKS, work: WORK, calls: [], zone: "UTC", q: "launch" });
    assert.deepEqual(some.map((i) => i.title), ["#4571 Send the launch note"]);
  });
  it("a bad answer for a layer shows nothing for it and never throws", () => {
    assert.deepEqual(weekItems({ days: DAYS, events: null, calls: null, callbacks: null, work: null, zone: "UTC" }), []);
    assert.deepEqual(weekItems({ days: DAYS, events: { events: [null, {}], expected: [undefined] }, calls: [null, {}], callbacks: [null], work: [null], zone: "UTC" }), []);
  });
});

describe("W-4 every item opens its card or record; a demo with no card says Needs linking", () => {
  const by = (id) => ALL.find((i) => i.id === id);
  it("each layer opens its own record in panel two (or the booking)", () => {
    assert.deepEqual(by("ev-e1").open, { side: { kind: "event", id: "e1" } });
    assert.deepEqual(by("x-x1-2026-11-26").open, { side: { kind: "expected", id: "x1" } });
    assert.deepEqual(by("cb-22222222-2222-4222-8222-222222222222").open, { side: { kind: "host", id: "22222222-2222-4222-8222-222222222222" } });
    assert.deepEqual(by("cb-33333333-3333-4333-8333-333333333333").open, { side: { kind: "creator", id: "33333333-3333-4333-8333-333333333333" } });
    assert.deepEqual(by("wd-w1").open, { side: { kind: "card", id: "w1" } });
  });
  it("a linked demo opens its host card and names it; an unlinked one opens the booking and says Needs linking", () => {
    const linked = by("call-c-1");
    assert.deepEqual(linked.open, { side: { kind: "host", id: HOST_CARD } });
    assert.equal(linked.sub, "Linked to Vault Lounge");
    assert.equal(linked.needsLinking, false);
    const loose = by("call-c-2");
    assert.deepEqual(loose.open, { call: "c-2" });
    assert.equal(loose.sub, "Needs linking");
    assert.equal(loose.needsLinking, true);
  });
  it("a cancelled demo stays, struck through, and still opens", () => {
    const [gone] = weekItems({ days: DAYS, calls: [callRow({ status: "cancelled", call_at: "2026-11-24T10:00:00Z" })], zone: "UTC" });
    assert.equal(gone.off, true);
    assert.equal(gone.statusLabel, "Cancelled");
    assert.deepEqual(gone.open, { call: "c-1" });
  });
  it("every item has something to open (no dead taps)", () => {
    for (const i of ALL) assert.ok(i.open && (i.open.call || (i.open.side && i.open.side.kind && i.open.side.id)), i.id);
  });
  it("the page opens a booking through its first panel and every other item through panel two", () => {
    const page = read("pages/ContentCalendarPage.jsx");
    assert.match(page, /const openWeekItem = \(item\) => \{ if \(item\.open\.call\) openCall\(item\.open\.call\); else if \(item\.open\.side\) stack\.openSide\(item\.open\.side\); \};/);
    const view = read("components/contentCalendar/WeekView.jsx");
    assert.match(view, /onClick=\{\(\) => onOpen\(item\)\}/);
  });
});

describe("W-5 chips wrap inside their own day column", () => {
  const classes = (s) => s.split(/\s+/);
  it("a Work due chip has its own class names, never the due-date pill's", () => {
    assert.ok(classes(WORK_DUE_CHIP_CLASS).includes("week-work-chip"));
    assert.ok(!classes(WORK_DUE_CHIP_CLASS).includes("due"), "no bare due class");
    assert.ok(!classes(weekChipClass({ layer: "work" })).includes("due"));
    assert.ok(!classes(weekChipClass({ layer: "events" })).includes("week-work-chip"));
  });
  it("every chip fills its column and wraps; a long word breaks inside it", () => {
    for (const layer of WEEK_LAYER_KEYS) {
      const cls = classes(weekChipClass({ layer }));
      for (const need of ["w-full", "min-w-0", "max-w-full", "whitespace-normal", "[overflow-wrap:anywhere]"]) assert.ok(cls.includes(need), `${layer} has ${need}`);
    }
  });
  it("no chip or title class nowraps, truncates or clamps", () => {
    const text = [WEEK_CHIP_BASE, WEEK_CHIP_TITLE, WORK_DUE_CHIP_CLASS, ...WEEK_LAYER_KEYS.map((l) => weekChipClass({ layer: l }))].join(" ");
    assert.doesNotMatch(text, /nowrap|truncate|line-clamp|text-ellipsis|overflow-hidden|\bwhitespace-pre\b/);
    // The chip itself (the toolbar's "This week" button is not a chip).
    const view = read("components/contentCalendar/WeekView.jsx");
    const chip = view.slice(view.indexOf("function WeekChip"), view.indexOf("export function WeekView"));
    assert.ok(chip.length > 400, "the chip source was found");
    assert.doesNotMatch(chip, /line-clamp|truncate|whitespace-nowrap|ChipWords|overflow-hidden/);
  });
  it("the grid is one column on a phone and seven where there is room, each column able to shrink", () => {
    const view = read("components/contentCalendar/WeekView.jsx");
    assert.match(view, /grid-cols-1 @min-\[760px\]:grid-cols-\[repeat\(7,minmax\(0,1fr\)\)\]/);
    assert.match(view, /<section[\s\S]*?className=\{`flex min-w-0 flex-col/);
  });
});

describe("W-6 the page", () => {
  const page = read("pages/ContentCalendarPage.jsx");
  it("has a Week option between Month and Board", () => {
    assert.match(page, /\{ value: "calendar", label: "Month" \},\s*\{ value: "week", label: "Week" \},\s*\{ value: "board", label: "Board" \}/);
    assert.match(page, /view: p\.get\("view"\) === "board" \? "board" : p\.get\("view"\) === "week" \? "week" : "calendar"/);
  });
  it("reads the week's days for every source, and call-backs and Work due only in the Week view", () => {
    assert.match(page, /const rangeFrom = isWeek && week \? week\.from : localDateKey\(days\[0\]\);/);
    assert.match(page, /const opsCal = useOpsCalendar\(rangeFrom, rangeTo\);/);
    assert.match(page, /const callSpan = isWeek && week \? \{ from: week\.fromIso, to: week\.toIso \}/);
    assert.match(page, /useCalendarCallbacks\(rangeFrom, rangeTo, isWeek\)/);
    assert.match(page, /useCalendarWorkDue\(rangeFrom, rangeTo, isWeek\)/);
    const hooks = read("hooks/useOpsCalendar.js");
    assert.match(hooks, /enabled: enabled && !!from && !!to/);
  });
  it("keeps the layers and the week in the address, never in local storage", () => {
    assert.match(page, /layers: parseLayers\(p\.get\("layers"\)\)/);
    assert.match(page, /const setLayers = [\s\S]*?layersParam\(next\)[\s\S]*?setSearch\(p\.toString\(\), \{ replace: true \}\)/);
    assert.match(page, /const shiftWeek = \(by\) => setParam\("week", addDaysKey\(monday, 7 \* by\)\);/);
    for (const file of ["pages/ContentCalendarPage.jsx", "components/contentCalendar/WeekView.jsx", "lib/calendarWeek.js"]) {
      assert.doesNotMatch(read(file), /localStorage|sessionStorage/);
    }
  });
  it("adds no typed date field", () => {
    for (const file of ["pages/ContentCalendarPage.jsx", "components/contentCalendar/WeekView.jsx", "lib/calendarWeek.js"]) {
      assert.doesNotMatch(read(file), /type=["']date["']|type:\s*["']date["']/);
    }
  });
  it("every layer that fails to load says so with Try again and keeps the others; no layer, no items and loading each have words", () => {
    for (const [key, read] of [["events", "opsCal"], ["demos", "callsRead"], ["callbacks", "callbacksRead"], ["work", "workDueRead"]]) {
      assert.match(page, new RegExp(`route\\.layers\\.has\\("${key}"\\) && ${read}\\.error && !${read}\\.data \\? \\{ key: "${key}"`));
    }
    const view = read("components/contentCalendar/WeekView.jsx");
    assert.match(view, /Try again/);
    assert.match(view, /The other layers still show/);
    assert.match(view, /Loading the week/);
    assert.match(view, /Every layer is off/);
    assert.match(view, /Nothing on for the layers you have on this week/);
  });
  it("the service calls the two new functions with the week's dates", () => {
    const svc = read("services/opsService.js");
    assert.match(svc, /ops_calendar_callbacks", \{ p_from: from, p_to: to \}/);
    assert.match(svc, /ops_calendar_work_due", \{ p_from: from, p_to: to \}/);
  });
  it("the Show filter and the state tiles belong to Month and Board, not Week", () => {
    assert.match(page, /\{!isWeek && \(route\.show === "" \|\| route\.show === "events"\)/);
    assert.match(page, /\{!isWeek && <FilterSelect name="show"/);
  });
});
