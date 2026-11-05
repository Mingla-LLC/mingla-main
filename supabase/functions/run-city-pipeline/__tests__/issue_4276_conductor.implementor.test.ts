// Issue #4276 C1, C9: the conductor pauses and asks, and never spends unapproved. Runs
// the real stage code against a small in-memory store and recording stubs, so each gate
// is proved to stop a run before a paid call goes out.
//
// MINGLA-INVARIANT: I-4276-GATES-PAUSE-BEFORE-SPEND | issue #4276 | Spend limit, database at 7 GB, storage at the 85 GB guard, an unhealthy provider and the failure rate each pause a run before the next paid call
//
// FAILS-ON-REVERT: remove the paidStepBlocked calls and the provider, spend and approval
// tests see paid calls. Remove the databaseGate or storageGate lines from driveRun and
// those two tests keep going. Verified by replacing each.

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { approve, type CallResult, type Deps, resume, start, tick } from "../conductor.ts";
import { databaseGate, failureGate, providerGate, providerProblem, spendGate, storageGate } from "../gates.ts";

type Row = Record<string, unknown>;
const NOW = Date.parse("2026-11-05T12:00:00Z");
const RECENT = new Date(NOW - 10 * 60 * 1000).toISOString();

const PAID = new Set([
  "start_fill", "run_next_batch", "start_split_level", "run_completeness_check",
  "create_run", "start_run",
]);

interface World {
  run: Row;
  stages: Row[];
  settings: Row;
  dbBytes: number;
  providers: Row;
  spent: number;
  responses: (fn: string, body: Row) => CallResult;
  calls: Array<{ fn: string; action: string; body: Row }>;
  storage: { ok: boolean; totalBytes: number | null; message?: string | null };
  storageMeasures: number;
  placeRows: Row[];
  seedingRun: Row | null;
}

const healthy = { status: "healthy", http_status: 200, checked_at: RECENT };

function world(stage: string, responses: World["responses"], patch: Partial<World> = {}): World {
  const order = ["box", "fill", "split", "completeness", "pre_check", "photos", "final_check", "intelligence", "score", "release", "thumbnails"];
  return {
    run: {
      id: "run-1", city_id: "city-1", status: "running", scope: "new_only", spend_limit_usd: 100, rules_only: false,
      started_by: "admin-1", current_stage: stage, error_streak: 0,
    },
    stages: order.map((s, i) => ({
      id: `stage-${s}`, run_id: "run-1", stage: s, ord: i, refs: {}, cursor: {},
      status: order.indexOf(stage) > i ? "complete" : "pending", approval: null,
    })),
    settings: {
      id: true, db_pause_bytes: 7 * 1024 ** 3, failure_rate_limit: 0.25, failure_min_sample: 20, serper_usd_per_request: null,
      storage_ok: true, storage_total_bytes: 1000, storage_measured_at: new Date(NOW - 1000).toISOString(),
    },
    dbBytes: 5 * 1024 ** 3,
    providers: { google_places: healthy, gemini: healthy, serper: healthy },
    spent: 0,
    responses,
    calls: [],
    storage: { ok: true, totalBytes: 1000 },
    storageMeasures: 0,
    placeRows: [],
    seedingRun: null,
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
      if (table === "city_pipeline_settings") return [w.settings];
      if (table === "seeding_cities") return [{ id: "city-1", name: "City", country: "Land" }];
      if (table === "seeding_runs") return w.seedingRun ? [w.seedingRun] : [];
      return w.placeRows;
    };
    const exec = () => {
      const hits = rows().filter((r) => filters.every(([k, v]) => r[k] === v));
      if (update) for (const r of hits) Object.assign(r, update);
      return { data: hits, error: null, count: hits.length };
    };
    // deno-lint-ignore no-explicit-any
    const chain: any = {
      select: () => chain,
      update: (p: Row) => { update = p; return chain; },
      eq: (k: string, v: unknown) => { filters.push([k, v]); return chain; },
      in: () => chain,
      not: () => chain,
      order: () => chain,
      limit: () => chain,
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
      rpc: (name: string) => {
        const data: Record<string, unknown> = {
          city_pipeline_claim_tick: w.run.status === "running" ? [{ ...w.run }] : [],
          city_pipeline_gate_inputs: { db_bytes: w.dbBytes, settings: w.settings, providers: w.providers },
          city_pipeline_spend_ledger: { known_actual_usd: w.spent, rows: [] },
          city_pipeline_hold_unjudged: 0,
          city_pipeline_release_places: { released: 0, rejected: 0, unfinished: 0 },
        };
        return Promise.resolve({ data: data[name] ?? null, error: null });
      },
    },
    call: (fn, body) => {
      w.calls.push({ fn, action: String(body.action ?? ""), body });
      return Promise.resolve(w.responses(fn, body));
    },
    measureStorage: () => {
      w.storageMeasures++;
      return Promise.resolve(w.storage);
    },
    now: () => NOW,
    budgetMs: 1,
  };
}

