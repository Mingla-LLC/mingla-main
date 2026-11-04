// Issue #4238 media-buyer — Admin parity: the campaign builder reads each
// app's own match from the server (wider areas flagged, app errors are
// "couldn't check"), and staff edit "works here" per app and country plus
// the per-app reach switch.
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withVite } from "../../../__tests__/issue4238_ssr.helper.mjs";

test("E1 the builder takes each app's own match, a wider area flagged, an error never 'not found'", async () => {
  await withVite(async (vite) => {
    const { pickTargetingMatch } = await vite.ssrLoadModule("/src/services/adEngineService.js");
    assert.deepEqual(
      pickTargetingMatch({ results: [], match: { state: "wider", wider: { id: "2332453", name: "Lagos State" } } }),
      { state: "wider", id: "2332453", name: "Lagos State", meta: {} },
    );
    assert.equal(pickTargetingMatch({ results: [], unavailable: true }).state, "unchecked");
    assert.equal(pickTargetingMatch({ results: [], match: { state: "none" } }).state, "none");
    assert.equal(pickTargetingMatch({ match: { state: "match", best: { id: "1", name: "Lagos" } } }).id, "1");
  });
});

test("E1 works-here grid: unknown is 'not checked' (works), marked rows show their status", async () => {
  await withVite(async (vite) => {
    const lib = await vite.ssrLoadModule("/src/lib/adBuilder/adAvailability.js");
    const rows = [{ platform: "tiktok", country_code: "GB", status: "not_available", reason: "TikTok can't run ads in the United Kingdom on Mingla's account yet." }];
    const grid = lib.availabilityGrid(rows, lib.availabilityCountries(rows, ["NG"]));
    assert.deepEqual(grid.map((row) => row.country), ["GB", "NG"]);
    assert.equal(grid[0].cells.find((c) => c.platform === "tiktok").status, "not_available");
    assert.equal(grid[1].cells.find((c) => c.platform === "tiktok").status, "not_checked");
    assert.match(lib.availabilityEditError({ platform: "reddit", country: "NG", status: "not_available", reason: " " }), /Say why/);
    assert.equal(lib.availabilityEditError({ platform: "reddit", country: "ng", status: "works" }), null);
    const states = lib.reachSwitchStates([
      { platform: "meta", lane: "consumer", connected: true, extra: { audience_estimate_certified: true } },
      { platform: "tiktok", lane: "business", connected: true, extra: { audience_estimate_certified: true } },
    ]);
    assert.deepEqual(states.map((s) => [s.platform, s.enabled]), [["meta", true], ["tiktok", false], ["snapchat", false], ["reddit", false]]);
  });
});

test("E1 the panel renders the grid and the reach switches", async () => {
  await withVite(async (vite) => {
    const { AdAvailabilityPanel } = await vite.ssrLoadModule("/src/components/ad-engine/AdAvailabilityPanel.jsx");
    const { ToastProvider } = await vite.ssrLoadModule("/src/context/ToastContext.jsx");
    const html = renderToStaticMarkup(
      React.createElement(ToastProvider, null, React.createElement(AdAvailabilityPanel)),
    );
    assert.match(html, /Where Host ads run/);
    assert.match(html, /Unknown means it works until you mark it otherwise/);
    assert.match(html, /Reach numbers for Hosts/);
    assert.match(html, /Facebook &amp; Instagram: Off/);
  });
});
