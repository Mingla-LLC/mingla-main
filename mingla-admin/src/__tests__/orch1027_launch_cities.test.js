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

describe("ORCH-1027 — nav wiring", () => {
  it("registers the launch-cities nav item with the Rocket icon", () => {
    assert.match(CONSTANTS, /id:\s*"launch-cities"/);
    assert.match(CONSTANTS, /label:\s*"Launch Cities"/);
    assert.match(CONSTANTS, /icon:\s*"Rocket"/);
  });

  it("routes #/launch-cities to LaunchCitiesPage in App.jsx PAGES", () => {
    assert.match(APP, /import\s*\{\s*LaunchCitiesPage\s*\}\s*from\s*"\.\/pages\/LaunchCitiesPage"/);
    assert.match(APP, /"launch-cities":\s*LaunchCitiesPage/);
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

describe("ORCH-1027 — boundary action is bbox-only (I-LC-STATUS-ORTHOGONAL)", () => {
  it("persists center + bbox + updated_at and NOTHING else", () => {
    // The boundary save update must include the 6 geometry fields + updated_at.
    assert.match(PAGE, /bbox_sw_lat:\s*vp\.swLat/);
    assert.match(PAGE, /bbox_ne_lng:\s*vp\.neLng/);
    assert.match(PAGE, /center_lat:\s*geocodeResult\.center\.lat/);
    assert.match(PAGE, /updated_at:\s*new Date\(\)\.toISOString\(\)/);
  });

  it("NEVER mutates is_live_for_consumers / status / tile_radius_m from the boundary save", () => {
    // Scope the check to the boundary update payload (between the .update({ in
    // handleSave and its closing }).eq).
    const saveStart = PAGE.indexOf("// LOCKED (SPEC §B.4)");
    const saveEnd = PAGE.indexOf('}).eq("id", city.city_id)', saveStart);
    assert.ok(saveStart > -1 && saveEnd > saveStart, "boundary save payload located");
    const payload = PAGE.slice(saveStart, saveEnd);
    assert.ok(!/is_live_for_consumers\s*:/.test(payload), "must not write is_live_for_consumers");
    assert.ok(!/status\s*:/.test(payload), "must not write status");
    assert.ok(!/tile_radius_m\s*:/.test(payload), "must not write tile_radius_m");
    assert.ok(!/generate_tiles/.test(payload), "must not regenerate tiles");
  });

  it("reuses the existing admin-seed-places geocode_city action (no new edge fn)", () => {
    assert.match(PAGE, /supabase\.functions\.invoke\("admin-seed-places"/);
    assert.match(PAGE, /action:\s*"geocode_city"/);
  });
});
