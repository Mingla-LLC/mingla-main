/**
 * issue #1356 [cover-nested-toast] — Tier 1 of #1342. TESTER adversarial
 * regression (different axis than the implementor's happy-path suite).
 *
 * The implementor's suite asserts the POSITIVE wiring on specific lines:
 *   T-1  a <Toast> sits inside the <Sheet> subtree,
 *   T-2  CoverPicker's onShowToast === handleShowToast (and the exact reverted
 *        pattern `onShowToast={onShowToast}` is absent),
 *   T-3/T-4  inferKind maps the known message lists to error / info,
 *   T-5  the video path is not rerouted through the nested Toast.
 *
 * This tester test attacks a DIFFERENT axis — the ROOT CAUSE of the #1356/#1342
 * bug and the thing that guarantees "no double toast on ANY platform"
 * (Constitution Rule 2, one owner per truth): the parent's root-level sibling
 * <Toast> must be COMPLETELY SEVERED from this component. Not "not wired on this
 * one line" (T-2) — severed GLOBALLY. If the parent prop is referenced anywhere
 * in the component body in ANY form (a call, a JSX pass-through under any name,
 * a destructure), a cover event can reach the parent's root Toast and the user
 * sees TWO toasts (the proven web/iOS double-toast failure mode). We assert the
 * parent `onShowToast` identifier does not occur in the component body AT ALL,
 * and that the sheet renders EXACTLY ONE <Toast> instance.
 *
 * Runtime layer: inferKind's kind decision must be CASE-INSENSITIVE (it lowers
 * the message before matching). The implementor only fed it the verbatim app
 * strings; a future copy-edit that upper-cases "Cover upload FAILED. Try again."
 * must still render red. We exercise that property for real.
 *
 * Fails-on-revert (verified by the tester via true line-deletion of the fix):
 *   - revert to `onShowToast={onShowToast}` + re-destructure the parent prop
 *     ⇒ SEVERED-1 / SEVERED-2 go red (the identifier reappears in the body);
 *   - drop the nested <Toast> ⇒ SEVERED-3 goes red (zero <Toast> instances).
 *
 * Runs under the DEFAULT node/ts-jest config (jest --ci), like the implementor
 * suite — NOT a render config. Append-only; adds a NEW file only.
 *
 * I-PROPOSED-1356-COVER-FEEDBACK-NESTED-IN-SHEET.
 */

import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, jest, test } from "@jest/globals";

// CoverPickerSheet eagerly imports sibling UI modules that pull ESM-native deps
// (reanimated / gesture-handler / expo-blur / react-native-svg) the default
// node/ts-jest env cannot parse. Mock them to inert nodes so `inferKind` (a pure
// module-scope helper) imports for real. CoverPicker is React.lazy(() =>
// import(...)) — never eagerly loaded — so it needs no mock. (Mirrors the
// implementor suite's mock block; required to load the module under this config.)
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

// eslint-disable-next-line import/first
import { inferKind } from "../CoverPickerSheet";

const UI = join(__dirname, "..");
const rawSrc = readFileSync(join(UI, "CoverPickerSheet.tsx"), "utf8");

// Strip block + line comments so the source pins assert on CODE only — a doc
// comment legitimately NAMES the parent `onShowToast` prop while the code never
// references it. The `[^:]` guard keeps `https://` URLs intact (mirrors the
// implementor helper).
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const src = stripComments(rawSrc);

// The executable component body: everything from the component declaration to
// EOF. The `onShowToast` prop TYPE on the interface (declared ABOVE this point)
// is legitimate API surface and is intentionally excluded — we only forbid the
// prop being CONSUMED by the running component.
const componentStart = src.indexOf("export const CoverPickerSheet");

describe("#1356 TESTER — parent root Toast is severed (no double toast)", () => {
  test("preconditions: the component body is isolatable", () => {
    expect(componentStart).toBeGreaterThan(-1);
    // The interface (which DOES type `onShowToast`) must sit before the body,
    // so excluding the body from the interface is meaningful.
    const ifaceIdx = src.indexOf("onShowToast: (msg: string) => void;");
    expect(ifaceIdx).toBeGreaterThan(-1);
    expect(ifaceIdx).toBeLessThan(componentStart);
  });

  test("SEVERED-1 the parent `onShowToast` is never PASSED AS A VALUE or CALLED in the body", () => {
    const body = src.slice(componentStart);
    // Allowed: the child prop NAME `onShowToast={handleShowToast}` (routes cover
    // feedback to the LOCAL handler). Forbidden: the parent prop reaching any
    // child as a VALUE `={onShowToast}` (the double-toast wiring, in ANY form —
    // `onShowToast={onShowToast}`, `someProp={onShowToast}`, …) or being invoked
    // directly `onShowToast(`. Reverting the fix reintroduces `={onShowToast}`.
    expect(body).not.toMatch(/=\{onShowToast\}/);
    expect(body).not.toMatch(/\bonShowToast\s*\(/);
  });

  test("SEVERED-2 the parent `onShowToast` is NOT destructured from props", () => {
    // Isolate the destructuring param list `({ ... }) => {`. Post-fix the parent
    // prop stays on the interface but is NOT pulled into the component's scope,
    // so it can never be consumed. Reverting re-adds `onShowToast,` here.
    const sigIdx = src.indexOf("React.FC<CoverPickerSheetProps> = ({", componentStart);
    expect(sigIdx).toBeGreaterThan(-1);
    const arrowIdx = src.indexOf("}) => {", sigIdx);
    expect(arrowIdx).toBeGreaterThan(sigIdx);
    const destructure = src.slice(sigIdx, arrowIdx);
    expect(destructure).not.toMatch(/\bonShowToast\b/);
  });

  test("SEVERED-3 the sheet renders EXACTLY ONE <Toast> instance (no double render)", () => {
    // A second <Toast> anywhere — even correctly nested — would double the cover
    // feedback. There must be precisely one Toast element in the whole file.
    const toastOpens = src.match(/<Toast\b/g) ?? [];
    expect(toastOpens.length).toBe(1);
    // And that single Toast must be driven by LOCAL state, never a parent prop.
    expect(src).toMatch(/message=\{toast\.message\}/);
  });

  // ---- Runtime layer: inferKind is case-insensitive (different from T-3/T-4) --
  test("RUNTIME inferKind classifies error signals regardless of letter case", () => {
    // The implementor fed only the verbatim (mostly lower-case) app strings.
    // inferKind lowercases before matching, so an upper/mixed-case error copy
    // must STILL render red. Prove the property, not the fixed list.
    const variants = [
      "COVER UPLOAD FAILED. TRY AGAIN.",
      "Photo Library PERMISSION Is Needed To Add A Cover.",
      "Covers Must Be 30 MB Or Smaller.",
    ];
    for (const v of variants) {
      expect(inferKind(v)).toBe("error");
      expect(inferKind(v.toLowerCase())).toBe("error");
      expect(inferKind(v.toUpperCase())).toBe("error");
    }
    // A neutral confirmation with NO error signal stays "info" in every case —
    // no false-positive reddening of a success toast.
    expect(inferKind("GIPHY COVER SELECTED.")).toBe("info");
    expect(inferKind("Photo Added.")).toBe("info");
  });
});
