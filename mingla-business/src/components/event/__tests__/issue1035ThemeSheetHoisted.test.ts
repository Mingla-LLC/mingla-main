/**
 * #1035 — implementor regression test: the Theme picker sheet must be hoisted
 * OUT of the memoized `renderSectionBody` and rendered at EditPublishedScreen's
 * top level, so tapping the Theme row actually opens it.
 *
 * PROVEN root cause (issue #1035): `renderSectionBody` is a `useCallback` whose
 * `"visual"` case rendered `<ThemeSheet visible={themeSheetOpen}>`, but the
 * callback's dependency array OMITTED `themeSheetOpen`. Tapping the row fired
 * `setThemeSheetOpen(true)` and re-rendered the component, but React returned
 * the CACHED closure (none of its 11 listed deps changed), which still closed
 * over `themeSheetOpen === false`. So `renderSectionBody("visual")` kept
 * returning `<ThemeSheet visible={false}>` and the sheet never presented —
 * press feedback fired, sheet stayed closed. Deterministic, every tap.
 *
 * Fix (structural, matches BrandEditView + all four create mounts): hoist
 * `<ThemeSheet>` to the component's top-level return (a sibling of
 * `<ChangeSummaryModal>`) where `visible={themeSheetOpen}` is read from live
 * render scope on every render. The `<ThemeControlRow>` (stable setter onPress)
 * stays inside the Visual section body. This screen serves BOTH published-event
 * edit and published-RSVP edit (SECTIONS and RSVP_SECTIONS both include the
 * "visual" key), so the one hoist fixes both.
 *
 * fails-on-revert: if `<ThemeSheet>` is moved back inside `renderSectionBody`
 * (the pre-fix shape), the "not inside the memo block" assertions below fail.
 * Verified by true line-deletion of the fix, not a comment-out — the source is
 * comment-stripped before every assertion so the protective comment block above
 * (which cites the pre-fix shape) can never satisfy the grep.
 */

import fs from "node:fs";
import path from "node:path";

const SCREEN_PATH = path.resolve(__dirname, "..", "EditPublishedScreen.tsx");
const SECTIONS_PATH = path.resolve(
  __dirname,
  "..",
  "editPublishedSections.ts",
);

/** Strip block + line comments so the protective comment never pollutes greps. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("#1035 — ThemeSheet hoisted out of the memoized renderSectionBody", () => {
  const raw = fs.readFileSync(SCREEN_PATH, "utf8");
  const source = stripComments(raw);

  // The memoized section renderer spans from its declaration to the very next
  // top-level declaration (`const editedSectionKeys = useMemo`). Everything the
  // useCallback returns lives strictly between these two markers.
  const memoStart = source.indexOf("const renderSectionBody = useCallback(");
  const memoEnd = source.indexOf("const editedSectionKeys");

  test("source loads and the renderSectionBody memo block is locatable", () => {
    expect(raw.length).toBeGreaterThan(0);
    expect(memoStart).toBeGreaterThanOrEqual(0);
    expect(memoEnd).toBeGreaterThan(memoStart);
  });

  test("FAILS-ON-REVERT: <ThemeSheet> is NOT inside the memoized renderSectionBody", () => {
    const memoBlock = source.slice(memoStart, memoEnd);
    // The row stays; the sheet must NOT. If reverted (sheet back in the
    // "visual" case), this block contains `<ThemeSheet` and the test goes red.
    expect(memoBlock).toContain("<ThemeControlRow");
    expect(memoBlock).not.toContain("<ThemeSheet");
    // Belt-and-braces: the tell-tale stale read must not live in the memo.
    expect(memoBlock).not.toContain("visible={themeSheetOpen}");
  });

  test("<ThemeSheet> is rendered exactly once, at the top level, below the memo", () => {
    const occurrences = source.match(/<ThemeSheet/g) ?? [];
    expect(occurrences).toHaveLength(1);

    const returnRegion = source.slice(memoEnd);
    const changeSummaryIdx = returnRegion.indexOf("<ChangeSummaryModal");
    const sheetIdx = returnRegion.indexOf("<ThemeSheet");
    expect(changeSummaryIdx).toBeGreaterThanOrEqual(0);
    // Hoisted as a sibling of ChangeSummaryModal, in the component's return.
    expect(sheetIdx).toBeGreaterThan(changeSummaryIdx);
  });

  test("the hoisted sheet reads live scope and preserves every prop", () => {
    const sheetJsx = source.slice(memoEnd).match(/<ThemeSheet[\s\S]*?\/>/)?.[0];
    expect(sheetJsx).toBeDefined();
    // Reads themeSheetOpen from live render scope (the whole point of the fix).
    expect(sheetJsx).toContain("visible={themeSheetOpen}");
    expect(sheetJsx).toContain("onClose={() => setThemeSheetOpen(false)}");
    // Every prop the sheet carried in the section body is preserved verbatim.
    expect(sheetJsx).toContain("value={editState.themeOverrides}");
    expect(sheetJsx).toContain("onChange={(themeOverrides) => handleUpdateDraft({ themeOverrides })}");
    expect(sheetJsx).toContain('scope="offering"');
    expect(sheetJsx).toContain("brandTheme={brandQuery.data?.theme ?? null}");
    expect(sheetJsx).toContain('testID="edit-published-theme-sheet"');
  });

  test("the Theme row keeps its open handler inside the Visual section body", () => {
    const memoBlock = source.slice(memoStart, memoEnd);
    // The row's stable setter onPress is what flips the state; it stays put.
    expect(memoBlock).toContain("onPress={() => setThemeSheetOpen(true)}");
    expect(memoBlock).toContain('testID="edit-published-theme-row"');
  });

  test("both published-event and published-RSVP edit route through the same 'visual' section", () => {
    const sections = stripComments(fs.readFileSync(SECTIONS_PATH, "utf8"));
    // SECTIONS (ticketed/event edit) and RSVP_SECTIONS both list the "visual"
    // key, so the single hoisted sheet on this screen serves both edit paths.
    expect(sections).toContain("export const SECTIONS");
    expect(sections).toContain("export const RSVP_SECTIONS");
    const visualKeyCount = (sections.match(/key:\s*"visual"/g) ?? []).length;
    expect(visualKeyCount).toBeGreaterThanOrEqual(2);
  });
});
