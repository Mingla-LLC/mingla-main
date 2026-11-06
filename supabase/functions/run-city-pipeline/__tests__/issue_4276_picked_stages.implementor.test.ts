// Issue #4276 (round 3): a run does what a person picked, and no more.
//
// MINGLA-INVARIANT: I-4276-RUN-DOES-ONLY-PICKED-STAGES | issue #4276 | With a stage list a city run does exactly those stages plus what each needs first and what follows Intelligence, and with none it does every stage as before; a redo needs confirmRedo and reaches places with no reviews
//
//   P-NONE     no stage list: city_pipeline_start with today's arguments, never the plan
//   P-LIST     a list: city_pipeline_start_plan with the picks plus what each needs first;
//              a search is never added for you
//   P-REDO     redoIntelligence needs confirmRedo, and the Intelligence stage then asks
//              for places with no reviews, fetched afresh, among the servable ones
//   P-UNKNOWN  an unknown stage, an empty list or a redo without a list is a 400
//   P-LIMIT    a planned run still needs a spend limit, and still pauses at it before
//              its paid call
//   P-PRICE    the preview prices exactly the planned stages
//
// FAILS-ON-REVERT: drop planOrRefuse from start() and P-LIST, P-REDO and P-UNKNOWN fail
// (the old start ignores the list); drop the cursor branch from the Intelligence stage
// and P-REDO's start_run check fails; drop pricePlan from preview and P-PRICE fails.

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type CallResult, type Deps, intelligenceArgs, preview, Refusal, start, tick } from "../conductor.ts";
import { planFromBody } from "../plan.ts";

type Row = Record<string, unknown>;
const NOW = Date.parse("2026-11-05T12:00:00Z");
const RECENT = new Date(NOW - 10 * 60 * 1000).toISOString();
const healthy = { status: "healthy", http_status: 200, checked_at: RECENT };
const ok = (body: Row = {}): CallResult => ({ status: 200, body });
const ORDER = ["box", "fill", "split", "completeness", "pre_check", "photos", "final_check", "intelligence", "score", "release", "thumbnails"];

interface World {
  run: Row;
  stages: Row[];
  settings: Row;
  spent: number;
  rpcs: Array<{ name: string; args: Row }>;
  calls: Array<{ fn: string; body: Row }>;
  responses: (fn: string, body: Row) => CallResult;
}

function world(stage: string, responses: World["responses"], patch: Partial<World> = {}, cursor: Row = {}): World {
  return {
    run: { id: "run-1", city_id: "city-1", status: "running", scope: "new_only", spend_limit_usd: 100, rules_only: false, started_by: "admin-1", current_stage: stage, error_streak: 0 },
    stages: ORDER.map((s, i) => ({
      id: `stage-${s}`, run_id: "run-1", stage: s, ord: i, refs: {}, cursor: s === stage ? { ...cursor } : {},
      status: ORDER.indexOf(stage) > i ? "complete" : "pending", approval: null,
    })),
    settings: {
      id: true, db_pause_bytes: 7 * 1024 ** 3, failure_rate_limit: 0.25, failure_min_sample: 20, serper_usd_per_request: null,
      storage_ok: true, storage_total_bytes: 1000, storage_measured_at: new Date(NOW - 1000).toISOString(),
    },
    spent: 0,
    rpcs: [],
    calls: [],
    responses,
    ...patch,
  };
}

function deps(w: World): Deps {
  // deno-lint-ignore no-explicit-any
  const from = (table: string): any => {
    const filters: Array<[string, unknown]> = [];
    let update: Row | null = null;
    const rows = (): Row[] => {
      if (table === "city_pipeline_runs") return [w.run];
      if (table === "city_pipeline_stages") return w.stages;
      if (table === "seeding_cities") return [{ id: "city-1", name: "City", country: "Land" }];
      return [];
    };
    const exec = () => {
      const hits = rows().filter((r) => filters.every(([k, v]) => r[k] === v));
      if (update) for (const r of hits) Object.assign(r, update);
      return { data: hits, error: null };
    };
    // deno-lint-ignore no-explicit-any
    const chain: any = {
      select: () => chain,
      update: (p: Row) => { update = p; return chain; },
      eq: (k: string, v: unknown) => { filters.push([k, v]); return chain; },
      in: () => chain, not: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: () => { const r = exec(); return Promise.resolve({ ...r, data: r.data[0] ?? null }); },
      single: () => { const r = exec(); return Promise.resolve({ ...r, data: r.data[0] ?? null }); },
      // deno-lint-ignore no-explicit-any
      then: (res: any) => Promise.resolve(exec()).then(res),
    };
    return chain;
  };
  return {
    db: {
      from,
      rpc: (name: string, args: Row = {}) => {
        w.rpcs.push({ name, args });
        const data: Record<string, unknown> = {
          city_pipeline_claim_tick: w.run.status === "running" ? [{ ...w.run }] : [],
          city_pipeline_gate_inputs: { db_bytes: 1, settings: w.settings, providers: { google_places: healthy, gemini: healthy, serper: healthy } },
          city_pipeline_spend_ledger: { known_actual_usd: w.spent, rows: [] },
          city_pipeline_start: "run-old",
          city_pipeline_start_plan: "run-planned",
          city_pipeline_blockers: [],
          city_pipeline_place_counts: { held: 0 },
        };
        return Promise.resolve({ data: data[name] ?? null, error: null });
      },
    },
    call: (fn, body) => {
      w.calls.push({ fn, body });
      return Promise.resolve(w.responses(fn, body));
    },
    measureStorage: () => Promise.resolve({ ok: true, totalBytes: 1000 }),
    now: () => NOW,
    budgetMs: 1,
  };
}

