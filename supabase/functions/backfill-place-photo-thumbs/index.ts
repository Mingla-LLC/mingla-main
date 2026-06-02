import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Image, decode } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const BUCKET = 'place-photos';
// ORCH-1044: shrink the default batch so a freshly-created run's batches are
// small (≤ ~20 photos worst-case at MAX_PHOTOS=5, typically far fewer after the
// thumbExists HEAD skips). The CPU_WALL_GUARD_MS guard below makes even a legacy
// batch_size=25 batch safe by stopping mid-batch + self-invoking; the smaller
// default just reduces self-invoke chatter for NEW runs.
const DEFAULT_BATCH_SIZE = 4;
const MAX_BATCH_SIZE = 100;
const THUMB_SIZE = 384;
const THUMB_JPEG_QUALITY = 80;
// ORCH-1043: serial INTER_*_DELAY sleeps removed — the PARALLEL_N semaphore +
// the server-driven budget loop replace the browser-paced throttle. A tiny
// inter-photo yield is unnecessary at PARALLEL_N=6 (storage upload rate is far
// below the limit at this concurrency).
const RUN_CITY = 'ORCH-0957 place-photo thumbs';
const RUN_COUNTRY = 'GLOBAL';

// ORCH-1044 (Root Cause 1 + 2, I-THUMB-INVOCATION-CPU-BUDGET-BOUNDED) — serial decode.
//
// Edge isolates enforce a 2 s CPU hard cap
// (https://supabase.com/docs/guides/functions/limits — "Max CPU Time = 2 s …
// actual time spent on the CPU per request — does not include async I/O").
// imagescript decode/resize/encode is pure CPU. ORCH-1043's PARALLEL_N=6 +
// multi-batch budget loop crammed ~125 photos/batch and kept claiming more
// batches for 110 s → blew the 2 s CPU cap in seconds → HTTP 546 (WORKER_LIMIT).
//
// PARALLEL_N=1: concurrency buys NOTHING for CPU-bound decode on a single-threaded
// isolate — the decodes serialize on the CPU anyway; parallelism only front-loads
// CPU and accelerates hitting the soft limit. Serial + a wall guard makes CPU
// accrual predictable and lets a single invocation stop cleanly under the cap.
// 🔒 LOCKED (ORCH-1044 SPEC §5.1). Do NOT bump — the i-orch-1044 gate fails CI.
export const PARALLEL_N = 1;

// ORCH-1044 (A) — single small unit per invocation, then self-invoke. NO
// multi-batch wall-budget loop (the deleted BUDGET_MS=110_000 loop is what
// 546'd). handleProcessChunk processes AT MOST PER_INVOCATION_BATCHES (=1) batch
// per invocation, stops CPU-bound work at the wall guard, then self-invokes.
// Many tiny self-invokes, cron-backstopped. Slow but never 546. The single-unit
// shape STRUCTURALLY caps per-invocation work — no iteration counter needed.
export const PER_INVOCATION_BATCHES = 1; // 🔒 LOCKED — one batch per invocation.
const CPU_WALL_GUARD_MS = 1_200;        // 🔒 LOCKED — stop starting new photo jobs
                                        // once wall ≥ 1.2 s. Wall ≥ CPU, so this
                                        // guarantees < 2 s CPU for the CPU-bound
                                        // portion with ~800 ms headroom.
// Heartbeat staleness (the cron re-kicks a 'running' run whose heartbeat is
// older than this) is enforced in the migration's tg_kick_pending_thumb_backfill,
// which (ORCH-1044) also reclaims orphaned 'running' batches back to 'pending'.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type SupabaseAdmin = any;

interface PendingPlaceRow {
  id: string;
  stored_photo_urls: unknown;
}

interface ProcessPlaceResult {
  success: boolean;
  skipped: boolean;
  thumbsWritten: number;
  thumbsAlreadyPresent: number;
  failedPhotos: Array<{ url: string; error: string }>;
}

