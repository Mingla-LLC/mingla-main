// ORCH-1008 adversarial test — Tabs.jsx keyboard nav source contracts.
//
// Attack angles:
//   - All-disabled tab array doesn't crash (early-return present)
//   - Single-tab array doesn't crash on arrow keys (modulo 1 = 0 stable)
//   - Focused tab not in enabled set (i.e. focused tab IS disabled —
//     `idx === -1`) — does ArrowLeft compute a defined nextIdx?
//   - tabIndex roving focus invariant: only the active tab has tabIndex=0;
//     all others MUST have tabIndex=-1 (WCAG roving tabindex)
//   - aria-controls names a deterministic tabpanel id
//
// Fails-on-revert verified at: 72f164536 (Tabs.jsx had no keyboard nav).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");

const TABS_PATH = path.join(ADMIN_ROOT, "src", "components", "ui", "Tabs.jsx");
const SRC = fs.readFileSync(TABS_PATH, "utf8");

describe("ORCH-1008 adversarial — Tabs.jsx keyboard nav edges", () => {
  it("handles all-disabled tab array by early-returning (no division by zero / no crash)", () => {
    // The implementation guards with `if (enabled.length === 0) return;`.
    // Without it, `enabled.findIndex` → -1 then modulo 0 = NaN propagation.
    assert.ok(
      /if\s*\(enabled\.length\s*===\s*0\)\s*return/.test(SRC),
      "all-disabled tab list must early-return from handleKeyDown",
    );
  });

  it("does NOT use a no-modulo-shortcut that would NaN on single-tab", () => {
    // Single-tab cycling: enabled.length=1 → (idx ± 1 + 1) % 1 must = 0.
    // The implementation uses `% enabled.length` which is safe for 1 (= 0).
    // Assert the modulo expression is present and points at enabled.length,
    // not a hard-coded value.
    assert.ok(
      /%\s*enabled\.length/.test(SRC),
      "modulo must use enabled.length so single-tab arrays do not NaN",
    );
  });

  it("only ONE tab has tabIndex=0 at a time (WCAG roving tabindex)", () => {
    // Assert that tabIndex is computed from isActive — not a static 0.
    assert.ok(
      /tabIndex=\{isActive\s*\?\s*0\s*:\s*-1\}/.test(SRC),
      "Tabs must implement roving tabindex (isActive ? 0 : -1)",
    );
  });

  it("aria-controls + id pair is deterministic per tab.id", () => {
    assert.ok(
      /aria-controls=\{`tabpanel-\$\{tab\.id\}`\}/.test(SRC),
      "Tabs must wire aria-controls to a deterministic tabpanel-{id}",
    );
    assert.ok(
      /id=\{`tab-\$\{tab\.id\}`\}/.test(SRC),
      "Tabs must set id to tab-{id} for paired aria reference",
    );
  });

  it("event.preventDefault is called BEFORE the arrow-key cycling code path", () => {
    // If preventDefault is missed, ArrowLeft on the first tab could scroll
    // the page horizontally in some browsers + steal focus.
    const handler = SRC.match(
      /function handleKeyDown[\s\S]*?\n\s\s\}/,
    );
    assert.ok(handler, "expected handleKeyDown function in Tabs.jsx");
    assert.ok(
      /event\.preventDefault\(\);[\s\S]*?const enabled/.test(handler[0]),
      "preventDefault must fire BEFORE computing enabled/idx",
    );
  });

  it("Home/End cycling does NOT use modulo (must jump to absolute first/last)", () => {
    // Home → nextIdx = 0; End → nextIdx = enabled.length - 1; no modulo
    assert.ok(
      /key === "Home"\)\s*nextIdx\s*=\s*0/.test(SRC),
      "Home must set nextIdx to absolute 0",
    );
    assert.ok(
      /key === "End"\)\s*nextIdx\s*=\s*enabled\.length\s*-\s*1/.test(SRC),
      "End must set nextIdx to enabled.length - 1",
    );
  });

  it(
    "BUG-SURFACE: when focused-tab is disabled, idx=-1 → ArrowLeft cycles to enabled[N-2] (not crash)",
    () => {
      // This documents the current behavior. If onKeyDown fires on a disabled
      // tab (technically can't happen because disabled tabs have tabIndex=-1
      // and don't receive focus), the math still resolves:
      //   ArrowRight: (-1 + 1) % N = 0 → first enabled tab. Acceptable.
      //   ArrowLeft:  (-1 - 1 + N) % N = (N-2) % N → N-2. Surprising.
      // Defense: this can only fire if a disabled tab is somehow focused.
      // We document the math here; if the implementation later guards
      // `if (idx === -1) idx = 0;`, update this test to reflect the harden.
      assert.ok(
        SRC.includes("(idx - 1 + enabled.length) % enabled.length"),
        "ArrowLeft uses (idx-1+N)%N — bug surface documented when focused tab is disabled",
      );
    },
  );
});
