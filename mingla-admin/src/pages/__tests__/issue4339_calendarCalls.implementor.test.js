// Issue #4339 Creators and Locals calls (Seth approved, 9 Nov) — booked calls
// on the admin Calendar, and Host / Creator / Local calls in Inbound leads.
//
//   CC-1  One call_at lands on different local days and times for a viewer in
//         Africa/Lagos and one in America/Los_Angeles; the footnote names the
//         viewer's zone.
//   CC-2  The calls layer: a day's calls in time order with time, badge and
//         name; the panel shows the name, the viewer's time, the booker's own
//         time, what they run or make, city, a safe social link, Join video
//         call and Open lead.
//   CC-3  The Calendar page: Show has Calls (Everything includes them), the
//         layer is read through admin_calendar_calls beside ops_calendar, a
//         call opens its panel, and a phone shows calls as dots.
//   CC-4  Inbound leads: Host call / Creator call / Local call labels, the
//         audience filter, and only a Host call can be added to Hosts.
//
// FAILS-ON-REVERT: drawing calls by their UTC date fails CC-1; dropping Calls
// from SHOW_OPTIONS or the calls branch of dayEntries fails CC-3; labelling
// every booking "Book a call" fails CC-4.
//
// Run: node --test src/pages/__tests__/issue4339_calendarCalls.implementor.test.js
// (from mingla-admin). Hermetic: pure modules and source text only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CALL_LABELS, calendarZoneNote, callDayKey, callEntriesOn, callTime, callView } from "../../lib/calendarCalls.js";
import { LEAD_FILTERS, filterLeads, leadView } from "../../lib/inboundLeads.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const strip = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

// 23:30 UTC on 11 March 2031: 00:30 on the 12th in Lagos, 16:30 on the 11th in Los Angeles.
const CALL_AT = "2031-03-11T23:30:00Z";
const CREATOR = {
  id: "8f1c2a4e-0000-4000-8000-000000000001",
  lead_id: "8f1c2a4e-0000-4000-8000-000000000001",
  audience: "creator",
  name: "Ada Okafor",
  call_at: CALL_AT,
  city: "Lagos",
  makes: "both",
  social_platform: "tiktok",
  social_handle: "@adashoots",
  social_url: "https://tiktok.com/@adashoots",
  work_url: "https://adashoots.example/reel",
  booker_time_zone: "Africa/Lagos",
  meet_url: "https://meet.google.com/abc-defg-hij",
  event_url: "https://calendar.google.com/event?eid=x",
  status: "booked",
};
const HOST = { ...CREATOR, id: "8f1c2a4e-0000-4000-8000-000000000002", lead_id: "8f1c2a4e-0000-4000-8000-000000000002", audience: "host", name: "Grace Host", call_at: "2031-03-11T15:00:00Z", icp: "events", makes: null, city: null, venue: "Supper Club", booker_time_zone: "America/New_York" };
const LOCAL = { ...CREATOR, id: "8f1c2a4e-0000-4000-8000-000000000003", lead_id: "8f1c2a4e-0000-4000-8000-000000000003", audience: "local", name: "Tobi Adeyemi", call_at: "2031-03-11T09:00:00Z", makes: null, first_place: "Bida Manda", city: "Raleigh" };

