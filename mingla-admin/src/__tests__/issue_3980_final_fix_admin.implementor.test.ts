// Issue #3980 final fix — Mingla Admin side: the add-card Title grows with its
// text like the card's own Title and never clips it; Back to runway from a
// runway row finds that row at once because the runway list keeps its last
// answer across remounts; the Messages tab never says "Nothing waiting." under
// a non-empty "Draft needed" list.
import { assertMatch, assertNotMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = new URL("../", import.meta.url);
const code = (relative: string) =>
  Deno.readTextFileSync(new URL(relative, SRC)).replace(/^\s*\/\/.*$/gm, "");

Deno.test("#3980 final: the add-card Title grows with its text and never clips", () => {
  const add = code("components/ops/WorkAddForm.jsx");
  assertMatch(add, /const titleGrow = useAutoGrow\(title\);/);
  assertNotMatch(add, /<input value=\{title\}/);
  const box = add.slice(add.indexOf("<textarea\n          value={title}"), add.indexOf("<span className={LABEL}>Instructions</span>"));
  assertMatch(box, /ref=\{titleGrow\}/);
  assertMatch(box, /rows=\{1\}/);
  assertMatch(box, /maxLength=\{160\}/);
  assertMatch(box, /\$\{AUTO_GROW_CLASS\}/);
  assertMatch(box, /whitespace-pre-wrap break-words/);
  // A title stays one paragraph; Enter still adds the card, as before.
  assertMatch(box, /setTitle\(e\.target\.value\.replace\(\/\[\\r\\n\]\+\/g, " "\)\)/);
  assertMatch(box, /if \(e\.key === "Enter"\) \{ e\.preventDefault\(\); if \(online && !busy\) e\.currentTarget\.form\?\.requestSubmit\?\.\(\); \}/);
});

Deno.test("#3980 final: the runway list keeps its rows across remounts so Back to runway can focus the row", () => {
  const poll = code("hooks/useOpsWork.js");
  assertMatch(poll, /export function useOpsPoll\(load, \{ key = "", intervalMs = 30_000, enabled = true, cache = null \} = \{\}\)/);
  assertMatch(poll, /useState\(\(\) => \(cache\?\.has\(key\)\s*\? \{ key, data: cache\.get\(key\), error: null, loaded: true \}/);
  assertMatch(poll, /if \(mine === seq\.current\) \{ setState\(\{ key, data, error: null, loaded: true \}\); cache\?\.set\(key, data\); \}/);
  const cal = code("hooks/useOpsCalendar.js");
  assertMatch(cal, /const RUNWAY_CACHE = new Map\(\);/);
  const runway = cal.slice(cal.indexOf("export function useOpsRunway"), cal.indexOf("export function useOpsAnchor"));
  assertMatch(runway, /cache: RUNWAY_CACHE/);
  // The cache is per signed-in person.
  assertMatch(runway, /key: `\$\{access\?\.email \|\| ""\}\|runway`/);
  // The page still focuses the opener's row by its runway id after Back.
  const page = code("pages/ContentCalendarPage.jsx");
  assertMatch(page, /"data-runway-row"\]\.find/);
  assertMatch(page, /opener\?\.selector \? document\.querySelector\(opener\.selector\) : null/);
});

Deno.test("#3980 final: Messages never says Nothing waiting under a Draft needed list", () => {
  const page = code("pages/DraftsPage.jsx");
  assertMatch(page, /const draftNeededShown = query\.state === "waiting" && !filtered && reviewCount\.draftNeeded > 0;/);
  assertMatch(page, /: draftNeededShown \? "No drafts written yet\." : query\.state === "waiting" \? "Nothing waiting\."/);
});
