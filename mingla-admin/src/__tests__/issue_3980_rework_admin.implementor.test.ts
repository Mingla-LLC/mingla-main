// Issue #3980 rework after the tester's FAIL — Mingla Admin side:
// mentions resolve by the email each pick carries (never by display name),
// the Calendar's month grid beside the event panel always shows Mon to Sun
// without sideways scroll, My agent says what close_work really requires and
// that people taken off a card are told, To review counts the same as the
// menu, the event panel's status chips never wrap, Done means shows its
// whole text, and the agent log never prints an internal field name.
import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mentionToken, mentionedEmails } from "../lib/opsModel.js";
import { AGENT_WORK_ABILITIES, AGENT_WORK_GUARDRAILS } from "../lib/agentConnect.js";

const SRC = new URL("../", import.meta.url);
const ROOT = new URL("../../../", import.meta.url);
const read = (relative: string) => Deno.readTextFileSync(new URL(relative, SRC));
const code = (relative: string) => read(relative).replace(/^\s*\/\/.*$/gm, "");
const repo = (relative: string) => Deno.readTextFileSync(new URL(relative, ROOT));

const ALEX_KIM = { name: "Alex", email: "alex.kim@usemingla.com" };
const ALEX_LEE = { name: "Alex", email: "alex.lee@usemingla.com" };
const AL = { name: "Al", email: "al@usemingla.com" };
const GIA = { name: "Gia Z", email: "gia@usemingla.com" };

Deno.test("#3980 rework: a mention is the email its pick carries", () => {
  assertEquals(mentionToken(GIA), "@Gia Z");
  assertEquals(mentionedEmails([GIA], "Thanks @Gia Z, can you check?"), ["gia@usemingla.com"]);
  assertEquals(mentionedEmails([GIA], "Thanks @Gia Z, can you check?\n"), ["gia@usemingla.com"]);
  assertEquals(mentionedEmails([{ name: "Gia Z", email: " GIA@usemingla.com " }], "@Gia Z."), ["gia@usemingla.com"]);
});

Deno.test("#3980 rework: a name typed by hand, or a pick taken back out, tells nobody", () => {
  assertEquals(mentionedEmails([], "@Gia Z please look"), []);
  assertEquals(mentionedEmails([GIA], "please look"), []);
  assertEquals(mentionedEmails(null, "@Gia Z"), []);
});

Deno.test("#3980 rework: two teammates with the same first name are never confused", () => {
  // Only Alex Lee was picked: only Alex Lee is told, even though Alex Kim
  // has the same name on screen.
  assertEquals(mentionedEmails([ALEX_LEE], "@Alex can you take this?"), ["alex.lee@usemingla.com"]);
  // Both picked, both still in the text: both told.
  assertEquals(mentionedEmails([ALEX_KIM, ALEX_LEE], "@Alex and @Alex, please"), ["alex.kim@usemingla.com", "alex.lee@usemingla.com"]);
  // Both picked under one text, one taken back out: nobody behind that text
  // is told, since Mingla cannot know which one stayed (rework 2: the note
  // box gives each teammate unique text, so this only guards old picks).
  assertEquals(mentionedEmails([ALEX_KIM, ALEX_LEE], "@Alex, please"), []);
  // The same person picked twice is told once.
  assertEquals(mentionedEmails([ALEX_KIM, ALEX_KIM], "@Alex @Alex"), ["alex.kim@usemingla.com"]);
});

Deno.test("#3980 rework: a name that starts another name never matches it", () => {
  assertEquals(mentionedEmails([AL], "@Alex will do it"), []);
  assertEquals(mentionedEmails([ALEX_KIM], "@Al will do it"), []);
  assertEquals(mentionedEmails([AL, ALEX_KIM], "@Alex will do it"), ["alex.kim@usemingla.com"]);
  assertEquals(mentionedEmails([AL, ALEX_KIM], "@Al will do it"), ["al@usemingla.com"]);
  assertEquals(mentionedEmails([AL], "@Al.b"), []);
  assertEquals(mentionedEmails([AL], "mail@Al"), []);
});

