// Issue #3980 synced program, Wave 3 rework — tester adversarial checks of
// the Admin fixes, from angles the implementor's suite does not take:
//   D3   the same address sent in different letter case, as owner and as
//        teammate, and "me" suggested three ways, is still one row; the
//        richer row (me, accepted) wins
//   D6   name matches come first even when the address-only match is in
//        Suggested; Enter on "kun" picks Kunle, never the suggested Debrah;
//        an invited name match is skipped by nothing (Enter refuses it with
//        its words, it never silently picks the next person)
//   D5   the last owner can't be removed by ×, Enter on the picked row or
//        Backspace, in any letter case; a second owner can be
//   D8   Needs you opens on the first tab with something waiting; a
//        teammate who can't see What hosts are told never lands on it;
//        "caught up" only once the counts have answered
//   D10  no band ever reads in the old words (full launch, tight, organic
//        only, missed), whatever the server sends
//   D4   a series lists only its dates not yet public, soonest first, mixed
//        with one-off events; a series with every date public adds no row;
//        an old server answer without dates still shows one row
//   GROUP Group by Person puts a card with two owners under each, a card
//        with none under "No owner"; Group by Event puts cards with no
//        event last
import { assert, assertEquals, assertNotMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  fieldKey as fieldKeyJs,
  normalizeTeam,
  peopleOptions,
  removePerson,
  suggestedPeople,
} from "../lib/peopleField.js";
import {
  bandShort,
  groupCards,
  hostUpcomingRows,
  needsYouCaughtUp,
  needsYouStartTab,
  runwayLabel,
} from "../lib/opsModel.js";

// deno-lint-ignore no-explicit-any
const fieldKey = fieldKeyJs as (state: unknown, key: string, opts: any) => { state: { open: boolean; hi: number }; pick?: string; remove?: string; refused?: string };
const emails = (list: Array<{ email: string }>) => list.map((p) => p.email);

const RAW = [
  { email: "SETH@usemingla.com", name: "Seth", role_label: "Owner", status: "invited", open_cards: 1 },
  { email: "seth@usemingla.com", name: "Seth", role_label: "Owner", status: "active", open_cards: 3, me: true },
  { email: "debrah.kun@usemingla.com", name: "Debrah", role_label: "Sales and marketing", status: "active", open_cards: 2 },
  { email: "kunle@usemingla.com", name: "Kunle Akin", role_label: "Sales and marketing", status: "active", open_cards: 4 },
  { email: "kunbi@usemingla.com", name: "Kunbi", role_label: "Sales and marketing", status: "invited", open_cards: 0 },
];
const TEAM = normalizeTeam(RAW);

Deno.test("#3980 W3 rework tester D3: one row per address in any letter case; the accepted, me row wins", () => {
  assertEquals(TEAM.filter((p) => p.email === "seth@usemingla.com").length, 1);
  const seth = TEAM.find((p) => p.email === "seth@usemingla.com")!;
  assertEquals(seth.me, true, "me survives a duplicate without the me flag");
  assertEquals(seth.invited, false, "an accepted row beats an invited duplicate");
  const sug = suggestedPeople("Seth@UseMingla.com", ["seth@usemingla.com", "SETH@USEMINGLA.COM"], "seth@usemingla.com");
  assertEquals(sug, ["seth@usemingla.com"]);
  const opts = peopleOptions(RAW as never, "", sug);
  assertEquals(opts.flat.filter((p: { email: string }) => p.email.toLowerCase() === "seth@usemingla.com").length, 1, "you are listed once");
});

Deno.test("#3980 W3 rework tester D6: a name match beats a suggested address-only match; Enter picks Kunle", () => {
  // Debrah is suggested (she owns the card) and her address has "kun" in it.
  const opts = peopleOptions(TEAM, "kun", ["debrah.kun@usemingla.com", "seth@usemingla.com"]);
  assertEquals(opts.flat[0].email, "kunle@usemingla.com", "the name match comes first");
  assertEquals(emails(opts.suggested), [], "an address-only match is not shown as a suggestion ahead of a name match");
  assert(emails(opts.flat).includes("debrah.kun@usemingla.com"), "the address match is still reachable");
  assert(emails(opts.flat).indexOf("debrah.kun@usemingla.com") > emails(opts.flat).indexOf("kunbi@usemingla.com"), "every name match comes before it");
  const r = fieldKey({ open: true, hi: 0 }, "Enter", { options: opts.flat, value: [] });
  assertEquals(r.pick, "kunle@usemingla.com");
});

Deno.test("#3980 W3 rework tester D6: an invited name match is refused with its words, never swapped for someone else", () => {
  const opts = peopleOptions(TEAM, "kunb", []);
  assertEquals(emails(opts.flat), ["kunbi@usemingla.com"]);
  const r = fieldKey({ open: true, hi: 0 }, "Enter", { options: opts.flat, value: [] });
  assertEquals(r.pick, undefined);
  assert(r.refused && r.refused.includes("Kunbi"), "the refusal names the invited person");
});