const paidCalls = (w: World) => w.calls.filter((c) => PAID.has(c.action));
const ok = (body: Row = {}): CallResult => ({ status: 200, body });

const fillPreview = (searches: number, patch: Row = {}) => ok({
  searches, estimatedCostUsd: searches * 0.032, exceedsHighCost: false, blockedByRun: null, failed: 0, neverSearched: searches, ...patch,
});

// ── The pure gates ──────────────────────────────────────────────────────────
const gateInputs = (patch: Row = {}) => ({
  db_bytes: 1,
  settings: { db_pause_bytes: 100, failure_rate_limit: 0.25, failure_min_sample: 20, serper_usd_per_request: null },
  providers: { serper: healthy },
  ...patch,
// deno-lint-ignore no-explicit-any
}) as any;

Deno.test("gates: each trips at its limit, and not below", () => {
  assertEquals(databaseGate(gateInputs({ db_bytes: 99 })), null);
  assertEquals(databaseGate(gateInputs({ db_bytes: 100 }))?.reason, "database_limit");
  assertEquals(databaseGate(gateInputs({ db_bytes: "x" }))?.reason, "database_limit", "can't measure means stop");
  assertEquals(storageGate({ ok: true, totalBytes: 1 }), null);
  assertEquals(storageGate({ ok: false, totalBytes: null })?.reason, "storage_limit");
  assertEquals(spendGate(10, 9, 1), null);
  assertEquals(spendGate(10, 9, 1.01)?.reason, "spend_limit");
  assertEquals(failureGate(gateInputs(), 19, 19, "x"), null, "too small a sample says nothing");
  assertEquals(failureGate(gateInputs(), 5, 20, "x"), null, "at the limit is allowed");
  assertEquals(failureGate(gateInputs(), 6, 20, "x")?.reason, "failure_rate");
});

Deno.test("providers: down, unknown and old checks are all unhealthy; slow is not", () => {
  assertEquals(providerProblem({ status: "down", checked_at: RECENT }, NOW), "down");
  assertEquals(providerProblem({ status: "unknown", checked_at: RECENT }, NOW), "unknown");
  assertEquals(providerProblem(undefined, NOW), "unknown");
  assertEquals(providerProblem({ status: "healthy", checked_at: new Date(NOW - 4 * 3600_000).toISOString() }, NOW), "stale");
  assertEquals(providerProblem({ status: "degraded", checked_at: RECENT }, NOW), null);
  const serperDown = gateInputs({ providers: { serper: { status: "down", http_status: 400, checked_at: RECENT } } });
  assertEquals(providerGate(serperDown, ["serper"], NOW)?.detail.providers, [{ provider: "serper", problem: "down", http_status: 400, checked_at: RECENT }]);
});

