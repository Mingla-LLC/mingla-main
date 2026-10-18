/**
 * toward #3697 — v1.4 Admin Ads information architecture contract.
 *
 * [TEST-MOD-APPROVED #3697] This suite pins the approved one-workspace,
 * five-stage design while preserving legacy route compatibility.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { NAV_GROUPS } from "../lib/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(SRC, relativePath), "utf8");

describe("#3697 Admin Ads v1.4 IA", () => {
  it("offers one Ads entry in Growth", () => {
    const growth = NAV_GROUPS.find((group) => group.label === "Growth");
    assert.deepEqual(growth?.items, [
      { id: "ad-engine", label: "Ads", icon: "Megaphone" },
    ]);
  });

  it("keeps campaigns and creative in the unified Ads workspace", () => {
    const page = read("pages/AdEnginePage.jsx");
    for (const label of [
      "Overview",
      "Campaigns",
      "Creative Library",
      "Connections",
    ]) {
      assert.match(page, new RegExp(`label: "${label}"`));
    }
    assert.match(page, /<CampaignsPage embedded \/>/);
    assert.match(page, /<CreativeLibraryPanel \/>/);
    assert.match(page, /Infrastructure IDs stay hidden from operators/);
  });

  it("presents exactly the five approved campaign stages", () => {
    const page = read("pages/CampaignBuilderPage.jsx");
    const stepsBlock = page.match(/const STEPS = \[([\s\S]*?)\n\];/);
    assert.ok(stepsBlock, "CampaignBuilderPage must declare STEPS");
    const ids = [...stepsBlock[1].matchAll(/id: "([^"]+)"/g)].map(
      (match) => match[1],
    );
    assert.deepEqual(ids, [
      "promote",
      "audience",
      "budget",
      "creative",
      "review",
    ]);
    assert.match(page, /lane: "promote"/);
    assert.match(page, /destination: "promote"/);
    assert.match(page, /copy: "creative"/);
    assert.match(page, /policy: "creative"/);
  });
});
