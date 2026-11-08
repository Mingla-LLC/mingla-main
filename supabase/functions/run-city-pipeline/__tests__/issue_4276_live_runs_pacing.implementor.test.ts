// Issue #4276 (live runs): a city run waits out the edge runtime's function rate limit
// instead of pausing, paces its calls, and records what every tick did.
//
// Abuja's first run (2026-11-07) paused after 118 of 4,536 searches: fetch() threw
// Deno.errors.RateLimitError ("Rate limit exceeded for function. Retry after <n>ms."),
// the conductor counted it as a failure, and three such ticks paused the run.
//
// MINGLA-INVARIANT: I-4276-RATE-LIMIT-IS-A-WAIT | issue #4276 | A function rate limit ends the tick as a wait with next_attempt_at set, never counts toward error_streak, and never pauses a run
// MINGLA-INVARIANT: I-4276-TICK-PACED-AND-LEASED | issue #4276 | A tick spaces calls to one function MIN_CALL_GAP_MS apart, makes at most MAX_CALLS_PER_FN_PER_TICK to one function, and only the tick holding the lease can end it
// MINGLA-INVARIANT: I-4276-TICK-OUTCOME-RECORDED | issue #4276 | Every tick writes last_outcome on the run, and last_progress_at when it moved a stage forward
//
// Runs the real conductor (and the real call wrapper from index.ts, over a fake fetch)
// against a small in-memory store. Time is a fake clock that only sleeps move, so the
// pacing is measured exactly and the tests run instantly.
//
// FAILS-ON-REVERT: with the conductor and index.ts from 26c23ff17b, the first test ends
// with the run paused for stage_error after three ticks (verified; see the issue).

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type CallResult,
  type Deps,
  MAX_CALLS_PER_FN_PER_TICK,
  MIN_CALL_GAP_MS,
  resume,
  tick,
} from "../conductor.ts";
import { makeCall, rateLimitRetryAfterMs } from "../index.ts";

type Row = Record<string, unknown>;
const T0 = Date.parse("2026-11-07T21:00:00Z");
const RECENT = new Date(T0 - 10 * 60 * 1000).toISOString();
const healthy = { status: "healthy", http_status: 200, checked_at: RECENT };
const ORDER = ["box", "fill", "split", "completeness", "pre_check", "photos", "final_check", "intelligence", "score", "release", "thumbnails"];

/** What the edge runtime throws from fetch() when one function calls another too fast. */
class FakeRateLimitError extends Error {
  retryAfterMs: number;
  constructor(ms: number) {
    super(`Rate limit exceeded for function. Retry after ${ms}ms.`);
    this.name = "RateLimitError";
    this.retryAfterMs = ms;
  }
}

interface World {
  clock: number;
  run: Row;
  stages: Row[];
  settings: Row;
  spent: number;
  tables: Record<string, Row[]>;
  calls: Array<{ fn: string; action: string; body: Row; at: number }>;
  sleeps: number[];
  respond: (fn: string, body: Row, w: World) => CallResult | Promise<CallResult>;
  /** Replaces deps.call, for the RateLimitError case that goes through index.ts. */
  fetch?: typeof fetch;
}

function world(stage: string, respond: World["respond"], patch: Partial<World> = {}): World {
  return {
    clock: T0,
    run: {
      id: "run-1", city_id: "city-1", status: "running", scope: "new_only", spend_limit_usd: 100, rules_only: false,
      started_by: "admin-1", current_stage: stage, error_streak: 0, lease_until: "lease-A",
    },
    stages: ORDER.map((s, i) => ({
      id: `stage-${s}`, run_id: "run-1", stage: s, ord: i, refs: {}, cursor: {},
      status: ORDER.indexOf(stage) > i ? "complete" : "pending", approval: null,
    })),
    settings: {
      id: true, db_pause_bytes: 7 * 1024 ** 3, failure_rate_limit: 0.25, failure_min_sample: 20, serper_usd_per_request: null,
      storage_ok: true, storage_total_bytes: 1000, storage_measured_at: new Date(T0).toISOString(),
    },
    spent: 0,
    tables: {},
    calls: [],
    sleeps: [],
    respond,
    ...patch,
  };
}

