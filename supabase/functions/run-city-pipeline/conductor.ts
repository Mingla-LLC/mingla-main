// Issue #4276 C1 to C9: moves one city's run through its stages, one tick at a time.
// Every stage calls an existing function, which stays the sole writer of what it
// writes. Nothing here starts a run: a run exists only because an admin started it, and
// a tick with no run does nothing at all.
//
// Invariant I-4276-CONDUCTOR-NEVER-SPENDS-UNAPPROVED is declared in
// __tests__/issue_4276_conductor.implementor.test.ts.
import {
  databaseGate,
  failureGate,
  type GateInputs,
  type GateTrip,
  providerGate,
  spendGate,
  storageGate,
  unhealthyProviders,
} from "./gates.ts";
import { COST_PER_GEOCODE, COST_PER_NEARBY_SEARCH, HIGH_COST_USD } from "../_shared/seedingGeometry.ts";
import { type Plan, PlanError, planFromBody } from "./plan.ts";

// deno-lint-ignore no-explicit-any
export type Db = any;
export type CallResult = { status: number; body: Record<string, unknown> };

export interface Deps {
  db: Db;
  /** Calls another edge function with the service key. */
  call: (fn: string, body: Record<string, unknown>) => Promise<CallResult>;
  /** The existing storage guard. A full scan, so the result is cached in settings. */
  measureStorage: () => Promise<{ ok: boolean; totalBytes: number | null; message?: string | null }>;
  now?: () => number;
  budgetMs?: number;
  /** Waits between paced calls. Tests pass an instant one. */
  sleep?: (ms: number) => Promise<void>;
}

export const STORAGE_CACHE_MS = 10 * 60 * 1000;
export const TICK_BUDGET_MS = 110_000;
export const STAGE_ERROR_LIMIT = 3;
export const SEARCH_ROUND_LIMIT = 2;
const PAGE_ROWS = 1000;
const SCORE_CHUNK = 500;
const COMPLETENESS_SEARCHES = 20;
const REVIEW_MAX_PAGES = 5;

// #4276 live runs: the edge runtime rate-limits one function calling another (Abuja,
// 2026-11-07: about 60 calls a minute). Calls to one function are spaced out and capped
// per tick, and a rate limit is waited out instead of counted as a failure.
export const MIN_CALL_GAP_MS = 900;
export const MAX_CALLS_PER_FN_PER_TICK = 50;
/** A rate-limit hint is waited out inside the tick only when this much room is left after it. */
export const RATE_LIMIT_MARGIN_MS = 2_000;
const DEFAULT_RETRY_AFTER_MS = 60_000;
/** Another Intelligence run holding the city this long pauses the run for a person. */
export const INTELLIGENCE_BUSY_PAUSE_MS = 30 * 60 * 1000;
const PHOTO_RETRY_LIMIT = 50;

export type StageName =
  | "box" | "fill" | "split" | "completeness" | "pre_check" | "photos"
  | "final_check" | "intelligence" | "score" | "release" | "thumbnails";

const STAGE_ORDER: StageName[] = [
  "box", "fill", "split", "completeness", "pre_check", "photos",
  "final_check", "intelligence", "score", "release", "thumbnails",
];

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

type Outcome =
  | { kind: "done"; result?: unknown }
  | { kind: "step" }
  | { kind: "wait"; why: string; retryAfterMs?: number | null }
  | { kind: "budget"; why: string }
  | { kind: "approval"; key: string; reason: string; numbers: Record<string, unknown>; highCost: boolean }
  | { kind: "pause"; reason: string; detail: Record<string, unknown> };

interface Ctx {
  deps: Deps;
  run: Row;
  stage: Row;
  city: Row;
  gates: GateInputs;
  storage: { ok: boolean; totalBytes: number | null; message?: string | null };
  now: number;
  tick: TickState;
}

/** One tick's pacing and whether it moved anything forward. */
export interface TickState {
  started: number;
  budget: number;
  calls: number;
  perFn: Map<string, number>;
  lastAt: Map<string, number>;
  progressed: boolean;
}

export function newTickState(started: number, budget: number): TickState {
  return { started, budget, calls: 0, perFn: new Map(), lastAt: new Map(), progressed: false };
}

/** Ends the tick from inside a stage, with an outcome that is not a failure. */
class TickEnd extends Error {
  constructor(readonly outcome: Outcome) {
    super(`tick ended: ${outcome.kind}`);
  }
}

const TICK_BUDGET_USED = "tick budget used";

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Every sub-call a stage makes. Checks the tick budget first, keeps calls to one
 * function MIN_CALL_GAP_MS apart and at most MAX_CALLS_PER_FN_PER_TICK per tick (then
 * ends the tick as budget), and waits out a function rate limit: inside the tick when
 * the hint fits, otherwise by ending the tick as a wait with the hint.
 */
export async function callPaced(ctx: Ctx, fn: string, body: Record<string, unknown>): Promise<CallResult> {
  const t = ctx.tick;
  const clock = ctx.deps.now ?? Date.now;
  const sleep = ctx.deps.sleep ?? realSleep;
  const remaining = () => t.budget - (clock() - t.started);

  const once = async (): Promise<CallResult> => {
    if (remaining() <= 0) throw new TickEnd({ kind: "budget", why: TICK_BUDGET_USED });
    const count = t.perFn.get(fn) ?? 0;
    if (count >= MAX_CALLS_PER_FN_PER_TICK) {
      throw new TickEnd({ kind: "budget", why: `${fn} call limit for one tick` });
    }
    const last = t.lastAt.get(fn);
    if (last !== undefined) {
      const gap = MIN_CALL_GAP_MS - (clock() - last);
      if (gap > 0) {
        await sleep(gap);
        if (remaining() <= 0) throw new TickEnd({ kind: "budget", why: TICK_BUDGET_USED });
      }
    }
    t.perFn.set(fn, count + 1);
    t.calls++;
    t.lastAt.set(fn, clock());
    return await ctx.deps.call(fn, body);
  };

  let result = await once();
  if (result.status !== 429) return result;
  const hint = Number(result.body?.retry_after_ms);
  const retryAfterMs = Number.isFinite(hint) && hint >= 0 ? hint : DEFAULT_RETRY_AFTER_MS;
  if (retryAfterMs + RATE_LIMIT_MARGIN_MS <= remaining()) {
    await sleep(retryAfterMs);
    result = await once();
    if (result.status !== 429) return result;
  }
  throw new TickEnd({ kind: "wait", why: "function_rate_limit", retryAfterMs });
}

/** A failure gate measures only since the last resume or since the child started. */
function failureBase(ctx: Ctx, childId: string): { failed: number; finished: number } {
  const base = ctx.stage.cursor?.failure_base;
  if (base && base.child === childId) {
    return { failed: Number(base.failed ?? 0), finished: Number(base.finished ?? 0) };
  }
  return { failed: 0, finished: 0 };
}

function gateSince(ctx: Ctx, childId: string, failed: number, finished: number, what: string): GateTrip | null {
  const base = failureBase(ctx, childId);
  return failureGate(ctx.gates, Math.max(0, failed - base.failed), Math.max(0, finished - base.finished), what);
}

// ── Small helpers ───────────────────────────────────────────────────────────