Deno.test("#3980 rework: the note box sends the picks, not the team, and shows each pick's email", () => {
  const box = code("components/ops/NoteBox.jsx");
  assertMatch(box, /mentionedEmails\(picks, text\)/);
  assertNotMatch(box, /mentionedEmails\(team/);
  assertMatch(box, /setPicks\(\(list\) => \[\.\.\.list, \{ email: p\.email, name: p\.name, token \}\]\)/);
  // [TEST-MOD-APPROVED #3980] synced Wave 3 (R9): the @ list is MentionBox; each row names the teammate's address.
  assertMatch(code("components/people/MentionBox.jsx"), /aria-label=\{`Mention \$\{shownName\(p, team\)\}, \$\{p\.email\}`\}/);
  assertMatch(box, /setPicks\(\[\]\)/);
  const model = code("lib/opsModel.js");
  assertNotMatch(model, /new RegExp\(`\(\^\|\\\\s\)@\$\{p\.name/);
});

Deno.test("#3980 rework: My agent says what closing a card really needs", () => {
  const close = AGENT_WORK_ABILITIES.find((a) => a.tool === "close_work")!;
  assertNotMatch(close.detail, /Only with proof Mingla can check/);
  assertMatch(close.detail, /at least one line of proof/);
  assertMatch(close.detail, /agent's word/);
  assertMatch(close.detail, /taken? off the card|took off the card/);
  assert(AGENT_WORK_GUARDRAILS.some((line) => /agent's word/.test(line)));
  assert(AGENT_WORK_GUARDRAILS.some((line) => /takes someone off a card, they are told who did it and which agent/.test(line)));
  assertNotMatch(read("lib/agentConnect.js"), /Only with proof Mingla can check/);
});

Deno.test("#3980 rework: the month grid beside the event panel never scrolls sideways", () => {
  // [TEST-MOD-APPROVED #3980] synced Wave 3 (R6): the month is MonthGrid inside an @container box; seven
  // columns that may shrink, at most two items a day then "+N more" (the day
  // opens in the right column), one 10px dot per event under 760px.
  const page = code("pages/ContentCalendarPage.jsx");
  const start = page.indexOf('data-calendar-grid="month"');
  assert(start > 0, "the month grid exists");
  const grid = page.slice(start, page.indexOf("function Legend", start));
  assertMatch(grid, /grid-cols-\[repeat\(7,minmax\(0,1fr\)\)\]/);
  assertNotMatch(grid, /min-w-\[700px\]|overflow-x-auto/);
  assertNotMatch(grid, /<ContentCard /);
  assertMatch(page, /const DAY_LIMIT = 2;/);
  assertMatch(grid, /onClick=\{\(\) => onDay\(key\)\}/);
  assertMatch(grid, /more<\/button>/);
  assertMatch(page, /<DayPanel /);
  assertMatch(page, /p\.set\("day", key\)/);
  assertNotMatch(page, /overflow-wrap:anywhere|break-all|hyphens-auto/);
  assertMatch(page, /"@container min-w-0 overflow-hidden rounded-xl/);
  // [TEST-MOD-APPROVED #3980] synced Wave 3 rework (P3): titles show from a 640px box, so at 1440 with an event
  // open (a 688px box) the month still shows titles; under 640px each event is a 10px dot.
  assertMatch(grid, /hidden min-w-0 flex-col gap-0\.5 @min-\[640px\]:flex/);
  assertMatch(grid, /data-calendar-day-dense=\{key\}/);
  assertMatch(grid, /@min-\[640px\]:hidden/);
  assertNotMatch(page, /\$\{[A-Z_]+\}:(?:block|hidden|min-h)/);
});

Deno.test("#3980 rework: status chips in the event panel never wrap", () => {
  const panel = code("components/ops/EventPanel.jsx");
  // [TEST-MOD-APPROVED #3980] synced Wave 3 (R6): the panel's state pill never wraps (StatePill is whitespace-nowrap).
  assertMatch(panel, /<StatePill state=\{data\.state\} \/>/);
  assertMatch(code("components/ops/StateDot.jsx"), /inline-flex min-h-6 items-center gap-1\.5 whitespace-nowrap rounded-full/);
  assertMatch(panel, /tone=\{c\.status === "done" \? "success" : c\.blocked \? "error" : "brand"\} className="shrink-0 whitespace-nowrap"/);
});

Deno.test("#3980 rework: Done means shows its whole text", () => {
  for (const file of ["components/ops/WorkDetail.jsx", "components/ops/WorkAddForm.jsx"]) {
    const source = code(file);
    assertMatch(source, /<textarea value=\{doneMeans\}/, file);
    assertNotMatch(source, /<input value=\{doneMeans\}/, file);
  }
});

Deno.test("#3980 rework: the To review header counts what the menu badge counts", () => {
  const page = code("pages/DraftsPage.jsx");
  assertMatch(page, /const reviewCount = useReviewCount\(\);/);
  assertMatch(page, /const totalWaiting = reviewCount\.total;/);
  assertMatch(page, /announceReviewChange\(\)/);
  const hook = code("hooks/useReviewCount.js");
  assertMatch(hook, /total: waiting \+ needsPerson/);
  assertMatch(hook, /window\.addEventListener\(REVIEW_CHANGED, refresh\)/);
  // #4130: Needs you left the menu; Work carries the count of your own waiting cards.
  assertMatch(code("components/layout/Sidebar.jsx"), /item\.id === "work-board" \? reviewCount\.cards/);
  assertMatch(code("hooks/useReviewCount.js"), /const cards = needsPerson \+ draftNeeded \+ wording;/);
});

Deno.test("#3980 rework: the agent log names fields in plain words", () => {
  const sql = repo("supabase/migrations/20271116003980_issue_3980_wave1_work_board.sql");
  assertMatch(sql, /WHEN 'done_means' THEN 'done means'/);
  assertMatch(sql, /WHEN 'due_on' THEN 'due date'/);
  assertMatch(sql, /string_agg\(DISTINCT public\.ops_field_words\(f->>'field'\), ', '\)/);
  assertNotMatch(sql, /string_agg\(DISTINCT f->>'field'/);
});
