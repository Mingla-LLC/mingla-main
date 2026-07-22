/**
 * ORCH-1136 R2 [biz-web shell bugs] — TESTER adversarial regression gate.
 *
 * DIFFERENT ANGLE than the implementor's happy-path
 * (`orch1136r2TopSheetOverlayNoFixed.gate.test.ts`, which asserts the TopSheet
 * source state + the inverted gate's exit-0 + the DIAG marker presence).
 *
 * This test attacks two seams the happy-path does NOT cover:
 *
 *  (A) DANGLING-OLD-INVARIANT ENFORCEMENT. SC-6 requires that NO active
 *      gate/workflow ENFORCEMENT path still references the round-1 invariant
 *      name `I-PROPOSED-TOPSHEET-WEB-VIEWPORT-ANCHOR`. The retarget renamed it
 *      to `I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED`. A stale enforcement
 *      reference (a gate label that PRINTS the old name, or a workflow job
 *      `name:` that ENFORCES the old name) would mean CI still advertises a
 *      retired invariant. Round-1 HISTORICAL artifacts (World Map, round-1
 *      SPEC/TEST) and DESCRIPTIVE `SUPERSEDES` mentions are allowed — only
 *      enforcement-path printed labels are forbidden. Fails-on-revert: if the
 *      gate's printed label is reverted to the old name, this test goes red.
 *
 *  (B) DIAG CONST #1 CONTRACT (no silent no-op). Const #1 demands the event ⋯
 *      tap is NEVER a silent no-op on web. The DIAG must be (1) web-fenced
 *      (`Platform.OS === "web"`) so native control flow is byte-identical,
 *      (2) emit a web-VISIBLE toast (`setToast(... visible: true ...)`) inside
 *      that fence, and (3) PRECEDE — not replace — the real brand branch.
 *      The implementor's T-4 only checks marker presence + ordering of the
 *      marker vs the real branch; it does NOT assert the toast is forced
 *      visible inside the web fence, nor that the fence is a `Platform.OS`
 *      web gate. This locks the never-silent-on-web contract. Fails-on-revert:
 *      drop the `visible: true` from the DIAG toast, or unfence it, → red.
 *
 * Append-only; modifies no existing test file.
 */

import * as fs from "fs";
import * as path from "path";

const BUSINESS_ROOT = path.resolve(__dirname, "..", "..");
const REPO_ROOT = path.resolve(BUSINESS_ROOT, "..");

const GATE_PATH = path.join(
  REPO_ROOT,
  ".github",
  "scripts",
  "strict-grep",
  "i-proposed-topsheet-web-viewport-anchor.mjs",
);
const WORKFLOW_PATH = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "strict-grep-mingla-business.yml",
);
// [ORCH-1062] ORCH-1383/1399 moved per-gate enforcement from workflow jobs into
// the MANIFEST batch (run-batch.mjs). The gate's enforcement wiring now lives here.
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  ".github",
  "scripts",
  "strict-grep",
  "MANIFEST.json",
);
const EVENT_INDEX_PATH = path.join(
  BUSINESS_ROOT,
  "app",
  "event",
  "[id]",
  "index.tsx",
);

const OLD_NAME = "I-PROPOSED-TOPSHEET-WEB-VIEWPORT-ANCHOR";
const NEW_NAME = "I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED";