async function rpc(db: Db, name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

async function saveStage(ctx: Ctx, patch: Row): Promise<void> {
  const { error } = await ctx.deps.db.from("city_pipeline_stages").update(patch).eq("id", ctx.stage.id);
  if (error) throw new Error(`stage update failed: ${error.message}`);
  Object.assign(ctx.stage, patch);
}

function refs(ctx: Ctx, key: string): string[] {
  return Array.isArray(ctx.stage.refs?.[key]) ? ctx.stage.refs[key] : [];
}

async function addRef(ctx: Ctx, key: string, id: string): Promise<void> {
  const list = refs(ctx, key);
  if (list.includes(id)) return;
  await saveStage(ctx, { refs: { ...ctx.stage.refs, [key]: [...list, id] } });
}

async function setCursor(ctx: Ctx, patch: Row): Promise<void> {
  await saveStage(ctx, { cursor: { ...ctx.stage.cursor, ...patch } });
}

function must(result: CallResult, what: string): Record<string, unknown> {
  if (result.status >= 400) {
    throw new Error(`${what} returned ${result.status}: ${JSON.stringify(result.body).slice(0, 300)}`);
  }
  return result.body;
}

export async function runSpendUsd(db: Db, run: Row): Promise<number> {
  const ledger = await rpc(db, "city_pipeline_spend_ledger", { p_city_id: run.city_id, p_run_id: run.id });
  return Number(ledger?.known_actual_usd ?? 0);
}

/** Runs before anything paid: the spend limit and the providers this step needs. */
async function paidStepBlocked(
  ctx: Ctx,
  providers: readonly string[],
  estimateUsd: number,
): Promise<Outcome | null> {
  const provider = providerGate(ctx.gates, providers, ctx.now);
  if (provider) return { kind: "pause", reason: provider.reason, detail: provider.detail };
  const spend = spendGate(Number(ctx.run.spend_limit_usd), await runSpendUsd(ctx.deps.db, ctx.run), estimateUsd);
  if (spend) return { kind: "pause", reason: spend.reason, detail: spend.detail };
  return null;
}

function approved(ctx: Ctx, key: string): Row | null {
  const a = ctx.stage.approval;
  return a?.status === "approved" && a.key === key ? a : null;
}

// ── Searches: one driver for fill and split ─────────────────────────────────

const googleSearch = ["google_places"] as const;

/**
 * One search of a level at a time. A level with failures ends here, and the next round
 * picks them up as unfinished searches, so a failed search is never quietly dropped.
 */
async function driveSearch(ctx: Ctx): Promise<Outcome | null> {
  const runId = ctx.stage.cursor?.seeding_run_id;
  if (!runId) return null;
  const { data: child, error } = await ctx.deps.db
    .from("seeding_runs").select("*").eq("id", runId).single();
  if (error) throw new Error(`seeding run read failed: ${error.message}`);

  const finished = Number(child.completed_batches) + Number(child.failed_batches);
  const failure = gateSince(ctx, runId, Number(child.failed_batches), finished, "searches");
  if (failure) return { kind: "pause", reason: failure.reason, detail: { ...failure.detail, seeding_run_id: runId } };

  if (["completed", "cancelled", "failed_preparing"].includes(child.status)) {
    await setCursor(ctx, { seeding_run_id: null });
    return { kind: "step" };
  }

  const { count: open, error: openErr } = await ctx.deps.db
    .from("seeding_batches").select("id", { count: "exact", head: true })
    .eq("run_id", runId).in("status", ["pending", "running"]);
  if (openErr) throw new Error(`batch count failed: ${openErr.message}`);

  if ((open ?? 0) === 0) {
    // Only failed searches are left. Ending the level frees the city for the next round.
    must(await callPaced(ctx, "admin-seed-places", { action: "cancel_run", runId }), "cancel_run");
    await setCursor(ctx, { seeding_run_id: null });
    return { kind: "step" };
  }

  const blocked = await paidStepBlocked(ctx, googleSearch, COST_PER_NEARBY_SEARCH);
  if (blocked) return blocked;

  const step = must(
    await callPaced(ctx, "admin-seed-places", { action: "run_next_batch", runId }),
    "run_next_batch",
  );
  if (step.waiting === true) return { kind: "wait", why: "a search is still running" };
  // C8: still rate limited after the backoff. Slow down until the next tick.
  const stepResult = step.result as Row | undefined;
  if (step.status === "failed" && /^Google API 429/.test(String(stepResult?.error ?? ""))) {
    return { kind: "wait", why: "google rate limit" };
  }
  return { kind: "step" };
}

async function activeForeignRun(blockedBy: unknown, own: string | null | undefined): Promise<Row | null> {
  const run = blockedBy as Row | null;
  return run && run.id !== own ? run : null;
}

/** Searches the plan names as unfinished. Returns null when there are none left. */
async function fillRound(ctx: Ctx): Promise<Outcome | null> {
  const preview = must(
    await callPaced(ctx, "admin-seed-places", { action: "preview_fill", cityId: ctx.run.city_id }),
    "preview_fill",
  );
  const foreign = await activeForeignRun(preview.blockedByRun, ctx.stage.cursor?.seeding_run_id);
  if (foreign) {
    return { kind: "pause", reason: "blocked_by_run", detail: { run: foreign } };
  }
  const searches = Number(preview.searches ?? 0);
  if (searches === 0) return null;

  const rounds = Number(ctx.stage.cursor?.fill_rounds ?? 0);
  if (rounds >= SEARCH_ROUND_LIMIT && !ctx.stage.cursor?.retry_requested) {
    return {
      kind: "pause",
      reason: "search_failures",
      detail: { unfinished: searches, failed: preview.failed, never_searched: preview.neverSearched, rounds },
    };
  }

  const estimate = Number(preview.estimatedCostUsd ?? 0);
  await saveStage(ctx, { estimate: { google_usd: estimate, searches, basis: "plan" } });
  const key = `fill:${searches}`;
  const highCost = preview.exceedsHighCost === true;
  const grant = approved(ctx, key);
  if (highCost && !grant) {
    return { kind: "approval", key, reason: "high_cost", numbers: preview, highCost: true };
  }

  const blocked = await paidStepBlocked(ctx, googleSearch, estimate);
  if (blocked) return blocked;

  const started = must(
    await callPaced(ctx, "admin-seed-places", {
      action: "start_fill",
      cityId: ctx.run.city_id,
      confirm: true,
      acceptHighCost: grant?.confirm_high_cost === true,
      expectedSearches: searches,
    }),
    "start_fill",
  );
  if (started.runId) await addRef(ctx, "seeding_run_ids", String(started.runId));
  await setCursor(ctx, { seeding_run_id: started.runId ?? null, fill_rounds: rounds + 1, retry_requested: false });
  return { kind: "step" };
}

// ── Stages ──────────────────────────────────────────────────────────────────

async function stageBox(ctx: Ctx): Promise<Outcome> {
  if (!ctx.stage.cursor?.box_done) {
    // #4276: planning and applying the box each geocode with Google, so the step goes
    // through the same spend and provider gate as any other paid step.
    const blocked = await paidStepBlocked(ctx, googleSearch, 2 * COST_PER_GEOCODE);
    if (blocked) return blocked;
    const plan = must(
      await callPaced(ctx, "admin-seed-places", { action: "plan_city_box", cityId: ctx.run.city_id }),
      "plan_city_box",
    );
    await saveStage(ctx, { estimate: { google_usd: plan.estimatedSeedCostUsd, tiles: plan.tiles, basis: "box" } });
    const key = `box:${JSON.stringify(plan.box)}`;
    const grant = approved(ctx, key);
    if (plan.autoApply !== true && !grant) {
      return {
        kind: "approval",
        key,
        reason: "box_needs_person",
        numbers: {
          askReasons: plan.askReasons,
          box: plan.box,
          stored: plan.stored,
          estimatedSeedCostUsd: plan.estimatedSeedCostUsd,
          tiles: plan.tiles,
          overlaps: plan.overlaps,
          placesOutside: plan.placesOutside,
        },
        highCost: false,
      };
    }
    const applied = await callPaced(ctx, "admin-seed-places", {
      action: "apply_city_box",
      cityId: ctx.run.city_id,
      confirm: !!grant,
    });
    if (applied.status === 409 && applied.body.code === "active_run") {
      return { kind: "pause", reason: "blocked_by_run", detail: { run: applied.body.activeRun } };
    }
    must(applied, "apply_city_box");
    await setCursor(ctx, { box_done: true, applied: applied.body.applied === true });
  }
  // A box that didn't move still needs tiles if the city never had any.
  must(await callPaced(ctx, "admin-seed-places", { action: "generate_tiles", cityId: ctx.run.city_id }), "generate_tiles");
  return { kind: "done" };
}

async function stageFill(ctx: Ctx): Promise<Outcome> {
  const driving = await driveSearch(ctx);
  if (driving) return driving;
  const round = await fillRound(ctx);
  return round ?? { kind: "done" };
}

async function stageSplit(ctx: Ctx): Promise<Outcome> {
  const driving = await driveSearch(ctx);
  if (driving) return driving;

  // A failed search in a finished level comes first, so a level is whole before the
  // next is priced.
  const round = await fillRound(ctx);
  if (round) return round;

  const preview = must(
    await callPaced(ctx, "admin-seed-places", { action: "preview_split_level", cityId: ctx.run.city_id }),
    "preview_split_level",
  );
  const foreign = await activeForeignRun(preview.blockedByRun, null);
  if (foreign) return { kind: "pause", reason: "blocked_by_run", detail: { run: foreign } };

  const searches = Number(preview.searches ?? 0);
  if (searches === 0 && Number(preview.newUnresolved ?? 0) === 0) return { kind: "done" };

  // Logging what can't be resolved spends nothing, so it needs nobody.
  const free = searches === 0;
  const key = `split:${preview.nextLevel}:${searches}`;
  const estimate = Number(preview.estimatedCostUsd ?? 0);
  await saveStage(ctx, {
    estimate: {
      google_usd: estimate,
      searches,
      level: preview.nextLevel,
      cost_is_floor: preview.costIsFloor,
      basis: "capped searches",
    },
  });

  const grant = approved(ctx, key);
  if (!free && !grant) {
    return {
      kind: "approval",
      key,
      reason: preview.sampling === true ? "split_sample" : "split_level",
      numbers: preview,
      highCost: preview.exceedsHighCost === true,
    };
  }
  if (!free) {
    const blocked = await paidStepBlocked(ctx, googleSearch, estimate);
    if (blocked) return blocked;
  }

  const started = must(
    await callPaced(ctx, "admin-seed-places", {
      action: "start_split_level",
      cityId: ctx.run.city_id,
      confirm: true,
      acceptHighCost: grant?.confirm_high_cost === true,
      expectedLevel: preview.nextLevel,
    }),
    "start_split_level",
  );
  // One approval, one level.
  await saveStage(ctx, { approval: null });
  if (started.runId) await addRef(ctx, "seeding_run_ids", String(started.runId));
  await setCursor(ctx, { seeding_run_id: started.runId ?? null });
  return { kind: "step" };
}

async function stageCompleteness(ctx: Ctx): Promise<Outcome> {
  const estimate = Math.round(COMPLETENESS_SEARCHES * COST_PER_NEARBY_SEARCH * 1000) / 1000;
  await saveStage(ctx, { estimate: { google_usd: estimate, searches: COMPLETENESS_SEARCHES, basis: "fixed sample" } });
  const blocked = await paidStepBlocked(ctx, googleSearch, estimate);
  if (blocked) return blocked;
  const check = must(
    await callPaced(ctx, "admin-seed-places", {
      action: "run_completeness_check",
      cityId: ctx.run.city_id,
      confirm: true,
    }),
    "run_completeness_check",
  );
  if (check.id) await addRef(ctx, "completeness_check_ids", String(check.id));
  if (check.status !== "completed") {
    const attempts = Number(ctx.stage.cursor?.attempts ?? 0) + 1;
    await setCursor(ctx, { attempts });
    if (attempts >= 2) {
      return { kind: "pause", reason: "completeness_failed", detail: { error: check.error_message } };
    }
    return { kind: "wait", why: "completeness check failed; trying once more" };
  }
  return { kind: "done", result: { missing_share: check.missing_share, results_missing: check.results_missing } };
}

/** C6: new-only unless a person chose the whole city. Pages through by cursor. */
async function stageCheck(ctx: Ctx, fn: "run-pre-photo-bouncer" | "run-bouncer"): Promise<Outcome> {
  // Never-judged places have never been shown, so they wait with the new ones. Without
  // this, a check would turn an old unjudged place servable on rules alone.
  if (fn === "run-pre-photo-bouncer" && !ctx.stage.cursor?.held_unjudged) {
    const held = await rpc(ctx.deps.db, "city_pipeline_hold_unjudged", { p_city_id: ctx.run.city_id });
    await setCursor(ctx, { held_unjudged: true, newly_held: held });
  }
  const page = must(
    await callPaced(ctx, fn, {
      city_id: ctx.run.city_id,
      only_unprocessed: ctx.run.scope === "new_only",
      after_id: ctx.stage.cursor?.after_id ?? null,
      max_rows: PAGE_ROWS,
    }),
    fn,
  );
  const writeErrors = Number(page.write_errors ?? 0);
  if (writeErrors > 0) {
    return { kind: "pause", reason: "check_write_errors", detail: { fn, write_errors: writeErrors, first: page.first_write_error } };
  }
  const processed = Number(ctx.stage.cursor?.processed ?? 0) + Number(page.processed ?? 0);
  if (page.done === true) {
    return { kind: "done", result: { processed } };
  }
  await setCursor(ctx, { after_id: page.next_cursor, processed });
  return { kind: "step" };
}

/** A run the photo function has already closed: there is nothing left to run or retry. */
function photoRunClosed(result: CallResult): boolean {
  return result.status === 400 && /^Run is (completed|cancelled|failed)/.test(String(result.body?.error ?? ""));
}

async function stagePhotos(ctx: Ctx): Promise<Outcome> {
  const cityArgs = { cityId: ctx.run.city_id, city: ctx.city.name, country: ctx.city.country, mode: "pre_photo_passed" };
  let runId: string | null = ctx.stage.cursor?.photo_run_id ?? null;

  if (!runId) {
    const preview = must(await callPaced(ctx, "backfill-place-photos", { action: "preview_run", ...cityArgs }), "preview_run");
    if (preview.status === "nothing_to_do") return { kind: "done", result: { places: 0 } };
    const estimate = Number(preview.estimatedCostUsd ?? 0);
    await saveStage(ctx, { estimate: { google_usd: estimate, places: preview.totalPlaces, basis: "plan" } });
    const key = `photos:${preview.totalPlaces}`;
    if (estimate > HIGH_COST_USD && !approved(ctx, key)) {
      return { kind: "approval", key, reason: "high_cost", numbers: preview, highCost: true };
    }
    const blocked = await paidStepBlocked(ctx, googleSearch, estimate);
    if (blocked) return blocked;

    const created = await callPaced(ctx, "backfill-place-photos", { action: "create_run", ...cityArgs });
    if (created.status === 507) {
      return { kind: "pause", reason: "storage_limit", detail: created.body };
    }
    must(created, "create_run");
    if (created.body.status === "nothing_to_do") return { kind: "done", result: { places: 0 } };
    runId = String(created.body.runId);
    await addRef(ctx, "photo_run_ids", runId);
    // A new photo run counts its failures from zero.
    await setCursor(ctx, { photo_run_id: runId, failure_base: null });
    ctx.tick.progressed = true;
  }

  const { data: child, error } = await ctx.deps.db
    .from("photo_backfill_runs").select("*").eq("id", runId).single();
  if (error) throw new Error(`photo run read failed: ${error.message}`);

  // A cursor from before #4276 live runs ran its retries in one go: it is finished.
  const legacyRetried = ctx.stage.cursor?.retried === true && !Array.isArray(ctx.stage.cursor?.retry_ids);

  if (!ctx.stage.cursor?.batches_done && !legacyRetried) {
    const finished = Number(child.completed_batches) + Number(child.failed_batches);
    const failure = gateSince(ctx, runId, Number(child.failed_batches), finished, "photo batches");
    if (failure) return { kind: "pause", reason: failure.reason, detail: { ...failure.detail, photo_run_id: runId } };

    const blocked = await paidStepBlocked(ctx, googleSearch, 0);
    if (blocked) return blocked;

    const step = await callPaced(ctx, "backfill-place-photos", { action: "run_next_batch", runId });
    if (step.status === 507) return { kind: "pause", reason: "storage_limit", detail: step.body };
    if (!photoRunClosed(step)) {
      must(step, "run_next_batch");
      if (step.body.done !== true) return { kind: "step" };
    }
    await setCursor(ctx, { batches_done: true });
    ctx.tick.progressed = true;
  }

  // A transient failure shouldn't cost a place its photos: one retry per failed batch,
  // at most PHOTO_RETRY_LIMIT, paced and carried over ticks by the cursor.
  if (!legacyRetried) {
    let retryIds: string[] = Array.isArray(ctx.stage.cursor?.retry_ids) ? ctx.stage.cursor.retry_ids : [];
    if (!Array.isArray(ctx.stage.cursor?.retry_ids)) {
      const { data: failed, error: failedErr } = await ctx.deps.db
        .from("photo_backfill_batches").select("id").eq("run_id", runId).eq("status", "failed")
        .order("id").limit(PHOTO_RETRY_LIMIT);
      if (failedErr) throw new Error(`failed photo batches read failed: ${failedErr.message}`);
      retryIds = (failed ?? []).map((b: Row) => String(b.id));
      await setCursor(ctx, { retry_ids: retryIds, retried_ids: [] });
    }
    const retried: string[] = Array.isArray(ctx.stage.cursor?.retried_ids) ? [...ctx.stage.cursor.retried_ids] : [];
    for (const batchId of retryIds) {
      if (retried.includes(batchId)) continue;
      const blocked = await paidStepBlocked(ctx, googleSearch, 0);
      if (blocked) return blocked;
      const res = await callPaced(ctx, "backfill-place-photos", { action: "retry_batch", runId, batchId });
      if (res.status === 507) return { kind: "pause", reason: "storage_limit", detail: res.body };
      if (photoRunClosed(res)) break; // the run is closed: retries end here
      // A batch that is no longer failed was retried by a tick that died before saving.
      if (!(res.status === 400 && /^Batch is /.test(String(res.body?.error ?? "")))) must(res, "retry_batch");
      retried.push(batchId);
      await setCursor(ctx, { retried_ids: retried });
      ctx.tick.progressed = true;
    }
    await setCursor(ctx, { retried: true });
  }

  return { kind: "done", result: { failed_batches: child.failed_batches, total_succeeded: child.total_succeeded } };
}

const INTELLIGENCE_BUSY = new Set(["concurrent_run", "concurrent_run_for_city", "city_busy"]);

/** Another Intelligence run holds the city: wait, and after 30 minutes ask a person. */
async function intelligenceBusy(ctx: Ctx, result: CallResult): Promise<Outcome | null> {
  if (result.status !== 409 || !INTELLIGENCE_BUSY.has(String(result.body?.error ?? ""))) return null;
  const since = ctx.stage.cursor?.busy_since ? Date.parse(ctx.stage.cursor.busy_since) : NaN;
  if (Number.isNaN(since)) {
    await setCursor(ctx, { busy_since: new Date(ctx.now).toISOString() });
    return { kind: "wait", why: "intelligence_city_busy" };
  }
  if (ctx.now - since >= INTELLIGENCE_BUSY_PAUSE_MS) {
    return {
      kind: "pause",
      reason: "intelligence_busy",
      detail: {
        busy_since: ctx.stage.cursor.busy_since,
        message: "Another Intelligence run has held this city for 30 minutes. Resume when it has finished, or cancel it.",
      },
    };
  }
  return { kind: "wait", why: "intelligence_city_busy" };
}

/** While Intelligence runs, its spend keeps rising: stop when the ledger reaches the limit. */
async function intelligenceSpendReached(ctx: Ctx): Promise<Outcome | null> {
  const limit = Number(ctx.run.spend_limit_usd);
  const spent = await runSpendUsd(ctx.deps.db, ctx.run);
  if (spent >= limit) {
    return { kind: "pause", reason: "spend_limit", detail: { limit_usd: limit, spent_usd: spent, next_estimate_usd: 0 } };
  }
  return null;
}

async function stageIntelligence(ctx: Ctx): Promise<Outcome> {
  if (ctx.run.rules_only) return { kind: "done", result: { rules_only: true, by: ctx.run.rules_only_by } };
  const db = ctx.deps.db;
  const admin = ctx.run.started_by;
  const childId: string | null = ctx.stage.cursor?.intel_run_id ?? null;

  if (childId) {
    const { data: child, error } = await db
      .from("place_intelligence_runs").select("*").eq("id", childId).single();
    if (error) throw new Error(`intelligence run read failed: ${error.message}`);

    switch (child.status) {
      case "queued":
      case "pending":
      case "running":
      case "cancelling": {
        const finished = Number(child.processed_count);
        const failure = gateSince(ctx, childId, Number(child.failed_count), finished, "places");
        if (failure) {
          must(await callPaced(ctx, "run-place-intelligence-trial", {
            action: "pause_run", run_id: childId, admin_id: admin, reason: "failure_rate",
          }), "pause_run");
          return { kind: "pause", reason: failure.reason, detail: { ...failure.detail, intel_run_id: childId } };
        }
        const overSpend = await intelligenceSpendReached(ctx);
        if (overSpend) return overSpend;
        return { kind: "wait", why: "intelligence running" };
      }
      case "paused":
        return {
          kind: "pause",
          reason: child.error_reason === "review_provider_out_of_credits" ? "provider_unhealthy" : "intelligence_paused",
          detail: { intel_run_id: childId, child_reason: child.error_reason, provider: "serper" },
        };
      case "complete":
      case "failed":
      case "cancelled":
        break;
      default:
        throw new Error(`intelligence run has unknown status ${child.status}`);
    }

    if (child.status !== "complete" || Number(child.failed_count) > 0) {
      if (!ctx.stage.cursor?.retry_requested) {
        return {
          kind: "pause",
          reason: "intelligence_failures",
          detail: { intel_run_id: childId, status: child.status, failed: child.failed_count, succeeded: child.succeeded_count },
        };
      }
      const blockedRetry = await paidStepBlocked(ctx, ["serper", "gemini"], 0);
      if (blockedRetry) return blockedRetry;
      const retried = await callPaced(ctx, "run-place-intelligence-trial", {
        action: "retry_failed_run",
        source_run_id: childId,
        retry_filter: "all_failed",
        admin_id: admin,
      });
      const busy = await intelligenceBusy(ctx, retried);
      if (busy) return busy;
      must(retried, "retry_failed_run");
      const retryId = String(retried.body.runId ?? retried.body.run_id);
      await addRef(ctx, "intel_run_ids", retryId);
      // A new Intelligence run counts its failures from zero.
      await setCursor(ctx, { intel_run_id: retryId, retry_requested: false, busy_since: null, failure_base: null });
      ctx.tick.progressed = true;
      return { kind: "wait", why: "intelligence retry started" };
    }
    return { kind: "done", result: { succeeded: child.succeeded_count, cost_usd: child.cost_so_far_usd } };
  }

  const startArgs = intelligenceArgs(ctx.run.city_id, admin, ctx.run.scope, {
    planned: ctx.stage.cursor?.plan === true,
    redo: ctx.stage.cursor?.redo === true,
  });
  const estimateCall = await callPaced(ctx, "run-place-intelligence-trial", { ...startArgs, estimate_only: true });
  if (estimateCall.status === 400 && ["no_remainder", "No servable places in city"].includes(String(estimateCall.body.error))) {
    return { kind: "done", result: { places: 0 } };
  }
  const preview = must(estimateCall, "start_run estimate");
  const places = Number(preview.totalPlaces ?? 0);
  if (places === 0) return { kind: "done", result: { places: 0 } };

  // Serper is priced only from the configured rate. Its requests are shown either way.
  const serperRate = ctx.gates.settings.serper_usd_per_request;
  const serperRequests = places * REVIEW_MAX_PAGES;
  const serperUsd = serperRate === null || serperRate === undefined ? null : serperRequests * Number(serperRate);
  const geminiUsd = Number(preview.estimatedCostUsd ?? 0);
  await saveStage(ctx, {
    estimate: {
      gemini_usd: geminiUsd,
      places,
      serper_requests_max: serperRequests,
      serper_usd: serperUsd,
      basis: "places times per-place cost",
    },
  });

  const key = `intelligence:${places}`;
  const grant = approved(ctx, key);
  if (preview.exceedsCostGuard === true && !grant) {
    return { kind: "approval", key, reason: "high_cost", numbers: { ...preview, serper_requests_max: serperRequests, serper_usd: serperUsd }, highCost: true };
  }

  const blocked = await paidStepBlocked(ctx, ["serper", "gemini"], geminiUsd + (serperUsd ?? 0));
  if (blocked) return blocked;

  const startCall = await callPaced(ctx, "run-place-intelligence-trial", {
    ...startArgs,
    confirm_high_cost: grant?.confirm_high_cost === true,
  });
  const busy = await intelligenceBusy(ctx, startCall);
  if (busy) return busy;
  const started = must(startCall, "start_run");
  const id = String(started.runId);
  await addRef(ctx, "intel_run_ids", id);
  await setCursor(ctx, { intel_run_id: id, busy_since: null, failure_base: null });
  ctx.tick.progressed = true;
  return { kind: "wait", why: "intelligence started" };
}

/**
 * What the Intelligence stage asks run-place-intelligence-trial for. An unplanned run
 * takes the places held for their first evaluation (new_only) or those plus every
 * servable place (whole_city). A planned run was asked for Intelligence on the city's
 * gaps, which are servable places, so it takes servable and held, never a place held in
 * the score backlog. A redo adds the servable places with no reviews on record and
 * fetches their reviews afresh.
 */
export function intelligenceArgs(
  cityId: string,
  adminId: string,
  scope: string,
  opts: { planned: boolean; redo: boolean },
): Record<string, unknown> {
  return {
    action: "start_run",
    city_id: cityId,
    mode: "remainder",
    place_scope: opts.planned || scope !== "new_only" ? "servable_and_held" : "held",
    admin_id: adminId,
    // #4276: a planned run never judges a place held in the score backlog, redo or not.
    // The trial function then takes place_intel_planned_place_ids and checks every id.
    ...(opts.planned ? { respect_score_hold: true } : {}),
    ...(opts.redo ? { include_no_reviews: true, force_refresh_reviews: true } : {}),
  };
}

/**
 * Only what this run evaluated, or held places when a person chose rules only. A
 * city-wide score here would release held pre-2026-11-05 AI results into live decks.
 */
async function stageScore(ctx: Ctx): Promise<Outcome> {
  const db = ctx.deps.db;
  let signals: string[] = ctx.stage.cursor?.signals ?? [];
  if (!ctx.stage.cursor?.signals) {
    const { data, error } = await db
      .from("signal_definitions").select("id").eq("is_active", true)
      .not("current_version_id", "is", null).order("id");
    if (error) throw new Error(`signal read failed: ${error.message}`);
    signals = (data ?? []).map((s: Row) => s.id);
    await setCursor(ctx, { signals, signal_index: 0, after_id: null, written: 0 });
  }
  const index = Number(ctx.stage.cursor.signal_index ?? 0);
  if (index >= signals.length) {
    return { kind: "done", result: { signals: signals.length, written: ctx.stage.cursor.written } };
  }

  const ids: string[] = await rpc(db, "city_pipeline_places_to_score", {
    p_run_id: ctx.run.id,
    p_after_id: ctx.stage.cursor.after_id ?? null,
    p_limit: SCORE_CHUNK,
  });
  if (!ids || ids.length === 0) {
    await setCursor(ctx, { signal_index: index + 1, after_id: null });
    return { kind: "step" };
  }
  const page = must(
    await callPaced(ctx, "run-signal-scorer", {
      signal_id: signals[index],
      place_ids: ids,
      include_held: true,
    }),
    "run-signal-scorer",
  );
  if (page.done !== true) {
    throw new Error(`scorer did not finish a page of ${ids.length} places`);
  }
  await setCursor(ctx, {
    after_id: ids[ids.length - 1],
    written: Number(ctx.stage.cursor.written ?? 0) + Number(page.written ?? 0),
  });
  return { kind: "step" };
}

async function stageRelease(ctx: Ctx): Promise<Outcome> {
  const released = await rpc(ctx.deps.db, "city_pipeline_release_places", {
    p_city_id: ctx.run.city_id,
    p_rules_only: ctx.run.rules_only === true,
  });
  const total = Number(ctx.stage.cursor?.released ?? 0) + Number(released.released ?? 0);
  await setCursor(ctx, { released: total });
  if (Number(released.unfinished) > 0) {
    // Places the final check never judged can't be released on any path; say how many,
    // so a person knows the final check has to run again for them.
    const counts = await rpc(ctx.deps.db, "city_pipeline_place_counts", { p_city_id: ctx.run.city_id });
    return {
      kind: "pause",
      reason: "places_unfinished",
      detail: {
        ...released,
        released_so_far: total,
        unjudged: Number(counts?.held_unjudged ?? 0),
        choices: ["resume", "rules_only", "cancel"],
      },
    };
  }
  return { kind: "done", result: { ...released, released: total } };
}

/** After release, because thumbnails only select servable places. The work is its own run. */
async function stageThumbnails(ctx: Ctx): Promise<Outcome> {
  const kicked = await callPaced(ctx, "backfill-place-photo-thumbs", { action: "ensure_auto_run" });
  if (kicked.status === 507) {
    return { kind: "pause", reason: "storage_limit", detail: kicked.body };
  }
  must(kicked, "ensure_auto_run");
  return { kind: "done", result: { thumbnails: kicked.body.status ?? null } };
}

async function runStage(ctx: Ctx): Promise<Outcome> {
  switch (ctx.stage.stage as StageName) {
    case "box": return await stageBox(ctx);
    case "fill": return await stageFill(ctx);
    case "split": return await stageSplit(ctx);
    case "completeness": return await stageCompleteness(ctx);
    case "pre_check": return await stageCheck(ctx, "run-pre-photo-bouncer");
    case "photos": return await stagePhotos(ctx);
    case "final_check": return await stageCheck(ctx, "run-bouncer");
    case "intelligence": return await stageIntelligence(ctx);
    case "score": return await stageScore(ctx);
    case "release": return await stageRelease(ctx);
    case "thumbnails": return await stageThumbnails(ctx);
  }
}

// ── The tick ────────────────────────────────────────────────────────────────

async function currentStorage(deps: Deps, gates: GateInputs, now: number) {
  const s = gates.settings;
  const measuredAt = s.storage_measured_at ? Date.parse(s.storage_measured_at) : NaN;
  if (!Number.isNaN(measuredAt) && now - measuredAt < STORAGE_CACHE_MS && s.storage_ok !== null && s.storage_ok !== undefined) {
    return { ok: s.storage_ok, totalBytes: s.storage_total_bytes ?? null, message: s.storage_message };
  }
  const measured = await deps.measureStorage();
  const { error } = await deps.db.from("city_pipeline_settings").update({
    storage_ok: measured.ok,
    storage_total_bytes: measured.totalBytes,
    storage_message: measured.message ?? null,
    storage_measured_at: new Date(now).toISOString(),
  }).eq("id", true);
  if (error) console.error(`[run-city-pipeline] storage cache not saved: ${error.message}`);
  return measured;
}

/** Stops a child that would otherwise keep spending while the run waits. */
export async function pauseChildren(deps: Deps, run: Row, reason: string): Promise<void> {
  const { data: stage } = await deps.db
    .from("city_pipeline_stages").select("cursor").eq("run_id", run.id).eq("stage", "intelligence").maybeSingle();
  const childId = stage?.cursor?.intel_run_id;
  if (!childId) return;
  const paused = await deps.call("run-place-intelligence-trial", {
    action: "pause_run", run_id: childId, admin_id: run.started_by, reason,
  });
  if (paused.status >= 400) {
    throw new Error(`intelligence run ${childId} could not be paused: ${JSON.stringify(paused.body).slice(0, 200)}`);
  }
}

async function pauseRun(deps: Deps, run: Row, reason: string, detail: Record<string, unknown>, status = "paused") {
  const { error } = await deps.db.from("city_pipeline_runs").update({
    status,
    pause_reason: reason,
    pause_detail: detail,
    lease_until: null,
    updated_at: new Date().toISOString(),
  }).eq("id", run.id).eq("status", "running");
  if (error) throw new Error(`run could not be paused: ${error.message}`);
  run.status = status;
}

async function advance(deps: Deps, run: Row, stage: Row, result: unknown): Promise<Row | null> {
  const nowIso = new Date((deps.now ?? Date.now)()).toISOString();
  const { error } = await deps.db.rpc("city_pipeline_stage_finish", {
    p_stage_id: stage.id,
    p_result: result ?? null,
  });
  if (error) throw new Error(`stage could not finish: ${error.message}`);
  const next = STAGE_ORDER[STAGE_ORDER.indexOf(stage.stage) + 1] ?? null;
  const { error: runErr } = await deps.db.from("city_pipeline_runs").update({
    current_stage: next,
    updated_at: nowIso,
  }).eq("id", run.id);
  if (runErr) throw new Error(`run could not advance: ${runErr.message}`);
  run.current_stage = next;
  return next ? { next } : null;
}

async function finishRun(deps: Deps, run: Row): Promise<void> {
  const search = await deps.call("admin-seed-places", { action: "city_search_status", cityId: run.city_id });
  const nowIso = new Date((deps.now ?? Date.now)()).toISOString();
  const { error } = await deps.db.from("city_pipeline_runs").update({
    status: "complete",
    completed_at: nowIso,
    lease_until: null,
    updated_at: nowIso,
    result: {
      search: search.status < 400 ? { checks: search.body.checks, complete: search.body.complete, unresolved: (search.body.unresolved as unknown[] | undefined)?.length ?? 0 } : { error: search.body },
      spend: await rpc(deps.db, "city_pipeline_spend_ledger", { p_city_id: run.city_id, p_run_id: run.id }),
    },
  }).eq("id", run.id);
  if (error) throw new Error(`run could not finish: ${error.message}`);
  run.status = "complete";
}

/** What a tick did, stored on the run so waiting and stuck look different. */
export type TickOutcomeKind = "progress" | "wait" | "budget" | "approval" | "pause" | "error" | "complete";

export interface DriveResult {
  ended: string;
  kind: TickOutcomeKind;
  why: string;
  retryAfterMs: number | null;
}

export async function driveRun(deps: Deps, run: Row, state?: TickState): Promise<DriveResult> {
  const clock = deps.now ?? Date.now;
  const started = clock();
  const budget = deps.budgetMs ?? TICK_BUDGET_MS;
  const tickState = state ?? newTickState(started, budget);
  const ranOut = (): DriveResult => tickState.progressed
    ? { ended: "budget", kind: "progress", why: TICK_BUDGET_USED, retryAfterMs: null }
    : { ended: "budget", kind: "budget", why: TICK_BUDGET_USED, retryAfterMs: null };

  const { data: city, error: cityErr } = await deps.db
    .from("seeding_cities").select("id, name, country").eq("id", run.city_id).single();
  if (cityErr) throw new Error(`city read failed: ${cityErr.message}`);

  while (clock() - started < budget) {
    if (!run.current_stage) {
      await finishRun(deps, run);
      tickState.progressed = true;
      return { ended: "complete", kind: "complete", why: "complete", retryAfterMs: null };
    }

    const { data: stage, error: stageErr } = await deps.db
      .from("city_pipeline_stages").select("*").eq("run_id", run.id).eq("stage", run.current_stage).single();
    if (stageErr) throw new Error(`stage read failed: ${stageErr.message}`);
    if (stage.status === "skipped") {
      // Keeps its skipped status. Only the run moves on.
      const next = STAGE_ORDER[STAGE_ORDER.indexOf(stage.stage) + 1] ?? null;
      const { error: skipErr } = await deps.db.from("city_pipeline_runs")
        .update({ current_stage: next, updated_at: new Date(clock()).toISOString() }).eq("id", run.id);
      if (skipErr) throw new Error(`run could not advance: ${skipErr.message}`);
      run.current_stage = next;
      continue;
    }
    if (stage.status === "pending") {
      const { error: beginErr } = await deps.db.rpc("city_pipeline_stage_begin", { p_stage_id: stage.id });
      if (beginErr) throw new Error(`stage could not begin: ${beginErr.message}`);
      stage.status = "running";
    }

    // A person can pause or cancel between steps.
    const { data: live } = await deps.db
      .from("city_pipeline_runs").select("status, spend_limit_usd, rules_only, rules_only_by").eq("id", run.id).single();
    if (live?.status !== "running") {
      return { ended: `status_${live?.status}`, kind: "pause", why: `run is ${live?.status}`, retryAfterMs: null };
    }
    Object.assign(run, live);

    const gates: GateInputs = await rpc(deps.db, "city_pipeline_gate_inputs");
    const db = databaseGate(gates);
    const storage = await currentStorage(deps, gates, clock());
    const stop: GateTrip | null = db ?? storageGate(storage);
    if (stop) {
      await pauseChildren(deps, run, stop.reason);
      await pauseRun(deps, run, stop.reason, stop.detail);
      return { ended: stop.reason, kind: "pause", why: stop.reason, retryAfterMs: null };
    }

    const ctx: Ctx = { deps, run, stage, city, gates, storage, now: clock(), tick: tickState };
    let outcome: Outcome;
    try {
      outcome = await runStage(ctx);
    } catch (err) {
      if (!(err instanceof TickEnd)) throw err;
      outcome = err.outcome;
    }

    switch (outcome.kind) {
      case "done":
        await advance(deps, run, stage, outcome.result);
        tickState.progressed = true;
        break;
      case "step":
        tickState.progressed = true;
        break;
      case "budget":
        // Out of time is progress when anything moved; out of calls is always budget.
        if (outcome.why === TICK_BUDGET_USED) return ranOut();
        return { ended: "budget", kind: "budget", why: outcome.why, retryAfterMs: null };
      case "wait":
        return { ended: `wait:${outcome.why}`, kind: "wait", why: outcome.why, retryAfterMs: outcome.retryAfterMs ?? null };
      case "approval":
        await saveStage(ctx, {
          approval: {
            status: "requested",
            key: outcome.key,
            reason: outcome.reason,
            numbers: outcome.numbers,
            high_cost: outcome.highCost,
            requested_at: new Date(clock()).toISOString(),
          },
        });
        await pauseRun(deps, run, outcome.reason, { key: outcome.key, numbers: outcome.numbers, stage: stage.stage }, "awaiting_approval");
        return { ended: `approval:${outcome.reason}`, kind: "approval", why: outcome.reason, retryAfterMs: null };
      case "pause":
        await pauseChildren(deps, run, outcome.reason);
        await pauseRun(deps, run, outcome.reason, { stage: stage.stage, ...outcome.detail });
        return { ended: outcome.reason, kind: "pause", why: outcome.reason, retryAfterMs: null };
    }
  }
  return ranOut();
}

/**
 * Only the tick that holds the lease may end it: a tick that outlived its lease can't
 * clear a newer tick's. Runs this tick paused or finished are no longer leased.
 */
// deno-lint-ignore no-explicit-any
function ownedBy(query: any, run: Row, claimedLease: unknown) {
  if (run.status !== "running") return query.eq("status", run.status);
  return claimedLease === null || claimedLease === undefined ? query : query.eq("lease_until", claimedLease);
}

/**
 * A stage that keeps throwing without moving pauses and says why, instead of retrying for
 * ever. A rate limit or a busy city is a wait, not a failure, and a tick that moved
 * the run forward before it threw starts the count again.
 */
export async function tick(deps: Deps): Promise<Record<string, unknown>> {
  const { data: claimed, error: claimErr } = await deps.db.rpc("city_pipeline_claim_tick", { p_lease_seconds: 170 });
  if (claimErr) throw new Error(`city_pipeline_claim_tick: ${claimErr.message}`);
  const run: Row | undefined = claimed?.[0];
  if (!run) return { idle: true };

  const clock = deps.now ?? Date.now;
  const claimedLease = run.lease_until;
  const state = newTickState(clock(), deps.budgetMs ?? TICK_BUDGET_MS);
  const outcomeRow = (kind: TickOutcomeKind, why: string, retryAfterMs: number | null) => ({
    kind,
    why,
    retry_after_ms: retryAfterMs,
    at: new Date(clock()).toISOString(),
    calls: state.calls,
  });

  try {
    const result = await driveRun(deps, run, state);
    const nowIso = new Date(clock()).toISOString();
    const patch: Row = {
      lease_until: null,
      last_outcome: outcomeRow(result.kind, result.why, result.retryAfterMs),
      next_attempt_at: result.kind === "wait" && result.retryAfterMs !== null
        ? new Date(clock() + result.retryAfterMs).toISOString()
        : null,
      updated_at: nowIso,
    };
    // A wait is not a failure and not progress: it leaves the error count alone.
    if (state.progressed || !["wait", "budget"].includes(result.kind)) {
      patch.error_streak = 0;
      patch.last_error = null;
    }
    if (state.progressed) patch.last_progress_at = nowIso;
    const { error } = await ownedBy(deps.db.from("city_pipeline_runs").update(patch).eq("id", run.id), run, claimedLease);
    if (error) console.error(`[run-city-pipeline] run ${run.id} outcome not saved: ${error.message}`);
    return { run_id: run.id, ended: result.ended, stage: run.current_stage, outcome: result.kind };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const nowIso = new Date(clock()).toISOString();
    console.error(`[run-city-pipeline] run ${run.id} stage ${run.current_stage}: ${message}`);
    // The run moved forward this tick, so this is one problem, not a stuck stage.
    const streak = state.progressed ? 0 : Number(run.error_streak ?? 0) + 1;
    const pause = streak >= STAGE_ERROR_LIMIT;
    let update = deps.db.from("city_pipeline_runs").update({
      lease_until: null,
      last_error: message.slice(0, 1000),
      error_streak: streak,
      last_outcome: outcomeRow(pause ? "pause" : "error", pause ? "stage_error" : message.slice(0, 300), null),
      next_attempt_at: null,
      ...(state.progressed ? { last_progress_at: nowIso } : {}),
      ...(pause
        ? { status: "paused", pause_reason: "stage_error", pause_detail: { stage: run.current_stage, error: message.slice(0, 1000) } }
        : {}),
      updated_at: nowIso,
    }).eq("id", run.id).eq("status", "running");
    if (claimedLease !== null && claimedLease !== undefined) update = update.eq("lease_until", claimedLease);
    const { error } = await update;
    if (error) console.error(`[run-city-pipeline] run ${run.id} error not saved: ${error.message}`);
    return { run_id: run.id, error: message, stage: run.current_stage, paused: pause, progressed: state.progressed };
  }
}

// ── What an admin does ──────────────────────────────────────────────────────

export class Refusal extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly detail: Record<string, unknown> = {}) {
    super(message);
  }
}

