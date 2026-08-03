/**
 * issue #1369 [team-confirm-nested] — Tier 2 of #1342. TESTER adversarial
 * regression. DIFFERENT ANGLE than the implementor's happy-path source-grep
 * (MemberDetailSheet.confirmNestedInSheet.issue1369.source.test.ts).
 *
 * WHY A DIFFERENT ANGLE: the implementor's test locates the two <ConfirmDialog>s
 * with FLAT string-index comparisons against the FIRST "</Sheet>" (indexOf). That
 * proves "the confirms sit textually between the first <Sheet and the first
 * </Sheet>", but it does NOT prove JSX TAG BALANCE. A naive regression that
 * prematurely closes the outer <Sheet> and re-opens a sibling one, or that nests
 * a confirm one structural level too shallow, can still satisfy a flat-index scan
 * while breaking the exact iOS VC-stacking the fix depends on (the confirm's
 * native <Modal> must present from the sheet's OWN modal VC, i.e. from strictly
 * inside an OPEN <Sheet>).
 *
 * This test instead performs a BALANCED-DEPTH WALK: it interleaves every
 * <Sheet …> / </Sheet> token in SOURCE ORDER, tracks the running Sheet nesting
 * depth, and asserts BOTH <ConfirmDialog>s open while depth >= 1 (strictly inside
 * an open Sheet), that the tag stream is well-formed (depth never negative, ends
 * at 0), and that the ENTIRE returned JSX is root-wrapped by a Sheet (the first
 * structural tag opens a Sheet; the last one closes it) — never a fragment.
 *
 * Part B attacks the disconnect toast from the OTHER side than the implementor's
 * single anchored regex: EVERY occurrence of setToast("Partner disconnected") in
 * team.tsx must be enclosed by a deferAfterDismiss( … ) call (catches a second,
 * un-deferred straggler the impl's `.not.toMatch(<one arrow form>)` would miss),
 * and the eager-eval anti-pattern deferAfterDismiss(setToast(…)) (defers undefined,
 * fires the toast synchronously) must be absent.
 *
 * Fails-on-revert: restoring either confirm to a root sibling after </Sheet>
 * drops its walk-depth to 0 (Part A RED); reverting the toast to the synchronous
 * setToast drops it out of any deferAfterDismiss enclosure (Part B RED).
 *
 * Append-only; source-grep for the same reason the implementor's is (both
 * MemberDetailSheet.tsx and team.tsx pull heavy native deps the node/ts-jest env
 * cannot render). I-PROPOSED-1369-TEAM-MEMBER-CONFIRM-NESTED-IN-SHEET.
 */

import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

const SHEET_SRC = fs.readFileSync(
  path.resolve(__dirname, "../MemberDetailSheet.tsx"),
  "utf8",
);
const TEAM_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../../../app/brand/[id]/team.tsx"),
  "utf8",
);

// Strip block + line comments so structural tag walking reads JSX only (a doc /
// invariant comment legitimately NAMES <Sheet>/<ConfirmDialog>). `[^:]` guard
// keeps https:// intact — mirrors the implementor test's convention.
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

type Tok = { kind: "sheetOpen" | "sheetClose" | "confirm"; index: number };

/**
 * Interleave every <Sheet …>/<\/Sheet>/<ConfirmDialog tag in source order.
 * `<Sheet[\s>]` matches only an OPENING Sheet tag (never `</Sheet>`, whose
 * "Sheet" is preceded by `/`) and never `<SheetMobilePanelInner` (requires a
 * whitespace/`>` immediately after "Sheet"). ConfirmDialog is self-closing here,
 * so it does not affect Sheet depth — we only record WHERE it opens.
 */
const tokenize = (code: string): Tok[] => {
  const re = /<\/Sheet>|<Sheet[\s>]|<ConfirmDialog[\s/>]/g;
  const toks: Tok[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const t = m[0];
    if (t === "</Sheet>") toks.push({ kind: "sheetClose", index: m.index });
    else if (t.startsWith("<Sheet")) toks.push({ kind: "sheetOpen", index: m.index });
    else toks.push({ kind: "confirm", index: m.index });
  }
  return toks;
};

