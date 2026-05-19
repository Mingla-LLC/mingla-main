/**
 * ORCH-0877 HOTFIX — regression test for the EditPublishedScreen When-
 * section save gate.
 *
 * Bug surfaced by operator smoke-test on 2026-05-19 after the ORCH-0877
 * close (PR #136 merged at 04:50Z). When an operator edited a published
 * event's When section (date / doorsOpen / endsAt / timezone / recurrence
 * / multi-dates), the "Save changes" dock button stayed greyed out.
 *
 * Root cause: `SERVER_EDITABLE_PATCH_KEYS` only included
 * `COVER_MEDIA_PATCH_KEYS` + `ORCH_0824_PATCH_KEYS`. For a server-loaded
 * event (the `disableLocalSaveReason !== undefined` path), the dock-level
 * `disabled={...}` gate uses `isServerEditableOnlyPatch(patch)` to decide
 * whether to lift the gate. When keys weren't in the set, so the gate
 * stayed locked even though the new `business_patch_event_when` RPC was
 * fully wired and reachable.
 *
 * Secondary issue: even if the dock gate had lifted, the When-RPC call
 * sat BELOW the unified server-editable early-return at line 766. The
 * early-return would have fired first and exited before the RPC ran.
 *
 * Fix: (a) add `ORCH_0877_WHEN_PATCH_KEYS` to `SERVER_EDITABLE_PATCH_KEYS`;
 * (b) move the When-RPC block ABOVE the unified early-return so it
 * mirrors the placement of cover-media + ORCH-0824 taxonomy blocks.
 *
 * fails-on-revert: the source-text assertions below all fail if either
 * the keys set narrows back, the constant disappears, or the block order
 * regresses.
 */

import fs from "node:fs";
import path from "node:path";

const SCREEN_PATH = path.resolve(
  __dirname,
  "..",
  "EditPublishedScreen.tsx",
);

function read(): string {
  return fs.readFileSync(SCREEN_PATH, "utf8");
}

describe("ORCH-0877 hotfix — EditPublishedScreen When-section save gate", () => {
  test("ORCH_0877_WHEN_PATCH_KEYS constant exists with all 7 When-section keys", () => {
    const src = read();
    const match = src.match(
      /const ORCH_0877_WHEN_PATCH_KEYS\s*=\s*new Set<keyof EditableLiveEventFields>\(\[([^\]]*)\]\)/,
    );
    expect(match).not.toBeNull();
    const body = match![1];
    expect(body).toContain('"whenMode"');
    expect(body).toContain('"date"');
    expect(body).toContain('"doorsOpen"');
    expect(body).toContain('"endsAt"');
    expect(body).toContain('"timezone"');
    expect(body).toContain('"recurrenceRule"');
    expect(body).toContain('"multiDates"');
  });

  test("SERVER_EDITABLE_PATCH_KEYS unions ORCH_0877_WHEN_PATCH_KEYS in", () => {
    const src = read();
    expect(src).toMatch(
      /SERVER_EDITABLE_PATCH_KEYS[\s\S]{0,200}\.\.\.ORCH_0877_WHEN_PATCH_KEYS/,
    );
  });

  test("When-RPC block sits BEFORE the unified server-editable early-return", () => {
    const src = read();
    const rpcIndex = src.indexOf("patchPublishedEventWhen({");
    const earlyReturnIndex = src.indexOf(
      "ORCH-0824 hotfix: unified early-return",
    );
    expect(rpcIndex).toBeGreaterThan(-1);
    expect(earlyReturnIndex).toBeGreaterThan(-1);
    expect(rpcIndex).toBeLessThan(earlyReturnIndex);
  });

  test("dock-level save-button disabled gate uses canSaveServerCoverMediaOnly (lifted when patch is server-editable-only)", () => {
    const src = read();
    expect(src).toContain("canSaveServerCoverMediaOnly =");
    expect(src).toContain(
      "disableLocalSaveReason !== undefined &&\n    isServerEditableOnlyPatch(currentPatch)",
    );
    expect(src).toContain("!canSaveServerCoverMediaOnly");
  });
});