const startRpc = (w: World) => w.rpcs.find((r) => r.name.startsWith("city_pipeline_start"));

Deno.test("P-NONE: no stage list starts the run exactly as before", async () => {
  const w = world("box", () => ok());
  const out = await start(deps(w), { cityId: "city-1", spendLimitUsd: 20, scope: "new_only", skipSearch: true }, "admin-1");
  assertEquals(out.runId, "run-old");
  assertEquals(startRpc(w), {
    name: "city_pipeline_start",
    args: { p_city_id: "city-1", p_started_by: "admin-1", p_scope: "new_only", p_spend_limit_usd: 20, p_skip_search: true, p_rules_only: false },
  });
  assertEquals(planFromBody({}), null);
});

Deno.test("P-LIST: the picks plus what each needs first, and never a search added for you", async () => {
  assertEquals(planFromBody({ stages: ["photos"] })?.stages, ["pre_check", "photos"]);
  assertEquals(planFromBody({ stages: ["final_check"] })?.stages, ["pre_check", "photos", "final_check"]);
  assertEquals(planFromBody({ stages: ["intelligence"] })?.stages,
    ["pre_check", "photos", "final_check", "intelligence", "score", "release", "thumbnails"]);
  assertEquals(planFromBody({ stages: ["fill"] })?.stages, ["fill"]);
  assertEquals(planFromBody({ stages: ["split", "box"] })?.stages, ["box", "split"]);
  for (const stages of [["photos"], ["intelligence"], ["final_check"]]) {
    const p = planFromBody({ stages })!;
    assert(!p.stages.some((s) => ["box", "fill", "split", "completeness"].includes(s)), `${stages} added a search`);
  }

  const w = world("box", () => ok());
  const out = await start(deps(w), { cityId: "city-1", spendLimitUsd: 20, stages: ["photos"] }, "admin-1");
  assertEquals(out, { runId: "run-planned", stages: ["pre_check", "photos"], redo: false });
  assertEquals(startRpc(w)?.name, "city_pipeline_start_plan");
  assertEquals(startRpc(w)?.args.p_stages, ["pre_check", "photos"]);
  assertEquals(startRpc(w)?.args.p_redo_intelligence, false);
});

Deno.test("P-REDO: a redo asks first, then reaches servable places with no reviews, fetched afresh", async () => {
  const w = world("box", () => ok());
  await assertRejects(() => start(deps(w), { cityId: "city-1", spendLimitUsd: 20, stages: ["intelligence"], redoIntelligence: true }, "admin-1"),
    Refusal, "confirmRedo");
  const out = await start(deps(w), { cityId: "city-1", spendLimitUsd: 20, stages: ["pre_check"], redoIntelligence: true, confirmRedo: true }, "admin-1");
  assertEquals(out.redo, true);
  assert((out.stages as string[]).includes("intelligence"), "a redo brings its Intelligence stage");
  assertEquals(startRpc(w)?.args.p_redo_intelligence, true);

  // The stage itself, on a planned redo run.
  const run = world("intelligence", (fn, b) => {
    if (fn === "run-place-intelligence-trial" && b.estimate_only === true) {
      return ok({ estimate_only: true, totalPlaces: 12, estimatedCostUsd: 0.12, exceedsCostGuard: false });
    }
    if (fn === "run-place-intelligence-trial") return ok({ runId: "intel-1" });
    return ok();
  }, { settings: { id: true, db_pause_bytes: 7 * 1024 ** 3, failure_rate_limit: 0.25, failure_min_sample: 20, serper_usd_per_request: 0.001, storage_ok: true, storage_total_bytes: 1000, storage_measured_at: new Date(NOW - 1000).toISOString() } },
  { plan: true, redo: true });
  await tick(deps(run));
  const started = run.calls.find((c) => c.fn === "run-place-intelligence-trial" && c.body.estimate_only !== true);
  assert(started, "start_run went out");
  assertEquals(started!.body.include_no_reviews, true);
  assertEquals(started!.body.force_refresh_reviews, true);
  assertEquals(started!.body.place_scope, "servable_and_held");

  // An unplanned run asks for exactly what it always did.
  assertEquals(intelligenceArgs("c", "a", "new_only", { planned: false, redo: false }),
    { action: "start_run", city_id: "c", mode: "remainder", place_scope: "held", admin_id: "a" });
});

