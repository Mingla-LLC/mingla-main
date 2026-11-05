// Issue #4276 T1, T3 to T9, B1 at the action level, with Google mocked. Real queries
// and constraints are proved by issue_4276_tile_completeness.implementor.pg17.test.sql.
//
// MINGLA-INVARIANT: I-4276-EVERY-CONFIG-SEARCHED | issue #4276 | A batch searches the config it records, so a category with several configs searches each of them
// MINGLA-INVARIANT: I-4276-NOTHING-PAID-WITHOUT-CONFIRM | issue #4276 | Fill, split and the completeness check spend nothing unless a person confirms
//
// FAILS-ON-REVERT: make resolveBatchConfig ignore search_config_id and the
// picnic_park test sends nature_views' types. Drop `search_config_id: config.id` from
// create_run and the every-config test fails. Remove requireConfirmation or the
// confirm check in runCompletenessCheck and the paid tests see a search or a run.

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SEEDING_CATEGORIES, SEEDING_CATEGORY_MAP } from "../../_shared/seedingCategories.ts";
import { COST_PER_NEARBY_SEARCH, SEARCH_RESULT_CAP } from "../../_shared/seedingGeometry.ts";
import { applyPostFetchFilters, dispatchAction, resolveBatchConfig } from "../index.ts";
import {
  applyCityBox,
  type CappedSearch,
  COMPLETENESS_RADIUS_M,
  COMPLETENESS_SEARCH_COUNT,
  type GeocodeResult,
  generateTilesForCity,
  PipelineRefusal,
  planSplitLevel,
  previewFill,
  previewSplitLevel,
  runCompletenessCheck,
  SAMPLE_TILE_LIMIT,
  startFill,
  startSplitLevel,
  summariseCompleteness,
} from "../searchPipeline.ts";

type Row = Record<string, unknown>;
const CITY = "42763000-0000-4000-a000-000000000001";
const cityRow = {
  id: CITY, name: "Testville", country: "Testland", country_code: "TL", tile_radius_m: 2000,
  bbox_sw_lat: 10, bbox_sw_lng: 10, bbox_ne_lat: 10.05, bbox_ne_lng: 10.05,
};

interface World {
  tables: Record<string, Row[]>;
  rpcs: Record<string, (args: Row) => unknown>;
  rpcCalls: Array<{ fn: string; args: Row }>;
}

function world(over: Partial<World> = {}): World {
  return {
    tables: { seeding_cities: [{ ...cityRow }], seeding_runs: [], seeding_batches: [], seeding_tiles: [], place_pool: [], place_pool_admin_edits: [], seeding_filtered_results: [], seeding_completeness_checks: [], ...(over.tables ?? {}) },
    rpcs: over.rpcs ?? {},
    rpcCalls: [],
  };
}

const quietStatus = { tiles: {}, unfinished: { total: 0 }, levels: [], capped_open: 0, unresolved: [], active_run: null };

// deno-lint-ignore no-explicit-any
function fakeDb(w: World): any {
  // deno-lint-ignore no-explicit-any
  const from = (table: string): any => {
    w.tables[table] ??= [];
    const filters: Array<(r: Row) => boolean> = [];
    let op = "select";
    let payload: Row | Row[] | null = null;
    let conflict: string[] = [];
    let ignoreDup = false;
    let limit = Infinity;
    let head = false;
    const run = () => {
      if (op === "insert" || op === "upsert") {
        const rows = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const written: Row[] = [];
        for (const row of rows) {
          const hit = conflict.length ? w.tables[table].find((e) => conflict.every((k) => e[k] === row[k])) : undefined;
          if (hit && ignoreDup) continue;
          if (hit) { Object.assign(hit, row); written.push(hit); continue; }
          const full = { id: crypto.randomUUID(), ...row };
          w.tables[table].push(full);
          written.push(full);
        }
        return { data: written, error: null, count: written.length };
      }
      const hits = w.tables[table].filter((r) => filters.every((f) => f(r)));
      if (op === "update") { hits.forEach((r) => Object.assign(r, payload)); return { data: hits, error: null, count: hits.length }; }
      const out = limit === Infinity ? hits : hits.slice(0, limit);
      return { data: head ? null : out, error: null, count: hits.length };
    };
    // deno-lint-ignore no-explicit-any
    const chain: any = {
      select: (_c?: string, o?: { head?: boolean }) => { head = o?.head === true; return chain; },
      insert: (p: Row | Row[]) => { op = "insert"; payload = p; return chain; },
      upsert: (p: Row | Row[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        op = "upsert"; payload = p; conflict = (o?.onConflict ?? "").split(",").filter(Boolean); ignoreDup = !!o?.ignoreDuplicates; return chain;
      },
      update: (p: Row) => { op = "update"; payload = p; return chain; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return chain; },
      gt: () => chain,
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return chain; },
      is: (c: string, _v: null) => { filters.push((r) => r[c] == null); return chain; },
      order: (c: string) => { const o = run; void o; void c; return chain; },
      limit: (n: number) => { limit = n; return chain; },
      single: () => {
        const r = run();
        const row = (r.data as Row[] | null)?.[0] ?? null;
        return Promise.resolve({ ...r, data: row, error: row ? null : { message: "not found" } });
      },
      maybeSingle: () => { const r = run(); return Promise.resolve({ ...r, data: (r.data as Row[])?.[0] ?? null }); },
      // deno-lint-ignore no-explicit-any
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return chain;
  };
  return {
    from,
    rpc: (fn: string, args: Row) => {
      w.rpcCalls.push({ fn, args });
      const impl = w.rpcs[fn];
      if (!impl) throw new Error(`unscripted rpc ${fn}`);
      try {
        return Promise.resolve({ data: impl(args), error: null });
      } catch (e) {
        const err = e as Error & { code?: string };
        return Promise.resolve({ data: null, error: { message: err.message, code: err.code } });
      }
    },
  };
}

function stubGoogle(respond: (body: Row, n: number) => Response) {
  const real = globalThis.fetch;
  const bodies: Row[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("places.googleapis.com")) throw new Error(`unexpected network call: ${url}`);
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    return Promise.resolve(respond(body, bodies.length));
  }) as typeof fetch;
  return { bodies, restore: () => { globalThis.fetch = real; } };
}