async function loadRun(db: Db, runId: unknown): Promise<Row> {
  if (typeof runId !== "string") throw new Refusal("bad_request", "runId is required", 400);
  const { data, error } = await db.from("city_pipeline_runs").select("*").eq("id", runId).maybeSingle();
  if (error) throw new Error(`run read failed: ${error.message}`);
  if (!data) throw new Refusal("not_found", "No such run", 404);
  return data;
}

function planOrRefuse(body: Row): Plan | null {
  try {
    return planFromBody(body);
  } catch (err) {
    if (err instanceof PlanError) throw new Refusal("bad_stages", err.message, 400);
    throw err;
  }
}

/**
 * The price of exactly the stages a planned run will do, from the same previews and
 * estimates each stage uses before it spends. Photos and Intelligence are priced on the
 * places waiting now; when an earlier planned stage can add places to them the figure
 * is a floor (atLeast), and each stage still checks its own cost again before it starts.
 */
export async function pricePlan(deps: Deps, cityId: string, adminId: string, scope: string, plan: Plan, gates: GateInputs) {
  const { data: city, error } = await deps.db.from("seeding_cities").select("id, name, country").eq("id", cityId).single();
  if (error) throw new Error(`city read failed: ${error.message}`);
  const lines: Row[] = [];
  let atLeast = false;
  let serperRequests = 0;
  for (const stage of plan.stages) {
    switch (stage) {
      case "box":
        lines.push({ stage, usd: COST_PER_GEOCODE, basis: "one geocode" });
        break;
      case "fill": {
        const fill = must(await deps.call("admin-seed-places", { action: "preview_fill", cityId }), "preview_fill");
        lines.push({ stage, usd: Number(fill.estimatedCostUsd ?? 0), searches: fill.searches });
        break;
      }
      case "split": {
        const split = must(await deps.call("admin-seed-places", { action: "preview_split_level", cityId }), "preview_split_level");
        lines.push({ stage, usd: Number(split.estimatedCostUsd ?? 0), searches: split.searches, atLeast: split.costIsFloor === true });
        if (split.costIsFloor === true) atLeast = true;
        break;
      }
      case "completeness":
        lines.push({ stage, usd: COMPLETENESS_SEARCHES * COST_PER_NEARBY_SEARCH, searches: COMPLETENESS_SEARCHES });
        break;
      case "photos": {
        const photo = must(await deps.call("backfill-place-photos", {
          action: "preview_run", cityId, city: city.name, country: city.country, mode: "pre_photo_passed",
        }), "preview_run");
        const more = plan.stages.includes("pre_check");
        if (more) atLeast = true;
        lines.push({
          stage,
          usd: photo.status === "nothing_to_do" ? 0 : Number(photo.estimatedCostUsd ?? 0),
          places: photo.status === "nothing_to_do" ? 0 : photo.totalPlaces ?? null,
          atLeast: more,
        });
        break;
      }
      case "intelligence": {
        const est = await deps.call("run-place-intelligence-trial", {
          ...intelligenceArgs(cityId, adminId, scope, { planned: true, redo: plan.redo }),
          estimate_only: true,
        });
        let places = 0;
        let usd = 0;
        if (!(est.status === 400 && ["no_remainder", "No servable places in city"].includes(String(est.body.error)))) {
          const body = must(est, "start_run estimate");
          places = Number(body.totalPlaces ?? 0);
          usd = Number(body.estimatedCostUsd ?? 0);
        }
        const more = plan.stages.includes("final_check");
        if (more) atLeast = true;
        serperRequests += places * REVIEW_MAX_PAGES;
        lines.push({ stage, usd, places, serperRequests: places * REVIEW_MAX_PAGES, redo: plan.redo, atLeast: more });
        break;
      }
      default:
        lines.push({ stage, usd: 0 });
    }
  }
  const knownUsd = Math.round(lines.reduce((a, l) => a + Number(l.usd ?? 0), 0) * 100) / 100;
  const rate = gates.settings.serper_usd_per_request;
  const serperUsd = rate === null || rate === undefined ? null : Math.round(serperRequests * Number(rate) * 100) / 100;
  return {
    stages: plan.stages,
    redo: plan.redo,
    lines,
    knownUsd,
    serperRequests,
    serperUsd,
    totalUsd: serperUsd === null ? (serperRequests > 0 ? null : knownUsd) : Math.round((knownUsd + serperUsd) * 100) / 100,
    atLeast,
  };
}

