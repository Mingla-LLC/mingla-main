// ORCH-1014 Finding A regression test — Photo Labeling + Photo Scorer
// removed from sidebar; the 10 surviving items render in the locked order.
//
// Fails-on-revert: if either nav item is re-added or one of the 2 deleted
// page files is restored, this test FAILS.

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
  "signals",
  "place-intelligence-trial",
  "email",
  "claims",
  "users",
  "settings",
];

const ORCH_1014_DELETED_IDS = ["photo-labeling", "photo-scorer"];

const ORCH_1014_DELETED_PAGES = [
  "PhotoLabelingPage.jsx",
  "PhotoScorerPage.jsx",
];

describe("ORCH-1014 Finding A — photo pages pruned + 10-item sidebar", () => {
  it("NAV_GROUPS has exactly 10 items in the locked post-ORCH-1014 order", () => {
    assert.equal(NAV_GROUPS.length, 1, "expected exactly 1 nav group");
    const ids = NAV_GROUPS[0].items.map((i) => i.id);
    assert.equal(ids.length, 10, "expected exactly 10 nav items");
    assert.deepEqual(ids, EXPECTED_IDS_POST_1014);
  });

  it("NAV_ITEMS is the flat 10-item list (no photo-labeling, no photo-scorer)", () => {
    assert.equal(NAV_ITEMS.length, 10);
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