const opts = { sanitizeOps: false, sanitizeResources: false };

// ── The repeated-search bug ─────────────────────────────────────────────────

Deno.test("create_run records every config, on active base tiles only, with its circle", async () => {
  const w = world({
    tables: {
      seeding_tiles: [
        { id: "t1", city_id: CITY, tile_index: 0, center_lat: 10, center_lng: 10, radius_m: 2000, row_idx: 0, col_idx: 0, kind: "grid", retired_at: null },
        { id: "gone", city_id: CITY, tile_index: 1, center_lat: 9, center_lng: 9, radius_m: 2000, row_idx: 1, col_idx: 0, kind: "grid", retired_at: "2026-11-01" },
        { id: "child", city_id: CITY, tile_index: 2, center_lat: 9, center_lng: 9, radius_m: 1000, row_idx: 0, col_idx: 0, kind: "split", retired_at: null },
      ],
    } as Record<string, Row[]>,
  });
  const res = await dispatchAction({ action: "create_run", cityId: CITY }, fakeDb(w));
  const body = await res.json();
  assertEquals(res.status, 200, JSON.stringify(body));
  assertEquals(body.totalBatches, SEEDING_CATEGORIES.length);
  const batches = w.tables.seeding_batches;
  assertEquals(new Set(batches.map((b) => b.tile_id)), new Set(["t1"]));
  assertEquals(
    batches.map((b) => b.search_config_id).sort(),
    SEEDING_CATEGORIES.map((c) => c.id).sort(),
    "each batch must name a different config",
  );
  for (const id of ["casual_eats_world", "casual_eats_extended", "picnic_park", "live_performance"]) {
    assert(batches.some((b) => b.search_config_id === id), `${id} would never be searched`);
  }
  for (const b of batches) {
    assertEquals([b.center_lat, b.center_lng, b.radius_m], [10, 10, 2000]);
  }
});

Deno.test("T6: a thin-category run writes the same search log, with each of its configs", async () => {
  const w = world({
    tables: {
      seeding_tiles: [
        { id: "t1", city_id: CITY, tile_index: 0, center_lat: 10, center_lng: 10, radius_m: 2000, row_idx: 0, col_idx: 0, kind: "grid", retired_at: null },
      ],
    } as Record<string, Row[]>,
  });
  const res = await dispatchAction({ action: "create_run", cityId: CITY, categories: ["brunch_lunch_casual"] }, fakeDb(w));
  assertEquals(res.status, 200);
  assertEquals(w.tables.seeding_batches.map((b) => b.search_config_id), ["casual_eats", "casual_eats_world", "casual_eats_extended"]);
});

Deno.test("the cost preview still prices active base tiles only, and flags high cost", async () => {
  const tile = (id: string, over: Row) => ({ id, city_id: CITY, kind: "grid", retired_at: null, ...over });
  const w = world({
    tables: {
      seeding_tiles: [tile("a", {}), tile("b", { kind: "fill" }), tile("c", { kind: "split" }), tile("d", { retired_at: "2026-11-01" })],
    } as Record<string, Row[]>,
  });
  const body = await (await dispatchAction({ action: "preview_cost", cityId: CITY }, fakeDb(w))).json();
  assertEquals(body.tileCount, 2);
  assertEquals(body.exceedsHardCap, false);
  assertEquals(body.hardCapUsd, 500);
});