/** What a run would do and what stands in its way, before any money moves. */
export async function preview(deps: Deps, body: Row, adminId = "") {
  const cityId = body.cityId;
  if (typeof cityId !== "string") throw new Refusal("bad_request", "cityId is required", 400);
  const planned = planOrRefuse(body);
  const now = (deps.now ?? Date.now)();
  const gates: GateInputs = await rpc(deps.db, "city_pipeline_gate_inputs");
  const fill = must(await deps.call("admin-seed-places", { action: "preview_fill", cityId }), "preview_fill");
  const split = must(await deps.call("admin-seed-places", { action: "preview_split_level", cityId }), "preview_split_level");
  const unhealthy = {
    search: unhealthyProviders(gates, ["google_places"], now),
    intelligence: unhealthyProviders(gates, ["serper", "gemini"], now),
  };
  return {
    cityId,
    stages: {
      fill: { searches: fill.searches, estimatedCostUsd: fill.estimatedCostUsd, exceedsHighCost: fill.exceedsHighCost },
      split: { nextLevel: split.nextLevel, searches: split.searches, estimatedCostUsd: split.estimatedCostUsd, costIsFloor: split.costIsFloor, needsApproval: true },
      completeness: { searches: COMPLETENESS_SEARCHES, estimatedCostUsd: COMPLETENESS_SEARCHES * COST_PER_NEARBY_SEARCH },
      // Known only once the searches have run; each is shown again before it starts.
      photos: { estimatedCostUsd: null, basis: "after searches" },
      intelligence: { estimatedCostUsd: null, basis: "after the final check" },
    },
    providers: gates.providers,
    unhealthy,
    serperUsdPerRequest: gates.settings.serper_usd_per_request,
    blockers: await rpc(deps.db, "city_pipeline_blockers", { p_city_id: cityId }),
    placeCounts: await rpc(deps.db, "city_pipeline_place_counts", { p_city_id: cityId }),
    highCostUsd: HIGH_COST_USD,
    plan: planned ? await pricePlan(deps, cityId, adminId, String(body.scope ?? "new_only"), planned, gates) : null,
  };
}

