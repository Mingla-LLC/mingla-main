import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { comparableValueCents, toCampaignRoiView } from "../lib/adRoi.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

// [TEST-MOD-APPROVED #3697] Wave 2 single-select replaces multi-select append
// (`[...selected, row]`). Tabs stay Event → Stay → Brand; toggle replaces.
test("issue #1431 Campaign Builder shows Event, Stay, Brand in exact order and single-selects", () => {
  const step = read("src/components/campaign-builder/StepDestination.jsx");
  assert.ok(step.indexOf('id: "event"') < step.indexOf('id: "venue"'));
  assert.ok(step.indexOf('id: "venue"') < step.indexOf('id: "brand"'));
  assert.match(step, /listStayDestinations/);
  assert.match(step, /onDestinationsChange\(isSelected \? \[\] : \[row\]\)/);
  assert.doesNotMatch(step, /\[\.\.\.selected, row\]/);
  assert.match(step, /row\.cover_media_url[\s\S]*bg-\[var\(--gray-100\)\]/);
});

// [TEST-MOD-APPROVED #3697] Wave 1 lists Stay via `ad_advertisable_pages`
// (SQL still reads `ad_public_stay_destinations_view`). Pin the RPC + stayUrl
// helper instead of a client-side view string in the Admin service.
test("issue #1431 Stay destination reader and create payload use one canonical public venue shape", () => {
  const service = read("src/services/adDestinationsService.js");
  const builder = read("src/pages/CampaignBuilderPage.jsx");
  const migration = read("../supabase/migrations/20270814003697_issue_3697_wave1_advertisable_pages.sql");
  assert.match(service, /ad_advertisable_pages/);
  assert.match(service, /\/b\/\$\{brandSlug\}\/v\/\$\{slug\}/);
  assert.match(migration, /ad_public_stay_destinations_view/);
  assert.match(builder, /dest\.page_type === "brand" \? null : dest\.slug/);
});

test("issue #1431 reports Stay funnel money per currency and never sums mixed currencies", () => {
  const page = read("src/pages/CampaignsPage.jsx");
  assert.match(page, /Stay booking funnel/);
  assert.match(page, /grossByCurrency/);
  assert.match(page, /refundsByCurrency/);
  assert.match(page, /netByCurrency/);
  assert.match(page, /Intl\.NumberFormat/);
  assert.equal(comparableValueCents({ NGN: 5000, USD: 200 }), null);
  assert.equal(comparableValueCents({ NGN: 5000 }), 5000);
  const roi = toCampaignRoiView({
    conversions: 2,
    value_cents: { NGN: 5000, USD: 200 },
    spend_cents: 100,
  });
  assert.equal(roi.valueCents, null);
  assert.equal(roi.roas, null);
});
