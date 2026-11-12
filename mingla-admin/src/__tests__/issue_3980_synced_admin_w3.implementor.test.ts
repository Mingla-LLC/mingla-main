// Issue #3980 synced program, Wave 3 — the Admin side of the operations
// redesign: the menu (Needs you, Work, Calendar; #/agent-log opens Agent
// activity), the one people field (who matches, suggested first, invited
// never picked, the last owner kept, the keyboard, mentions told by email),
// the four plain states, Work's columns and its tabs never stacked, Needs
// attention counting what it lists, the host next-event filters, and the
// Calendar's month-first rules.
import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { NAV_GROUPS } from "../lib/constants.js";
import { PAGE_AREA_OVERRIDES } from "../lib/access.js";
import { buildCrmSearch, parseCrmSearch } from "../lib/crmUrl.js";
import {
  PLAIN_STATES,
  STATE_LEGEND,
  attentionCounts,
  attentionPrompt,
  cardReasons,
  columnCards,
  hostMissing,
  hostPassesFilter,
  hostReasons,
  keepPicksInText,
  mentionTokenFor,
  mentionedEmails,
  parseReviewSearch,
  stateLine,
  stateName,
} from "../lib/opsModel.js";
import { parseWorkView } from "../lib/workViews.js";
import {
  LAST_OWNER_WORDS,
  addPerson,
  avatarTone,
  canPick,
  fieldKey,
  invitedWords,
  mentionOptions,
  normalizeTeam,
  peopleOptions,
  personMatches,
  removePerson,
  shownName,
  toldWords,
} from "../lib/peopleField.js";

const SRC = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, SRC));
const code = (path: string) => read(path).replace(/^\s*\/\/.*$/gm, "");

const TEAM = normalizeTeam([
  { email: "seth@usemingla.com", name: "Seth", role_label: "Owner", status: "active", open_cards: 3, me: true },
  { email: "abimbola@usemingla.com", name: "Abimbola", role_label: "Sales and marketing", status: "active", open_cards: 6 },
  { email: "debrahknyakundi@usemingla.com", name: "Debrah", role_label: "Sales and marketing", status: "active", open_cards: 2 },
  { email: "debrah.o@partner.test", name: "Debrah", role_label: "Founding partner", status: "active", open_cards: 0 },
  { email: "kunleakinwumi@usemingla.com", name: "Kunle Akin", role_label: "Sales and marketing", status: "active", open_cards: 4 },
  { email: "suvwesukai@usemingla.com", name: "Suvwe", role_label: "Founding partner", status: "invited", open_cards: 0 },
]);
const emailsOf = (list: Array<{ email: string }>) => list.map((p) => p.email);