function deps(w: World, budgetMs = 110_000): Deps {
  // deno-lint-ignore no-explicit-any
  const from = (table: string): any => {
    const tests: Array<(r: Row) => boolean> = [];
    let update: Row | null = null;
    const rows = (): Row[] => {
      if (table === "city_pipeline_runs") return [w.run];
      if (table === "city_pipeline_stages") return w.stages;
      if (table === "city_pipeline_settings") return [w.settings];
      if (table === "seeding_cities") return [{ id: "city-1", name: "City", country: "Land" }];
      return w.tables[table] ?? [];
    };
    const exec = () => {
      const hits = rows().filter((r) => tests.every((t) => t(r)));
      if (update) for (const r of hits) Object.assign(r, update);
      return { data: hits, error: null, count: hits.length };
    };
    // deno-lint-ignore no-explicit-any
    const chain: any = {
      select: () => chain,
      update: (p: Row) => { update = p; return chain; },
      eq: (k: string, v: unknown) => { tests.push((r) => r[k] === v); return chain; },
      in: (k: string, vs: unknown[]) => { tests.push((r) => vs.includes(r[k])); return chain; },
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => { const r = exec(); return Promise.resolve({ ...r, data: r.data[0] ?? null }); },
      single: () => { const r = exec(); return Promise.resolve({ ...r, data: r.data[0] ?? null }); },
      // deno-lint-ignore no-explicit-any
      then: (res: any, rej: any) => Promise.resolve(exec()).then(res, rej),
    };
    return chain;
  };
  const clock = () => w.clock;
  const call = w.fetch
    ? makeCall("https://local.test", "service-key", w.fetch)
    : async (fn: string, body: Row) => {
      w.calls.push({ fn, action: String(body.action ?? ""), body, at: w.clock });
      return await w.respond(fn, body, w);
    };
  return {
    db: {
      from,
      rpc: (name: string) => {
        const data: Record<string, unknown> = {
          city_pipeline_claim_tick: w.run.status === "running" ? [{ ...w.run }] : [],
          city_pipeline_gate_inputs: {
            db_bytes: 1,
            settings: w.settings,
            providers: { google_places: healthy, gemini: healthy, serper: healthy },
          },
          city_pipeline_spend_ledger: { known_actual_usd: w.spent, rows: [] },
          city_pipeline_place_counts: { held: 3, held_unjudged: 2 },
          city_pipeline_release_places: { released: 0, rejected: 0, unfinished: 0 },
        };
        return Promise.resolve({ data: data[name] ?? null, error: null });
      },
    },
    call,
    measureStorage: () => Promise.resolve({ ok: true, totalBytes: 1 }),
    now: clock,
    budgetMs,
    sleep: (ms: number) => {
      w.sleeps.push(ms);
      w.clock += ms;
      return Promise.resolve();
    },
  };
}

const ok = (body: Row = {}): CallResult => ({ status: 200, body });

/** A fill stage driving one running seeding run with open searches. */
function fillWorld(respond: World["respond"], patch: Partial<World> = {}): World {
  const w = world("fill", respond, patch);
  w.stages.find((s) => s.stage === "fill")!.cursor = { seeding_run_id: "s-1" };
  w.stages.find((s) => s.stage === "fill")!.status = "running";
  w.tables.seeding_runs = [{ id: "s-1", status: "running", completed_batches: 0, failed_batches: 0 }];
  w.tables.seeding_batches = [{ id: "b-open", run_id: "s-1", status: "pending" }];
  return w;
}

const searchCalls = (w: World) => w.calls.filter((c) => c.action === "run_next_batch");

// ── The call wrapper ────────────────────────────────────────────────────────

Deno.test("the call wrapper turns the runtime's RateLimitError into a 429 with its hint", async () => {
  assertEquals(rateLimitRetryAfterMs(new FakeRateLimitError(32000)), 32000);
  assertEquals(rateLimitRetryAfterMs(new Error("Rate limit exceeded for function. Retry after 1500ms.")), 1500);
  assertEquals(rateLimitRetryAfterMs(new Error("boom")), null);

  const call = makeCall("https://local.test", "k", () => Promise.reject(new FakeRateLimitError(32000)));
  assertEquals(await call("admin-seed-places", {}), {
    status: 429,
    body: { error: "function_rate_limited", retry_after_ms: 32000 },
  });

  const other = makeCall("https://local.test", "k", () => Promise.reject(new TypeError("connection reset")));
  let threw = false;
  try {
    await other("x", {});
  } catch (err) {
    threw = err instanceof TypeError;
  }
  assert(threw, "any other thrown error stays thrown");
});