function batchRow(over: Row): Row {
  return {
    id: crypto.randomUUID(), run_id: "r1", city_id: CITY, tile_id: "t1", tile_index: 0, batch_index: 0,
    status: "pending", seeding_category: "nature", app_category: "Nature", center_lat: 10, center_lng: 10.5,
    radius_m: 750, search_config_id: "picnic_park", retry_count: 0, ...over,
  };
}

const runRow = {
  id: "r1", city_id: CITY, status: "ready", total_api_calls: 0, total_places_new: 0, total_places_duped: 0,
  total_cost_usd: 0, completed_batches: 0, failed_batches: 0, skipped_batches: 0, total_batches: 1,
};

Deno.test({ name: "run_next_batch searches the config the batch records, not the category's first", ...opts, fn: async () => {
  const w = world({ tables: { seeding_runs: [{ ...runRow }], seeding_batches: [batchRow({})] } as Record<string, Row[]> });
  const g = stubGoogle(() => Response.json({ places: [] }));
  try {
    const res = await dispatchAction({ action: "run_next_batch", runId: "r1" }, fakeDb(w));
    assertEquals(res.status, 200);
    assertEquals(g.bodies.length, 1);
    const sent = g.bodies[0] as { includedTypes: string[]; locationRestriction: { circle: Row } };
    assertEquals(sent.includedTypes, SEEDING_CATEGORY_MAP.picnic_park.includedTypes);
    assert(
      JSON.stringify(sent.includedTypes) !== JSON.stringify(SEEDING_CATEGORY_MAP.nature_views.includedTypes),
      "the two nature configs must differ for this test to mean anything",
    );
    // It also searches the batch's own circle.
    assertEquals(sent.locationRestriction.circle, { center: { latitude: 10, longitude: 10.5 }, radius: 750 });
  } finally { g.restore(); }
}});

Deno.test({ name: "retry_batch shares it, and a split search sends only its own types", ...opts, fn: async () => {
  const failed = batchRow({ status: "failed", search_config_id: "live_performance", seeding_category: "movies_theatre", included_types_override: ["concert_hall", "opera_house"] });
  const w = world({ tables: { seeding_runs: [{ ...runRow, status: "paused", failed_batches: 1 }], seeding_batches: [failed] } as Record<string, Row[]> });
  const g = stubGoogle(() => Response.json({ places: [] }));
  try {
    const res = await dispatchAction({ action: "retry_batch", runId: "r1", batchId: failed.id }, fakeDb(w));
    assertEquals(res.status, 200);
    assertEquals((g.bodies[0] as { includedTypes: string[] }).includedTypes, ["concert_hall", "opera_house"]);
    assertEquals((g.bodies[0] as { excludedPrimaryTypes: string[] }).excludedPrimaryTypes, SEEDING_CATEGORY_MAP.live_performance.excludedPrimaryTypes);
  } finally { g.restore(); }
}});

Deno.test("a recorded config that no longer exists fails, instead of searching something else", () => {
  assertEquals(resolveBatchConfig({ search_config_id: "retired_config", seeding_category: "nature" }), undefined);
  assertEquals(resolveBatchConfig({ search_config_id: null, seeding_category: "picnic_park" })?.id, "picnic_park");
});

// ── T7 ──────────────────────────────────────────────────────────────────────

Deno.test({ name: "T7: what the filters drop is kept per city, and the search still succeeds", ...opts, fn: async () => {
  const w = world({ tables: { seeding_runs: [{ ...runRow }], seeding_batches: [batchRow({})] } as Record<string, Row[]> });
  const g = stubGoogle(() => Response.json({
    places: [
      { id: "no-pic", displayName: { text: "No Pic" }, primaryType: "park", photos: [] },
      { id: "shut", displayName: { text: "Shut" }, primaryType: "bar", businessStatus: "CLOSED_PERMANENTLY", photos: [{ name: "p" }] },
    ],
  }));
  try {
    const res = await dispatchAction({ action: "run_next_batch", runId: "r1" }, fakeDb(w));
    const body = await res.json();
    assertEquals(body.status, "completed");
    assertEquals(body.result.rejectedNoPhotos, 1);
    assertEquals(body.result.rejectedClosed, 1);
    const kept = w.tables.seeding_filtered_results;
    assertEquals(kept.map((r) => [r.city_id, r.google_place_id, r.reason, r.name, r.primary_type]).sort(), [
      [CITY, "no-pic", "no_photos", "No Pic", "park"],
      [CITY, "shut", "closed_permanently", "Shut", "bar"],
    ]);
  } finally { g.restore(); }
}});

