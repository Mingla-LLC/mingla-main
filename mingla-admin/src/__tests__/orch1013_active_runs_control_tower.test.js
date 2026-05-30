// ORCH-1013 Finding B regression — <ActiveRunsControlTower /> surface
// invariants: visibility gate (returns null when zero active+terminal),
// SectionCard title ("Active runs (N)"), wires onViewRun deep-link, mounts
// <ActiveRunCard /> per run, uses Framer Motion AnimatePresence + layout.
//
// node:test + source-string assertions (matches mingla-admin's existing test
// pattern — no React Testing Library / vitest dependency). Fails on revert
// (verified at commit hash recorded in implementation report).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");
const TOWER = path.join(
  ADMIN_ROOT,
  "src",
  "components",
  "placeIntelligenceTrial",
  "ActiveRunsControlTower.jsx",
);
const PAGE = path.join(
  ADMIN_ROOT,
  "src",
  "pages",
  "PlaceIntelligenceTrialPage.jsx",
);

describe("ORCH-1013 Finding B — ActiveRunsControlTower surface", () => {
  const src = fs.readFileSync(TOWER, "utf8");

  it("imports useActiveRunsPoller + SectionCard + ActiveRunCard + framer-motion", () => {
    assert.ok(src.includes("useActiveRunsPoller"), "must import useActiveRunsPoller");
    assert.ok(src.includes("SectionCard"), "must import SectionCard");
    assert.ok(src.includes("ActiveRunCard"), "must import ActiveRunCard");
    // Aliased to `Motion` to match the no-unused-vars `^[A-Z_]` pattern; the
    // member access (`Motion.div`) still resolves to framer-motion's motion API.
    assert.ok(
      src.includes("AnimatePresence") &&
        /from\s*"framer-motion"/.test(src) &&
        src.includes("motion as Motion"),
      "must use framer-motion AnimatePresence + motion (aliased Motion)",
    );
  });

  it("returns null when no active or terminal runs (visibility gate)", () => {
    // Invariant I-PROPOSED-INTEL-CONTROL-TOWER-VISIBILITY-GATE
    assert.ok(
      src.includes("if (totalCount === 0) return null"),
      "must return null when activeRuns.length + terminalRuns.length === 0",
    );
  });

  it("renders SectionCard titled 'Active runs (N)'", () => {
    assert.ok(
      src.includes("Active runs (${activeRuns.length})"),
      "SectionCard title must include 'Active runs (N)'",
    );
  });

  it("passes onViewRun prop to each ActiveRunCard", () => {
    assert.ok(
      src.includes("onViewRun={onViewRun}"),
      "ActiveRunCard must receive onViewRun prop for deep-link",
    );
  });

  it("exit animation slides cards out (x: 8, opacity: 0, ~200ms ease-out)", () => {
    // Per SPEC §3 B.2 — framer-motion `exit={{ opacity: 0, x: 8 }}`, 200ms ease-out
    assert.ok(src.includes("opacity: 0"), "exit animation must zero opacity");
    assert.ok(src.includes("x: 8"), "exit animation must slide right by 8px");
    assert.ok(src.includes('duration: 0.2'), "transition duration must be ~200ms");
    assert.ok(src.includes('ease: "easeOut"'), "transition must be ease-out");
  });
});

describe("ORCH-1013 Finding B — PlaceIntelligenceTrialPage mounts the control tower", () => {
  const src = fs.readFileSync(PAGE, "utf8");

  it("imports ActiveRunsControlTower", () => {
    assert.ok(
      src.includes("ActiveRunsControlTower"),
      "page must import the control tower",
    );
  });

  it("mounts <ActiveRunsControlTower /> above the Tabs", () => {
    const towerIdx = src.indexOf("<ActiveRunsControlTower");
    const tabsIdx = src.indexOf("<Tabs ");
    assert.ok(towerIdx > 0, "must mount ActiveRunsControlTower");
    assert.ok(tabsIdx > 0, "must have Tabs row");
    assert.ok(
      towerIdx < tabsIdx,
      "ActiveRunsControlTower must mount before the Tabs row in JSX",
    );
  });

  it("control tower deep-links 'View' to the Results tab", () => {
    assert.ok(
      src.includes('setActiveTab("results")'),
      "onViewRun must switch the page to the Results tab",
    );
  });
});
