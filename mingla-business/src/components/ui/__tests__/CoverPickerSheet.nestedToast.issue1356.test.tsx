/**
 * issue #1356 [cover-nested-toast] — Tier 1 of #1342. Implementor happy-path
 * regression.
 *
 * Bug (proven on the iOS sim, "already presenting" refusal): CoverPickerSheet
 * forwarded the picker's onShowToast straight to the PARENT's root-level sibling
 * <Toast>. On iOS New-Arch that Toast's native <Modal> tries to present from the
 * SAME screen-root VC the open Sheet modal already occupies → UIKit refuses the
 * second modal → every cover confirmation/error toast is silently dropped, across
 * all 11 cover mounts.
 *
 * Fix (ONE file, CoverPickerSheet.tsx): render the feedback <Toast> INSIDE the
 * <Sheet> subtree (I-SUB-SHEET-INSIDE-PARENT) and route the picker's onShowToast
 * to a LOCAL handler (handleShowToast) that drives it — never the parent prop.
 *
 * Two coverage layers (mirrors the META-ORCH-1059 CoverPickerSheet suite: the
 * component carries heavy native deps the node/ts-jest env cannot render, so the
 * render-side wiring is asserted via source; the pure kind-inference logic is
 * exercised for real):
 *
 *   1. REAL LOGIC — `inferKind` is imported and executed directly over the exact
 *      strings CoverPicker passes to onShowToast. Fails on revert of the helper.
 *   2. SOURCE WIRING — CoverPickerSheet.tsx source asserts the nested <Toast> is a
 *      descendant of <Sheet> AND that CoverPicker receives handleShowToast (not
 *      the parent onShowToast). Each assertion FAILS-ON-REVERT (SPEC §9): revert
 *      to `onShowToast={onShowToast}` + drop the nested <Toast> and T-1/T-2 go red.
 *
 * I-PROPOSED-1356-COVER-FEEDBACK-NESTED-IN-SHEET.
 */

import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, jest, test } from "@jest/globals";

// The sibling UI modules eagerly pull ESM-native deps (react-native-reanimated /
// gesture-handler / expo-blur / react-native-svg) that the default node/ts-jest
// config cannot parse. Mock them to inert nodes so `inferKind` (a pure module-
// scope helper) can be imported and executed for real. CoverPicker itself is
// React.lazy(() => import(...)) — never eagerly loaded — so it needs no mock.
jest.mock("../Toast", () => ({ Toast: () => null }));
jest.mock("../Sheet", () => ({
  Sheet: ({ children }: { children?: unknown }) => children ?? null,
}));
jest.mock("../Button", () => ({ Button: () => null }));
jest.mock("../Icon", () => ({ Icon: () => null }));
jest.mock("../../../wrappers/SmartScrollView", () => ({ ScrollView: () => null }));
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));

// Imported AFTER the jest.mock() block so the mocked sibling modules are
// registered before CoverPickerSheet loads.
// eslint-disable-next-line import/first
import { inferKind } from "../CoverPickerSheet";

const UI = join(__dirname, "..");
const read = (rel: string): string => readFileSync(join(UI, rel), "utf8");
// Strip block + line comments so source-text pins assert on CODE only (a doc
// comment may legitimately NAME videoPickNotice while the code never touches it).
// The `[^:]` guard keeps `https://` URLs intact.
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// The verbatim strings CoverPicker passes to onShowToast (CoverPicker.tsx).
// Upload FAILURES / blockers — these must render red ("error").
const ERROR_MESSAGES = [
  "Photo library permission is needed to add a cover.",
  "Covers must be 30 MB or smaller.",
  "This needs a server record before media upload.",
  "Uploaded, but this cover could not be displayed.",
  "Cover upload failed. Try again.",
  "Finishing sign-in before upload. Try again in a moment.",
];
// Neutral confirmations — these stay "info" (the parents' historical static kind).
const INFO_MESSAGES = [
  "GIPHY cover selected.",
  "Pexels cover selected.",
  "Photo added.",
  "Photo added to gallery.",
  "Photo removed.",
  "Cover updated.",
  "Cover removed.",
  "Up to 8 extra photos.",
];

describe("#1356 CoverPickerSheet nested cover-feedback Toast", () => {
  // ---- Layer 1: REAL LOGIC — inferKind (T-3 / T-4, behavioral) --------------
  test("T-3 upload-failure/blocker messages infer kind 'error'", () => {
    for (const msg of ERROR_MESSAGES) {
      expect(inferKind(msg)).toBe("error");
    }
  });

  test("T-4 neutral confirmation messages infer kind 'info'", () => {
    for (const msg of INFO_MESSAGES) {
      expect(inferKind(msg)).toBe("info");
    }
  });

  // ---- Layer 2: SOURCE WIRING (T-1 / T-2 / T-5, fails-on-revert) ------------
  const src = read("CoverPickerSheet.tsx");

  test("T-1 a <Toast> is rendered as a descendant INSIDE the <Sheet> subtree", () => {
    // Isolate the JSX between the opening <Sheet ...> and its closing </Sheet>.
    const sheetOpen = src.indexOf("<Sheet ");
    const sheetClose = src.indexOf("</Sheet>");
    expect(sheetOpen).toBeGreaterThan(-1);
    expect(sheetClose).toBeGreaterThan(sheetOpen);
    const insideSheet = src.slice(sheetOpen, sheetClose);
    // The nested feedback Toast must live inside that block (not a root sibling).
    expect(insideSheet).toMatch(/<Toast\b/);
    expect(insideSheet).toContain('testID="cover-picker-sheet-toast"');
    // And it must be driven by the local toast state, not a parent prop.
    expect(insideSheet).toMatch(/visible=\{toast\.visible\}/);
    expect(insideSheet).toMatch(/kind=\{toast\.kind\}/);
    expect(insideSheet).toMatch(/message=\{toast\.message\}/);
  });

  test("T-2 CoverPicker receives handleShowToast, NOT the parent onShowToast", () => {
    // The fix: the picker's onShowToast is wired to the LOCAL handler.
    expect(src).toMatch(/onShowToast=\{handleShowToast\}/);
    // The reverted wiring (forwarding the parent prop straight through) is gone.
    expect(src).not.toMatch(/onShowToast=\{onShowToast\}/);
    // The local handler + inferKind seam exists.
    expect(src).toMatch(/const handleShowToast = useCallback/);
    expect(src).toMatch(/setToast\(\{\s*visible: true, message, kind: inferKind\(message\)/);
  });

  test("T-5 the video path (inline videoPickNotice) is NOT rerouted through the nested Toast", () => {
    // videoPickNotice lives in CoverPicker.tsx and stays an inline banner (#1338/
    // #1350). The sheet's CODE must NOT touch it (the nested Toast is ONLY for the
    // image/GIF/Pexels/gallery/error onShowToast calls) — a doc comment may name it.
    expect(stripComments(src)).not.toContain("videoPickNotice");
    // And CoverPicker still owns the inline banner (preservation guard), rendered
    // inline — never routed through the onShowToast seam.
    const pickerSrc = read("CoverPicker.tsx");
    expect(pickerSrc).toContain("videoPickNotice");
    expect(pickerSrc).not.toMatch(/onShowToast\(\s*videoPickNotice/);
  });
});
