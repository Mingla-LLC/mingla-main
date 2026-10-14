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
//
// [TEST-MOD-APPROVED ISSUE-3802] 2026-10-13: Seth approved the admin shell
// revamp (issue #3802, "one frame for every page, menu grouped by job"). The
// menu is now eight groups in a new order, so the assertions that pinned the
// OLD order are replaced, and only those: the 19-item primary-group snapshot,
// its count, and "Settings / Email / Users sit in the primary group". They now
// pin the approved order across all groups. Unchanged: group[0] has no label
// and does not fold, the 6 deleted ids stay out of the menu, the 6 page files
// stay deleted, App.jsx never imports them. I-PROPOSED-ADMIN-SHELL-FLAT-
// NAVIGATION is retired in the registry by the same change.

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

// [TEST-MOD-APPROVED ISSUE-3802] the approved menu order, every group, top to
// bottom. The first two ids are the unlabelled primary group.
const EXPECTED_IDS = [
  // no label
  "overview",
  "support",
  // Pipeline
  "hosts",
  "creators",
  "beta-leads",
  "tool-leads",
  "team-dashboard",
  // Business
  "business-people",
  "business-brands",
  "brand-sites",
  "business-venues",
  "business-offerings",
  "claims",
  // Money
  "business-payments",
  "business-orders",
  "business-money-ledger",
  "refund-operations",
  "subscriptions",
  "pricing",
  // Explorer app
  "users",
  "placepool",
  "launch-cities",
  "signals",
  "deck-tuner",
  "place-intelligence-trial",
  // Growth
  "ad-engine",
  "campaign-builder",
  "campaigns",
  "email",
  // Company
  "admin",
  "careers",
  // System
  "stripe-mode",
  "api-health",
  "settings",
  "agent",
];
const PRIMARY_IDS = ["overview", "support"];

describe("ORCH-1008 Phase 1 — sidebar prune + flatten", () => {
  it("the primary nav group has label:null and is not collapsible", () => {
    // [TEST-MOD-APPROVED ISSUE-1354] NAV_GROUPS.length === 1 is SUPERSEDED (3
    // groups now: primary + Business + Growth). group[0] remains the primary
    // flat group.
    assert.equal(NAV_GROUPS[0].label, null, "group[0] must have label:null");
    assert.notEqual(NAV_GROUPS[0].collapsible, true, "the primary group must not be collapsible");
  });

  it("the menu holds every page in the approved order (issue #3802)", () => {
    // [TEST-MOD-APPROVED ISSUE-3802] was: the primary group is the 19-item list.
    assert.deepEqual(NAV_GROUPS[0].items.map((i) => i.id), PRIMARY_IDS);
    assert.deepEqual(NAV_GROUPS.flatMap((g) => g.items).map((i) => i.id), EXPECTED_IDS);
  });

  it("NAV_GROUPS does NOT contain any of the 6 deleted ids", () => {
    const ids = new Set(NAV_GROUPS.flatMap((g) => g.items).map((i) => i.id));
    for (const bad of DELETED_IDS) {
      assert.equal(ids.has(bad), false, `nav must not include deleted id '${bad}'`);
    }
  });

  it("NAV_ITEMS is the same list, flat, with every id once", () => {
    // [TEST-MOD-APPROVED ISSUE-3802] was: group[0] holds 19 items and NAV_ITEMS
    // contains each of them.
    assert.deepEqual(NAV_ITEMS.map((i) => i.id), EXPECTED_IDS);
    assert.equal(new Set(EXPECTED_IDS).size, EXPECTED_IDS.length);
  });

  it("Settings is still in the menu, once", () => {
    // [TEST-MOD-APPROVED ISSUE-3802] was: Settings sits in the primary group.
    // Seth moved it into the System group; it must still be reachable.
    assert.equal(NAV_ITEMS.filter((i) => i.id === "settings").length, 1);
    assert.equal(NAV_GROUPS.find((g) => g.items.some((i) => i.id === "settings")).label, "System");
  });

  it("Email + Users survive in the menu", () => {
    // [TEST-MOD-APPROVED ISSUE-3802] was: both sit in the primary group.
    const ids = NAV_ITEMS.map((i) => i.id);
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
