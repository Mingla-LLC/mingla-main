// Issue #3980 synced program, Wave 3 rework — the Admin fixes after the
// design-fidelity test:
//   D3   you are never listed twice (a person sent twice, or me suggested twice)
//   D4   the host card lists every upcoming date of a repeating series
//   D5   the last owner is kept on automatic cards too, once there is one
//   D6   name matches come before address matches ("kun" then Enter = Kunle)
//   D7   the save and cancel words follow what the server did
//   D8   Needs you opens on the tab that has something; "You're all caught up."
//   D9   nothing sits under the Calendar month; every list follows Show; no
//        "Back to runway"
//   D10  the four plain states replace the old runway words
//   P3   Work groups by Status, Person or Event (one board at a time), the
//        Today pill is dark brand behind white text, chip and step links are
//        44px tall, the dashboard switches are switches, same-name rows show
//        the address, a day shows three entries when it has exactly three
import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  fieldKey as fieldKeyJs,
  normalizeTeam,
  peopleOptions,
  suggestedPeople,
} from "../lib/peopleField.js";
import {
  bandShort,
  expectedCancelledWords,
  expectedSavedWords,
  hostUpcomingRows,
  needsYouCaughtUp,
  needsYouStartTab,
  runwayLabel,
} from "../lib/opsModel.js";

// The JS reducer's inferred types are narrower than the values it takes.
// deno-lint-ignore no-explicit-any
const fieldKey = fieldKeyJs as (state: unknown, key: string, opts: any) => { pick?: string; refused?: string };

const SRC = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, SRC));
const code = (path: string) => read(path).replace(/^\s*\/\/.*$/gm, "");

const TEAM = normalizeTeam([
  { email: "seth@usemingla.com", name: "Seth", role_label: "Owner", status: "active", open_cards: 3, me: true },
  { email: "seth@usemingla.com", name: "Seth", role_label: "Sales and marketing", status: "active", open_cards: 3 },
  { email: "akunbi@partner.test", name: "Ada Okafor", role_label: "Founding partner", status: "active", open_cards: 1 },
  { email: "kunleakinwumi@usemingla.com", name: "Kunle Akin", role_label: "Sales and marketing", status: "active", open_cards: 4 },
]);