Deno.test("P-UNKNOWN: an unknown stage, an empty list or a redo with no list is refused with 400", async () => {
  const w = world("box", () => ok());
  for (const body of [
    { stages: ["box", "teleport"] },
    { stages: [] },
    { stages: "photos" },
    { stages: ["score"] },
    { redoIntelligence: true, confirmRedo: true },
  ]) {
    const err = await assertRejects(() => start(deps(w), { cityId: "city-1", spendLimitUsd: 20, ...body }, "admin-1"), Refusal);
    assertEquals((err as Refusal).status, 400, JSON.stringify(body));
    assertEquals((err as Refusal).code, "bad_stages", JSON.stringify(body));
  }
  assertEquals(startRpc(w), undefined, "nothing was started");
  await assertRejects(() => preview(deps(w), { cityId: "city-1", stages: ["nope"] }, "admin-1"), Refusal, "unknown stage");
});

Deno.test("P-LIMIT: a planned run still needs a limit, and still pauses at it before paying", async () => {
  const w = world("box", () => ok());
  await assertRejects(() => start(deps(w), { cityId: "city-1", stages: ["photos"] }, "admin-1"), Refusal, "spendLimitUsd");
  const run = world("intelligence", (fn, b) => {
    if (fn === "run-place-intelligence-trial" && b.estimate_only === true) {
      return ok({ estimate_only: true, totalPlaces: 100, estimatedCostUsd: 5, exceedsCostGuard: false });
    }
    return ok({ runId: "intel-1" });
  }, { spent: 98 }, { plan: true, redo: true });
  const out = await tick(deps(run));
  assertEquals(out.ended, "spend_limit");
  assertEquals(run.calls.filter((c) => c.body.estimate_only !== true && c.body.action === "start_run"), [], "no paid start");
});

Deno.test("P-PRICE: the preview prices exactly the planned stages", async () => {
  const w = world("box", (fn, b) => {
    if (fn === "admin-seed-places") return ok({ searches: 10, estimatedCostUsd: 0.32 });
    if (fn === "backfill-place-photos") return ok({ status: "ready", totalPlaces: 40, estimatedCostUsd: 1.4 });
    if (fn === "run-place-intelligence-trial" && b.estimate_only === true) {
      return ok({ estimate_only: true, totalPlaces: 30, estimatedCostUsd: 0.27 });
    }
    return ok();
  }, { settings: { id: true, serper_usd_per_request: 0.001 } });
  const out = await preview(deps(w), { cityId: "city-1", stages: ["intelligence"], redoIntelligence: true }, "admin-1");
  const plan = out.plan!;
  assertEquals(plan.stages, ["pre_check", "photos", "final_check", "intelligence", "score", "release", "thumbnails"]);
  assertEquals(plan.lines.map((l) => [l.stage, l.usd]), [
    ["pre_check", 0], ["photos", 1.4], ["final_check", 0], ["intelligence", 0.27], ["score", 0], ["release", 0], ["thumbnails", 0],
  ]);
  assertEquals(plan.knownUsd, 1.67);
  assertEquals(plan.serperRequests, 150);
  assertEquals(plan.serperUsd, 0.15);
  assertEquals(plan.totalUsd, 1.82);
  assertEquals(plan.atLeast, true, "the checks can add places to photos and Intelligence");
  const est = w.calls.find((c) => c.fn === "run-place-intelligence-trial");
  assertEquals(est?.body.include_no_reviews, true);
  assertEquals(est?.body.admin_id, "admin-1");
  // No fill or split preview for a plan with no search.
  assertEquals(w.calls.filter((c) => c.fn === "admin-seed-places" && c.body.action !== "preview_fill" && c.body.action !== "preview_split_level"), []);

  // Unplanned previews carry no plan.
  const w2 = world("box", () => ok({ searches: 0, estimatedCostUsd: 0 }));
  assertEquals((await preview(deps(w2), { cityId: "city-1" }, "admin-1")).plan, null);
});
