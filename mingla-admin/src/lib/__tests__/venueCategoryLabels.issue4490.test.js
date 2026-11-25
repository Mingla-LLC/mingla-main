// #4490 G1 - every Admin place that shows a venue type reads one label map, so a
// new type never shows its raw key ("bar_lounge", "club").
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VENUE_CATEGORY_LABELS, venueCategoryLabel } from "../venueCategoryLabels.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, "..", "..", rel), "utf8");

test("all nine types have a plain label", () => {
  assert.deepEqual(Object.keys(VENUE_CATEGORY_LABELS).sort(), [
    "bar_lounge", "cafe", "club", "coworking", "creative_and_arts", "event_space", "play", "restaurant", "stay",
  ]);
  assert.equal(venueCategoryLabel("bar_lounge"), "Bar and lounge");
  assert.equal(venueCategoryLabel("club"), "Club");
  for (const label of Object.values(VENUE_CATEGORY_LABELS)) assert.ok(!label.includes("_"));
});

test("an unknown key is made readable, never raw", () => {
  assert.equal(venueCategoryLabel("night_market"), "Night market");
  assert.equal(venueCategoryLabel(null), "—");
});

test("the claims list, claim detail, correction panel and venue detail use the shared labels", () => {
  assert.match(read("components/claims/ClaimRow.jsx"), /venueCategoryLabel\(row\.venue_category\)/);
  assert.match(read("pages/ClaimsPage.jsx"), /venueCategoryLabels/);
  assert.match(read("components/claims/PendingVenueIdentityCorrectionPanel.jsx"), /VENUE_CATEGORY_LABELS/);
  assert.match(read("pages/VenueDetailView.jsx"), /venueCategoryLabel\(v\.venue_category\)/);
});

test("the claims list says the city once", () => {
  const src = read("components/claims/ClaimRow.jsx");
  assert.match(src, /addressText\.includes\(String\(row\.city\)\.toLowerCase\(\)\)/);
});
