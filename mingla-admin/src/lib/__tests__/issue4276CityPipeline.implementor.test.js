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
  outsideBoxRow,
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
  // #4276 design pass: the tabs sit straight under the title and the pipeline is one of them.
  assert.ok(page.indexOf("<Tabs ") > 0 && page.indexOf("<Tabs ") < page.indexOf("<PipelineSection"), "the tabs come first");
  assert.ok(page.includes('tab === "pipeline" && <PipelineSection'), "the pipeline is the Pipeline tab");
  // The approved design's tabs, in its order: Pipeline is a tab, Browse and map is one.
  assert.deepEqual(PLACE_POOL_TABS.map((t) => t.label), ["Overview", "Cities", "Pipeline", "Browse and map", "Excluded"]);
  assert.equal(placePoolTabFor("pipeline"), "pipeline");
  assert.equal(placePoolTabFor("map"), "browse");
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
  assert.equal(by.final_check.text, "Done");
  assert.equal(by.intelligence.gap, false);
  assert.equal(by.score.text, "5");
  assert.equal(by.unsearched.text, "?");
  assert.equal(by.box.text, "Done");
  // #4276 design pass: the design's columns, in its order, each with its legend kind.
  assert.deepEqual(cells.map((c) => c.id), ["box", "seed", "unsearched", "capped", "pre_check", "photos", "final_check", "reviews", "intelligence", "redo", "score", "held"]);
  assert.equal(by.box.kind, "check");
  assert.equal(by.score.kind, "follows");
  assert.equal(by.seed.text, "Done");
  // A draft never seeded reads as such, not as a row of zeros.
  const draft = Object.fromEntries(matrixCells({ active: 0, is_live: false }, { uncoveredTiles: 0, unfinishedSearches: 144, cappedOpen: 0 }, { outside_active: 0 }).map((c) => [c.id, c]));
  assert.equal(draft.seed.text, "Never seeded");
  assert.equal(draft.seed.gap, true);
  assert.equal(draft.unsearched.text, "144");
  assert.equal(draft.pre_check.text, "–");
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

// #4276 final round (P3-a): a city with no places has no row in the report, which is 0 outside.
test("a city with no places reads as 0 places outside the box, not as a failed count", () => {
  const cityId = "42760000-0000-4000-a000-0000000000aa";
  const empty = outsideBoxRow([], cityId);
  assert.equal(empty.outside_active, 0);
  assert.equal(empty.places_total, 0);
  const other = outsideBoxRow([{ city_id: "x", outside_active: 9 }], cityId);
  assert.equal(other.outside_active, 0);
  assert.equal(outsideBoxRow([{ city_id: cityId, outside_active: 3 }], cityId).outside_active, 3);
  assert.equal(outsideBoxRow(null, cityId), null, "only a report that did not load is unknown");
  const panel = read("components/placePool/CityBoxPanel.jsx");
  assert.ok(panel.includes('outsideBoxRow(o.value.report ?? [], cityId)'));
});

// #4276 final round (P4): the legend follows the theme, and the check's stop is said as it happens.
test("the stored-box legend swatch uses a theme token, and the early stop says running searches finish", () => {
  const map = read("components/placePool/CityBoxMap.jsx");
  assert.ok(map.includes('swatchColor: "var(--color-text-primary)"'), "the stored-box swatch follows the theme");
  assert.ok(map.includes("style.swatchColor ?? style.color"), "the swatch draws with the theme token");
  const panel = read("components/placePool/CityBoxPanel.jsx");
  assert.ok(panel.includes("It stops after 3 failures in a row; searches already running finish."));
  assert.equal(panel.includes("stops early after 3 failed searches"), false);
});

// #4276 final round: the refresh slot comes from the cron schedule; unknown is said, never 600.
test("the place list refresh line never assumes a 600-second slot", () => {
  const section = read("components/placePool/PipelineSection.jsx");
  assert.equal(section.includes("mv.interval_seconds ?? 600"), false, "no guessed slot");
  assert.ok(section.includes("its schedule couldn't be read, so its slot is unknown"));
});