Deno.test("filters still keep what they kept", () => {
  const r = applyPostFetchFilters([{ id: "a", photos: [{}] }, { id: "b" }], "x");
  assertEquals(r.passed.map((p) => p.id), ["a"]);
  assertEquals(r.rejectedNoPhotos, 1);
});

// ── T4, T5 ──────────────────────────────────────────────────────────────────

function capped(over: Partial<CappedSearch>): CappedSearch {
  return {
    batch_id: crypto.randomUUID(), tile_id: "t1", tile_index: 0, center_lat: 10, center_lng: 10, radius_m: 2000,
    row_idx: 0, col_idx: 0, level: 0, seeding_category: "nature", search_config_id: "nature_views",
    config_attribution: "recorded", included_types_override: null, ...over,
  };
}

let n = 0;
const ids = () => `new-${++n}`;

Deno.test("T4: only the capped search repeats, as 4 searches on 4 child tiles", () => {
  const plan = planSplitLevel([capped({})], [], null, ids)!;
  assertEquals(plan.level, 1);
  assertEquals(plan.tiles.length, 4);
  assertEquals(plan.batches.length, 4);
  assertEquals(new Set(plan.batches.map((b) => b.search_config_id)), new Set(["nature_views"]));
  assertEquals(plan.costIsFloor, false);
  for (const t of plan.tiles) {
    assertEquals(t.kind, "split");
    assertEquals(t.parent_tile_id, "t1");
    assertEquals(t.level, 1);
    assertEquals(t.radius_m, 1000);
  }
});

Deno.test("T4: a second capped config on the same tile reuses its children", () => {
  const plan = planSplitLevel([capped({}), capped({ search_config_id: "picnic_park" })], [], null, ids)!;
  assertEquals(plan.tiles.length, 4);
  assertEquals(plan.batches.length, 8);
  // So does a later plan, from what's already in the table.
  const existing = plan.tiles.map((t) => ({ id: t.id as string, parent_tile_id: "t1", row_idx: t.row_idx as number, col_idx: t.col_idx as number }));
  const later = planSplitLevel([capped({ search_config_id: "drink" })], existing, null, ids)!;
  assertEquals(later.tiles.length, 0);
  assertEquals(new Set(later.batches.map((b) => b.tile_id)), new Set(existing.map((e) => e.id)));
});

Deno.test("T4: repeats of the same search are split once, and all marked", () => {
  const a = capped({});
  const b = capped({});
  const plan = planSplitLevel([a, b], [], null, ids)!;
  assertEquals(plan.batches.length, 4);
  assertEquals(plan.splitBatchIds.sort(), [a.batch_id, b.batch_id].sort());
});

Deno.test("T5: the shallowest level goes first, so one level finishes before the next", () => {
  const plan = planSplitLevel([capped({ level: 2, radius_m: 500, tile_id: "deep" }), capped({ level: 1, radius_m: 1000, tile_id: "mid" })], [], null, ids)!;
  assertEquals(plan.level, 2);
  assertEquals(plan.parentTiles, 1);
  assert(plan.tiles.every((t) => t.parent_tile_id === "mid"));
});

Deno.test("T5: at the minimum radius it splits by type, in two, with no new tile", () => {
  const types = SEEDING_CATEGORY_MAP.nature_views.includedTypes;
  const plan = planSplitLevel([capped({ radius_m: 150, level: 4 })], [], null, ids)!;
  assertEquals(plan.tiles, []);
  assertEquals(plan.batches.length, 2);
  assertEquals(plan.batches.flatMap((b) => b.included_types_override!).sort(), [...types].sort());
  assert(plan.batches.every((b) => b.tile_id === "t1" && b.level === 5));
});

Deno.test("T5: one type still capped at the minimum is logged as unresolved, and costs nothing", () => {
  const s = capped({ radius_m: 150, level: 9, included_types_override: ["park"] });
  const plan = planSplitLevel([s], [], null, ids)!;
  assertEquals(plan.batches, []);
  assertEquals(plan.unresolvedBatchIds, [s.batch_id]);
  assertEquals(plan.splitBatchIds, []);
});

Deno.test("T5: a run's first level samples the tiles with the most capped searches", () => {
  const rows: CappedSearch[] = [];
  for (let t = 0; t < 30; t++) {
    rows.push(capped({ tile_id: `t${t}`, tile_index: t }));
    if (t >= 25) rows.push(capped({ tile_id: `t${t}`, tile_index: t, search_config_id: "picnic_park" }));
  }
  const plan = planSplitLevel(rows, [], SAMPLE_TILE_LIMIT, ids)!;
  assertEquals(plan.parentTiles, 10);
  assertEquals(plan.cappedAtThisLevel, 35);
  const parents = new Set(plan.tiles.map((t) => t.parent_tile_id));
  for (const t of ["t25", "t26", "t27", "t28", "t29", "t0", "t1", "t2", "t3", "t4"]) assert(parents.has(t), t);
});

