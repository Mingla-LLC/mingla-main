/* eslint-disable import/first */
/**
 * ORCH-0862 / F-1 — tester adversarial regression test (AD-1).
 *
 * Different angle from IM-1: IM-1 proves the happy-path router.replace was
 * dropped. AD-1 proves the ERROR path was NOT also gutted in the same edit
 * — F-1 should preserve "Could not cancel event. Try again." on the catch
 * branch, the `setCancelSubmitting(true) / finally { setCancelSubmitting(false) }`
 * pessimistic-mutation wrap, AND the early returns for invalid state
 * (id===null, event===null).
 *
 * Bug class this guards against: a future "clean up" of the cancel handler
 * that also strips the error-path toast or the submitting wrap, leaving the
 * user with a silent failure (Const #3 violation).
 *
 * Fails-on-revert verification: structural assertions against the source
 * file. If the catch branch loses its toast, or if either early-return
 * guard is removed, or if the submitting state wrap is gone, the test
 * fails.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const SCREEN_SOURCE_PATH = join(__dirname, "..", "index.tsx");

describe("ORCH-0862 AD-1 — F-1 preserved the error-path UX (cancel handler)", () => {
  const source = readFileSync(SCREEN_SOURCE_PATH, "utf8");
  const handlerMatch = source.match(
    /handleCancelConfirm\s*=\s*useCallback\(\s*async[\s\S]*?\}\s*,\s*\[[^\]]*\]\s*\)\s*;/,
  );

  test("source extraction succeeds", () => {
    expect(handlerMatch).not.toBeNull();
  });

  const body = handlerMatch![0];

  test("error-path toast 'Could not cancel event. Try again.' is preserved", () => {
    // Strip comments so commented-out copy doesn't accidentally satisfy this.
    const stripped = body
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(stripped).toContain("Could not cancel event. Try again.");
  });

  test("catch branch is still present (Const #3 — no silent failure)", () => {
    expect(body).toMatch(/\}\s*catch\s*(\(|\{)/);
  });

  test("pessimistic submitting-state wrap (setCancelSubmitting(true) / finally setCancelSubmitting(false)) is preserved", () => {
    expect(body).toContain("setCancelSubmitting(true)");
    expect(body).toMatch(/finally\s*\{[^}]*setCancelSubmitting\(false\)[^}]*\}/);
  });

  test("id === null early return guard is preserved", () => {
    expect(body).toMatch(/if\s*\(\s*id\s*===\s*null\s*\)\s*return\s*;/);
  });

  test("event === null early return guard is preserved (inside isServerBackedEvent branch)", () => {
    expect(body).toMatch(/if\s*\(\s*event\s*===\s*null\s*\)\s*return\s*;/);
  });

  test("legacy client-side simulated-processing delay (cancelSleep) is preserved", () => {
    expect(body).toContain("cancelSleep(CANCEL_PROCESSING_MS)");
  });

  test("legacy client-side updateLifecycle call still flips status to cancelled", () => {
    // Status update must include both status:"cancelled" AND a cancelledAt timestamp.
    expect(body).toMatch(/status:\s*"cancelled"/);
    expect(body).toContain("cancelledAt");
    expect(body).toContain("new Date().toISOString()");
  });

  test("legacy client-side path still toasts about the B-cycle refund stub", () => {
    const stripped = body
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(stripped).toContain("Buyers will be refunded when emails wire up");
  });

  test("cancelServerEvent reference is preserved in deps array (without router)", () => {
    const depsMatch = body.match(/\}\s*,\s*\[([^\]]*)\]\s*\)\s*;$/);
    expect(depsMatch).not.toBeNull();
    const deps = depsMatch![1];
    expect(deps).toMatch(/\bcancelServerEvent\b/);
    expect(deps).toMatch(/\bupdateLifecycle\b/);
    expect(deps).toMatch(/\bshowToast\b/);
    expect(deps).not.toMatch(/\brouter\b/);
  });
});
