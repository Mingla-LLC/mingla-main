// ORCH-1008 Phase 1 regression test — flat sidebar + 6 deleted pages absent.
// Fails on revert (verified at commit hash recorded in implementation report).

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
  "signals",
  "photo-labeling",
  "photo-scorer",
  "place-intelligence-trial",
  "email",
  "claims",
  "users",
  "settings",
];

describe("ORCH-1008 Phase 1 — sidebar prune + flatten", () => {
  it("NAV_GROUPS contains exactly one group with label:null", () => {
    assert.equal(NAV_GROUPS.length, 1, "expected exactly 1 nav group");
    assert.equal(NAV_GROUPS[0].label, null, "the single group must have label:null");
    assert.notEqual(NAV_GROUPS[0].collapsible, true, "the single group must not be collapsible");
  });

  it("NAV_GROUPS has exactly 12 items in the locked SPEC order", () => {
    const ids = NAV_GROUPS[0].items.map((i) => i.id);
    assert.deepEqual(ids, EXPECTED_IDS);
  });

  it("NAV_GROUPS does NOT contain any of the 6 deleted ids", () => {
    const ids = new Set(NAV_GROUPS.flatMap((g) => g.items).map((i) => i.id));
    for (const bad of DELETED_IDS) {
      assert.equal(ids.has(bad), false, `nav must not include deleted id '${bad}'`);
    }
  });

  it("NAV_ITEMS is the flat 12-item list (no group splits)", () => {
    assert.equal(NAV_ITEMS.length, 12);
    assert.deepEqual(NAV_ITEMS.map((i) => i.id), EXPECTED_IDS);
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