// ── #4276 follow-up: the design pass and fixes d and e ──────────────────────
import * as pipelineLib from "../cityPipeline.js";

// Fix d. FAILS-ON-REVERT: drop withOneRetry from IntelligenceOverviewTab, or the
// tableSettled gate from PipelineSection, and this fails.
test("Intelligence coverage retries once, quietly, and loads after the gaps table", async () => {
  let calls = 0;
  const waits = [];
  const flaky = async () => { calls += 1; if (calls === 1) throw new Error("statement timeout"); return "rows"; };
  assert.equal(await pipelineLib.withOneRetry(flaky, { wait: async (ms) => { waits.push(ms); } }), "rows");
  assert.equal(calls, 2);
  assert.deepEqual(waits, [1500]);
  let twice = 0;
  await assert.rejects(pipelineLib.withOneRetry(async () => { twice += 1; throw new Error(`fail ${twice}`); }, { wait: async () => {} }), /fail 2/);
  assert.equal(twice, 2, "a second failure is the one shown, and there is no third try");
  const tab = read("components/placeIntelligenceTrial/IntelligenceOverviewTab.jsx");
  assert.ok(tab.includes("await withOneRetry(() => fetchIntelligenceCoverage());"));
  const section = read("components/placePool/PipelineSection.jsx");
  assert.ok(section.includes("const tableSettled = (funnel !== null || funnelError !== null) && (health !== null || healthError !== null);"));
  const gate = section.indexOf("{tableSettled ? (");
  assert.ok(gate > 0 && gate < section.indexOf("<IntelligenceOverviewTab />"), "coverage mounts only once the table has answered");
});

test("the gaps table: All gaps totals, the Show filter and a city's status line", () => {
  const live = { city_id: "l", is_live: true, active: 100, pre_checked: 100, pre_passed: 80, with_photos: 80, final_checked: 80, servable: 60, scored: 60, no_reviews: 50, rules_only: 0, intelligence_without_reviews: 50, held: 0 };
  const seeded = { city_id: "s", is_live: false, active: 40, pre_checked: 0, pre_passed: 0, with_photos: 0, final_checked: 0, servable: 0, scored: 0 };
  const draft = { city_id: "d", is_live: false, active: 0 };
  const rows = [live, seeded, draft].map((c) => matrixCells(c, { uncoveredTiles: 1, unfinishedSearches: 2, cappedOpen: 3 }, { outside_active: c === live ? 5 : 0 }));
  const totals = Object.fromEntries(pipelineLib.matrixTotals(rows).map((t) => [t.id, t]));
  assert.equal(totals.unsearched.text, "9");
  assert.equal(totals.capped.text, "9");
  assert.equal(totals.box.text, "5");
  assert.equal(totals.seed.text, "1 city");
  assert.equal(totals.redo.text, "50");
  // Unknown searches make the total say so.
  assert.equal(pipelineLib.matrixTotals([matrixCells(live, null, null)]).find((t) => t.id === "unsearched").text, "?");
  assert.equal(pipelineLib.cityStatusLine(live, rows[0]), "Live · Mostly no reviews");
  assert.equal(pipelineLib.cityStatusLine(seeded, rows[1]), "Not started");
  assert.equal(pipelineLib.cityStatusLine(draft, rows[2]), "Draft, never seeded");
  assert.deepEqual([live, seeded, draft].filter((c) => pipelineLib.matrixFilter(c, "live")), [live]);
  assert.deepEqual([live, seeded, draft].filter((c) => pipelineLib.matrixFilter(c, "seeded")), [seeded]);
  assert.deepEqual([live, seeded, draft].filter((c) => pipelineLib.matrixFilter(c, "drafts")), [draft]);
  assert.equal(pipelineLib.boxSizeText({ bbox_sw_lat: 51.3, bbox_sw_lng: -0.5, bbox_ne_lat: 51.7, bbox_ne_lng: 0.3 }), "55 x 44 km");
  assert.equal(pipelineLib.boxSizeText({}), "");
});