// ── Each gate pausing a run, before any paid call ───────────────────────────
Deno.test("the spend limit pauses a run before the next paid call", async () => {
  const w = world("fill", (_fn, b) => b.action === "preview_fill" ? fillPreview(100) : ok(), { spent: 98 });
  const out = await tick(deps(w));
  assertEquals(out.ended, "spend_limit");
  assertEquals(w.run.status, "paused");
  assertEquals(w.run.pause_reason, "spend_limit");
  assertEquals(paidCalls(w), []);
});

Deno.test("the database at 7 GB pauses a run before anything is called", async () => {
  const w = world("fill", () => ok(), { dbBytes: 7 * 1024 ** 3 });
  const out = await tick(deps(w));
  assertEquals(out.ended, "database_limit");
  assertEquals(w.run.pause_reason, "database_limit");
  assertEquals(w.calls.filter((c) => c.fn !== "run-place-intelligence-trial"), []);
});

Deno.test("storage at the guard pauses a run, and the measurement is cached", async () => {
  const w = world("fill", () => ok(), {
    settings: {
      id: true, db_pause_bytes: 7 * 1024 ** 3, failure_rate_limit: 0.25, failure_min_sample: 20, serper_usd_per_request: null,
      storage_ok: null, storage_measured_at: null,
    },
    storage: { ok: false, totalBytes: 85 * 1024 ** 3, message: "over 85 GiB" },
  });
  const out = await tick(deps(w));
  assertEquals(out.ended, "storage_limit");
  assertEquals(w.run.pause_reason, "storage_limit");
  assertEquals(w.calls.filter((c) => c.fn !== "run-place-intelligence-trial"), []);
  assertEquals(w.storageMeasures, 1);
  assertEquals(w.settings.storage_ok, false, "the result is kept");

  w.run.status = "running";
  await tick(deps(w));
  assertEquals(w.storageMeasures, 1, "a full scan is not repeated on the next tick");
});

Deno.test("Serper's depleted state surfaces as an unhealthy provider before any Serper or Gemini spend", async () => {
  const w = world("intelligence", (fn, b) => {
    if (fn === "run-place-intelligence-trial" && b.estimate_only === true) {
      return ok({ estimate_only: true, totalPlaces: 40, estimatedCostUsd: 0.36, exceedsCostGuard: false });
    }
    return ok();
  }, { providers: { google_places: healthy, gemini: healthy, serper: { status: "down", http_status: 400, checked_at: RECENT } } });
  const out = await tick(deps(w));
  assertEquals(out.ended, "provider_unhealthy");
  assertEquals(w.run.pause_reason, "provider_unhealthy");
  assertEquals(paidCalls(w).filter((c) => c.body.estimate_only !== true), [], "start_run itself never went out");
});

Deno.test("an unhealthy Google stops the searches too", async () => {
  const w = world("fill", (_f, b) => b.action === "preview_fill" ? fillPreview(5) : ok(), {
    providers: { google_places: { status: "down", checked_at: RECENT }, gemini: healthy, serper: healthy },
  });
  assertEquals((await tick(deps(w))).ended, "provider_unhealthy");
  assertEquals(paidCalls(w), []);
});

Deno.test("the failure rate pauses a run instead of paying for more failures", async () => {
  const w = world("fill", () => ok(), {
    seedingRun: { id: "s-1", status: "running", completed_batches: 10, failed_batches: 10 },
  });
  w.stages.find((s) => s.stage === "fill")!.cursor = { seeding_run_id: "s-1" };
  const out = await tick(deps(w));
  assertEquals(out.ended, "failure_rate");
  assertEquals(w.run.pause_reason, "failure_rate");
  assertEquals(paidCalls(w), []);
});

// ── It asks, and doesn't spend until a person says ──────────────────────────
const splitResponses = (fn: string, b: Row): CallResult => {
  if (b.action === "preview_fill") return fillPreview(0);
  if (b.action === "preview_split_level") {
    return ok({ sampling: true, nextLevel: 1, searches: 12, estimatedCostUsd: 0.38, exceedsHighCost: false, priorLevels: [], blockedByRun: null, newUnresolved: 0 });
  }
  if (b.action === "start_split_level") return ok({ runId: null });
  return ok();
};

