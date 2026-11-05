// Issue #4276 T3 to T9 and B1, B2: the server actions behind one seamless pipeline.
//
// Screens and the conductor are later waves; these are what they call. Nothing here
// spends money unless the caller passes confirm:true, and every money action answers
// a preview first. Writing many rows is left to SQL functions, so a plan either lands
// whole or not at all.

import { fetchWithGoogleBackoff } from "../_shared/googleBackoff.ts";
import {
  SEEDING_CATEGORIES,
  SEEDING_CATEGORY_MAP,
  type SeedingCategoryConfig,
} from "../_shared/seedingCategories.ts";
import {
  type Box,
  type Circle,
  COST_PER_NEARBY_SEARCH,
  COST_PER_PHOTO,
  countGridTiles,
  decideSplit,
  estimateSeedCostUsd,
  EXPECTED_UNIQUE_PLACES_PER_TILE,
  findUncoveredGridTiles,
  generateTileGrid,
  HIGH_COST_USD,
  isBoxCovered,
  isInsideBox,
  PHOTOS_PER_PLACE,
  randomPointsInBox,
  SEARCH_RESULT_CAP,
  splitChildren,
} from "../_shared/seedingGeometry.ts";
import { type CityBoxDecision, decideCityBox, geocodeQueryForCity } from "./cityBox.ts";

/** A refusal the caller can act on, with its own status and a machine-readable code. */
export class PipelineRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "PipelineRefusal";
  }
}

// deno-lint-ignore no-explicit-any
type Db = any;

export const SAMPLE_TILE_LIMIT = 10;
export const COMPLETENESS_SEARCH_COUNT = 20;
export const COMPLETENESS_RADIUS_M = 300;
const COMPLETENESS_CONCURRENCY = 4;
const COMPLETENESS_FIELD_MASK =
  "places.id,places.types,places.primaryType,places.businessStatus,places.location";
const NEARBY_SEARCH_URL = "https://places.googleapis.com/v1/places:searchNearby";

export const configsPayload = () =>
  SEEDING_CATEGORIES.map((c) => ({ id: c.id, slug: c.appCategorySlug }));

function configsForSlug(slug: string): SeedingCategoryConfig[] {
  return SEEDING_CATEGORIES.filter((c) => c.appCategorySlug === slug || c.id === slug);
}

async function rpc(db: Db, fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    if (error.code === "PT409") {
      throw new PipelineRefusal("active_run", error.message);
    }
    throw new Error(`${fn} failed: ${error.message}`);
  }
  return data;
}

// deno-lint-ignore no-explicit-any
async function loadCity(db: Db, cityId: unknown): Promise<any> {
  if (!cityId) throw new PipelineRefusal("bad_request", "cityId is required", 400);
  const { data, error } = await db.from("seeding_cities").select("*").eq("id", cityId).single();
  if (error || !data) throw new PipelineRefusal("not_found", `City not found: ${cityId}`, 404);
  return data;
}

// deno-lint-ignore no-explicit-any
function cityBox(city: any): Box | null {
  if (
    city.bbox_sw_lat == null || city.bbox_sw_lng == null || city.bbox_ne_lat == null ||
    city.bbox_ne_lng == null
  ) return null;
  return {
    swLat: city.bbox_sw_lat,
    swLng: city.bbox_sw_lng,
    neLat: city.bbox_ne_lat,
    neLng: city.bbox_ne_lng,
  };
}

interface ActiveTile extends Circle {
  id: string;
  kind: "grid" | "fill" | "split";
  tile_index: number;
  row_idx: number;
  col_idx: number;
  level: number;
}

async function activeTiles(db: Db, cityId: string): Promise<ActiveTile[]> {
  return (await rpc(db, "seeding_active_tiles", { p_city_id: cityId })) as ActiveTile[];
}

const baseCircles = (tiles: ActiveTile[]) => tiles.filter((t) => t.kind !== "split");

// ── T9: tiles for a box ─────────────────────────────────────────────────────

