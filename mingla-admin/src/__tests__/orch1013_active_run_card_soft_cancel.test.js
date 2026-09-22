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

  // issue #3526 P0-1 — this used to require a hardcoded
  // `COST_DRIFT_TOLERANCE_USD_PER_PLACE = 0.001` described in its own name as
  // "±25% of $0.0040". That absolute was the defect: when the server's rate
  // moved to $0.0089 the tolerance silently became ±11% and the drift badge
  // would have fired on EVERY run — an alarm that is always on is an alarm
  // nobody reads. The card holds no dollar amount now; it derives the rate from
  // `run.estimated_cost_usd / run.total_count`, the figure the server priced
  // THIS run at, and takes a true 25% fraction of it. What is asserted is
  // therefore the ratio and the derivation, not a frozen dollar figure.
  it("cost cross-check derives its baseline from the server and tolerates a true 25%", () => {
    assert.ok(
      /COST_DRIFT_TOLERANCE_FRACTION\s*=\s*0\.25\b/.test(src),
      "tolerance must be a dimensionless 25% fraction, not a frozen dollar amount",
    );
    assert.ok(
      src.includes("estCost / total"),
      "the per-place baseline must come from the server's own estimate for this run",
    );
    assert.ok(
      /tolerance\s*=\s*processed \* serverPerPlaceCost \* COST_DRIFT_TOLERANCE_FRACTION/
        .test(src),
      "the tolerance must scale with the server rate, not with a client constant",
    );
    assert.ok(
      !/\b0\.00[0-9]+\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")),
      "the card must hold no per-place rate literal at all (issue #3526 G-5)",
    );
    assert.ok(
      src.includes("serverPerPlaceCost === null"),
      "with no server estimate the badge must stay silent rather than fire on an invented baseline",
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
