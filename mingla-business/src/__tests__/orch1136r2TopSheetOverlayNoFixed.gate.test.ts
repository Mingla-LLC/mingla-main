/**
 * ORCH-1136 R2 [biz-web shell bugs] — IMPLEMENTOR happy-path regression gate.
 *
 * Round 1 shipped a `position:'fixed'` web overlay on the TopSheet, which
 * Seth's authed runtime proved was a NET REGRESSION: `position:'fixed'` is
 * captured by transform/filter/backdrop-filter ancestors in the real Home/Hub
 * shell → the scrim collapses (see-through) and the panel short-anchors. R2
 * REVERTS the overlay root to bare `StyleSheet.absoluteFill` (position:absolute,
 * containing-block-immune, harness-proven correct on both pages) and INVERTS
 * the strict-grep gate so CI now FAILS on `position:'fixed'` instead of
 * requiring it.
 *
 * This is the STRUCTURAL safeguard (§9): it locks the reverted overlay + the
 * inverted gate in source. SC-1/SC-2/SC-3/SC-4 (authed/native runtime) are
 * Seth-owned. SC-5/SC-6 (CI) are locked here.
 *
 * Fails-on-revert: re-introducing `position:'fixed'` on the TopSheet overlay
 * root (the round-1 regression) makes the inverted gate exit non-zero, and the
 * `execFileSync` below THROWS → this test FAILS. Proven by true line-deletion
 * of the revert (re-adding the fixed construct), recorded in the implement
 * report.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const BUSINESS_ROOT = path.resolve(__dirname, "..", "..");
const REPO_ROOT = path.resolve(BUSINESS_ROOT, "..");
const TOPSHEET_PATH = path.join(
  BUSINESS_ROOT,
  "src",
  "components",
  "ui",
  "TopSheet.tsx",
);
const EVENT_INDEX_PATH = path.join(
  BUSINESS_ROOT,
  "app",
  "event",
  "[id]",
  "index.tsx",
);
const GATE_PATH = path.join(
  REPO_ROOT,
  ".github",
  "scripts",
  "strict-grep",
  "i-proposed-topsheet-web-viewport-anchor.mjs",
);

/**
 * Strip JS comments so we assert on EXECUTABLE code only — the reverted
 * TopSheet legitimately names `position:'fixed'` in its rationale comment to
 * explain WHY it is banned (mirrors the gate's own comment-stripping).
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("ORCH-1136 R2 TopSheet web overlay no-fixed gate", () => {
  // ---- T-1: overlay root reverted to bare absoluteFill (no executable fixed) -
  test("T-1 — TopSheet overlay root is StyleSheet.absoluteFill with no position:'fixed' in executable code", () => {
    const raw = fs.readFileSync(TOPSHEET_PATH, "utf8");
    const code = stripComments(raw);
    // The overlay root style must be bare absoluteFill.
    expect(code).toContain("style={StyleSheet.absoluteFill}");
    // The round-1 regression marker must NOT appear in executable code.
    expect(/position:\s*["']fixed["']/.test(code)).toBe(false);
    // The round-1 web-gated rootOverlayStyle ternary must be gone.
    expect(code).not.toContain("rootOverlayStyle");
  });

  // ---- T-2: panel height reverted to the Dimensions snapshot (no live split) -
  test("T-2 — panel height uses Dimensions.get('window').height (round-1 live-window split reverted)", () => {
    const code = stripComments(fs.readFileSync(TOPSHEET_PATH, "utf8"));
    expect(code).toContain('const screenHeight = Dimensions.get("window").height;');
    // The round-1 web/native height ternary must be gone.
    expect(code).not.toMatch(
      /screenHeight\s*=\s*\n?\s*Platform\.OS\s*===\s*["']web["']\s*\?\s*windowHeight/,
    );
  });

  // ---- T-3: the inverted strict-grep gate PASSES on the reverted source ------
  // This is the load-bearing fails-on-revert assertion: re-adding the
  // position:'fixed' overlay makes the gate exit non-zero → execFileSync throws
  // → this test fails.
  test("T-3 — inverted i-proposed-topsheet gate exits 0 on the reverted TopSheet", () => {
    expect(fs.existsSync(GATE_PATH)).toBe(true);
    const run = (): string =>
      execFileSync("node", [GATE_PATH], { encoding: "utf8" });
    expect(run).not.toThrow();
    expect(run()).toContain("I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED");
  });

  // ---- T-4: the event ⋯ manage tap is never a silent no-op (Const#1) ---------
  test("T-4 — event ⋯ handleManageOpen surfaces UI in every branch (never a silent no-op)", () => {
    // [ORCH-1062 pin-fix] The temporary `[ORCH-1136-DIAG]` instrument was REAPED
    // at ORCH-1136 CLOSE (DIAG markers are scoped + orchestrator-reaped). The
    // never-silent-on-web guarantee it probed is now enforced by the REAL
    // handleManageOpen (whose own comment reads "ORCH-1136 F-2: never a silent
    // dead tap (Const #1)"): brand===null forces a VISIBLE toast, and the
    // resolved path opens the menu — so the tap is never a silent no-op. Assert
    // the surviving real handler instead of the reaped diagnostic marker.
    const src = fs.readFileSync(EVENT_INDEX_PATH, "utf8");
    const handlerStart = src.indexOf("const handleManageOpen = useCallback");
    expect(handlerStart).toBeGreaterThan(0);
    const handlerEnd = src.indexOf("const handleManageClose", handlerStart);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const body = src.slice(handlerStart, handlerEnd);
    // brand-not-yet-resolved → forced VISIBLE toast (never silent).
    const nullBranchIdx = body.indexOf("if (brand === null)");
    expect(nullBranchIdx).toBeGreaterThan(0);
    const nullBranch = body.slice(nullBranchIdx);
    expect(nullBranch).toMatch(/setToast\(\s*\{[\s\S]*?visible:\s*true/);
    expect(nullBranch).toContain("Loading brand… tap again in a moment.");
    // resolved-brand path opens the manage menu.
    expect(body).toContain("setManageMenuVisible(true)");
  });
});