export async function start(deps: Deps, body: Row, adminId: string) {
  const limit = Number(body.spendLimitUsd);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Refusal("bad_request", "spendLimitUsd must be above zero: a run always has a limit", 400);
  }
  if (typeof body.cityId !== "string") throw new Refusal("bad_request", "cityId is required", 400);
  const scope = body.scope ?? "new_only";
  if (scope !== "new_only" && scope !== "whole_city") {
    throw new Refusal("bad_request", "scope must be new_only or whole_city", 400);
  }
  if (scope === "whole_city" && body.confirmWholeCity !== true) {
    throw new Refusal("confirmation_required", "Re-checking a whole city needs confirmWholeCity:true.", 400);
  }
  // With a stage list the run does only those stages and what each needs first. Without
  // one it does every stage, exactly as before.
  const plan = planOrRefuse(body);
  if (plan?.redo && body.confirmRedo !== true) {
    throw new Refusal("confirmation_required", "Redoing Intelligence changes live decks: it needs confirmRedo:true.", 400);
  }
  const { data, error } = plan
    ? await deps.db.rpc("city_pipeline_start_plan", {
      p_city_id: body.cityId,
      p_started_by: adminId,
      p_scope: scope,
      p_spend_limit_usd: limit,
      p_stages: plan.stages,
      p_redo_intelligence: plan.redo,
      p_rules_only: body.rulesOnly === true,
    })
    : await deps.db.rpc("city_pipeline_start", {
    p_city_id: body.cityId,
    p_started_by: adminId,
    p_scope: scope,
    p_spend_limit_usd: limit,
    p_skip_search: body.skipSearch === true,
    p_rules_only: body.rulesOnly === true,
  });
  if (error) {
    if (error.code === "PT409") throw new Refusal("active_run", error.message, 409);
    if (error.code === "22023") throw new Refusal("bad_stages", error.message, 400);
    throw new Error(error.message);
  }
  return { runId: data, stages: plan?.stages ?? null, redo: plan?.redo ?? false };
}