Deno.test("old records: an unnamed config repeats every config in the category, and cost is a floor", () => {
  const plan = planSplitLevel([capped({ search_config_id: null, config_attribution: "unknown", seeding_category: "brunch_lunch_casual" })], [], null, ids)!;
  assertEquals(new Set(plan.batches.map((b) => b.search_config_id)), new Set(["casual_eats", "casual_eats_world", "casual_eats_extended"]));
  assertEquals(plan.batches.length, 12);
  assertEquals(plan.costIsFloor, true);
  // A config worked out from an old record is identified, but what else capped isn't known.
  assertEquals(planSplitLevel([capped({ config_attribution: "first_config" })], [], null, ids)!.costIsFloor, true);
});

// ── Pausing and paying ──────────────────────────────────────────────────────

function splitWorld(levels: Row[] = [], cappedRows: CappedSearch[] = [capped({})], active: Row | null = null): World {
  return world({
    rpcs: {
      seeding_city_search_status: () => ({ ...quietStatus, levels, active_run: active }),
      seeding_capped_searches_to_split: () => cappedRows,
      seeding_existing_split_children: () => [],
      seeding_start_search_level: (a) => ({ run_id: "run-new", batches: (a.p_batches as unknown[]).length, unresolved: (a.p_unresolved_batch_ids as unknown[]).length }),
    },
  });
}

const paid = (w: World) => w.rpcCalls.filter((c) => c.fn === "seeding_start_search_level").length;

Deno.test("a level doesn't start without confirm, and the preview gives real numbers", async () => {
  const done = { kind: "split", run_id: "r0", level: 1, status: "completed", total_batches: 40, completed_batches: 40, failed_batches: 0, skipped_batches: 0, total_places_new: 64, capped_searches: 6, total_cost_usd: 1.28, estimated_cost_usd: 1.28 };
  const w = splitWorld([done], [capped({ level: 1, radius_m: 1000 })]);
  const db = fakeDb(w);
  const preview = await previewSplitLevel(db, { cityId: CITY });
  assertEquals(preview.nextLevel, 2);
  assertEquals(preview.sampling, false);
  assertEquals(preview.searches, 4);
  assertEquals(preview.estimatedCostUsd, Math.round(4 * COST_PER_NEARBY_SEARCH * 100) / 100);
  assertEquals(preview.priorLevels[0].newPlaces, 64);
  assertEquals(preview.priorLevels[0].newPlacesPerDollar, 50);
  assertEquals(preview.priorLevels[0].cappedSearches, 6);
  assertEquals(paid(w), 0);

  const refused = await assertRejects(() => startSplitLevel(db, { cityId: CITY, expectedLevel: 2 }), PipelineRefusal);
  assertEquals(refused.code, "confirmation_required");
  assertEquals(paid(w), 0);

  const stale = await assertRejects(() => startSplitLevel(db, { cityId: CITY, confirm: true, expectedLevel: 1 }), PipelineRefusal);
  assertEquals(stale.code, "plan_changed");
  assertEquals(paid(w), 0);

  const started = await startSplitLevel(db, { cityId: CITY, confirm: true, expectedLevel: 2 });
  assertEquals(started.runId, "run-new");
  assertEquals(started.searches, 4);
  assertEquals(paid(w), 1);
});

Deno.test("until one level has finished, a run can only be a sample of 10 tiles", async () => {
  const rows = Array.from({ length: 40 }, (_, t) => capped({ tile_id: `t${t}`, tile_index: t }));
  const w = splitWorld([], rows);
  const preview = await previewSplitLevel(fakeDb(w), { cityId: CITY, tileLimit: 500 });
  assertEquals(preview.sampling, true);
  assertEquals(preview.parentTiles, 10);
  assertEquals(preview.cappedAtThisLevel, 40);
  const cancelled = splitWorld([{ kind: "split", run_id: "r", status: "cancelled", total_cost_usd: 0, total_places_new: 0 }], rows);
  assertEquals((await previewSplitLevel(fakeDb(cancelled), { cityId: CITY })).parentTiles, 10);
});