const tileResponse = (t: ActiveTile) => ({
  id: t.id,
  tileIndex: t.tile_index,
  centerLat: t.center_lat,
  centerLng: t.center_lng,
  radiusM: t.radius_m,
  row: t.row_idx,
  col: t.col_idx,
});

/**
 * generate_tiles. Tiles are retired, never deleted. A grid that already fits this box
 * and radius stays as it is, so regenerating can't throw away a city's searches for
 * nothing. A box or radius change retires the old tiles and everything split from them.
 */
export async function generateTilesForCity(db: Db, cityId: unknown) {
  const city = await loadCity(db, cityId);
  const box = cityBox(city);
  if (!box) throw new Error("City has no bounding box. Re-register with geocoding.");

  const before = await activeTiles(db, city.id);
  const circles = baseCircles(before);
  const fits = circles.length > 0 &&
    circles.every((t) =>
      t.radius_m === city.tile_radius_m && isInsideBox(t.center_lat, t.center_lng, {
        swLat: box.swLat - 1e-6,
        swLng: box.swLng - 1e-6,
        neLat: box.neLat + 1e-6,
        neLng: box.neLng + 1e-6,
      })
    ) &&
    isBoxCovered(box, circles, city.tile_radius_m);

  let retired = 0;
  let after = before;
  if (!fits) {
    const replaced = await rpc(db, "seeding_replace_tiles", {
      p_city_id: city.id,
      p_retire_ids: before.map((t) => t.id),
      p_tiles: generateTileGrid(box, city.tile_radius_m),
    });
    retired = replaced.retired;
    after = await activeTiles(db, city.id);
  }

  const outside = await rpc(db, "seeding_places_outside_box", { p_city_id: city.id });
  const tiles = baseCircles(after);
  return {
    cityId: city.id,
    tileCount: tiles.length,
    retiredTiles: retired,
    unchanged: fits,
    placesOutsideBox: outside?.[0] ?? null,
    tiles: tiles.map(tileResponse),
  };
}

// ── T3: fill ────────────────────────────────────────────────────────────────

interface UnfinishedSearch {
  tile_id: string;
  search_config_id: string;
  included_types_override: string[] | null;
  level: number;
  reason: "never_searched" | "failed";
}

interface PlanBatch {
  tile_id: string;
  seeding_category: string;
  app_category: string;
  search_config_id: string;
  included_types_override: string[] | null;
  level: number;
}

const batchFor = (
  tileId: string,
  config: SeedingCategoryConfig,
  level: number,
  override: string[] | null = null,
): PlanBatch => ({
  tile_id: tileId,
  seeding_category: config.appCategorySlug,
  app_category: config.appCategory,
  search_config_id: config.id,
  included_types_override: override,
  level,
});

async function planFill(db: Db, cityId: unknown) {
  const city = await loadCity(db, cityId);
  const box = cityBox(city);
  if (!box) throw new Error("City has no bounding box. Re-register with geocoding.");
  const tiles = await activeTiles(db, city.id);
  const uncovered = findUncoveredGridTiles(box, baseCircles(tiles), city.tile_radius_m);
  const unfinished = (await rpc(db, "seeding_unfinished_searches_json", {
    p_city_id: city.id,
    p_configs: configsPayload(),
  })) as UnfinishedSearch[];

  const newTiles = uncovered.map((t) => ({
    id: crypto.randomUUID(),
    center_lat: t.center_lat,
    center_lng: t.center_lng,
    radius_m: t.radius_m,
    row_idx: t.row_idx,
    col_idx: t.col_idx,
    parent_tile_id: null,
    level: 0,
    kind: "fill",
  }));
  const batches: PlanBatch[] = [];
  for (const u of unfinished) {
    const config = SEEDING_CATEGORY_MAP[u.search_config_id];
    if (!config) throw new Error(`Unknown search config on an unfinished search: ${u.search_config_id}`);
    batches.push(batchFor(u.tile_id, config, u.level, u.included_types_override));
  }
  for (const t of newTiles) {
    for (const config of SEEDING_CATEGORIES) batches.push(batchFor(t.id, config, 0));
  }
  const estimatedCostUsd = Math.round(
    (batches.length * COST_PER_NEARBY_SEARCH +
      newTiles.length * EXPECTED_UNIQUE_PLACES_PER_TILE * PHOTOS_PER_PLACE * COST_PER_PHOTO) * 100,
  ) / 100;

  const status = await rpc(db, "seeding_city_search_status", {
    p_city_id: city.id,
    p_configs: configsPayload(),
  });
  return { city, newTiles, batches, unfinished, estimatedCostUsd, activeRun: status.active_run ?? null };
}