export async function status(deps: Deps, body: Row) {
  const run = await loadRun(deps.db, body.runId);
  const { data: stages, error } = await deps.db
    .from("city_pipeline_stages").select("*").eq("run_id", run.id).order("ord");
  if (error) throw new Error(`stages read failed: ${error.message}`);
  const now = (deps.now ?? Date.now)();
  const gates: GateInputs = await rpc(deps.db, "city_pipeline_gate_inputs");
  return {
    run,
    stages,
    spend: await rpc(deps.db, "city_pipeline_spend_ledger", { p_city_id: run.city_id, p_run_id: run.id }),
    placeCounts: await rpc(deps.db, "city_pipeline_place_counts", { p_city_id: run.city_id }),
    blockers: await rpc(deps.db, "city_pipeline_blockers", { p_city_id: run.city_id }),
    gates: {
      db_bytes: gates.db_bytes,
      db_pause_bytes: gates.settings.db_pause_bytes,
      storage_total_bytes: gates.settings.storage_total_bytes,
      storage_ok: gates.settings.storage_ok,
      storage_measured_at: gates.settings.storage_measured_at,
      unhealthy: unhealthyProviders(gates, ["google_places", "gemini", "serper"], now),
    },
  };
}

/** The key says what the person saw. A plan that has moved on asks again with new numbers. */
export async function approve(deps: Deps, body: Row, adminId: string) {
  const run = await loadRun(deps.db, body.runId);
  if (run.status !== "awaiting_approval") {
    throw new Refusal("not_waiting", `Run is ${run.status}, not waiting for approval`, 409);
  }
  const { data: stage, error } = await deps.db
    .from("city_pipeline_stages").select("*").eq("run_id", run.id).eq("stage", run.current_stage).single();
  if (error) throw new Error(`stage read failed: ${error.message}`);
  const asked = stage.approval;
  if (!asked || asked.status !== "requested" || asked.key !== body.key) {
    throw new Refusal("plan_changed", "This approval doesn't match what is waiting. Read the run again.", 409, { key: asked?.key ?? null });
  }
  if (asked.high_cost === true && body.confirmHighCost !== true) {
    throw new Refusal("high_cost_confirmation_required", "This stage is above its high-cost limit: pass confirmHighCost:true.", 400, { numbers: asked.numbers });
  }
  const { error: stageErr } = await deps.db.from("city_pipeline_stages").update({
    approval: {
      ...asked,
      status: "approved",
      confirm_high_cost: asked.high_cost === true,
      approved_by: adminId,
      approved_at: new Date((deps.now ?? Date.now)()).toISOString(),
    },
  }).eq("id", stage.id);
  if (stageErr) throw new Error(`approval not saved: ${stageErr.message}`);
  return await requeue(deps, run, "awaiting_approval");
}