describe("#4339 CC-1: each viewer sees the call on their own day and time", () => {
  it("one call_at, two zones", () => {
    assert.equal(callDayKey(CALL_AT, "Africa/Lagos"), "2031-03-12");
    assert.equal(callTime(CALL_AT, "Africa/Lagos"), "12:30 AM");
    assert.equal(callDayKey(CALL_AT, "America/Los_Angeles"), "2031-03-11");
    assert.equal(callTime(CALL_AT, "America/Los_Angeles"), "4:30 PM");
    // So the same call is on the 12th for Lagos and the 11th for Los Angeles.
    assert.deepEqual(callEntriesOn("2031-03-12", [CREATOR], "Africa/Lagos").map((e) => e.callId), [CREATOR.id]);
    assert.deepEqual(callEntriesOn("2031-03-11", [CREATOR], "Africa/Lagos"), []);
    assert.deepEqual(callEntriesOn("2031-03-11", [CREATOR], "America/Los_Angeles").map((e) => e.time), ["4:30 PM"]);
    assert.deepEqual(callEntriesOn("2031-03-12", [CREATOR], "America/Los_Angeles"), []);
  });
  it("the footnote names the viewer's zone", () => {
    const at = new Date(CALL_AT);
    assert.match(calendarZoneNote("Africa/Lagos", at), /^Calls and post times are in your time zone \(Africa\/Lagos (WAT|GMT\+1)\)\. Events stay on their own local day and time\.$/);
    assert.match(calendarZoneNote("America/Los_Angeles", at), /\(America\/Los_Angeles PDT\)/);
  });
});

describe("#4339 CC-2: the calls layer and the panel", () => {
  it("a day's calls in time order: time first, then the badge, then the name", () => {
    const entries = callEntriesOn("2031-03-11", [CREATOR, HOST, LOCAL, { id: "x", audience: "promoter", call_at: CALL_AT }], "America/New_York");
    assert.deepEqual(entries.map((e) => [e.time, e.badge, e.title]), [
      ["5:00 AM", "Local call", "Tobi Adeyemi"],
      ["11:00 AM", "Host call", "Grace Host"],
      ["7:30 PM", "Creator call", "Ada Okafor"],
    ]);
    assert.deepEqual(CALL_LABELS, { host: "Host call", creator: "Creator call", local: "Local call" });
  });
  it("the panel: who, when for the viewer and for the booker, what they make, city, links", () => {
    const v = callView(CREATOR, "America/Los_Angeles");
    assert.equal(v.badge, "Creator call");
    assert.equal(v.name, "Ada Okafor");
    assert.equal(v.when, "Tuesday, 11 March 2031, 4:30 PM PDT");
    assert.match(v.bookerWhen, /^Wednesday, 12 March 2031, 12:30 AM (WAT|GMT\+1) \(Africa\/Lagos\)$/);
    assert.equal(v.what, "Makes: Video and photos");
    assert.equal(v.city, "Lagos");
    assert.equal(v.socialUrl, "https://tiktok.com/@adashoots");
    assert.equal(v.meetUrl, "https://meet.google.com/abc-defg-hij");
    assert.equal(v.leadHash, `#/inbound?lead=${CREATOR.id}`);
    assert.equal(v.status, "booked");
    // The booker's own time is left out when it is the viewer's zone.
    assert.equal(callView(CREATOR, "Africa/Lagos").bookerWhen, null);
    assert.equal(callView(HOST, "Africa/Lagos").what, "Runs: Events");
    assert.equal(callView(LOCAL, "Africa/Lagos").what, "First place: Bida Manda");
    // Only https links are rendered.
    const bad = callView({ ...CREATOR, social_url: "javascript:alert(1)", meet_url: "http://meet.example" }, "Africa/Lagos");
    assert.equal(bad.socialUrl, null);
    assert.equal(bad.meetUrl, null);
  });
});

