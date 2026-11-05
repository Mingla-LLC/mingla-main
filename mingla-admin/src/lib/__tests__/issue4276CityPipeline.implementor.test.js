// Issue #4276 wave 4 (U1 to U5): the Place pool pipeline screens.
//
// MINGLA-INVARIANT: I-4276-ADMIN-NO-WHOLE-CITY-SCORING | issue #4276 | No admin screen can score a whole city or every city, so nothing in the UI can release the held rescore backlog
// MINGLA-INVARIANT: I-4276-SERPER-COST-NEVER-INVENTED | issue #4276 | With no Serper rate set, every screen says its cost is unknown; it is never shown as $0 or a guessed price
//
// FAILS-ON-REVERT: put a run-signal-scorer call back in any admin source and the
// no-scoring test fails. Make serperCostText fall back to a price and the unknown-cost
// test fails. Route #/place-intelligence-trial back to Settings, or drop the Intelligence
// components from the pipeline, and the reachability test fails. Remove the
// places_outside_box read from the box panel and the outside-box test fails.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  approvalLines,
  cityGaps,
  cityReadinessWithGaps,
  completenessSummary,
  plural,
  formatGb,
  matrixCells,
  pendingApproval,
  pipelineFunnelSteps,
  ratePerRequestFrom,
  reasonRows,
  serperCostText,
  spendSummary,
  usd,
} from "../cityPipeline.js";
import { redirectHash, RETIRED_PAGE_REDIRECTS } from "../adminRoutes.js";
import { PLACE_POOL_TABS, SETTINGS_SECTIONS, placePoolTabFor } from "../systemPages.js";

const SRC = new URL("../../", import.meta.url).pathname;
const read = (rel) => readFileSync(join(SRC, rel), "utf8");
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

test("no admin screen can score a city or every city (the held backlog stays held)", () => {
  for (const file of sourceFiles(SRC)) {
    const code = stripComments(readFileSync(file, "utf8"));
    assert.equal(code.includes("run-signal-scorer"), false, `${file} calls the scorer`);
    assert.equal(/all_cities\s*:\s*true/.test(code), false, `${file} sends all_cities`);
  }
  assert.equal(existsSync(join(SRC, "pages/SignalLibraryPage.jsx")), false, "the standalone Signal Library is retired");
});

test("Serper's cost is unknown until a rate is set, never $0", () => {
  assert.equal(serperCostText(1200, null), "1,200 Serper requests, cost unknown until a rate is set");
  assert.equal(serperCostText(1000, 0.001), "1,000 Serper requests, $1.00");
  assert.equal(usd(null), "unknown");
  const s = spendSummary({ rows: [{ provider: "serper", units: 40, actual_usd: null }], known_actual_usd: 3, serper_requests: 40, serper_cost_known: false, serper_usd_per_request: null });
  assert.equal(s.serperUsd, null);
  assert.match(s.serperText, /cost unknown until a rate is set/);
  const lines = approvalLines({ numbers: { places: 10, serper_requests_max: 50, estimatedCostUsd: 0.089 } }, null);
  assert.ok(lines.some((l) => l.includes("cost unknown")), lines.join(" | "));
  assert.deepEqual(ratePerRequestFrom(""), { ok: true, value: null });
  assert.deepEqual(ratePerRequestFrom("1"), { ok: true, value: 0.001 });
  assert.equal(ratePerRequestFrom("-1").ok, false);
});