Deno.test("a split level pauses for approval with real numbers, and starts only after one", async () => {
  const w = world("split", splitResponses);
  assertEquals((await tick(deps(w))).ended, "approval:split_sample");
  assertEquals(w.run.status, "awaiting_approval");
  assertEquals((w.run.pause_detail as Row).numbers, {
    sampling: true, nextLevel: 1, searches: 12, estimatedCostUsd: 0.38, exceedsHighCost: false, priorLevels: [], blockedByRun: null, newUnresolved: 0,
  });
  assertEquals(paidCalls(w), []);

  // A tick while it waits does nothing at all.
  const before = w.calls.length;
  assertEquals(await tick(deps(w)), { idle: true });
  assertEquals(w.calls.length, before);

  // Approval of a plan that has moved on is refused.
  await assertRejects(() => approve(deps(w), { runId: "run-1", key: "split:1:99" }, "admin-1"));

  await approve(deps(w), { runId: "run-1", key: "split:1:12" }, "admin-1");
  assertEquals(w.run.status, "queued");
  w.run.status = "running";
  await tick(deps(w));
  const started = paidCalls(w).filter((c) => c.action === "start_split_level");
  assertEquals(started.length, 1);
  assertEquals(started[0].body.expectedLevel, 1);
  // The stub's plan hasn't moved, so the next level asks again: one approval, one level.
  assertEquals(w.run.status, "awaiting_approval");
  assertEquals((w.stages.find((s) => s.stage === "split")!.approval as Row).status, "requested");
});

Deno.test("high-cost confirmation still applies, and is passed through only when given", async () => {
  const w = world("fill", (_f, b) => {
    if (b.action === "preview_fill") return fillPreview(20_000, { estimatedCostUsd: 640, exceedsHighCost: true });
    if (b.action === "start_fill") return ok({ runId: null });
    return ok();
  }, {});
  w.run.spend_limit_usd = 1000;
  assertEquals((await tick(deps(w))).ended, "approval:high_cost");
  assertEquals(paidCalls(w), []);

  const key = (w.run.pause_detail as Row).key as string;
  await assertRejects(() => approve(deps(w), { runId: "run-1", key }, "admin-1"), Error, "high-cost");
  assertEquals(w.run.status, "awaiting_approval");
  await approve(deps(w), { runId: "run-1", key, confirmHighCost: true }, "admin-1");

  w.run.status = "running";
  await tick(deps(w));
  const started = paidCalls(w).find((c) => c.action === "start_fill");
  assertEquals(started?.body.acceptHighCost, true);
});

Deno.test("a tick with no run does nothing: nothing starts because a cron fired", async () => {
  const w = world("fill", () => ok());
  w.run.status = "complete";
  assertEquals(await tick(deps(w)), { idle: true });
  assertEquals(w.calls, []);
});

Deno.test("a run needs a limit: a start without one is refused", async () => {
  const w = world("fill", () => ok());
  await assertRejects(() => start(deps(w), { cityId: "city-1" }, "admin-1"), Error, "spendLimitUsd");
  await assertRejects(
    () => start(deps(w), { cityId: "city-1", spendLimitUsd: 5, scope: "whole_city" }, "admin-1"),
    Error,
    "confirmWholeCity",
  );
});

Deno.test("a stage that keeps failing pauses and says why", async () => {
  const w = world("fill", () => ({ status: 500, body: { error: "boom" } }));
  for (let i = 0; i < 3; i++) {
    const out = await tick(deps(w));
    w.run.error_streak = i + 1; // what the database holds between ticks
    assert(String(out.error).includes("boom"));
  }
  assertEquals(w.run.status, "paused");
  assertEquals(w.run.pause_reason, "stage_error");
});