interface BatchResult {
  succeeded: number;
  failed: number;
  skipped: number;
  thumbsWritten: number;
  thumbsAlreadyPresent: number;
  failedPlaces: Array<{ placePoolId: string; error: string; failedPhotos?: Array<{ url: string; error: string }> }>;
  // ORCH-1044: true when the CPU_WALL_GUARD_MS guard tripped mid-batch and the
  // batch was NOT fully drained. The caller MUST return the batch to 'pending'
  // (not a terminal status) so it is re-claimed and resumed — already-written
  // thumbs are HEAD-skipped on the re-run, so per-place all-or-nothing holds.
  partial: boolean;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function parseBatchSize(raw: unknown): number {
  return Math.min(Math.max(Number(raw) || DEFAULT_BATCH_SIZE, 1), MAX_BATCH_SIZE);
}

export function extractPlacePhotoObjectPath(url: string): string | null {
  if (typeof url !== 'string' || url.trim().length === 0) return null;
  const prefix = '/storage/v1/object/public/place-photos/';
  const idx = url.indexOf(prefix);
  if (idx < 0) return null;
  const suffix = url.slice(idx + prefix.length).split('?')[0];
  return suffix.length > 0 ? suffix : null;
}

export function buildThumbPathFromObjectPath(objectPath: string): string | null {
  const cleaned = objectPath.split('?')[0];
  const lastSlash = cleaned.lastIndexOf('/');
  if (lastSlash < 0) return null;
  const dirPart = cleaned.slice(0, lastSlash + 1);
  const basename = cleaned.slice(lastSlash + 1);
  if (!basename) return null;
  const dotIdx = basename.lastIndexOf('.');
  const stem = dotIdx > 0 ? basename.slice(0, dotIdx) : basename;
  return `${dirPart}${stem}_thumb.jpg`;
}

function normalizeObjectPublicUrl(url: string): string {
  return url.split('?')[0];
}

async function thumbExists(publicUrl: string): Promise<boolean> {
  try {
    const res = await fetch(publicUrl, { method: 'HEAD' });
    return res.ok;
  } catch (err) {
    console.warn('[backfill-place-photo-thumbs] thumb HEAD failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function fetchOriginalBytes(publicObjectUrl: string): Promise<Uint8Array> {
  const res = await fetch(publicObjectUrl);
  if (!res.ok) {
    throw new Error(`original_fetch_failed_${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function encodeThumb(bytes: Uint8Array): Promise<Uint8Array> {
  const decoded = await decode(bytes);
  if (!(decoded instanceof Image)) {
    throw new Error('decoded_non_image');
  }
  decoded.resize(THUMB_SIZE, THUMB_SIZE);
  return await decoded.encodeJPEG(THUMB_JPEG_QUALITY);
}

/**
 * A unit of work: shrink ONE photo into its `_thumb.jpg`.
 * ORCH-1043 (B): these are flattened across a batch and run through a
 * size-PARALLEL_N semaphore so in-flight decodes stay bounded.
 */
interface PhotoJob {
  placeId: string;
  url: string;
  objectPath: string;
  thumbPath: string;
  thumbPublicUrl: string;
}

type PhotoOutcome =
  | { placeId: string; status: 'written' }
  | { placeId: string; status: 'present' }
  | { placeId: string; status: 'failed'; url: string; error: string };

async function runPhotoJob(db: SupabaseAdmin, job: PhotoJob): Promise<PhotoOutcome> {
  try {
    if (await thumbExists(job.thumbPublicUrl)) {
      return { placeId: job.placeId, status: 'present' };
    }
    const originalBytes = await fetchOriginalBytes(normalizeObjectPublicUrl(job.url));
    const thumbBytes = await encodeThumb(originalBytes);
    const { error: uploadError } = await db.storage
      .from(BUCKET)
      .upload(job.thumbPath, thumbBytes, {
        contentType: 'image/jpeg',
        upsert: true,
        cacheControl: '31536000',
      });
    if (uploadError) throw new Error(uploadError.message);
    return { placeId: job.placeId, status: 'written' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[backfill-place-photo-thumbs] photo failed for place ${job.placeId}:`, message);
    return { placeId: job.placeId, status: 'failed', url: job.url, error: message };
  }
}

/**
 * Run an array of async tasks at most `limit` at a time (semaphore).
 * ORCH-1043 (B): caps in-flight photo decodes at PARALLEL_N.
 */
async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = next++;
      if (idx >= tasks.length) return;
      results[idx] = await tasks[idx]();
    }
  }
  const workerCount = Math.min(limit, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function buildPhotoJobs(db: SupabaseAdmin, place: PendingPlaceRow): { jobs: PhotoJob[]; invalid: Array<{ url: string; error: string }> } {
  const urls = Array.isArray(place.stored_photo_urls)
    ? place.stored_photo_urls.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    : [];
  const jobs: PhotoJob[] = [];
  const invalid: Array<{ url: string; error: string }> = [];
  for (const url of urls) {
    const objectPath = extractPlacePhotoObjectPath(url);
    const thumbPath = objectPath ? buildThumbPathFromObjectPath(objectPath) : null;
    if (!objectPath || !thumbPath) {
      invalid.push({ url, error: 'invalid_place_photo_url' });
      continue;
    }
    const { data: thumbUrlData } = db.storage.from(BUCKET).getPublicUrl(thumbPath);
    const thumbPublicUrl = thumbUrlData?.publicUrl;
    if (!thumbPublicUrl) {
      invalid.push({ url, error: 'thumb_public_url_missing' });
      continue;
    }
    jobs.push({ placeId: place.id, url, objectPath, thumbPath, thumbPublicUrl });
  }
  return { jobs, invalid };
}

/**
 * Shrink all photos for ONE place. Preserved for unit tests + the manual
 * single-step path. ORCH-1043: photos run through the PARALLEL_N semaphore;
 * `thumbs_backfilled_at` is set ONLY when ALL photo-jobs for the place succeed
 * (all-or-nothing semantics preserved).
 */
export async function processPlaceThumbs(
  db: SupabaseAdmin,
  place: PendingPlaceRow,
  _options: { skipDelays?: boolean } = {},
): Promise<ProcessPlaceResult> {
  const { jobs, invalid } = buildPhotoJobs(db, place);

  if (jobs.length === 0 && invalid.length === 0) {
    return { success: false, skipped: true, thumbsWritten: 0, thumbsAlreadyPresent: 0, failedPhotos: [] };
  }

  const outcomes = await runWithConcurrency(
    jobs.map((job) => () => runPhotoJob(db, job)),
    PARALLEL_N,
  );

  let thumbsWritten = 0;
  let thumbsAlreadyPresent = 0;
  const failedPhotos: Array<{ url: string; error: string }> = [...invalid];
  for (const o of outcomes) {
    if (o.status === 'written') thumbsWritten++;
    else if (o.status === 'present') thumbsAlreadyPresent++;
    else failedPhotos.push({ url: o.url, error: o.error });
  }

  if (failedPhotos.length > 0) {
    return { success: false, skipped: false, thumbsWritten, thumbsAlreadyPresent, failedPhotos };
  }

  const { error: updateError } = await db
    .from('place_pool')
    .update({ thumbs_backfilled_at: new Date().toISOString() })
    .eq('id', place.id);

  if (updateError) {
    return {
      success: false,
      skipped: false,
      thumbsWritten,
      thumbsAlreadyPresent,
      failedPhotos: [{ url: 'place_pool', error: updateError.message }],
    };
  }

  return { success: true, skipped: false, thumbsWritten, thumbsAlreadyPresent, failedPhotos: [] };
}

/**
 * ORCH-1043 (C): resolve an optional city NAME → city_id via seeding_cities.
 * Returns { cityId } on match, or { error } on an unknown name.
 */
export async function resolveCityId(db: SupabaseAdmin, cityName: string): Promise<{ cityId?: string; error?: string }> {
  const { data, error } = await db
    .from('seeding_cities')
    .select('id, name')
    .ilike('name', cityName)
    .limit(1)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: `unknown_city: ${cityName}` };
  return { cityId: data.id };
}

/**
 * ORCH-1043 (C): scope = is_servable=true + has-photos + no-thumb (+ optional city_id).
 * stored_photo_urls is text[] → use the existing array-length post-filter (NOT jsonb).
 */
export async function loadPendingPlaces(
  db: SupabaseAdmin,
  opts: { limit?: number; cityId?: string } = {},
): Promise<PendingPlaceRow[]> {
  const pageSize = 1000;
  const out: PendingPlaceRow[] = [];
  let offset = 0;

  while (true) {
    let query = db
      .from('place_pool')
      .select('id, stored_photo_urls')
      .eq('is_servable', true)
      .is('thumbs_backfilled_at', null)
      .not('stored_photo_urls', 'is', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (opts.cityId) query = query.eq('city_id', opts.cityId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const rows = ((data ?? []) as PendingPlaceRow[])
      .filter((row) => Array.isArray(row.stored_photo_urls) && row.stored_photo_urls.length > 0);
    out.push(...rows);

    if (opts.limit && out.length >= opts.limit) return out.slice(0, opts.limit);
    if (!data || data.length < pageSize) break;
    offset += pageSize;
  }

  return out;
}

async function countPendingPlaces(db: SupabaseAdmin, opts: { cityId?: string } = {}): Promise<number> {
  const rows = await loadPendingPlaces(db, { cityId: opts.cityId });
  return rows.length;
}

async function handlePreviewRun(db: SupabaseAdmin, body: Record<string, unknown>): Promise<Response> {
  const batchSize = parseBatchSize(body.batchSize ?? body.batch_size);
  let cityId: string | undefined;
  if (typeof body.city === 'string' && body.city.trim().length > 0) {
    const resolved = await resolveCityId(db, body.city.trim());
    if (resolved.error) return json({ error: resolved.error }, 400);
    cityId = resolved.cityId;
  }
  const totalPlaces = await countPendingPlaces(db, { cityId });
  return json({
    status: totalPlaces > 0 ? 'ready' : 'nothing_to_do',
    batchSize,
    totalPlaces,
    totalBatches: Math.ceil(totalPlaces / batchSize),
    estimatedCostUsd: 0,
  });
}

async function createRunRecord(
  db: SupabaseAdmin,
  opts: { batchSize: number; cityId?: string; triggeredBy: string | null; cityLabel?: string },
): Promise<{ runId?: string; status: string; totalPlaces: number; totalBatches: number; error?: string }> {
  const eligiblePlaces = await loadPendingPlaces(db, { cityId: opts.cityId });
  if (eligiblePlaces.length === 0) {
    return { status: 'nothing_to_do', totalPlaces: 0, totalBatches: 0 };
  }

  const totalPlaces = eligiblePlaces.length;
  const totalBatches = Math.ceil(totalPlaces / opts.batchSize);
  // ORCH-1024 discriminator preserved: thumbs runs ALWAYS use city=RUN_CITY +
  // country=RUN_COUNTRY so the admin Photos panel filter keeps excluding them.
  // City scoping lives in city_id-filtered batches, NOT in the `city` column.
  const { data: run, error: runErr } = await db
    .from('photo_backfill_runs')
    .insert({
      city: RUN_CITY,
      country: RUN_COUNTRY,
      total_places: totalPlaces,
      total_batches: totalBatches,
      batch_size: opts.batchSize,
      estimated_cost_usd: 0,
      triggered_by: opts.triggeredBy,
      status: 'ready',
      mode: 'refresh_servable',
      last_heartbeat_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (runErr || !run) {
    return { status: 'error', totalPlaces: 0, totalBatches: 0, error: runErr?.message ?? 'Failed to create run' };
  }

  const batchRows = [];
  for (let i = 0; i < totalBatches; i++) {
    const chunk = eligiblePlaces.slice(i * opts.batchSize, (i + 1) * opts.batchSize);
    batchRows.push({
      run_id: run.id,
      batch_index: i,
      place_pool_ids: chunk.map((place) => place.id),
      place_count: chunk.length,
      status: 'pending',
    });
  }

  const { error: batchErr } = await db.from('photo_backfill_batches').insert(batchRows);
  if (batchErr) {
    await db.from('photo_backfill_runs').delete().eq('id', run.id);
    return { status: 'error', totalPlaces: 0, totalBatches: 0, error: batchErr.message };
  }

  return { runId: run.id, status: 'ready', totalPlaces, totalBatches };
}

/**
 * ORCH-1043 (A): fire a server-side process_chunk for `runId` via
 * EdgeRuntime.waitUntil (fire-and-forget; cron recovers on failure).
 */
function kickProcessChunk(runId: string): void {
  const selfUrl = `${
    Deno.env.get('SUPABASE_URL') ?? 'https://gqnoajqerqhnvulmnyvv.supabase.co'
  }/functions/v1/backfill-place-photo-thumbs`;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  try {
    // @ts-ignore — EdgeRuntime is a Supabase-provided global, not in @types
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(
        fetch(selfUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ action: 'process_chunk', runId }),
        }).catch((err) => {
          console.warn(`[thumb self-invoke] dispatch failed (cron will recover): ${err}`);
        }),
      );
    } else {
      console.warn('[thumb self-invoke] EdgeRuntime.waitUntil unavailable; cron will recover');
    }
  } catch (err) {
    console.warn(`[thumb self-invoke] error scheduling self-invoke (cron will recover): ${err}`);
  }
}

async function handleCreateRun(
  db: SupabaseAdmin,
  body: Record<string, unknown>,
  userId: string,
): Promise<Response> {
  const batchSize = parseBatchSize(body.batchSize ?? body.batch_size);

  let cityId: string | undefined;
  if (typeof body.city === 'string' && body.city.trim().length > 0) {
    const resolved = await resolveCityId(db, body.city.trim());
    if (resolved.error) return json({ error: resolved.error }, 400);
    cityId = resolved.cityId;
  }

  // At most one active thumbs run per (RUN_CITY, RUN_COUNTRY).
  const { data: existing } = await db
    .from('photo_backfill_runs')
    .select('id')
    .eq('city', RUN_CITY)
    .eq('country', RUN_COUNTRY)
    .in('status', ['ready', 'running', 'paused'])
    .limit(1)
    .maybeSingle();

  if (existing) {
    kickProcessChunk(existing.id); // make sure it's being driven server-side
    return json({ status: 'already_active', runId: existing.id });
  }

  const created = await createRunRecord(db, { batchSize, cityId, triggeredBy: userId });
  if (created.status === 'nothing_to_do') return json({ status: 'nothing_to_do', totalPlaces: 0 });
  if (created.status === 'error' || !created.runId) return json({ error: created.error ?? 'Failed to create run' }, 500);

  // ORCH-1043 (A): server-kick immediately so the run starts without waiting
  // for the next cron tick. The admin tab only POLLS run_status for display.
  kickProcessChunk(created.runId);

  return json({
    runId: created.runId,
    totalPlaces: created.totalPlaces,
    totalBatches: created.totalBatches,
    estimatedCostUsd: 0,
    status: 'ready',
  });
}

/**
 * Claim + process exactly one pending batch (the unit of progress). Returns the
 * batch result + whether any pending batch remained to claim.
 * ORCH-1043 (A): concurrency-safe claim — conditional UPDATE on status='pending'
 * + affected-rows check so two workers never double-process a batch.
 */
async function claimAndProcessNextBatch(
  db: SupabaseAdmin,
  runId: string,
): Promise<{ claimed: boolean; result?: BatchResult; batchStatus?: 'completed' | 'failed' | 'pending' }> {
  const { data: batch } = await db
    .from('photo_backfill_batches')
    .select('*')
    .eq('run_id', runId)
    .eq('status', 'pending')
    .order('batch_index', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!batch) return { claimed: false };

  // Conditional claim: only this worker may flip pending→running.
  const { data: claimedRows } = await db
    .from('photo_backfill_batches')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', batch.id)
    .eq('status', 'pending')
    .select('id');

  if (!claimedRows || claimedRows.length === 0) {
    // Another worker grabbed it first — treat as "claimed nothing this round".
    return { claimed: false };
  }

  const batchResult = await processBatch(db, batch.place_pool_ids ?? []);

  // ORCH-1044: if the CPU wall guard tripped mid-batch, the batch is NOT
  // finished. Return it to 'pending' (clear started_at) so the next invocation
  // re-claims + resumes it; do NOT write a terminal status and do NOT roll the
  // partial counters into the run (already-written thumbs are HEAD-skipped on
  // the re-run, so resuming is cheap and never double-counts). The caller
  // self-invokes because work remains.
  if (batchResult.partial) {
    await db
      .from('photo_backfill_batches')
      .update({ status: 'pending', started_at: null })
      .eq('id', batch.id);
    return { claimed: true, result: batchResult, batchStatus: 'pending' };
  }

  const batchStatus: 'completed' | 'failed' =
    batchResult.succeeded === 0 && batchResult.failed > 0 ? 'failed' : 'completed';

  await db
    .from('photo_backfill_batches')
    .update({
      status: batchStatus,
      succeeded: batchResult.succeeded,
      failed: batchResult.failed,
      skipped: batchResult.skipped,
      failed_places: batchResult.failedPlaces,
      error_message: batchStatus === 'failed' ? 'All places failed' : null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', batch.id);

  // Roll batch counters up to the run.
  const { data: freshRun } = await db
    .from('photo_backfill_runs')
    .select('completed_batches, failed_batches, skipped_batches, total_succeeded, total_failed, total_skipped, total_batches')
    .eq('id', runId)
    .single();

  if (freshRun) {
    const completedBatches = batchStatus === 'failed' ? freshRun.completed_batches : freshRun.completed_batches + 1;
    const failedBatches = batchStatus === 'failed' ? freshRun.failed_batches + 1 : freshRun.failed_batches;
    await db
      .from('photo_backfill_runs')
      .update({
        completed_batches: completedBatches,
        failed_batches: failedBatches,
        total_succeeded: freshRun.total_succeeded + batchResult.succeeded,
        total_failed: freshRun.total_failed + batchResult.failed,
        total_skipped: freshRun.total_skipped + batchResult.skipped,
      })
      .eq('id', runId);
  }

  return { claimed: true, result: batchResult, batchStatus };
}

export async function processBatch(
  db: SupabaseAdmin,
  placeIds: string[],
  opts: { nowMs?: () => number } = {},
): Promise<BatchResult> {
  // ORCH-1044: `nowMs` is injectable so the regression test can drive a mock
  // clock past CPU_WALL_GUARD_MS deterministically. Defaults to Date.now.
  const nowMs = opts.nowMs ?? Date.now;
  const batchStartMs = nowMs();

  const result: BatchResult = {
    succeeded: 0,
    failed: 0,
    skipped: 0,
    thumbsWritten: 0,
    thumbsAlreadyPresent: 0,
    failedPlaces: [],
    partial: false,
  };

  // Load every place in the batch (still no-thumb), then flatten ALL their
  // photos into one job list and drain it SERIALLY (PARALLEL_N=1) under the
  // CPU wall guard. ORCH-1044: a single invocation must do ≤ ~1.2 s wall of
  // CPU-bound work, then stop + self-invoke, so it never approaches the 2 s
  // CPU cap. Concurrency is gone (it only front-loads CPU on a 1-thread isolate).
  const places: PendingPlaceRow[] = [];
  for (const placeId of placeIds) {
    const { data: place, error } = await db
      .from('place_pool')
      .select('id, stored_photo_urls')
      .eq('id', placeId)
      .is('thumbs_backfilled_at', null)
      .maybeSingle();

    if (error) {
      result.failed++;
      result.failedPlaces.push({ placePoolId: placeId, error: error.message });
      continue;
    }
    if (!place) {
      result.skipped++;
      continue;
    }
    places.push(place as PendingPlaceRow);
  }

  // Build per-place job lists + track invalids.
  const perPlace = new Map<string, { jobs: PhotoJob[]; invalid: Array<{ url: string; error: string }> }>();
  for (const place of places) {
    perPlace.set(place.id, buildPhotoJobs(db, place));
  }

  // Per-place tally we fill as we drain jobs serially under the wall guard.
  const tally = new Map<string, { written: number; present: number; failures: Array<{ url: string; error: string }> }>();
  for (const place of places) tally.set(place.id, { written: 0, present: 0, failures: [] });

  // ORCH-1044 (LOCKED): drain photo jobs SERIALLY, checking the CPU wall guard
  // BEFORE starting each job. The moment wall ≥ CPU_WALL_GUARD_MS we stop
  // starting new jobs and flag the batch partial — remaining jobs are simply
  // left undone (their place will NOT get thumbs_backfilled_at; the batch is
  // returned to 'pending' by claimAndProcessNextBatch and resumed cheaply since
  // thumbExists HEAD-skips already-written thumbs).
  let guardTripped = false;
  for (const place of places) {
    if (guardTripped) break;
    const built = perPlace.get(place.id)!;
    const t = tally.get(place.id)!;
    for (const job of built.jobs) {
      if (nowMs() - batchStartMs >= CPU_WALL_GUARD_MS) {
        guardTripped = true;
        break;
      }
      const o = await runPhotoJob(db, job);
      if (o.status === 'written') t.written++;
      else if (o.status === 'present') t.present++;
      else t.failures.push({ url: o.url, error: o.error });
    }
  }

  if (guardTripped) {
    result.partial = true;
    console.log(
      `[backfill-place-photo-thumbs] CPU wall guard tripped at ${
        nowMs() - batchStartMs
      }ms (>=${CPU_WALL_GUARD_MS}); leaving batch pending for re-claim + self-invoke`,
    );
  }

  // Resolve each place: all-or-nothing → set thumbs_backfilled_at only when
  // EVERY one of its photo jobs ran (this round) AND none failed. If the guard
  // tripped before a place's jobs were fully drained, that place is neither
  // succeeded nor failed this round — it is left for the resumed batch.
  for (const place of places) {
    const built = perPlace.get(place.id)!;
    const t = tally.get(place.id)!;
    const failures = [...built.invalid, ...t.failures];
    result.thumbsWritten += t.written;
    result.thumbsAlreadyPresent += t.present;

    if (built.jobs.length === 0 && built.invalid.length === 0) {
      // No work for this place at all — skip regardless of guard.
      result.skipped++;
      continue;
    }

    const jobsRanForPlace = t.written + t.present + t.failures.length;
    const fullyDrained = jobsRanForPlace >= built.jobs.length;

    if (!fullyDrained) {
      // Guard stopped mid-place: leave it for the resumed batch (no terminal
      // tally, no thumbs_backfilled_at — preserves all-or-nothing).
      continue;
    }
    if (failures.length > 0) {
      result.failed++;
      result.failedPlaces.push({
        placePoolId: place.id,
        error: 'one_or_more_photos_failed',
        failedPhotos: failures,
      });
      continue;
    }

    const { error: updateError } = await db
      .from('place_pool')
      .update({ thumbs_backfilled_at: new Date().toISOString() })
      .eq('id', place.id);
    if (updateError) {
      result.failed++;
      result.failedPlaces.push({ placePoolId: place.id, error: updateError.message });
    } else {
      result.succeeded++;
    }
  }

  return result;
}

/**
 * ORCH-1044 (A): server-driven worker — SINGLE small unit per invocation, then
 * self-invoke. Service-role-only.
 *
 * Edge isolates enforce a 2 s CPU hard cap
 * (https://supabase.com/docs/guides/functions/limits). imagescript
 * decode/resize/encode is CPU-bound; do ONE small unit per invocation under
 * CPU_WALL_GUARD_MS, then self-invoke. NEVER reintroduce a multi-batch
 * wall-budget loop — it 546s (ORCH-1043 v34 did exactly that). The chain is:
 * each invocation processes (at most) one batch up to the CPU wall guard →
 * self-invokes → the next invocation continues. The pg_cron kicker (every
 * 10 min) is the backstop that re-kicks a stalled run AND reclaims orphaned
 * 'running' batches (ORCH-1044 migration, step (c)).
 */
export async function handleProcessChunk(db: SupabaseAdmin, body: Record<string, unknown>): Promise<Response> {
  const runId = body.runId as string;
  if (!runId) return json({ error: 'runId required' }, 400);

  const startedAtMs = Date.now();

  const { data: run, error: runErr } = await db
    .from('photo_backfill_runs')
    .select('*')
    .eq('id', runId)
    .single();
  if (runErr || !run) return json({ error: 'Run not found' }, 404);
  if (!['ready', 'running', 'paused'].includes(run.status)) {
    return json({ ok: true, runId, skipped: true, exitReason: `status=${run.status}` });
  }
  if (run.status === 'paused') {
    return json({ ok: true, runId, skipped: true, exitReason: 'paused' });
  }

  // Flip ready→running, stamp started_at + heartbeat (heartbeat set once at start).
  if (run.status !== 'running') {
    const updates: Record<string, unknown> = { status: 'running', last_heartbeat_at: new Date().toISOString() };
    if (!run.started_at) updates.started_at = new Date().toISOString();
    await db.from('photo_backfill_runs').update(updates).eq('id', runId);
  } else {
    await db.from('photo_backfill_runs').update({ last_heartbeat_at: new Date().toISOString() }).eq('id', runId);
  }

  let batchesProcessed = 0;
  let thumbsWritten = 0;
  let thumbsAlreadyPresent = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let partial = false;
  let done = false;
  let exitReason = 'unit_done';

  // ORCH-1044: re-check status once (operator may have paused/cancelled), then
  // process AT MOST one batch (PER_INVOCATION_BATCHES=1). No multi-batch loop.
  const { data: liveRun } = await db
    .from('photo_backfill_runs')
    .select('status')
    .eq('id', runId)
    .maybeSingle();
  if (!liveRun) {
    exitReason = 'run_vanished';
  } else if (liveRun.status === 'paused') {
    exitReason = 'paused';
  } else if (liveRun.status === 'cancelled') {
    exitReason = 'cancelled';
  } else {
    const step = await claimAndProcessNextBatch(db, runId);
    if (!step.claimed) {
      // No pending batch left to claim → run is complete.
      await db
        .from('photo_backfill_runs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', runId);
      done = true;
      exitReason = 'completed';
    } else {
      batchesProcessed++;
      if (step.result) {
        thumbsWritten += step.result.thumbsWritten;
        thumbsAlreadyPresent += step.result.thumbsAlreadyPresent;
        succeeded += step.result.succeeded;
        failed += step.result.failed;
        skipped += step.result.skipped;
        partial = step.result.partial;
      }
      exitReason = step.batchStatus === 'pending' ? 'guard_tripped_partial' : 'unit_done';
    }
  }

  // ORCH-1044: self-invoke if work remains AND the run is still running. A
  // guard-tripped batch was returned to 'pending', so it counts as remaining
  // work and the chain continues to drain it.
  if (!done) {
    const { data: chainRun } = await db
      .from('photo_backfill_runs')
      .select('status')
      .eq('id', runId)
      .maybeSingle();
    if (chainRun?.status === 'running') {
      const { data: pending } = await db
        .from('photo_backfill_batches')
        .select('id')
        .eq('run_id', runId)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle();
      if (pending) kickProcessChunk(runId);
    }
  }

  return json({
    ok: true,
    runId,
    batchesProcessed,
    thumbsWritten,
    thumbsAlreadyPresent,
    succeeded,
    failed,
    skipped,
    partial,
    done,
    exitReason,
    elapsedMs: Date.now() - startedAtMs,
  });
}

// triggered_by for cron-created auto runs. A cron tick has no human initiator and
// the all-zero uuid is NOT a real auth.users row (it violated the
// photo_backfill_runs_triggered_by_fkey FK → 500). Cron runs record NULL provenance;
// migration 20260816000000 drops the NOT NULL so NULL is accepted (FK ignores NULL).
const AUTO_RUN_TRIGGERED_BY: string | null = null;

/**
 * ORCH-1043 (D): service-role action the cron calls to (a) ensure a single
 * global servable thumbs run exists when there is a backlog, and (b) kick it.
 * Idempotent: no-op if an active run already exists.
 */
async function handleEnsureAutoRun(db: SupabaseAdmin): Promise<Response> {
  const { data: existing } = await db
    .from('photo_backfill_runs')
    .select('id, status')
    .eq('city', RUN_CITY)
    .eq('country', RUN_COUNTRY)
    .in('status', ['ready', 'running', 'paused'])
    .limit(1)
    .maybeSingle();

  if (existing) {
    if (existing.status !== 'paused') kickProcessChunk(existing.id);
    return json({ ok: true, status: 'already_active', runId: existing.id });
  }

  // No active run — create one over the GLOBAL servable backlog if any exists.
  const created = await createRunRecord(db, { batchSize: DEFAULT_BATCH_SIZE, triggeredBy: AUTO_RUN_TRIGGERED_BY });
  if (created.status === 'nothing_to_do') return json({ ok: true, status: 'nothing_to_do' });
  if (created.status === 'error' || !created.runId) return json({ error: created.error ?? 'auto run failed' }, 500);

  kickProcessChunk(created.runId);
  return json({ ok: true, status: 'created', runId: created.runId, totalPlaces: created.totalPlaces });
}

/**
 * RETAINED manual single-step (admin "Run one batch" debug affordance).
 * ORCH-1043: no longer the run engine — the admin tab does NOT loop this.
 */
async function handleRunNextBatch(db: SupabaseAdmin, body: Record<string, unknown>): Promise<Response> {
  const runId = body.runId as string;
  if (!runId) return json({ error: 'runId required' }, 400);

  const { data: run, error: runErr } = await db
    .from('photo_backfill_runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (runErr || !run) return json({ error: 'Run not found' }, 404);
  if (!['ready', 'running', 'paused'].includes(run.status)) {
    return json({ error: `Run is ${run.status}, cannot execute batches` }, 400);
  }

  if (run.status !== 'running') {
    const updates: Record<string, unknown> = { status: 'running' };
    if (!run.started_at) updates.started_at = new Date().toISOString();
    await db.from('photo_backfill_runs').update(updates).eq('id', runId);
  }

  const step = await claimAndProcessNextBatch(db, runId);
  if (!step.claimed) {
    await db
      .from('photo_backfill_runs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', runId);
    return json({ done: true });
  }

  return json({ done: false, ...(step.result ?? {}) });
}

async function handleRunStatus(db: SupabaseAdmin, body: Record<string, unknown>): Promise<Response> {
  const runId = body.runId as string;
  if (!runId) return json({ error: 'runId required' }, 400);

  const { data: run, error: runErr } = await db
    .from('photo_backfill_runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (runErr || !run) return json({ error: 'Run not found' }, 404);

  const { data: batches } = await db
    .from('photo_backfill_batches')
    .select('*')
    .eq('run_id', runId)
    .order('batch_index', { ascending: true });

  const remainingPlaces = await countPendingPlaces(db);
  return json({ run, batches: batches ?? [], remainingPlaces });
}

async function handleActiveRuns(db: SupabaseAdmin): Promise<Response> {
  const { data: runs, error } = await db
    .from('photo_backfill_runs')
    .select('*')
    .eq('city', RUN_CITY)
    .eq('country', RUN_COUNTRY)
    .in('status', ['ready', 'running', 'paused'])
    .order('created_at', { ascending: false });

  if (error) return json({ error: error.message }, 500);
  return json({ runs: runs ?? [] });
}

async function updateRunStatus(
  db: SupabaseAdmin,
  body: Record<string, unknown>,
  status: 'paused' | 'cancelled' | 'running',
): Promise<Response> {
  const runId = body.runId as string;
  if (!runId) return json({ error: 'runId required' }, 400);
  const patch: Record<string, unknown> = { status };
  if (status === 'cancelled') patch.completed_at = new Date().toISOString();
  if (status === 'running') patch.last_heartbeat_at = new Date().toISOString();
  const { error } = await db.from('photo_backfill_runs').update(patch).eq('id', runId);
  if (error) return json({ error: error.message }, 500);
  // ORCH-1043: resume re-kicks the server-driven chain.
  if (status === 'running') kickProcessChunk(runId);
  return json({ runId, status });
}

async function handleRetryBatch(db: SupabaseAdmin, body: Record<string, unknown>): Promise<Response> {
  const batchId = body.batchId as string;
  if (!batchId) return json({ error: 'batchId required' }, 400);
  const { error } = await db
    .from('photo_backfill_batches')
    .update({
      status: 'pending',
      succeeded: 0,
      failed: 0,
      skipped: 0,
      error_message: null,
      failed_places: [],
      started_at: null,
      completed_at: null,
    })
    .eq('id', batchId);
  if (error) return json({ error: error.message }, 500);
  return json({ batchId, status: 'pending' });
}

async function handleSkipBatch(db: SupabaseAdmin, body: Record<string, unknown>): Promise<Response> {
  const batchId = body.batchId as string;
  if (!batchId) return json({ error: 'batchId required' }, 400);
  const { error } = await db
    .from('photo_backfill_batches')
    .update({ status: 'skipped', completed_at: new Date().toISOString() })
    .eq('id', batchId);
  if (error) return json({ error: error.message }, 500);
  return json({ batchId, status: 'skipped' });
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json().catch(() => ({}));

    if (!body.action) {
      return json({ error: "Missing 'action'. Use action='preview_run', 'create_run', 'run_next_batch', etc." }, 400);
    }

    // ORCH-1043 (A): process_chunk + ensure_auto_run are service-role-only
    // (called by pg_cron via pg_net and by the create_run/resume self-invoke).
    // Skip the user-auth gate; require a service-role bearer match instead.
    if (body.action === 'process_chunk' || body.action === 'ensure_auto_run') {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Missing authorization' }, 401);
      }
      const token = authHeader.replace('Bearer ', '');
      if (!supabaseServiceKey || token !== supabaseServiceKey) {
        return json({ error: `${body.action} requires service-role auth` }, 403);
      }
      return body.action === 'process_chunk'
        ? await handleProcessChunk(supabaseAdmin, body)
        : await handleEnsureAutoRun(supabaseAdmin);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return json({ error: 'Missing authorization' }, 401);
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return json({ error: 'Invalid token' }, 401);
    }

    const { data: adminRow } = await supabaseAdmin
      .from('admin_users')
      .select('id')
      .eq('email', user.email)
      .eq('status', 'active')
      .maybeSingle();
    if (!adminRow) {
      return json({ error: 'Admin access required' }, 403);
    }

    switch (body.action) {
      case 'preview_run':
        return await handlePreviewRun(supabaseAdmin, body);
      case 'create_run':
        return await handleCreateRun(supabaseAdmin, body, user.id);
      case 'run_next_batch':
        return await handleRunNextBatch(supabaseAdmin, body);
      case 'run_status':
        return await handleRunStatus(supabaseAdmin, body);
      case 'active_runs':
        return await handleActiveRuns(supabaseAdmin);
      case 'pause_run':
        return await updateRunStatus(supabaseAdmin, body, 'paused');
      case 'resume_run':
        return await updateRunStatus(supabaseAdmin, body, 'running');
      case 'cancel_run':
        return await updateRunStatus(supabaseAdmin, body, 'cancelled');
      case 'retry_batch':
        return await handleRetryBatch(supabaseAdmin, body);
      case 'skip_batch':
        return await handleSkipBatch(supabaseAdmin, body);
      default:
        return json({ error: `Unknown action: ${body.action}` }, 400);
    }
  } catch (err) {
    console.error('[backfill-place-photo-thumbs] Error:', err);
    return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
}

if (import.meta.main) {
  serve(handler);
}
