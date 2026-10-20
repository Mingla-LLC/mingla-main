// Issue #3980 rework 2 — Mingla Admin side, after the tester's retest:
// mentions are unique per teammate and a pick leaves the note the moment its
// text does; Title and Done means grow with their text; Calendar chip titles
// wrap by whole words, two lines then an ellipsis; To review counts exactly
// what its tabs list ("Draft needed" cards on Messages); Back to runway
// returns focus to what opened the panel.
import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { keepPicksInText, mentionTokenFor, mentionedEmails } from "../lib/opsModel.js";
import { AUTO_GROW_CLASS, fitHeight } from "../lib/autoGrow.js";

const SRC = new URL("../", import.meta.url);
const read = (relative: string) => Deno.readTextFileSync(new URL(relative, SRC));
const code = (relative: string) => read(relative).replace(/^\s*\/\/.*$/gm, "");

const ALEX_KIM = { name: "Alex", email: "alex.kim@usemingla.com" };
const ALEX_LEE = { name: "Alex", email: "alex.lee@usemingla.com" };
const GIA = { name: "Gia", email: "gia@usemingla.com" };
const TEAM = [ALEX_KIM, ALEX_LEE, GIA];

// The note box's own steps: a pick stores the teammate's unique mention text;
// every edit keeps only picks whose text is still in the note.
type Pick = { email: string; name: string; token: string };
function noteBox(team: typeof TEAM) {
  let body = "";
  let picks: Pick[] = [];
  return {
    type(next: string) { body = next; picks = keepPicksInText(picks, body) as Pick[]; },
    pick(person: { name: string; email: string }) {
      const token = mentionTokenFor(person, team);
      body = body.replace(/@([\w.-]*)$/, `${token} `);
      picks = [...picks, { email: person.email, name: person.name, token }];
    },
    get body() { return body; },
    told() { return mentionedEmails(picks, body.trim()); },
  };
}

Deno.test("#3980 rework 2: each teammate gets mention text nobody else has", () => {
  assertEquals(mentionTokenFor(GIA, TEAM), "@Gia");
  assertEquals(mentionTokenFor(ALEX_KIM, TEAM), "@Alex Kim");
  assertEquals(mentionTokenFor(ALEX_LEE, TEAM), "@Alex Lee");
  // Full names collide too: the address's local part.
  const a = { name: "Alex", email: "alex.kim@usemingla.com" };
  const b = { name: "Alex", email: "alex_kim@partner.test" };
  assertEquals(mentionTokenFor(a, [a, b]), "@alex.kim");
  assertEquals(mentionTokenFor(b, [a, b]), "@alex_kim");
  // Even the local part collides: the whole address.
  const c = { name: "Alex", email: "alex@usemingla.com" };
  const d = { name: "Alex", email: "alex@partner.test" };
  assertEquals(mentionTokenFor(c, [c, d]), "@alex@usemingla.com");
  assertEquals(mentionTokenFor(d, [c, d]), "@alex@partner.test");
  // The person themselves in the team list does not count as a clash.
  assertEquals(mentionTokenFor(GIA, [GIA]), "@Gia");
});

Deno.test("#3980 rework 2: two people with one name, deleting the first never tells the first", () => {
  const box = noteBox(TEAM);
  box.type("@Al");
  box.pick(ALEX_KIM);
  box.type(`${box.body}and @Al`);
  box.pick(ALEX_LEE);
  assertEquals(box.body, "@Alex Kim and @Alex Lee ");
  assertEquals(box.told(), ["alex.kim@usemingla.com", "alex.lee@usemingla.com"]);
  // Delete the first mention.
  box.type("and @Alex Lee ");
  assertEquals(box.told(), ["alex.lee@usemingla.com"]);
  // Type the first name back by hand: still nobody new is told.
  box.type("@Alex Kim and @Alex Lee ");
  assertEquals(box.told(), ["alex.lee@usemingla.com"]);
});

