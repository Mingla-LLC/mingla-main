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

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_GROUPS, NAV_ITEMS } from "../lib/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");

const EXPECTED_IDS_POST_1014 = [
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

const ORCH_1014_DELETED_IDS = ["photo-labeling", "photo-scorer"];

const ORCH_1014_DELETED_PAGES = [
  "PhotoLabelingPage.jsx",
  "PhotoScorerPage.jsx",
];

describe("ORCH-1014 Finding A — photo pages pruned + locked sidebar order", () => {
  it("the primary nav group has exactly 19 items in the locked post-ORCH-1014 (ISSUE-1354-reconciled) order", () => {
    // [TEST-MOD-APPROVED ISSUE-1354] The flat-single-group assertion
    // (NAV_GROUPS.length === 1) is SUPERSEDED: ORCH-1271 added a "Business"
    // group and ISSUE-862 added a "Growth" group, so the shipped sidebar now has
    // 3 groups. group[0] remains the primary flat group (label:null) carrying the
    // locked order below. (Discovery flagged: retire I-PROPOSED-ADMIN-SHELL-FLAT-
    // NAVIGATION in the registry.)
    assert.equal(NAV_GROUPS[0].label, null, "group[0] must remain the primary flat group (label:null)");
    const ids = NAV_GROUPS[0].items.map((i) => i.id);
    assert.equal(ids.length, 19, "expected exactly 19 items in the primary nav group");
    assert.deepEqual(ids, EXPECTED_IDS_POST_1014);
  });

  it("NAV_ITEMS never includes the ORCH-1014-deleted photo ids", () => {
    // [TEST-MOD-APPROVED ISSUE-1354] NAV_ITEMS now spans all 3 groups (no longer
    // a flat single list), so the brittle exact-count assertion is replaced by
    // the load-bearing invariant: the deleted photo ids stay absent, and the
    // primary group holds the locked 19-item snapshot.
    assert.equal(NAV_GROUPS[0].items.length, 19, "primary group must hold the locked 19-item snapshot");
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