export async function previewFill(db: Db, body: Record<string, unknown>) {
  const plan = await planFill(db, body.cityId);
  return {
    cityId: plan.city.id,
    uncoveredTiles: plan.newTiles.length,
    neverSearched: plan.unfinished.filter((u) => u.reason === "never_searched").length,
    failed: plan.unfinished.filter((u) => u.reason === "failed").length,
    searches: plan.batches.length,
    estimatedCostUsd: plan.estimatedCostUsd,
    exceedsHighCost: plan.estimatedCostUsd > HIGH_COST_USD,
    highCostUsd: HIGH_COST_USD,
    blockedByRun: plan.activeRun,
  };
}

function requireConfirmation(
  body: Record<string, unknown>,
  estimatedCostUsd: number,
): void {
  if (body.confirm !== true) {
    throw new PipelineRefusal("confirmation_required", "This spends money: preview it, then pass confirm:true.", 400);
  }
  if (estimatedCostUsd > HIGH_COST_USD && body.acceptHighCost !== true) {
    throw new PipelineRefusal(
      "high_cost_confirmation_required",
      `Estimated $${estimatedCostUsd}, above the $${HIGH_COST_USD} limit: pass acceptHighCost:true.`,
      400,
      { estimatedCostUsd },
    );
  }
}

export async function startFill(db: Db, body: Record<string, unknown>) {
  const plan = await planFill(db, body.cityId);
  requireConfirmation(body, plan.estimatedCostUsd);
  if (body.expectedSearches !== plan.batches.length) {
    throw new PipelineRefusal(
      "plan_changed",
      `The plan is now ${plan.batches.length} searches, not ${body.expectedSearches}. Preview again.`,
      409,
      { searches: plan.batches.length },
    );
  }
  if (plan.batches.length === 0) {
    return { cityId: plan.city.id, runId: null, searches: 0, addedTiles: 0, message: "Nothing to fill" };
  }
  const started = await rpc(db, "seeding_start_search_level", {
    p_city_id: plan.city.id,
    p_kind: "fill",
    p_level: 0,
    p_estimated_cost_usd: plan.estimatedCostUsd,
    p_tiles: plan.newTiles,
    p_batches: plan.batches,
    p_split_batch_ids: [],
    p_unresolved_batch_ids: [],
  });
  return {
    cityId: plan.city.id,
    runId: started.run_id,
    searches: started.batches,
    addedTiles: plan.newTiles.length,
    estimatedCostUsd: plan.estimatedCostUsd,
  };
}

// ── T4, T5: split ───────────────────────────────────────────────────────────

export interface CappedSearch {
  batch_id: string;
  tile_id: string;
  tile_index: number;
  center_lat: number;
  center_lng: number;
  radius_m: number;
  row_idx: number;
  col_idx: number;
  level: number;
  seeding_category: string;
  search_config_id: string | null;
  config_attribution: string;
  included_types_override: string[] | null;
}

export interface ExistingChild {
  id: string;
  parent_tile_id: string;
  row_idx: number;
  col_idx: number;
}

export interface SplitPlan {
  /** The level these searches create. */
  level: number;
  parentTiles: number;
  tiles: Array<Record<string, unknown>>;
  batches: PlanBatch[];
  splitBatchIds: string[];
  unresolvedBatchIds: string[];
  costIsFloor: boolean;
  cappedAtThisLevel: number;
}

/**
 * T4 and T5, pure. Only the capped search repeats, never the whole tile. Works the
 * shallowest level first, so a level finishes before the next one is priced. Where an
 * old record can't name its config, every config in that category repeats.
 */