test("Cities readiness reads in the design's words", () => {
  const none = { missingIntelligence: 0, missingReviews: 0, unsearchedAreas: 0, unfinishedSearches: 0, searchUnknown: false, outsideBox: 0 };
  const st = (row, g = none) => pipelineLib.cityLaunchState(row, g);
  assert.equal(st({ is_live_for_consumers: true, is_servable_places: 1000 }).label, "Live");
  assert.equal(st({ is_live_for_consumers: true, is_servable_places: 1000 }).why, "Nothing");
  assert.equal(st({ is_live_for_consumers: true, is_servable_places: 1000 }, { ...none, missingReviews: 700 }).label, "Live, with gaps");
  assert.equal(st({ is_live_for_consumers: false, is_servable_places: 10, total_active_places: 20 }).label, "Ready");
  assert.equal(st({ is_live_for_consumers: false, is_servable_places: 10, total_active_places: 20 }, { ...none, outsideBox: 3 }).label, "Needs work");
  assert.equal(st({ is_live_for_consumers: false, is_servable_places: 0, total_active_places: 0 }).label, "Draft");
  assert.equal(pipelineLib.cityFilterMatch("live_gaps", "live"), true);
  assert.equal(pipelineLib.cityFilterMatch("ready", "needs_work"), false);
});

test("recorded spend: Serper is counted, never priced at $0", () => {
  const unpriced = pipelineLib.spendTotalsLine({ seeding_usd: 1024, photos_usd: 1311, gemini_usd: 125, serper_requests: 1200, serper_usd_per_request: null });
  assert.match(unpriced, /Seeding \$1,024\.00 · Photos \$1,311\.00 · Gemini \$125\.00 · Serper 1,200 requests, not priced/);
  assert.match(pipelineLib.spendTotalsLine({ seeding_usd: 0, photos_usd: 0, gemini_usd: 0, serper_requests: 1000, serper_usd_per_request: 0.001 }), /Serper \$1\.00$/);
  const svc = read("services/cityPipelineService.js");
  assert.ok(svc.includes('return rpc("admin_place_pipeline_spend_totals", {});'));
});

test("Excluded: the biggest single-rule loss and reasons in words", () => {
  const cities = [
    { city_id: "lagos", city_name: "Lagos", active: 4222, pre_check: { B4: 2888, B6: 643 } },
    { city_id: "london", city_name: "London", active: 15551, pre_check: { B4: 2093 } },
    { city_id: null, city_name: "No city", active: 272, pre_check: { B4: 270 } },
  ];
  const loss = pipelineLib.biggestRuleLoss(cities);
  assert.deepEqual({ city: loss.city, label: loss.label, share: loss.share }, { city: "Lagos", label: "No website", share: 68 });
  assert.equal(pipelineLib.biggestRuleLoss([{ city_id: "x", city_name: "X", active: 100, pre_check: { B4: 10 } }]), null);
  assert.equal(pipelineLib.reasonWords("B4:no_website;B6:no_hours"), "No website, No opening hours");
  assert.equal(pipelineLib.reasonWords(null), "No reason recorded");
});

test("needs attention links each gap to the tab that shows it", () => {
  const items = pipelineLib.attentionItems({ rules_only: 3, held: 2, dropped_no_photos: 4 });
  assert.equal(items.find((i) => i.head.startsWith("Explorers see")).tab, "pipeline");
  assert.equal(items.find((i) => i.head.startsWith("Held")).tab, null);
  assert.equal(items.find((i) => i.head.startsWith("Dropped")).tab, "excluded");
});
