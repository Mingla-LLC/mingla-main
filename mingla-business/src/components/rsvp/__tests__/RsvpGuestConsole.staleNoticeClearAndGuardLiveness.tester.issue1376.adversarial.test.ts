/**
 * #1376 [rsvp-console-modal-fix] — TESTER ADVERSARIAL regression (Tier 2 of #1342,
 * FINAL group). A DIFFERENT ANGLE than the two implementor source-grep suites.
 *
 * The implementor's suites assert (Bug 1) the `deferAfterDismiss` import + the
 * close-then-defer ORDERING + the guard STRING's presence, and (Bug 2) the nested
 * `<Toast>` structure + the approve/deny `onError` → `setSheetNotice` routing. They
 * do NOT verify two correctness properties the fix actually depends on — both are a
 * silent-failure trap if they regress while every implementor assertion stays green:
 *
 *  A. STALE-NOTICE CLEAR-ON-(RE)SELECT (SPEC §4 Bug 2: "Clear sheetNotice to null
 *     whenever a guest is (re)selected/the sheet opens, so a stale notice never
 *     re-appears"). The nested error `<Toast>` is driven by `sheetNotice`; if opening
 *     a guest's sheet does NOT first clear it, an approve/deny error raised for guest
 *     X re-appears over a freshly-opened sheet for guest Y. The console routes the row
 *     body's `onPress` through `handleSelectGuest`, which clears the notice BEFORE
 *     setting the selected guest. NEITHER implementor suite references `handleSelectGuest`
 *     or the clear-before-open ordering, nor that the row `onPress` stopped calling
 *     `setSelectedGuest` directly.
 *
 *  B. SC-1b GUARD REF-SYNC LIVENESS. The deferred remove-confirm opens only if
 *     `selectedGuestRef.current === null`. That guard is only meaningful if the ref is
 *     kept in lockstep with `selectedGuest` via a `useEffect`. The implementor suite
 *     asserts the guard STRING exists — but a revert that keeps the `=== null` string
 *     yet drops the `useEffect` sync leaves the ref frozen at its mount value (null),
 *     so the guard ALWAYS passes and the re-open protection is DEAD. This suite pins
 *     the live `selectedGuestRef.current = selectedGuest` assignment inside a
 *     `useEffect`, and that the guard GATES `setRemoveTarget` inside the deferred arrow.
 *
 * Layer: source-grep over comment-stripped source — the RsvpGuestConsole host carries
 * heavy native deps the node/ts-jest env cannot render, so (exactly like the accepted
 * #1356 / #1360 / #1369 posture, and the two sibling implementor suites) the wiring is
 * asserted over source TEXT. The SC-1 runtime behaviour (confirm presents after the
 * sheet closes, zero UIKit "already presenting") was proven live-fire on the iOS sim by
 * the tester and is captured in the QA verdict, not here.
 *
 * FAILS-ON-REVERT: reverting the fix to origin/main removes `handleSelectGuest`, the
 * `selectedGuestRef` `useEffect` sync, and the guarded deferred callback, and restores
 * the row `onPress={() => setSelectedGuest(g)}` — every assertion below goes RED.
 *
 * I-PROPOSED-1376-RSVP-GUEST-CONSOLE-SECOND-MODAL-NESTED-OR-DEFERRED (Clauses A + B).
 * [TEST-APPEND-ONLY]
 */
import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, test } from "@jest/globals";

// src/components/rsvp/__tests__ → up one → the rsvp component dir.
const RSVP_DIR = join(__dirname, "..");
const read = (rel: string): string => readFileSync(join(RSVP_DIR, rel), "utf8");

// Strip block + line comments so the doc comments (which legitimately name
// handleSelectGuest / setSheetNotice / selectedGuestRef in prose) can never satisfy
// a CODE assertion. The `[^:]` guard keeps `https://` intact.
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Balanced-brace slice of the `{ ... }` block whose opening brace is the first `{`
 * at/after `marker`. Template-literal `${...}` braces stay balanced.
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

const consoleCode = stripComments(read("RsvpGuestConsole.tsx"));

describe("#1376 tester-adversarial A — stale approve/deny notice is cleared BEFORE a sheet (re)opens", () => {
  test("opening a guest routes through handleSelectGuest (a dedicated opener), not a bare setSelectedGuest", () => {
    // A revert restores the pre-fix row opener `onPress={() => setSelectedGuest(g)}`,
    // which never clears the notice. On the fixed branch the row body opens the sheet
    // via handleSelectGuest and the bare direct opener is GONE.
    expect(consoleCode).toMatch(/onPress=\{\(\) => handleSelectGuest\(g\)\}/);
    expect(consoleCode).not.toMatch(/onPress=\{\(\) => setSelectedGuest\(g\)\}/);
  });

  test("handleSelectGuest clears the sheet notice (setSheetNotice(null)) BEFORE opening the sheet", () => {
    const block = sliceHandler(consoleCode, "const handleSelectGuest = useCallback");
    const clearIdx = block.indexOf("setSheetNotice(null)");
    const openIdx = block.indexOf("setSelectedGuest(");
    // The notice is cleared...
    expect(clearIdx).toBeGreaterThanOrEqual(0);
    // ...and the sheet opens...
    expect(openIdx).toBeGreaterThanOrEqual(0);
    // ...with the clear STRICTLY BEFORE the open, so a prior guest's error toast can
    // never bleed onto the freshly-opened sheet (SPEC §4 Bug 2 "cleared on (re)select").
    expect(clearIdx).toBeLessThan(openIdx);
  });
});

describe("#1376 tester-adversarial B — the SC-1b re-open guard reads a LIVE ref, not a frozen one", () => {
  test("selectedGuestRef is kept in lockstep with selectedGuest via a useEffect sync", () => {
    // The live assignment (assignment `=`, NOT the `=== null` comparison the guard uses).
    expect(consoleCode).toMatch(/selectedGuestRef\.current = selectedGuest\b/);
    // ...and that assignment lives INSIDE a useEffect keyed on [selectedGuest] — without
    // this, the ref freezes at its mount value and the SC-1b guard is permanently null
    // (always true) → the re-open protection silently dies while the guard STRING remains.
    expect(consoleCode).toMatch(
      /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]{0,120}selectedGuestRef\.current = selectedGuest[\s\S]{0,60}\},\s*\[selectedGuest\]\s*\)/,
    );
  });

  test("the deferred callback GATES setRemoveTarget behind the ref === null guard", () => {
    const block = sliceHandler(consoleCode, "const handleSheetRemove = useCallback");
    const deferIdx = block.indexOf("deferAfterDismiss(");
    const guardIdx = block.indexOf("selectedGuestRef.current === null");
    const removeIdx = block.indexOf("setRemoveTarget(");
    expect(deferIdx).toBeGreaterThanOrEqual(0);
    // The guard sits AFTER the defer opener and BEFORE setRemoveTarget — i.e. it gates
    // the confirm inside the deferred arrow (not merely co-present in the handler).
    expect(guardIdx).toBeGreaterThan(deferIdx);
    expect(removeIdx).toBeGreaterThan(guardIdx);
  });
});