describe("ORCH-1136 R2 — adversarial: no dangling old invariant + DIAG Const#1 contract", () => {
  // ---- (A1) gate's PRINTED labels carry only the new name -------------------
  test("A1 — the strict-grep gate prints ONLY the new invariant name in its console output", () => {
    const src = fs.readFileSync(GATE_PATH, "utf8");
    // Every console.log / console.error label must use the NEW name.
    const logLines = src
      .split("\n")
      .filter((l) => /console\.(log|error)/.test(l) || /\[I-PROPOSED-/.test(l));
    const printedOldName = logLines.some((l) => l.includes(OLD_NAME));
    expect(printedOldName).toBe(false);
    // And the gate must print the new name at least once (sanity: it is wired).
    expect(src).toContain(NEW_NAME);
  });

  // ---- (A2) the gate's ENFORCEMENT (MANIFEST batch) carries the new name -----
  test("A2 — the ORCH-1136 gate enforcement (MANIFEST batch) references the new invariant, never the old", () => {
    // [ORCH-1062 drift-update] ORCH-1383/1399 consolidated the per-gate
    // strict-grep workflow JOBS into MANIFEST.json + run-batch.mjs — the
    // workflow header now states "The gate list is NOT in this file any more".
    // The dedicated `orch-1136-biz-web-shell-bugs:` job no longer exists;
    // enforcement is the MANIFEST entry that runs the gate .mjs under a batch.
    // Re-point SC-6 to the current enforcement path: (a) the gate is wired via
    // MANIFEST under the orch-1136 jobKey, and (b) the gate's own enforcement
    // OUTPUT names ONLY the new invariant (the old name may survive only in a
    // descriptive "Supersedes" comment, which is allowed per SC-6).
    const manifest = fs.readFileSync(MANIFEST_PATH, "utf8");
    expect(manifest).toContain('"orch-1136-biz-web-shell-bugs"');
    expect(manifest).toContain("i-proposed-topsheet-web-viewport-anchor.mjs");
    // The sibling breathing-gap gate must still be wired.
    expect(manifest).toContain("i-proposed-web-topbar-breathing-gap.mjs");
    // The gate's ENFORCEMENT output (console / OK[ / FAIL[ labels) names only
    // the NEW invariant — no dangling old-name enforcement path.
    const gate = fs.readFileSync(GATE_PATH, "utf8");
    const enforcementLines = gate
      .split("\n")
      .filter((l) => /console\.(log|error)|\bOK \[|\bFAIL \[/.test(l));
    expect(enforcementLines.some((l) => l.includes(NEW_NAME))).toBe(true);
    expect(enforcementLines.some((l) => l.includes(OLD_NAME))).toBe(false);
  });

  // ---- (B1) manage tap forces a VISIBLE toast when brand is unresolved ------
  test("B1 — event ⋯ handleManageOpen forces a web-visible toast when brand is unresolved (never-silent Const#1)", () => {
    // [ORCH-1062 pin-fix] The `[ORCH-1136-DIAG]` instrument was REAPED at CLOSE
    // (DIAG markers are scoped + orchestrator-reaped). The never-silent Const#1
    // contract it probed survives in the REAL handleManageOpen (its own comment:
    // "ORCH-1136 F-2: never a silent dead tap (Const #1)"): brand===null forces
    // `setToast({ visible: true, ... })`. Assert the surviving real enforcement.
    const src = fs.readFileSync(EVENT_INDEX_PATH, "utf8");
    const handlerStart = src.indexOf("const handleManageOpen = useCallback");
    expect(handlerStart).toBeGreaterThan(0);
    const handlerEnd = src.indexOf("const handleManageClose", handlerStart);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const body = src.slice(handlerStart, handlerEnd);
    const nullBranchIdx = body.indexOf("if (brand === null)");
    expect(nullBranchIdx).toBeGreaterThan(0);
    const nullBranch = body.slice(nullBranchIdx);
    // forces a VISIBLE toast (the never-silent guarantee).
    expect(nullBranch).toMatch(/setToast\(\s*\{[\s\S]*?visible:\s*true/);
    expect(nullBranch).toContain("Loading brand…");
  });

  // ---- (B2) the handler has NO silent path: every branch produces UI --------
  test("B2 — handleManageOpen always surfaces UI (every branch toasts/opens, no silent path)", () => {
    const src = fs.readFileSync(EVENT_INDEX_PATH, "utf8");
    // Extract the handleManageOpen body.
    const handlerStart = src.indexOf("const handleManageOpen = useCallback");
    expect(handlerStart).toBeGreaterThan(0);
    const handlerEnd = src.indexOf("const handleManageClose", handlerStart);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const body = src.slice(handlerStart, handlerEnd);

    // [ORCH-1062 pin-fix] Removed the reaped-`[ORCH-1136-DIAG]`-ordering
    // assertions; the never-silent contract is enforced by the real branches.
    // The real brand===null branch surfaces a visible toast (never silent)…
    const brandNullBranchIdx = body.indexOf("if (brand === null)");
    expect(brandNullBranchIdx).toBeGreaterThan(0);
    const nullBranch = body.slice(brandNullBranchIdx);
    expect(nullBranch).toContain("Loading brand…");
    // …and the resolved-brand path opens the menu.
    expect(body).toContain("setManageMenuVisible(true)");
  });
});
