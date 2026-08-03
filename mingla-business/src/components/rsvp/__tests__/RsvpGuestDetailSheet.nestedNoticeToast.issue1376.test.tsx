/**
 * #1376 [rsvp-console-modal-fix] — Tier 2 of #1342 (FINAL group). Implementor
 * happy-path regression, BUG 2: the approve/deny error toast is NESTED inside the
 * detail sheet (SPEC §7 T-3/T-4/T-5 + §9, SC-2/SC-3).
 *
 * Bug 2 (code-proven + New-Arch collision mechanism proven in #1338/#1356): the
 * sheet's approve/deny `onError` fired `showToast(...)` while the detail sheet
 * stayed open, routing to the console-root sibling <Toast>. On iOS New-Arch that
 * Toast's native <Modal> tries to present from the SAME screen-root VC the open
 * Sheet modal already holds → UIKit refuses the second modal → the error toast is
 * silently dropped (the host sees nothing, thinks approve/deny did nothing).
 *
 * Fix (SPEC §4, NEST NOT defer — the sheet stays open on error by design): render
 * an error <Toast> INSIDE RsvpGuestDetailSheet's <Sheet> subtree (the #1356
 * CoverPickerSheet template), driven by a new `notice` prop; route the console's
 * sheet approve/deny `onError` to `setSheetNotice(...)` instead of `showToast(...)`.
 * The console-root <Toast> + `showToast` remain for the row/bulk/confirm-error
 * paths (untouched — no sheet open there).
 *
 * Pure SOURCE WIRING (mirrors #1356's Layer-2 / #1360): the components carry heavy
 * native deps the node/ts-jest env cannot render, so the nested-Toast structure +
 * the onError routing are asserted over comment-stripped source. Each assertion
 * FAILS-ON-REVERT (SPEC §9): restore the sibling `showToast(...)` on error (or drop
 * the nested <Toast>) and T-3/T-4 go RED.
 *
 * I-PROPOSED-1376-RSVP-GUEST-CONSOLE-SECOND-MODAL-NESTED-OR-DEFERRED (Clause B).
 */
import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, test } from "@jest/globals";

// src/components/rsvp/__tests__ → up one → the rsvp component dir.
const RSVP_DIR = join(__dirname, "..");
const read = (rel: string): string => readFileSync(join(RSVP_DIR, rel), "utf8");

// Strip block + line comments so source-text pins assert on CODE only — the doc
// comments legitimately NAME <Toast>, <Sheet>, showToast and setSheetNotice in
// prose. The `[^:]` guard keeps `https://` intact. JSX `{/* ... */}` comments
// collapse to `{}` (harmless empty expression containers).
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Balanced-brace slice of the block whose opening `{` is the first at/after
 * `marker`. Template-literal `${...}` braces stay balanced.
 */
function sliceHandler(src: string, marker: string): string {
  const m = src.indexOf(marker);
  if (m < 0) throw new Error(`marker not found: ${marker}`);
  const open = src.indexOf("{", m);
  if (open < 0) throw new Error(`no block after marker: ${marker}`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced block after marker: ${marker}`);
}

const sheetSrc = stripComments(read("RsvpGuestDetailSheet.tsx"));
const consoleSrc = stripComments(read("RsvpGuestConsole.tsx"));

describe("#1376 Bug 2 — approve/deny error Toast is nested inside the detail sheet", () => {
  // ---- The nested <Toast> lives INSIDE the <Sheet> subtree -------------------
  test("T-3 a <Toast> is a descendant INSIDE the detail sheet's <Sheet> subtree", () => {
    const sheetOpen = sheetSrc.indexOf("<Sheet");
    const sheetClose = sheetSrc.indexOf("</Sheet>");
    expect(sheetOpen).toBeGreaterThan(-1);
    expect(sheetClose).toBeGreaterThan(sheetOpen);
    const insideSheet = sheetSrc.slice(sheetOpen, sheetClose);
    // The nested error Toast must live inside that block (not a root sibling).
    expect(insideSheet).toMatch(/<Toast\b/);
    expect(insideSheet).toContain('testID="rsvp-guest-detail-notice"');
    // Driven by the new notice prop — an error kind, shown iff notice !== null.
    expect(insideSheet).toMatch(/visible=\{notice !== null\}/);
    expect(insideSheet).toMatch(/kind="error"/);
    expect(insideSheet).toMatch(/message=\{notice \?\? ""\}/);
    expect(insideSheet).toMatch(/onDismiss=\{onNoticeDismiss\}/);
  });

  test("the sheet takes the notice / onNoticeDismiss props", () => {
    expect(sheetSrc).toMatch(/notice: string \| null/);
    expect(sheetSrc).toMatch(/onNoticeDismiss: \(\) => void/);
    // ...and destructures them for the nested Toast.
    expect(sheetSrc).toMatch(/\bnotice,/);
    expect(sheetSrc).toMatch(/\bonNoticeDismiss,/);
  });

  // ---- The console routes the SHEET approve/deny errors in-sheet -------------
  test("T-4 handleSheetApprove routes its onError to setSheetNotice, NOT showToast", () => {
    const block = sliceHandler(consoleSrc, "const handleSheetApprove = useCallback");
    expect(block).toMatch(/setSheetNotice\(/);
    expect(block).not.toMatch(/showToast\(/);
  });

  test("T-4 handleSheetDeny routes its onError to setSheetNotice, NOT showToast", () => {
    const block = sliceHandler(consoleSrc, "const handleSheetDeny = useCallback");
    expect(block).toMatch(/setSheetNotice\(/);
    expect(block).not.toMatch(/showToast\(/);
  });

  test("the console passes notice / onNoticeDismiss down to the detail sheet", () => {
    expect(consoleSrc).toMatch(/notice=\{sheetNotice\}/);
    expect(consoleSrc).toMatch(/onNoticeDismiss=\{\(\) => setSheetNotice\(null\)\}/);
  });

  // ---- T-5 preservation: the console-root Toast / showToast paths survive ----
  test("T-5 the console-root <Toast> + showToast remain for the row/bulk/confirm paths", () => {
    // The console-root sibling Toast is still rendered (row/bulk/confirm-error).
    expect(consoleSrc).toMatch(/visible=\{toast\.visible\}/);
    // showToast still drives the row approve/deny, bulk approve, and
    // confirm-remove error paths (no sheet open on any of those).
    const rowApprove = sliceHandler(consoleSrc, "const handleApprove = useCallback");
    expect(rowApprove).toMatch(/showToast\(/);
    const bulk = sliceHandler(consoleSrc, "const handleBulkApprove = useCallback");
    expect(bulk).toMatch(/showToast\(/);
    const confirmRemove = sliceHandler(consoleSrc, "const handleConfirmRemove = useCallback");
    expect(confirmRemove).toMatch(/showToast\(/);
  });
});
