#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Implementor happy-path regression suite — issue #1540
 * [paired-liked-cards: the liked-cards sheet does not scroll, and tapping a
 *  friend's card saved it to the viewer's likes].
 *
 * WHY THIS IS A SOURCE-SHAPE SUITE. gorhom's `<BottomSheet>` host is not
 * mountable in this harness (same constraint the locked Wave-A
 * `BaseBottomSheet.test.mjs` and every Wave-B/C batch suite work under), and the
 * defect is a LAYOUT-COMPOSITION defect: the scrollable's viewport came back
 * exactly equal to its own contentSize (1336 = 1336 measured on an iPhone 17,
 * iOS 26.5) because it sat under an intermediate wrapper `View` instead of being
 * a direct child of the gorhom content host. What is falsifiable in source is
 * the COMPOSITION, and that is what these tests pin. The runtime measurement is
 * the tester's adversarial angle per SPEC §6.
 *
 * WHAT WOULD MAKE THIS TEST WORTHLESS. A whole-file `/scrollMode="flatlist"/`
 * grep would pass on a file that mounts a DIFFERENT sheet in flatlist mode while
 * the saves sheet stays broken. So every structural assertion below is scoped to
 * the saves sheet's own `<BaseBottomSheet …>` element, extracted by its
 * `visible={showSavesList}` prop, and T-0 is a vacuity guard that fails if that
 * extraction returns nothing.
 *
 * T-0  Vacuity guard: every source file and the extracted saves-sheet element
 *      are non-empty, so no later assertion can pass by matching nothing.
 * T-1  The saves sheet is `scrollMode="flatlist"` — BaseBottomSheet's ONLY body
 *      branch that renders a gorhom `BottomSheetFlatList` as a direct child of
 *      `<BottomSheet>` (BaseBottomSheet.tsx case 'flatlist').
 * T-2  It drives that list through `scrollProps` (data + keyExtractor +
 *      renderItem + numColumns), i.e. BaseBottomSheet owns the scrollable.
 * T-3  It passes a `header`, so the back chevron + title survive the move.
 * T-4  `snapPoints={SAVES_LIST_SNAP}` (['90%']) and `wrapInRNModal` are
 *      unchanged — the SPEC's byte-identical constraint.
 * T-5  The saves sheet no longer mounts `<PairedSavesListScreen>`; that whole
 *      wrapper subtree is what bounded the list to its own content height.
 * T-6  `PairedSavesListScreen` no longer imports `BottomSheetFlatList` and no
 *      longer exposes `inBottomSheet` (SPEC S1-3, Constitution #8).
 * T-7  The VISITS list is untouched: still a full-screen
 *      `<Modal presentationStyle="pageSheet">` mounting PairedSavesListScreen.
 * T-8  The presentation owner exists and exports the shared pieces, and BOTH
 *      consumers import from it (Constitution #2, one owner per truth).
 * T-9  Defect 2: `onSaveCardPress` goes through `savedCardToExpandedCardData`
 *      and NOT through `handleSaveCard`; the legitimate save path
 *      (ExpandedCardModal's own `onSave`) still calls `handleSaveCard`.
 * T-10 Defect 2, executable: the real `savedCardToExpandedCardData` converts a
 *      realistic `saved_card.card_data` payload into a usable ExpandedCardData.
 *      This one runs the actual product function rather than reading source —
 *      the SPEC (S2-1) explicitly required verifying that the mapper, whose
 *      doc-comment names `board_saved_cards.card_data`, also handles the
 *      `saved_card.card_data` shape this path supplies.
 *
 * FAILS-ON-REVERT: proven by TRUE LINE DELETION of the fix (not a comment-out).
 * Restoring `scrollMode="view"` + the `<PairedSavesListScreen inBottomSheet>`
 * child flips T-1/T-2/T-3/T-5; restoring `onSaveCardPress={handleSaveCard}`
 * flips T-9. Hash recorded in the implementation report on issue #1540.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// app-mobile/src/components/__tests__ → app-mobile is 3 levels up.
const APP_MOBILE = path.resolve(__dirname, "..", "..", "..");

const read = (rel) => fs.readFileSync(path.join(APP_MOBILE, rel), "utf8");

const HOLIDAY_REL = "src/components/PersonHolidayView.tsx";
const SAVES_SCREEN_REL = "src/components/PairedSavesListScreen.tsx";
const PRESENTATION_REL = "src/components/pairedSaves/PairedSavesListPresentation.tsx";
const FRIEND_PROFILE_REL = "src/components/profile/ViewFriendProfileScreen.tsx";

const HOLIDAY = read(HOLIDAY_REL);
const SAVES_SCREEN = read(SAVES_SCREEN_REL);
const PRESENTATION = read(PRESENTATION_REL);
const FRIEND_PROFILE = read(FRIEND_PROFILE_REL);

/**
 * Extract the single `<BaseBottomSheet …>` JSX element that carries
 * `visible={showSavesList}`, balancing braces so nested `{…}` props (scrollProps,
 * header) are captured whole. Returns "" when not found so T-0 can fail loudly.
 */
function extractSavesSheetElement(source) {
  const openIdx = source.indexOf("<BaseBottomSheet");
  if (openIdx < 0) return "";
  // Walk every <BaseBottomSheet occurrence; keep the one mentioning showSavesList.
  let searchFrom = 0;
  for (;;) {
    const start = source.indexOf("<BaseBottomSheet", searchFrom);
    if (start < 0) return "";
    let i = start;
    let depth = 0;
    let end = -1;
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) return "";
    const element = source.slice(start, end + 1);
    if (element.includes("visible={showSavesList}")) return element;
    searchFrom = end + 1;
  }
}

const SAVES_SHEET = extractSavesSheetElement(HOLIDAY);

/**
 * The saves sheet's FULL subtree: its opening tag plus, when it is not
 * self-closing, everything up to the matching `</BaseBottomSheet>`. T-5 needs
 * this because `extractSavesSheetElement` deliberately stops at the opening
 * tag's `>` — scoping T-1…T-4 to props — which would make a children assertion
 * vacuous (it could never see a child even if one were reintroduced).
 */
function extractSavesSheetSubtree(source, element) {
  if (!element) return "";
  const start = source.indexOf(element);
  if (start < 0) return "";
  if (element.trimEnd().endsWith("/>")) return element; // self-closing: no children
  const closeIdx = source.indexOf("</BaseBottomSheet>", start);
  if (closeIdx < 0) return element;
  return source.slice(start, closeIdx + "</BaseBottomSheet>".length);
}

const SAVES_SHEET_SUBTREE = extractSavesSheetSubtree(HOLIDAY, SAVES_SHEET);

// ── T-0: vacuity guard ──────────────────────────────────────────────────────
test("T-0 vacuity: every source under test and the extracted saves sheet are non-empty", () => {
  for (const [rel, src] of [
    [HOLIDAY_REL, HOLIDAY],
    [SAVES_SCREEN_REL, SAVES_SCREEN],
    [PRESENTATION_REL, PRESENTATION],
    [FRIEND_PROFILE_REL, FRIEND_PROFILE],
  ]) {
    assert.ok(src.length > 500, `${rel} must be a real source file, got ${src.length} bytes`);
  }
  assert.ok(
    SAVES_SHEET.length > 100,
    "T-0 the saves sheet's <BaseBottomSheet visible={showSavesList} …> element must be extractable — " +
      "every structural assertion below is scoped to it, so an empty extraction would make them all vacuous",
  );
  assert.match(
    SAVES_SHEET,
    /visible=\{showSavesList\}/,
    "T-0 the extracted element must be the SAVES sheet, not another sheet in the file",
  );
});

// ── T-1: the sheet owns the scrollable (flatlist body branch) ───────────────
test("T-1 saves sheet uses scrollMode=\"flatlist\" so the gorhom list is a DIRECT child of <BottomSheet>", () => {
  assert.match(
    SAVES_SHEET,
    /scrollMode="flatlist"/,
    'T-1 saves sheet must be scrollMode="flatlist" — under "view" BaseBottomSheet returns children verbatim ' +
      "and the scrollable ends up nested under a wrapper View with a content-sized viewport (#1540)",
  );
  assert.ok(
    !/scrollMode="view"/.test(SAVES_SHEET),
    'T-1 saves sheet must NOT be scrollMode="view" — that is the broken shape',
  );
});

// ── T-2: the list is driven through scrollProps ─────────────────────────────
test("T-2 saves sheet drives the list through scrollProps (data/keyExtractor/renderItem/numColumns)", () => {
  assert.match(SAVES_SHEET, /scrollProps=\{\{/, "T-2 saves sheet must pass scrollProps");
  for (const key of ["data:", "keyExtractor:", "renderItem:", "numColumns:"]) {
    assert.ok(
      SAVES_SHEET.includes(key),
      `T-2 saves sheet scrollProps must carry ${key} — without it BaseBottomSheet renders no list`,
    );
  }
  assert.match(
    SAVES_SHEET,
    /data:\s*savesListItems/,
    "T-2 the list data must be the derived saves rows",
  );
});

// ── T-3: header survives the move ───────────────────────────────────────────
test("T-3 saves sheet passes the shared PairedSavesListHeader as its header", () => {
  assert.match(
    SAVES_SHEET,
    /header=\{[\s\S]*<PairedSavesListHeader/,
    "T-3 the back chevron + title must still render, now as the sheet's header slot",
  );
});

// ── T-4: snap + modal wrapping unchanged ────────────────────────────────────
test("T-4 snapPoints ['90%'] and wrapInRNModal are unchanged", () => {
  assert.match(
    SAVES_SHEET,
    /snapPoints=\{SAVES_LIST_SNAP as unknown as string\[\]\}/,
    "T-4 the saves sheet must keep its existing snapPoints expression",
  );
  assert.match(
    HOLIDAY,
    /const SAVES_LIST_SNAP = \['90%'\] as const;/,
    "T-4 SAVES_LIST_SNAP must remain ['90%'] — the SPEC forbids changing the snap",
  );
  assert.match(SAVES_SHEET, /\bwrapInRNModal\b/, "T-4 wrapInRNModal must be preserved");
});

// ── T-5: the wrapper subtree is gone from the sheet ─────────────────────────
test("T-5 the saves sheet no longer mounts <PairedSavesListScreen> (the wrapper that bounded the list to its own content)", () => {
  // Scoped to the sheet's FULL subtree, not its opening tag — a props-only scope
  // could never observe a child and would pass no matter what was mounted.
  assert.ok(
    SAVES_SHEET_SUBTREE.length >= SAVES_SHEET.length,
    "T-5 vacuity: the saves sheet subtree must be extractable",
  );
  assert.ok(
    !SAVES_SHEET_SUBTREE.includes("<PairedSavesListScreen"),
    "T-5 the saves sheet must not mount PairedSavesListScreen — its root <View style={{flex:1}}> is the unbounded node",
  );
  // The file as a whole MUST still mount it once, for the visits list (T-7).
  const mounts = HOLIDAY.split("<PairedSavesListScreen").length - 1;
  assert.equal(
    mounts,
    1,
    `T-5 PairedSavesListScreen must be mounted exactly once (the visits list); found ${mounts}`,
  );
});

// ── T-6: the dead in-sheet path is deleted ──────────────────────────────────
test("T-6 PairedSavesListScreen drops the BottomSheetFlatList import and the inBottomSheet prop", () => {
  assert.ok(
    !/BottomSheetFlatList/.test(SAVES_SCREEN),
    "T-6 PairedSavesListScreen must not reference BottomSheetFlatList — the in-sheet path is dead (SPEC S1-3)",
  );
  assert.ok(
    !/inBottomSheet/.test(SAVES_SCREEN),
    "T-6 the inBottomSheet prop must be deleted, not merely unused (Constitution #8, subtract before adding)",
  );
  assert.ok(
    !/inBottomSheet/.test(HOLIDAY),
    "T-6 PersonHolidayView must no longer pass inBottomSheet",
  );
  assert.match(
    SAVES_SCREEN,
    /<FlatList/,
    "T-6 the full-screen consumer keeps a raw RN FlatList",
  );
});

// ── T-7: the visits list is untouched ───────────────────────────────────────
test("T-7 the visits list is still a full-screen pageSheet <Modal> mounting PairedSavesListScreen", () => {
  assert.match(
    HOLIDAY,
    /<Modal visible=\{showVisitsList\} animationType="slide" presentationStyle="pageSheet">/,
    "T-7 the visits list must keep its native pageSheet Modal — the SPEC puts it out of scope",
  );
  const visitsIdx = HOLIDAY.indexOf("visible={showVisitsList}");
  assert.ok(visitsIdx > 0, "T-7 the visits Modal must exist");
  assert.match(
    HOLIDAY.slice(visitsIdx, visitsIdx + 900),
    /<PairedSavesListScreen/,
    "T-7 the visits Modal must still mount PairedSavesListScreen",
  );
});

// ── T-8: one owner per truth ────────────────────────────────────────────────
test("T-8 the shared presentation owner exports the pieces and both consumers import from it", () => {
  for (const exp of [
    "export const PairedSavesListHeader",
    "export function renderPairedSaveItem",
    "export const PairedSavesSkeletonGrid",
    "export const PairedSavesEmptyState",
    "export const PairedSavesErrorState",
    "export const pairedSavesGridStyles",
  ]) {
    assert.ok(
      PRESENTATION.includes(exp),
      `T-8 the presentation owner must expose "${exp}" so both consumers render identical cells`,
    );
  }
  for (const [rel, src] of [
    [HOLIDAY_REL, HOLIDAY],
    [SAVES_SCREEN_REL, SAVES_SCREEN],
  ]) {
    assert.match(
      src,
      /from ['"][^'"]*pairedSaves\/PairedSavesListPresentation['"]/,
      `T-8 ${rel} must import the shared presentation owner rather than re-declaring the grid`,
    );
  }
});

// ── T-9: defect 2 wiring ────────────────────────────────────────────────────
test("T-9 onSaveCardPress opens the card via savedCardToExpandedCardData and never calls handleSaveCard", () => {
  assert.match(
    FRIEND_PROFILE,
    /import \{ savedCardToExpandedCardData \} from ['"][^'"]*savedCardToExpandedCardData['"]/,
    "T-9 ViewFriendProfileScreen must use the existing canonical converter, not a new mapper",
  );
  assert.ok(
    !/onSaveCardPress=\{handleSaveCard\}/.test(FRIEND_PROFILE),
    "T-9 onSaveCardPress must NOT be wired to handleSaveCard — that wrote the friend's card into the viewer's saved_card",
  );
  const idx = FRIEND_PROFILE.indexOf("onSaveCardPress=");
  assert.ok(idx > 0, "T-9 the onSaveCardPress prop must still be passed to PersonHolidayView");
  const block = FRIEND_PROFILE.slice(idx, idx + 400);
  assert.match(
    block,
    /savedCardToExpandedCardData\(cardData\)/,
    "T-9 the tap handler must convert the saved card",
  );
  assert.match(
    block,
    /setExpandedCard\(expanded\)/,
    "T-9 the tap handler must OPEN the converted card",
  );
  assert.ok(
    !/savedCardsService\.saveCard/.test(block),
    "T-9 the tap handler must not reach the save service",
  );
  // The legitimate save path is untouched (SPEC S2-2).
  assert.match(
    FRIEND_PROFILE,
    /onSave=\{async \(card: any\) => \{\s*await handleSaveCard\(card\);/,
    "T-9 ExpandedCardModal's own onSave must still call handleSaveCard — that is the real save path",
  );
});

// ── T-10: the converter actually handles saved_card.card_data ──────────────
test("T-10 savedCardToExpandedCardData converts a realistic saved_card.card_data payload", async () => {
  // Node cannot import .ts directly, and a `try { import } catch { return }`
  // would turn this into a test that passes by doing nothing — the exact
  // unfalsifiable-test failure mode #1540's SPEC warns about. So the TypeScript
  // is transpiled here and the REAL product function is executed. If the
  // transpiler is missing this test FAILS; it never silently skips.
  //
  // The converter's whole runtime dependency graph is two files: itself and
  // `src/utils/priceTiers.ts`, which has zero imports. The only other import is
  // `import type { ExpandedCardData }`, which transpilation erases.
  const ts = await import("typescript");
  const transpile = (code) =>
    ts.default.transpileModule(code, {
      compilerOptions: {
        module: ts.default.ModuleKind.ESNext,
        target: ts.default.ScriptTarget.ES2022,
      },
    }).outputText;

  const toModuleUrl = (code) =>
    `data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`;

  const priceTiersUrl = toModuleUrl(transpile(read("src/utils/priceTiers.ts")));
  const converterJs = transpile(read("src/components/utils/savedCardToExpandedCardData.ts"))
    .replace(/(["'])\.\.\/\.\.\/utils\/priceTiers\1/, JSON.stringify(priceTiersUrl));
  const mod = await import(toModuleUrl(converterJs));

  assert.equal(
    typeof mod.savedCardToExpandedCardData,
    "function",
    "T-10 the real converter must be loadable and executable — a skipped check proves nothing",
  );

  // Exactly the shape savedCardsService.saveCard persists: {...card, dateAdded, source}.
  const cardData = {
    id: "exp-123",
    title: "Bar Kabawa",
    category: "Drink",
    description: "Caribbean cocktail bar",
    image: "https://example.test/a.jpg",
    rating: 4.6,
    reviewCount: 210,
    address: "48 E 7th St",
    dateAdded: "2026-08-04T00:00:00.000Z",
    source: "solo",
  };
  const expanded = mod.savedCardToExpandedCardData(cardData);
  assert.ok(expanded, "T-10 the converter must return a card, not null");
  assert.equal(expanded.id, "exp-123");
  assert.equal(expanded.title, "Bar Kabawa");
  assert.equal(
    expanded.category,
    "Drink",
    "T-10 the real category must survive — fabricating night_out breaks the modal's discriminator",
  );
  assert.equal(mod.savedCardToExpandedCardData(null), null, "T-10 null in, null out");
});
