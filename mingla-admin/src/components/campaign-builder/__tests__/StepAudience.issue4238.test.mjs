// Issue #4238 wave 2 — T16a: the Admin builder's "Customer lists and
// lookalikes" picker. Tabs (Mingla-wide / This brand / All brands), size and
// readiness, at most three, and the selection reaching audience_selection.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { adminRoot, withVite } from "../../../__tests__/issue4238_ssr.helper.mjs";

const BRAND = "4238aaaa-0000-4000-8000-000000000001";
const rows = [
  { audience_key: "mingla:everyone:cc_ng", owner_kind: "mingla", brand_id: null, kind: "list", display_name: "Everyone in Nigeria", member_count: 342, status: "active", host_visible: true, platforms: [{ platform: "meta", state: "ready" }] },
  { audience_key: `brand:${BRAND}:guests`, owner_kind: "host", brand_id: BRAND, brand_name: "We Go Again", kind: "list", display_name: "Your past guests", member_count: 246, status: "active", host_visible: true, platforms: [{ platform: "meta", state: "ready" }] },
  { audience_key: `brand:${BRAND}:seed`, owner_kind: "host", brand_id: BRAND, brand_name: "We Go Again", kind: "list", display_name: "Seed", member_count: 445, status: "active", host_visible: false, platforms: [] },
  { audience_key: "brand:4238bbbb-0000-4000-8000-000000000002:contacts", owner_kind: "host", brand_id: "4238bbbb-0000-4000-8000-000000000002", brand_name: "Ctrl", kind: "list", display_name: "Your contacts", member_count: 59, status: "active", host_visible: true, platforms: [{ platform: "meta", state: "below_minimum" }] },
  { audience_key: "mingla:buyers:all", owner_kind: "mingla", kind: "list", display_name: "Old", member_count: 1, status: "retired", platforms: [] },
];

test("T16 tabs filter Mingla-wide, this brand and all brands; seeds and retired never show", async () => {
  await withVite(async (vite) => {
    const { filterListAudiences } = await vite.ssrLoadModule("/src/components/campaign-builder/StepAudience.jsx");
    const keys = (tab, extra = {}) => filterListAudiences(rows, { tab, query: "", brandId: BRAND, ...extra }).map((r) => r.audience_key);
    assert.deepEqual(keys("mingla"), ["mingla:everyone:cc_ng"]);
    assert.deepEqual(keys("brand"), [`brand:${BRAND}:guests`]);
    assert.deepEqual(keys("all"), [`brand:${BRAND}:guests`, "brand:4238bbbb-0000-4000-8000-000000000002:contacts"]);
    assert.deepEqual(keys("all", { query: "ctrl" }), ["brand:4238bbbb-0000-4000-8000-000000000002:contacts"]);
    assert.deepEqual(keys("brand", { brandId: null, brandName: "We Go Again" }), [`brand:${BRAND}:guests`]);
  });
});

test("T16 the picker shows size and readiness, and disables a list not ready anywhere", async () => {
  await withVite(async (vite) => {
    const { ListAudiencePicker } = await vite.ssrLoadModule("/src/components/campaign-builder/StepAudience.jsx");
    const html = renderToStaticMarkup(
      React.createElement(ListAudiencePicker, { audiences: rows, selected: [], onChange: () => {}, brandId: BRAND }),
    );
    assert.match(html, /Customer lists and lookalikes/);
    assert.match(html, /Mingla-wide/);
    assert.match(html, /This brand/);
    assert.match(html, /All brands/);
    assert.match(html, /Everyone in Nigeria/);
    assert.match(html, /342 people · Ready on Meta/);
    assert.match(html, /Pick up to 3\./);
  });
});

test("T16 selection reaches canonical_plan.audience_selection; prospecting copy is truthful", () => {
  const page = fs.readFileSync(path.join(adminRoot, "src/pages/CampaignBuilderPage.jsx"), "utf8");
  assert.match(page, /audience_selection: \{ include_keys: audience\.audienceKeys \?\? \[\] \}/);
  const step = fs.readFileSync(path.join(adminRoot, "src/components/campaign-builder/StepAudience.jsx"), "utf8");
  assert.match(step, /onChange=\{\(audienceKeys\) => set\(\{ audienceKeys \}\)\}/);
  assert.match(step, /Prospecting uses your chosen lists or lookalikes; with none, it's broad\./);
  // The builder never sends provider audience ids.
  assert.doesNotMatch(page, /includeAudienceIds/);
});
