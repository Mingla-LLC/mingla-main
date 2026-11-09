// Issue #4339 calendar sync (Seth approved, 9 Nov) — booked calls that are
// moved or cancelled in Google Calendar update on the admin Calendar.
//
//   CST-1 A moved call is drawn at its NEW time with a "Moved" badge; a
//         cancelled or declined call stays on its day, marked off, with a
//         "Cancelled" / "Declined" badge. An unknown status reads as booked.
//   CST-2 The panel: the status, when it changed (in the viewer's zone) and a
//         moved call's booked time.
//   CST-3 The Calendar page: a cancelled or declined chip is struck through
//         with its badge, the phone dot is hollow, the Calls filter keeps them
//         (callEntriesOn never drops a call for its status), and the panel has
//         Status, Changed and Booked for rows.
//   CST-4 Inbound leads: each booking row shows its status.
//
// FAILS-ON-REVERT: drawing a moved call at original_call_at fails CST-1;
// filtering cancelled calls out of callEntriesOn fails CST-1 and CST-3;
// dropping the line-through on an off chip fails CST-3; dropping the
// Booked for row fails CST-3.
//
// Run: node --test src/pages/__tests__/issue4339_callStatus.implementor.test.js
// (from mingla-admin). Hermetic: pure modules and source text only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CALL_STATUS_LABELS, callEntriesOn, callIsOff, callStatus, callView } from "../../lib/calendarCalls.js";
import { leadView } from "../../lib/inboundLeads.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const strip = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const ZONE = "America/New_York";
const BASE = {
  lead_id: null,
  audience: "host",
  name: "Grace Host",
  icp: "events",
  venue: "Supper Club",
  social_platform: "instagram",
  social_url: "https://instagram.com/supper",
  status: "booked",
};
// Booked for Tue 11 March 2031 11:00 New York; moved to Wed 12 March 13:20.
const MOVED = {
  ...BASE,
  id: "9a000000-0000-4000-8000-000000000001",
  call_at: "2031-03-12T17:20:00Z",
  original_call_at: "2031-03-11T15:00:00Z",
  status: "moved",
  status_changed_at: "2031-03-05T14:05:00Z",
};
const CANCELLED = { ...BASE, id: "9a000000-0000-4000-8000-000000000002", name: "Cancel Creator", audience: "creator", icp: null, makes: "video", city: "Lagos", call_at: "2031-03-11T19:00:00Z", status: "cancelled", status_changed_at: "2031-03-06T09:00:00Z" };
const DECLINED = { ...BASE, id: "9a000000-0000-4000-8000-000000000003", name: "Decline Local", audience: "local", icp: null, city: "Raleigh", call_at: "2031-03-11T20:00:00Z", status: "declined", status_changed_at: "2031-03-06T10:00:00Z" };
const BOOKED = { ...BASE, id: "9a000000-0000-4000-8000-000000000004", call_at: "2031-03-11T16:00:00Z" };

describe("#4339 CST-1: moved, cancelled and declined calls on the month", () => {
  it("a moved call is drawn at its new time with a Moved badge", () => {
    assert.deepEqual(callEntriesOn("2031-03-11", [MOVED], ZONE), [], "not on the booked day");
    const [moved] = callEntriesOn("2031-03-12", [MOVED], ZONE);
    assert.equal(moved.time, "1:20 PM");
    assert.equal(moved.status, "moved");
    assert.equal(moved.statusLabel, "Moved");
    assert.equal(moved.off, false);
  });
  it("cancelled and declined calls stay on their day, marked off, with their badge", () => {
    const day = callEntriesOn("2031-03-11", [BOOKED, CANCELLED, DECLINED], ZONE);
    assert.deepEqual(day.map((e) => [e.title, e.status, e.statusLabel, e.off]), [
      ["Grace Host", "booked", null, false],
      ["Cancel Creator", "cancelled", "Cancelled", true],
      ["Decline Local", "declined", "Declined", true],
    ]);
  });
  it("an unknown or missing status reads as booked", () => {
    assert.equal(callStatus("deleted"), "booked");
    assert.equal(callStatus(undefined), "booked");
    assert.equal(callIsOff("cancelled") && callIsOff("declined") && !callIsOff("moved") && !callIsOff("booked"), true);
    assert.deepEqual(CALL_STATUS_LABELS, { booked: "Booked", moved: "Moved", cancelled: "Cancelled", declined: "Declined" });
    assert.equal(callEntriesOn("2031-03-11", [{ ...BOOKED, status: "weird" }], ZONE)[0].statusLabel, null);
  });
});