Deno.test("high cost needs its own confirmation", async () => {
  const rows = Array.from({ length: 4000 }, (_, t) => capped({ tile_id: `t${t}`, tile_index: t }));
  const done = { kind: "split", run_id: "r0", level: 1, status: "completed", total_cost_usd: 1, total_places_new: 1 };
  const w = splitWorld([done], rows);
  const db = fakeDb(w);
  const preview = await previewSplitLevel(db, { cityId: CITY });
  assertEquals(preview.exceedsHighCost, true);
  const refused = await assertRejects(() => startSplitLevel(db, { cityId: CITY, confirm: true, expectedLevel: 1 }), PipelineRefusal);
  assertEquals(refused.code, "high_cost_confirmation_required");
  assertEquals(paid(w), 0);
  await startSplitLevel(db, { cityId: CITY, confirm: true, expectedLevel: 1, acceptHighCost: true });
  assertEquals(paid(w), 1);
});

Deno.test("a conflict from the database reaches the caller as a 409 refusal", async () => {
  const w = splitWorld();
  w.rpcs.seeding_start_search_level = () => {
    throw Object.assign(new Error("city has an active seeding run"), { code: "PT409" });
  };
  const refused = await assertRejects(() => startSplitLevel(fakeDb(w), { cityId: CITY, confirm: true, expectedLevel: 1 }), PipelineRefusal);
  assertEquals(refused.code, "active_run");
  assertEquals(refused.status, 409);
});

// ── T3 ──────────────────────────────────────────────────────────────────────

function fillWorld(tiles: Row[], unfinished: Row[]): World {
  return world({
    rpcs: {
      seeding_active_tiles: () => tiles,
      seeding_unfinished_searches_json: () => unfinished,
      seeding_city_search_status: () => quietStatus,
      seeding_start_search_level: (a) => ({ run_id: "fill-run", batches: (a.p_batches as unknown[]).length, unresolved: 0 }),
    },
  });
}

Deno.test("T3: fill adds tiles only for gaps, every config on them, plus what never finished", async () => {
  // One tile at the south-west corner of a 5.5 km box: most of the box is a gap.
  const w = fillWorld(
    [{ id: "t1", center_lat: 10, center_lng: 10, radius_m: 2000, kind: "grid", tile_index: 0, row_idx: 0, col_idx: 0, level: 0 }],
    [
      { tile_id: "t1", search_config_id: "picnic_park", included_types_override: null, level: 0, reason: "never_searched" },
      { tile_id: "c9", search_config_id: "drink", included_types_override: ["bar"], level: 3, reason: "failed" },
    ],
  );
  const db = fakeDb(w);
  const preview = await previewFill(db, { cityId: CITY });
  assert(preview.uncoveredTiles > 0);
  assertEquals(preview.neverSearched, 1);
  assertEquals(preview.failed, 1);
  assertEquals(preview.searches, preview.uncoveredTiles * SEEDING_CATEGORIES.length + 2);
  assertEquals(paid(w), 0);

  await assertRejects(() => startFill(db, { cityId: CITY, expectedSearches: preview.searches }), PipelineRefusal);
  const stale = await assertRejects(() => startFill(db, { cityId: CITY, confirm: true, expectedSearches: 1 }), PipelineRefusal);
  assertEquals(stale.code, "plan_changed");
  assertEquals(paid(w), 0);

  const started = await startFill(db, { cityId: CITY, confirm: true, expectedSearches: preview.searches });
  assertEquals(started.runId, "fill-run");
  const args = w.rpcCalls.find((c) => c.fn === "seeding_start_search_level")!.args;
  assertEquals(args.p_kind, "fill");
  const batches = args.p_batches as Array<Row>;
  assert(batches.some((b) => b.tile_id === "c9" && b.level === 3 && JSON.stringify(b.included_types_override) === '["bar"]'));
  assert((args.p_tiles as Row[]).every((t) => t.kind === "fill" && t.parent_tile_id === null));
});

// ── T8 ──────────────────────────────────────────────────────────────────────

Deno.test({ name: "T8 never runs on its own: no confirm, no search and no record", ...opts, fn: async () => {
  const w = world();
  const g = stubGoogle(() => Response.json({ places: [] }));
  try {
    const refused = await assertRejects(() => runCompletenessCheck(fakeDb(w), { cityId: CITY }, { googleApiKey: "k" }), PipelineRefusal);
    assertEquals(refused.code, "confirmation_required");
    assertEquals(g.bodies.length, 0);
    assertEquals(w.tables.seeding_completeness_checks, []);
  } finally { g.restore(); }
  const src = Deno.readTextFileSync(new URL("../../../migrations/20280410024276_issue_4276_tile_completeness.sql", import.meta.url));
  assertEquals(/cron\.schedule/.test(src), false, "nothing may schedule it");
}});