Deno.test("a sub-call that hangs is cut off and comes back as 504 sub_call_timeout", async () => {
  const hang: typeof fetch = (_url, init) =>
    new Promise((_res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(init.signal!.reason));
    });
  const call = makeCall("https://local.test", "k", hang, 20);
  assertEquals(await call("x", {}), { status: 504, body: { error: "sub_call_timeout" } });
});

// ── SC-1: a rate limit is a wait ────────────────────────────────────────────

Deno.test("SC-1: RateLimitError after 40 searches leaves the run running, waiting, with no error streak", async () => {
  let fetched = 0;
  const w = fillWorld(() => ok());
  w.fetch = (input, init) => {
    const fn = String(input).split("/functions/v1/")[1];
    const body = JSON.parse(String(init?.body ?? "{}"));
    w.calls.push({ fn, action: String(body.action ?? ""), body, at: w.clock });
    fetched++;
    if (fetched > 40) return Promise.reject(new FakeRateLimitError(120_000));
    return Promise.resolve(new Response(JSON.stringify({ result: { status: "completed" } }), { status: 200 }));
  };

  const first = await tick(deps(w));
  assertEquals(first.ended, "wait:function_rate_limit");
  assertEquals(searchCalls(w).length, 41);
  assertEquals(w.run.status, "running");
  assertEquals(w.run.error_streak, 0);
  assertEquals(w.run.lease_until, null);
  assertEquals(w.run.next_attempt_at, new Date(w.clock + 120_000).toISOString());
  const outcome = w.run.last_outcome as Row;
  assertEquals(outcome.kind, "wait");
  assertEquals(outcome.why, "function_rate_limit");
  assertEquals(outcome.retry_after_ms, 120_000);
  assertEquals(outcome.calls, 41);
  assert(w.run.last_progress_at, "40 searches finished, so the tick moved the run");

  // Two more ticks that only meet the limit: still a wait, never a pause.
  for (let i = 0; i < 2; i++) {
    w.clock += 121_000;
    w.run.lease_until = `lease-${i}`;
    const out = await tick(deps(w));
    assertEquals(out.ended, "wait:function_rate_limit");
  }
  assertEquals(w.run.status, "running", "three rate-limited ticks must not pause the run");
  assertEquals(w.run.error_streak, 0);
  assertEquals(w.run.pause_reason, undefined);
});

Deno.test("a rate limit whose hint fits the tick is waited out inside it and the call retried once", async () => {
  let limited = false;
  const w = fillWorld((_fn, b) => {
    if (b.action === "run_next_batch" && searchCallsSoFar === 3 && !limited) {
      limited = true;
      return { status: 429, body: { error: "function_rate_limited", retry_after_ms: 5_000 } };
    }
    return ok();
  });
  let searchCallsSoFar = 0;
  const inner = w.respond;
  w.respond = (fn, b, ww) => {
    if (b.action === "run_next_batch") searchCallsSoFar++;
    return inner(fn, b, ww);
  };
  await tick(deps(w, 20_000));
  assert(w.sleeps.includes(5_000), "the hint was slept");
  assertEquals(w.run.status, "running");
  assertEquals((w.run.last_outcome as Row).kind, "progress", "the tick ran out of time, having moved");
  assertEquals(w.run.next_attempt_at, null);
});

// ── SC-2: a throw after progress ────────────────────────────────────────────

Deno.test("SC-2: a tick that moved the run and then threw keeps it running with error_streak 0", async () => {
  let n = 0;
  const w = fillWorld((_fn, b) => {
    if (b.action === "run_next_batch" && ++n > 5) return { status: 500, body: { error: "boom" } };
    return ok();
  });
  w.run.error_streak = 2; // one more no-progress failure would pause it
  const out = await tick(deps(w));
  assert(String(out.error).includes("boom"));
  assertEquals(out.progressed, true);
  assertEquals(w.run.status, "running");
  assertEquals(w.run.error_streak, 0);
  assert(String(w.run.last_error).includes("boom"));
  assertEquals((w.run.last_outcome as Row).kind, "error");
  assert(w.run.last_progress_at);
});

Deno.test("a throw with no progress still counts, and the third pauses with stage_error", async () => {
  const w = fillWorld(() => ({ status: 500, body: { error: "boom" } }));
  for (let i = 0; i < 3; i++) {
    w.run.lease_until = `lease-${i}`;
    await tick(deps(w));
  }
  assertEquals(w.run.status, "paused");
  assertEquals(w.run.pause_reason, "stage_error");
  assertEquals(w.run.error_streak, 3);
  assertEquals((w.run.last_outcome as Row).kind, "pause");
});