export function planSplitLevel(
  capped: readonly CappedSearch[],
  existingChildren: readonly ExistingChild[],
  tileLimit: number | null,
  newId: () => string = () => crypto.randomUUID(),
): SplitPlan | null {
  if (capped.length === 0) return null;
  const shallowest = Math.min(...capped.map((c) => c.level));
  const atLevel = capped.filter((c) => c.level === shallowest);

  // A sample takes the tiles with the most capped searches: the most to learn.
  let chosen = atLevel;
  if (tileLimit !== null) {
    const perTile = new Map<string, { n: number; index: number }>();
    for (const c of atLevel) {
      const e = perTile.get(c.tile_id) ?? { n: 0, index: c.tile_index };
      e.n++;
      perTile.set(c.tile_id, e);
    }
    const keep = new Set(
      [...perTile.entries()]
        .sort((a, b) => b[1].n - a[1].n || a[1].index - b[1].index)
        .slice(0, tileLimit)
        .map(([id]) => id),
    );
    chosen = atLevel.filter((c) => keep.has(c.tile_id));
  }

  const children = new Map(
    existingChildren.map((c) => [`${c.parent_tile_id}|${c.row_idx}|${c.col_idx}`, c.id]),
  );
  const tiles: Array<Record<string, unknown>> = [];
  const batches: PlanBatch[] = [];
  const splitBatchIds: string[] = [];
  const unresolvedBatchIds: string[] = [];
  const done = new Set<string>();
  let costIsFloor = false;

  for (const search of chosen) {
    const named = search.search_config_id ? SEEDING_CATEGORY_MAP[search.search_config_id] : undefined;
    const configs = named ? [named] : configsForSlug(search.seeding_category);
    if (configs.length === 0) {
      throw new Error(`Capped search ${search.batch_id} has no known config (${search.seeding_category})`);
    }
    // Old records can't say what else was capped, so the real cost can only be higher.
    if (!named || search.config_attribution !== "recorded") costIsFloor = true;

    let unresolved = false;
    for (const config of configs) {
      const types = search.included_types_override ?? config.includedTypes;
      const key = `${search.tile_id}|${config.id}|${types.join(",")}`;
      const decision = decideSplit(search.radius_m, types);
      if (decision.kind === "unresolved") {
        unresolved = true;
        continue;
      }
      if (done.has(key)) continue;
      done.add(key);
      if (decision.kind === "types") {
        for (const group of decision.groups) {
          batches.push(batchFor(search.tile_id, config, shallowest + 1, group));
        }
        continue;
      }
      const quarters = splitChildren(search);
      if (!quarters) throw new Error(`Search ${search.batch_id} can't split at ${search.radius_m} m`);
      for (const q of quarters) {
        const childKey = `${search.tile_id}|${q.row_idx}|${q.col_idx}`;
        let childId = children.get(childKey);
        if (!childId) {
          childId = newId();
          children.set(childKey, childId);
          tiles.push({ id: childId, ...q, parent_tile_id: search.tile_id, level: shallowest + 1, kind: "split" });
        }
        batches.push(batchFor(childId, config, shallowest + 1));
      }
    }
    (unresolved ? unresolvedBatchIds : splitBatchIds).push(search.batch_id);
  }

  return {
    level: shallowest + 1,
    parentTiles: new Set(chosen.map((c) => c.tile_id)).size,
    tiles,
    batches,
    splitBatchIds,
    unresolvedBatchIds,
    costIsFloor,
    cappedAtThisLevel: atLevel.length,
  };
}

// deno-lint-ignore no-explicit-any
function levelActuals(levels: any[]) {
  return levels
    .filter((l) => l.kind === "split")
    .map((l) => ({
      runId: l.run_id,
      level: l.level,
      status: l.status,
      searches: l.total_batches,
      finished: l.completed_batches,
      failed: l.failed_batches,
      skipped: l.skipped_batches,
      newPlaces: l.total_places_new,
      cappedSearches: l.capped_searches,
      costUsd: Math.round(l.total_cost_usd * 1000) / 1000,
      estimatedCostUsd: l.estimated_cost_usd,
      newPlacesPerDollar: l.total_cost_usd > 0 ? Math.round((l.total_places_new / l.total_cost_usd) * 10) / 10 : null,
    }));
}