describe("#1369 tester — MemberDetailSheet confirms are BALANCED-DEPTH inside an OPEN <Sheet>", () => {
  const code = stripComments(SHEET_SRC);
  const toks = tokenize(code);

  test("A-1 the JSX tag stream is well-formed (depth never negative, ends balanced at 0)", () => {
    let depth = 0;
    let minDepth = 0;
    for (const t of toks) {
      if (t.kind === "sheetOpen") depth += 1;
      else if (t.kind === "sheetClose") depth -= 1;
      if (depth < minDepth) minDepth = depth;
    }
    expect(minDepth).toBeGreaterThanOrEqual(0); // no stray </Sheet> before its open
    expect(depth).toBe(0); // every <Sheet> is closed
  });

  test("A-2 BOTH <ConfirmDialog>s open while Sheet nesting depth >= 1 (strictly inside an open Sheet)", () => {
    const confirmDepths: number[] = [];
    let depth = 0;
    for (const t of toks) {
      if (t.kind === "sheetOpen") depth += 1;
      else if (t.kind === "sheetClose") depth -= 1;
      else confirmDepths.push(depth); // depth AFTER accounting for opens/closes seen up to here
    }
    expect(confirmDepths).toHaveLength(2);
    for (const d of confirmDepths) {
      expect(d).toBeGreaterThanOrEqual(1);
    }
  });

  test("A-3 the returned JSX is ROOT-WRAPPED by a Sheet — first structural tag opens a Sheet, last closes one", () => {
    expect(toks.length).toBeGreaterThanOrEqual(3); // >=1 open, >=1 close, >=1 confirm
    expect(toks[0].kind).toBe("sheetOpen");
    expect(toks[toks.length - 1].kind).toBe("sheetClose");
    // Depth returns to 0 for the FIRST time only at the final token => exactly
    // one top-level Sheet encloses the whole subtree (no sibling root Sheet, no
    // fragment root that would let a confirm escape to the screen-root VC).
    let depth = 0;
    let firstZeroAt = -1;
    toks.forEach((t, i) => {
      if (t.kind === "sheetOpen") depth += 1;
      else if (t.kind === "sheetClose") depth -= 1;
      if (depth === 0 && firstZeroAt === -1) firstZeroAt = i;
    });
    expect(firstZeroAt).toBe(toks.length - 1);
  });
});

describe("#1369 tester — every disconnect toast is deferAfterDismiss-enclosed (no synchronous straggler)", () => {
  const teamCode = stripComments(TEAM_SRC);
  const TOAST = 'setToast("Partner disconnected")';

  const allIndices = (hay: string, needle: string): number[] => {
    const out: number[] = [];
    let i = hay.indexOf(needle);
    while (i !== -1) {
      out.push(i);
      i = hay.indexOf(needle, i + 1);
    }
    return out;
  };

  test("B-1 the disconnect toast still exists (guard against silent removal/rename)", () => {
    expect(allIndices(teamCode, TOAST).length).toBeGreaterThanOrEqual(1);
  });

  test("B-2 EVERY occurrence of the disconnect toast is wrapped by a deferAfterDismiss( … ) enclosure", () => {
    const indices = allIndices(teamCode, TOAST);
    const OPEN = "deferAfterDismiss(";
    for (const at of indices) {
      // Find the nearest preceding deferAfterDismiss( and, by PAREN BALANCE
      // (the deferred callback is itself an arrow `() =>`, so a naive "no ) "
      // check is wrong), compute that call's matching close paren. The toast
      // call must sit strictly inside that span.
      const callStart = teamCode.lastIndexOf(OPEN, at);
      expect(callStart).toBeGreaterThan(-1); // RED on the synchronous revert (no defer at all)
      const parenOpen = callStart + OPEN.length - 1; // index of the '('
      let depth = 0;
      let matchClose = -1;
      for (let i = parenOpen; i < teamCode.length; i++) {
        const c = teamCode[i];
        if (c === "(") depth += 1;
        else if (c === ")") {
          depth -= 1;
          if (depth === 0) {
            matchClose = i;
            break;
          }
        }
      }
      expect(matchClose).toBeGreaterThan(-1);
      expect(at).toBeGreaterThan(parenOpen);
      expect(at).toBeLessThan(matchClose);
    }
  });

  test("B-3 the eager-eval anti-pattern deferAfterDismiss(setToast(…)) is ABSENT (toast must be a thunk, not pre-invoked)", () => {
    expect(teamCode).not.toMatch(/deferAfterDismiss\(\s*setToast\(/);
  });
});
