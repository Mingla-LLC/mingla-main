// ORCH-1013 Finding B regression — Overview tab gains a "Run remainder on
// all" CTA + wires it to <RunRemainderOnAllConfirmModal /> + useBulkRunDispatcher.
// candidateCities derives from rows.filter(r => r.remaining_count > 0).
// On confirm, dispatcher.enqueue + toast + silent refresh fire.
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
const TAB = path.join(
  ADMIN_ROOT,
  "src",
  "components",
  "placeIntelligenceTrial",
  "IntelligenceOverviewTab.jsx",
);

describe("ORCH-1013 Finding B — Overview tab bulk launcher wiring", () => {
  const src = fs.readFileSync(TAB, "utf8");

  it("imports the bulk modal + useBulkRunDispatcher hook", () => {
    assert.ok(
      src.includes("RunRemainderOnAllConfirmModal"),
      "must import the new bulk modal",
    );
    assert.ok(
      src.includes("useBulkRunDispatcher"),
      "must import the bulk dispatcher hook",
    );
  });

  it("derives candidateCities = rows.filter(r => r.remaining_count > 0)", () => {
    assert.ok(
      src.includes("candidateCities"),
      "must derive candidateCities",
    );
    assert.ok(
      src.includes("r.remaining_count > 0"),
      "candidateCities filter must require remaining_count > 0",
    );
  });

  it("renders 'Run remainder on all' button with count in label", () => {
    assert.ok(
      src.includes("Run remainder on all"),
      "must render the bulk CTA label",
    );
    assert.ok(
      src.includes("candidateCities.length"),
      "button must use candidateCities.length for the (N) suffix + disabled gating",
    );
  });

  it("button disabled when zero candidates with a helpful tooltip", () => {
    assert.ok(
      src.includes("All cities are fully evaluated"),
      "must surface the all-clear tooltip when nothing to evaluate",
    );
  });

  it("on confirm, dispatcher.enqueue + toast + silent refresh", () => {
    assert.ok(
      src.includes("dispatcher.enqueue(cities)"),
      "onConfirm must dispatch the cities",
    );
    assert.ok(
      src.includes("Bulk remainder queued"),
      "toast title must mention 'Bulk remainder queued'",
    );
    assert.ok(
      src.includes("refresh({ silent: true })"),
      "must silently refresh after enqueue so the coverage table reflects the launch",
    );
  });
});
