// ORCH-0588 Slice 1 — run-signal-scorer (generic, config-driven).
//
// Reads signal_definitions + current version from DB, iterates is_servable=true
// places in scope, computes score per formula skeleton, UPSERTs to place_scores.
//
// Constitutional #2: place_scores.score is owned by THIS function alone.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { computeScore, type PlaceForScoring, type SignalConfig } from '../_shared/signalScorer.ts';

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

interface ScorerSummary {
  scored_count: number;
  ineligible_count: number;
  // META-ORCH-1009 Sub-B — how many (place, signal) pairs Gemini vetoed via
  // `inappropriate_for=true`. Surfaced in the response for admin visibility;
  // dashboard UI for this is Sub-D scope (admin re-eval button).
  vetoed_count: number;
  ai_blended_count: number;
  signal_version_id: string | null;
  score_distribution: { '0-50': number; '50-100': number; '100-150': number; '150-200': number };
}

function bucketize(distribution: ScorerSummary['score_distribution'], score: number | null): void {
  // META-ORCH-1009 Sub-B — null = vetoed, don't bucket
  if (score === null) return;
  if (score < 50) distribution['0-50']++;
  else if (score < 100) distribution['50-100']++;
  else if (score < 150) distribution['100-150']++;
  else distribution['150-200']++;
}

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

    const summary: ScorerSummary = {
      scored_count: 0,
      ineligible_count: 0,
      vetoed_count: 0,
      ai_blended_count: 0,
      signal_version_id: signalVersionId,
      score_distribution: { '0-50': 0, '50-100': 0, '100-150': 0, '150-200': 0 },
    };

    const writes: Array<{
      place_id: string;
      signal_id: string;
      score: number;
      contributions: Record<string, number | string>;
      signal_version_id: string;
      // META-ORCH-1009 Sub-D — passthrough of the AI slice's evaluated_at
      // (null when computeScore returned a rule-only result). Stamped onto
      // place_scores.ai_signal_scores_at on UPSERT so the 15-min cron knows
      // this row reflects the live AI input.
      ai_signal_scores_at: string | null;
    }> = [];
    // META-ORCH-1009 Sub-B — vetoed (place, signal) pairs need their existing
    // place_scores row DELETED (not upserted) so the RPC JOIN excludes them.
    // place_scores.score is NOT NULL in the DDL CHECK constraint so we can't
    // sentinel via NULL — see IMPLEMENTATION report §Deviations.
    const vetoedPlaceIds: string[] = [];

    // META-ORCH-1009 Sub-D — extracted inner loop so both per-place and
    // city/all-cities modes share the same scorer dispatch + writes
    // accumulator. Body is unchanged from the prior Sub-B inline loop.
    const processPlaces = (data: Array<PlaceForScoring & { id: string }>) => {
      for (const place of data) {
        // META-ORCH-1009 Sub-B — pass signalId so computeScore can read the
        // per-signal slice of place.ai_signal_scores for blend + veto.
        const result = computeScore(place, config, signalId);
        bucketize(summary.score_distribution, result.score);
        if ((result.contributions as Record<string, unknown>)._ineligible !== undefined) {
          summary.ineligible_count++;
        } else {
          summary.scored_count++;
        }
        // META-ORCH-1009 Sub-B — null score = Gemini veto. Queue a DELETE
        // for any existing place_scores row instead of an UPSERT.
        if (result.score === null) {
          summary.vetoed_count++;
          vetoedPlaceIds.push(place.id);
          continue;
        }
        if (result.ai_blended) {
          summary.ai_blended_count++;
        }
        writes.push({
          place_id: place.id,
          signal_id: signalId,
          score: result.score,
          contributions: result.contributions,
          signal_version_id: signalVersionId,
          // META-ORCH-1009 Sub-D — null on rule-only path (no AI input at
          // score-compute time); set when AI blend or veto-bypass produced
          // a stored row. Veto rows go through the DELETE path above and
          // never reach this push.
          ai_signal_scores_at: result.ai_blended?.evaluated_at ?? null,
        });
      }
    };

    if (placeIds && placeIds.length > 0) {
      // META-ORCH-1009 Sub-D — per-place mode: single SELECT, no paging loop.
      // place_ids capped at 1000 above; comfortably within Supabase's `.in()`
      // limit. is_active + is_servable filters preserved so the cron + admin
      // button respect the bouncer gate identically to the city/all_cities
      // paths.
      const { data, error } = await supabaseAdmin
        .from('place_pool')
        .select(SELECT_FIELDS)
        .eq('is_active', true)
        .eq('is_servable', true)
        .in('id', placeIds);
      if (error) {
        return new Response(
          JSON.stringify({ error: `place_pool fetch failed: ${error.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      if (data) processPlaces(data as Array<PlaceForScoring & { id: string }>);
    } else {
      // Stream is_servable place_pool in pages (existing city/all_cities mode).
      let offset = 0;
      while (true) {
        let q = supabaseAdmin
          .from('place_pool')
          .select(SELECT_FIELDS)
          .eq('is_active', true)
          .eq('is_servable', true)
          .order('id')
          .range(offset, offset + BATCH_SIZE - 1);

        if (cityId) q = q.eq('city_id', cityId);

        const { data, error } = await q;
        if (error) {
          return new Response(
            JSON.stringify({ error: `place_pool fetch failed: ${error.message}` }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
        if (!data || data.length === 0) break;

        processPlaces(data as Array<PlaceForScoring & { id: string }>);

        if (data.length < BATCH_SIZE) break;
        offset += BATCH_SIZE;
      }
    }

    if (dryRun) {
      const elapsed = Date.now() - t0;
      const scope = placeIds ? `place_ids[${placeIds.length}]` : (cityId ?? 'all');
      console.log(`[run-signal-scorer] dry_run signal=${signalId} scope=${scope} scored=${summary.scored_count} ineligible=${summary.ineligible_count} vetoed=${summary.vetoed_count} ai_blended=${summary.ai_blended_count} elapsed_ms=${elapsed}`);
      return new Response(
        JSON.stringify({ success: true, dry_run: true, ...summary, duration_ms: elapsed }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // UPSERT in chunks of 500 — ON CONFLICT (place_id, signal_id) DO UPDATE
    const now = new Date().toISOString();
    let written = 0;
    for (let i = 0; i < writes.length; i += BATCH_SIZE) {
      const chunk = writes.slice(i, i + BATCH_SIZE).map((w) => ({
        place_id: w.place_id,
        signal_id: w.signal_id,
        score: w.score,
        contributions: w.contributions,
        signal_version_id: w.signal_version_id,
        scored_at: now,
        // META-ORCH-1009 Sub-D — stamp the AI slice's evaluated_at so the
        // 15-min rescore-sweep cron knows this row is fresh. NULL on
        // rule-only path. Sole-writer per I-AI-SCORE-STALENESS-AUTO-RECOVERED.
        ai_signal_scores_at: w.ai_signal_scores_at,
      }));
      const { error: writeErr } = await supabaseAdmin
        .from('place_scores')
        .upsert(chunk, { onConflict: 'place_id,signal_id' });
      if (writeErr) {
        console.error(`[run-signal-scorer] write batch ${i / BATCH_SIZE} failed:`, writeErr.message);
        return new Response(
          JSON.stringify({
            error: `place_scores upsert failed at batch ${i / BATCH_SIZE}: ${writeErr.message}`,
            partial_summary: summary,
            written,
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      written += chunk.length;
    }

    // META-ORCH-1009 Sub-B — DELETE existing place_scores rows for vetoed
    // (place, signal) pairs so the consumer RPC JOIN excludes them. Chunked
    // to keep the URL parameter list small. Non-fatal: a partial failure is
    // logged but does not return 500 because the upserts already succeeded.
    let deleted = 0;
    if (vetoedPlaceIds.length > 0) {
      for (let i = 0; i < vetoedPlaceIds.length; i += BATCH_SIZE) {
        const chunk = vetoedPlaceIds.slice(i, i + BATCH_SIZE);
        const { error: delErr, count } = await supabaseAdmin
          .from('place_scores')
          .delete({ count: 'exact' })
          .eq('signal_id', signalId)
          .in('place_id', chunk);
        if (delErr) {
          console.error(`[run-signal-scorer] veto-delete batch ${i / BATCH_SIZE} failed:`, delErr.message);
          continue;
        }
        deleted += count ?? 0;
      }
    }

    const elapsed = Date.now() - t0;
    const scope = placeIds ? `place_ids[${placeIds.length}]` : (cityId ?? 'all');
    console.log(`[run-signal-scorer] signal=${signalId} scope=${scope} scored=${summary.scored_count} ineligible=${summary.ineligible_count} vetoed=${summary.vetoed_count} ai_blended=${summary.ai_blended_count} written=${written} veto_deleted=${deleted} elapsed_ms=${elapsed}`);

    return new Response(
      JSON.stringify({ success: true, ...summary, written, veto_deleted: deleted, duration_ms: elapsed }),
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