async function loadSplitPlan(db: Db, body: Record<string, unknown>) {
  const city = await loadCity(db, body.cityId);
  const status = await rpc(db, "seeding_city_search_status", {
    p_city_id: city.id,
    p_configs: configsPayload(),
  });
  // T5: the first search of any city's split is a sample of 10 tiles, so every later
  // decision is made on real yield, not an estimate.
  const actuals = levelActuals(status.levels);
  const sampling = !actuals.some((l) => l.status === "completed");
  const requested = typeof body.tileLimit === "number" && body.tileLimit > 0 ? body.tileLimit : null;
  const tileLimit = sampling ? Math.min(requested ?? SAMPLE_TILE_LIMIT, SAMPLE_TILE_LIMIT) : requested;

  const capped = (await rpc(db, "seeding_capped_searches_to_split", { p_city_id: city.id })) as CappedSearch[];
  const existing = (await rpc(db, "seeding_existing_split_children", { p_city_id: city.id })) as ExistingChild[];
  const plan = planSplitLevel(capped, existing, tileLimit);
  const estimatedCostUsd = plan
    ? Math.round(plan.batches.length * COST_PER_NEARBY_SEARCH * 100) / 100
    : 0;
  return { city, status, actuals, sampling, plan, estimatedCostUsd };
}

export async function previewSplitLevel(db: Db, body: Record<string, unknown>) {
  const { city, status, actuals, sampling, plan, estimatedCostUsd } = await loadSplitPlan(db, body);
  return {
    cityId: city.id,
    sampling,
    nextLevel: plan?.level ?? null,
    parentTiles: plan?.parentTiles ?? 0,
    cappedAtThisLevel: plan?.cappedAtThisLevel ?? 0,
    searches: plan?.batches.length ?? 0,
    newUnresolved: plan?.unresolvedBatchIds.length ?? 0,
    estimatedCostUsd,
    costIsFloor: plan?.costIsFloor ?? false,
    exceedsHighCost: estimatedCostUsd > HIGH_COST_USD,
    highCostUsd: HIGH_COST_USD,
    priorLevels: actuals,
    blockedByRun: status.active_run ?? null,
  };
}

/** Pauses after every level: nothing starts without confirm and the level it saw. */
export async function startSplitLevel(db: Db, body: Record<string, unknown>) {
  const { city, plan, estimatedCostUsd, sampling } = await loadSplitPlan(db, body);
  requireConfirmation(body, estimatedCostUsd);
  if (!plan) return { cityId: city.id, runId: null, searches: 0, message: "No capped searches to split" };
  if (body.expectedLevel !== plan.level) {
    throw new PipelineRefusal(
      "plan_changed",
      `The next level is ${plan.level}, not ${body.expectedLevel}. Preview again.`,
      409,
      { nextLevel: plan.level },
    );
  }
  const started = await rpc(db, "seeding_start_search_level", {
    p_city_id: city.id,
    p_kind: "split",
    p_level: plan.level,
    p_estimated_cost_usd: estimatedCostUsd,
    p_tiles: plan.tiles,
    p_batches: plan.batches,
    p_split_batch_ids: plan.splitBatchIds,
    p_unresolved_batch_ids: plan.unresolvedBatchIds,
  });
  return {
    cityId: city.id,
    runId: started.run_id,
    level: plan.level,
    sampling,
    searches: started.batches,
    addedTiles: plan.tiles.length,
    unresolved: started.unresolved,
    estimatedCostUsd,
    costIsFloor: plan.costIsFloor,
  };
}

// ── T8: completeness check ──────────────────────────────────────────────────

export interface CheckPlace {
  id: string;
  types?: string[];
  primaryType?: string;
  businessStatus?: string;
  location?: { latitude?: number; longitude?: number };
}

