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

  // ---- (A2) the workflow job ENFORCES the new invariant, not the old --------
  test("A2 — the ORCH-1136 workflow job name references the new invariant, never the old", () => {
    const wf = fs.readFileSync(WORKFLOW_PATH, "utf8");
    // Isolate the orch-1136 job block (up to the next top-level job key).
    const jobStart = wf.indexOf("orch-1136-biz-web-shell-bugs:");
    expect(jobStart).toBeGreaterThan(0);
    const after = wf.slice(jobStart);
    const nextJob = after.slice(1).search(/\n {2}[a-z0-9-]+:\n/);
    const jobBlock = nextJob >= 0 ? after.slice(0, nextJob + 1) : after;
    expect(jobBlock).toContain(NEW_NAME);
    expect(jobBlock.includes(OLD_NAME)).toBe(false);
    // The sibling breathing-gap step must still be present (untouched).
    expect(jobBlock).toContain("i-proposed-web-topbar-breathing-gap.mjs");
  });

  // ---- (B1) DIAG toast is forced VISIBLE inside a Platform.OS web fence -----
  test("B1 — event ⋯ DIAG forces a web-visible toast inside a Platform.OS==='web' fence", () => {
    const src = fs.readFileSync(EVENT_INDEX_PATH, "utf8");
    const diagStart = src.indexOf("[ORCH-1136-DIAG]");
    const diagEnd = src.indexOf("[ORCH-1136-DIAG END]");
    expect(diagStart).toBeGreaterThan(0);
    expect(diagEnd).toBeGreaterThan(diagStart);
    const diagBlock = src.slice(diagStart, diagEnd);
    // (1) web-fenced — native control flow byte-identical.
    expect(diagBlock).toMatch(/Platform\.OS\s*===\s*["']web["']/);
    // (2) forces a VISIBLE toast (the never-silent-on-web guarantee).
    expect(diagBlock).toMatch(/setToast\(\s*\{[\s\S]*?visible:\s*true/);
    // (3) the DIAG toast message is the discriminator copy.
    expect(diagBlock).toContain("[DIAG] ⋯ tapped — brand=");
  });

  // ---- (B2) the handler has NO silent path: every branch produces UI --------
  test("B2 — handleManageOpen on web always surfaces UI (DIAG toast precedes the real branch, real branch also toasts/opens)", () => {
    const src = fs.readFileSync(EVENT_INDEX_PATH, "utf8");
    // Extract the handleManageOpen body.
    const handlerStart = src.indexOf("const handleManageOpen = useCallback");
    expect(handlerStart).toBeGreaterThan(0);
    const handlerEnd = src.indexOf("const handleManageClose", handlerStart);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const body = src.slice(handlerStart, handlerEnd);

    // The web DIAG block (forced visible toast) precedes the real brand check.
    const diagIdx = body.indexOf("[ORCH-1136-DIAG]");
    const brandNullBranchIdx = body.indexOf("if (brand === null)");
    expect(diagIdx).toBeGreaterThan(0);
    expect(brandNullBranchIdx).toBeGreaterThan(diagIdx);

    // The real brand===null branch surfaces a visible toast (never silent)…
    const nullBranch = body.slice(brandNullBranchIdx);
    expect(nullBranch).toContain("Loading brand…");
    // …and the resolved-brand path opens the menu.
    expect(body).toContain("setManageMenuVisible(true)");
  });
});
