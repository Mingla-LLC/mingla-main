import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1208 [business-web swipe-to-dismiss dead on real touch devices] —
 * implementor-owned happy-path regression over the SheetWeb source contract.
 *
 * ROOT CAUSE (measured by the orchestrator on Seth's real Samsung via adb+CDP):
 * ORCH-1207 added the swipe-down-to-dismiss drag-catch band but only set
 * `touch-action:none` on the PANEL style — it does NOT inherit to the drag-catch
 * element, which computed `touch-action:auto` on the device. With `auto`, Android
 * Chrome / Samsung Internet steal the downward drag as a page scroll and fire
 * pointercancel → the pointer-drag handler never completes → the sheet never
 * dismisses. (Mouse/desktop is immune because touch-action only gates touch.)
 *
 * THE FIX: add `touchAction:"none"` to `styles.webDragCatch` so the browser
 * routes the vertical drag on the handle band to the pointer handler.
 *
 * Fails-on-revert (verified by true line-DELETION, not comment-out): delete the
 * `touchAction:"none"` line from the `webDragCatch` style block and this test's
 * assertions fail. Verified at commit recorded in IMPLEMENT_ORCH-1208.md.
 */
const root = path.resolve(__dirname, "..", "..", "..", "..");
const SRC = fs.readFileSync(
  path.join(root, "src/components/ui/SheetMobile.tsx"),
  "utf8",
);

/** Slice out the `webDragCatch: { ... }` style block body. */
function webDragCatchBlock(): string {
  const start = SRC.indexOf("webDragCatch:");
  expect(start).toBeGreaterThan(-1);
  const open = SRC.indexOf("{", start);
  const close = SRC.indexOf("}", open);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return SRC.slice(open, close + 1);
}

describe("ORCH-1208 — drag-catch carries touch-action:none on web", () => {
  it("styles.webDragCatch sets touchAction:\"none\" so touch devices route the drag to the pointer handler", () => {
    const block = webDragCatchBlock();
    expect(/touchAction:\s*["']none["']/.test(block)).toBe(true);
  });

  it("keeps the panel's own touch-action:none (ORCH-1207) — both layers, not a swap", () => {
    // The panelWebStyle touch-action stays; the fix ADDS the drag-catch one.
    expect(/touchAction:\s*["']none["']/.test(SRC)).toBe(true);
    const matches = SRC.match(/touchAction:\s*["']none["']/g) ?? [];
    // At least two distinct touch-action:none declarations: panel + drag-catch.
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
