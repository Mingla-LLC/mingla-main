// ORCH-1008 Phase 4b regression test — RunHistoryGroups module asserts:
//   - Running + Failed groups default-expanded
//   - Completed + Queued + Cancelled groups default-collapsed
//   - Status normalisation (pending → queued)
//   - Group order locked to running / queued / failed / completed / cancelled
//   - Live-pulse + load-more sentinel surfaces
//
// Fails on revert (verified at commit hash recorded in implementation report).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");
const RUN_HISTORY = path.join(
  ADMIN_ROOT,
  "src",
  "components",
  "placeIntelligenceTrial",
  "RunHistoryGroups.jsx",
);
const TRIAL_TAB = path.join(
  ADMIN_ROOT,
  "src",
  "components",
  "placeIntelligenceTrial",
  "TrialResultsTab.jsx",
);

describe("ORCH-1008 Phase 4b — RunHistoryGroups status-grouped run history", () => {
  const src = fs.readFileSync(RUN_HISTORY, "utf8");

  it("group order is locked to running → queued → failed → completed → cancelled", () => {
    const match = src.match(/STATUS_ORDER\s*=\s*\[([^\]]+)\]/);
    assert.ok(match, "expected to find STATUS_ORDER constant");
    const order = match[1]
      .split(",")
      .map((s) => s.trim().replace(/['"]/g, ""))
      .filter(Boolean);
    assert.deepEqual(order, ["running", "queued", "failed", "completed", "cancelled"]);
  });

  it("Running and Failed groups default-expanded; Completed/Queued/Cancelled default-collapsed", () => {
    // STATUS_META declares expandedDefault per group
    function metaFor(id) {
      const re = new RegExp(`${id}:\\s*\\{[^}]+expandedDefault:\\s*(true|false)`);
      const m = src.match(re);
      assert.ok(m, `expected STATUS_META.${id} to declare expandedDefault`);
      return m[1] === "true";
    }
    assert.equal(metaFor("running"), true, "running must default-expanded");
    assert.equal(metaFor("failed"), true, "failed must default-expanded");
    assert.equal(metaFor("completed"), false, "completed must default-collapsed");
    assert.equal(metaFor("queued"), false, "queued must default-collapsed");
    assert.equal(metaFor("cancelled"), false, "cancelled must default-collapsed");
  });

  it("pending rows normalise to queued", () => {
    const match = src.match(/function normaliseStatus[\s\S]*?\}/);
    assert.ok(match, "expected normaliseStatus helper");
    assert.ok(match[0].includes('"pending"'), "normaliseStatus must mention pending");
    assert.ok(match[0].includes('"queued"'), "normaliseStatus must map to queued");
  });

  it("running group renders the ping pulse animation", () => {
    assert.ok(
      src.includes("animate-[ping_"),
      "running pulse must use the existing ping keyframe",
    );
  });

  it("completed group has a load-more sentinel (initial 50 + step 50)", () => {
    assert.ok(
      src.includes("COMPLETED_INITIAL_SLICE = 50"),
      "expected COMPLETED_INITIAL_SLICE = 50",
    );
    assert.ok(
      src.includes("COMPLETED_LOAD_STEP = 50"),
      "expected COMPLETED_LOAD_STEP = 50",
    );
    assert.ok(src.includes("Load"), "expected a 'Load …' button label");
  });

  it("failed group exposes a Retry-failed inline tool", () => {
    assert.ok(
      src.includes("onRetryFailed"),
      "expected onRetryFailed prop wired into failed group header",
    );
    assert.ok(
      src.includes("Retry failed"),
      "expected the visible 'Retry failed' label",
    );
  });
});

describe("ORCH-1008 Phase 4b — TrialResultsTab mounts the status-grouped run history", () => {
  const src = fs.readFileSync(TRIAL_TAB, "utf8");

  it("imports RunHistoryGroups + mounts it instead of a per-run flat list", () => {
    assert.ok(src.includes("import { RunHistoryGroups }"));
    assert.ok(src.includes("<RunHistoryGroups"));
  });

  it("legacy inline PlaceResultCard component is removed", () => {
    // The pre-ORCH-1008 component lived inline; only the import path or
    // tab function should remain — no top-level `function PlaceResultCard`.
    assert.equal(
      /function\s+PlaceResultCard\s*\(/.test(src),
      false,
      "expected legacy PlaceResultCard function to be deleted",
    );
  });

  it("imports SignalDistributionPanel and cancel modal", () => {
    assert.ok(src.includes("import { SignalDistributionPanel }"));
    assert.ok(src.includes("import { CancelRunConfirmModal }"));
    assert.ok(src.includes("import { RunRemainderConfirmModal }"));
  });

  it("3-option segmented control: sample / full_city / remainder", () => {
    assert.ok(src.includes('setMode("sample")'));
    assert.ok(src.includes('setMode("full_city")'));
    assert.ok(src.includes('setMode("remainder")'));
    assert.ok(src.includes("Remainder only"));
  });

  it("cancel button opens the modal rather than calling window.confirm", () => {
    // The new path uses setCancelModalOpen(true); the legacy path called
    // window.confirm("Cancel this run? ...") — that string must not appear.
    assert.ok(
      src.includes("setCancelModalOpen(true)"),
      "expected setCancelModalOpen(true) on the Cancel button",
    );
    assert.equal(
      src.includes('window.confirm("Cancel this run'),
      false,
      "legacy window.confirm cancel prompt must be replaced by the modal",
    );
  });
});