test("the Intelligence run is reachable again from Place pool (the #4130 regression)", () => {
  assert.deepEqual({ ...RETIRED_PAGE_REDIRECTS["place-intelligence-trial"] }, { page: "placepool", tab: "pipeline" });
  assert.equal(redirectHash("#/place-intelligence-trial"), "#/placepool?tab=pipeline");
  assert.equal(SETTINGS_SECTIONS.includes("intelligence-trial"), false);
  const settings = read("pages/SettingsPage.jsx");
  assert.equal(/Retired research|Research history|research-only/i.test(settings), false);
  const section = read("components/placePool/PipelineSection.jsx");
  assert.ok(section.includes("<ActiveRunsControlTower />"));
  assert.ok(section.includes("<IntelligenceOverviewTab />"));
  const page = read("pages/PlacePoolPage.jsx");
  assert.ok(page.indexOf("<PipelineSection />") > 0 && page.indexOf("<PipelineSection />") < page.indexOf("<Tabs "), "the pipeline sits above the tabs");
  assert.deepEqual(PLACE_POOL_TABS.map((t) => t.id), ["overview", "cities", "browse", "map", "excluded"]);
  assert.equal(placePoolTabFor("pipeline"), "overview");
  for (const gone of ["pages/PlaceIntelligenceTrialPage.jsx", "components/placeIntelligenceTrial/TrialResultsTab.jsx"]) {
    assert.equal(existsSync(join(SRC, gone)), false, `${gone} (sample mode and the results explorer) is retired`);
  }
});

test("the box panel warns about places outside the box before anything changes", () => {
  const panel = read("components/placePool/CityBoxPanel.jsx");
  assert.ok(panel.includes('seeding("places_outside_box", { cityId })'));
  assert.ok(panel.includes('<OutsideLine label="Current box" row={outside} />'));
  assert.ok(panel.includes('<OutsideLine label="Proposed box" row={plan.placesOutside} />'));
  assert.ok(panel.includes("would sit outside. Nothing is deleted."));
});

test("a run always has a spend limit, and a whole-city re-check asks first", () => {
  const run = read("components/placePool/CityRunPanel.jsx");
  assert.ok(run.includes("disabled={!limitOk || starting}"));
  assert.ok(run.includes("onClick={() => (wholeCity ? setConfirmWhole(true) : start())}"));
  assert.ok(run.includes('confirmWholeCity: wholeCity ? true : undefined'));
  assert.ok(run.includes('scope: wholeCity ? "whole_city" : "new_only"'));
});

test("the funnel has every stage, each a share of active places", () => {
  const steps = pipelineFunnelSteps({ active: 200, pre_passed: 150, with_photos: 120, servable: 100, reviews: 40, intelligence: 60, scored: 90 });
  assert.deepEqual(steps.map((s) => [s.key, s.share]), [
    ["active", 100], ["pre_passed", 75], ["with_photos", 60], ["servable", 50], ["reviews", 20], ["intelligence", 30], ["scored", 45],
  ]);
  assert.equal(pipelineFunnelSteps(null), null);
});

test("readiness counts the gaps; unknown searches are said, not read as none", () => {
  const funnelRow = { rules_only: 1204, no_reviews: 300, held: 2 };
  const gaps = cityGaps(funnelRow, { uncoveredTiles: 31, unfinishedSearches: 4, cappedOpen: 12 }, { outside_active: 2760 });
  const r = cityReadinessWithGaps({ is_servable_places: 5000, total_active_places: 9000 }, gaps);
  assert.equal(r.key, "gaps");
  assert.deepEqual(r.gaps, ["1,204 without Intelligence", "300 without reviews", "31 areas never searched", "4 searches unfinished", "Box flagged: 2,760 places outside it"]);
  const unknown = cityGaps({}, { error: "timeout" }, null);
  assert.ok(cityReadinessWithGaps({ is_servable_places: 10 }, unknown).gaps.includes("Searches couldn't be checked"));
  assert.equal(cityReadinessWithGaps({ is_servable_places: 10 }, unknown).key, "gaps");
  assert.equal(cityReadinessWithGaps({ is_live_for_consumers: true, is_servable_places: 10 }, gaps).label, "Live");
});

test("the gaps table marks only real gaps, and '?' when searches are unknown", () => {
  const cells = matrixCells(
    { active: 100, pre_checked: 90, pre_passed: 80, with_photos: 70, final_checked: 70, servable: 60, scored: 55, no_reviews: 5, rules_only: 0, held: 0 },
    null,
    { outside_active: 0 },
  );
  const by = Object.fromEntries(cells.map((c) => [c.id, c]));
  assert.equal(by.pre_check.text, "10");
  assert.equal(by.photos.text, "10");
  assert.equal(by.final_check.text, "done");
  assert.equal(by.intelligence.gap, false);
  assert.equal(by.score.text, "5");
  assert.equal(by.unsearched.text, "?");
  assert.equal(by.box.text, "done");
});