async function requeue(deps: Deps, run: Row, from: string) {
  const { data, error } = await deps.db.from("city_pipeline_runs").update({
    status: "queued",
    pause_reason: null,
    pause_detail: null,
    error_streak: 0,
    next_attempt_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", run.id).eq("status", from).select("id, status").maybeSingle();
  if (error) throw new Error(`run not requeued: ${error.message}`);
  if (!data) throw new Refusal("not_waiting", "The run changed; read it again.", 409);
  return { runId: run.id, status: "queued" };
}

export async function pause(deps: Deps, body: Row) {
  const run = await loadRun(deps.db, body.runId);
  if (run.status !== "running" && run.status !== "queued") {
    throw new Refusal("not_running", `Run is ${run.status}`, 409);
  }
  await pauseChildren(deps, run, "paused_by_admin");
  const { error } = await deps.db.from("city_pipeline_runs").update({
    status: "paused",
    pause_reason: "paused_by_admin",
    pause_detail: {},
    updated_at: new Date().toISOString(),
  }).eq("id", run.id).in("status", ["running", "queued"]);
  if (error) throw new Error(`run not paused: ${error.message}`);
  return { runId: run.id, status: "paused" };
}

/** The current child's failed and finished counts, which a resume makes the new zero. */
async function currentFailureBase(deps: Deps, stage: Row): Promise<Row | null> {
  const cursor = stage.cursor ?? {};
  const read = async (table: string, id: string) => {
    const { data, error } = await deps.db.from(table).select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    return data as Row | null;
  };
  if ((stage.stage === "fill" || stage.stage === "split") && cursor.seeding_run_id) {
    const child = await read("seeding_runs", cursor.seeding_run_id);
    if (!child) return null;
    const failed = Number(child.failed_batches ?? 0);
    return { child: cursor.seeding_run_id, failed, finished: Number(child.completed_batches ?? 0) + failed };
  }
  if (stage.stage === "photos" && cursor.photo_run_id) {
    const child = await read("photo_backfill_runs", cursor.photo_run_id);
    if (!child) return null;
    const failed = Number(child.failed_batches ?? 0);
    return { child: cursor.photo_run_id, failed, finished: Number(child.completed_batches ?? 0) + failed };
  }
  if (stage.stage === "intelligence" && cursor.intel_run_id) {
    const child = await read("place_intelligence_runs", cursor.intel_run_id);
    if (!child) return null;
    return { child: cursor.intel_run_id, failed: Number(child.failed_count ?? 0), finished: Number(child.processed_count ?? 0) };
  }
  return null;
}

/** Gates are read again on the next tick, so a resume can't step over one. */
export async function resume(deps: Deps, body: Row) {
  const run = await loadRun(deps.db, body.runId);
  if (run.status !== "paused") throw new Refusal("not_paused", `Run is ${run.status}`, 409);

  if (body.spendLimitUsd !== undefined) {
    const limit = Number(body.spendLimitUsd);
    if (!Number.isFinite(limit) || limit <= 0) throw new Refusal("bad_request", "spendLimitUsd must be above zero", 400);
    const { error } = await deps.db.from("city_pipeline_runs").update({ spend_limit_usd: limit }).eq("id", run.id);
    if (error) throw new Error(`limit not saved: ${error.message}`);
  }

  const { data: stage, error: stageErr } = await deps.db
    .from("city_pipeline_stages").select("*").eq("run_id", run.id).eq("stage", run.current_stage).maybeSingle();
  if (stageErr) throw new Error(`stage read failed: ${stageErr.message}`);

  if (stage) {
    const patch: Row = {};
    // A person asking to go again is what lets a failed round or retry run once more.
    if (["search_failures", "intelligence_failures"].includes(run.pause_reason)) patch.retry_requested = true;
    // The failure gate counts only what happens after this resume, so a failure_rate
    // pause doesn't come straight back on the child's old totals.
    const base = await currentFailureBase(deps, stage);
    if (base) patch.failure_base = base;
    if (["intelligence_busy"].includes(run.pause_reason)) patch.busy_since = null;
    if (Object.keys(patch).length > 0) {
      const { error } = await deps.db.from("city_pipeline_stages")
        .update({ cursor: { ...stage.cursor, ...patch } }).eq("id", stage.id);
      if (error) throw new Error(`retry not saved: ${error.message}`);
    }
    const childId = stage.cursor?.intel_run_id;
    if (stage.stage === "intelligence" && childId) {
      const { data: child, error: childErr } = await deps.db
        .from("place_intelligence_runs").select("status").eq("id", childId).single();
      if (childErr) throw new Error(`intelligence run read failed: ${childErr.message}`);
      if (child.status === "paused") {
        const resumed = await deps.call("run-place-intelligence-trial", {
          action: "resume_run", run_id: childId, admin_id: run.started_by,
        });
        if (resumed.status === 409) {
          throw new Refusal("city_busy", "Another Intelligence run holds this city. It can resume when that finishes.", 409);
        }
        must(resumed, "resume_run");
      }
    }
  }
  return await requeue(deps, run, "paused");
}

export async function cancel(deps: Deps, body: Row) {
  const run = await loadRun(deps.db, body.runId);
  if (["complete", "failed", "cancelled"].includes(run.status)) {
    throw new Refusal("finished", `Run is ${run.status}`, 409);
  }
  const { data: stages, error } = await deps.db
    .from("city_pipeline_stages").select("stage, cursor").eq("run_id", run.id);
  if (error) throw new Error(`stages read failed: ${error.message}`);
  for (const s of stages ?? []) {
    if (s.cursor?.seeding_run_id) {
      must(await deps.call("admin-seed-places", { action: "cancel_run", runId: s.cursor.seeding_run_id }), "cancel_run");
    }
    if (s.stage === "photos" && s.cursor?.photo_run_id) {
      const c = await deps.call("backfill-place-photos", { action: "cancel_run", runId: s.cursor.photo_run_id });
      if (c.status >= 500) must(c, "cancel photos");
    }
    if (s.stage === "intelligence" && s.cursor?.intel_run_id) {
      const c = await deps.call("run-place-intelligence-trial", {
        action: "cancel_trial", run_id: s.cursor.intel_run_id, admin_id: run.started_by,
      });
      if (c.status >= 500) must(c, "cancel intelligence");
    }
  }
  const nowIso = new Date((deps.now ?? Date.now)()).toISOString();
  const { error: runErr } = await deps.db.from("city_pipeline_runs").update({
    status: "cancelled",
    completed_at: nowIso,
    lease_until: null,
    updated_at: nowIso,
  }).eq("id", run.id);
  if (runErr) throw new Error(`run not cancelled: ${runErr.message}`);
  // Held places stay hidden. That is the safe side, and the counts say so.
  return {
    runId: run.id,
    status: "cancelled",
    stillHeld: await rpc(deps.db, "city_pipeline_place_counts", { p_city_id: run.city_id }),
  };
}

/** C7's explicit choice: places go live on rules alone, because a person said so. */
export async function chooseRulesOnly(deps: Deps, body: Row, adminId: string) {
  const run = await loadRun(deps.db, body.runId);
  if (run.status !== "paused" && run.status !== "awaiting_approval") {
    throw new Refusal("not_paused", `Run is ${run.status}`, 409);
  }
  if (body.confirmRulesOnly !== true) {
    throw new Refusal("confirmation_required", "Rules only needs confirmRulesOnly:true.", 400);
  }
  const { error } = await deps.db.from("city_pipeline_runs").update({
    rules_only: true,
    rules_only_by: adminId,
  }).eq("id", run.id);
  if (error) throw new Error(`choice not saved: ${error.message}`);
  // Held places still need a rules score, so a later stage goes back to scoring.
  if (run.current_stage === "release" || run.current_stage === "intelligence") {
    const { error: stageErr } = await deps.db.from("city_pipeline_stages")
      .update({ status: "pending", cursor: {}, completed_at: null, result: null })
      .eq("run_id", run.id).eq("stage", "score");
    if (stageErr) throw new Error(`score stage not reset: ${stageErr.message}`);
    const { error: runErr } = await deps.db.from("city_pipeline_runs")
      .update({ current_stage: "score" }).eq("id", run.id);
    if (runErr) throw new Error(`run not moved: ${runErr.message}`);
  }
  return await requeue(deps, run, run.status);
}

export async function setSettings(deps: Deps, body: Row, adminId: string) {
  const patch: Row = { updated_at: new Date().toISOString(), updated_by: adminId };
  if (body.serperUsdPerRequest !== undefined) {
    const rate = body.serperUsdPerRequest;
    if (rate !== null && (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0)) {
      throw new Refusal("bad_request", "serperUsdPerRequest must be a number or null", 400);
    }
    patch.serper_usd_per_request = rate;
  }
  const { data, error } = await deps.db.from("city_pipeline_settings").update(patch).eq("id", true).select("*").single();
  if (error) throw new Error(`settings not saved: ${error.message}`);
  return data;
}