// ── Pacing and the per-tick cap ─────────────────────────────────────────────

Deno.test("calls to one function are spaced and capped per tick, and the cap ends the tick as budget", async () => {
  const w = fillWorld(() => ok());
  await tick(deps(w, 10 * 60_000));
  const searches = searchCalls(w);
  assertEquals(searches.length, MAX_CALLS_PER_FN_PER_TICK);
  for (let i = 1; i < searches.length; i++) {
    assert(searches[i].at - searches[i - 1].at >= MIN_CALL_GAP_MS, `call ${i} came ${searches[i].at - searches[i - 1].at} ms after the last`);
  }
  const outcome = w.run.last_outcome as Row;
  assertEquals(outcome.kind, "budget");
  assert(String(outcome.why).includes("admin-seed-places"));
  assertEquals(outcome.calls, MAX_CALLS_PER_FN_PER_TICK);
  assertEquals(w.run.status, "running");
  assertEquals(w.run.error_streak, 0);
});

Deno.test("no call starts once the tick's time is used, even inside a stage", async () => {
  const w = fillWorld(() => ok());
  await tick(deps(w, 5_000));
  const searches = searchCalls(w);
  assert(searches.length <= 6, `${searches.length} searches in a 5 s tick`);
  assert(searches.every((c) => c.at - T0 < 5_000), "a call went out after the budget");
  assertEquals((w.run.last_outcome as Row).kind, "progress");
});

// ── SC-3: the failure gate counts since the resume ──────────────────────────

Deno.test("SC-3: after a failure_rate pause, resume makes the gate count only new searches", async () => {
  const w = fillWorld(() => ok());
  w.tables.seeding_runs[0].completed_batches = 10;
  w.tables.seeding_runs[0].failed_batches = 10;
  assertEquals((await tick(deps(w))).ended, "failure_rate");
  assertEquals(w.run.status, "paused");
  assertEquals(searchCalls(w), []);
  assertEquals((w.run.last_outcome as Row).kind, "pause");

  w.run.pause_reason = "failure_rate";
  await resume(deps(w), { runId: "run-1" });
  assertEquals(w.run.status, "queued");
  const cursor = w.stages.find((s) => s.stage === "fill")!.cursor as Row;
  assertEquals(cursor.failure_base, { child: "s-1", failed: 10, finished: 20 });

  w.run.status = "running"; // what the claim does with a queued run
  w.run.lease_until = "lease-B";
  // Some new searches fail, but not past the limit since the resume.
  w.tables.seeding_runs[0].completed_batches = 25;
  w.tables.seeding_runs[0].failed_batches = 14;
  await tick(deps(w, 3_000));
  assert(searchCalls(w).length > 0, "the run searched again after the resume");
  assertEquals(w.run.status, "running");

  // Past the limit since the resume: it pauses again.
  w.tables.seeding_runs[0].failed_batches = 30;
  w.run.lease_until = "lease-C";
  assertEquals((await tick(deps(w))).ended, "failure_rate");
});

// ── SC-4: the photo retry pass ──────────────────────────────────────────────

Deno.test("SC-4: the photo retry pass carries over ticks, and 'Run is completed' ends it", async () => {
  const retried: string[] = [];
  const w = world("photos", (_fn, b) => {
    if (b.action === "run_next_batch") return ok({ done: true });
    if (b.action === "retry_batch") {
      if (b.batchId === "b5") return { status: 400, body: { error: "Run is completed, cannot execute batches" } };
      retried.push(String(b.batchId));
      return ok({ status: "completed" });
    }
    return ok({ result: { status: "completed" } });
  });
  const photos = w.stages.find((s) => s.stage === "photos")!;
  photos.status = "running";
  photos.cursor = { photo_run_id: "p-1" };
  for (const s of w.stages) if ((s.ord as number) > (photos.ord as number)) s.status = "skipped";
  w.tables.photo_backfill_runs = [{ id: "p-1", status: "completed", completed_batches: 20, failed_batches: 5, total_succeeded: 180 }];
  w.tables.photo_backfill_batches = ["b1", "b2", "b3", "b4", "b5"].map((id) => ({ id, run_id: "p-1", status: "failed" }));

  // A 3 s tick fits the batch call and three retries, 900 ms apart.
  await tick(deps(w, 3_000));
  assertEquals(retried, ["b1", "b2", "b3"]);
  assertEquals(w.run.current_stage, "photos", "the stage is not done while retries remain");
  assertEquals(w.run.status, "running");
  assertEquals((w.run.last_outcome as Row).kind, "progress");
  assertEquals((photos.cursor as Row).retried_ids, ["b1", "b2", "b3"]);
  assert(w.calls.filter((c) => c.action === "retry_batch").every((c) => c.at - T0 < 3_000), "a retry ran past the tick");

  // The next tick goes on from b4 and does not run the batches again.
  w.clock += 60_000;
  const batchesBefore = w.calls.filter((c) => c.action === "run_next_batch").length;
  w.run.lease_until = "lease-B";
  await tick(deps(w, 30_000));
  assertEquals(retried, ["b1", "b2", "b3", "b4"], "no batch is retried twice");
  assertEquals(w.calls.filter((c) => c.action === "run_next_batch").length, batchesBefore);
  assertEquals(w.run.error_streak, 0);
  assert(w.run.status === "running" || w.run.status === "complete");
  assert(w.run.current_stage !== "photos", "'Run is completed' ended the retries and the stage");
});

