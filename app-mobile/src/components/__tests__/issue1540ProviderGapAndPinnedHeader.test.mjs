#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Implementor happy-path regression suite — issue #1540, SECOND PASS.
 *
 * Covers the two things the first pass did not: the P1 provider crash the tester
 * proved at runtime, and the pinned-header contract folded in from the design
 * pass. The first-pass suite
 * (`issue1540PairedSavesSheetScroll.test.mjs`) and the tester's adversarial
 * overflow-arithmetic suite both still stand; this file is ADDITIVE and modifies
 * neither.
 *
 * ── G: the provider gap (P1-1) ────────────────────────────────────────────
 * `ExpandedCardModal` called the THROWING `useRecommendations()` unconditionally,
 * above every early return. `RecommendationsProvider` / `CardsCacheProvider` are
 * mounted in exactly one route (`app/index.tsx`) plus `CollabDeckSheet` — NOT in
 * `app/_layout.tsx`. But `ViewFriendProfileScreen` (→ `PersonHolidayView` → the
 * liked-cards sheet) also renders under `ConsumerExperienceDetailScreen`,
 * `ConsumerTripDetailScreen` and `ConsumerEventDetailScreen`, i.e. the `/exp/`,
 * `/t/` and `/e/` routes, which have no provider AND no ErrorBoundary. Before
 * #1540 a tap there silently wrote a DB row; after the tap-opens-the-card fix the
 * same tap mounted this modal and THREW. #1540 did not create that gap — it
 * widened it from a silent data bug into a crash.
 *
 * G-1  ExpandedCardModal consumes the NON-throwing accessor, not the throwing one.
 * G-2  Every `updateCardStrollData` call site is optional-chained.
 * G-3  `useRecommendationsOptional` exists, is exported, and cannot throw.
 * G-4  EXECUTABLE: the REAL hook source is evaluated with `useContext` stubbed.
 *      Missing provider → returns null. Present provider → returns the value.
 *      This is the teeth: G-1..G-3 read source, G-4 runs it.
 * G-5  The throwing `useRecommendations` still exists for genuine deck-only
 *      consumers. Making EVERY consumer tolerant would delete a real guard.
 *
 * ── H: the pinned-header contract ─────────────────────────────────────────
 * `BaseBottomSheet`'s `header` prop documents itself as a fixed, non-scrolling,
 * intrinsic-height SIBLING direct child (ORCH-1043). The `scroll`, `sectionlist`
 * and stickyFooter branches all honour that. `flatlist` was the ONE branch that
 * silently routed `header` into `ListHeaderComponent` — list CONTENT — so the
 * header scrolled away. H-* pins the repair.
 *
 * H-1  The flatlist branch renders `{header}` as a sibling BEFORE the list.
 * H-2  The list claims `styles.flexContainer` (flex:1) when a header is present,
 *      so it gets a BOUNDED viewport below that header. LOAD-BEARING.
 * H-3  `header` is no longer routed into `ListHeaderComponent`.
 * H-4  No intermediate `View`/`BottomSheetView` wrapper is introduced — the
 *      scrollable stays a DIRECT child (I-SHEET-SCROLLABLE-DIRECT-CHILD).
 * H-5  Consumer inventory guard: every `scrollMode="flatlist"` consumer that
 *      passes `header` is a KNOWN, reviewed surface. A new one must be
 *      runtime-checked before it inherits the pin, so this test fails loudly
 *      rather than letting a fourth surface change behaviour unnoticed.
 *
 * ── S: the saves sheet's own design-pass wiring ───────────────────────────
 * S-1  variant="sheet" + showsVerticalScrollIndicator: true.
 * S-2  The error state is WIRED (isError/refetch destructured and mounted), so a
 *      failed fetch no longer renders "Nothing here yet" — which was a lie
 *      (Constitution #3 and #9).
 * S-3  Grid tokens: gridContent gains flexGrow (empty/error centring) and
 *      columnWrapper drops the `space-between` that silently overrode `gap`.
 * S-4  The skeleton no longer double-applies paddingHorizontal — that inset
 *      collision forced the loading state into a single column.
 *
 * FAILS-ON-REVERT: proven by TRUE LINE DELETION (not a comment-out) of each fix.
 * Hashes recorded in the implementation report on issue #1540.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../..");

const read = (rel) => fs.readFileSync(path.join(APP, rel), "utf8");

const EXPANDED_CARD_MODAL = read("src/components/ExpandedCardModal.tsx");
const RECS_CONTEXT = read("src/contexts/RecommendationsContext.tsx");
const BASE_SHEET = read("src/components/ui/BaseBottomSheet.tsx");
const PHV = read("src/components/PersonHolidayView.tsx");
const PRESENTATION = read(
  "src/components/pairedSaves/PairedSavesListPresentation.tsx",
);
const LAYOUT = read("app/_layout.tsx");

/**
 * Strip block and line comments so no assertion below can be satisfied by prose
 * in a doc-comment. Every structural test runs against CODE.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const EXPANDED_CODE = stripComments(EXPANDED_CARD_MODAL);
const RECS_CODE = stripComments(RECS_CONTEXT);
const SHEET_CODE = stripComments(BASE_SHEET);
const PHV_CODE = stripComments(PHV);
const PRESENTATION_CODE = stripComments(PRESENTATION);

/** Slice `case 'flatlist': { … }` out of BaseBottomSheet's body switch. */
function flatlistBranch(src) {
  const start = src.indexOf("case 'flatlist':");
  if (start === -1) return null;
  const open = src.indexOf("{", start);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

const FLATLIST = flatlistBranch(SHEET_CODE);

// ── T-0: vacuity guard ─────────────────────────────────────────────────────
// Every later assertion reads one of these. If an extraction silently returned
// nothing, a "not present" assertion would pass while the product was broken —
// the exact unfalsifiable-test failure mode #1540's own SPEC warns about.
test("G-0 vacuity guard: every source under test is non-empty and the flatlist branch extracted", () => {
  for (const [name, src] of [
    ["ExpandedCardModal", EXPANDED_CODE],
    ["RecommendationsContext", RECS_CODE],
    ["BaseBottomSheet", SHEET_CODE],
    ["PersonHolidayView", PHV_CODE],
    ["PairedSavesListPresentation", PRESENTATION_CODE],
    ["app/_layout", LAYOUT],
  ]) {
    assert.ok(src && src.length > 200, `G-0 ${name} source must be non-trivial`);
  }
  assert.ok(
    FLATLIST && FLATLIST.length > 100,
    "G-0 the case 'flatlist' branch must be extractable — every H-* test reads it",
  );
  // The premise of the whole P1 fix: the providers are NOT at the root. If this
  // ever stops being true the fix's rationale changes and someone must re-read it.
  assert.ok(
    !/RecommendationsProvider|CardsCacheProvider/.test(LAYOUT),
    "G-0 app/_layout.tsx must still lack the deck providers — that is WHY ExpandedCardModal must tolerate their absence",
  );
});

// ── G: provider gap ────────────────────────────────────────────────────────

test("G-1 ExpandedCardModal consumes the non-throwing accessor, not the throwing one", () => {
  assert.match(
    EXPANDED_CODE,
    /import\s*\{\s*useRecommendationsOptional\s*\}\s*from\s*["'][^"']*contexts\/RecommendationsContext["']/,
    "G-1 ExpandedCardModal must import useRecommendationsOptional",
  );
  assert.ok(
    !/\buseRecommendations\s*\(/.test(EXPANDED_CODE),
    "G-1 ExpandedCardModal must NOT call the throwing useRecommendations() — that is the crash on /exp/, /t/ and /e/",
  );
  assert.match(
    EXPANDED_CODE,
    /useRecommendationsOptional\s*\(\s*\)/,
    "G-1 the optional accessor must actually be called",
  );
});

test("G-2 every updateCardStrollData call site is optional-chained", () => {
  const calls = EXPANDED_CODE.match(/updateCardStrollData\s*\??\.?\(/g) ?? [];
  assert.ok(
    calls.length > 0,
    "G-2 vacuity: there must BE a call site, else this test proves nothing",
  );
  for (const call of calls) {
    assert.match(
      call,
      /updateCardStrollData\s*\?\.\(/,
      "G-2 an unguarded updateCardStrollData(...) throws off-deck where the value is undefined",
    );
  }
});

test("G-3 useRecommendationsOptional is exported and cannot throw", () => {
  assert.match(
    RECS_CODE,
    /export\s+const\s+useRecommendationsOptional\s*[:=]/,
    "G-3 the optional accessor must be exported",
  );
  const idx = RECS_CODE.indexOf("export const useRecommendationsOptional");
  const body = RECS_CODE.slice(idx, idx + 400);
  assert.ok(
    !/\bthrow\b/.test(body),
    "G-3 the optional accessor must not throw — throwing is what it exists to avoid",
  );
});

test("G-4 EXECUTABLE: the real hook returns null with no provider and the value with one", async () => {
  // Reads the REAL exported hook out of the product source and evaluates that
  // exact text with `useContext` stubbed. Not a reimplementation — if someone
  // edits the hook to throw, or to return `undefined` (which would defeat the
  // `deck?.x` call sites differently), this test flips.
  const m = RECS_CODE.match(
    /export\s+const\s+useRecommendationsOptional[\s\S]*?;\s*$/m,
  );
  assert.ok(
    m,
    "G-4 the hook declaration must be extractable — a skipped executable check proves nothing",
  );

  // The declaration carries a TypeScript return annotation, so it is transpiled
  // with the real compiler (same approach as T-10 in the first-pass suite)
  // rather than hand-stripped. If typescript is missing this test FAILS; it
  // never silently skips.
  const ts = await import("typescript");
  const js = ts.default.transpileModule(m[0].replace(/^export\s+/, ""), {
    compilerOptions: {
      target: ts.default.ScriptTarget.ES2020,
      module: ts.default.ModuleKind.None,
    },
  }).outputText;
  assert.match(
    js,
    /useRecommendationsOptional/,
    "G-4 the transpiled hook must still declare itself",
  );

  let stubbed;
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    "useContext",
    "RecommendationsContext",
    `${js}; return useRecommendationsOptional;`,
  );

  // No provider: React's useContext yields the createContext default, which this
  // context declares as `undefined`.
  stubbed = factory(
    () => undefined,
    Symbol("RecommendationsContext"),
  );
  assert.strictEqual(
    stubbed(),
    null,
    "G-4 with no provider the hook must return null — throwing is the P1-1 crash, undefined is a silent type hole",
  );

  // Provider present: the real context value must pass through untouched.
  const value = { updateCardStrollData: () => {}, collabTravelMode: null };
  stubbed = factory(() => value, Symbol("RecommendationsContext"));
  assert.strictEqual(
    stubbed(),
    value,
    "G-4 with a provider the hook must return the context value unchanged",
  );
});

test("G-5 the throwing useRecommendations survives for deck-only consumers", () => {
  assert.match(
    RECS_CODE,
    /export\s+const\s+useRecommendations\s*[:=][\s\S]{0,400}?throw new Error/,
    "G-5 the throwing hook must remain — a genuinely deck-only consumer mounted without a provider IS a bug and must fail loudly",
  );
  const swipeable = stripComments(read("src/components/SwipeableCards.tsx"));
  assert.match(
    swipeable,
    /\buseRecommendations\s*\(\s*\)/,
    "G-5 SwipeableCards is deck-only and must keep the strict hook",
  );
});

// ── H: pinned-header contract ──────────────────────────────────────────────

test("H-1 the flatlist branch renders header as a sibling BEFORE the list", () => {
  assert.match(
    FLATLIST,
    /return\s+hasHeader\s*\?\s*\(\s*<>\s*\{header\}\s*\{list\}\s*<\/>\s*\)/,
    "H-1 with a header the branch must return a Fragment of {header} then {list} — the ORCH-1043 shape the scroll and sectionlist branches already ship",
  );
});

test("H-2 the list claims flex:1 when a header is present (bounded viewport)", () => {
  assert.match(
    FLATLIST,
    /style=\{\s*\n?\s*hasHeader\s*\?\s*\[\s*styles\.flexContainer\s*,\s*flatProps\?\.style\s*\]\s*:\s*flatProps\?\.style\s*\n?\s*\}/,
    "H-2 without flex:1 beside a header sibling the list content-sizes and the viewport collapses to equal its own content — the #1540 defect",
  );
});

test("H-3 header is no longer routed into ListHeaderComponent", () => {
  assert.ok(
    !/ListHeaderComponent=\{\s*\(?\s*header\s*\?\?\s*children/.test(FLATLIST),
    "H-3 `header ?? children` is what made the header scroll away — it must be gone",
  );
  assert.match(
    FLATLIST,
    /ListHeaderComponent=\{[\s\S]*?hasHeader[\s\S]*?flatProps\?\.ListHeaderComponent[\s\S]*?children/,
    "H-3 with a header the consumer's own ListHeaderComponent is respected; without one, `children` still becomes the list header (the pre-#1540 fallback)",
  );
});

test("H-4 no intermediate wrapper is introduced — the scrollable stays a direct child", () => {
  assert.ok(
    !/<(?:View|Animated\.View|BottomSheetView)\b/.test(FLATLIST),
    "H-4 wrapping the gorhom list 'for layout' re-collapses the viewport — I-SHEET-SCROLLABLE-DIRECT-CHILD",
  );
  // The Fragment is the ONLY grouping node permitted here.
  const opens = FLATLIST.match(/<[A-Za-z]/g) ?? [];
  assert.ok(
    opens.length > 0,
    "H-4 vacuity: the branch must contain JSX for this assertion to mean anything",
  );
});

test("H-5 consumer inventory: every flatlist consumer passing a header is reviewed", () => {
  // A fourth consumer must not silently inherit a behaviour change. Note
  // FeedbackHistorySheet uses a DYNAMIC scrollMode ternary, which a literal
  // `scrollMode="flatlist"` grep misses — that is why this scans both forms.
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "node_modules") continue;
        walk(full);
      } else if (entry.name.endsWith(".tsx")) {
        files.push(full);
      }
    }
  };
  walk(path.join(APP, "src"));
  walk(path.join(APP, "app"));

  const found = [];
  for (const file of files) {
    const code = stripComments(fs.readFileSync(file, "utf8"));
    // Capture the whole scrollMode EXPRESSION, then look for 'flatlist' inside
    // it. A narrower `scrollMode="flatlist"` literal match misses the dynamic
    // ternary form — which is exactly how FeedbackHistorySheet went unnoticed in
    // the design pass's blast-radius estimate.
    const exprs = code.match(/scrollMode=(?:\{[^}]*\}|"[^"]*"|'[^']*')/g) ?? [];
    if (!exprs.some((e) => /flatlist/.test(e))) continue;
    if (!/\bheader=\{/.test(code)) continue;
    found.push(path.relative(APP, file).replace(/\\/g, "/"));
  }
  found.sort();

  const REVIEWED = [
    // The #1540 surface itself.
    "src/components/PersonHolidayView.tsx",
    // Dynamic scrollMode ternary — its search field becomes pinned.
    "src/components/FeedbackHistorySheet.tsx",
    // Its own source called the search header "always-visible"; now it is.
    "src/components/connections/FriendPickerSheet.tsx",
    // #871 tester runtime-verified the title/close header stays pinned while
    // guest rows scroll; this is now a reviewed flatlist+header consumer.
    "src/components/EventGuestListSheet.tsx",
  ].sort();

  assert.deepEqual(
    found,
    REVIEWED,
    `H-5 the set of flatlist+header consumers changed. Every one of these now gets a PINNED header. Runtime-verify the new surface, then update this list. Found: ${JSON.stringify(found)}`,
  );
});

// ── S: the saves sheet's design-pass wiring ────────────────────────────────

test("S-1 the saves sheet uses sheet chrome and shows its scroll indicator", () => {
  assert.match(
    PHV_CODE,
    /variant="sheet"/,
    'S-1 the sheet header must use the sheet variant (dismiss ✕, no status-bar offset)',
  );
  assert.match(
    PHV_CODE,
    /showsVerticalScrollIndicator:\s*true/,
    "S-1 the surface that shipped a scrolling bug must not hide the scroll indicator",
  );
});

test("S-2 the error state is wired — a failed fetch no longer claims the friend saved nothing", () => {
  assert.match(
    PHV_CODE,
    /isError:\s*savesIsError/,
    "S-2 isError must be destructured from usePairedSaves",
  );
  assert.match(
    PHV_CODE,
    /refetch:\s*refetchSaves/,
    "S-2 refetch must be destructured so the error state can retry",
  );
  assert.match(
    PHV_CODE,
    /savesIsError\s*\?\s*\(\s*<PairedSavesErrorState/,
    "S-2 the error state must be mounted ahead of the empty state",
  );
  // Precedence: skeleton must be checked BEFORE the error state, and the error
  // state before the empty state, or a first load renders the wrong thing.
  const empty = PHV_CODE.indexOf("ListEmptyComponent:");
  const slice = PHV_CODE.slice(empty, empty + 900);
  const loadingAt = slice.indexOf("savesLoading");
  const errorAt = slice.indexOf("savesIsError");
  const emptyAt = slice.indexOf("<PairedSavesEmptyState");
  assert.ok(
    loadingAt !== -1 && errorAt !== -1 && emptyAt !== -1,
    "S-2 vacuity: all three states must appear in the ListEmptyComponent expression",
  );
  assert.ok(
    loadingAt < errorAt && errorAt < emptyAt,
    "S-2 precedence must be loading → error → empty",
  );
});

test("S-3 grid tokens: flexGrow centres the states, and the gap contradiction is gone", () => {
  const grid = PRESENTATION_CODE.match(/gridContent:\s*\{[\s\S]*?\}/);
  assert.ok(grid, "S-3 vacuity: gridContent must be extractable");
  assert.match(
    grid[0],
    /flexGrow:\s*1/,
    "S-3 without flexGrow a ListEmptyComponent's flex:1 does nothing and the empty state hugs the top",
  );
  const col = PRESENTATION_CODE.match(/columnWrapper:\s*\{[\s\S]*?\}/);
  assert.ok(col, "S-3 vacuity: columnWrapper must be extractable");
  assert.ok(
    !/justifyContent/.test(col[0]),
    "S-3 `space-between` distributed the leftover itself, so the declared gap never applied — the token lied",
  );
  assert.match(
    col[0],
    /gap:\s*PAIRED_SAVES_GUTTER/,
    "S-3 the gutter must be the named token the card width is derived from",
  );
});

test("S-4 the skeleton no longer double-applies the horizontal inset", () => {
  const skel = PRESENTATION_CODE.match(/skeletonGrid:\s*\{[\s\S]*?\}/);
  assert.ok(skel, "S-4 vacuity: skeletonGrid must be extractable");
  assert.ok(
    !/paddingHorizontal/.test(skel[0]),
    "S-4 the skeleton renders INSIDE gridContent's s(16) inset; applying it again overflowed by exactly s(16) and forced a single column",
  );
});
