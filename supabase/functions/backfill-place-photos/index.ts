import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { downloadAndStorePhotos } from '../_shared/photoStorageService.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const COST_PER_PLACE = 0.035; // 5 photos × $0.007

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? '';

    if (!apiKey) return json({ error: 'GOOGLE_MAPS_API_KEY not configured' }, 500);

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));

    // ── No action field → legacy path (backward compatibility) ────────────
    if (!body.action) {
      return handleLegacy(supabaseAdmin, body, apiKey);
    }

    // ── Auth: all action-based requests require admin ─────────────────────
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

    // ── Action dispatch ───────────────────────────────────────────────────
    switch (body.action) {
      case 'preview_run':
        return handlePreviewRun(supabaseAdmin, body);
      case 'create_run':
        return handleCreateRun(supabaseAdmin, body, user.id);
      case 'run_next_batch':
        return handleRunNextBatch(supabaseAdmin, body, apiKey);
      case 'run_status':
        return handleRunStatus(supabaseAdmin, body);
      case 'active_runs':
        return handleActiveRuns(supabaseAdmin);
      case 'cancel_run':
        return handleCancelRun(supabaseAdmin, body);
      case 'pause_run':
        return handlePauseRun(supabaseAdmin, body);
      case 'resume_run':
        return handleResumeRun(supabaseAdmin, body);
      case 'retry_batch':
        return handleRetryBatch(supabaseAdmin, body, apiKey);
      case 'skip_batch':
        return handleSkipBatch(supabaseAdmin, body);
      default:
        return json({ error: `Unknown action: ${body.action}` }, 400);
    }
  } catch (err) {
    console.error('[backfill-place-photos] Error:', err);
    return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Legacy path — original behavior, no action field
// ═══════════════════════════════════════════════════════════════════════════

async function handleLegacy(
  supabaseAdmin: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  apiKey: string,
): Promise<Response> {
  const batchSize = Math.min(Number(body.batchSize) || 50, 200);
  const dryRun = body.dryRun === true;

  const { data: places, error: queryError } = await supabaseAdmin
    .rpc('get_places_needing_photos', { p_batch_size: batchSize });

  if (queryError) {
    console.error('[backfill-place-photos] Query error:', queryError);
    return json({ error: queryError.message }, 500);
  }

  const { data: countResult } = await supabaseAdmin.rpc('count_places_needing_photos');
  const totalRemaining = countResult ?? 0;

  if (dryRun) {
    return json({
      success: true, dryRun: true, batchSize,
      candidatesInBatch: places?.length ?? 0,
      totalRemaining,
    });
  }

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const place of (places ?? [])) {
    try {
      const photoMeta = Array.isArray(place.photos) ? place.photos : [];
      if (photoMeta.length === 0) { skipped++; continue; }

      const storedUrls = await downloadAndStorePhotos(
        supabaseAdmin, place.google_place_id, photoMeta, apiKey
      );

      if (storedUrls && storedUrls.length > 0) {
        // ORCH-0640: card_pool update block REMOVED. place_pool.stored_photo_urls
        // is the sole photo authority (I-POOL-ONLY-SERVING); card_pool is dropped.
        succeeded++;
      } else {
        await supabaseAdmin
          .from('place_pool')
          .update({ stored_photo_urls: ['__backfill_failed__'] })
          .eq('google_place_id', place.google_place_id);
        failed++;
      }
    } catch (err) {
      console.error(`[backfill-place-photos] Error processing ${place.google_place_id}:`,
        err instanceof Error ? err.message : String(err));
      await supabaseAdmin
        .from('place_pool')
        .update({ stored_photo_urls: ['__backfill_failed__'] })
        .eq('google_place_id', place.google_place_id);
      failed++;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  return json({
    success: true,
    processed: (places?.length ?? 0),
    succeeded, failed, skipped,
    remaining: totalRemaining - succeeded,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Action handlers
// ═══════════════════════════════════════════════════════════════════════════

// ── create_run ────────────────────────────────────────────────────────────

// ORCH-0598.11: I-PHOTO-FILTER-EXPLICIT — exactly two named modes.
//   'initial'           — first-time city setup; filter ai_approved=true AND no real photos
//   'refresh_servable'  — Bouncer-approved maintenance; filter is_servable=true (no photo prereq)
type BackfillMode = 'initial' | 'refresh_servable';

function parseBackfillMode(raw: unknown): BackfillMode {
  return raw === 'refresh_servable' ? 'refresh_servable' : 'initial';
}

interface CityPlaceRow {
  id: string;
  google_place_id?: string | null;
  photos?: unknown;
  stored_photo_urls?: string[] | null;
  is_servable?: boolean | null;  // ORCH-0640: replaces ai_approved
  is_servable?: boolean | null;
}

interface RunPreviewAnalysis {
  totalPlaces: number;
  approvedPlaces: number;
  withRealPhotos: number;
  withoutStoredPhotos: number;
  failedPlaces: number;
  eligiblePlaces: number;
  blockedByAiApproval: number;
  blockedByNotServable: number;
  blockedByMissingPhotoMetadata: number;
  blockedByMissingGooglePlaceId: number;
  mode: BackfillMode;
}

function getStoredPhotoState(urls: string[] | null | undefined): 'missing' | 'failed' | 'real' {
  if (!Array.isArray(urls) || urls.length === 0) return 'missing';

  const nonEmptyUrls = urls
    .filter((url): url is string => typeof url === 'string')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

  if (nonEmptyUrls.length === 0) return 'missing';
  if (nonEmptyUrls.length === 1 && nonEmptyUrls[0] === '__backfill_failed__') return 'failed';
  return 'real';
}

// ORCH-0598.11: mode-aware eligibility analysis.
//   'initial'          — original behavior: ai_approved=true AND lacks real photos.
//                        Used for first-time city setup. Skips places that already
//                        have photos. ai_approved is the gate.
//   'refresh_servable' — Bouncer-approved maintenance: is_servable=true. Re-fetches
//                        photos for the Bouncer-passed set regardless of current
//                        photo state (admin can intentionally re-download).
function buildRunPreview(places: CityPlaceRow[], mode: BackfillMode) {
  const analysis: RunPreviewAnalysis = {
    totalPlaces: places.length,
    approvedPlaces: 0,
    withRealPhotos: 0,
    withoutStoredPhotos: 0,
    failedPlaces: 0,
    eligiblePlaces: 0,
    blockedByAiApproval: 0,
    blockedByNotServable: 0,
    blockedByMissingPhotoMetadata: 0,
    blockedByMissingGooglePlaceId: 0,
    mode,
  };
  const eligiblePlaces: CityPlaceRow[] = [];

  for (const place of places) {
    // ORCH-0640 ch06: ai_approved replaced by is_servable (Phase-5 retirement per
    // run-bouncer:7 + DEC-043). Bouncer is the one quality gate.
    if (place.is_servable === true) analysis.approvedPlaces++;
    const storedState = getStoredPhotoState(place.stored_photo_urls);

    if (mode === 'initial') {
      // INITIAL: skip places that already have real photos
      if (storedState === 'real') {
        analysis.withRealPhotos++;
        continue;
      }
      analysis.withoutStoredPhotos++;
      if (storedState === 'failed') analysis.failedPlaces++;

      if (place.is_servable !== true) {
        analysis.blockedByAiApproval++;  // field name kept for backward compat in report
        continue;
      }
    } else {
      // REFRESH_SERVABLE: include all is_servable=true places, regardless of photo state.
      // Track photo state for reporting only.
      if (storedState === 'real') analysis.withRealPhotos++;
      else if (storedState === 'failed') analysis.failedPlaces++;
      else analysis.withoutStoredPhotos++;

      if (place.is_servable !== true) {
        analysis.blockedByNotServable++;
        continue;
      }
    }

    // Common gates for both modes
    if (!place.google_place_id) {
      analysis.blockedByMissingGooglePlaceId++;
      continue;
    }

    const photos = Array.isArray(place.photos) ? place.photos : [];
    if (photos.length === 0) {
      analysis.blockedByMissingPhotoMetadata++;
      continue;
    }

    eligiblePlaces.push(place);
  }

  analysis.eligiblePlaces = eligiblePlaces.length;
  return { analysis, eligiblePlaces };
}

async function loadCityPlacesForRun(
  db: ReturnType<typeof createClient>,
  cityId: string,
  mode: BackfillMode,
): Promise<{ places: CityPlaceRow[]; analysis: RunPreviewAnalysis; eligiblePlaces: CityPlaceRow[] }> {
  // PostgREST caps results at 1000 rows (project default). Paginate to get all.
  // ORCH-0598.11: include is_servable in SELECT — needed for refresh_servable mode.
  const PAGE_SIZE = 1000;
  const allPlaces: CityPlaceRow[] = [];
  let offset = 0;

  while (true) {
    const { data: page, error: pageErr } = await db
      .from('place_pool')
      .select('id, google_place_id, photos, stored_photo_urls, is_servable')
      .eq('is_active', true)
      .eq('city_id', cityId)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (pageErr) {
      console.error('[backfill-place-photos] city run query error:', pageErr);
      throw new Error(pageErr.message);
    }

    const rows = (page ?? []) as CityPlaceRow[];
    allPlaces.push(...rows);

    if (rows.length < PAGE_SIZE) break; // last page
    offset += PAGE_SIZE;
  }

  const preview = buildRunPreview(allPlaces, mode);
  return { places: allPlaces, ...preview };
}

async function handlePreviewRun(
  db: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const cityId = body.cityId as string;
  if (!cityId) return json({ error: 'cityId required' }, 400);

  const batchSize = Math.min(Math.max(Number(body.batchSize) || 10, 1), 20);
  const mode = parseBackfillMode(body.mode);

  try {
    const { analysis } = await loadCityPlacesForRun(db, cityId, mode);
    const totalBatches = Math.ceil(analysis.eligiblePlaces / batchSize);
    const estimatedCostUsd = +(analysis.eligiblePlaces * COST_PER_PLACE).toFixed(4);

    return json({
      status: analysis.eligiblePlaces > 0 ? 'ready' : 'nothing_to_do',
      batchSize,
      mode,
      totalPlaces: analysis.eligiblePlaces,
      totalBatches,
      estimatedCostUsd,
      analysis,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed to preview run' }, 500);
  }
}

async function handleCreateRun(
  db: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  userId: string,
): Promise<Response> {
  const cityId = body.cityId as string;
  const city = body.city as string;
  const country = body.country as string;
  if (!cityId || !city || !country) return json({ error: 'cityId, city and country required' }, 400);

  const batchSize = Math.min(Math.max(Number(body.batchSize) || 10, 1), 20);
  const mode = parseBackfillMode(body.mode);

  // Check for existing active run for same city (text labels in photo_backfill_runs)
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

  let eligiblePlaces: CityPlaceRow[] = [];
  let analysis: RunPreviewAnalysis;
  try {
    const preview = await loadCityPlacesForRun(db, cityId, mode);
    eligiblePlaces = preview.eligiblePlaces;
    analysis = preview.analysis;
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed to load run candidates' }, 500);
  }

  if (eligiblePlaces.length === 0) {
    return json({ status: 'nothing_to_do', totalPlaces: 0, analysis });
  }

  const totalPlaces = eligiblePlaces.length;
  const totalBatches = Math.ceil(totalPlaces / batchSize);
  const estimatedCostUsd = +(totalPlaces * COST_PER_PLACE).toFixed(4);

  // Insert run — ORCH-0598.11: persist mode so handleRunNextBatch knows which
  // eligibility rule the run was created under (defensive — used by tester +
  // status display).
  const { data: run, error: runErr } = await db
    .from('photo_backfill_runs')
    .insert({
      city,
      country,
      total_places: totalPlaces,
      total_batches: totalBatches,
      batch_size: batchSize,
      estimated_cost_usd: estimatedCostUsd,
      triggered_by: userId,
      status: 'ready',
      mode,
    })
    .select('id')
    .single();

  if (runErr || !run) {
    console.error('[backfill-place-photos] create_run insert error:', runErr);
    return json({ error: runErr?.message ?? 'Failed to create run' }, 500);
  }

  // Insert batches
  const batchRows = [];
  for (let i = 0; i < totalBatches; i++) {
    const chunk = eligiblePlaces.slice(i * batchSize, (i + 1) * batchSize);
    batchRows.push({
      run_id: run.id,
      batch_index: i,
      place_pool_ids: chunk.map((p: { id: string }) => p.id),
      place_count: chunk.length,
      status: 'pending',
    });
  }

  const { error: batchErr } = await db
    .from('photo_backfill_batches')
    .insert(batchRows);

  if (batchErr) {
    console.error('[backfill-place-photos] create_run batch insert error:', batchErr);
    // Clean up the run
    await db.from('photo_backfill_runs').delete().eq('id', run.id);
    return json({ error: batchErr.message }, 500);
  }

  return json({
    runId: run.id,
    totalPlaces,
    totalBatches,
    estimatedCostUsd,
    status: 'ready',
    analysis,
  });
}

// ── run_next_batch ────────────────────────────────────────────────────────

async function handleRunNextBatch(
  db: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  apiKey: string,
): Promise<Response> {
  const runId = body.runId as string;
  if (!runId) return json({ error: 'runId required' }, 400);

  // Load run
  const { data: run, error: runErr } = await db
    .from('photo_backfill_runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (runErr || !run) return json({ error: 'Run not found' }, 404);
  if (!['ready', 'running', 'paused'].includes(run.status)) {
    return json({ error: `Run is ${run.status}, cannot execute batches` }, 400);
  }

  // Set run to running if not already
  if (run.status !== 'running') {
    const updates: Record<string, unknown> = { status: 'running' };
    if (!run.started_at) updates.started_at = new Date().toISOString();
    await db.from('photo_backfill_runs').update(updates).eq('id', runId);
  }

  // Stale batch detection: mark batches stuck in 'running' for >5 minutes as failed
  const { data: staleBatches } = await db
    .from('photo_backfill_batches')
    .select('id')
    .eq('run_id', runId)
    .eq('status', 'running')
    .lt('started_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());

  if (staleBatches && staleBatches.length > 0) {
    for (const stale of staleBatches) {
      await db
        .from('photo_backfill_batches')
        .update({
          status: 'failed',
          error_message: 'Timed out (stuck >5 minutes)',
          completed_at: new Date().toISOString(),
        })
        .eq('id', stale.id);

      await db
        .from('photo_backfill_runs')
        .update({ failed_batches: (run.failed_batches ?? 0) + 1 })
        .eq('id', runId);
    }
  }

  // Find next pending batch
  const { data: batch } = await db
    .from('photo_backfill_batches')
    .select('*')
    .eq('run_id', runId)
    .eq('status', 'pending')
    .order('batch_index', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!batch) {
    // No pending batches — complete the run
    await db
      .from('photo_backfill_runs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', runId);
    return json({ done: true });
  }

  // Set batch to running
  await db
    .from('photo_backfill_batches')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', batch.id);

  // Process batch
  const result = await processBatch(db, batch, apiKey);

  // Update batch status
  const batchStatus = result.succeeded === 0 && result.failed > 0 ? 'failed' : 'completed';
  await db
    .from('photo_backfill_batches')
    .update({
      status: batchStatus,
      succeeded: result.succeeded,
      failed: result.failed,
      skipped: result.skipped,
      failed_places: result.failedPlaces,
      error_message: batchStatus === 'failed' ? 'All places failed' : null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', batch.id);

  // Update run counters
  const counterField = batchStatus === 'failed' ? 'failed_batches' : 'completed_batches';
  // Re-read run for latest counters (avoid stale data from earlier read)
  const { data: freshRun } = await db
    .from('photo_backfill_runs')
    .select('completed_batches, failed_batches, total_succeeded, total_failed, total_skipped, actual_cost_usd, total_batches, skipped_batches')
    .eq('id', runId)
    .single();

  if (freshRun) {
    const newCompleted = batchStatus === 'failed' ? freshRun.completed_batches : freshRun.completed_batches + 1;
    const newFailed = batchStatus === 'failed' ? freshRun.failed_batches + 1 : freshRun.failed_batches;
    const newTotalSucceeded = freshRun.total_succeeded + result.succeeded;
    const newTotalFailed = freshRun.total_failed + result.failed;
    const newTotalSkipped = freshRun.total_skipped + result.skipped;
    const newActualCost = +(Number(freshRun.actual_cost_usd) + result.succeeded * COST_PER_PLACE).toFixed(4);
    const allBatchesDone = (newCompleted + newFailed + freshRun.skipped_batches) >= freshRun.total_batches;

    const runUpdate: Record<string, unknown> = {
      completed_batches: newCompleted,
      failed_batches: newFailed,
      total_succeeded: newTotalSucceeded,
      total_failed: newTotalFailed,
      total_skipped: newTotalSkipped,
      actual_cost_usd: newActualCost,
    };
    if (allBatchesDone) {
      runUpdate.status = 'completed';
      runUpdate.completed_at = new Date().toISOString();
    }

    await db.from('photo_backfill_runs').update(runUpdate).eq('id', runId);

    return json({
      batchId: batch.id,
      batchIndex: batch.batch_index,
      succeeded: result.succeeded,
      failed: result.failed,
      skipped: result.skipped,
      failedPlaces: result.failedPlaces,
      done: allBatchesDone,
      runProgress: {
        completedBatches: newCompleted,
        totalBatches: freshRun.total_batches,
        totalSucceeded: newTotalSucceeded,
        totalFailed: newTotalFailed,
      },
    });
  }

  return json({
    batchId: batch.id,
    batchIndex: batch.batch_index,
    succeeded: result.succeeded,
    failed: result.failed,
    skipped: result.skipped,
    failedPlaces: result.failedPlaces,
    done: false,
    runProgress: null,
  });
}

// ── Shared batch processing logic ─────────────────────────────────────────

interface BatchResult {
  succeeded: number;
  failed: number;
  skipped: number;
  failedPlaces: Array<{ placePoolId: string; googlePlaceId: string; error: string }>;
}

async function processBatch(
  db: ReturnType<typeof createClient>,
  batch: { place_pool_ids: string[] },
  apiKey: string,
): Promise<BatchResult> {
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const failedPlaces: BatchResult['failedPlaces'] = [];

  for (let i = 0; i < batch.place_pool_ids.length; i++) {
    const placeId = batch.place_pool_ids[i];

    try {
      // ORCH-0640 ch06: check if still eligible — Bouncer-approved (is_servable) replaces ai_approved.
      const { data: place } = await db
        .from('place_pool')
        .select('id, google_place_id, photos, stored_photo_urls')
        .eq('id', placeId)
        .eq('is_active', true)
        .eq('is_servable', true)
        .maybeSingle();

      if (!place) {
        // Place deleted, deactivated, or Bouncer-rejected since run creation
        skipped++;
        continue;
      }

      // Check if place already has photos (processed between run creation and now)
      const urls = place.stored_photo_urls;
      if (urls && urls.length > 0 && !(urls.length === 1 && urls[0] === '__backfill_failed__')) {
        skipped++;
        continue;
      }

      // Check photo metadata
      const photoMeta = Array.isArray(place.photos) ? place.photos : [];
      if (photoMeta.length === 0) {
        skipped++;
        continue;
      }

      // Download and store
      const storedUrls = await downloadAndStorePhotos(
        db, place.google_place_id, photoMeta, apiKey
      );

      if (storedUrls && storedUrls.length > 0) {
        // ORCH-0640: card_pool update block REMOVED. place_pool.stored_photo_urls
        // is the sole photo authority (I-POOL-ONLY-SERVING); card_pool is dropped.
        succeeded++;
      } else {
        // All photos failed
        await db
          .from('place_pool')
          .update({ stored_photo_urls: ['__backfill_failed__'] })
          .eq('id', place.id);
        failedPlaces.push({
          placePoolId: place.id,
          googlePlaceId: place.google_place_id,
          error: 'All photo downloads failed',
        });
        failed++;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[backfill-place-photos] Error processing place ${placeId}:`, errMsg);

      // Mark as failed
      await db
        .from('place_pool')
        .update({ stored_photo_urls: ['__backfill_failed__'] })
        .eq('id', placeId);
      failedPlaces.push({
        placePoolId: placeId,
        googlePlaceId: 'unknown',
        error: errMsg,
      });
      failed++;
    }

    // Rate limit: 500ms between places
    if (i < batch.place_pool_ids.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return { succeeded, failed, skipped, failedPlaces };
}

// ── run_status ────────────────────────────────────────────────────────────

async function handleRunStatus(
  db: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
): Promise<Response> {
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

  return json({ run, batches: batches ?? [] });
}

// ── active_runs ───────────────────────────────────────────────────────────

async function handleActiveRuns(
  db: ReturnType<typeof createClient>,
): Promise<Response> {
  const { data: runs } = await db
    .from('photo_backfill_runs')
    .select('*')
    .in('status', ['ready', 'running', 'paused'])
    .order('created_at', { ascending: false });

  if (!runs || runs.length === 0) return json({ runs: [] });

  const result = [];
  for (const run of runs) {
    const { data: batches } = await db
      .from('photo_backfill_batches')
      .select('status')
      .eq('run_id', run.id);

    const summary = { pending: 0, running: 0, completed: 0, failed: 0, skipped: 0 };
    for (const b of (batches ?? [])) {
      const s = b.status as keyof typeof summary;
      if (s in summary) summary[s]++;
    }

    result.push({ run, batchSummary: summary });
  }

  return json({ runs: result });
}

// ── cancel_run ────────────────────────────────────────────────────────────

async function handleCancelRun(
  db: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const runId = body.runId as string;
  if (!runId) return json({ error: 'runId required' }, 400);

  const { data: run } = await db
    .from('photo_backfill_runs')
    .select('status')
    .eq('id', runId)
    .single();

  if (!run) return json({ error: 'Run not found' }, 404);
  if (!['ready', 'running', 'paused'].includes(run.status)) {
    return json({ error: `Run is ${run.status}, cannot cancel` }, 400);
  }

  // Mark all pending batches as skipped
  await db
    .from('photo_backfill_batches')
    .update({ status: 'skipped' })
    .eq('run_id', runId)
    .eq('status', 'pending');

  // Count skipped batches
  const { count } = await db
    .from('photo_backfill_batches')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', runId)
    .eq('status', 'skipped');

  await db
    .from('photo_backfill_runs')
    .update({
      status: 'cancelled',
      skipped_batches: count ?? 0,
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId);

  return json({ status: 'cancelled', skippedBatches: count ?? 0 });
}

// ── pause_run ─────────────────────────────────────────────────────────────

async function handlePauseRun(
  db: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const runId = body.runId as string;
  if (!runId) return json({ error: 'runId required' }, 400);

  const { data: run } = await db
    .from('photo_backfill_runs')
    .select('status')
    .eq('id', runId)
    .single();

  if (!run) return json({ error: 'Run not found' }, 404);
  if (run.status !== 'running') {
    return json({ error: `Run is ${run.status}, can only pause a running run` }, 400);
  }

  await db
    .from('photo_backfill_runs')
    .update({ status: 'paused' })
    .eq('id', runId);

  return json({ status: 'paused' });
}

// ── resume_run ────────────────────────────────────────────────────────────

async function handleResumeRun(
  db: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const runId = body.runId as string;
  if (!runId) return json({ error: 'runId required' }, 400);

  const { data: run } = await db
    .from('photo_backfill_runs')
    .select('status')
    .eq('id', runId)
    .single();

  if (!run) return json({ error: 'Run not found' }, 404);
  if (run.status !== 'paused') {
    return json({ error: `Run is ${run.status}, can only resume a paused run` }, 400);
  }

  await db
    .from('photo_backfill_runs')
    .update({ status: 'running' })
    .eq('id', runId);

  return json({ status: 'running' });
}

// ── retry_batch ───────────────────────────────────────────────────────────

async function handleRetryBatch(
  db: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  apiKey: string,
): Promise<Response> {
  const runId = body.runId as string;
  const batchId = body.batchId as string;
  if (!runId || !batchId) return json({ error: 'runId and batchId required' }, 400);

  const { data: run } = await db
    .from('photo_backfill_runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (!run) return json({ error: 'Run not found' }, 404);

  const { data: batch } = await db
    .from('photo_backfill_batches')
    .select('*')
    .eq('id', batchId)
    .eq('run_id', runId)
    .single();

  if (!batch) return json({ error: 'Batch not found' }, 404);
  if (batch.status !== 'failed') {
    return json({ error: `Batch is ${batch.status}, can only retry failed batches` }, 400);
  }

  // Clear __backfill_failed__ on the batch's places so they're eligible for retry.
  // We clear all places in the batch — processBatch() will skip any that already
  // have real photos (safe idempotent check inside processBatch).
  // Only clear ones that are actually marked failed (check in JS to avoid
  // clearing real stored URLs).
  const { data: batchPlaces } = await db
    .from('place_pool')
    .select('id, stored_photo_urls')
    .in('id', batch.place_pool_ids);

  const failedPlaceIds = (batchPlaces ?? [])
    .filter((p: { stored_photo_urls?: string[] | null }) => {
      const urls = p.stored_photo_urls;
      return urls && urls.length === 1 && urls[0] === '__backfill_failed__';
    })
    .map((p: { id: string }) => p.id);

  if (failedPlaceIds.length > 0) {
    await db
      .from('place_pool')
      .update({ stored_photo_urls: null })
      .in('id', failedPlaceIds);
  }

  // Save old batch counts for run counter adjustment
  const oldFailed = batch.failed;
  const oldSucceeded = batch.succeeded;
  const oldSkipped = batch.skipped;

  // Reset batch
  await db
    .from('photo_backfill_batches')
    .update({
      status: 'running',
      succeeded: 0,
      failed: 0,
      skipped: 0,
      failed_places: [],
      error_message: null,
      started_at: new Date().toISOString(),
      completed_at: null,
    })
    .eq('id', batchId);

  // Re-process
  const result = await processBatch(db, batch, apiKey);

  // Update batch status
  const batchStatus = result.succeeded === 0 && result.failed > 0 ? 'failed' : 'completed';
  await db
    .from('photo_backfill_batches')
    .update({
      status: batchStatus,
      succeeded: result.succeeded,
      failed: result.failed,
      skipped: result.skipped,
      failed_places: result.failedPlaces,
      error_message: batchStatus === 'failed' ? 'All places failed on retry' : null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', batchId);

  // Update run counters: subtract old, add new
  const { data: freshRun } = await db
    .from('photo_backfill_runs')
    .select('completed_batches, failed_batches, total_succeeded, total_failed, total_skipped, actual_cost_usd, total_batches, skipped_batches')
    .eq('id', runId)
    .single();

  if (freshRun) {
    const runUpdate: Record<string, unknown> = {
      // Old batch was 'failed', now it's either 'completed' or still 'failed'
      failed_batches: batchStatus === 'failed' ? freshRun.failed_batches : freshRun.failed_batches - 1,
      completed_batches: batchStatus === 'completed' ? freshRun.completed_batches + 1 : freshRun.completed_batches,
      total_succeeded: freshRun.total_succeeded - oldSucceeded + result.succeeded,
      total_failed: freshRun.total_failed - oldFailed + result.failed,
      total_skipped: freshRun.total_skipped - oldSkipped + result.skipped,
      actual_cost_usd: +(Number(freshRun.actual_cost_usd) - oldSucceeded * COST_PER_PLACE + result.succeeded * COST_PER_PLACE).toFixed(4),
    };

    await db.from('photo_backfill_runs').update(runUpdate).eq('id', runId);
  }

  return json({
    batchId,
    batchIndex: batch.batch_index,
    succeeded: result.succeeded,
    failed: result.failed,
    skipped: result.skipped,
    failedPlaces: result.failedPlaces,
    done: false,
    runProgress: freshRun ? {
      completedBatches: batchStatus === 'completed' ? freshRun.completed_batches + 1 : freshRun.completed_batches,
      totalBatches: freshRun.total_batches,
      totalSucceeded: freshRun.total_succeeded - oldSucceeded + result.succeeded,
      totalFailed: freshRun.total_failed - oldFailed + result.failed,
    } : null,
  });
}

// ── skip_batch ────────────────────────────────────────────────────────────

async function handleSkipBatch(
  db: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const runId = body.runId as string;
  const batchId = body.batchId as string;
  if (!runId || !batchId) return json({ error: 'runId and batchId required' }, 400);

  const { data: batch } = await db
    .from('photo_backfill_batches')
    .select('status')
    .eq('id', batchId)
    .eq('run_id', runId)
    .single();

  if (!batch) return json({ error: 'Batch not found' }, 404);
  if (!['pending', 'failed'].includes(batch.status)) {
    return json({ error: `Batch is ${batch.status}, can only skip pending or failed batches` }, 400);
  }

  await db
    .from('photo_backfill_batches')
    .update({ status: 'skipped' })
    .eq('id', batchId);

  // Update run skipped count and check if all done
  const { data: freshRun } = await db
    .from('photo_backfill_runs')
    .select('completed_batches, failed_batches, skipped_batches, total_batches')
    .eq('id', runId)
    .single();

  if (freshRun) {
    // If batch was 'failed', decrement failed_batches
    const wasFailed = batch.status === 'failed';
    const newSkipped = freshRun.skipped_batches + 1;
    const newFailed = wasFailed ? freshRun.failed_batches - 1 : freshRun.failed_batches;
    const allDone = (freshRun.completed_batches + newFailed + newSkipped) >= freshRun.total_batches;

    const runUpdate: Record<string, unknown> = {
      skipped_batches: newSkipped,
      failed_batches: newFailed,
    };
    if (allDone) {
      runUpdate.status = 'completed';
      runUpdate.completed_at = new Date().toISOString();
    }

    await db.from('photo_backfill_runs').update(runUpdate).eq('id', runId);
  }

  return json({ status: 'skipped' });
}