Deno.test("#3980 rework 2: a pick deleted and typed back by hand tells nobody", () => {
  const box = noteBox(TEAM);
  box.type("Thanks @G");
  box.pick(GIA);
  assertEquals(box.told(), ["gia@usemingla.com"]);
  box.type("Thanks @Gi");
  assertEquals(box.told(), []);
  box.type("Thanks @Gia ");
  assertEquals(box.told(), []);
});

Deno.test("#3980 rework 2: picks that still share one text tell nobody when one copy is gone", () => {
  // Old picks without their own text fall back to "@Name"; with two people
  // behind "@Alex" and one copy left, Mingla cannot know who stayed.
  assertEquals(mentionedEmails([ALEX_KIM, ALEX_LEE], "@Alex, please"), []);
  assertEquals(mentionedEmails([ALEX_KIM, ALEX_LEE], "@Alex and @Alex"), ["alex.kim@usemingla.com", "alex.lee@usemingla.com"]);
  assertEquals(keepPicksInText([{ ...GIA, token: "@Gia" }], "@Gia."), [{ ...GIA, token: "@Gia" }]);
  assertEquals(keepPicksInText([{ ...GIA, token: "@Gia" }], "@Giant"), []);
});

Deno.test("#3980 rework 2: the note box drops picks on every edit and stores unique text", () => {
  const box = code("components/ops/NoteBox.jsx");
  assertMatch(box, /const token = mentionTokenFor\(p, team\);/);
  assertMatch(box, /setPicks\(\(list\) => \[\.\.\.list, \{ email: p\.email, name: p\.name, token \}\]\)/);
  assertMatch(box, /setPicks\(\(list\) => keepPicksInText\(list, next\)\)/);
  assertMatch(box, /onChange=\{\(e\) => edit\(e\.target\.value\)\}/);
  assertNotMatch(box, /onChange=\{\(e\) => setBody\(/);
  assertMatch(box, /mentionedEmails\(picks, text\)/);
});

Deno.test("#3980 rework 2: Title and Done means grow with their text", () => {
  assertMatch(AUTO_GROW_CLASS, /\[field-sizing:content\]/);
  assertMatch(AUTO_GROW_CLASS, /overflow-hidden/);
  const node = { style: { height: "" }, scrollHeight: 120, offsetHeight: 42, clientHeight: 40 };
  fitHeight(node);
  assertEquals(node.style.height, "122px");
  fitHeight(null);
  const detail = code("components/ops/WorkDetail.jsx");
  assertMatch(detail, /<textarea\s+ref=\{titleRef\}\s+value=\{title\}/);
  assertNotMatch(detail, /<input\s+ref=\{headingRef\}/);
  assertMatch(detail, /const titleGrow = useAutoGrow\(title\);/);
  assertMatch(detail, /if \(e\.key === "Enter"\) \{ e\.preventDefault\(\);/);
  assertMatch(detail, /setTitle\(e\.target\.value\.replace\(\/\[\\r\\n\]\+\/g, " "\)\)/);
  assertMatch(detail, /<textarea value=\{doneMeans\} ref=\{doneMeansGrow\}/);
  assertMatch(detail, /\$\{DONE_MEANS_CLASS\} \$\{AUTO_GROW_CLASS\}/);
  const add = code("components/ops/WorkAddForm.jsx");
  assertMatch(add, /const doneMeansGrow = useAutoGrow\(doneMeans\);/);
  assertMatch(add, /<textarea value=\{doneMeans\} ref=\{doneMeansGrow\}[^\n]*\$\{AUTO_GROW_CLASS\}/);
  assertMatch(code("components/ops/useAutoGrow.js"), /new ResizeObserver/);
});

Deno.test("#3980 rework 2: Calendar chip titles wrap by whole words, two lines, then an ellipsis", () => {
  const page = code("pages/ContentCalendarPage.jsx");
  assertNotMatch(page, /hyphens-auto|overflow-wrap:anywhere|break-all|break-words hyphens/);
  // [TEST-MOD-APPROVED #3980] synced Wave 3 (R6): month items are a dot and a title (MonthGrid); words keep whole.
  assertMatch(page, /const WORDS = "break-normal \[overflow-wrap:normal\] hyphens-none";/);
  assertNotMatch(page, /break-words/);
  const chip = page.slice(page.indexOf("function ChipWords"), page.indexOf("function useCoarsePointer"));
  assertMatch(chip, /line-clamp-2/);
  assertMatch(chip, /split\(\/\\s\+\/\)/);
  assertMatch(chip, /inline-block max-w-full truncate/);
  // [TEST-MOD-APPROVED #3980] synced Wave 3 (R6): posts and events in the month both draw ChipWords, full title on hover.
  assertMatch(page, /title=\{e\.title\}[^>]*>\s*<ChipWords text=\{e\.title\} \/>/);
  assertMatch(page, /title=\{`\$\{e\.title\} · \$\{stateName\(e\.state\)\}`\}/);
  assertMatch(page, /<ChipWords text=\{e\.title\} \/>\s*<\/button>/);
});

Deno.test("#3980 rework 2: To review counts exactly what its tabs list", () => {
  const hook = code("hooks/useReviewCount.js");
  assertMatch(hook, /const draftNeeded = Number\(counts\.data\?\.draft_needed_mine \|\| 0\);/);
  assertMatch(hook, /total: waiting \+ needsPerson \+ draftNeeded/);
  const page = code("pages/DraftsPage.jsx");
  assertMatch(page, /\{query\.state === "waiting" && !filtered && <DraftNeededList \/>\}/);
  const list = code("components/ops/DraftNeededList.jsx");
  assertMatch(list, /review\.data\?\.draft_needed/);
  assertMatch(list, /Draft needed: \{c\.title\}/);
  assertMatch(list, /ops\.listReview\(/);
  assertMatch(list, /window\.addEventListener\(REVIEW_CHANGED, refresh\)/);
});

Deno.test("#3980 rework 2: Back to runway returns focus to what opened the panel", () => {
  const page = code("pages/ContentCalendarPage.jsx");
  const openDay = page.slice(page.indexOf("const openDay = (key) => {"), page.indexOf("const clearDay"));
  assertMatch(openDay, /rememberOpener\(\);/);
  const selectEvent = page.slice(page.indexOf("const selectEvent = (selection, onDate) => {"), page.indexOf("const clearEvent"));
  assertMatch(selectEvent, /rememberOpener\(\);/);
  assertMatch(page, /const clearEvent = \(\) => backToRunway\("event"\);/);
  assertMatch(page, /const clearDay = \(\) => backToRunway\("day"\);/);
  assertMatch(page, /"data-calendar-chip", "data-calendar-more", "data-calendar-day-dense", "data-calendar-date", "data-runway-row"/);
  assertMatch(page, /target\?\.focus\?\.\(\);/);
  assertMatch(page, /if \(!target \|\| document\.activeElement !== target\) eventHeadingRef\.current\?\.focus\?\.\(\);/);
  // [TEST-MOD-APPROVED #3980] synced Wave 3 (R6): one chip id per event or promised date in the month.
  assertMatch(page, /data-calendar-chip=\{e\.id\}/);
  assertMatch(page, /data-calendar-more=\{key\}/);
  const panel = code("components/ops/EventPanel.jsx");
  assertMatch(panel, /const RunwayList = forwardRef\(function RunwayList\(\{ onSelect \}, headingRef\)/);
  assertMatch(panel, /<RunwayList ref=\{headingRef\} onSelect=\{onSelect\} \/>/);
  assertMatch(panel, /<span ref=\{headingRef\} tabIndex=\{-1\}/);
  assertMatch(panel, /data-runway-row=/);
});