Deno.test("#3980 W3 rework D3: a person sent twice is listed once, and me suggested twice shows once", () => {
  assertEquals(TEAM.map((p) => p.email), ["seth@usemingla.com", "akunbi@partner.test", "kunleakinwumi@usemingla.com"]);
  assertEquals(TEAM[0].me, true);
  assertEquals(suggestedPeople("Seth@usemingla.com", ["seth@usemingla.com", "kunleakinwumi@usemingla.com"]), ["seth@usemingla.com", "kunleakinwumi@usemingla.com"]);
  // Even when a caller passes me twice, the list shows each person once.
  const o = peopleOptions(TEAM, "", ["seth@usemingla.com", "seth@usemingla.com", "seth@usemingla.com"]);
  assertEquals(o.suggested.map((p: { email: string }) => p.email), ["seth@usemingla.com"]);
  assertEquals(o.flat.filter((p: { email: string }) => p.email === "seth@usemingla.com").length, 1);
  const twice = peopleOptions([...TEAM, TEAM[0]], "", []);
  assertEquals(twice.flat.length, 3);
  for (const file of ["components/crm/OwnersField.jsx", "components/contentCalendar/ContentDrawer.jsx", "components/ops/WorkDetail.jsx"]) {
    assertMatch(code(file), /suggested=\{suggestedPeople\(directory\.me, /, file);
  }
});

Deno.test("#3980 W3 rework D6: a name match comes before an address match, so kun then Enter adds Kunle", () => {
  // Ada's address has "kun" in it and Ada is suggested; Kunle's name starts with it.
  const o = peopleOptions(TEAM, "kun", ["akunbi@partner.test"]);
  assertEquals(o.flat.map((p: { email: string }) => p.email), ["kunleakinwumi@usemingla.com", "akunbi@partner.test"]);
  const r = fieldKey({ open: true, hi: 0 }, "Enter", { options: o.flat, value: [] });
  assertEquals(r.pick, "kunleakinwumi@usemingla.com");
});

Deno.test("#3980 W3 rework D5: the last owner is kept once there is one, on automatic cards too", () => {
  const detail = code("components/ops/WorkDetail.jsx");
  assertMatch(detail, /min=\{ownerEmails\.length \? 1 : 0\}/);
  assertNotMatch(detail, /min=\{card\.auto \? 0 : 1\}/);
  assertMatch(detail, /This card keeps one owner once it has one\. Add someone else first, then remove this one\./);
  const r = fieldKey({ open: false, hi: 0 }, "Backspace", { options: [], value: ["seth@usemingla.com"], query: "", min: 1, minWords: "keep" });
  assertEquals(r.refused, "keep");
});

Deno.test("#3980 W3 rework D4: the host card lists every unpublished date of a repeating series", () => {
  const rows = hostUpcomingRows(
    [{ id: "e1", title: "Supper Club, 31 Oct", start_on: "2026-10-31", state: { k: "ready" } }],
    [{ id: "x1", title: "Supper Club", repeats: "week", expected_on: "2026-10-31", next_on: "2026-11-07", state: { k: "notlive" },
       occurrences: [
         { on: "2026-10-31", live: true, event_id: "e1" },
         { on: "2026-11-07", live: false, state: { k: "notlive" } },
         { on: "2026-11-14", live: false, state: { k: "notlive" } },
         { on: "2026-11-21", live: false, state: { k: "late" } },
       ] },
     { id: "x2", title: "Detty December menu", repeats: "none", expected_on: "2026-12-05", next_on: "2026-12-05", state: { k: "notlive" }, promo_moment: true }],
    "2026-10-20",
  );
  assertEquals(rows.map((r: { title: string }) => r.title), [
    "Supper Club, 31 Oct", "Supper Club, 7 Nov", "Supper Club, 14 Nov", "Supper Club, 21 Nov", "Detty December menu",
  ]);
  assertEquals(rows.filter((r: { repeats: boolean }) => r.repeats).length, 3);
  assertEquals(rows[3].state, { k: "late" });
  // The cancel control sits on the first date of the series only.
  assertEquals(rows.filter((r) => !!r.row).map((r: { title: string }) => r.title), ["Supper Club, 7 Nov", "Detty December menu"]);
  assertMatch(code("components/crm/OnMinglaSection.jsx"), /const upcoming = hostUpcomingRows\(events, open, today\);/);
});

Deno.test("#3980 W3 rework D7: the save and cancel words follow what the server did", () => {
  assertEquals(expectedSavedWords({ auto_steps: false, steps: null }), "Saved. Automatic steps are off, so no steps were added.");
  assertEquals(expectedSavedWords({ auto_steps: true, steps: { added: 2, closed: 0, redated: 0 } }), "Saved. It’s on the Calendar and its steps are in Work.");
  assertEquals(expectedSavedWords({ auto_steps: true, steps: { added: 0, closed: 0, redated: 0 } }), "Saved. It’s on the Calendar; its steps were already in Work.");
  assertEquals(expectedSavedWords({ auto_steps: true, steps: { stopped: true } }), "Saved. It’s on the Calendar. Its steps couldn’t be made just now; the next run adds them.");
  assertEquals(expectedCancelledWords({ auto_steps: false }), "Cancelled. Automatic steps are off, so no steps were changed.");
  assertEquals(expectedCancelledWords({ auto_steps: true, steps: { closed: 2 } }), "Cancelled. Its 2 open steps closed.");
  assertEquals(expectedCancelledWords({ auto_steps: true, steps: { closed: 0 } }), "Cancelled. It had no open steps.");
  const section = code("components/crm/OnMinglaSection.jsx");
  assertMatch(section, /title: expectedSavedWords\(result, /);
  assertMatch(section, /title: expectedCancelledWords\(result\)/);
  assertNotMatch(section, /Its open steps close by themselves/);
});

Deno.test("#3980 W3 rework D8: Needs you starts on the tab that has something and says when all is caught up", () => {
  assertEquals(needsYouStartTab({ waiting: 0, draftNeeded: 0, needsPerson: 2, wording: 0 }, false), "spend");
  assertEquals(needsYouStartTab({ waiting: 0, draftNeeded: 0, needsPerson: 0, wording: 1 }, true), "told");
  assertEquals(needsYouStartTab({ waiting: 0, draftNeeded: 0, needsPerson: 0, wording: 1 }, false), "messages");
  assertEquals(needsYouStartTab({ waiting: 1, needsPerson: 4 }, true), "messages");
  assertEquals(needsYouCaughtUp({ loaded: true, total: 0 }), true);
  assertEquals(needsYouCaughtUp({ loaded: false, total: 0 }), false);
  assertEquals(needsYouCaughtUp({ loaded: true, total: 1 }), false);
  const page = code("pages/DraftsPage.jsx");
  assertMatch(page, /You’re all caught up\./);
  assertMatch(page, /const start = needsYouStartTab\(reviewCount, canTell\);/);
  assertMatch(page, /setSearch\(`tab=\$\{start\}`, \{ replace: true \}\)/);
  // Picking Messages names it, so the start-tab rule never moves you off it.
  assertMatch(page, /: "tab=messages"\);/);
  // #4130: the hook's return spans lines now (it also carries the Work card count); same fields.
  assertMatch(code("hooks/useReviewCount.js"), /\n\s*loaded,\n\s*refetch: counts\.refetch,/);
});

Deno.test("#3980 W3 rework D9: nothing sits under the month, every list follows Show, no Back to runway", () => {
  const page = code("pages/ContentCalendarPage.jsx");
  const panel = code("components/ops/EventPanel.jsx");
  // With nothing open, only the calendar box: no right column, no runway list.
  assertMatch(page, /: <div className="flex min-w-0 flex-col gap-4">\{box\}<\/div>\}/);
  assertNotMatch(panel, /RunwayList|useOpsRunway/);
  assertMatch(panel, /: null;/);
  for (const [name, text] of [["page", page], ["panel", panel]]) assertNotMatch(text, /Back to runway/, name);
  // A day lists what Show says; the undated posts button shows only with posts.
  // #4130: the day list reads the month's events with test brands left out.
  assertMatch(page, /dayEntries\(route\.day, monthData, calendar\.items, route\.show\)/);
  assertMatch(page, /\{show !== "events" && <Button [^>]*onClick=\{onUndated\}/);
  // List view keeps the grouped list and the posts list, each behind Show.
  assertMatch(page, /route\.show !== "posts" && \(runway\.error/);
  assertMatch(page, /route\.show !== "events" && <PostsList /);
});

Deno.test("#3980 W3 rework D10: the four plain states, never the old runway words", () => {
  assertEquals(bandShort({ band: "full" }), "Ready to promote");
  assertEquals(bandShort({ band: "tight" }), "Promote now");
  assertEquals(bandShort({ band: "organic" }), "Too late for promo");
  assertEquals(bandShort({ band: "missed" }), "Too late for promo");
  assertEquals(bandShort({ band: "not_live", go_live_by: "2026-11-01" }), "Not live yet, live by 1 Nov");
  assertEquals(runwayLabel({ band: "full", lead_days: 30 }), "Ready to promote · live 30 days ahead");
  assertEquals(runwayLabel({ band: "missed" }), "Too late for promo · not live by the 3-week line");
  const banned = /full launch|organic only|\btight\b|missed go-live|>\s*\{?[^<]*\bmissed\b/i;
  // [TEST-MOD-APPROVED #3980] synced Wave 3 rework 2: CalendarLayers.jsx was unused and is deleted, so it leaves this list.
  for (const file of ["components/ops/TeamOpsPanels.jsx", "components/ops/WorkDetail.jsx", "components/ops/ReviewQueue.jsx"]) {
    const visible = code(file).replace(/className=\{?[`"][^`"]*[`"]\}?/g, "").replace(/\bcounts\.(tight|missed)\b|band === "(tight|missed)"|row\.band === "missed"/g, "");
    assertNotMatch(visible, banned, file);
  }
  assertMatch(code("components/ops/TeamOpsPanels.jsx"), /ready to promote<\/OpsChip>/);
  assertNotMatch(code("lib/agentConnect.js"), /full launch, a tight one, or are organic only/);
});

// #4130: the approved design drops "By person" (and Group by): the person
// chips filter the one column board instead. Only the board is shown.
Deno.test("#3980 W3 rework: Work groups by Status, Person or Event, one board at a time", () => {
  const page = code("pages/WorkBoardPage.jsx");
  assertNotMatch(page, /aria-label="Group by"/);
  assertNotMatch(page, /<WorkGroups /);
  assertEquals((page.match(/<WorkColumns /g) || []).length, 1);
  assertMatch(page, /<PersonChips people=\{people\.people\} owner=\{ownerFilter\}/);
  assertMatch(code("components/ops/WorkColumns.jsx"), /export function WorkGroups\(\{ cards = \[\], group, selectedId, onSelect \}\)/);
});

Deno.test("#3980 W3 rework P3: contrast, 44px targets, real switches, same names, three entries a day, a compact sprint strip", () => {
  const page = code("pages/ContentCalendarPage.jsx");
  assertMatch(page, /bg-\[var\(--color-brand-800\)\][^`]*text-white[^`]*\$\{FOCUS\}`\}>Today is/);
  assertMatch(page, /const DAY_ALL_UP_TO = 3;/);
  // Titles show from a 640px month box (688px at 1440 with an event open).
  assertMatch(page, /hidden min-w-0 flex-col gap-0\.5 @min-\[640px\]:flex/);
  assertNotMatch(page, /@min-\[760px\]/);
  assertMatch(page, /entries\.length <= DAY_ALL_UP_TO \? entries : entries\.slice\(0, DAY_LIMIT\)/);
  assertMatch(code("components/people/PeopleField.jsx"), /-my-1\.5 -mr-1 inline-grid h-11 w-11/);
  assertMatch(code("components/ops/EventSteps.jsx"), /inline-flex min-h-11 min-w-11 items-center[^`]*`\}>Card \{s\.card\.number\}/);
  assertEquals((code("components/ops/AgentActivity.jsx").match(/inline-flex min-h-11 items-center self-start/g) || []).length, 2);
  assertMatch(code("components/ops/LogRow.jsx"), /inline-flex min-h-11 items-center self-start/);
  assertMatch(code("components/ops/WorkDetail.jsx"), /-my-1\.5 -mr-1 inline-grid h-11 w-11 place-items-center rounded-full hover:bg-\[var\(--gray-200\)\]/);
  // #4130: the automatic-steps switches moved from the Team dashboard to the settings panels.
  const dash = code("components/ops/TeamSettingsPanels.jsx");
  assertMatch(dash, /<button id=\{id\} type="button" role="switch" aria-checked=\{!!on\}/);
  assertNotMatch(dash, /type="checkbox" role="switch"/);
  assertMatch(dash, /Engineering follow-through \(merged but not live, release records, live checks\) starts from the moment you first switch on automatic steps/);
  const panels = code("components/ops/TeamOpsPanels.jsx");
  assertMatch(panels, /\{p\.name\}\{sameName\(p, people\) && <span className="sr-only"> \(\{p\.email\}\)<\/span>\}/);
  assertMatch(panels, /\{sameName\(p, people\) && <tr aria-hidden="true" className="!border-t-0"><td colSpan=\{5\}[^>]*>\{p\.email\}<\/td><\/tr>\}/);
  assertMatch(code("components/ops/SprintStrip.jsx"), /data-sprint-strip="" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1\.5 rounded-xl border[^"]*px-2\.5 py-1\.5"/);
});