Deno.test({ name: "T8: 20 unfiltered searches at 300 m, compared by google_place_id, by type", ...opts, fn: async () => {
  const w = world({
    tables: {
      place_pool: [{ google_place_id: "in-pool" }],
      seeding_filtered_results: [{ city_id: CITY, google_place_id: "dropped", reason: "no_photos" }],
    } as Record<string, Row[]>,
  });
  const inBox = { latitude: 10.01, longitude: 10.01 };
  const g = stubGoogle((_b, call) => Response.json({
    places: call === 1
      ? [
        { id: "in-pool", types: ["park"], primaryType: "park", location: inBox },
        { id: "dropped", types: ["park"], primaryType: "park", location: inBox },
        { id: "known-miss", types: ["park"], primaryType: "park", location: inBox },
        { id: "known-miss", types: ["park"], primaryType: "park", location: inBox },
        { id: "odd", types: ["car_wash"], primaryType: "car_wash", location: inBox },
        { id: "far", types: ["park"], location: { latitude: 50, longitude: 50 } },
        { id: "closed", types: ["park"], businessStatus: "CLOSED_PERMANENTLY", location: inBox },
      ]
      : call === 2
      ? Array.from({ length: SEARCH_RESULT_CAP }, (_, i) => ({ id: "in-pool", types: ["park"], location: inBox, i }))
      : [],
  }));
  try {
    const row = await runCompletenessCheck(fakeDb(w), { cityId: CITY, confirm: true }, { googleApiKey: "k" });
    assertEquals(g.bodies.length, COMPLETENESS_SEARCH_COUNT);
    for (const b of g.bodies as Array<{ includedTypes?: unknown; locationRestriction: { circle: { radius: number; center: { latitude: number } } } }>) {
      assertEquals(b.includedTypes, undefined, "no type filter");
      assertEquals(b.locationRestriction.circle.radius, COMPLETENESS_RADIUS_M);
      assert(b.locationRestriction.circle.center.latitude >= 10 && b.locationRestriction.circle.center.latitude <= 10.05);
    }
    assertEquals(row.status, "completed");
    assertEquals(row.searches_capped, 1);
    assertEquals(row.results_in_pool, 1);
    assertEquals(row.results_dropped_at_seed, 1);
    assertEquals(row.results_missing, 2);
    assertEquals(row.results_outside_box, 1);
    assertEquals(row.missing_share, 0.5);
    assertEquals(row.unknown_types, [{ type: "car_wash", count: 1 }]);
    assertEquals(row.missing_by_type, [
      { type: "car_wash", count: 1, searched: false },
      { type: "park", count: 1, searched: true },
    ]);
    assertEquals(row.cost_usd, Math.round(COMPLETENESS_SEARCH_COUNT * COST_PER_NEARBY_SEARCH * 1000) / 1000);
    assertEquals(w.tables.seeding_completeness_checks.length, 1);
  } finally { g.restore(); }
}});

Deno.test({ name: "T8: a failed search means a failed check, not a flattering one", ...opts, fn: async () => {
  const w = world();
  const g = stubGoogle((_b, c) => c === 5 ? new Response("nope", { status: 429 }) : Response.json({ places: [] }));
  try {
    const row = await runCompletenessCheck(fakeDb(w), { cityId: CITY, confirm: true }, { googleApiKey: "k" });
    assertEquals(row.status, "failed");
    assertEquals(row.searches_failed, 1);
    assert(String(row.error_message).includes("429"));
  } finally { g.restore(); }
}});

Deno.test("T8: nothing to compare is no answer, not 0% missing", () => {
  const box = { swLat: 0, swLng: 0, neLat: 1, neLng: 1 };
  const s = summariseCompleteness({ box, places: [], poolIds: new Set(), droppedIds: new Set(), searchedTypes: new Set() });
  assertEquals(s.missing_share, null);
});

// ── T9 ──────────────────────────────────────────────────────────────────────

function tilesWorld(tiles: Row[]): World {
  let active = tiles;
  return world({
    rpcs: {
      seeding_active_tiles: () => active,
      seeding_replace_tiles: (a) => {
        const fresh = (a.p_tiles as Row[]).map((t, i) => ({ ...t, id: `new${i}`, kind: "grid", level: 0 }));
        active = fresh;
        return { retired: (a.p_retire_ids as unknown[]).length, inserted: fresh.length };
      },
      seeding_places_outside_box: () => [{ outside_active: 12 }],
    },
  });
}

Deno.test("T9: a box change retires old tiles and warns about places left outside", async () => {
  const w = tilesWorld([{ id: "old", center_lat: 5, center_lng: 5, radius_m: 2000, kind: "grid", tile_index: 0, row_idx: 0, col_idx: 0, level: 0 }]);
  const r = await generateTilesForCity(fakeDb(w), CITY);
  assertEquals(r.unchanged, false);
  assertEquals(r.retiredTiles, 1);
  assert(r.tileCount > 1);
  assertEquals(r.placesOutsideBox.outside_active, 12);
  assertEquals(w.rpcCalls.find((c) => c.fn === "seeding_replace_tiles")!.args.p_retire_ids, ["old"]);
});

