// Issue #3980 last fix — Mingla Admin, implementor happy path.
//
// 1. To review, Messages: the empty copy under the "Draft needed" list follows
//    the cards the list actually shows (one load, shared with the list through
//    DraftNeededContext), never the menu count from ops_my_counts. Cards
//    listed + no drafts -> "No drafts written yet." / "...for the cards above."
//    No cards -> "Nothing waiting.", whatever the count says (slow, failed or
//    stale).
// 2. Signing out forgets the Calendar's remembered runway rows
//    (Constitution rule 6, logout clears everything).
//
// The copy lines and the runway hook are RUN from the shipped source, with a
// count that deliberately disagrees with the list.
//
// FAILS ON REVERT: put back `reviewCount.draftNeeded > 0` in DraftsPage, delete
// the `onSignOut(() => RUNWAY_CACHE.clear())` line in useOpsCalendar.js, or
// delete `runSignOutCleanup()` from AuthContext's clearAll.
import { assert, assertEquals, assertMatch, assertNotMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { onSignOut, runSignOutCleanup } from "../lib/signOutCleanup.js";

const SRC = new URL("../", import.meta.url);
const read = (relative: string) => Deno.readTextFileSync(new URL(relative, SRC));
const code = (relative: string) => read(relative).replace(/^\s*\/\/.*$/gm, "");

function cut(text: string, start: string): string {
  const at = text.indexOf(start);
  if (at < 0) throw new Error(`missing: ${start}`);
  const end = text.indexOf("\n}\n", at);
  return text.slice(at, end + 2).replace(/^export /, "");
}

// --- 1. The Messages empty copy -------------------------------------------

const page = code("pages/DraftsPage.jsx");
const list = code("components/ops/DraftNeededList.jsx");
const cardsSource = cut(list, "export function draftNeededCards(");
// The page's copy block: from the first draftNeeded* line to the end of the
// emptyCopy line.
const copyStart = page.search(/\n\s*const draftNeeded(Listed|Shown) = /);
const copyEnd = page.indexOf("\n", page.indexOf("const emptyCopy = "));
const copySource = page.slice(copyStart, copyEnd);

type Review = { data: { draft_needed?: unknown[] } | null; error: unknown };
function emptyCopyFor(review: Review, countSaysDraftNeeded: number, state = "waiting", filtered = false) {
  const run = new Function(
    "review", "query", "filtered", "reviewCount", "useDraftNeededReview",
    `${cardsSource}\n${copySource}\nreturn { emptyTitle, emptyCopy };`,
  );
  return run(
    { tab: "messages" }, { state }, filtered,
    { draftNeeded: countSaysDraftNeeded, total: countSaysDraftNeeded },
    () => review,
  ) as { emptyTitle: string; emptyCopy: string };
}

const card = { id: "39800000-0000-4000-8000-00000000c001", number: 41, title: "Send the venue follow-up" };

Deno.test("#3980 last: cards listed and no drafts -> No drafts written yet, even when the count says 0 (slow or failed count)", () => {
  const out = emptyCopyFor({ data: { draft_needed: [card] }, error: null }, 0);
  assertEquals(out.emptyTitle, "No drafts written yet.");
  assertEquals(out.emptyCopy, "Ask your agent to write a draft for the cards above.");
});

Deno.test("#3980 last: no cards listed -> Nothing waiting, even when a stale count says 1", () => {
  const out = emptyCopyFor({ data: { draft_needed: [] }, error: null }, 1);
  assertEquals(out.emptyTitle, "Nothing waiting.");
  assertEquals(out.emptyCopy, "Ask your agent to write a draft.");
});

Deno.test("#3980 last: both empty -> Nothing waiting; never 'cards above' with no cards above", () => {
  for (const [review, count] of [
    [{ data: { draft_needed: [] }, error: null }, 0],
    [{ data: null, error: null }, 3], // list still loading
    [{ data: null, error: { status: 500 } }, 2], // list failed
  ] as Array<[Review, number]>) {
    const out = emptyCopyFor(review, count);
    assertEquals(out.emptyTitle, "Nothing waiting.");
    assertNotMatch(out.emptyCopy, /cards above/);
  }
});

Deno.test("#3980 last: other states keep their own copy", () => {
  assertEquals(emptyCopyFor({ data: { draft_needed: [card] }, error: null }, 1, "sent").emptyTitle, "No sent drafts yet.");
  assertEquals(emptyCopyFor({ data: { draft_needed: [card] }, error: null }, 1, "waiting", true).emptyTitle, "No waiting drafts for this card.");
});

Deno.test("#3980 last: the page loads the Draft needed list once and hands the same answer to the list", () => {
  assertNotMatch(copySource, /reviewCount\.draftNeeded/);
  assertMatch(page, /const draftNeeded = useDraftNeededReview\(\{ enabled: draftNeededListed \}\);/);
  assertMatch(page, /<DraftNeededContext\.Provider value=\{draftNeeded\}>/);
  const component = cut(list, "export function DraftNeededList(");
  assertMatch(component, /const review = useContext\(DraftNeededContext\);/);
  assertNotMatch(component, /listReview|useOpsPoll/);
  assertMatch(component, /const cards = draftNeededCards\(review\);/);
});

// --- 2. Sign-out forgets the remembered runway rows ------------------------

function buildCalendar() {
  const source = read("hooks/useOpsCalendar.js")
    .replace(/^import .*$/gm, "")
    .replace(/^export /gm, "");
  const factory = new Function(
    "useAuth", "ops", "todayIso", "useOpsPoll", "onSignOut",
    `${source}\nreturn { RUNWAY_CACHE, useOpsRunway };`,
  );
  return factory(
    () => ({ access: { email: "ana@test.local" } }),
    { fetchRunwayReport: () => Promise.resolve({ rows: [] }) },
    () => "2026-10-19",
    // Stands in for useOpsPoll: a loaded answer lands in the cache it is given.
    (_load: unknown, opts: { key: string; cache?: Map<string, unknown> }) => {
      opts.cache?.set(opts.key, { rows: [{ title: "Ana's supper club" }] });
      return { data: opts.cache?.get(opts.key) ?? null };
    },
    onSignOut,
  ) as { RUNWAY_CACHE: Map<string, unknown>; useOpsRunway: () => unknown };
}

Deno.test("#3980 last: signing out clears the remembered runway rows", () => {
  const { RUNWAY_CACHE, useOpsRunway } = buildCalendar();
  useOpsRunway();
  assert(RUNWAY_CACHE.has("ana@test.local|runway"), "the runway answer is remembered while signed in");
  runSignOutCleanup();
  assertEquals(RUNWAY_CACHE.size, 0, "after sign-out nothing of the last person's runway is left");
});

Deno.test("#3980 last: every way out of a session runs the sign-out cleanup", () => {
  const auth = code("context/AuthContext.jsx");
  assertMatch(auth, /import \{ runSignOutCleanup \} from "\.\.\/lib\/signOutCleanup";/);
  const clearAll = auth.slice(auth.indexOf("const clearAll = useCallback("), auth.indexOf("}, []);", auth.indexOf("const clearAll = useCallback(")));
  assertMatch(clearAll, /runSignOutCleanup\(\);/);
  // signOut, a rejected session and a session that ended all go through clearAll.
  assertMatch(auth.slice(auth.indexOf("const signOut = async () => {")), /clearAll\(\);/);
  assertMatch(auth.slice(auth.indexOf("const rejectSession = useCallback("), auth.indexOf("const resolveSession")), /clearAll\(\);/);
  assertMatch(auth.slice(auth.indexOf("const resolveSession = useCallback("), auth.indexOf("const twoFA")), /clearAll\(\);/);
});
