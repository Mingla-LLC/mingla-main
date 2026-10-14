// ORCH-1014 Finding A regression test — Photo Labeling + Photo Scorer
// removed from sidebar; the surviving items render in the locked order.
//
// Fails-on-revert: if either nav item is re-added or one of the 2 deleted
// page files is restored, this test FAILS.
//
// [TEST-MOD-APPROVED ORCH-1201] 2026-06-21: this test's EXPECTED_IDS_POST_1014
// was a stale 10-item snapshot that was NEVER reconciled when later ORCHs grew
// the nav (launch-cities/deck-tuner/beta-leads/pricing/support/stripe-mode) —
// so it was ALREADY failing on main before this cycle (verified). Reconciled
// to the real nav and added "api-health" (this cycle). The load-bearing
// invariant is unchanged: the two photo-* ids + page files stay deleted.
// Nav count 10 -> 17.
//
// [TEST-MOD-APPROVED ISSUE-1354] 2026-07-29: added the "tool-leads" nav id (all
// free-tool submissions + report detail) right after "beta-leads". ALSO
// reconciled a pre-existing drift: "careers" (META-ORCH-1222) was added to the
// nav WITHOUT updating this snapshot, so this test was ALREADY failing on main
// (verified: 5 subtests red). Both "tool-leads" and "careers" now sit after
// "beta-leads". Nav count 17 -> 19. The load-bearing photo-* invariant is
// unchanged.
//
// [TEST-MOD-APPROVED ISSUE-3802] 2026-10-13: Seth approved the admin shell
// revamp (issue #3802). The menu is now eight groups in a new order, so the
// 19-item primary-group snapshot and its count are replaced by the approved
// order across all groups. The load-bearing photo-* invariant is unchanged:
// the two photo ids, the two page files, the photoLabeling folder and its
// constants file stay deleted, and PhotoLightbox stays.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_GROUPS, NAV_ITEMS } from "../lib/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");

// [TEST-MOD-APPROVED ISSUE-3802] the approved menu order, every group.
const EXPECTED_IDS_POST_1014 = [
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

const ORCH_1014_DELETED_IDS = ["photo-labeling", "photo-scorer"];

const ORCH_1014_DELETED_PAGES = [
  "PhotoLabelingPage.jsx",
  "PhotoScorerPage.jsx",
];

describe("ORCH-1014 Finding A — photo pages pruned + locked sidebar order", () => {
  it("the menu holds every page in the approved order (issue #3802)", () => {
    // [TEST-MOD-APPROVED ISSUE-3802] was: group[0] holds the 19-item snapshot.
    assert.equal(NAV_GROUPS[0].label, null, "group[0] must remain the primary group (label:null)");
    assert.deepEqual(NAV_ITEMS.map((i) => i.id), EXPECTED_IDS_POST_1014);
  });

  it("NAV_ITEMS never includes the ORCH-1014-deleted photo ids", () => {
    // [TEST-MOD-APPROVED ISSUE-3802] the count of the primary group is no longer
    // pinned here (it is two items now); the deleted photo ids stay absent.
    const ids = NAV_ITEMS.map((i) => i.id);
    for (const dead of ORCH_1014_DELETED_IDS) {
      assert.equal(
        ids.includes(dead),
        false,
        `nav must not include ORCH-1014-deleted id '${dead}'`,
      );
    }
  });

  it("the 2 ORCH-1014 page files are physically deleted from disk", () => {
    for (const f of ORCH_1014_DELETED_PAGES) {
      const p = path.join(ADMIN_ROOT, "src", "pages", f);
      assert.equal(
        fs.existsSync(p),
        false,
        `expected ${f} to be deleted; still exists at ${p}`,
      );
    }
  });

  it("components/photoLabeling/ directory is physically deleted", () => {
    const p = path.join(ADMIN_ROOT, "src", "components", "photoLabeling");
    assert.equal(
      fs.existsSync(p),
      false,
      `expected components/photoLabeling/ to be deleted; still exists at ${p}`,
    );
  });

  it("constants/photoLabeling.js is physically deleted", () => {
    const p = path.join(ADMIN_ROOT, "src", "constants", "photoLabeling.js");
    assert.equal(
      fs.existsSync(p),
      false,
      `expected constants/photoLabeling.js to be deleted; still exists at ${p}`,
    );
  });

  it("App.jsx no longer imports PhotoLabelingPage or PhotoScorerPage", () => {
    const src = fs.readFileSync(path.join(ADMIN_ROOT, "src", "App.jsx"), "utf8");
    const importLines = src
      .split("\n")
      .filter((line) => /^\s*import\s/.test(line));
    for (const sym of ["PhotoLabelingPage", "PhotoScorerPage"]) {
      for (const line of importLines) {
        assert.equal(
          line.includes(sym),
          false,
          `App.jsx import line must not reference ${sym}: '${line.trim()}'`,
        );
      }
    }
  });

  it("PhotoLightbox.jsx is RETAINED (shared UI primitive consumed by SignalAnchorsTab)", () => {
    const lightboxPath = path.join(
      ADMIN_ROOT,
      "src",
      "components",
      "ui",
      "PhotoLightbox.jsx",
    );
    assert.equal(
      fs.existsSync(lightboxPath),
      true,
      "PhotoLightbox.jsx must remain — used by placeIntelligenceTrial/SignalAnchorsTab.jsx",
    );
    const anchorsTabPath = path.join(
      ADMIN_ROOT,
      "src",
      "components",
      "placeIntelligenceTrial",
      "SignalAnchorsTab.jsx",
    );
    const anchorsSrc = fs.readFileSync(anchorsTabPath, "utf8");
    assert.ok(
      anchorsSrc.includes("PhotoLightbox"),
      "SignalAnchorsTab.jsx must still import PhotoLightbox",
    );
  });
});