Deno.test("SC-4: a closed photo run answering 'Run is completed' to a batch ends the batches, not the run", async () => {
  const w = world("photos", (_fn, b) => {
    if (b.action === "run_next_batch") return { status: 400, body: { error: "Run is completed, cannot execute batches" } };
    return ok();
  });
  const photos = w.stages.find((s) => s.stage === "photos")!;
  photos.status = "running";
  photos.cursor = { photo_run_id: "p-1" };
  for (const s of w.stages) if ((s.ord as number) > (photos.ord as number)) s.status = "skipped";
  w.tables.photo_backfill_runs = [{ id: "p-1", status: "completed", completed_batches: 3, failed_batches: 0, total_succeeded: 30 }];
  w.tables.photo_backfill_batches = [];
  const out = await tick(deps(w, 30_000));
  assertEquals(out.error, undefined);
  assertEquals(w.run.error_streak, 0);
  assert(w.run.current_stage !== "photos");
});

// ── SC-5: lease ownership ───────────────────────────────────────────────────

Deno.test("SC-5: a tick that lost its lease can't clear the newer tick's lease or write its outcome", async () => {
  const w = fillWorld((_fn, b, ww) => {
    // Another tick claims the run while this one is still working.
    if (b.action === "run_next_batch") ww.run.lease_until = "lease-NEW";
    return ok();
  });
  await tick(deps(w, 3_000));
  assertEquals(w.run.lease_until, "lease-NEW");
  assertEquals(w.run.last_outcome, undefined);

  // The same on the error path.
  const e = fillWorld((_fn, b, ww) => {
    if (b.action === "run_next_batch") {
      ww.run.lease_until = "lease-NEW";
      return { status: 500, body: { error: "boom" } };
    }
    return ok();
  });
  await tick(deps(e));
  assertEquals(e.run.lease_until, "lease-NEW");
  assertEquals(e.run.error_streak, 0);
  assertEquals(e.run.last_error, undefined);
});

// ── Intelligence: a busy city, and spend while it runs ──────────────────────

Deno.test("an Intelligence 409 for a busy city is a wait, then a pause after 30 minutes", async () => {
  const w = world("intelligence", (fn, b) => {
    if (fn === "run-place-intelligence-trial" && b.estimate_only === true) {
      return ok({ totalPlaces: 40, estimatedCostUsd: 0.36, exceedsCostGuard: false });
    }
    if (fn === "run-place-intelligence-trial" && b.action === "start_run") {
      return { status: 409, body: { error: "concurrent_run", message: "A run is already in progress" } };
    }
    return ok();
  });
  assertEquals((await tick(deps(w))).ended, "wait:intelligence_city_busy");
  assertEquals(w.run.status, "running");
  assertEquals(w.run.error_streak, 0);
  assertEquals((w.run.last_outcome as Row).why, "intelligence_city_busy");
  const cursor = () => w.stages.find((s) => s.stage === "intelligence")!.cursor as Row;
  assertEquals(cursor().busy_since, new Date(T0).toISOString());

  w.clock += 10 * 60_000;
  w.run.lease_until = "lease-B";
  assertEquals((await tick(deps(w))).ended, "wait:intelligence_city_busy");
  assertEquals(cursor().busy_since, new Date(T0).toISOString(), "the first busy time is kept");

  w.clock += 21 * 60_000;
  w.run.lease_until = "lease-C";
  assertEquals((await tick(deps(w))).ended, "intelligence_busy");
  assertEquals(w.run.status, "paused");
  assertEquals(w.run.pause_reason, "intelligence_busy");
  assert(String((w.run.pause_detail as Row).message).includes("30 minutes"));
});

