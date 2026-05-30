// ORCH-1013 Finding B regression — <ActiveRunCard /> soft-cancel state machine:
//   - running → click X → CancelRunConfirmModal opens
//   - confirm → POST {action:'cancel_trial', run_id} via invokeWithRefresh
//   - success → toast "Cancelling…" + onCancelled(run.id) fires
//   - cancelling → spinner + "Cancelling… (~30-90s)" instead of cancel button
//   - terminal (complete/cancelled/failed) → status pill + "View" affordance
//
// Icon choice (SPEC §7-D5): `X` from lucide-react, NOT `Square`.
//
// node:test + source-string assertions (mingla-admin pattern).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");
const CARD = path.join(
  ADMIN_ROOT,
  "src",
  "components",
  "placeIntelligenceTrial",
  "ActiveRunCard.jsx",
);

describe("ORCH-1013 Finding B — ActiveRunCard soft-cancel", () => {
  const src = fs.readFileSync(CARD, "utf8");

  it("imports the soft-cancel icon as X (NOT Square)", () => {
    assert.ok(
      /import\s*{[^}]*\bX\b[^}]*}\s*from\s*"lucide-react"/.test(src),
      "must import X from lucide-react (SPEC §7-D5)",
    );
    assert.ok(
      !/import\s*{[^}]*\bSquare\b[^}]*}\s*from\s*"lucide-react"/.test(src),
      "must NOT import Square — Square stays in TrialResultsTab for hard sample-mode cancel only",
    );
  });

  it("opens CancelRunConfirmModal on Cancel click", () => {
    assert.ok(
      src.includes("CancelRunConfirmModal"),
      "must mount the existing CancelRunConfirmModal primitive",
    );
    assert.ok(
      src.includes("setCancelModalOpen(true)"),
      "Cancel button must open the modal (not call cancel directly)",
    );
  });

  it("on confirm, POSTs {action:'cancel_trial', run_id}", () => {
    assert.ok(
      src.includes('action: "cancel_trial"') && src.includes("run_id: run.id"),
      "confirm must invoke the cancel_trial action with run.id",
    );
  });

  it("on success, emits toast 'Cancelling…' + calls onCancelled(run.id)", () => {
    assert.ok(
      src.includes('title: "Cancelling…"'),
      "must emit a toast with title 'Cancelling…'",
    );
    assert.ok(
      src.includes("onCancelled?.(run.id)"),
      "must bubble cancellation to the parent poller for terminal animation",
    );
  });

  it("status='cancelling' shows spinner + '(~30-90s)' text instead of cancel button", () => {
    assert.ok(
      src.includes("Loader2") && src.includes("animate-spin"),
      "cancelling state must render an animated spinner",
    );
    assert.ok(
      src.includes("Cancelling… (~30-90s)"),
      "cancelling state must surface the 30-90s ETA copy",
    );
  });

  it("terminal status (complete/cancelled/failed) shows View button", () => {
    assert.ok(
      src.includes('["complete", "cancelled", "failed"]'),
      "terminal-state guard must include all 3 terminal statuses",
    );
    assert.ok(
      src.includes("onViewRun?.(run.id)"),
      "View button must invoke onViewRun(run.id) for deep-link",
    );
  });

  it("cost cross-check shows expected vs actual with ±$0.0010/place tolerance", () => {
    assert.ok(
      src.includes("COST_DRIFT_TOLERANCE_USD_PER_PLACE"),
      "must declare a drift tolerance constant",
    );
    assert.ok(
      /COST_DRIFT_TOLERANCE_USD_PER_PLACE\s*=\s*0\.001\b/.test(src),
      "tolerance must be $0.0010 per place (±25% of $0.0040)",
    );
    assert.ok(
      src.includes("expected") && src.includes("actual"),
      "cross-check line must surface 'expected' and 'actual' numbers",
    );
  });

  it("ETA shows '—' when status is not running OR _liveEtaSeconds is null", () => {
    assert.ok(
      src.includes('"—"'),
      "ETA cell must fall back to '—' when no live rate available",
    );
  });
});