Deno.test("T9: regenerating a grid that already fits changes nothing, so no search is lost", async () => {
  const seed = tilesWorld([]);
  const first = await generateTilesForCity(fakeDb(seed), CITY);
  const again = await generateTilesForCity(fakeDb(seed), CITY);
  assertEquals(again.unchanged, true);
  assertEquals(again.retiredTiles, 0);
  assertEquals(again.tileCount, first.tileCount);
  assertEquals(seed.rpcCalls.filter((c) => c.fn === "seeding_replace_tiles").length, 1);
});

Deno.test("the source can't delete tiles any more", () => {
  for (const file of ["../index.ts", "../searchPipeline.ts"]) {
    const src = Deno.readTextFileSync(new URL(file, import.meta.url));
    assertEquals(/from\("seeding_tiles"\)\s*\.delete/.test(src), false, file);
  }
});

// ── B1 ──────────────────────────────────────────────────────────────────────

const geocoded = (types: string[], grow = 0.2): (q: string) => Promise<GeocodeResult> => (_q) =>
  Promise.resolve({
    center: { lat: 10.025, lng: 10.025 },
    formattedAddress: "x",
    resultTypes: types,
    viewport: { swLat: 10 - grow, swLng: 10 - grow, neLat: 10.05 + grow, neLng: 10.05 + grow },
  });

function boxWorld(active: Row | null = null): World {
  return world({
    rpcs: {
      seeding_city_search_status: () => ({ ...quietStatus, active_run: active }),
      check_city_bbox_overlap: () => [{ id: "n", name: "Neighbour", country: "Testland" }],
      seeding_places_outside_box: () => [{ outside_active: 0 }],
      seeding_active_tiles: () => [],
      seeding_replace_tiles: () => ({ retired: 0, inserted: 1 }),
    },
  });
}

Deno.test("B1: a city result applies with no person, overlap only a notice", async () => {
  const w = boxWorld();
  const r = await applyCityBox(fakeDb(w), { cityId: CITY }, geocoded(["locality", "political"]));
  assertEquals(r.applied, true);
  assertEquals((r as { overlaps: unknown[] }).overlaps.length, 1);
  assertEquals(w.tables.seeding_cities[0].bbox_ne_lat, 10.25);
  assertEquals(w.rpcCalls.filter((c) => c.fn === "seeding_replace_tiles").length, 1);
});

Deno.test("B1: a state result waits for a person, and writes nothing until then", async () => {
  const w = boxWorld();
  const db = fakeDb(w);
  const refused = await assertRejects(
    () => applyCityBox(db, { cityId: CITY }, geocoded(["administrative_area_level_1", "political"])),
    PipelineRefusal,
  );
  assertEquals(refused.code, "needs_person");
  assertEquals(refused.detail.askReasons, ["state_or_region_result"]);
  assertEquals(w.tables.seeding_cities[0].bbox_ne_lat, 10.05);
  const r = await applyCityBox(db, { cityId: CITY, confirm: true }, geocoded(["administrative_area_level_1", "political"]));
  assertEquals(r.applied, true);
});

Deno.test("B1: no box moves under an active run", async () => {
  const w = boxWorld({ id: "r", status: "paused", kind: "seed" });
  const refused = await assertRejects(() => applyCityBox(fakeDb(w), { cityId: CITY }, geocoded(["locality"])), PipelineRefusal);
  assertEquals(refused.code, "active_run");
  assertEquals(w.tables.seeding_cities[0].bbox_ne_lat, 10.05);
});

Deno.test("B1: a box that wouldn't change writes nothing", async () => {
  const w = boxWorld();
  const r = await applyCityBox(fakeDb(w), { cityId: CITY }, geocoded(["locality"], -0.01));
  assertEquals(r.applied, false);
  assertEquals(w.rpcCalls.filter((c) => c.fn === "seeding_replace_tiles").length, 0);
});

Deno.test("B1: a hand-adjusted box needs a person and a valid box", async () => {
  const w = boxWorld();
  const db = fakeDb(w);
  const box = { swLat: 9, swLng: 9, neLat: 11, neLng: 11 };
  await assertRejects(() => applyCityBox(db, { cityId: CITY, manualBox: box }, geocoded([])), PipelineRefusal);
  await assertRejects(() => applyCityBox(db, { cityId: CITY, confirm: true, manualBox: { ...box, swLat: 12 } }, geocoded([])), PipelineRefusal);
  const r = await applyCityBox(db, { cityId: CITY, confirm: true, manualBox: box }, () => {
    throw new Error("a manual box needs no geocode");
  });
  assertEquals(r.source, "manual");
  assertEquals(w.tables.seeding_cities[0].bbox_sw_lat, 9);
});
