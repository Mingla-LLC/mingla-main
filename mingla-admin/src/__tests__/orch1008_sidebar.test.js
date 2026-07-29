// ORCH-1008 Phase 1 regression test — flat sidebar + 6 deleted pages absent.
// Fails on revert (verified at commit hash recorded in implementation report).
//
// [TEST-MOD-APPROVED META-ORCH-1104] 2026-06-08: added the "support" nav id
// (Support desk, Phase 2) between "claims" and "users", and reconciled EXPECTED_IDS
// to the real nav (prior ORCHs added launch-cities/deck-tuner/beta-leads/pricing/
// stripe-mode without updating this locked test, so it was already failing on main).
// Nav count 10 -> 16. The flat-sidebar + 6-deleted-pages invariants are unchanged.
//
// [TEST-MOD-APPROVED ORCH-1201] 2026-06-21: added the "api-health" nav id
// (API-health hub) between "stripe-mode" and "settings". Nav count 16 -> 17.
// The flat-sidebar + 6-deleted-pages invariants are unchanged.
//
// [TEST-MOD-APPROVED ISSUE-1354] 2026-07-29: added the "tool-leads" nav id (all
// free-tool submissions + report detail) after "beta-leads". ALSO reconciled two
// pre-existing drifts that left this test RED-but-unrun on main (it is in NO CI
// workflow and not in `npm test`): (1) "careers" (META-ORCH-1222) was added to
// the nav without updating this snapshot; (2) the flat-single-group invariant is
// SUPERSEDED — ORCH-1271 added a "Business" group and ISSUE-862 a "Growth" group,
// so NAV_GROUPS is now 3 groups and NAV_ITEMS spans all of them. group[0] remains
// the primary flat group carrying the locked order. Primary-group count 17 -> 19.
// The 6-deleted-pages invariant is unchanged. (Discovery flagged: retire
// I-PROPOSED-ADMIN-SHELL-FLAT-NAVIGATION in the registry.)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_GROUPS, NAV_ITEMS } from "../lib/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");

const DELETED_PAGES = [
  "SeedPage.jsx",
  "ContentModerationPage.jsx",
  "AnalyticsPage.jsx",
  "ReportsPage.jsx",
  "BetaFeedbackPage.jsx",
  "TableBrowserPage.jsx",
];

const DELETED_IDS = ["content", "analytics", "reports", "feedback", "seed", "tables"];

const EXPECTED_IDS = [
  "overview",
  "subscriptions",
  "admin",
  "placepool",
  "launch-cities",
  "signals",
  "deck-tuner",
  "place-intelligence-trial",
  "email",
  "beta-leads",
  // [TEST-MOD-APPROVED ISSUE-1354] tool-leads (this issue) + careers (pre-existing
  // META-ORCH-1222 drift) reconciled into the locked order after beta-leads.
  "tool-leads",
  "careers",
  "pricing",
  "claims",
  "support",
  "users",
  "stripe-mode",
  "api-health",
  "settings",
];

describe("ORCH-1008 Phase 1 — sidebar prune + flatten", () => {
  it("the primary nav group has label:null and is not collapsible", () => {
    // [TEST-MOD-APPROVED ISSUE-1354] NAV_GROUPS.length === 1 is SUPERSEDED (3
    // groups now: primary + Business + Growth). group[0] remains the primary
    // flat group.
    assert.equal(NAV_GROUPS[0].label, null, "group[0] must have label:null");
    assert.notEqual(NAV_GROUPS[0].collapsible, true, "the primary group must not be collapsible");
  });

  it("the primary nav group has exactly 19 items in the locked SPEC order", () => {
    const ids = NAV_GROUPS[0].items.map((i) => i.id);
    assert.deepEqual(ids, EXPECTED_IDS);
  });

  it("NAV_GROUPS does NOT contain any of the 6 deleted ids", () => {
    const ids = new Set(NAV_GROUPS.flatMap((g) => g.items).map((i) => i.id));
    for (const bad of DELETED_IDS) {
      assert.equal(ids.has(bad), false, `nav must not include deleted id '${bad}'`);
    }
  });

  it("the primary group is the flat 19-item list in the locked order", () => {
    // [TEST-MOD-APPROVED ISSUE-1354] NAV_ITEMS now spans all 3 groups, so the
    // "flat list" snapshot is the primary group (group[0]). NAV_ITEMS (all
    // groups) must still contain every primary id.
    assert.equal(NAV_GROUPS[0].items.length, 19);
    assert.deepEqual(NAV_GROUPS[0].items.map((i) => i.id), EXPECTED_IDS);
    const flatIds = new Set(NAV_ITEMS.map((i) => i.id));
    for (const id of EXPECTED_IDS) {
      assert.equal(flatIds.has(id), true, `NAV_ITEMS must include primary id '${id}'`);
    }
  });

  it("Settings is a top-level item (not nested under a System dropdown)", () => {
    const settingsRow = NAV_GROUPS[0].items.find((i) => i.id === "settings");
    assert.ok(settingsRow, "settings entry must exist in the single top-level group");
  });

  it("Email + Users survive at top-level", () => {
    const ids = NAV_GROUPS[0].items.map((i) => i.id);
    assert.ok(ids.includes("email"), "email must remain in nav");
    assert.ok(ids.includes("users"), "users must remain in nav");
  });

  it("the 6 page files are physically deleted from disk", () => {
    for (const f of DELETED_PAGES) {
      const p = path.join(ADMIN_ROOT, "src", "pages", f);
      assert.equal(
        fs.existsSync(p),
        false,
        `expected ${f} to be deleted; still exists at ${p}`,
      );
    }
  });

  it("App.jsx no longer imports any of the 6 deleted pages", () => {
    const src = fs.readFileSync(path.join(ADMIN_ROOT, "src", "App.jsx"), "utf8");
    const forbidden = [
      "ContentModerationPage",
      "AnalyticsPage",
      "ReportsPage",
      "BetaFeedbackPage",
      "SeedPage",
      "TableBrowserPage",
    ];
    for (const sym of forbidden) {
      // Grep for `import ... ${sym}` to catch any reintroduction
      assert.equal(
        src.includes(sym),
        false,
        `App.jsx must not reference ${sym}`,
      );
    }
  });
});
