/**
 * issue #1369 [team-confirm-nested] — Tier 2 of #1342. Implementor happy-path
 * regression (source-grep; every assertion FAILS-ON-REVERT).
 *
 * Part A (nesting): MemberDetailSheet's two ConfirmDialogs — "Remove from team" /
 * "Revoke invitation" (confirmVisible) and the ORCH-1384 owner "Disconnect
 * partner" (disconnectConfirmVisible) — used to render as ROOT SIBLINGS of the
 * component's own <Sheet> (after the sheet's close tag, inside an outer
 * fragment). On the business app's iOS New Architecture the confirm's native
 * <Modal> then contends for the screen-root VC the open sheet's modal already
 * holds -> UIKit silently refuses the second modal ("already presenting") -> the
 * confirm never appears (an un-completable dead-end). Identical class to
 * #1338 / #1356 / #1360.
 *
 * Fix (b) NESTED: BOTH ConfirmDialogs now render as JSX descendants of the
 * <Sheet> subtree, and the returned root JSX is <Sheet>, not <>. Each confirm
 * then presents from the sheet's own modal VC (which iOS stacks); Cancel returns
 * to the still-open sheet; the disconnect confirm's inline errorMessage /
 * confirmLoading / closeDisabled require the sheet to persist underneath (so
 * defer-until-dismissed is deliberately NOT used here).
 *
 * Part B (folded-in D-1): the team screen's "Partner disconnected" success Toast
 * fired in the SAME tick as onClose() -> a close->toast race (same class as
 * #1360). It is now deferred through the shipped deferAfterDismiss helper.
 *
 * Coverage is source-grep: MemberDetailSheet.tsx and team.tsx both pull heavy
 * native deps the node/ts-jest env cannot render, so the render-side wiring is
 * asserted on the file text — the exact convention of
 * orch_1384_team_partner_disconnect.source.test.ts, which resolves the [id] glob
 * path by string.
 *
 * I-PROPOSED-1369-TEAM-MEMBER-CONFIRM-NESTED-IN-SHEET (Tier-2 sibling of
 * I-PROPOSED-1356-COVER-FEEDBACK-NESTED-IN-SHEET).
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

// Strip block + line comments so the structural index assertions read CODE only
// (a doc/invariant comment may legitimately NAME <Sheet>/ConfirmDialog while the
// JSX never does). The `[^:]` guard keeps `https://`-style URLs intact.
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const countOf = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

const allIndicesOf = (haystack: string, needle: string): number[] => {
  const out: number[] = [];
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = haystack.indexOf(needle, i + 1);
  }
  return out;
};

describe("#1369 Part A — MemberDetailSheet ConfirmDialogs nested INSIDE <Sheet>", () => {
  const code = stripComments(SHEET_SRC);
  const sheetOpen = code.indexOf("<Sheet ");
  const sheetClose = code.indexOf("</Sheet>");

  test("T-1 the component renders a real <Sheet> subtree (open before close)", () => {
    expect(sheetOpen).toBeGreaterThan(-1);
    expect(sheetClose).toBeGreaterThan(sheetOpen);
  });

  test("T-2 exactly two <ConfirmDialog>s, BOTH descendants of the <Sheet> subtree", () => {
    expect(countOf(code, "<ConfirmDialog")).toBe(2);
    const indices = allIndicesOf(code, "<ConfirmDialog");
    expect(indices).toHaveLength(2);
    for (const i of indices) {
      // Between the sheet's open tag and its close tag == a descendant.
      expect(i).toBeGreaterThan(sheetOpen);
      expect(i).toBeLessThan(sheetClose);
    }
  });

  test("T-3 ZERO <ConfirmDialog> after </Sheet> (the reverted root-sibling shape)", () => {
    expect(code.slice(sheetClose)).not.toContain("<ConfirmDialog");
  });

  test("T-4 the returned root JSX is <Sheet>, NOT an outer fragment <>", () => {
    expect(code).toMatch(/return\s*\(\s*<Sheet\b/);
    expect(code).not.toMatch(/return\s*\(\s*<>/);
  });

  test("T-5 the nesting invariant is documented in-file (protective comment)", () => {
    expect(SHEET_SRC).toContain(
      "I-PROPOSED-1369-TEAM-MEMBER-CONFIRM-NESTED-IN-SHEET",
    );
  });

  test("preserved — both confirms keep their exact wiring after the move", () => {
    // The move must not have altered any prop/state/handler (SPEC §4: zero
    // changes to confirmVisible / disconnectConfirmVisible / handlers / copy).
    expect(SHEET_SRC).toContain("visible={confirmVisible}");
    expect(SHEET_SRC).toContain("visible={disconnectConfirmVisible}");
    expect(SHEET_SRC).toContain('title="Disconnect this partner?"');
    expect(SHEET_SRC).toContain(
      "confirmLoading={disconnectMutation.isPending}",
    );
    expect(SHEET_SRC).toContain("errorMessage={disconnectError}");
  });
});

describe("#1369 Part B (D-1) — the disconnect success toast is DEFERRED, not synchronous", () => {
  const teamCode = stripComments(TEAM_SRC);

  test("T-6 the toast fires through the shipped deferAfterDismiss helper (imported, not reimplemented)", () => {
    expect(TEAM_SRC).toContain(
      'import { deferAfterDismiss } from "../../../src/utils/deferAfterDismiss"',
    );
    expect(teamCode).toMatch(
      /deferAfterDismiss\(\s*\(\)\s*=>\s*setToast\("Partner disconnected"\)\s*\)/,
    );
  });

  test("T-7 the toast is NOT fired synchronously in onPartnerDisconnected (the #1360-class race)", () => {
    // The reverted wiring: onPartnerDisconnected={() => setToast("Partner disconnected")}
    expect(teamCode).not.toMatch(
      /onPartnerDisconnected=\{\(\)\s*=>\s*setToast\("Partner disconnected"\)\}/,
    );
  });
});
