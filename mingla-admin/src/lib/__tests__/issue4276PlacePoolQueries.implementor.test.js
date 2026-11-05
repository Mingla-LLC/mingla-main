// Issue #4276 U4 and U5: the admin's place lists read columns that exist, without
// the heavy ones, and removal goes through the audited RPC.
//
// MINGLA-INVARIANT: I-4276-ADMIN-PLACE-LISTS-NO-DROPPED-COLUMNS | issue #4276 | Map, Browse and Excluded select no dropped place_pool column and no raw_google_data, and use no exact count
//
// A PostgREST select naming a dropped column fails the whole query, and the map
// ignored the error, so it showed no places for any city.
//
// FAILS-ON-REVERT: restore any of the old selects, filters or the direct update in
// PlacePoolManagementPage.jsx and the page checks below fail.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  adminDeactivateError,
  PLACE_CATEGORY_COLUMN,
  PLACE_LIST_COLUMNS,
  PLACE_LIST_COUNT_MODE,
  PLACE_MAP_COLUMNS,
} from "../placePoolQueries.js";

const page = readFileSync(new URL("../../pages/PlacePoolManagementPage.jsx", import.meta.url), "utf8");
const seedTab = readFileSync(new URL("../../components/seeding/SeedTab.jsx", import.meta.url), "utf8");

// Dead columns and payload hogs, as whole column names.
const FORBIDDEN = ["ai_categories", "seeding_category", "raw_google_data", "reviews"];

const columnsOf = (list) => list.split(",").map((c) => c.trim());

test("list columns name nothing dropped and nothing heavy", () => {
  for (const list of [PLACE_MAP_COLUMNS, PLACE_LIST_COLUMNS]) {
    for (const bad of FORBIDDEN) assert.equal(columnsOf(list).includes(bad), false, bad);
    assert.ok(columnsOf(list).includes(`mingla_category:${PLACE_CATEGORY_COLUMN}`));
  }
  assert.notEqual(PLACE_LIST_COUNT_MODE, "exact");
});

test("every place_pool select on the page uses the shared columns", () => {
  assert.equal(page.includes('.select("id, name, lat, lng, rating, ai_categories'), false, "the map's dead select is back");
  assert.equal(page.includes('"*, place_discovery_price_ranges'), false, "Browse selects raw_google_data again");
  assert.equal(page.includes('.select("*", { count: "exact" })'), false, "Excluded selects everything with an exact count");
  assert.ok(page.includes(".select(PLACE_MAP_COLUMNS)"));
  assert.ok(page.includes("`${PLACE_LIST_COLUMNS}, place_discovery_price_ranges("));
  assert.ok(page.includes(".select(PLACE_LIST_COLUMNS, { count: PLACE_LIST_COUNT_MODE })"));
});

test("category filters use the computed column", () => {
  assert.equal(page.includes('q.contains("ai_categories"'), false);
  assert.equal(page.includes('q.eq("seeding_category"'), false);
  assert.equal((page.match(/q\.eq\(PLACE_CATEGORY_COLUMN, /g) ?? []).length, 2);
});

test("the map reports a failed load instead of showing no places", () => {
  assert.ok(page.includes("q.limit(3000).then(({ data, error }) => {"));
  assert.ok(page.includes("The map could not load places:"));
});

test("Excluded removal goes through the audited RPC", () => {
  assert.equal(page.includes('.from("place_pool").update({ is_active: false })'), false, "a direct, unaudited write is back");
  assert.ok(page.includes('supabase.rpc("admin_deactivate_place", {'));
});

test("an RPC refusal returned as data is still an error", () => {
  assert.equal(adminDeactivateError({ data: { success: true }, error: null }), null);
  assert.equal(adminDeactivateError({ data: { error: "Place not found or already inactive" }, error: null }), "Place not found or already inactive");
  assert.equal(adminDeactivateError({ data: null, error: { message: "Forbidden" } }), "Forbidden");
});

test("no screen states a hard-coded count of categories", () => {
  assert.equal(page.includes("× 13 categories"), false);
  assert.equal(seedTab.includes("of 13 categories"), false);
  assert.equal(page.includes("totalCats.size >= 13"), false);
});
