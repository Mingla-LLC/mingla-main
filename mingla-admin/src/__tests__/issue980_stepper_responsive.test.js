// ISSUE-980 [Campaign Builder clarity] finding #1(a) — the 10-step Stepper
// overflowed on <=1440px laptops (ISSUE-977 Lane A F-6: the full-size run
// needs ~1,070-1,100px; a 1440x900 laptop has ~1,052px available once the
// sidebar (260px) + AppShell's px-16 (128px) are subtracted; 1366x768 leaves
// only ~978px). The fix: a "compact" density (tighter padding/connector +
// two abbreviated labels) below COMPACT_BREAKPOINT_PX.
//
// FAILS-ON-REVERT: deleting stepperResponsive.js's compact branch (or
// Stepper.jsx's use of it) reddens both halves of this suite — the pure
// isCompactStepper/stepLabel assertions AND the source-grep wiring checks
// that prove Stepper.jsx actually renders a distinct, narrower class set at
// compact density instead of always rendering the full-size classes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMPACT_BREAKPOINT_PX,
  isCompactStepper,
  stepLabel,
} from "../components/campaign-builder/stepperResponsive.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(p, "utf8");

const STEP_PREFLIGHT = { id: "preflight", label: "Channel health" };
const STEP_POLICY = { id: "policy", label: "Policy check" };
const STEP_GOAL = { id: "goal", label: "Goal" };

describe("ISSUE-980 finding #1(a) — isCompactStepper matches the forensics' exact laptop widths", () => {
  it("1366px and 1440px laptops (the widths ISSUE-977 proved overflow) render compact", () => {
    assert.equal(isCompactStepper(1366), true, "1366px laptop must render compact — it overflowed at full size");
    assert.equal(isCompactStepper(1440), true, "1440px laptop must render compact — it overflowed at full size");
  });

  it("a wide external monitor (well past the full-size requirement) does not need compaction", () => {
    assert.equal(isCompactStepper(1920), false);
    assert.equal(isCompactStepper(2560), false);
  });

  it("the breakpoint boundary is exact and matches the exported constant", () => {
    assert.equal(isCompactStepper(COMPACT_BREAKPOINT_PX - 1), true);
    assert.equal(isCompactStepper(COMPACT_BREAKPOINT_PX), false);
  });

  it("an unknown/non-numeric width fails toward the SAFER (compact) density, never full", () => {
    assert.equal(isCompactStepper(NaN), true);
    assert.equal(isCompactStepper(undefined), true);
    assert.equal(isCompactStepper("1920"), true, "a non-number must not be coerced into a full-density decision");
  });
});

describe("ISSUE-980 finding #1(a) — stepLabel abbreviates only in compact density, only where a shorter label exists", () => {
  it("compact density shortens the two long labels that drive the overflow", () => {
    const preflightCompact = stepLabel(STEP_PREFLIGHT, { compact: true });
    const policyCompact = stepLabel(STEP_POLICY, { compact: true });
    assert.notEqual(preflightCompact, STEP_PREFLIGHT.label);
    assert.notEqual(policyCompact, STEP_POLICY.label);
    assert.ok(preflightCompact.length < STEP_PREFLIGHT.label.length, "compact 'Channel health' must be shorter");
    assert.ok(policyCompact.length < STEP_POLICY.label.length, "compact 'Policy check' must be shorter");
  });

  it("full density always uses the real label, even for the two long steps", () => {
    assert.equal(stepLabel(STEP_PREFLIGHT, { compact: false }), "Channel health");
    assert.equal(stepLabel(STEP_POLICY, { compact: false }), "Policy check");
  });

  it("a step with no shorter alternative renders unchanged in EITHER density", () => {
    assert.equal(stepLabel(STEP_GOAL, { compact: true }), "Goal");
    assert.equal(stepLabel(STEP_GOAL, { compact: false }), "Goal");
  });
});

describe("ISSUE-980 finding #1(a) — Stepper.jsx is actually wired to the responsive helper (fails-on-revert)", () => {
  const stepper = read(path.join(ADMIN_SRC, "components/campaign-builder/Stepper.jsx"));

  it("imports and calls isCompactStepper + stepLabel — not a dead helper file", () => {
    assert.ok(stepper.includes('from "./stepperResponsive"'), "Stepper.jsx must import the responsive helper");
    assert.ok(stepper.includes("isCompactStepper("), "Stepper.jsx must call isCompactStepper");
    assert.ok(stepper.includes("stepLabel(step, { compact })"), "Stepper.jsx must call stepLabel per step");
  });

  it("renders a DISTINCT, narrower class set at compact density (not the same full-size classes always)", () => {
    // The exact compact vs. full pill class strings Stepper.jsx renders —
    // proves the two densities are genuinely different, not just a no-op
    // ternary. A revert back to one hardcoded class list fails this.
    assert.ok(stepper.includes("gap-1 h-7 px-1.5 text-[11px]"), "compact pill classes must be present");
    assert.ok(stepper.includes("gap-1.5 h-8 px-2.5 text-xs"), "full pill classes must still be present at full density");
    assert.notEqual(
      stepper.match(/h-7 px-1\.5/)?.[0],
      stepper.match(/h-8 px-2\.5/)?.[0],
      "compact and full pill sizing must be genuinely different",
    );
  });

  it("keeps overflow-x-auto as a last-resort safety net (belt-and-suspenders, not the primary strategy)", () => {
    assert.ok(stepper.includes("overflow-x-auto"), "the scroll fallback must remain for edge cases");
  });
});

describe("ISSUE-980 finding #1(b) — the content grid's first track is flexible, not a fixed 720px strand", () => {
  const page = read(path.join(ADMIN_SRC, "pages/CampaignBuilderPage.jsx"));

  it("no longer hard-codes minmax(0,720px) — that left-anchored the builder and stranded width on wide monitors", () => {
    assert.ok(
      !page.includes("lg:grid-cols-[minmax(0,720px)_320px]"),
      "the fixed 720px first track (ISSUE-977 Lane A F-6) must be gone",
    );
  });

  it("uses a flexible first track so the builder fills the available width with balanced padding", () => {
    assert.ok(
      page.includes("lg:grid-cols-[minmax(0,1fr)_320px]"),
      "the two-column grid must use a flexible (1fr) first track",
    );
  });
});
