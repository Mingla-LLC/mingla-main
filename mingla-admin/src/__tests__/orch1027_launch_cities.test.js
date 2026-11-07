// ORCH-1027 [Launch Cities admin control] — admin UI source-inspect tests.
//
// SPEC:   Mingla_Artifacts/specs/SPEC_ORCH-1027_LAUNCH_CITIES_ADMIN.md (§B)
// DESIGN: Mingla_Artifacts/specs/DESIGN_ORCH-1027_LAUNCH_CITIES_TAB.md (§9)
//
// Source-inspect pattern (same as orch1008_*/orch1009_* tests): boots no React;
// reads the JSX file as text + asserts the load-bearing behavior exists. These
// FAIL on revert — removing the optimistic-rollback path, the bbox-only persist
// guard, or the nav wiring flips the matching assertion → fail.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");

const PAGE = fs.readFileSync(
  path.join(ADMIN_ROOT, "src", "pages", "LaunchCitiesPage.jsx"),
  "utf8",
);
const CONSTANTS = fs.readFileSync(
  path.join(ADMIN_ROOT, "src", "lib", "constants.js"),
  "utf8",
);
const APP = fs.readFileSync(path.join(ADMIN_ROOT, "src", "App.jsx"), "utf8");
const ROUTES = fs.readFileSync(path.join(ADMIN_ROOT, "src", "lib", "adminRoutes.js"), "utf8");
// #4130 (Wave 4b): Place pool is a real page; its Cities tab draws this page.
const PLACE_POOL = fs.readFileSync(path.join(ADMIN_ROOT, "src", "pages", "PlacePoolPage.jsx"), "utf8");
const SYSTEM = fs.readFileSync(path.join(ADMIN_ROOT, "src", "lib", "systemPages.js"), "utf8");

describe("ORCH-1027 — nav wiring", () => {
  // #4130: Launch Cities is the Cities tab of Place pool; #/launch-cities redirects there.
  it("registers launch-cities as the Cities tab of Place pool", () => {
    assert.match(ROUTES, /"launch-cities": Object\.freeze\(\{ page: "placepool", tab: "cities" \}\)/);
    assert.match(SYSTEM, /\{ id: "cities", label: "Cities" \}/);
  });

  it("draws the Cities tab with LaunchCitiesPage", () => {
    assert.match(PLACE_POOL, /import\s*\{\s*LaunchCitiesPage\s*\}\s*from\s*"\.\/LaunchCitiesPage"/);
    assert.match(PLACE_POOL, /tab === "cities" && <LaunchCitiesPage \/>/);
  });
});

describe("ORCH-1027 — live toggle (constitutional no-silent-failure)", () => {
  it("calls admin_set_city_live with city id + next value", () => {
    assert.match(PAGE, /supabase\.rpc\(\s*"admin_set_city_live"/);
    assert.match(PAGE, /p_city_id:\s*row\.city_id/);
    assert.match(PAGE, /p_live:\s*next/);
  });

  it("is optimistic: flips the row's flag BEFORE awaiting the write", () => {
    // The optimistic setRows-to-`next` must precede the try/await.
    const optimisticIdx = PAGE.indexOf("is_live_for_consumers: next");
    const awaitIdx = PAGE.indexOf('supabase.rpc("admin_set_city_live"');
    assert.ok(optimisticIdx > -1, "optimistic flip to next present");
    assert.ok(awaitIdx > -1, "rpc call present");
    assert.ok(optimisticIdx < awaitIdx, "optimistic flip happens before the rpc await");
  });

  it("rolls back VISIBLY to prev on failure + fires an error toast", () => {
    // catch block must restore prev AND surface an error toast (never silent).
    assert.match(PAGE, /catch\s*\(err\)\s*\{[\s\S]*?is_live_for_consumers:\s*prev[\s\S]*?variant:\s*"error"/);
    assert.match(PAGE, /title:\s*`Couldn't update \$\{row\.city_name\}`/);
  });

  it("disables the toggle while the write is in flight (togglingIds Set)", () => {
    assert.match(PAGE, /togglingIds\.has\(row\.city_id\)/);
    assert.match(PAGE, /disabled=\{togglingIds\.has\(row\.city_id\)\}/);
  });
});

describe("ORCH-1027 — real counts only (no placeholders)", () => {
  it("renders servable counts straight from the RPC row, never fabricated", () => {
    assert.match(PAGE, /supabase\.rpc\("admin_launch_city_list"\)/);
    assert.match(PAGE, /row\.is_servable_places/);
    assert.match(PAGE, /row\.total_active_places/);
  });
});

// #4276 (B1): Cities no longer writes a box. Its boundary modal wrote Google's viewport
// straight over the stored box (it could shrink it, and kept the old tiles). Boxes now
// change only in the Place pool pipeline through apply_city_box, which keeps the larger
// edge, rebuilds tiles with their history and counts places that fall outside.
describe("#4276 — Cities never writes a geo box (I-LC-STATUS-ORTHOGONAL still holds)", () => {
  it("has no box writer and no geocode of its own", () => {
    assert.ok(!/from\("seeding_cities"\)\s*\.update\(/.test(PAGE), "no direct seeding_cities update");
    assert.ok(!/bbox_sw_lat\s*:/.test(PAGE), "no bbox field written");
    assert.ok(!/action:\s*"geocode_city"/.test(PAGE), "no geocode from Cities");
  });

  it("the only city write is going live, through admin_set_city_live", () => {
    assert.ok(!/\.update\(\{/.test(PAGE), "no table update at all");
    assert.match(PAGE, /supabase\.rpc\("admin_set_city_live"/);
  });

  it("readiness counts the gaps, and a failed count is said", () => {
    // #4276 design pass: the design's readiness words, from the same gap count.
    assert.match(PAGE, /cityLaunchState\(row, gaps\[row\.city_id\] \?\? null\)/);
    assert.match(PAGE, /Gaps couldn't be counted/);
  });
});