Deno.test("#3980 W3 rework tester D5: the last owner stays on every path, in any letter case", () => {
  const value = ["Kunle@UseMingla.com"];
  assert(removePerson(value, "kunle@usemingla.com", 1).refused, "× on the last owner is refused");
  const picked = peopleOptions(TEAM, "kunle", []).flat;
  assert(fieldKey({ open: true, hi: 0 }, "Enter", { options: picked, value, min: 1 }).refused, "Enter on the picked last owner is refused");
  assert(fieldKey({ open: true, hi: 0 }, "Backspace", { options: picked, value, min: 1, query: "" }).refused, "Backspace on the last owner is refused");
  const two = ["kunle@usemingla.com", "seth@usemingla.com"];
  assertEquals(removePerson(two, "KUNLE@usemingla.com", 1).value, ["seth@usemingla.com"], "a second owner can go");
});

Deno.test("#3980 W3 rework tester D8: the start tab follows what is waiting and who can see it", () => {
  assertEquals(needsYouStartTab({ waiting: 0, draftNeeded: 1, needsPerson: 5, wording: 2 }, true), "messages", "a draft to write is a message");
  assertEquals(needsYouStartTab({ waiting: 0, draftNeeded: 0, needsPerson: 1, wording: 2 }, true), "spend");
  assertEquals(needsYouStartTab({ waiting: 0, draftNeeded: 0, needsPerson: 0, wording: 2 }, true), "told");
  assertEquals(needsYouStartTab({ waiting: 0, draftNeeded: 0, needsPerson: 0, wording: 2 }, false), "messages", "never a tab this person can't open");
  assertEquals(needsYouStartTab({}, false), "messages");
  assertEquals(needsYouStartTab({ waiting: "2" as unknown as number }, false), "messages");
  assertEquals(needsYouCaughtUp({ loaded: false, total: 0 }), false, "not caught up before the counts answer");
  assertEquals(needsYouCaughtUp({ loaded: true, total: 0 }), true);
  assertEquals(needsYouCaughtUp({ loaded: true, total: 1 }), false);
  assertEquals(needsYouCaughtUp(null), false);
});

Deno.test("#3980 W3 rework tester D10: no band reads in the old words, whatever the server sends", () => {
  const OLD = /full launch|\btight\b|organic only|\bmissed\b/i;
  for (const band of ["full", "tight", "organic", "not_live", "missed", "", null, "something_new"]) {
    const runway = { band, lead_days: 12, go_live_by: "2026-11-01" };
    assertNotMatch(runwayLabel(runway), OLD, `runwayLabel(${band})`);
    assertNotMatch(bandShort(runway), OLD, `bandShort(${band})`);
  }
});

Deno.test("#3980 W3 rework tester D4: a series lists only its dates not yet public, mixed with events, soonest first", () => {
  const events = [
    { id: "e1", title: "Lantern Night", start_on: "2026-10-30", state: { k: "ready" } },
    { id: "e0", title: "Last week", start_on: "2026-10-10", state: { k: "done" } },
  ];
  const series = {
    id: "x1", title: "Lantern Friday", repeats: "week", expected_on: "2026-10-30", state: { k: "notlive" },
    occurrences: [
      { on: "2026-10-30", live: true, event_id: "e1" },
      { on: "2026-11-06", live: false, state: { k: "notlive" } },
      { on: "2026-11-13", live: false },
      { on: "2026-11-20", live: false, state: { k: "notlive" } },
    ],
  };
  const once = { id: "x2", title: "Gala", repeats: "none", expected_on: "2026-11-10", state: { k: "notlive" } };
  const rows = hostUpcomingRows(events, [series, once], "2026-10-20");
  assertEquals(rows.map((r: { on: string }) => r.on), ["2026-10-30", "2026-11-06", "2026-11-10", "2026-11-13", "2026-11-20"]);
  assertEquals(rows.filter((r: { kind: string }) => r.kind === "event").length, 1, "the public date shows once, as its event; a past event is left out");
  assertEquals(rows.find((r: { on: string }) => r.on === "2026-11-13")?.state?.k, "notlive", "a date with no state of its own takes the series' state");
  const allLive = { ...series, occurrences: series.occurrences.map((o) => ({ ...o, live: true })) };
  assertEquals(hostUpcomingRows([], [allLive], "2026-10-20").length, 0, "a series with every date public adds no row of its own");
  const oldServer = { ...series, occurrences: undefined };
  assertEquals(hostUpcomingRows([], [oldServer], "2026-10-20").length, 1, "an answer without dates still shows the series once");
});

Deno.test("#3980 W3 rework tester GROUP: Person groups a two-owner card under each and an ownerless card under No owner; Event puts no event last", () => {
  const cards = [
    { id: "a", status: "todo", owners: [{ email: "seth@usemingla.com", name: "Seth" }, { email: "kunle@usemingla.com", name: "Kunle" }], anchor: null },
    { id: "b", status: "doing", owners: [], anchor: { kind: "event", id: "e1", title: "Lantern Night", start_on: "2026-11-06" } },
    { id: "c", status: "person", owners: [{ email: "seth@usemingla.com", name: "Seth" }], anchor: { kind: "event", id: "e0", title: "Gala", start_on: "2026-10-30" } },
  ];
  const byPerson = groupCards(cards, "person");
  const of = (title: string) => byPerson.find((g: { title: string }) => g.title === title)?.cards.map((c: { id: string }) => c.id);
  assertEquals(of("Seth"), ["a", "c"]);
  assertEquals(of("Kunle"), ["a"]);
  assertEquals(of("No owner"), ["b"]);
  const byEvent = groupCards(cards, "event");
  assertEquals(byEvent.map((g: { key: string }) => g.key), ["event:e0", "event:e1", "none"]);
  assertEquals(groupCards([], "person"), []);
});