/** Pure. Compares what a no-filter search sees with what the pool holds. */
export function summariseCompleteness(input: {
  box: Box;
  places: readonly CheckPlace[];
  poolIds: ReadonlySet<string>;
  droppedIds: ReadonlySet<string>;
  searchedTypes: ReadonlySet<string>;
}) {
  const seen = new Map<string, CheckPlace>();
  for (const p of input.places) if (p.id && !seen.has(p.id)) seen.set(p.id, p);

  let outside = 0;
  let inPool = 0;
  let dropped = 0;
  const missingTally = new Map<string, { count: number; searched: boolean }>();
  const unknownTally = new Map<string, number>();
  let inBox = 0;

  for (const p of seen.values()) {
    if (p.businessStatus === "CLOSED_PERMANENTLY") continue;
    const lat = p.location?.latitude;
    const lng = p.location?.longitude;
    if (lat == null || lng == null || !isInsideBox(lat, lng, input.box)) {
      outside++;
      continue;
    }
    inBox++;
    if (input.poolIds.has(p.id)) {
      inPool++;
      continue;
    }
    if (input.droppedIds.has(p.id)) {
      dropped++;
      continue;
    }
    const type = p.primaryType ?? p.types?.[0] ?? "unknown";
    // `searched` true means our lists ask for this place, and yet it isn't here: the
    // direct test of the assumption that a search returning under 20 was complete.
    const searched = (p.types ?? []).concat(p.primaryType ?? []).some((t) => input.searchedTypes.has(t));
    const row = missingTally.get(type) ?? { count: 0, searched };
    row.count++;
    missingTally.set(type, row);
    if (!searched) unknownTally.set(type, (unknownTally.get(type) ?? 0) + 1);
  }

  const missing = [...missingTally.values()].reduce((s, r) => s + r.count, 0);
  const comparable = inPool + dropped + missing;
  return {
    results_in_box: inBox,
    results_outside_box: outside,
    results_in_pool: inPool,
    results_dropped_at_seed: dropped,
    results_missing: missing,
    missing_share: comparable > 0 ? missing / comparable : null,
    missing_by_type: [...missingTally.entries()]
      .map(([type, r]) => ({ type, count: r.count, searched: r.searched }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    unknown_types: [...unknownTally.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
  };
}

async function idsIn(db: Db, table: string, column: string, ids: string[], cityId?: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    let query = db.from(table).select(column).in(column, ids.slice(i, i + 200));
    if (cityId) query = query.eq("city_id", cityId);
    const { data, error } = await query;
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    for (const row of data ?? []) out.add(row[column]);
  }
  return out;
}

export async function runCompletenessCheck(
  db: Db,
  body: Record<string, unknown>,
  deps: { googleApiKey: string; rng?: () => number },
) {
  const city = await loadCity(db, body.cityId);
  const box = cityBox(city);
  if (!box) throw new Error("City has no bounding box. Re-register with geocoding.");
  // T8 costs real money and never runs on its own: no cron, no default.
  if (body.confirm !== true) {
    throw new PipelineRefusal(
      "confirmation_required",
      `This runs ${COMPLETENESS_SEARCH_COUNT} paid searches: pass confirm:true.`,
      400,
    );
  }

  const points = randomPointsInBox(box, COMPLETENESS_SEARCH_COUNT, deps.rng);
  const places: CheckPlace[] = [];
  const errors: string[] = [];
  let capped = 0;
  let next = 0;
  const worker = async () => {
    while (next < points.length) {
      const point = points[next++];
      try {
        // #4276 C8: a rate limit waits instead of spoiling the whole sample.
        const res = await fetchWithGoogleBackoff(() =>
          fetch(NEARBY_SEARCH_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": deps.googleApiKey,
              "X-Goog-FieldMask": COMPLETENESS_FIELD_MASK,
            },
            body: JSON.stringify({
              maxResultCount: SEARCH_RESULT_CAP,
              locationRestriction: {
                circle: { center: { latitude: point.lat, longitude: point.lng }, radius: COMPLETENESS_RADIUS_M },
              },
              rankPreference: "POPULARITY",
            }),
          })
        );
        if (!res.ok) {
          errors.push(`Google ${res.status}: ${(await res.text()).slice(0, 200)}`);
          continue;
        }
        const found = ((await res.json()).places ?? []) as CheckPlace[];
        if (found.length >= SEARCH_RESULT_CAP) capped++;
        places.push(...found);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
  };
  await Promise.all(Array.from({ length: COMPLETENESS_CONCURRENCY }, worker));

  const ids = [...new Set(places.map((p) => p.id).filter(Boolean))];
  const summary = summariseCompleteness({
    box,
    places,
    poolIds: await idsIn(db, "place_pool", "google_place_id", ids),
    droppedIds: await idsIn(db, "seeding_filtered_results", "google_place_id", ids, city.id),
    searchedTypes: new Set(SEEDING_CATEGORIES.flatMap((c) => c.includedTypes)),
  });
  const row = {
    city_id: city.id,
    // A partial sample says nothing reliable, so it can't count as the city's check.
    status: errors.length === 0 ? "completed" : "failed",
    searches_planned: points.length,
    searches_failed: errors.length,
    searches_capped: capped,
    radius_m: COMPLETENESS_RADIUS_M,
    ...summary,
    points,
    error_message: errors.length ? errors.slice(0, 3).join(" | ") : null,
    cost_usd: Math.round(points.length * COST_PER_NEARBY_SEARCH * 1000) / 1000,
  };
  const { data, error } = await db.from("seeding_completeness_checks").insert(row).select("*").single();
  if (error) throw new Error(`Completeness check could not be saved: ${error.message}`);
  return data;
}

// ── The city panel's four checks ────────────────────────────────────────────

export async function citySearchStatus(db: Db, body: Record<string, unknown>) {
  const city = await loadCity(db, body.cityId);
  const box = cityBox(city);
  const status = await rpc(db, "seeding_city_search_status", {
    p_city_id: city.id,
    p_configs: configsPayload(),
  });
  const tiles = await activeTiles(db, city.id);
  const uncovered = box ? findUncoveredGridTiles(box, baseCircles(tiles), city.tile_radius_m).length : null;
  const last = status.last_completeness_check;
  const checks = {
    noUncoveredArea: uncovered === 0,
    noUnfinishedSearch: status.unfinished.total === 0,
    noOpenCappedSearch: status.capped_open === 0,
    completenessCheckOnRecord: last?.status === "completed",
  };
  return {
    cityId: city.id,
    uncoveredTiles: uncovered,
    ...status,
    checks,
    complete: Object.values(checks).every(Boolean),
  };
}

// ── B1 and B2: boxes ────────────────────────────────────────────────────────

export interface GeocodeResult {
  center: { lat: number; lng: number };
  viewport: Box;
  resultTypes: string[];
  formattedAddress: string;
}
export type Geocode = (query: string) => Promise<GeocodeResult>;

async function planBox(db: Db, cityId: unknown, geocode: Geocode) {
  const city = await loadCity(db, cityId);
  const query = geocodeQueryForCity(city);
  const google = await geocode(query);
  const decision: CityBoxDecision = decideCityBox({
    stored: cityBox(city),
    google: google.viewport,
    resultTypes: google.resultTypes,
    estimateSeedCostUsd: (box) =>
      estimateSeedCostUsd(countGridTiles(box, city.tile_radius_m), SEEDING_CATEGORIES.length),
  });
  return { city, query, google, decision };
}

async function overlapsAndOutside(db: Db, cityId: string, box: Box) {
  const { data: overlaps, error } = await db.rpc("check_city_bbox_overlap", {
    p_sw_lat: box.swLat,
    p_sw_lng: box.swLng,
    p_ne_lat: box.neLat,
    p_ne_lng: box.neLng,
    p_exclude_id: cityId,
  });
  if (error) throw new Error(`Overlap check failed: ${error.message}`);
  const outside = await rpc(db, "seeding_places_outside_box", {
    p_city_id: cityId,
    p_sw_lat: box.swLat,
    p_sw_lng: box.swLng,
    p_ne_lat: box.neLat,
    p_ne_lng: box.neLng,
  });
  return { overlaps: overlaps ?? [], placesOutside: outside?.[0] ?? null };
}

export async function planCityBox(db: Db, body: Record<string, unknown>, geocode: Geocode) {
  const { city, query, google, decision } = await planBox(db, body.cityId, geocode);
  return {
    cityId: city.id,
    query,
    google: { box: google.viewport, center: google.center, resultTypes: google.resultTypes, formattedAddress: google.formattedAddress },
    stored: cityBox(city),
    ...decision,
    estimatedSeedCostUsd: estimateSeedCostUsd(
      countGridTiles(decision.box, city.tile_radius_m),
      SEEDING_CATEGORIES.length,
    ),
    tiles: countGridTiles(decision.box, city.tile_radius_m),
    // Existing rule: blocked for a new city (the add-city form), a notice when updating.
    ...(await overlapsAndOutside(db, city.id, decision.box)),
  };
}

function validManualBox(raw: unknown): Box {
  const b = raw as Partial<Box> | null;
  const ok = b && [b.swLat, b.swLng, b.neLat, b.neLng].every((v) => typeof v === "number" && Number.isFinite(v)) &&
    b.swLat! < b.neLat! && b.swLng! < b.neLng!;
  if (!ok) throw new PipelineRefusal("bad_request", "manualBox needs swLat < neLat and swLng < neLng", 400);
  return b as Box;
}

/**
 * Google's box applies on its own. A state or region result, or a seed estimate over
 * the limit, needs confirm:true from a person; so does a hand-adjusted box.
 */
export async function applyCityBox(db: Db, body: Record<string, unknown>, geocode: Geocode) {
  const city = await loadCity(db, body.cityId);

  const status = await rpc(db, "seeding_city_search_status", {
    p_city_id: city.id,
    p_configs: configsPayload(),
  });
  if (status.active_run) {
    throw new PipelineRefusal(
      "active_run",
      `City has an active run (${status.active_run.id}, ${status.active_run.status}). Finish or cancel it first.`,
      409,
      { activeRun: status.active_run },
    );
  }

  let box: Box;
  let source: "google" | "manual";
  let grewEdges: string[] = [];
  if (body.manualBox !== undefined) {
    if (body.confirm !== true) {
      throw new PipelineRefusal("confirmation_required", "A hand-adjusted box needs confirm:true.", 400);
    }
    box = validManualBox(body.manualBox);
    source = "manual";
  } else {
    const { decision } = await planBox(db, city.id, geocode);
    if (!decision.autoApply && body.confirm !== true) {
      throw new PipelineRefusal(
        "needs_person",
        `A person must approve this box: ${decision.askReasons.join(", ")}.`,
        409,
        { askReasons: decision.askReasons, box: decision.box },
      );
    }
    if (!decision.changed) {
      return { cityId: city.id, applied: false, box: decision.box, source: "google", tiles: null };
    }
    box = decision.box;
    source = "google";
    grewEdges = decision.grewEdges;
  }

  const notice = await overlapsAndOutside(db, city.id, box);
  const { error } = await db.from("seeding_cities").update({
    bbox_sw_lat: box.swLat,
    bbox_sw_lng: box.swLng,
    bbox_ne_lat: box.neLat,
    bbox_ne_lng: box.neLng,
    updated_at: new Date().toISOString(),
  }).eq("id", city.id);
  if (error) throw new Error(`City box update failed: ${error.message}`);

  const tiles = await generateTilesForCity(db, city.id);
  return {
    cityId: city.id,
    applied: true,
    source,
    box,
    grewEdges,
    ...notice,
    tileCount: tiles.tileCount,
    retiredTiles: tiles.retiredTiles,
  };
}

export async function placesOutsideBox(db: Db, body: Record<string, unknown>) {
  const report = await rpc(db, "seeding_places_outside_box", { p_city_id: body.cityId ?? null });
  return { report };
}

export async function retiredTileHistory(db: Db, body: Record<string, unknown>) {
  const city = await loadCity(db, body.cityId);
  return { cityId: city.id, history: await rpc(db, "seeding_retired_tile_history", { p_city_id: city.id }) };
}


