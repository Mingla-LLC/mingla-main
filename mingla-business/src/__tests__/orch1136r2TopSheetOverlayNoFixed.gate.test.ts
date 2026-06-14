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

  // ---- T-4: the event ⋯ DIAG discriminator is bound (web-visible) ------------
  test("T-4 — event ⋯ handleManageOpen carries the [ORCH-1136-DIAG] web-visible discriminator", () => {
    const src = fs.readFileSync(EVENT_INDEX_PATH, "utf8");
    expect(src).toContain("[ORCH-1136-DIAG]");
    expect(src).toContain("[ORCH-1136-DIAG END]");
    // The discriminator surfaces the brand-null state and forces a web toast.
    expect(src).toContain("[DIAG] ⋯ tapped — brand=");
    // It is web-fenced (native control flow byte-identical) and precedes the
    // real brand===null branch.
    const diagIdx = src.indexOf("[ORCH-1136-DIAG]");
    const realBranchIdx = src.indexOf(
      'message: "Loading brand… tap again in a moment."',
    );
    expect(diagIdx).toBeGreaterThan(0);
    expect(realBranchIdx).toBeGreaterThan(diagIdx);
  });
});