Deno.test("while Intelligence runs, each tick checks spend and pauses at the limit", async () => {
  const w = world("intelligence", () => ok(), { spent: 40 });
  const intel = w.stages.find((s) => s.stage === "intelligence")!;
  intel.status = "running";
  intel.cursor = { intel_run_id: "i-1" };
  w.tables.place_intelligence_runs = [{ id: "i-1", status: "running", processed_count: 10, failed_count: 0 }];
  assertEquals((await tick(deps(w))).ended, "wait:intelligence running");

  w.spent = 100; // the ledger reached the limit while it ran
  w.run.lease_until = "lease-B";
  assertEquals((await tick(deps(w))).ended, "spend_limit");
  assertEquals(w.run.status, "paused");
  const paused = w.calls.find((c) => c.action === "pause_run");
  assertEquals(paused?.body.run_id, "i-1", "the Intelligence run is paused too");
});

// ── Release: unjudged places are counted ────────────────────────────────────

Deno.test("release names the held places the final check never judged", async () => {
  const w = world("release", () => ok());
  // deno-lint-ignore no-explicit-any
  const d: any = deps(w);
  const rpc = d.db.rpc;
  d.db.rpc = (name: string) =>
    name === "city_pipeline_release_places"
      ? Promise.resolve({ data: { released: 1, rejected: 0, unfinished: 2 }, error: null })
      : rpc(name);
  assertEquals((await tick(d)).ended, "places_unfinished");
  assertEquals((w.run.pause_detail as Row).unjudged, 2);
});

// ── Every path writes last_outcome ──────────────────────────────────────────

Deno.test("every tick path writes last_outcome", async () => {
  const kinds: Record<string, string> = {};

  // approval
  const a = world("split", (_f, b) => {
    if (b.action === "preview_fill") return ok({ searches: 0, blockedByRun: null });
    if (b.action === "preview_split_level") {
      return ok({ sampling: false, nextLevel: 1, searches: 12, estimatedCostUsd: 0.38, blockedByRun: null, newUnresolved: 0 });
    }
    return ok();
  });
  await tick(deps(a));
  kinds.approval = (a.run.last_outcome as Row)?.kind as string;

  // pause (spend limit)
  const p = fillWorld(() => ok(), { spent: 100 });
  await tick(deps(p));
  kinds.pause = (p.run.last_outcome as Row)?.kind as string;

  // complete
  const c = world("thumbnails", () => ok({ status: "started" }));
  await tick(deps(c));
  kinds.complete = (c.run.last_outcome as Row)?.kind as string;

  // error, no progress
  const e = fillWorld(() => ({ status: 500, body: { error: "boom" } }));
  await tick(deps(e));
  kinds.error = (e.run.last_outcome as Row)?.kind as string;

  // progress (time ran out after moving)
  const g = fillWorld(() => ok());
  await tick(deps(g, 3_000));
  kinds.progress = (g.run.last_outcome as Row)?.kind as string;

  // wait
  const wt = world("intelligence", () => ok());
  const intel = wt.stages.find((s) => s.stage === "intelligence")!;
  intel.status = "running";
  intel.cursor = { intel_run_id: "i-1" };
  wt.tables.place_intelligence_runs = [{ id: "i-1", status: "running", processed_count: 1, failed_count: 0 }];
  await tick(deps(wt));
  kinds.wait = (wt.run.last_outcome as Row)?.kind as string;

  // budget (the per-function cap)
  const b = fillWorld(() => ok());
  await tick(deps(b, 10 * 60_000));
  kinds.budget = (b.run.last_outcome as Row)?.kind as string;

  assertEquals(kinds, {
    approval: "approval",
    pause: "pause",
    complete: "complete",
    error: "error",
    progress: "progress",
    wait: "wait",
    budget: "budget",
  });
  for (const r of [a, p, c, e, g, wt, b]) {
    const o = r.run.last_outcome as Row;
    assert(typeof o.at === "string" && typeof o.calls === "number" && "retry_after_ms" in o && typeof o.why === "string");
  }
});
