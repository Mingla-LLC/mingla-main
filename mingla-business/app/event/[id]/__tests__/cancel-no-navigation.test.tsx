/* eslint-disable import/first */
/**
 * ORCH-0862 / F-1 — implementor happy-path regression test (IM-1).
 *
 * Asserts that `handleCancelConfirm` on the event-detail screen
 * (`app/event/[id]/index.tsx`) no longer contains `router.replace` calls.
 * The Symptom A freeze was caused by `router.replace("/(tabs)/hub/events")`
 * firing synchronously inside the cancel handler, racing the 200ms native
 * Modal unmount-delay + 160ms iOS UIKit dismiss animation. The fix is to
 * remove BOTH `router.replace` lines (server-backed path + legacy
 * client-side path) so the screen re-renders in place via the cache
 * invalidate refetch.
 *
 * This is a structural test against the source file because the screen's
 * dependency graph (Expo Router + 12+ hooks + Zustand stores) is too
 * heavyweight to render in Node-environment jest cleanly. Combined with
 * the strict-grep CI gate
 * `.github/scripts/strict-grep/i-event-detail-cancel-no-navigation.mjs`,
 * any accidental re-introduction of router.replace fails both this jest
 * test (local + CI) and the strict-grep workflow (CI).
 *
 * Fails-on-revert verification: if either `router.replace(...)` line is
 * restored inside the handleCancelConfirm body, the regex match below
 * returns non-zero hits and the test fails.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const SCREEN_SOURCE_PATH = join(
  __dirname,
  "..",
  "index.tsx",
);

describe("ORCH-0862 F-1 — event-detail handleCancelConfirm does not navigate", () => {
  const source = readFileSync(SCREEN_SOURCE_PATH, "utf8");

  test("source file loads", () => {
    expect(source.length).toBeGreaterThan(0);
    expect(source).toContain("handleCancelConfirm");
  });

  test("handleCancelConfirm body contains zero router.replace calls", () => {
    // Extract the handleCancelConfirm useCallback body by anchoring on the
    // declaration line and the closing dependency array. Greedy match on the
    // body content between the opening `useCallback(async (): Promise<void> => {`
    // and the closing `}, [...])`.
    const match = source.match(
      /handleCancelConfirm\s*=\s*useCallback\(\s*async[\s\S]*?\}\s*,\s*\[[^\]]*\]\s*\)\s*;/,
    );
    expect(match).not.toBeNull();
    const body = match![0];
    const routerReplaceMatches = body.match(/router\.replace/g) ?? [];
    expect(routerReplaceMatches).toHaveLength(0);
  });

  test("handleCancelConfirm body retains setCancelDialogVisible(false) and showToast on success", () => {
    const match = source.match(
      /handleCancelConfirm\s*=\s*useCallback\(\s*async[\s\S]*?\}\s*,\s*\[[^\]]*\]\s*\)\s*;/,
    );
    expect(match).not.toBeNull();
    const body = match![0];
    expect(body).toContain("setCancelDialogVisible(false)");
    expect(body).toContain("Event cancelled.");
  });

  test("handleCancelConfirm useCallback dependency array does NOT include router", () => {
    // Router is no longer used in this callback after F-1, so it must not
    // appear in the dependency array. Lint/tsc would also flag this but the
    // structural test makes the contract explicit.
    const match = source.match(
      /handleCancelConfirm\s*=\s*useCallback\(\s*async[\s\S]*?\}\s*,\s*\[([^\]]*)\]\s*\)\s*;/,
    );
    expect(match).not.toBeNull();
    const depsArrayContent = match![1];
    // Match `router` as a whole identifier, not as a substring of e.g. `routerXyz`.
    const routerDep = depsArrayContent.match(/\brouter\b/);
    expect(routerDep).toBeNull();
  });

  test("F-1 protective comment marker is present", () => {
    // Per spec §10 — protective comment explains the why so future authors
    // don't re-add router.replace thinking it "feels right".
    expect(source).toContain("ORCH-0862: do NOT navigate post-cancel");
  });
});
