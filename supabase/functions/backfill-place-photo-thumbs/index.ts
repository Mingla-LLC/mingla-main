import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Image, decode } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const BUCKET = 'place-photos';
const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
const THUMB_SIZE = 384;
const THUMB_JPEG_QUALITY = 80;
const INTER_PHOTO_DELAY_MS = 100;
const INTER_PLACE_DELAY_MS = 500;
const RUN_CITY = 'ORCH-0957 place-photo thumbs';
const RUN_COUNTRY = 'GLOBAL';

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export async function processPlaceThumbs(
  db: SupabaseAdmin,
  place: PendingPlaceRow,
  options: { skipDelays?: boolean } = {},
): Promise<ProcessPlaceResult> {
  const urls = Array.isArray(place.stored_photo_urls)
    ? place.stored_photo_urls.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    : [];

  if (urls.length === 0) {
    return { success: false, skipped: true, thumbsWritten: 0, thumbsAlreadyPresent: 0, failedPhotos: [] };
  }

  let thumbsWritten = 0;
  let thumbsAlreadyPresent = 0;
  const failedPhotos: Array<{ url: string; error: string }> = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const objectPath = extractPlacePhotoObjectPath(url);
    const thumbPath = objectPath ? buildThumbPathFromObjectPath(objectPath) : null;
    if (!objectPath || !thumbPath) {
      failedPhotos.push({ url, error: 'invalid_place_photo_url' });
      continue;
    }

    const { data: thumbUrlData } = db.storage.from(BUCKET).getPublicUrl(thumbPath);
    const thumbPublicUrl = thumbUrlData?.publicUrl;
    if (!thumbPublicUrl) {
      failedPhotos.push({ url, error: 'thumb_public_url_missing' });
      continue;
    }

    if (await thumbExists(thumbPublicUrl)) {
      thumbsAlreadyPresent++;
      continue;
    }

    try {
      const originalBytes = await fetchOriginalBytes(normalizeObjectPublicUrl(url));
      const thumbBytes = await encodeThumb(originalBytes);
      const { error: uploadError } = await db.storage
        .from(BUCKET)
        .upload(thumbPath, thumbBytes, {
          contentType: 'image/jpeg',
          upsert: true,
          cacheControl: '31536000',
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }
      thumbsWritten++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[backfill-place-photo-thumbs] photo failed for place ${place.id}:`, message);
      failedPhotos.push({ url, error: message });
    }

    if (!options.skipDelays && i < urls.length - 1) {
      await delay(INTER_PHOTO_DELAY_MS);
    }
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

async function loadPendingPlaces(
  db: SupabaseAdmin,
  limit?: number,
): Promise<PendingPlaceRow[]> {
  const pageSize = 1000;
  const out: PendingPlaceRow[] = [];
  let offset = 0;

  while (true) {
    const query = db
      .from('place_pool')
      .select('id, stored_photo_urls')
      .is('thumbs_backfilled_at', null)
      .not('stored_photo_urls', 'is', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const rows = ((data ?? []) as PendingPlaceRow[])
      .filter((row) => Array.isArray(row.stored_photo_urls) && row.stored_photo_urls.length > 0);
    out.push(...rows);

    if (limit && out.length >= limit) return out.slice(0, limit);
    if (!data || data.length < pageSize) break;
    offset += pageSize;
  }

  return out;
}

async function countPendingPlaces(db: SupabaseAdmin): Promise<number> {
  const rows = await loadPendingPlaces(db);
  return rows.length;
}

async function handlePreviewRun(db: SupabaseAdmin, body: Record<string, unknown>): Promise<Response> {
  const batchSize = parseBatchSize(body.batchSize ?? body.batch_size);
  const totalPlaces = await countPendingPlaces(db);
  return json({
    status: totalPlaces > 0 ? 'ready' : 'nothing_to_do',
    batchSize,
    totalPlaces,
    totalBatches: Math.ceil(totalPlaces / batchSize),
    estimatedCostUsd: 0,
  });
}

async function handleCreateRun(
  db: SupabaseAdmin,
  body: Record<string, unknown>,
  userId: string,
): Promise<Response> {
  const batchSize = parseBatchSize(body.batchSize ?? body.batch_size);
  const city = typeof body.city === 'string' && body.city.length > 0 ? body.city : RUN_CITY;
  const country = typeof body.country === 'string' && body.country.length > 0 ? body.country : RUN_COUNTRY;

  const { data: existing } = await db
    .from('photo_backfill_runs')
    .select('id')
    .eq('city', city)
    .eq('country', country)
    .in('status', ['ready', 'running', 'paused'])
    .limit(1)
    .maybeSingle();

  if (existing) {
    return json({ status: 'already_active', runId: existing.id });
  }

  const eligiblePlaces = await loadPendingPlaces(db);
  if (eligiblePlaces.length === 0) {
    return json({ status: 'nothing_to_do', totalPlaces: 0 });
  }

  const totalPlaces = eligiblePlaces.length;
  const totalBatches = Math.ceil(totalPlaces / batchSize);
  const { data: run, error: runErr } = await db
    .from('photo_backfill_runs')
    .insert({
      city,
      country,
      total_places: totalPlaces,
      total_batches: totalBatches,
      batch_size: batchSize,
      estimated_cost_usd: 0,
      triggered_by: userId,
      status: 'ready',
      mode: 'refresh_servable',
    })
    .select('id')
    .single();

  if (runErr || !run) {
    return json({ error: runErr?.message ?? 'Failed to create run' }, 500);
  }

  const batchRows = [];
  for (let i = 0; i < totalBatches; i++) {
    const chunk = eligiblePlaces.slice(i * batchSize, (i + 1) * batchSize);
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
    return json({ error: batchErr.message }, 500);
  }

  return json({ runId: run.id, totalPlaces, totalBatches, estimatedCostUsd: 0, status: 'ready' });
}

async function processBatch(
  db: SupabaseAdmin,
  placeIds: string[],
): Promise<BatchResult> {
  const result: BatchResult = {
    succeeded: 0,
    failed: 0,
    skipped: 0,
    thumbsWritten: 0,
    thumbsAlreadyPresent: 0,
    failedPlaces: [],
  };

  for (let i = 0; i < placeIds.length; i++) {
    const placeId = placeIds[i];
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

    const placeResult = await processPlaceThumbs(db, place as PendingPlaceRow);
    result.thumbsWritten += placeResult.thumbsWritten;
    result.thumbsAlreadyPresent += placeResult.thumbsAlreadyPresent;

    if (placeResult.success) result.succeeded++;
    else if (placeResult.skipped) result.skipped++;
    else {
      result.failed++;
      result.failedPlaces.push({
        placePoolId: placeId,
        error: 'one_or_more_photos_failed',
        failedPhotos: placeResult.failedPhotos,
      });
    }

    if (i < placeIds.length - 1) {
      await delay(INTER_PLACE_DELAY_MS);
    }
  }

  return result;
}

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

  const { data: batch } = await db
    .from('photo_backfill_batches')
    .select('*')
    .eq('run_id', runId)
    .eq('status', 'pending')
    .order('batch_index', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!batch) {
    await db
      .from('photo_backfill_runs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', runId);
    return json({ done: true });
  }

  await db
    .from('photo_backfill_batches')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', batch.id);

  const batchResult = await processBatch(db, batch.place_pool_ids ?? []);
  const batchStatus = batchResult.succeeded === 0 && batchResult.failed > 0 ? 'failed' : 'completed';

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

  const { data: freshRun } = await db
    .from('photo_backfill_runs')
    .select('completed_batches, failed_batches, skipped_batches, total_succeeded, total_failed, total_skipped, total_batches')
    .eq('id', runId)
    .single();

  if (!freshRun) {
    return json({ ...batchResult, batchId: batch.id, batchIndex: batch.batch_index, done: false });
  }

  const completedBatches = batchStatus === 'failed' ? freshRun.completed_batches : freshRun.completed_batches + 1;
  const failedBatches = batchStatus === 'failed' ? freshRun.failed_batches + 1 : freshRun.failed_batches;
  const allBatchesDone = (completedBatches + failedBatches + freshRun.skipped_batches) >= freshRun.total_batches;

  const runUpdate: Record<string, unknown> = {
    completed_batches: completedBatches,
    failed_batches: failedBatches,
    total_succeeded: freshRun.total_succeeded + batchResult.succeeded,
    total_failed: freshRun.total_failed + batchResult.failed,
    total_skipped: freshRun.total_skipped + batchResult.skipped,
  };
  if (allBatchesDone) {
    runUpdate.status = 'completed';
    runUpdate.completed_at = new Date().toISOString();
  }

  await db.from('photo_backfill_runs').update(runUpdate).eq('id', runId);

  return json({
    batchId: batch.id,
    batchIndex: batch.batch_index,
    ...batchResult,
    done: allBatchesDone,
    runProgress: {
      completedBatches,
      totalBatches: freshRun.total_batches,
      totalSucceeded: runUpdate.total_succeeded,
      totalFailed: runUpdate.total_failed,
    },
  });
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
  const { error } = await db.from('photo_backfill_runs').update(patch).eq('id', runId);
  if (error) return json({ error: error.message }, 500);
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
