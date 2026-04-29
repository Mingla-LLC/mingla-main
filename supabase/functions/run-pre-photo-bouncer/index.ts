// ORCH-0678 — run-pre-photo-bouncer (two-pass Bouncer, first pass).
//
// First pass of the two-pass design. Runs all Bouncer rules EXCEPT B8 (stored
// photos), which can't be checked until after photo backfill has run. Writes
// passes_pre_photo_check + pre_photo_bouncer_reason + pre_photo_bouncer_validated_at
// on place_pool. Photo backfill (mode 'pre_photo_passed') gates eligibility on
// passes_pre_photo_check=true, dissolving the deadlock that was created by
// ORCH-0640 ch06's is_servable gate.
//
// [CRITICAL — ORCH-0678 + Constitutional #2] This function is the SOLE writer of
// passes_pre_photo_check / pre_photo_bouncer_reason / pre_photo_bouncer_validated_at
// for the place_pool table. NEVER add a write of those columns anywhere else in
// the codebase. CI gate I-PRE-PHOTO-BOUNCER-SOLE-WRITER enforces this.
//
// Constitutional #2 (one owner per truth): each Bouncer pass owns its own column
// triple. is_servable + bouncer_reason + bouncer_validated_at remain owned by
// run-bouncer (final pass) — DO NOT WRITE THEM HERE.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { bounce, type PlaceRow, type Cluster } from '../_shared/bouncer.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Selected fields used by Bouncer + minimal context for the UPDATE
const SELECT_FIELDS =
  'id, name, lat, lng, types, business_status, website, opening_hours, photos, stored_photo_urls, review_count, rating';

const BATCH_SIZE = 500;

interface BouncerSummary {
  pass_count: number;
  reject_count: number;
  by_cluster: Record<Cluster, { pass: number; reject: number }>;
  by_reason: Record<string, number>;
}

function freshSummary(): BouncerSummary {
  return {
    pass_count: 0,
    reject_count: 0,
    by_cluster: {
      A_COMMERCIAL: { pass: 0, reject: 0 },
      B_CULTURAL: { pass: 0, reject: 0 },
      C_NATURAL: { pass: 0, reject: 0 },
      EXCLUDED: { pass: 0, reject: 0 },
    },
    by_reason: {},
  };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const t0 = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const cityId: string | undefined = body.city_id;
    const allCities: boolean = body.all_cities === true;
    const dryRun: boolean = body.dry_run === true;

    if (!cityId && !allCities) {
      return new Response(
        JSON.stringify({ error: 'Provide city_id or all_cities=true' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const summary = freshSummary();
    const writes: Array<{
      id: string;
      passes_pre_photo_check: boolean;
      pre_photo_bouncer_reason: string | null;
    }> = [];

    // Stream place_pool in pages of 500
    let offset = 0;
    while (true) {
      let q = supabaseAdmin
        .from('place_pool')
        .select(SELECT_FIELDS)
        .eq('is_active', true)
        .order('id')
        .range(offset, offset + BATCH_SIZE - 1);

      if (cityId) q = q.eq('city_id', cityId);

      const { data, error } = await q;
      if (error) {
        console.error('[run-pre-photo-bouncer] place_pool fetch error:', error.message);
        return new Response(
          JSON.stringify({ error: `place_pool fetch failed: ${error.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      if (!data || data.length === 0) break;

      for (const place of data as PlaceRow[]) {
        // ORCH-0678 — pre-photo pass: skip B8 (stored photos check). Every other
        // rule unchanged. Single source of truth for rule logic in _shared/bouncer.ts.
        const verdict = bounce(place, { skipStoredPhotoCheck: true });
        const cluster = verdict.cluster;
        if (verdict.is_servable) {
          summary.pass_count++;
          summary.by_cluster[cluster].pass++;
        } else {
          summary.reject_count++;
          summary.by_cluster[cluster].reject++;
          for (const r of verdict.reasons) {
            summary.by_reason[r] = (summary.by_reason[r] || 0) + 1;
          }
        }
        writes.push({
          id: place.id,
          passes_pre_photo_check: verdict.is_servable,
          pre_photo_bouncer_reason: verdict.reasons.length > 0 ? verdict.reasons.join(';') : null,
        });
      }

      if (data.length < BATCH_SIZE) break;
      offset += BATCH_SIZE;
    }

    if (dryRun) {
      const elapsed = Date.now() - t0;
      console.log(`[run-pre-photo-bouncer] dry_run city=${cityId ?? 'all'} pass=${summary.pass_count} reject=${summary.reject_count} elapsed_ms=${elapsed}`);
      return new Response(
        JSON.stringify({ success: true, dry_run: true, ...summary, duration_ms: elapsed }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Write back via TRUE UPDATE per row (place_pool has many NOT NULL columns we
    // don't provide, so upsert's INSERT-fallback semantics fail preflight).
    // Parallelize within each batch — Postgres connection pool handles concurrency.
    const now = new Date().toISOString();
    let written = 0;
    let firstWriteError: string | null = null;
    for (let i = 0; i < writes.length; i += BATCH_SIZE) {
      const chunk = writes.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        chunk.map((w) =>
          supabaseAdmin
            .from('place_pool')
            .update({
              passes_pre_photo_check: w.passes_pre_photo_check,
              pre_photo_bouncer_reason: w.pre_photo_bouncer_reason,
              pre_photo_bouncer_validated_at: now,
            })
            .eq('id', w.id),
        ),
      );
      for (const r of results) {
        if (r.error) {
          if (!firstWriteError) firstWriteError = r.error.message;
        } else {
          written++;
        }
      }
      if (firstWriteError) {
        console.error(`[run-pre-photo-bouncer] write batch ${i / BATCH_SIZE} had errors. First: ${firstWriteError}`);
        return new Response(
          JSON.stringify({
            error: `place_pool write failed at batch ${i / BATCH_SIZE}: ${firstWriteError}`,
            partial_summary: summary,
            written,
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    const elapsed = Date.now() - t0;
    console.log(`[run-pre-photo-bouncer] city=${cityId ?? 'all'} pass=${summary.pass_count} reject=${summary.reject_count} written=${written} elapsed_ms=${elapsed}`);

    return new Response(
      JSON.stringify({ success: true, ...summary, written, duration_ms: elapsed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err) {
    const e = err as Error;
    console.error('[run-pre-photo-bouncer] unhandled:', e?.message);
    return new Response(
      JSON.stringify({ error: e?.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