describe("#4339 CST-2: the panel names the status, when it changed and the booked time", () => {
  it("a moved call", () => {
    const v = callView(MOVED, ZONE);
    assert.equal(v.status, "moved");
    assert.equal(v.statusLabel, "Moved");
    assert.equal(v.off, false);
    assert.match(v.when, /^Wednesday,? 12 March 2031, 1:20 PM EDT$/);
    assert.match(v.originalWhen, /^Tuesday,? 11 March 2031, 11:00 AM EDT$/);
    assert.match(v.statusChangedWhen, /^Wednesday,? 5 March 2031, 9:05 AM EST$/);
  });
  it("a cancelled call, and a booked one", () => {
    const v = callView(CANCELLED, ZONE);
    assert.equal(v.status, "cancelled");
    assert.equal(v.off, true);
    assert.equal(v.originalWhen, null);
    assert.match(v.statusChangedWhen, /^Thursday,? 6 March 2031, 4:00 AM EST$/);
    const b = callView(BOOKED, ZONE);
    assert.equal(b.status, "booked");
    assert.equal(b.statusChangedWhen, null);
    assert.equal(b.originalWhen, null);
  });
});

describe("#4339 CST-3: the Calendar page", () => {
  const page = strip(read("pages/ContentCalendarPage.jsx"));
  const lib = strip(read("lib/calendarCalls.js"));
  it("an off chip is struck through and carries its status badge", () => {
    assert.match(page, /data-call-time="">\{e\.time\}<\/b>/);
    assert.match(page, /<b className=\{`whitespace-nowrap tabular-nums \$\{e\.off \? "line-through" : ""\}`\} data-call-time="">/);
    assert.match(page, /<span className=\{`block font-semibold \$\{e\.off \? "line-through" : ""\}`\} data-call-title="">/);
    assert.match(page, /<CallStatusBadge status=\{e\.status\} label=\{e\.statusLabel\} \/>/);
    assert.match(page, /aria-label=\{words\.join\(", "\)\}/, "the status is read out");
    assert.match(page, /<CallDot key=\{e\.id\} off=\{e\.off\} \/>/, "a hollow dot on a phone");
  });
  it("the Calls filter keeps cancelled and declined calls", () => {
    assert.match(page, /if \(show === "" \|\| show === "calls"\) out\.push\(\.\.\.callEntriesOn\(key, calls, zone\)\);/);
    assert.doesNotMatch(lib, /status[^\n]*continue;/, "callEntriesOn never skips a call for its status");
  });
  it("the panel has Status, Changed and Booked for rows", () => {
    assert.match(page, /\{row\("Status", \(/);
    assert.match(page, /\{row\("Changed", v\.statusChangedWhen \?/);
    assert.match(page, /\{row\("Booked for", v\.originalWhen \? <span className="line-through" data-call-original="">\{v\.originalWhen\}<\/span> : null\)\}/);
    assert.match(page, /"Cancelled in Google Calendar"/);
    assert.match(page, /"They declined the invite"/);
  });
});

describe("#4339 CST-4: Inbound leads shows each booking's status", () => {
  it("the booking view carries the status", () => {
    const lead = leadView({
      id: "9a000000-0000-4000-8000-000000000005",
      source: "book_a_call",
      created_at: "2031-03-01T10:00:00Z",
      business: "Supper Club",
      has_email: true,
      booking: { audience: "host", icp: "events", social_platform: "instagram", social_url: "https://instagram.com/s", call_at: MOVED.call_at, status: "moved", status_changed_at: MOVED.status_changed_at, original_call_at: MOVED.original_call_at },
    });
    assert.equal(lead.booking.status, "moved");
    assert.equal(lead.booking.statusLabel, "Moved");
    assert.equal(lead.booking.originalCallAt, MOVED.original_call_at);
    assert.equal(lead.booking.statusChangedAt, MOVED.status_changed_at);
  });
  it("the row renders it", () => {
    const inbound = strip(read("pages/InboundLeadsPage.jsx"));
    assert.match(inbound, /data-booking-status=\{booking\.status\}/);
    assert.match(inbound, /\{booking\.statusLabel\}/);
    assert.match(inbound, /data-booking-original="">Was: \{formatDateTime\(booking\.originalCallAt\)\}/);
  });
});