test("a waiting run's approval comes from its own pause detail", () => {
  assert.equal(pendingApproval({ status: "paused", pause_detail: { key: "k" } }), null);
  const a = pendingApproval({ status: "awaiting_approval", pause_reason: "high_cost", current_stage: "fill", pause_detail: { key: "fill:900", numbers: { searches: 900 } } });
  assert.deepEqual([a.key, a.stage, a.highCost], ["fill:900", "fill", true]);
});

test("exclusion reasons read in words, with shares of the places that failed", () => {
  const rows = reasonRows([{ rule: "B4", places: 50 }, { rule: "B99", places: 5 }], 100);
  assert.deepEqual(rows.map((r) => [r.label, r.share]), [["No website", 50], ["Other (B99)", 5]]);
  assert.equal(formatGb(7516192768), "7.0 GB");
  assert.equal(formatGb(null), "unknown");
});

// #4276 rework (P1-2): a failed check read as success with 0% missing.
test("a failed completeness check says it failed, and an unmeasured share is unknown, never 0%", () => {
  const failed = completenessSummary({ status: "failed", searches_failed: 3, searches_planned: 20, missing_share: null, created_at: "2026-11-05T10:00:00Z" });
  assert.equal(failed.failed, true);
  assert.match(failed.text, /^Completeness check failed \(3 of 20 searches failed\)/);
  const unknown = completenessSummary({ status: "completed", missing_share: null, created_at: "2026-11-05T10:00:00Z" });
  assert.match(unknown.text, /share missing unknown$/);
  assert.doesNotMatch(unknown.text, /0%/);
  assert.match(completenessSummary({ status: "completed", missing_share: 0.12 }).text, /12% missing$/);
  const panel = read("components/placePool/CityBoxPanel.jsx");
  assert.equal(/missing_share \?\? 0/.test(panel), false, "the panel must not default an unknown share to 0");
  assert.ok(panel.includes("completenessSummary(res)") && panel.includes("<Check ok={false} bad text={completenessSummary(last).text} />"));
});

// #4276 rework (P4, P2-2, P3): words for one, the map in the box panel, accessible controls.
test("one place reads as one place", () => {
  assert.equal(plural(1, "place"), "1 place");
  assert.equal(plural(2, "place"), "2 places");
  assert.equal(plural(1, "search", "searches"), "1 search");
  const section = read("components/placePool/PipelineSection.jsx");
  assert.ok(section.includes('"Give 1 place its city"'));
  assert.equal(/\{count\(report\.total\)\} places/.test(section), false);
});

test("the box panel draws boxes and tiles on the map, and asks before a paid geocode", () => {
  const panel = read("components/placePool/CityBoxPanel.jsx");
  assert.ok(panel.includes('seeding("city_tile_map", { cityId })'));
  assert.ok(panel.includes("<CityBoxMap"));
  assert.ok(panel.includes('onClick={() => setConfirm({ kind: "geocode" })}'), "Ask Google confirms first");
  assert.ok(panel.includes("One Google Geocoding request, about {usd(status?.geocodeCostUsd ?? null)}"));
  const map = read("components/placePool/CityBoxMap.jsx");
  assert.ok(map.includes('from "react-leaflet"'), "the same map library as the Map tab");
  for (const s of ["searched", "unfinished", "never_searched"]) assert.ok(map.includes(`${s}: {`), s);
  for (const b of ["stored", "google", "proposed"]) assert.ok(map.includes(`${b}: {`), b);
});

test("run-plan checkboxes and box edges have names", () => {
  const run = read("components/placePool/CityRunPanel.jsx");
  assert.equal((run.match(/<label htmlFor=\{`(whole-city|skip-search|high-cost)-/g) ?? []).length, 3);
  const panel = read("components/placePool/CityBoxPanel.jsx");
  for (const edge of ["South edge", "West edge", "North edge", "East edge"]) assert.ok(panel.includes(`"${edge}"`), edge);
  assert.ok(panel.includes("aria-label={label}"));
});
