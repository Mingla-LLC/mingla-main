// Issue #4238 wave 2 — T17: Admin "Results over time". Charts with data, the
// empty state, and the "Show as table" toggle with the same rows.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { adminRoot, withVite } from "../../__tests__/issue4238_ssr.helper.mjs";

const rows = [
  { day: "2026-11-01", campaign_id: "a", platform: "meta", spend_cents: 1200, currency: "USD", impressions: 4000, clicks: 80, page_visits: 30, results: 2 },
  { day: "2026-11-01", campaign_id: "b", platform: "snapchat", spend_cents: 300, currency: "USD", impressions: 1000, clicks: 10, page_visits: 4, results: 0 },
  { day: "2026-11-02", campaign_id: "a", platform: "meta", spend_cents: 900, currency: "USD", impressions: 3500, clicks: 60, page_visits: 25, results: 1 },
  { day: "2026-11-03", campaign_id: "a", platform: "meta", spend_cents: null, currency: null, impressions: null, clicks: null, page_visits: 2, results: 0 },
];

test("T17 series keeps missing days null and sums plan siblings", async () => {
  await withVite(async (vite) => {
    const { buildAdminResultsSeries } = await vite.ssrLoadModule("/src/components/ad-engine/AdResultsCharts.jsx");
    const s = buildAdminResultsSeries(rows);
    assert.deepEqual(s.days.map((d) => [d.day, d.spend, d.cumulative]), [
      ["2026-11-01", 1500, 1500],
      ["2026-11-02", 900, 2400],
      ["2026-11-03", null, null],
    ]);
    assert.equal(s.totalSpend, 2400);
    // #4238 shared days rule: days whose own spend is above zero. The Host
    // detail page counts the same rows the same way (2 days, not 3).
    assert.equal(s.spendDays, 2);
    assert.equal(s.totalResults, 3);
    assert.deepEqual(s.platforms.map((p) => [p.platform, p.spend]), [["meta", 2100], ["snapchat", 300]]);
    assert.deepEqual(s.funnel.map((f) => [f.key, f.value]), [["shown", 8500], ["clicks", 150], ["visits", 61], ["results", 3]]);
  });
});

test("T17 renders the charts, the summary line and the table toggle", async () => {
  await withVite(async (vite) => {
    const { AdResultsCharts } = await vite.ssrLoadModule("/src/components/ad-engine/AdResultsCharts.jsx");
    const html = renderToStaticMarkup(React.createElement(AdResultsCharts, { rows, capCents: 5000 }));
    assert.match(html, /data-testid="results-over-time"/);
    assert.match(html, /recharts-responsive-container/);
    assert.match(html, /over 2 days of a .*cap · 3 results/);
    assert.doesNotMatch(html, /over 3 days/);
    assert.match(html, /Show as table/);
    assert.match(html, /data-testid="results-over-time-funnel"/);
    const empty = renderToStaticMarkup(React.createElement(AdResultsCharts, { rows: [] }));
    assert.match(empty, /No spend synced yet\. Charts appear after the first daily spend sync\./);
    const loading = renderToStaticMarkup(React.createElement(AdResultsCharts, { rows: [], loading: true }));
    assert.match(loading, /Loading results over time/);
  });
});

test("T17 the page shows Results over time between the cap card and Conversions & ROI", () => {
  const page = fs.readFileSync(path.join(adminRoot, "src/pages/CampaignsPage.jsx"), "utf8");
  const cap = page.indexOf('title="Spend vs hard cap"');
  const over = page.indexOf('title="Results over time"');
  const roi = page.indexOf('title="Conversions & ROI"');
  assert.ok(cap > 0 && over > cap && roi > over);
  assert.match(page, /getCampaignDailySeries\(seriesKey\.split\(","\), seriesZone\)/);
  const charts = fs.readFileSync(path.join(adminRoot, "src/components/ad-engine/AdResultsCharts.jsx"), "utf8");
  assert.equal((charts.match(/isAnimationActive=\{false\}/g) ?? []).length, 4);
  assert.match(charts, /height=\{220\}/);
});

test("T17 rework: the spend axis reads currency units, never cents", async () => {
  await withVite(async (vite) => {
    const { spendAxisTick } = await vite.ssrLoadModule("/src/components/ad-engine/AdResultsCharts.jsx");
    assert.equal(spendAxisTick(1200), "12");
    assert.equal(spendAxisTick(95_000), "950");
    assert.equal(spendAxisTick(1_250_000), "12.5K");
    assert.equal(spendAxisTick(150_000_000), "1.5M");
  });
  const chart = fs.readFileSync(path.join(adminRoot, "src/components/ad-engine/AdResultsCharts.jsx"), "utf8");
  // Both spend axes (daily spend and spend per platform) format their ticks.
  assert.match(chart, /<YAxis tick=\{\{ fontSize: 11 \}\} width=\{48\} tickFormatter=\{spendAxisTick\} \/>/);
  assert.match(chart, /<XAxis type="number" tick=\{\{ fontSize: 11 \}\} tickFormatter=\{spendAxisTick\} \/>/);
});

test("T17 rework: a Host ad's days are counted in its brand's zone, as on Host", async () => {
  await withVite(async (vite) => {
    const { resultsSeriesZone } = await vite.ssrLoadModule("/src/components/ad-engine/AdResultsCharts.jsx");
    assert.equal(resultsSeriesZone({ brandTimeZone: "Africa/Lagos", scheduleTimeZone: "Europe/London" }), "Africa/Lagos");
    assert.equal(resultsSeriesZone({ brandTimeZone: null, scheduleTimeZone: "Europe/London" }), "Europe/London");
    assert.equal(resultsSeriesZone({ brandTimeZone: null, scheduleTimeZone: undefined }), "UTC");
  });
  const page = fs.readFileSync(path.join(adminRoot, "src/pages/CampaignsPage.jsx"), "utf8");
  assert.match(page, /getBrandTimeZone\(seriesBrandId\)/);
  assert.match(page, /const seriesZone = resultsSeriesZone\(\{\s*brandTimeZone:/);
  assert.doesNotMatch(page, /const seriesZone = selectedCampaign\?\.plan_version\?\.schedule_time_zone \?\? "UTC";/);
});
