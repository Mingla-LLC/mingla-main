// ORCH-0588 Slice 1 — run-signal-scorer (generic, config-driven).
//
// Reads signal_definitions + current version from DB, iterates is_servable=true
// places in scope, computes score per formula skeleton, UPSERTs to place_scores.
//
// Constitutional #2: place_scores.score is owned by THIS function alone.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { type PlaceForScoring, type SignalConfig } from '../_shared/signalScorer.ts';
// ORCH-1066 — sticky-through-approval: shared admin-override marker predicates so
// the scorer and its regression test agree on exactly one definition.
import { isAdminOverridden } from '../_shared/stickyOverride.ts';
// ORCH-1333 — bounded, incremental, resumable per-page scoring engine (cursor
// loop). All DB IO stays HERE in index.ts via the injected ScorerBatchDeps; the
// engine is pure logic. See INVESTIGATION/SPEC ORCH-1333 and
// _shared/signalScorerBatch.ts.
import {
  runSignalScorerBatch,
  type ScorerBatchDeps,
} from '../_shared/signalScorerBatch.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Selected fields used by scorer + the id/city we need for filtering and writing.
// META-ORCH-1009 Sub-B — `ai_signal_scores` added so computeScore can blend +
// veto using the Gemini Q2 per-place evaluation slice (canonical 6-key shape
// pinned by I-AI-SIGNAL-SCORES-SHAPE-CONTRACT, populated by Sub-A's
// run-place-intelligence-trial writer + the Sub-A backfill).
const SELECT_FIELDS =
  'id, rating, review_count, types, price_level, price_range_start_cents, price_range_end_cents,' +
  ' editorial_summary, generative_summary, reviews,' +
  ' serves_dinner, serves_lunch, serves_breakfast, serves_brunch,' +
  ' serves_wine, serves_cocktails, serves_dessert, serves_vegetarian_food,' +
  ' reservable, dine_in, delivery, takeout,' +
  ' allows_dogs, good_for_groups, good_for_children, outdoor_seating, live_music,' +
  ' ai_signal_scores';

const BATCH_SIZE = 500;

