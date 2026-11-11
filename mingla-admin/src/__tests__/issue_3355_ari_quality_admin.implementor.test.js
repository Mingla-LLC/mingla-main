// Issue #3355 Wave F (F2) — Admin "Ari quality": flow completion, park,
// refusal, repeat-request, empty-reply and thumbs-up rates, and host turns to
// finish each kind of setup, over a selectable window.
//
// The SQL half (admin-only, read-only RPC; rates = counts; window clamp) is
// proven in
// supabase/migrations/__tests__/issue_3355_ari_quality_panel.implementor.pg17.test.sql.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import {
  ARI_QUALITY_DEFAULT_DAYS,
  ARI_QUALITY_WINDOWS,
  formatRate,
  qualityIsEmpty,
  qualityRows,
  rateVerdict,
  turnsToDoneRows,
} from "../lib/ariQuality.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = path.resolve(here, "../..");
const read = (relative) => fs.readFileSync(path.resolve(here, relative), "utf8");

const METRICS = Object.freeze({
  since: "2026-10-11T09:00:00Z",
  days: 30,
  flows: { started: 10, completed: 7, parked: 2, cancelled: 1, expired: 0, open: 2 },
  turns: { host_turns: 200, ari_replies: 210, refusals: 4, repeat_requests: 3, empty_replies: 0 },
  rates: {
    flow_completion: 0.7,
    park: 0.2,
    refusal: 0.019,
    repeat_request: 0.015,
    empty_reply: 0,
    thumbs_up: 0.8,
  },
  feedback: { up: 8, down: 2 },
  turns_to_done: [
    { flow_key: "create_trip", completed: 2, avg_turns: 6.5, median_turns: 6 },
    { flow_key: "create_event", completed: 5, avg_turns: 4.2, median_turns: 4 },
  ],
});

describe("#3355 Wave F — Admin Ari quality (helpers)", () => {
  it("formats rates as percentages and keeps no-data as No data", () => {
    assert.equal(formatRate(0.7), "70%");
    assert.equal(formatRate(0.019), "1.9%");
    assert.equal(formatRate(0), "0%");
    assert.equal(formatRate(null), "No data");
    assert.equal(formatRate(undefined), "No data");
    assert.equal(formatRate("x"), "No data");
  });

  it("builds one row per rate with its counts, and judges the ones with a target", () => {
    const rows = qualityRows(METRICS);
    assert.deepEqual(rows.map((row) => row.key), [
      "flow_completion", "park", "refusal", "repeat_request", "empty_reply", "thumbs_up",
    ]);
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
    assert.equal(byKey.flow_completion.value, "70%");
    assert.equal(byKey.flow_completion.detail, "7 of 10 setups");
    assert.equal(byKey.flow_completion.verdict, "good");
    assert.equal(byKey.repeat_request.detail, "3 of 200 host turns");
    assert.equal(byKey.repeat_request.verdict, "good");
    assert.equal(byKey.empty_reply.verdict, "good");
    assert.equal(byKey.thumbs_up.detail, "8 up · 2 down");
    assert.equal(byKey.park.verdict, null);
    assert.equal(rateVerdict({ goodWhen: "high", target: 0.7 }, 0.5), "bad");
    assert.equal(rateVerdict({ goodWhen: "low", target: 0.03 }, 0.05), "bad");
    assert.equal(rateVerdict({ goodWhen: "low", target: 0.03 }, null), null);
    assert.equal(qualityRows(null)[0].value, "No data");
  });

  it("orders turns to done by setups finished and labels them", () => {
    assert.deepEqual(turnsToDoneRows(METRICS), [
      { flow_key: "create_event", label: "Event", completed: 5, avg: "4.2", median: "4" },
      { flow_key: "create_trip", label: "Trip", completed: 2, avg: "6.5", median: "6" },
    ]);
    assert.deepEqual(turnsToDoneRows({}), []);
  });

  it("knows an empty window", () => {
    assert.equal(qualityIsEmpty(null), true);
    assert.equal(qualityIsEmpty({ flows: { started: 0 }, turns: { host_turns: 0, ari_replies: 0 }, feedback: { up: 0, down: 0 } }), true);
    assert.equal(qualityIsEmpty(METRICS), false);
  });

  it("offers 7, 30 and 90 days, 30 by default", () => {
    assert.deepEqual(ARI_QUALITY_WINDOWS, [7, 30, 90]);
    assert.equal(ARI_QUALITY_DEFAULT_DAYS, 30);
  });
});