Deno.test("#3980 W3 D-11: the Pipeline menu is Needs you, Work and Calendar together; the Agent log is a tab on Work", () => {
  // #4130: Wave 0 — Needs you retired into Work's first column; Work sits in
  // Home and Calendar in Outreach. The Agent log is still a tab on Work.
  const home = NAV_GROUPS.find((g: { label: string | null }) => g.label === "Home");
  assertEquals(home?.items.map((i: { id: string; label: string }) => `${i.id}:${i.label}`), [
    // #4255 W4: Notifications left the menu for Messages in the top bar.
    "overview:Dashboard", "work-board:Work",
  ]);
  const outreach = NAV_GROUPS.find((g: { label: string | null }) => g.label === "Outreach");
  assertEquals(outreach?.items.map((i: { id: string; label: string }) => `${i.id}:${i.label}`), [
    // #4130 + #3872: the Creator Program pages sit under Hosts and creators.
    "outreach:Hosts and creators", "program-creators:Creators", "program-gigs:Gigs",
    "program-locals:Mingla Locals", "program-disputes:Disputes", "inbound:Inbound leads", "content-calendar:Calendar", "team-dashboard:Team dashboard",
  ]);
  // The page id stays, open to the pipelines, and lands on the tab.
  assertEquals(PAGE_AREA_OVERRIDES["agent-log"], "crm");
  assertMatch(read("App.jsx"), /"agent-log": AgentLogPage,/);
  const page = read("pages/AgentLogPage.jsx");
  assertMatch(page, /export const AGENT_LOG_REDIRECT = "#\/work-board\?tab=activity";/);
  assertMatch(page, /window\.location\.replace\(/);
  // #4255 (D9): Activity sits at the foot of Today and Needs attention is a
  // Show choice, so the old tab addresses still open the right place.
  assertEquals(parseWorkView("tab=activity").view, "today");
  assertEquals(parseWorkView("tab=attention&att=stuck").show, "attention");
  assertEquals(parseWorkView("tab=nope&att=nope").view, "board");
  assertEquals(parseReviewSearch("tab=told").tab, "told");
});

Deno.test("#3980 W3 R9: a person matches by the start of a word of the name, the address only from three letters", () => {
  const kunle = TEAM.find((p) => p.name === "Kunle Akin")!;
  assert(personMatches(kunle, "ku"));
  assert(personMatches(kunle, "ak"), "any word of the name");
  assert(!personMatches(kunle, "un"), "never the middle of a word");
  assert(!personMatches(kunle, "ki"), "two letters never search the address");
  assert(personMatches(kunle, "akinw"), "three or more letters search the address");
  assert(personMatches(kunle, ""));
});

Deno.test("#3980 W3 R9: suggested people come first, in their order, then everyone; invited are greyed and never picked", () => {
  const o = peopleOptions(TEAM, "", ["abimbola@usemingla.com", "seth@usemingla.com"]);
  assertEquals(emailsOf(o.suggested), ["abimbola@usemingla.com", "seth@usemingla.com"]);
  assertEquals(o.flat.length, TEAM.length);
  assertEquals(o.flat[2].email, "debrahknyakundi@usemingla.com");
  const suvwe = TEAM.find((p) => p.invited)!;
  assert(!canPick(suvwe));
  assertEquals(invitedWords(suvwe), "Suvwe hasn’t accepted the invite yet. Resend it from Team and roles.");
  // The keyboard cannot pick them either.
  const at = o.flat.findIndex((p) => p.invited);
  const r = fieldKey({ open: true, hi: at }, "Enter", { options: o.flat, value: [] });
  assertEquals(r.pick, undefined);
  assertEquals(r.refused, invitedWords(suvwe));
  // Two people with one name are shown with their address.
  const d1 = TEAM.find((p) => p.email === "debrahknyakundi@usemingla.com")!;
  assertEquals(shownName(d1, TEAM), "Debrah <debrahknyakundi@usemingla.com>");
  assertEquals(shownName(TEAM[0], TEAM), "Seth");
  assertEquals(avatarTone("seth@usemingla.com"), avatarTone("SETH@usemingla.com "));
});

Deno.test("#3980 W3 R9: people are added and removed by email; a card keeps its last owner and says why", () => {
  assertEquals(addPerson(["seth@usemingla.com"], "Abimbola@usemingla.com").value, ["seth@usemingla.com", "abimbola@usemingla.com"]);
  assertEquals(addPerson(["seth@usemingla.com"], "seth@usemingla.com").value, ["seth@usemingla.com"], "never twice");
  assertEquals(addPerson(["a@x.test"], "b@x.test", 1).refused, "Only one person can be picked here. Remove them first.");
  // The last owner.
  const last = removePerson(["seth@usemingla.com"], "seth@usemingla.com", 1);
  assertEquals(last.value, ["seth@usemingla.com"]);
  assertEquals(last.refused, LAST_OWNER_WORDS);
  assertEquals(LAST_OWNER_WORDS, "A card always keeps one owner. Add someone else first, then remove this one.");
  assertEquals(removePerson(["a@x.test", "b@x.test"], "a@x.test", 1), { value: ["b@x.test"], refused: null });
  assertEquals(removePerson(["a@x.test"], "a@x.test", 0), { value: [], refused: null }, "host owners may be none");
  // Backspace in an empty box removes the last chip, unless that breaks the minimum.
  assertEquals(fieldKey({ open: false, hi: 0 }, "Backspace", { value: ["a@x.test"], min: 1 }).refused, LAST_OWNER_WORDS);
  assertEquals(fieldKey({ open: false, hi: 0 }, "Backspace", { value: ["a@x.test", "b@x.test"], min: 1 }).remove, "b@x.test");
  assertEquals(fieldKey({ open: false, hi: 0 }, "Backspace", { value: ["a@x.test"], query: "de", min: 0 }).remove, undefined);
  // Enter on someone already picked takes them off (unless they are the last owner).
  const opts = peopleOptions(TEAM, "", []).flat;
  assertEquals(fieldKey({ open: true, hi: 0 }, "Enter", { options: opts, value: ["seth@usemingla.com"], min: 1 }).refused, LAST_OWNER_WORDS);
  assertEquals(fieldKey({ open: true, hi: 1 }, "Enter", { options: opts, value: ["seth@usemingla.com"], min: 1 }).pick, "abimbola@usemingla.com");
});

Deno.test("#3980 W3 R9: the keyboard moves through the list and Esc closes it", () => {
  const opts = peopleOptions(TEAM, "", []).flat;
  let s = fieldKey({ open: false, hi: 0 }, "ArrowDown", { options: opts }).state;
  assertEquals(s, { open: true, hi: 0 });
  s = fieldKey(s, "ArrowDown", { options: opts }).state;
  s = fieldKey(s, "ArrowDown", { options: opts }).state;
  assertEquals(s.hi, 2);
  s = fieldKey(s, "ArrowUp", { options: opts }).state;
  assertEquals(s.hi, 1);
  for (let i = 0; i < 20; i += 1) s = fieldKey(s, "ArrowDown", { options: opts }).state;
  assertEquals(s.hi, opts.length - 1, "stops at the last person");
  assertEquals(fieldKey(s, "Escape", { options: opts }).state, { open: false, hi: 0 });
});

Deno.test("#3980 W3 R9: a note tells the people picked by email, never someone invited, and says who", () => {
  // The @ list never offers someone who has not accepted.
  assertEquals(emailsOf(mentionOptions(TEAM, "su")), []);
  assertEquals(emailsOf(mentionOptions(TEAM, "deb")), ["debrahknyakundi@usemingla.com", "debrah.o@partner.test"]);
  // The note box's own steps (components/ops/NoteBox.jsx), with two Debrahs.
  let body = "Thanks @Deb";
  let picks: Array<{ email: string; name: string; token: string }> = [];
  const pick = (p: { email: string; name: string }) => {
    const token = mentionTokenFor(p, TEAM);
    body = body.replace(/@([\w.-]*)$/, `${token} `);
    picks = [...picks, { email: p.email, name: p.name, token }];
  };
  pick(TEAM.find((p) => p.email === "debrah.o@partner.test")!);
  const told = mentionedEmails(picks, body.trim());
  assertEquals(told, ["debrah.o@partner.test"], "the email of the Debrah picked, never the other");
  assertEquals(toldWords(told, TEAM), "Will tell: Debrah <debrah.o@partner.test>");
  // Deleting the mention text tells nobody.
  body = "Thanks";
  picks = keepPicksInText(picks, body) as typeof picks;
  assertEquals(toldWords(mentionedEmails(picks, body), TEAM), "Nobody will be told. Type @ and a name.");
  // The note box sends those emails and shows the line.
  const box = code("components/ops/NoteBox.jsx");
  assertMatch(box, /const options = typed \? mentionOptions\(team, typed\[1\]\) : \[\];/);
  assertMatch(box, /told=\{toldWords\(mentionedEmails\(picks, body\.trim\(\)\), team\)\}/);
  assertMatch(box, /onPost\(text, mentionedEmails\(picks, text\)\)/);
  // The content drawer's comment box is the same note box (its checkbox list is gone).
  const drawer = code("components/contentCalendar/ContentDrawer.jsx");
  assertMatch(drawer, /<NoteBox team=\{directory\.people\}/);
  assertNotMatch(drawer, /setMentions/);
});

Deno.test("#3980 W3 R9: the one people field is used for every owner, watcher and mention control", () => {
  for (const file of ["components/crm/OwnersField.jsx", "components/ops/WorkDetail.jsx", "components/ops/WorkAddForm.jsx", "components/contentCalendar/ContentDrawer.jsx", "pages/ContentCalendarPage.jsx", "components/ops/TeamSettingsPanels.jsx"]) { // #4130: the marketing owner field moved from the Team dashboard to the settings panels
    assertMatch(code(file), /<PeopleField\b/, file);
    assertNotMatch(code(file), /<PeoplePicker\b/, file);
  }
  const field = code("components/people/PeopleField.jsx");
  assertMatch(field, /role="combobox"/);
  assertMatch(field, /role="listbox"/);
  assertMatch(field, /aria-activedescendant=/);
  assertMatch(field, /aria-label=\{`Remove \$\{shownName\(person, team\)\}`\}/);
  assertMatch(field, /max-h-\[300px\][^"]*overflow-auto/);
  assertMatch(field, /Nobody on the team matches "\$\{query\}"\./);
  assertMatch(field, />Assign to me</);
  assertMatch(field, /Invite pending · Resend/);
  assertMatch(field, /`\$\{person\.open\} open`/);
  assertMatch(field, /break-normal \[overflow-wrap:normal\] hyphens-none/);
  assertNotMatch(field, /break-all|overflow-wrap:anywhere/);
  // Work card owners keep one, except cards Mingla made by itself.
  // [TEST-MOD-APPROVED #3980] synced Wave 3 rework (D5): an automatic card keeps its last owner too once it has one; with none it shows the field empty.
  assertMatch(code("components/ops/WorkDetail.jsx"), /label="Owner" single[\s\S]{0,240}?min=\{1\}/  /* #4398: one owner, always kept */);
});

Deno.test("#3980 W3 R6: the four plain states and their words", () => {
  assertEquals(STATE_LEGEND.map((k) => PLAIN_STATES[k as keyof typeof PLAIN_STATES]), ["Ready to promote", "Promote now", "Too late for promo", "Not live yet"]);
  assertEquals(stateName({ k: "notlive", name: "Draft, not live" }), "Draft, not live");
  assertEquals(stateName({ k: "done" }), "Happened");
  assertEquals(stateLine({ k: "notlive", name: "Not live yet", by: "2026-11-01" }), "Not live yet, live by 1 Nov");
  assertEquals(stateLine({ k: "late", name: "Too late for promo" }), "Too late for promo");
  const dot = code("components/ops/StateDot.jsx");
  assertMatch(dot, /ready: "bg-\[var\(--color-success-600\)\]"/);
  assertMatch(dot, /notlive: "bg-\[var\(--color-background-primary\)\] shadow-\[inset_0_0_0_2px_var\(--color-info-600\)\]"/);
  assertMatch(dot, /none: "bg-\[var\(--color-info-600\)\]"/);
});

Deno.test("#3980 W3 R7: Work's columns, its card badges, and the tabs never stacked", () => {
  const today = "2026-10-21";
  const cards = [
    { id: "1", status: "todo", person_reason: "send", owners: [], due_on: "2026-10-25" }, // #4270: tagged in To do
    { id: "2", status: "todo", owners: [], due_on: "2026-10-18" },
    { id: "3", status: "doing", owners: [{ email: "a@x.test" }], working: { last_update_at: "2026-10-10T00:00:00Z" } },
    { id: "4", status: "done", closed_at: "2026-10-20T10:00:00Z", owners: [] },
    { id: "5", status: "done", closed_at: "2026-10-12T10:00:00Z", owners: [] },
  ];
  assertEquals(columnCards(cards, "todo", today).map((c) => c.id), ["2", "1"], "late first, then by due date");
  // #4270 rework (P3-3): the server sends only this week's done cards; the board does not cut them again.
  assertEquals(columnCards(cards, "done", today).map((c) => c.id), ["4", "5"], "Done is what the server sent, latest closed first");
  const now = Date.parse("2026-10-21T12:00:00Z");
  assertEquals(cardReasons(cards[0], now), ["No owner"], "#4270 (D1): a tagged card with no owner shows No owner");
  assertEquals(cardReasons(cards[1], now), ["No owner", "Overdue 3d"]);
  assertEquals(cardReasons(cards[2], now), ["No update for 11d"]);
  const page = code("pages/WorkBoardPage.jsx");
  assertMatch(page, /title="Work"/);
  // #4255 W2 (rev2): the header is one line (title, tabs, search, filters, New card); no description line.
  assertMatch(page, /<PageHeader title="Work" inline=\{<WorkHeader/);
  // One tab at a time: the board, or the shared period layout (D9: Needs
  // attention is a Show choice and Activity sits at the foot of Today).
  assertMatch(page, /\{onBoard \? \(/);
  assertMatch(page, /<PeriodView win=\{win\} read=\{period\} cards=\{periodCards\}/);
  assertEquals((page.match(/<NeedsAttention |<AgentActivity /g) || []).length, 0);
  assertEquals((page.match(/<WorkBoard\b/g) || []).length, 1);
  const columns = code("components/ops/WorkBoard.jsx");
  // #4255 W2: columns are statuses at 280px each; headers stay put and each column's cards scroll on
  // their own; with more columns than fit the board scrolls sideways; phones get tabs.
  assertMatch(columns, /data-column-scroll="" className="min-h-0 flex-1 overflow-y-auto/);
  assertMatch(columns, /data-work-board="columns"[^>]*className=\{`flex min-w-0 gap-2\.5 overflow-x-auto/);
  assertMatch(columns, /role="tablist" aria-label="Column"/);
  assertNotMatch(columns, /gridAutoFlow/);
  assertMatch(columns, /Nothing here\./);
  // #4255 W2: the card face is compact (title, tags, owners, due, subtasks, thread, files, agent); "from the timeline" left it.
  assertMatch(code("components/ops/WorkCardDrawer.jsx"), /<Drawer open onClose=\{onClose\}/);
});

Deno.test("#3980 W3 R7: Needs attention counts exactly what it lists, and fixes in one click", () => {
  const data = { groups: { noowner: [{ id: "a" }, { id: "b" }], overdue: [{ id: "c" }], missing: [], stuck: [], nonext: [{ id: "d" }], engineering: [] } };
  assertEquals(attentionCounts(data), { noowner: 2, overdue: 1, missing: 0, stuck: 0, nonext: 1, engineering: 0 });
  assertEquals(attentionCounts(null), { noowner: 0, overdue: 0, missing: 0, stuck: 0, nonext: 0, engineering: 0 });
  assertEquals(attentionPrompt("No owner"), "Fix every item under Needs attention in Mingla Work: No owner. Ask me before assigning owners.");
  // #4255 (D9): the Needs attention tab is a Show choice on Work now, and its
  // panel is gone; "Assign to me" stays on the card itself.
  assertMatch(code("lib/workViews.js"), /\{ value: "attention", label: "Needs attention" \}/);
  assertMatch(code("components/ops/WorkDetail.jsx"), />Assign to me</);
});

Deno.test("#3980 W3 R1: the host board's next-event filters and reason badges", () => {
  const soon = { needs_next: false, next: { state: { k: "notlive", by: "2026-10-30" } } };
  const later = { needs_next: false, next: { state: { k: "notlive", by: "2026-12-30" } } };
  const none = { needs_next: true, next: null };
  assert(hostPassesFilter(none, "nonext"));
  assert(!hostPassesFilter(soon, "nonext"));
  assert(hostPassesFilter(soon, "soon", "2026-10-21"));
  assert(!hostPassesFilter(later, "soon", "2026-10-21"));
  assert(hostPassesFilter(undefined, ""));
  assertEquals(hostMissing({ icp: "", region_id: null, contact: "", identifiers: [] }), ["type", "region", "contact"]);
  assertEquals(hostMissing({ icp: "event_organizer", region_id: "r", contact: "", identifiers: [{ kind: "email" }] }), []);
  assertEquals(hostReasons({ owners: [], stage: "contacted" }, ["region"]), ["No owner", "Missing region"]);
  // The filters live in the address. #4255: they are Due choices now; an old
  // filter= link still opens them.
  assertEquals(parseCrmSearch("filter=nonext").due, "nonext");
  assertEquals(parseCrmSearch("filter=other").due, "");
  assertEquals(buildCrmSearch({ due: "soon" }), "due=soon");
  assertEquals(buildCrmSearch({ card: "11111111-1111-4111-8111-111111111111", fill: true }), "card=11111111-1111-4111-8111-111111111111&fill=1");
  const page = code("pages/PipelinePage.jsx");
  assertMatch(page, /hostPassesFilter\(hostNext\.byId\[r\.id\], hostDue\)/);
  assertMatch(page, /<HostNextContext\.Provider value=\{isHostBoard \? hostNext\.byId : null\}>/);
  assertMatch(code("components/crm/RecordCard.jsx"), /<NextEventLine record=\{record\} \/>/);
});

Deno.test("#3980 W3 R6: the Calendar opens on the month with today marked, dots when narrow, and no Plan button", () => {
  const page = code("pages/ContentCalendarPage.jsx");
  assertMatch(page, /"@container min-w-0 overflow-hidden rounded-xl/);
  assertMatch(page, /Today is \{dayLong\(today\)\}/);
  assertMatch(page, /bg-\[var\(--color-brand-50\)\] shadow-\[inset_0_0_0_2px_var\(--color-brand-500\)\]/);
  assertMatch(page, /· Today/);
  assertMatch(page, /past \? "opacity-60" : ""/);
  assertMatch(page, /<StateDot key=\{e\.id\} k=\{e\.state\?\.k\} size=\{10\} \/>/);
  assertMatch(page, /min-h-16/);
  assertMatch(page, /\{undated === 1 \? "post" : "posts"\} with no date/);
  assertMatch(page, /\{ value: "calendar", label: "Month" \}/);
  assertMatch(page, /\{ value: "board", label: "Board" \}/);
  assertNotMatch(page, /Plan this launch|SectionCard title="Unscheduled"/);
  assertNotMatch(code("components/ops/EventPanel.jsx"), /Plan this launch|<LaunchPlanner/);
});

Deno.test("#3980 W3: the new screens use tokens only", () => {
  for (const file of [
    "components/people/PeopleField.jsx", "components/people/MentionBox.jsx", "components/ops/WorkBoard.jsx", "components/ui/PanelStack.jsx",
    "components/ops/AgentActivity.jsx", "components/ops/JustHappened.jsx", "components/ops/StateDot.jsx", "components/ops/EventSteps.jsx",
    "components/ops/WordingQueue.jsx", "components/crm/NextEventLine.jsx", "pages/WorkBoardPage.jsx", "pages/ContentCalendarPage.jsx",
  ]) {
    const source = code(file);
    assertNotMatch(source, /bg-white|text-black/, file);
    assertNotMatch(source, /["'\s(]#[0-9a-fA-F]{6}\b/, file);
  }
});
