// ORCH-0588 Slice 1 — run-bouncer (deterministic Bouncer v2)
//
// I-BOUNCER-DETERMINISTIC: NO AI, NO keywords, NO category judgment. If you need that,
// it belongs in run-signal-scorer. Pure type + data-integrity rules only.
//
// Writes is_servable + bouncer_reason + bouncer_validated_at on place_pool.
// Parallel to existing ai_approved (no replacement in Slice 1; Phase 5 retires ai_approved).
//
// Constitutional #2 (one owner per truth): is_servable is owned by THIS function alone.
// No other code should write that column. The `.update({...})` below is the only
// place is_servable is written (CI gate enforces sole-writer).
//
// ORCH-1017 — cursor-paged, memory-safe, non-aborting. The shared loop lives in
// _shared/bouncerBatch.ts; this file owns ONLY the is_servable column writes, the
// read query, and the request/response envelope. Prior version loaded the whole
// city into memory + one 500-wide write burst + abort-on-first-error, which blew
// the Edge compute budget (HTTP 546) on large cities (London @ 15.5k) and never
// finished. Now: streams id-ordered pages (one page in memory), caps work per
// invocation at max_rows + returns next_cursor so the caller loops to completion,
// writes in small concurrency-limited sub-batches, and counts (never aborts on)
// per-row write errors.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { type PlaceRow } from '../_shared/bouncer.ts';
import { runBouncerBatch } from '../_shared/bouncerBatch.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Selected fields used by Bouncer + minimal context for the UPDATE
const SELECT_FIELDS =
  'id, name, lat, lng, types, business_status, website, opening_hours, photos, stored_photo_urls, review_count, rating';

const PAGE_SIZE = 500;
const WRITE_CONCURRENCY = 50;
const DEFAULT_MAX_ROWS = 3000;
const MAX_MAX_ROWS = 20000;

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
    const afterId: string | null =
      typeof body.after_id === 'string' && body.after_id.length > 0 ? body.after_id : null;
    // Default false preserves "re-judge everything" — photos downloaded AFTER an
    // earlier pass must be able to flip a previously-rejected place to servable.
    const onlyUnprocessed: boolean = body.only_unprocessed === true;
    const maxRows: number = Math.max(
      1,
      Math.min(MAX_MAX_ROWS, Number.isFinite(body.max_rows) ? Number(body.max_rows) : DEFAULT_MAX_ROWS),
    );

    if (!cityId && !allCities) {
      return new Response(
        JSON.stringify({ error: 'Provide city_id or all_cities=true' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const now = new Date().toISOString();

    const result = await runBouncerBatch(
      {
        loadPage: async (cursor, pageSize) => {
          let q = supabaseAdmin
            .from('place_pool')
            .select(SELECT_FIELDS)
            .eq('is_active', true)
            .order('id', { ascending: true })
            .limit(pageSize);
          if (cityId) q = q.eq('city_id', cityId);
          if (onlyUnprocessed) q = q.is('is_servable', null);
          if (cursor) q = q.gt('id', cursor);
          const { data, error } = await q;
          if (error) throw new Error(`place_pool fetch failed: ${error.message}`);
          return (data ?? []) as PlaceRow[];
        },
        // SOLE writer of is_servable + bouncer_reason + bouncer_validated_at.
        writeRow: async (place, verdict) => {
          const { error } = await supabaseAdmin
            .from('place_pool')
            .update({
              is_servable: verdict.is_servable,
              bouncer_reason: verdict.reasons.length > 0 ? verdict.reasons.join(';') : null,
              bouncer_validated_at: now,
            })
            .eq('id', place.id);
          return { error: error?.message ?? null };
        },
        countRemaining: async () => {
          if (!cityId) return null;
          const { count } = await supabaseAdmin
            .from('place_pool')
            .select('id', { count: 'exact', head: true })
            .eq('is_active', true)
            .eq('city_id', cityId)
            .is('is_servable', null);
          return count ?? null;
        },
      },
      {
        maxRows,
        pageSize: PAGE_SIZE,
        writeConcurrency: WRITE_CONCURRENCY,
        dryRun,
        afterId,
      },
    );

    const elapsed = Date.now() - t0;
    console.log(
      `[run-bouncer] city=${cityId ?? 'all'} processed=${result.processed} written=${result.written} write_errors=${result.write_errors} done=${result.done} remaining=${result.remaining} elapsed_ms=${elapsed}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: dryRun,
        ...result.summary,
        processed: result.processed,
        written: result.written,
        write_errors: result.write_errors,
        first_write_error: result.first_write_error,
        next_cursor: result.next_cursor,
        done: result.done,
        remaining: result.remaining,
        duration_ms: elapsed,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const e = err as Error;
    console.error('[run-bouncer] unhandled:', e?.message);
    return new Response(
      JSON.stringify({ error: e?.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