describe("#3355 Wave F — Admin Ari quality (render and service)", () => {
  let vite;
  let View;
  let Panel;
  let emptyCopy;
  let service;
  let supabaseModule;

  before(async () => {
    vite = await createServer({
      root: ADMIN_ROOT,
      appType: "custom",
      server: { middlewareMode: true },
      logLevel: "silent",
    });
    const panel = await vite.ssrLoadModule("/src/components/ari/AriQualityPanel.jsx");
    View = panel.AriQualityView;
    Panel = panel.AriQualityPanel;
    emptyCopy = panel.ARI_QUALITY_EMPTY_COPY;
    service = await vite.ssrLoadModule("/src/services/ariImprovementService.js");
    supabaseModule = await vite.ssrLoadModule("/src/lib/supabase.js");
  });
  after(async () => { await vite?.close(); });

  const noop = () => {};
  const render = (state, days = 30) =>
    renderToStaticMarkup(React.createElement(View, { state, days, onDays: noop, onRetry: noop }));

  it("loading, error with retry, and empty states", () => {
    assert.match(render({ status: "loading", metrics: null }), /aria-label="Loading Ari quality"/);
    const error = render({ status: "error", metrics: null, error: "Network down." });
    assert.match(error, /Couldn’t load Ari quality/);
    assert.match(error, /Network down\./);
    assert.match(error, /role="alert"/);
    const empty = render({
      status: "ready",
      metrics: { flows: { started: 0 }, turns: { host_turns: 0, ari_replies: 0 }, feedback: { up: 0, down: 0 }, rates: {}, turns_to_done: [] },
    });
    assert.ok(empty.includes(emptyCopy), "empty copy");
    assert.match(empty, /No setup finished in this window\./);
  });

  it("the populated panel shows every rate, its counts, the window picker and turns to done", () => {
    const html = render({ status: "ready", metrics: METRICS }, 90);
    for (const text of [
      "Setups finished", "70%", "7 of 10 setups",
      "Setups set aside", "20%",
      "Ari said it could not help", "1.9%",
      "Host asked again", "1.5%", "3 of 200 host turns",
      "Empty replies", "0%",
      "Thumbs up", "80%", "8 up · 2 down",
      "Turns to done", "Event", "Trip", "Median turns",
      "Last 7 days", "Last 30 days", "Last 90 days",
    ]) assert.ok(html.includes(text), `missing: ${text}`);
    assert.match(html, /<option value="90" selected="">Last 90 days<\/option>/);
    assert.equal((html.match(/data-rate=/g) || []).length, 6);
    assert.match(html, /On target/);
  });

  it("the stateful panel renders its loading state first", () => {
    const html = renderToStaticMarkup(React.createElement(Panel, {
      service: { loadAriQuality: async () => METRICS },
    }));
    assert.match(html, /Loading Ari quality/);
  });

  it("the service reads only through the admin RPC, with the window", async () => {
    const calls = [];
    const original = supabaseModule.supabase.rpc;
    supabaseModule.supabase.rpc = async (name, args) => { calls.push([name, args]); return { data: METRICS, error: null }; };
    try {
      assert.deepEqual(await service.loadAriQuality({ days: 7 }), METRICS);
      assert.deepEqual(await service.loadAriQuality(), METRICS);
      assert.deepEqual(calls, [
        ["ari_admin_quality_metrics", { p_days: 7 }],
        ["ari_admin_quality_metrics", { p_days: 30 }],
      ]);
      supabaseModule.supabase.rpc = async () => ({ data: null, error: new Error("not_authorized") });
      await assert.rejects(() => service.loadAriQuality({ days: 30 }), /not_authorized/);
    } finally {
      supabaseModule.supabase.rpc = original;
    }
    const source = read("../services/ariImprovementService.js");
    assert.ok(!/from\("ari_flow_runs"\)|from\("agent_messages"\)/.test(source), "no direct table read");
  });

  it("the Improvement Lab has an Ari quality tab next to Ari gaps", () => {
    const page = read("../pages/AriImprovementLabPage.jsx");
    assert.match(page, /\["gaps", "Ari gaps"\],\s*\["quality", "Ari quality"\]/);
    assert.match(page, /\{tab === "quality" && <AriQualityPanel \/>\}/);
  });
});
