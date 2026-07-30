/**
 * #1376 [rsvp-console-modal-fix] — Tier 2 of #1342 (FINAL group). Implementor
 * happy-path regression, BUG 1: the remove-confirm close-then-DEFER wiring
 * (SPEC §7 T-1/T-2 + §9, SC-1/SC-1b).
 *
 * RsvpGuestConsole is a full-screen host console that carries heavy native deps
 * the node/ts-jest env cannot render, so — exactly like
 * paymentConfirmDefer.issue1360.test.ts / CoverPickerSheet.nestedToast.issue1356
 * — the wiring is asserted over SOURCE TEXT.
 *
 * Bug 1 (device-proven on the iOS sim, "already presenting" UIKit refusal):
 * `handleSheetRemove` did `setSelectedGuest(null); setRemoveTarget(g)` in the
 * SAME synchronous tick, so the sibling ConfirmDialog's native <Modal> tried to
 * present during the detail sheet's 280ms unmount window → iOS New-Arch dropped
 * it → the "Remove <name>?" confirm never appeared (un-completable dead-end).
 *
 * Fix (SPEC §4, defer NOT nest): close the sheet FIRST, then open the SHARED
 * remove ConfirmDialog only AFTER the sheet's modal has fully dismissed, via the
 * shipped `deferAfterDismiss` helper (#1360 — imported, not rebuilt), with the
 * SC-1b re-open guard (`selectedGuestRef.current === null`). The ConfirmDialog is
 * NOT nested because it is shared with the row-level Remove (no sheet open there).
 *
 * FAILS-ON-REVERT (SPEC §9): revert `handleSheetRemove` to the same-tick
 * `setSelectedGuest(null); setRemoveTarget(g)` shape and the wrapper is gone —
 * `deferAfterDismiss(` disappears from the handler (index -1) and `setRemoveTarget`
 * is no longer positioned after a defer → the ordering assertions go RED.
 *
 * I-PROPOSED-1376-RSVP-GUEST-CONSOLE-SECOND-MODAL-NESTED-OR-DEFERRED (Clause A).
 */
import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, test } from "@jest/globals";

// src/components/rsvp/__tests__ → up one → the rsvp component dir.
const RSVP_DIR = join(__dirname, "..");
const read = (rel: string): string => readFileSync(join(RSVP_DIR, rel), "utf8");

// Strip block + line comments so the doc comments (which name setRemoveTarget /
// deferAfterDismiss / selectedGuestRef in prose) can never satisfy or trip a code
// assertion. The `[^:]` guard keeps `https://` intact.
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Return the `{ ... }` block whose opening brace is the first `{` at/after
 * `marker`, via balanced-brace scanning. Template-literal `${...}` braces stay
 * balanced, so the scan terminates at the true block end.
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

describe("#1376 Bug 1 — remove-confirm is close-then-DEFERRED past sheet dismissal", () => {
  test("T-2 the console imports the shipped deferAfterDismiss helper (not a rebuilt one)", () => {
    expect(consoleCode).toMatch(
      /import \{ deferAfterDismiss \} from ".*utils\/deferAfterDismiss"/,
    );
  });

  test("T-1 handleSheetRemove closes the sheet FIRST, then DEFERS setRemoveTarget", () => {
    const block = sliceHandler(consoleCode, "const handleSheetRemove = useCallback");

    const closeIdx = block.indexOf("setSelectedGuest(null)");
    const deferIdx = block.indexOf("deferAfterDismiss(");
    const removeIdx = block.indexOf("setRemoveTarget(");

    // The sheet is closed first.
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    // The confirm is opened via a deferred callback...
    expect(deferIdx).toBeGreaterThan(closeIdx);
    // ...and the deferAfterDismiss wraps an arrow callback (not an eager call).
    expect(block).toMatch(/deferAfterDismiss\(\s*\(\)\s*=>/);
    // setRemoveTarget appears ONLY inside the deferred callback — i.e. strictly
    // AFTER the defer opener. A revert to the same-tick `setRemoveTarget(g)` puts
    // it before (or without) any defer → this ordering fails.
    expect(removeIdx).toBeGreaterThan(deferIdx);
  });

  test("SC-1b the deferred callback guards against a sheet re-opened within the window", () => {
    const block = sliceHandler(consoleCode, "const handleSheetRemove = useCallback");
    // Only present the confirm if no sheet is currently open (ref === null).
    expect(block).toMatch(/selectedGuestRef\.current === null/);
  });

  test("the row-level Remove path stays IMMEDIATE (no sheet open there — not deferred)", () => {
    // The Going-row Remove opener still sets the confirm target synchronously;
    // only the sheet path's timing was changed.
    expect(consoleCode).toMatch(/onPress=\{\(\) => setRemoveTarget\(g\)\}/);
  });
});