// ORCH-1333 — one page per city/all_cities invocation. Bounds per-call CPU +
// sticky-read so a large post-Sub-B city (New York 9,903 / Paris 4,464) can
// never trip the Edge isolate's resource budget mid-run; the admin client loops
// the cursor until done. Per-place mode uses a larger cap (see maxRows below) so
// the 15-min cron + approval re-score finish in ONE invocation.
const SCORER_MAX_ROWS_PER_CALL = 500;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const t0 = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const signalId: string | undefined = body.signal_id;
    const cityId: string | undefined = body.city_id;
    const allCities: boolean = body.all_cities === true;
    const dryRun: boolean = body.dry_run === true;
    // META-ORCH-1009 Sub-D — per-place mode for the 15-min rescore-sweep cron
    // and the admin re-eval flow. When place_ids is set, the SELECT loop
    // filters to that exact set; city_id is silently dropped; all_cities is
    // mutually exclusive (rejected with 400). Bounded at 1000 ids to guard
    // pathological cron loads.
    const placeIds: string[] | undefined = Array.isArray(body.place_ids)
      ? (body.place_ids as unknown[]).map((v) => String(v))
      : undefined;
    // ORCH-1333 — resumable cursor for city/all_cities mode (mirrors run-bouncer).
    // Additive: ignored by per-place callers (cron / approval finish in one call).
    const afterId: string | null =
      typeof body.after_id === 'string' && body.after_id.length > 0 ? body.after_id : null;

    if (!signalId) {
      return new Response(
        JSON.stringify({ error: 'signal_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (placeIds && placeIds.length > 1000) {
      return new Response(
        JSON.stringify({ error: 'place_ids length > 1000' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (placeIds && allCities) {
      return new Response(
        JSON.stringify({ error: 'place_ids and all_cities are mutually exclusive' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (!placeIds && !cityId && !allCities) {
      return new Response(
        JSON.stringify({ error: 'Provide place_ids, city_id, or all_cities=true' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Load signal definition + current version
    const { data: signalDef, error: signalErr } = await supabaseAdmin
      .from('signal_definitions')
      .select('id, label, kind, is_active, current_version_id')
      .eq('id', signalId)
      .maybeSingle();

    if (signalErr) {
      return new Response(
        JSON.stringify({ error: `signal_definitions fetch failed: ${signalErr.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (!signalDef) {
      return new Response(
        JSON.stringify({ error: `Unknown signal_id: ${signalId}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (!signalDef.is_active) {
      return new Response(
        JSON.stringify({ error: `Signal ${signalId} is inactive` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (!signalDef.current_version_id) {
      return new Response(
        JSON.stringify({ error: `Signal ${signalId} has no current_version_id` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { data: versionRow, error: versionErr } = await supabaseAdmin
      .from('signal_definition_versions')
      .select('id, version_label, config')
      .eq('id', signalDef.current_version_id)
      .maybeSingle();

    if (versionErr || !versionRow) {
      return new Response(
        JSON.stringify({ error: `signal_definition_versions fetch failed: ${versionErr?.message ?? 'no version row'}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const config = versionRow.config as SignalConfig;
    const signalVersionId: string = versionRow.id;

    const isPerPlace = !!(placeIds && placeIds.length > 0);

    // ORCH-1333 — ALL DB IO lives HERE in index.ts (sole-writer strict-grep
    // gates). The shared engine is pure logic + these injected callbacks.
    const deps: ScorerBatchDeps = {
      // Page is_active + is_servable place_pool by id after `cursor`. Per-place
      // mode filters to the exact id set; city mode filters by city_id;
      // all_cities applies no scope filter (identical row set to the
      // pre-ORCH-1333 paths, only paged by id-cursor instead of offset).
      loadPage: async (cursor, size) => {
        let q = supabaseAdmin
          .from('place_pool')
          .select(SELECT_FIELDS)
          .eq('is_active', true)
          .eq('is_servable', true)
          .order('id')
          .limit(size);
        if (isPerPlace && placeIds) q = q.in('id', placeIds);
        else if (cityId) q = q.eq('city_id', cityId);
        if (cursor) q = q.gt('id', cursor);
        const { data, error } = await q;
        if (error) throw new Error(`place_pool fetch failed: ${error.message}`);
        return (data ?? []) as Array<PlaceForScoring & { id: string }>;
      },
      // ── ORCH-1066 STICKY-THROUGH-APPROVAL (per page) ──────────────────────
      // An admin can SET / PIN / override a place's signal score via the
      // deck-score-tuner + score-override RPCs, which stamp
      // place_scores.contributions with an admin marker. A re-score must NOT
      // clobber (upsert) or veto-DELETE such a row. Build the set of protected
      // place_ids for THIS page; the engine drops them from both batches. On a
      // read error we THROW → the engine fail-CLOSES this page (no upsert) and
      // keeps prior pages persisted (Constitution #5 — no silent failure).
      // Authority: I-1066-ADMIN-OVERRIDE-STICKY-THROUGH-RESCORE.
      readProtectedIds: async (ids) => {
        const out = new Set<string>();
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
          const idChunk = ids.slice(i, i + BATCH_SIZE);
          if (idChunk.length === 0) continue;
          const { data: existingRows, error: existErr } = await supabaseAdmin
            .from('place_scores')
            .select('place_id, contributions')
            .eq('signal_id', signalId)
            .in('place_id', idChunk);
          if (existErr) throw new Error(existErr.message);
          for (const row of (existingRows ?? []) as Array<{ place_id: string; contributions: Record<string, unknown> | null }>) {
            if (isAdminOverridden(row.contributions)) out.add(row.place_id);
          }
        }
        return out;
      },
      // SOLE writer of place_scores.score + the AI freshness column
      // (Constitutional #2 + I-AI-SCORE-STALENESS-AUTO-RECOVERED). This is the
      // ONLY place the DB freshness-column name exists — the engine passes the
      // value through under a gate-neutral camelCase key. UPSERT ON CONFLICT
      // (place_id, signal_id) DO UPDATE.
      upsertScores: async (rows) => {
        if (rows.length === 0) return { error: null };
        const now = new Date().toISOString();
        const { error } = await supabaseAdmin
          .from('place_scores')
          .upsert(
            rows.map((w) => ({
              place_id: w.place_id,
              signal_id: w.signal_id,
              score: w.score,
              contributions: w.contributions,
              signal_version_id: w.signal_version_id,
              scored_at: now,
              // META-ORCH-1009 Sub-D — stamp the AI slice's evaluated_at so the
              // 15-min rescore-sweep cron knows this row is fresh. NULL on the
              // rule-only path. Sole-writer per I-AI-SCORE-STALENESS-AUTO-RECOVERED.
              ai_signal_scores_at: w.aiSignalScoresAt,
            })),
            { onConflict: 'place_id,signal_id' },
          );
        return { error: error?.message ?? null };
      },
      // META-ORCH-1009 Sub-B — DELETE existing place_scores rows for vetoed
      // (place, signal) pairs so the consumer RPC JOIN excludes them. Non-fatal:
      // a partial failure is logged but never aborts (the upserts already landed).
      deleteVetoed: async (ids) => {
        let deleted = 0;
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
          const idChunk = ids.slice(i, i + BATCH_SIZE);
          if (idChunk.length === 0) continue;
          const { error: delErr, count } = await supabaseAdmin
            .from('place_scores')
            .delete({ count: 'exact' })
            .eq('signal_id', signalId)
            .in('place_id', idChunk);
          if (delErr) {
            console.error('[run-signal-scorer] veto-delete failed:', delErr.message);
            continue;
          }
          deleted += count ?? 0;
        }
        return { deleted, error: null };
      },
      // Progress UI only. ORCH-1333 Open-Question-1: a correct city-scoped
      // "unscored" count needs an anti-join PostgREST can't express cheaply, so
      // we ship null (the admin client + Bouncer both tolerate a null
      // remaining). MUST NOT throw.
      countRemaining: async () => null,
    };

    // ORCH-1333 — per-place = 1000 so the 15-min cron + approval re-score (≤500
    // ids) finish in ONE invocation (done:true, no client loop). City/all_cities
    // = one 500-row page per call so the admin client loops the cursor to done.
    const result = await runSignalScorerBatch(deps, {
      signalId,
      config,
      signalVersionId,
      maxRows: isPerPlace ? 1000 : SCORER_MAX_ROWS_PER_CALL,
      pageSize: BATCH_SIZE,
      afterId,
      dryRun,
    });

    const scope = isPerPlace ? `place_ids[${placeIds?.length ?? 0}]` : (cityId ?? 'all');

    if (dryRun) {
      const elapsed = Date.now() - t0;
      console.log(`[run-signal-scorer] dry_run signal=${signalId} scope=${scope} scored=${result.summary.scored_count} ineligible=${result.summary.ineligible_count} vetoed=${result.summary.vetoed_count} ai_blended=${result.summary.ai_blended_count} elapsed_ms=${elapsed}`);
      return new Response(
        JSON.stringify({
          success: true,
          dry_run: true,
          ...result.summary,
          next_cursor: result.next_cursor,
          done: result.done,
          remaining: result.remaining,
          duration_ms: elapsed,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Fatal page error (sticky pre-read or upsert failed). Prior pages remain
    // persisted; the client stops and surfaces the error. NO abort-all.
    if (result.error) {
      console.error('[run-signal-scorer]', result.error);
      return new Response(
        JSON.stringify({
          error: result.error,
          partial_summary: result.summary,
          written: result.written,
          next_cursor: result.next_cursor,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const elapsed = Date.now() - t0;
    console.log(`[run-signal-scorer] signal=${signalId} scope=${scope} scored=${result.summary.scored_count} ineligible=${result.summary.ineligible_count} vetoed=${result.summary.vetoed_count} ai_blended=${result.summary.ai_blended_count} written=${result.written} veto_deleted=${result.veto_deleted} next_cursor=${result.next_cursor ?? 'DONE'} elapsed_ms=${elapsed}`);

    return new Response(
      JSON.stringify({
        success: true,
        ...result.summary,
        written: result.written,
        veto_deleted: result.veto_deleted,
        sticky_skipped: result.sticky_skipped,
        next_cursor: result.next_cursor,
        done: result.done,
        remaining: result.remaining,
        duration_ms: elapsed,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err) {
    const e = err as Error;
    console.error('[run-signal-scorer] unhandled:', e?.message);
    return new Response(
      JSON.stringify({ error: e?.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