describe("#4339 CC-3: the Calendar page", () => {
  const page = strip(read("pages/ContentCalendarPage.jsx"));
  it("Show has Calls, and Everything includes them", () => {
    assert.match(page, /\{ value: "", label: "Everything" \},\s*\{ value: "events", label: "Events" \},\s*\{ value: "posts", label: "Posts" \},\s*\{ value: "calls", label: "Calls" \},/);
    assert.match(page, /const SHOW_VALUES = \["events", "posts", "calls"\];/);
    assert.match(page, /if \(show === "" \|\| show === "calls"\) out\.push\(\.\.\.callEntriesOn\(key, calls, zone\)\);/);
    assert.match(page, /if \(\(show === "" \|\| show === "events"\) && data\)/, "Calls alone shows no events");
    assert.match(page, /if \(show === "" \|\| show === "posts"\) for \(const item of items\)/, "Calls alone shows no posts");
  });
  it("reads the calls layer beside ops_calendar, in the viewer's zone", () => {
    assert.match(read("services/opsService.js"), /export const fetchCalendarCalls = \(fromIso, toIso, showTest\) =>\s*call\(\(\) => supabase\.rpc\("admin_calendar_calls", \{ p_from: fromIso, p_to: toIso, p_show_test: !!showTest \}\)\);/);
    assert.match(read("services/opsService.js"), /supabase\.rpc\("ops_calendar", \{ p_from: from, p_to: to, p_today: today \|\| null \}\)/, "#3980's read is unchanged");
    assert.match(read("hooks/useOpsCalendar.js"), /export function useCalendarCalls\(fromIso, toIso, showTest\)/);
    assert.match(page, /const zone = viewerTimeZone\(\) \|\| undefined;/);
    assert.match(page, /const callsRead = useCalendarCalls\(callSpan\.from, callSpan\.to, route\.test\);/);
    assert.match(page, /\{calendarZoneNote\(zone\)\}/);
  });
  it("a call chip opens its panel; a phone shows it as a dot", () => {
    assert.match(page, /<b className="whitespace-nowrap tabular-nums" data-call-time="">\{e\.time\}<\/b>\s*<span[^>]*data-call-badge="">\{e\.badge\}<\/span>[\s\S]*?<ChipWords text=\{e\.title\} \/>/, "time, badge, name");
    assert.match(page, /e\.type === "call" \? <CallDot key=\{e\.id\} \/> : <StateDot/);
    assert.match(page, /const openCall = \(id\) => openFirst\("call", id\);/);
    assert.match(page, /route\.call \? \(\s*<CallPanel call=\{openCallRow\} zone=\{zone\}/);
    assert.match(page, />Join video call<\/a>/);
    assert.match(page, />Open lead<\/a>/);
    assert.match(page, /\{row\("Their time", v\.bookerWhen\)\}/);
  });
});

describe("#4339 CC-4: Inbound leads by audience", () => {
  const row = (id, audience) => ({ id, source: "book_a_call", business: `Lead ${id}`, has_email: true, host: null, booking: { audience, social_platform: "instagram", social_url: "https://instagram.com/x", call_at: CALL_AT, city: "Lagos", creator_makes: audience === "creator" ? "video" : null } });
  const rows = [row("h", "host"), row("c", "creator"), row("l", "local"), { id: "b", source: "beta", business: "Beta Bistro" }];
  it("labels each booking by its audience", () => {
    assert.deepEqual(rows.map((r) => leadView(r).source), ["Host call", "Creator call", "Local call", "Beta form"]);
    assert.equal(leadView(row("c", "creator")).booking.makes, "Video");
    assert.equal(leadView(row("l", "local")).booking.city, "Lagos");
  });
  it("filters by audience", () => {
    assert.deepEqual(LEAD_FILTERS.map((f) => f.value), ["", "host", "creator", "local"]);
    assert.equal(filterLeads(rows, "").length, 4);
    assert.deepEqual(filterLeads(rows, "creator").map((r) => r.id), ["c"]);
    assert.deepEqual(filterLeads(rows, "local").map((r) => r.id), ["l"]);
    assert.deepEqual(filterLeads(rows, "host").map((r) => r.id), ["h"]);
    const page = strip(read("pages/InboundLeadsPage.jsx"));
    assert.match(page, /<FilterSelect name="audience" label="Show" value=\{audience\} options=\{LEAD_FILTERS\} onChange=\{setAudience\} \/>/);
    assert.match(page, /filterLeads\(data\?\.rows, audience\)/);
  });
  it("only a Host call can be added to Hosts", () => {
    assert.equal(leadView(row("h", "host")).canAdd, true);
    assert.equal(leadView(row("c", "creator")).canAdd, false);
    assert.equal(leadView(row("l", "local")).canAdd, false);
  });
});