Deno.test("the score stage scores by place id, never a whole city", async () => {
  const w = world("score", (_f, _b) => ok({ done: true, written: 2 }));
  // deno-lint-ignore no-explicit-any
  const d: any = deps(w);
  const rpc = d.db.rpc;
  let served = false;
  d.db.rpc = (name: string) => {
    if (name === "city_pipeline_places_to_score") {
      const ids = served ? [] : ["p1", "p2"];
      served = true;
      return Promise.resolve({ data: ids, error: null });
    }
    return rpc(name);
  };
  w.placeRows = [{ id: "drinks", is_active: true }];
  await tick(d);
  const scorer = w.calls.filter((c) => c.fn === "run-signal-scorer");
  assertEquals(scorer.length, 1);
  assertEquals(scorer[0].body.place_ids, ["p1", "p2"]);
  assertEquals(scorer[0].body.include_held, true);
  assertEquals(scorer[0].body.city_id, undefined, "a city-wide score would release the held backlog");
  assertEquals(scorer[0].body.all_cities, undefined);
});

Deno.test("resume re-queues, so the gates are read again on the next tick", async () => {
  const w = world("fill", () => ok());
  w.run.status = "paused";
  w.run.pause_reason = "spend_limit";
  const out = await resume(deps(w), { runId: "run-1", spendLimitUsd: 500 });
  assertEquals(out.status, "queued");
  assertEquals(w.run.spend_limit_usd, 500);
});

Deno.test("C5: another run holding the city pauses this one and names it, so a person can cancel it", async () => {
  const held = { id: "old-paused-run", status: "paused", kind: "seed" };
  const w = world("fill", (_f, b) => b.action === "preview_fill" ? fillPreview(5, { blockedByRun: held }) : ok());
  assertEquals((await tick(deps(w))).ended, "blocked_by_run");
  assertEquals((w.run.pause_detail as Row).run, held);
  assertEquals(paidCalls(w), []);
});

Deno.test("C7: the two serving paths that tolerate a never-judged place also refuse a held one", async () => {
  const read = (p: string) => Deno.readTextFile(new URL(p, import.meta.url));
  const share = await read("../../_shared/contentShare.ts");
  assert(share.includes('row.is_servable === false || row.serving_hold === true) throw new Error("not_public")'));
  assert(share.includes("is_active,is_servable,serving_hold"), "the column has to be selected to be checked");
  const card = await read("../../shared-card/index.ts");
  assert(card.includes("place.is_servable === false || place.serving_hold === true"));
  assert(card.includes("is_servable,serving_hold,"), "the column has to be selected to be checked");
});

Deno.test("M3: the refresh warns at half its cron interval", async () => {
  const { mvRefreshNearLimit } = await import("../../api-health-probe/logic.ts");
  assertEquals(mvRefreshNearLimit({ max_seconds: 299, interval_seconds: 600 }), false);
  assertEquals(mvRefreshNearLimit({ max_seconds: 300, interval_seconds: 600 }), true);
  assertEquals(mvRefreshNearLimit({ max_seconds: null, interval_seconds: 600 }), false);
});

// #4276 rework: asking Google for the box is a paid geocode, so it waits behind the
// same gate. FAILS-ON-REVERT: drop the paidStepBlocked call in stageBox and these see
// plan_city_box go out.
Deno.test("the box step's geocode waits behind the spend limit", async () => {
  const w = world("box", () => ok(), { spent: 100 });
  assertEquals((await tick(deps(w))).ended, "spend_limit");
  assertEquals(w.calls.filter((c) => c.action === "plan_city_box" || c.action === "apply_city_box"), []);
});

Deno.test("the box step's geocode waits for a healthy Google", async () => {
  const w = world("box", () => ok(), {
    providers: { google_places: { status: "down", checked_at: RECENT }, gemini: healthy, serper: healthy },
  });
  assertEquals((await tick(deps(w))).ended, "provider_unhealthy");
  assertEquals(w.calls.filter((c) => c.action === "plan_city_box"), []);
});
