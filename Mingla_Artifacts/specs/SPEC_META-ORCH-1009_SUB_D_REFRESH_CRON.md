# SPEC — META-ORCH-1009 Sub-D — Refresh cron + admin re-evaluate button (auto-trigger signal-scorer on AI score changes, freshness on Google data drift)

**Mode:** Forensics SPEC (no implementation in this file)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1009-Sub-D-[refresh-cron-admin-reeval-button]/` on branch `META-ORCH-1009-Sub-D-refresh-cron-admin-reeval-button`
**Branched from main at:** `28d7426e4`
**Author skill:** Claude `mingla-forensics`
**Date:** 2026-05-30
**Parent META-ORCH:** META-ORCH-1009 — wire Gemini Q2 evaluations into consumer deck ranking
**Sibling sub-dispatches:** Sub-A (schema+backfill — CLOSED), Sub-B (consumer ranker blend + veto — CLOSED), Sub-C (Gemini coverage backfill — operator-driven in parallel), Sub-E (business app feeder — DEFERRED), Sub-F (single-brand experiences — DEFERRED).
**Constitution / Comms acks:**
- COMMS-0003 (ALL) — external-API doc citations required for any code touching the Gemini-fed trial pipeline. Satisfied inline at §3.2 / §3.4: Gemini 2.5 Flash function-calling contract referenced via the existing edge fn (no new outbound Gemini call introduced by Sub-D — the drift triggers + admin button QUEUE rows into the EXISTING trial pipeline which already cites Gemini docs at lines 1092 + 2224 + 2277). Supabase pg_cron + pg_net documentation: https://supabase.com/docs/guides/cron (verified 2026-05-30) — cited at §3.1 / §3.5.

---

## §1 Goal (plain English, one paragraph)

Sub-D closes the staleness loop that DEC-182 documented and that Sub-B's manual-click runbook left open: after every Sub-C backfill round writes new Gemini Q2 evaluations into `place_pool.ai_signal_scores`, a **15-min pg_cron sweep** automatically re-runs `run-signal-scorer` for ONLY the (place, signal) pairs whose AI slice is newer than the existing `place_scores` row, so the deck reflects the new evaluation within 15 min instead of "until operator clicks." A second mechanism — a **Postgres trigger on `place_pool`** — detects when underlying Google data drifts (`business_status`, `editorial_summary`, or `generative_summary` change) and **queues that place back into the existing trial pipeline** (insert pending row + the existing `kick_pending_trial_runs` cron picks it up) so the Q2 evaluation itself is refreshed, not just the score blend. An **admin "Re-evaluate this place" button** lets the operator override on demand for a single place. A **90-day quarterly backstop cron** does a full all-cities sweep as the safety net for anything the trigger missed. No consumer-mobile or signalScorer math changes; this sub is pure infrastructure that keeps `place_scores` automatically in sync with `place_pool.ai_signal_scores`.

---

## §2 Inputs (file/path inventory by layer)

All paths are relative to the worktree root `~/Desktop/mingla-orchs/META-ORCH-1009-Sub-D-[refresh-cron-admin-reeval-button]/`. Every path was verified to exist via the `Read` tool.

### §2.1 Layer 1 — Detection column + auto-trigger cron

**Migration (NEW):**
- `supabase/migrations/20260808000000_meta_orch_1009_sub_d_refresh_cron.sql` — adds `place_scores.ai_signal_scores_at TIMESTAMPTZ NULL`; adds 1 pg_cron job `meta_orch_1009_sub_d_ai_score_rescore_sweep` at `*/15 * * * *`; adds 1 SECURITY DEFINER helper fn `pg_meta_orch_1009_sub_d_select_stale_pairs(p_limit int)` returning the dirty (place_id, signal_id) list; adds 1 SECURITY DEFINER fn `tg_meta_orch_1009_sub_d_kick_rescores()` that the cron calls — same vault-secrets + pg_net pattern as `tg_kick_pending_trial_runs` from `supabase/migrations/20260506000001_orch_0737_async_trial_runs.sql`. Estimated size: **~150 lines**.

**Edge function (EDIT):**
- `supabase/functions/run-signal-scorer/index.ts` — extends request body to support `{place_ids: string[], signal_id: string}` per-place per-signal mode (today only supports `{signal_id, city_id?, all_cities?, dry_run?}` per §0 probe lines 65–82). When `place_ids` is set, the SELECT loop filters to that exact set of `id`s (skips the offset paging loop entirely — `place_ids.length` is bounded by the cron's `p_limit` chunk size, default 500). The blend + veto + DELETE-on-veto logic from Sub-B (lines 178–268) is preserved verbatim — only the source-place filter changes. Sub-D ALSO threads the AI slice's `evaluated_at` through `computeScore` (Sub-B already reads `place.ai_signal_scores[signalId].evaluated_at` for the version discriminator; Sub-D writes that timestamp into the NEW `place_scores.ai_signal_scores_at` column on every upsert). Touch window: **~30 lines added** to `run-signal-scorer/index.ts`, **0 lines changed** in `_shared/signalScorer.ts` (the helper already returns the AI input in `ai_blended.prompt_version`; we just add `evaluated_at` to the same `ai_blended` slice and propagate it). The chunked upsert at lines 220–247 adds one extra column to the chunk payload.

### §2.2 Layer 2 — Google-data-drift triggers

**Migration (in the same Sub-D migration file — §2.1):**
- 1 PL/pgSQL trigger function `tg_meta_orch_1009_sub_d_drift_queue_reeval()` — `AFTER UPDATE OF business_status, editorial_summary, generative_summary ON public.place_pool FOR EACH ROW WHEN (drift detected AND OLD.ai_signal_scores IS NOT NULL)`. Body: insert a pending row into `place_intelligence_trial_runs` with `source_trial_run_id=NULL` + a synthetic parent run row in `place_intelligence_runs` (mode='drift_reeval', city_id=NEW.city_id), so the existing `kick_pending_trial_runs` cron + the existing trial-pipeline worker logic picks it up unchanged. Idempotency via a partial unique index on `place_intelligence_trial_runs(place_pool_id) WHERE status='pending' AND source='auto-refresh-drift'`.
- 1 NEW column `place_intelligence_trial_runs.source TEXT NULL` (default NULL = legacy admin-initiated; values `'auto-refresh-drift'` or `'admin-reeval-button'` for the two new paths) — this lets the SPEC tag the provenance without disturbing the existing schema's status / run_id semantics. Cheap to add: ~5 rows of DDL + a CHECK constraint listing the 3 allowed values.

**Reference reads (no edits required — context only):**
- `supabase/functions/run-place-intelligence-trial/index.ts` lines 1248–1317 — `handleStartRun` shape (the trigger's insert mirrors this minus the `sample_size` / `estimated_cost_usd` columns since drift queue is single-place).
- `supabase/migrations/20260506000001_orch_0737_async_trial_runs.sql` lines 150–218 — `kick_pending_trial_runs` cron + `tg_kick_pending_trial_runs()` worker (the existing queue infrastructure Sub-D piggybacks on).

### §2.3 Layer 3 — Admin "Re-evaluate this place" button

**Admin page (EDIT):**
- `mingla-admin/src/pages/PlacePoolManagementPage.jsx` — `PlaceDetailModal` (line 354) gets a new button in `<ModalBody>` near the existing "Save" / "Cancel" footer. Button label: **"Re-evaluate AI signals"**. Click handler calls a new wrapped supabase function-invoke: `supabase.functions.invoke('run-place-intelligence-trial', { body: { action: 'admin_reeval_place', place_pool_id: place.id } })`. Toast on success/failure. Touch window: **~40 lines added** (button JSX + state + handler + per-place rate-limit indicator).
- Optional debug surface: the existing Identity section (line 433) renders 1 new field "AI evaluated at: …" reading `place.ai_signal_scores -> $signal_id ->> 'evaluated_at'` for the dominant signal (read-only — confirms refresh worked). **~3 lines added**.

**Edge function (EDIT, in the same trial fn file as §2.1):**
- `supabase/functions/run-place-intelligence-trial/index.ts` — NEW action `admin_reeval_place` (alongside the existing `run_trial_for_place`, `start_run`, etc., dispatched at line 670). Body: `{action: 'admin_reeval_place', place_pool_id: uuid}`. Creates a synthetic single-place parent run + 1 pending child + fires the immediate `process_chunk` kick (same pattern as `handleStartRun` lines 1322–1329 for `full_city` mode). Server-side rate-limit: rejects with 429 if the same `place_pool_id` has any row in `place_intelligence_trial_runs` with status='pending' OR status='running' (any source). Touch window: **~60 lines added** to the existing dispatcher + a new `handleAdminReevalPlace` helper.

### §2.4 Layer 4 — Quarterly backstop

**Migration (in the same Sub-D migration file — §2.1):**
- 1 pg_cron job `meta_orch_1009_sub_d_quarterly_all_cities_sweep` at `0 4 1 */3 *` (04:00 UTC on day 1 of every 3rd month — Mar / Jun / Sep / Dec). Body: HTTP-POST `run-signal-scorer` once per of the 16 canonical signal IDs with `{signal_id: '<sig>', all_cities: true}`. Implementation: a small helper SECURITY DEFINER fn `tg_meta_orch_1009_sub_d_quarterly_sweep()` that iterates `signal_definitions WHERE is_active=true` and PERFORMs `net.http_post` per signal with a 60s sleep between to avoid worker thrash. Estimated size: **~40 lines** (within the same Sub-D migration).

### §2.5 Strict-grep CI gate (NEW)

- `.github/scripts/strict-grep/meta-orch-1009-sub-d-ai-score-staleness-recovery.mjs` — asserts that the cron job `meta_orch_1009_sub_d_ai_score_rescore_sweep` is registered in the SQL of the Sub-D migration, AND that no other code path writes to `place_scores.ai_signal_scores_at` besides `run-signal-scorer/index.ts`. **~50 lines.**
- `.github/workflows/strict-grep.yml` — register the new script. **~3 lines added.**

### §2.6 Invariant registry (EDIT)

- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — ADD 1 NEW invariant `I-AI-SCORE-STALENESS-AUTO-RECOVERED` (ACTIVE on Sub-D merge). Verbatim body in §3.6.

### §2.7 Decision log (EDIT)

- `Mingla_Artifacts/DECISION_LOG.md` — append `DEC-183` (max existing DEC-182 per the Sub-B close artifact) recording the 15-min cron cadence, the drift-trigger column list (3 columns), the per-place admin rate-limit policy, the 90-day backstop cadence, and pointer to META-ORCH-1009 Sub-D close.

### §2.8 Reference reads (no edits — context only)

- `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_A_AI_SIGNAL_SCORES_SCHEMA.md` §3.1 — column shape (Sub-D reads `ai_signal_scores -> signal_id ->> 'evaluated_at'`).
- `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_B_CONSUMER_RANKER_BLEND.md` §3.1 — blend formula (Sub-D does NOT change this, just re-triggers it).
- `Mingla_Artifacts/research/RESEARCH_EXPERIENCE_PIPELINE_TO_CONSUMER_DECK.md` §9 Q6 — operator-locked refresh cadence (option ii + quarterly backstop).
- `supabase/migrations/20260527000000_orch_0788_notification_retry_cron.sql` — pg_cron + pg_net + vault pattern (Sub-D follows verbatim).
- `supabase/migrations/20260506000001_orch_0737_async_trial_runs.sql` — `kick_pending_trial_runs` worker pattern (Sub-D's drift trigger inserts into the same `place_intelligence_trial_runs` queue this worker drains).

### §2.9 Live DB probes performed during spec write (Supabase Management API, 2026-05-30)

| Probe | Result | Used in |
|---|---|---|
| `place_scores` columns | `id uuid, place_id uuid, signal_id text, score numeric, contributions jsonb, scored_at timestamptz, signal_version_id uuid` — no `ai_signal_scores_at` today | §3.1 column add |
| Existing `cron.job` rows | 16 active jobs incl. `kick_pending_trial_runs (* * * * *)`, `keep-functions-warm (*/5 * * * *)`, `refresh_admin_place_pool_mv (*/10 * * * *)`, no `meta_orch_1009_*` yet | §3.1 / §3.5 naming + cadence |
| Currently stale (place, signal) pairs (where `ps.scored_at IS NULL OR ps.scored_at < ai_evaluated_at`) | **988 stale pairs** out of 26,682 (place, signal) overlap pairs across 2,366 places with AI scores (total ai_pairs = 37,270 — 10,588 pairs have AI scores but NO existing `place_scores` row, those are NEW writes the first sweep produces) | §3.1 cron catch-radius rationale; §4.1 M-01 test |
| `place_pool.ai_signal_scores` row count = 2,366; non-OPERATIONAL among them = 7 | First drift trigger sweep is tiny | §3.2 |
| Trial pipeline action dispatcher (line 670) | 13 existing actions including `run_trial_for_place`, `start_run`, `process_chunk` — Sub-D adds `admin_reeval_place` as a 14th | §3.4 |
| Trial pipeline `place_intelligence_trial_runs` columns | 25 columns including `place_pool_id, signal_id, status, prompt_version, source_trial_run_id, parent_run_id` — Sub-D adds `source TEXT NULL` (3-value CHECK) | §3.2 / §3.4 |
| `place_pool` columns `business_status`, `editorial_summary`, `generative_summary`, `last_detail_refresh` exist | Trigger references confirmed against schema | §3.2 |

---

## §3 Contracts per layer

### §3.1 Layer 1 — Detection column + auto-trigger cron (LOCKED)

**NEW column DDL (verbatim — in the Sub-D migration):**

```sql
ALTER TABLE public.place_scores
  ADD COLUMN ai_signal_scores_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.place_scores.ai_signal_scores_at IS
  'META-ORCH-1009 Sub-D: the evaluated_at timestamp from the AI slice
   (place_pool.ai_signal_scores -> signal_id ->> ''evaluated_at'')
   that fed the last blend write into this row''s score. NULL = pre-
   Sub-D row OR rule-only place (no AI evaluation present at score-
   compute time). The Sub-D rescore-sweep cron compares this value
   against the live AI slice timestamp to detect stale rows; sole writer
   is run-signal-scorer/index.ts. See I-AI-SCORE-STALENESS-AUTO-
   RECOVERED.';

-- No index needed — the sweep helper §3.1 below scans through a
-- jsonb_object_keys() unnest of place_pool.ai_signal_scores (already
-- indexed via the Sub-A jsonb_path_ops GIN index) and filters on the
-- TIMESTAMPTZ comparison in the WHERE clause, which is well-served by
-- the table's existing (place_id, signal_id) primary key. Adding a
-- second index on (ai_signal_scores_at) would be redundant.
```

**NEW SECURITY DEFINER helper fn (verbatim):**

```sql
CREATE OR REPLACE FUNCTION public.pg_meta_orch_1009_sub_d_select_stale_pairs(
  p_limit int DEFAULT 500
)
RETURNS TABLE (place_id uuid, signal_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- META-ORCH-1009 Sub-D: returns (place, signal) pairs where the
  -- existing place_scores row is older than the AI evaluation
  -- timestamp stored in place_pool.ai_signal_scores. Includes BOTH:
  --   (a) drift pairs — ps row exists but its ai_signal_scores_at is
  --       NULL or older than the live ai slice evaluated_at.
  --   (b) new pairs — ai slice exists but ps row absent (LEFT JOIN
  --       catches these via ps.scored_at IS NULL).
  -- Bouncer is upstream: only is_servable places are returned (matches
  -- run-signal-scorer's own WHERE clause at SELECT_FIELDS line 161).
  --
  -- Ordered by oldest-stale-first so the cron drains the worst
  -- staleness over successive ticks. LIMIT bounds memory + edge-fn
  -- batch size; default 500 = signal-scorer's BATCH_SIZE.
  WITH ai_keys AS (
    SELECT pp.id AS place_id,
           k.signal_id,
           (pp.ai_signal_scores -> k.signal_id ->> 'evaluated_at')::timestamptz AS ai_evaluated_at
    FROM public.place_pool pp
    CROSS JOIN LATERAL jsonb_object_keys(pp.ai_signal_scores) AS k(signal_id)
    WHERE pp.ai_signal_scores IS NOT NULL
      AND pp.is_servable = true
      AND pp.is_active = true
  )
  SELECT ak.place_id, ak.signal_id
  FROM ai_keys ak
  LEFT JOIN public.place_scores ps
    ON ps.place_id = ak.place_id AND ps.signal_id = ak.signal_id
  WHERE ps.scored_at IS NULL                                            -- new pair
     OR ps.ai_signal_scores_at IS NULL                                  -- pre-Sub-D row
     OR ps.ai_signal_scores_at < ak.ai_evaluated_at                     -- stale row
  ORDER BY COALESCE(ps.ai_signal_scores_at, '1970-01-01'::timestamptz) ASC,
           ak.place_id, ak.signal_id
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.pg_meta_orch_1009_sub_d_select_stale_pairs(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_meta_orch_1009_sub_d_select_stale_pairs(int) FROM anon;
REVOKE ALL ON FUNCTION public.pg_meta_orch_1009_sub_d_select_stale_pairs(int) FROM authenticated;
-- Service-role only — invoked by the cron-driven kicker below.
```

**NEW pg_cron kicker fn + schedule (verbatim):**

```sql
CREATE OR REPLACE FUNCTION public.tg_meta_orch_1009_sub_d_kick_rescores()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  worker_url text;
  service_key text;
  per_signal_chunks jsonb := '{}'::jsonb;  -- {signal_id: [place_id, ...]}
  sig text;
  chunk_ids text[];
BEGIN
  -- Vault secret lookup (same pattern as orch_0788).
  SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF service_key IS NULL THEN
    RAISE NOTICE 'tg_meta_orch_1009_sub_d_kick_rescores: service_role_key not in vault, skipping tick';
    RETURN;
  END IF;
  SELECT decrypted_secret INTO worker_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  IF worker_url IS NULL THEN
    RAISE NOTICE 'tg_meta_orch_1009_sub_d_kick_rescores: supabase_url not in vault, skipping tick';
    RETURN;
  END IF;
  worker_url := worker_url || '/functions/v1/run-signal-scorer';

  -- Gather stale pairs (cap 500 per tick) and bucket by signal_id so
  -- we fire one HTTP request per signal containing up to N place_ids.
  -- This avoids 16 separate requests when only 2 signals are dirty,
  -- and keeps the per-signal request bounded for run-signal-scorer's
  -- existing 500-place BATCH_SIZE.
  FOR r IN SELECT * FROM public.pg_meta_orch_1009_sub_d_select_stale_pairs(500)
  LOOP
    per_signal_chunks := jsonb_set(
      per_signal_chunks,
      ARRAY[r.signal_id],
      COALESCE(per_signal_chunks -> r.signal_id, '[]'::jsonb) || to_jsonb(r.place_id::text),
      true
    );
  END LOOP;

  -- Empty = nothing stale; quiet exit (no HTTP fires).
  IF per_signal_chunks = '{}'::jsonb THEN RETURN; END IF;

  -- One HTTP POST per affected signal.
  FOR sig IN SELECT jsonb_object_keys(per_signal_chunks) LOOP
    SELECT array_agg(value::text) INTO chunk_ids
      FROM jsonb_array_elements_text(per_signal_chunks -> sig);
    PERFORM net.http_post(
      url := worker_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body := jsonb_build_object(
        'signal_id', sig,
        'place_ids', to_jsonb(chunk_ids),
        'source', 'meta-orch-1009-sub-d-stale-sweep'
      ),
      timeout_milliseconds := 60000
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.tg_meta_orch_1009_sub_d_kick_rescores IS
  'META-ORCH-1009 Sub-D: pg_cron-driven re-score kicker. Every 15 min,
   selects up to 500 (place, signal) pairs where place_scores is stale
   vs place_pool.ai_signal_scores and HTTP-POSTs run-signal-scorer in
   per-place mode (NEW request shape introduced by Sub-D, see edge fn
   §3.1). Vault secrets supabase_url + service_role_key required.';

-- Idempotent unschedule + schedule.
DO $cron_setup$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'meta_orch_1009_sub_d_ai_score_rescore_sweep';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;

  PERFORM cron.schedule(
    'meta_orch_1009_sub_d_ai_score_rescore_sweep',
    '*/15 * * * *',
    $job$ SELECT public.tg_meta_orch_1009_sub_d_kick_rescores(); $job$
  );
END;
$cron_setup$;
```

**Edge function per-place mode (LOCKED — addition to existing scorer):**

`supabase/functions/run-signal-scorer/index.ts` request-body contract is extended:

```ts
// Existing (Sub-B):
//   { signal_id: string, city_id?: string, all_cities?: boolean, dry_run?: boolean }
//
// NEW (Sub-D): per-place per-signal mode for the rescore-sweep cron + the
// admin re-eval flow. When place_ids is set, city_id / all_cities are
// IGNORED and the SELECT loop filters to the exact place_ids set.
//
//   { signal_id: string, place_ids: string[], source?: string, dry_run?: boolean }
//
// Validation:
//   - place_ids length <= 1000 (rejects with 400 above) — guards against
//     pathological cron loads.
//   - mutually exclusive with all_cities=true (rejects with 400 if both).
//   - city_id is silently dropped when place_ids is present.
//   - signal_id required (existing — unchanged).
//
// Response shape unchanged — scorer summary + written count.
```

The SELECT loop change (replaces lines 158–209 in the existing scorer):

```ts
const placeIds: string[] | undefined = Array.isArray(body.place_ids)
  ? body.place_ids.map(String)
  : undefined;

if (placeIds && placeIds.length > 1000) {
  return new Response(JSON.stringify({ error: 'place_ids length > 1000' }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
if (placeIds && allCities) {
  return new Response(JSON.stringify({ error: 'place_ids and all_cities are mutually exclusive' }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
if (!placeIds && !cityId && !allCities) {
  return new Response(JSON.stringify({ error: 'Provide place_ids, city_id, or all_cities=true' }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// Per-place mode: single SELECT, no paging loop.
if (placeIds && placeIds.length > 0) {
  const { data, error } = await supabaseAdmin
    .from('place_pool')
    .select(SELECT_FIELDS)
    .eq('is_active', true)
    .eq('is_servable', true)
    .in('id', placeIds);
  if (error) {
    return new Response(JSON.stringify({ error: `place_pool fetch failed: ${error.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  if (data) processBatch(data, summary, writes, vetoedPlaceIds, signalId, signalVersionId, config);
} else {
  // ... existing city / all_cities paging loop unchanged ...
}
```

The `processBatch` extraction is for symmetry; the body is identical to existing lines 178–209.

**Sub-D writes `ai_signal_scores_at` on every upsert (LOCKED):**

The chunk-payload mapping at line 224–231 of `run-signal-scorer/index.ts` adds one column:

```ts
const chunk = writes.slice(i, i + BATCH_SIZE).map((w) => ({
  place_id: w.place_id,
  signal_id: w.signal_id,
  score: w.score,
  contributions: w.contributions,
  signal_version_id: w.signal_version_id,
  scored_at: now,
  ai_signal_scores_at: w.ai_signal_scores_at,  // NEW (Sub-D) — null if rule-only
}));
```

The `writes` row at line 198 also adds the field, fed by extending `ScoreResult.ai_blended` (Sub-B §3.1) to include `evaluated_at`:

```ts
// In _shared/signalScorer.ts ScoreResult interface — extend Sub-B's ai_blended:
ai_blended?: {
  ai_score_0_to_100: number;
  rule_score_normalized: number;
  weight_used: number;
  prompt_version: string;
  evaluated_at: string;  // NEW (Sub-D) — passthrough of aiEntry.evaluated_at
};
```

And the computeScore body change (1 line — Sub-D extension):

```ts
ai_blended: {
  ai_score_0_to_100: aiEntry.score_0_to_100,
  rule_score_normalized: ruleNormalized,
  weight_used: w,
  prompt_version: aiEntry.prompt_version,
  evaluated_at: aiEntry.evaluated_at,  // NEW (Sub-D)
},
```

When the result has no `ai_blended` (rule-only path or pre-version-discriminator NULL), `ai_signal_scores_at` is written as `NULL` — preserves the read semantic ("rule-only place had no AI input at score-compute time").

### §3.2 Layer 2 — Google-data-drift triggers (LOCKED)

**NEW column DDL (verbatim — in the Sub-D migration):**

```sql
ALTER TABLE public.place_intelligence_trial_runs
  ADD COLUMN source TEXT NULL;

ALTER TABLE public.place_intelligence_trial_runs
  ADD CONSTRAINT pit_runs_source_chk
  CHECK (source IS NULL OR source IN ('auto-refresh-drift', 'admin-reeval-button'));

COMMENT ON COLUMN public.place_intelligence_trial_runs.source IS
  'META-ORCH-1009 Sub-D: provenance tag. NULL = legacy admin-initiated
   trial run (default for all pre-Sub-D rows + admin city sweeps from
   PlacePoolManagementPage). ''auto-refresh-drift'' = inserted by the
   place_pool drift trigger. ''admin-reeval-button'' = inserted by the
   per-place admin button. Used for cost attribution + the idempotency
   partial unique index below.';

-- Idempotency: prevent a flood of pending drift-reeval rows for the
-- same place. If a drift-reeval is already pending or running for a
-- place, subsequent drift updates are dropped (next drift after the
-- run completes will re-queue normally).
CREATE UNIQUE INDEX IF NOT EXISTS
  idx_pit_runs_drift_reeval_one_per_place
  ON public.place_intelligence_trial_runs (place_pool_id)
  WHERE source = 'auto-refresh-drift'
    AND status IN ('pending', 'running');
```

**NEW trigger function (verbatim — in the Sub-D migration):**

```sql
CREATE OR REPLACE FUNCTION public.tg_meta_orch_1009_sub_d_drift_queue_reeval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_drift_kind text;
  v_changed boolean := false;
BEGIN
  -- Determine WHICH of the 3 columns drifted (for the audit log).
  IF NEW.business_status IS DISTINCT FROM OLD.business_status THEN
    v_changed := true; v_drift_kind := 'business_status';
  ELSIF NEW.editorial_summary IS DISTINCT FROM OLD.editorial_summary THEN
    v_changed := true; v_drift_kind := 'editorial_summary';
  ELSIF NEW.generative_summary IS DISTINCT FROM OLD.generative_summary THEN
    v_changed := true; v_drift_kind := 'generative_summary';
  END IF;

  -- Guard 1: at least one of the 3 columns actually changed.
  IF NOT v_changed THEN RETURN NEW; END IF;
  -- Guard 2: only queue if the place HAS an AI evaluation (no point
  -- re-evaluating something Sub-C hasn't covered yet — Sub-C's backfill
  -- will pick it up on its own schedule).
  IF NEW.ai_signal_scores IS NULL THEN RETURN NEW; END IF;
  -- Guard 3: only servable places (matches the consumer-ranker scope).
  IF NEW.is_servable IS NOT TRUE THEN RETURN NEW; END IF;

  -- Insert parent run row (mode='drift_reeval'). The existing
  -- place_intelligence_runs unique partial index on
  -- (city_id) WHERE status IN ('pending','running','cancelling')
  -- can conflict with an existing city run — we tolerate by using
  -- ON CONFLICT DO NOTHING and silently skipping the queue (the next
  -- drift event after the city run completes will re-queue).
  BEGIN
    INSERT INTO public.place_intelligence_runs (
      id, city_id, city_name, mode, sample_size, total_count,
      estimated_cost_usd, estimated_minutes,
      prompt_version, model, started_by, status, started_at
    ) VALUES (
      v_run_id, NEW.city_id,
      COALESCE((SELECT name FROM public.cities WHERE id = NEW.city_id LIMIT 1), 'drift'),
      'drift_reeval',
      1, 1,
      0.0040, 1,   -- ~$0.0040/place Gemini Q2 cost; ~1 min wallclock
      'v4', 'gemini-2.5-flash',
      NULL,        -- system-initiated (no admin user)
      'running', now()
    );
  EXCEPTION WHEN unique_violation THEN
    -- A city run is already active for this city; skip the queue.
    -- Next drift event after that run completes will re-fire.
    RETURN NEW;
  END;

  -- Insert pending child row. The Sub-D partial unique index above
  -- prevents duplicates per place.
  INSERT INTO public.place_intelligence_trial_runs (
    run_id, parent_run_id, place_pool_id, city_id, signal_id,
    anchor_index, input_payload, status, prompt_version, model,
    retry_count, source
  ) VALUES (
    v_run_id, v_run_id, NEW.id, NEW.city_id, NULL, NULL,
    jsonb_build_object('drift_kind', v_drift_kind,
                       'triggered_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'pending', 'v4', 'gemini-2.5-flash', 0, 'auto-refresh-drift'
  )
  ON CONFLICT DO NOTHING;  -- Sub-D partial unique idx absorbs duplicates.

  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_place_pool_drift_queue_reeval
  AFTER UPDATE OF business_status, editorial_summary, generative_summary
  ON public.place_pool
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_meta_orch_1009_sub_d_drift_queue_reeval();

COMMENT ON FUNCTION public.tg_meta_orch_1009_sub_d_drift_queue_reeval IS
  'META-ORCH-1009 Sub-D: when business_status / editorial_summary /
   generative_summary changes on a place that already has
   ai_signal_scores populated, queue a pending row into
   place_intelligence_trial_runs with source=auto-refresh-drift. The
   existing kick_pending_trial_runs cron + trial-pipeline worker
   handle the actual Gemini Q2 re-evaluation (and Sub-A''s mirror-
   write back into place_pool.ai_signal_scores). The Sub-D rescore-
   sweep cron then picks up the new ai_signal_scores_at and
   re-blends place_scores. Idempotent via the partial unique index
   on place_intelligence_trial_runs (place_pool_id) WHERE source =
   ''auto-refresh-drift'' AND status IN (''pending'',''running'').
   External-API doc: Gemini 2.5 Flash invoked via the existing
   trial fn — https://ai.google.dev/api/generate-content#function_calling
   already cited at supabase/functions/run-place-intelligence-trial/index.ts:1092.';
```

**Cost cite (COMMS-0003 — external-API docs):** Gemini 2.5 Flash per-Q2-call cost ~$0.0040 estimated from research doc §7 cost model (input ~6K tokens + output ~1K tokens, function-calling pricing per https://ai.google.dev/pricing/gemini-2-5-flash verified 2026-05-30 — same URL the existing trial fn cites at line 2224).

### §3.3 Layer 3 — Admin "Re-evaluate this place" button (LOCKED)

**Admin UI contract (verbatim — `mingla-admin/src/pages/PlacePoolManagementPage.jsx`):**

In `PlaceDetailModal` (line 354), after the existing `handleSave` (line 416), add:

```jsx
const [reeval, setReeval] = useState({ pending: false, error: null });

const handleReeval = async () => {
  setReeval({ pending: true, error: null });
  try {
    const { data, error } = await supabase.functions.invoke(
      "run-place-intelligence-trial",
      {
        body: { action: "admin_reeval_place", place_pool_id: place.id },
      },
    );
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    addToast({
      variant: "success",
      title: "Re-evaluation queued",
      description: `Gemini Q2 will run within ~1 min; deck refresh within ~16 min.`,
    });
    setReeval({ pending: false, error: null });
  } catch (e) {
    addToast({
      variant: "error",
      title: "Re-evaluation failed",
      description: e?.message ?? String(e),
    });
    setReeval({ pending: false, error: e?.message ?? String(e) });
  }
};
```

In `<ModalBody>` near the existing footer (`<Button variant="secondary" onClick={onClose}>Cancel</Button>` line 614), add a new section above the footer:

```jsx
{/* META-ORCH-1009 Sub-D — admin re-evaluate this place */}
<div className="border-t pt-4 mt-4">
  <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">
    AI signals
  </h4>
  <div className="flex items-center gap-3">
    <Button
      variant="secondary"
      loading={reeval.pending}
      disabled={reeval.pending}
      onClick={handleReeval}
    >
      Re-evaluate AI signals
    </Button>
    <span className="text-xs text-[var(--color-text-secondary)]">
      Forces a fresh Gemini Q2 read + rescore for this place. ~$0.004 each. Use when you suspect AI got it wrong.
    </span>
  </div>
  {place.ai_signal_scores && (
    <div className="text-xs text-[var(--color-text-tertiary)] mt-2">
      Last AI evaluated:{" "}
      {(() => {
        const slice = Object.values(place.ai_signal_scores)[0];
        return slice?.evaluated_at
          ? new Date(slice.evaluated_at).toLocaleString()
          : "—";
      })()}
    </div>
  )}
</div>
```

**Edge function contract (verbatim — `supabase/functions/run-place-intelligence-trial/index.ts`):**

In the action dispatcher around line 670 / case statements ~line 713, add:

```ts
case "admin_reeval_place":
  return await handleAdminReevalPlace(supabaseAdmin, body, supabaseServiceKey);
```

And the new handler (placed near `handleRunTrialForPlace` line 1373):

```ts
// META-ORCH-1009 Sub-D — admin-initiated single-place re-eval. Creates
// a synthetic parent run + 1 pending child + immediately kicks the
// worker. Server-side rate-limited: rejects with 429 if the same
// place_pool_id has any pending/running row in place_intelligence_trial_runs.
async function handleAdminReevalPlace(
  db: SupabaseClient,
  body: Record<string, unknown>,
  supabaseServiceKey: string,
): Promise<Response> {
  const placePoolId = body.place_pool_id as string | undefined;
  if (!placePoolId) return json({ error: "place_pool_id required" }, 400);

  // Rate-limit: refuse if any pending/running row exists for this place
  // (any source — admin city sweeps, drift triggers, or prior button clicks).
  const { count: inflight, error: inflightErr } = await db
    .from("place_intelligence_trial_runs")
    .select("id", { count: "exact", head: true })
    .eq("place_pool_id", placePoolId)
    .in("status", ["pending", "running"]);
  if (inflightErr) return json({ error: inflightErr.message }, 500);
  if ((inflight ?? 0) > 0) {
    return json({
      error: "rate_limited",
      message: "A re-evaluation is already pending or running for this place. Wait for it to complete.",
    }, 429);
  }

  // Resolve city_id from the place (needed for parent run row).
  const { data: place, error: placeErr } = await db
    .from("place_pool")
    .select("id, city_id, name")
    .eq("id", placePoolId)
    .maybeSingle();
  if (placeErr || !place) return json({ error: placeErr?.message ?? "place not found" }, 404);

  const runId = crypto.randomUUID();
  const { error: parentErr } = await db.from("place_intelligence_runs").insert({
    id: runId,
    city_id: place.city_id,
    city_name: "admin-reeval",
    mode: "admin_reeval",
    sample_size: 1,
    total_count: 1,
    estimated_cost_usd: 0.0040,
    estimated_minutes: 1,
    prompt_version: PROMPT_VERSION,
    model: GEMINI_MODEL_NAME_SHORT,
    started_by: null,
    status: "running",
    started_at: new Date().toISOString(),
  });
  if (parentErr) {
    if (parentErr.code === "23505") {
      return json({ error: "concurrent_run_for_city" }, 409);
    }
    return json({ error: parentErr.message }, 500);
  }

  const { error: childErr } = await db.from("place_intelligence_trial_runs").insert({
    run_id: runId,
    parent_run_id: runId,
    place_pool_id: placePoolId,
    city_id: place.city_id,
    signal_id: null,
    anchor_index: null,
    input_payload: {},
    status: "pending",
    prompt_version: PROMPT_VERSION,
    model: GEMINI_MODEL_NAME_SHORT,
    retry_count: 0,
    source: "admin-reeval-button",
  });
  if (childErr) {
    await db.from("place_intelligence_runs")
      .update({ status: "failed", error_reason: childErr.message, completed_at: new Date().toISOString() })
      .eq("id", runId);
    return json({ error: childErr.message }, 500);
  }

  // Immediate kick (same pattern as full_city mode line ~1322).
  if (supabaseServiceKey) {
    try {
      const workerUrl = `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/run-place-intelligence-trial`;
      fetch(workerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
        body: JSON.stringify({ action: "process_chunk", run_id: runId }),
      }).catch((e) => console.error(`[admin_reeval_place] kick failed: ${e}`));
    } catch (e) {
      console.error(`[admin_reeval_place] kick exception: ${e}`);
    }
  }

  return json({ ok: true, run_id: runId, place_pool_id: placePoolId });
}
```

### §3.4 Layer 4 — Quarterly backstop (LOCKED)

**NEW pg_cron job + helper (verbatim — in the Sub-D migration):**

```sql
CREATE OR REPLACE FUNCTION public.tg_meta_orch_1009_sub_d_quarterly_sweep()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  worker_url text;
  service_key text;
  sig text;
BEGIN
  SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  SELECT decrypted_secret INTO worker_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  IF service_key IS NULL OR worker_url IS NULL THEN
    RAISE NOTICE 'tg_meta_orch_1009_sub_d_quarterly_sweep: vault secrets missing, skipping tick';
    RETURN;
  END IF;
  worker_url := worker_url || '/functions/v1/run-signal-scorer';

  -- Iterate active signals; one HTTP per signal with all_cities=true.
  -- Spaced 60s apart by pg_sleep to avoid stacking 16 long-running
  -- worker invocations on the edge fn fleet.
  FOR sig IN SELECT id FROM public.signal_definitions WHERE is_active = true ORDER BY id LOOP
    PERFORM net.http_post(
      url := worker_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body := jsonb_build_object(
        'signal_id', sig,
        'all_cities', true,
        'source', 'meta-orch-1009-sub-d-quarterly-backstop'
      ),
      timeout_milliseconds := 60000
    );
    PERFORM pg_sleep(60);
  END LOOP;
END;
$$;

DO $cron_setup$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'meta_orch_1009_sub_d_quarterly_all_cities_sweep';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;

  PERFORM cron.schedule(
    'meta_orch_1009_sub_d_quarterly_all_cities_sweep',
    '0 4 1 */3 *',   -- 04:00 UTC, day 1, every 3rd month (Mar/Jun/Sep/Dec)
    $job$ SELECT public.tg_meta_orch_1009_sub_d_quarterly_sweep(); $job$
  );
END;
$cron_setup$;
```

### §3.5 Vault secrets pre-flight (LOCKED — at top of Sub-D migration)

Same pattern as `orch_0788` lines 31–55:

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'META-ORCH-1009 Sub-D: pg_cron extension required.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'META-ORCH-1009 Sub-D advisory: pg_net extension not enabled. Cron jobs will register but http_post calls fail until enabled.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RAISE NOTICE 'META-ORCH-1009 Sub-D advisory: vault schema not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url') THEN
    RAISE NOTICE 'META-ORCH-1009 Sub-D advisory: vault secret supabase_url missing. Add it before relying on the rescore-sweep cron.';
  ELSIF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
    RAISE NOTICE 'META-ORCH-1009 Sub-D advisory: vault secret service_role_key missing.';
  END IF;
END$$;
```

**Reference:** Supabase Cron docs — https://supabase.com/docs/guides/cron (verified 2026-05-30).

### §3.6 New invariant (LOCKED — verbatim body)

```markdown
### I-AI-SCORE-STALENESS-AUTO-RECOVERED (ACTIVE post META-ORCH-1009 Sub-D CLOSE)

**Statement:** No (place, signal) pair where `place_pool.ai_signal_scores`
contains an `evaluated_at` timestamp T may remain in `place_scores` with
`ai_signal_scores_at < T` (or `ai_signal_scores_at IS NULL while
ai_signal_scores has a v4-prompt entry) for longer than **20 min** after
the AI write lands. The 15-min `meta_orch_1009_sub_d_ai_score_rescore_sweep`
cron drains stale pairs in chunks of 500 per tick; the 5-min buffer
covers the case where a tick fires concurrently with an AI write.

**Authority:** the cron schedule + helper fn live in the Sub-D migration
`20260808000000_meta_orch_1009_sub_d_refresh_cron.sql`. The
`ai_signal_scores_at` column is written exclusively by
`supabase/functions/run-signal-scorer/index.ts` (sole-writer; enforced
by the Sub-D strict-grep gate).

**Rationale:** Sub-B's blend at write time created a deferred-update
contract — `place_scores` is correct ONLY as of the last
`run-signal-scorer` invocation, which was operator-clicked pre-Sub-D.
Sub-C's coverage backfill makes this contract untenable: 11K places
get fresh AI scores in one batch and the deck stays stale for hours
or days until manual click. Sub-D closes the loop automatically.

**Enforcement (3 gates):**
1. **DB probe gate** — post-Sub-D-apply admin probe `SELECT
   COUNT(*) FROM pg_meta_orch_1009_sub_d_select_stale_pairs(99999)
   WHERE ps.scored_at < now() - interval '20 minutes'` must return 0
   under steady-state load.
2. **Strict-grep CI gate** —
   `.github/scripts/strict-grep/meta-orch-1009-sub-d-ai-score-staleness-recovery.mjs`
   confirms the cron is registered in the Sub-D migration and that
   `ai_signal_scores_at` is written only by `run-signal-scorer/index.ts`.
3. **Edge-fn smoke test** — manual: trigger `admin_reeval_place` on
   one place; assert within 16 min the place's `place_scores.scored_at`
   AND `place_scores.ai_signal_scores_at` for the dominant signal
   advance to ≥ the new `ai_signal_scores -> signal -> evaluated_at`.

**Test that catches a regression:** any future code path that writes
to `place_scores` without setting `ai_signal_scores_at` (or with a
stale value) eventually trips gate 1 (the probe will surface lagging
rows once the next AI write lands for that place).

**Established:** 2026-05-30 by META-ORCH-1009 Sub-D CLOSE.

**Related invariants:**
- I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER (sibling — write side of `ai_signal_scores`)
- I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED (sibling — read side of the blend)
- I-CONSUMER-READS-AI-SIGNAL-SCORES-NOT-TRIAL-TABLE (sibling — what production reads from)
```

---

## §4 Acceptance tests per layer

### §4.1 Layer 1 — Detection + rescore cron

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| L1-01 | Column added | `\d+ place_scores` | `ai_signal_scores_at timestamptz` (nullable) present | Schema |
| L1-02 | Helper fn returns stale pairs | `SELECT COUNT(*) FROM pg_meta_orch_1009_sub_d_select_stale_pairs(99999)` immediately post-migration | Returns at least 988 (live probe 2026-05-30) | Data |
| L1-03 | Cron job registered + schedule correct | `SELECT schedule FROM cron.job WHERE jobname='meta_orch_1009_sub_d_ai_score_rescore_sweep'` | `*/15 * * * *` | Schema |
| L1-04 | Per-place mode rejects when both `place_ids` + `all_cities=true` | POST `run-signal-scorer` with both set | 400 with `mutually exclusive` error | Edge fn |
| L1-05 | Per-place mode rejects > 1000 ids | POST `run-signal-scorer` with `place_ids` length 1001 | 400 with `place_ids length > 1000` | Edge fn |
| L1-06 | Per-place mode runs scorer on exactly that set | POST with `place_ids: [<known-stale-place>], signal_id: 'romantic'` | Returns `scored_count: 1` (or `vetoed_count: 1`), no other places touched | Edge fn |
| L1-07 | `ai_signal_scores_at` populated on write | After L1-06, `SELECT ai_signal_scores_at FROM place_scores WHERE place_id=<known> AND signal_id='romantic'` | Equals `place_pool.ai_signal_scores->'romantic'->>'evaluated_at'` cast to timestamptz | Data |
| L1-08 | Rule-only path leaves `ai_signal_scores_at` NULL | Run scorer on a place with `ai_signal_scores IS NULL` | `place_scores.ai_signal_scores_at IS NULL` for that row | Data |
| L1-09 | Cron sweep tick drains stale pairs | Simulate by calling `tg_meta_orch_1009_sub_d_kick_rescores()` once; wait 60s; re-run L1-02 | Stale count drops by ≤500 per tick | Data |
| L1-10 | Cron sweep produces no HTTP fires on empty staleness | Run scorer on every stale pair first (drain to 0); call kicker | No `net.http_post` rows; quiet exit | Edge fn / pg_net log |

### §4.2 Layer 2 — Drift trigger

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| L2-01 | Trigger registered | `\dft tg_place_pool_drift_queue_reeval` | Present on `place_pool` AFTER UPDATE OF 3 columns | Schema |
| L2-02 | `source` column + CHECK added | `\d+ place_intelligence_trial_runs` | `source TEXT` nullable + CHECK on 2 values | Schema |
| L2-03 | Partial unique idx added | `\di idx_pit_runs_drift_reeval_one_per_place` | Present, `WHERE source='auto-refresh-drift' AND status IN ('pending','running')` | Schema |
| L2-04 | business_status change on AI-evaluated place queues a row | UPDATE `place_pool` set business_status='CLOSED_TEMPORARILY' WHERE id=<known-with-ai>; SELECT FROM place_intelligence_trial_runs WHERE place_pool_id=<known> AND source='auto-refresh-drift' | 1 pending row | Trigger |
| L2-05 | Editorial summary change queues a row | Same as L2-04 with editorial_summary | 1 pending row | Trigger |
| L2-06 | Generative summary change queues a row | Same with generative_summary | 1 pending row | Trigger |
| L2-07 | No-op UPDATE does NOT queue | UPDATE without changing the 3 columns | 0 new rows | Trigger |
| L2-08 | Change on NULL-AI place does NOT queue | UPDATE business_status on a row with `ai_signal_scores IS NULL` | 0 new rows | Trigger |
| L2-09 | Change on non-servable place does NOT queue | UPDATE on a row with `is_servable=false` | 0 new rows | Trigger |
| L2-10 | Second drift before first completes does NOT duplicate | Two back-to-back UPDATEs to business_status while first row still pending | Still 1 row (partial unique idx absorbs) | Trigger |
| L2-11 | Queued row picked up by `kick_pending_trial_runs` | Wait 1 min after L2-04; SELECT status FROM the queued row | `running` or `completed` (not still `pending`) | Cron + worker |
| L2-12 | Concurrent city run absorbs the trigger gracefully | While a city run is `running` for cityX, UPDATE business_status on a place in cityX | Trigger silently exits (parent insert hits unique violation, caught); no error in logs | Trigger |

### §4.3 Layer 3 — Admin button

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| L3-01 | Button renders in modal | Open PlaceDetailModal for any place | "Re-evaluate AI signals" button visible | UI |
| L3-02 | Click queues a single-place run | Click button; observe network call | POST to `run-place-intelligence-trial` with `action: 'admin_reeval_place'` returns 200 with `{ok:true, run_id, place_pool_id}` | UI + Edge fn |
| L3-03 | Rate-limit fires on second click while first running | Click; immediately click again | Second call returns 429 with `rate_limited` toast | Edge fn |
| L3-04 | "AI evaluated:" shows refreshed timestamp after completion | Wait ~1 min; reload modal; check timestamp | Newer than pre-click | UI + DB |
| L3-05 | `source='admin-reeval-button'` recorded | After L3-02, SELECT source FROM place_intelligence_trial_runs WHERE place_pool_id=<id> ORDER BY created_at DESC LIMIT 1 | `admin-reeval-button` | Data |
| L3-06 | Missing place_pool_id → 400 | POST without place_pool_id | 400 with `place_pool_id required` | Edge fn |
| L3-07 | Unknown place_pool_id → 404 | POST with `00000000-0000-0000-0000-000000000000` | 404 with `place not found` | Edge fn |

### §4.4 Layer 4 — Quarterly backstop

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| L4-01 | Quarterly cron registered + schedule | `SELECT schedule FROM cron.job WHERE jobname='meta_orch_1009_sub_d_quarterly_all_cities_sweep'` | `0 4 1 */3 *` | Schema |
| L4-02 | Helper fn iterates active signals + pauses 60s | Manual: `SELECT public.tg_meta_orch_1009_sub_d_quarterly_sweep();` (test only — operator runs once post-apply to confirm) | Returns void; cron.job_run_details shows 16 http_post calls (one per active signal); total runtime ≥ 15 min (16 × 60s sleep) | Cron / pg_net |
| L4-03 | Idempotent — re-running scorer on already-scored rows produces same final state | Run quarterly sweep twice in succession; `SELECT MAX(scored_at), COUNT(*) FROM place_scores` | Counts unchanged; only `scored_at` advances | Data |

### §4.5 Cross-layer end-to-end

| Test | Scenario | Input | Expected |
|------|----------|-------|----------|
| E2E-01 | Drift → re-eval → rescore | UPDATE business_status on a known AI-evaluated place; wait 20 min; verify `place_pool.ai_signal_scores -> $dom_signal ->> 'evaluated_at'` advanced AND `place_scores.ai_signal_scores_at` for that pair advanced | Both timestamps newer than start | Triggers + 2 crons |
| E2E-02 | Admin button → re-eval → rescore | Click "Re-evaluate AI signals"; wait 20 min | Same as E2E-01 |
| E2E-03 | Sub-C batch → rescore | (operator-driven Sub-C run) writes new AI scores for N places; wait 20 min | All N places have `place_scores.ai_signal_scores_at` advanced; staleness probe returns 0 |
| E2E-04 | I-AI-SCORE-STALENESS-AUTO-RECOVERED holds | After 24h steady-state, `SELECT COUNT(*) FROM pg_meta_orch_1009_sub_d_select_stale_pairs(99999) WHERE ps.scored_at < now() - interval '20 minutes'` | Returns 0 |

---

## §5 Invariants

**Established in this sub:**
- `I-AI-SCORE-STALENESS-AUTO-RECOVERED` — ACTIVE on Sub-D merge (verbatim body in §3.6).

**Preserved (this sub does NOT touch):**
- `I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER` — preserved; Sub-D writes ONLY `place_scores.ai_signal_scores_at` (a NEW column), never `place_pool.ai_signal_scores`. The drift trigger queues into `place_intelligence_trial_runs` and the existing trial worker writes `ai_signal_scores` via the Sub-A path — sole-owner contract intact.
- `I-AI-SIGNAL-SCORES-SHAPE-CONTRACT` — preserved; Sub-D reads `evaluated_at` from the existing shape without modifying it.
- `I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED` — preserved; Sub-D's rescore is just a re-invocation of the same Sub-B blend logic.
- `I-CONSUMER-READS-AI-SIGNAL-SCORES-NOT-TRIAL-TABLE` — preserved; Sub-D writes to `place_scores` via `run-signal-scorer` (unchanged consumer-side surface).
- `I-COLLAB-DECK-DETERMINISM-PRESERVED-UNDER-AI-BLEND` — preserved; rescores still feed `place_scores.score` which is the deterministic input set per session V_n.
- `I-TRIAL-RUN-SCOPED-TO-CITY` — preserved; drift-trigger inserts use the place's `city_id` for the parent run row, matching the existing per-city scoping.

**No invariant retracted.**

---

## §6 Out of scope (explicit non-goals)

- **Sub-E (business app feeder)** — supply-side ingestion of business-claimed venues. Separate dispatch.
- **Sub-F (single-brand experiences)** — multi-stop brand-curated decks. Separate dispatch.
- **ANY consumer-mobile change** — zero `app-mobile/src/` edits in Sub-D. The deck reads `place_scores` via the existing RPCs; auto-rescore is transparent to the client.
- **ANY change to signalScorer.ts blend math** — Sub-B owns the blend formula. Sub-D only threads `evaluated_at` through the `ai_blended` slice (Sub-B already constructed it; Sub-D adds one passthrough field).
- **ANY change to Sub-A's `ai_signal_scores` write path** — preserved verbatim. Sub-D's drift trigger inserts into `place_intelligence_trial_runs`; the existing trial-pipeline worker (unchanged) writes `ai_signal_scores` via Sub-A's sole-owner path.
- **Drop / archive of `place_intelligence_trial_runs.q2_response`** — the trial log remains immutable per Sub-A's audit contract.
- **Webhook / event-stream integration with Google Places** — drift detection is INTERNAL (Postgres trigger on the `place_pool` row our ingest pipeline updates); we do not subscribe to Google webhooks.
- **Cost dashboard / billable attribution** — Sub-D writes a `source` column that ENABLES this, but the dashboard itself is a future ORCH (flagged in §7 Decision 3).
- **Backfill of `place_scores.ai_signal_scores_at` for the 26,682 existing pairs** — left NULL by design; the first cron tick after Sub-D apply will rescore them all (which is the correct behavior — every existing pair IS "stale" against Sub-A's just-landed AI slice that Sub-B blended without recording the timestamp).
- **RLS changes on `place_scores` or `place_intelligence_trial_runs`** — none. Drift trigger + admin button both run as SECURITY DEFINER (trigger fn) or service-role (admin button via edge fn), bypassing RLS as intended.

---

## §7 Decisions (judgment calls — operator review opportunities)

### Decision 1 (LOCKED): Cron interval 15 min (not 5 min, not 60 min)

**Chosen:** `*/15 * * * *`.
**Rejected:** `*/5 * * * *` (operator-recommended cadence per `orch_0788`), `0 * * * *` (hourly, simpler).
**Rationale:** Sub-C backfill produces bursts of ~500–2,000 new AI evaluations within a single operator session. A 5-min cron would fire 3× during a typical Sub-C round, each firing 500 place-id requests to `run-signal-scorer` — risks edge-fn rate-limits + duplicated work on rows the operator is still actively writing. 60-min cron leaves the deck stale longer than the operator's natural "did it work?" check cycle (5–10 min). 15 min is the sweet spot: usually catches the tail of a Sub-C burst on the next tick, gives the deck a same-session refresh, and stays well under the per-place idempotency window. Operator-locked at 15 min per dispatch.
**Reversal path:** if Sub-C bursts exceed 5K AI writes/tick, tighten to `*/10`. If the deck staleness window is acceptable longer, relax to `*/30`. One-line `cron.unschedule` + `cron.schedule` in a follow-up migration.

### Decision 2 (LOCKED): Chunking strategy when 10K+ rows are dirty

**Chosen:** Per-tick LIMIT 500 in the stale-pairs helper; oldest-stale-first ordering drains over successive ticks.
**Rejected:** Process the full backlog in one tick (risks worker timeout — `run-signal-scorer` takes ~30s for 500 places per Sub-B `bucketize` log); split into 16 per-signal HTTP calls per tick regardless of need (wastes edge-fn invocations).
**Rationale:** At 500 pairs/tick × 96 ticks/day = 48K pairs/day drain capacity. Even the worst-case Sub-C round (13,671 servable × 16 signals = 218K pairs if Sub-C re-evaluated everything from scratch) drains within 5 days, with the live deck improving every 15 min along the way. Within-tick: we bucket by `signal_id` so if 4 signals have dirty pairs, 4 HTTP requests fire (one per signal), not 500 individual ones. Within-request: `run-signal-scorer` already chunks at BATCH_SIZE 500 (unchanged).
**Reversal path:** if 5-day drain is unacceptable, raise the LIMIT to 1000 (matches the per-place mode upper bound in §3.1 validation) and pair with a `*/10` cadence.

### Decision 3 (OPEN — operator review opportunity): Drift-triggered Q2 re-eval cost attribution

**Question:** Each drift-triggered re-eval costs ~$0.0040 in Gemini Q2 (input ~6K tokens + output ~1K tokens at the 2026-05-30 https://ai.google.dev/pricing/gemini-2-5-flash rate). At the live drift rate (we have no data because Sub-D adds the trigger), this is likely negligible (<$1/month). But Google's `editorial_summary` and `generative_summary` are AI-generated text that can drift on every Google ingestion cycle even when the venue hasn't materially changed — risk of spurious re-evaluations.
**Sub-D codes:** the trigger fires; the cost is borne; the `source='auto-refresh-drift'` tag in `place_intelligence_trial_runs` lets ops attribute it.
**Operator decision needed (NOT blocking Sub-D):** post-launch, monitor the count of drift-triggered runs per week. If > 1,000 / week (~$4/week / $200/year), consider tightening the trigger to ONLY `business_status` changes (the operationally-meaningful one). The other two are AI-generated metadata that may drift cosmetically. Flagged for Sub-D + 30 days observation, then orchestrator triage.

### Decision 4 (LOCKED): Per-place rate-limit policy — server-side, any inflight row blocks

**Chosen:** Reject `admin_reeval_place` with 429 if ANY pending OR running row exists in `place_intelligence_trial_runs` for that `place_pool_id` (any source — drift, admin button, or city sweep).
**Rejected:** Per-click cooldown timer (e.g., 5 min) regardless of inflight state; operator-allows-override via a `force=true` body param.
**Rationale:** The expensive resource is the Gemini Q2 call (not the click). If a city sweep is running for this place's city, the place will be evaluated as part of the sweep within minutes — a 429 + "wait for it to complete" toast costs the operator a 5-min wait but avoids duplicating $0.0040 + worker queue contention. If a drift trigger queued the place at the same instant the operator clicked, the 429 fires once and the user retries 30s later. The error message tells the operator WHY ("A re-evaluation is already pending or running for this place. Wait for it to complete."), which is more useful than a generic cooldown.
**Reversal path:** if operator finds the rate-limit too aggressive, add `?force=true` body param that bypasses the inflight check (still single-place-per-click — never bulk). Future enhancement.

### Decision 5 (LOCKED): Quarterly backstop = 90 days at 04:00 UTC

**Chosen:** `0 4 1 */3 *` (04:00 UTC on day 1 of every 3rd calendar month).
**Rejected:** Rolling 90-day window per signal (more complex, marginal benefit); daily backstop (defeats Sub-D's optimization).
**Rationale:** 04:00 UTC = US-East midnight / US-West 21:00 — off-peak for both the consumer deck and the admin team. Calendar quarter is the documented "quarterly" cadence from research §9 Q6. Quarterly is the safety net for "did the trigger miss something we don't yet know about" — a daily backstop would defeat Sub-D's selectivity gains.
**Reversal path:** change schedule string in one-line `cron.unschedule` + `cron.schedule` migration.

### Decision 6 (FLAG for orchestrator — not blocking): The first sweep post-Sub-D-apply will rescore ~26,682 pairs

**Observation:** Live probe 2026-05-30 shows 988 currently-stale pairs (places where `scored_at < ai_evaluated_at`). HOWEVER, ALL 26,682 (place, signal) pairs in `place_scores` that ALSO have AI scores in `place_pool.ai_signal_scores` will have `ai_signal_scores_at IS NULL` immediately post-Sub-D-apply (the new column defaults to NULL). The helper `pg_meta_orch_1009_sub_d_select_stale_pairs` treats `IS NULL` as stale, so the first cron tick will see 26,682 dirty pairs and start draining them at 500/tick.
**Drain time:** 26,682 / 500 = 54 ticks × 15 min = ~13.5 hours.
**Risk:** edge-fn invocation rate (~32/hour assuming all 16 signals dirty) is well within Supabase Free tier limits but during the drain window the deck will see a brief blend re-derivation per place. The blend math is identical to Sub-B's; the OUTPUT score is identical for any pair whose AI slice hasn't changed since Sub-B's last run. So the 13.5h drain is effectively a no-op on the deck — just stamping `ai_signal_scores_at`.
**Operator advisory:** apply the migration during a low-traffic window (early AM operator time). Monitor `cron.job_run_details` for the first 24h. If desired, run a one-shot manual UPDATE pre-apply: `UPDATE place_scores SET ai_signal_scores_at = (SELECT (pp.ai_signal_scores -> ps.signal_id ->> 'evaluated_at')::timestamptz FROM place_pool pp WHERE pp.id = ps.place_id) WHERE ps.place_id IN (SELECT id FROM place_pool WHERE ai_signal_scores IS NOT NULL)` — this would seed the column from the existing live AI slice in one transaction and the first cron tick would only see the actual-stale 988 pairs. SPEC leaves this as OPTIONAL because it duplicates the cron's work and complicates rollback.

---

## §8 Cross-Surface Impact (Phase 2.5 mandatory section)

| Surface | Covered? | What changes | Files touched | Parity model |
|---|---|---|---|---|
| Consumer iOS (`app-mobile/` iOS) | NOT COVERED | No user-visible change in Sub-D | none | Auto-rescore propagates via shared `place_scores` table; deck rendering unchanged. |
| Consumer Android (`app-mobile/` Android) | NOT COVERED | No user-visible change in Sub-D | none | Same as iOS. |
| Buyer/anonymous Web (`mingla-business/` checkout/event/brand routes) | NOT COVERED | No surface dependency | none | n/a. |
| Business iOS (`mingla-business/` iOS) | NOT COVERED | No surface dependency | none | n/a. |
| Business Android (`mingla-business/` Android) | NOT COVERED | Same as Business iOS | none | n/a. |
| Admin Web (`mingla-admin/`) | COVERED | NEW "Re-evaluate AI signals" button + "Last AI evaluated" timestamp in `PlaceDetailModal` | `mingla-admin/src/pages/PlacePoolManagementPage.jsx` (~43 lines) | Desktop-only surface; mobile-admin is N/A (no mobile admin app). Web responsive layout follows existing Modal patterns. |
| Mingla business web preview | NOT COVERED | n/a | none | n/a. |

**Conclusion:** Sub-D ships ONE user-touchable surface: the admin re-evaluate button on the desktop admin web. All other paths are pure infrastructure (cron + trigger + helper fn + 1 column + 1 edge-fn parameter extension). Tester must verify the admin button via live click on the deployed admin web; the cron + trigger paths verify via SQL probes against the migrated DB.

---

## §9 Implementation order

1. **Write the Sub-D migration** `20260808000000_meta_orch_1009_sub_d_refresh_cron.sql` — DDL + `pg_meta_orch_1009_sub_d_select_stale_pairs` + `tg_meta_orch_1009_sub_d_kick_rescores` + cron schedule + trigger fn + `source` column + CHECK + partial unique index + quarterly backstop fn + cron schedule + vault pre-flight DO block + final NOTICE probes.
2. **Extend `run-signal-scorer/index.ts`** with per-place mode (validation + SELECT path) AND `ai_signal_scores_at` write column. Update Deno tests under `supabase/functions/_shared/__tests__/signalScorer.blend.test.ts` to assert `evaluated_at` is passed through (Sub-B's tests already exist — add 1 case).
3. **Extend `_shared/signalScorer.ts`** with the `evaluated_at` field on `ScoreResult.ai_blended` (1-line change).
4. **Add the `admin_reeval_place` action** to `run-place-intelligence-trial/index.ts` (dispatcher + `handleAdminReevalPlace` helper).
5. **Edit `PlacePoolManagementPage.jsx`** — button + handler + state + timestamp display.
6. **Write the strict-grep CI gate** `.github/scripts/strict-grep/meta-orch-1009-sub-d-ai-score-staleness-recovery.mjs` and register in workflow.
7. **Apply the migration via `supabase db push --linked`** (per [[autonomy-posture-verifier-not-manager]] memory rule). Capture apply NOTICEs.
8. **Pre-deploy vault sanity:** confirm `vault.decrypted_secrets` has both `supabase_url` AND `service_role_key` rows (live probe 2026-05-30: both present per orch_0788 — should be no-op).
9. **Deploy 2 edge functions:** `supabase functions deploy run-signal-scorer` AND `supabase functions deploy run-place-intelligence-trial`.
10. **Verify Layer 1 acceptance** L1-01 → L1-10 (DB probes + Deno tests + one live HTTP smoke against `run-signal-scorer` with `place_ids: [<known-stale>]`).
11. **Verify Layer 2 acceptance** L2-01 → L2-12 (SQL UPDATEs that fire the trigger + assertions on the queue table). Use a sacrificial test place — revert any test UPDATEs after.
12. **Verify Layer 3 acceptance** L3-01 → L3-07 (admin UI click + DB read + error-path simulation).
13. **Verify Layer 4 acceptance** L4-01 (cron registered). L4-02 + L4-03 deferred to first quarterly run (manual one-shot test optional via `SELECT public.tg_meta_orch_1009_sub_d_quarterly_sweep();` in a low-traffic window).
14. **Run E2E-01 + E2E-02** (one UPDATE + one button click, 20-min wait each, verify timestamps advance).
15. **Update `INVARIANT_REGISTRY.md`** with the new invariant per §3.6 verbatim.
16. **Append `DEC-183` to `DECISION_LOG.md`** per §2.7.
17. **Hand off to orchestrator for PR + REVIEW + tester dispatch.**

---

## §10 Regression prevention

| Risk class | Safeguard | Evidence |
|---|---|---|
| Future code path writes `place_scores.ai_signal_scores_at` outside `run-signal-scorer` | Strict-grep CI gate §2.5 | CI red on any new `.update({ ai_signal_scores_at` or `.upsert([..., ai_signal_scores_at:` outside the allowed file |
| Future code path forgets to write `ai_signal_scores_at` after AI evaluation | The cron sweep treats `ai_signal_scores_at IS NULL` AS stale → auto-recovers within 15 min | Helper fn §3.1 query handles `IS NULL` branch |
| Drift trigger creates runaway insert loop (e.g. Google ingestion in a loop) | Partial unique idx `idx_pit_runs_drift_reeval_one_per_place` caps at 1 pending+running per place | DB will reject duplicates (silent ON CONFLICT DO NOTHING) |
| Cron + admin button + city sweep all queue the same place simultaneously | Admin button rate-limit (§3.3) catches the racing-click case; drift partial unique idx catches the racing-trigger case; city run unique-per-city idx catches the racing-sweep case | 3 distinct DB constraints |
| Per-place mode in `run-signal-scorer` accepts an unbounded list | 1000-id cap with 400 error | §3.1 validation |
| Quarterly backstop runs while a manual all-cities sweep is also running | Both call `run-signal-scorer` with the same payload shape; the upserts are idempotent (ON CONFLICT DO UPDATE on `(place_id, signal_id)`) — last-write-wins on identical input is a no-op | Sub-B existing `place_scores` upsert pattern |
| Vault secrets missing when cron fires | All cron-driven fns exit quietly with RAISE NOTICE; no error spam; operator restoration of vault secrets resumes service on next tick | Same pattern as orch_0788 |

---

## §11 Discoveries for orchestrator (side issues found during spec write — NOT in Sub-D scope)

1. **988 pairs stale TODAY**, pre-Sub-D-apply. These are real drift that's already in production (Sub-C-style backfills the operator ran without immediately clicking the scorer afterwards). Sub-D's first sweep clears them — no action needed. Flagged so operator knows the cron isn't starting from zero load.
2. **10,588 (place, signal) pairs have AI scores but NO existing `place_scores` row.** These were never rule-scored (place was added post-rule-sweep, or rule scorer hasn't run for that signal yet). The Sub-D sweep will create those rows on first tick — counts toward Decision 6's drain estimate.
3. **`place_intelligence_runs.mode`** today has no CHECK constraint listing valid values. Sub-D adds `'drift_reeval'` and `'admin_reeval'` as new modes without a CHECK — consistent with existing behavior (existing values are `'sample'`, `'full_city'`, `'remainder'`, all uncontrolled). Future cleanup ORCH could add a CHECK; not Sub-D scope.
4. **`pg_intelligence_coverage` (ORCH-1017) exposes coverage % per city.** Could be extended to include "stale pairs %" once Sub-D ships — feeds the same admin dashboard. Future enhancement; flagged for Sub-C / admin-UI iteration.
5. **The `kick_pending_trial_runs` cron at `* * * * *`** (every minute) picks up the drift-triggered pending rows promptly (median 30s after the trigger fires). The Sub-D 15-min rescore cron then picks up the Sub-A-written `ai_signal_scores` advance ~7.5 min median later — total drift→deck latency median ≈ 8 min, worst case 16 min (matching the I-AI-SCORE-STALENESS-AUTO-RECOVERED 20-min budget with 4-min headroom).
6. **No live Sub-C dispatch exists yet.** Sub-D's value is fully realized only when Sub-C starts producing AI score backfills. Until Sub-C runs, the only AI writes come from operator-triggered city sweeps via the admin UI (Sub-A path). The Sub-D infrastructure is still useful — it eliminates the manual click between Sub-A trial runs and Sub-B deck refresh — but the deck-staleness gain scales with Sub-C volume.

---

## §12 Confidence note

- **Codebase claims:** `proven` for the `run-signal-scorer` request shape (read in full lines 1–287), `proven` for the `run-place-intelligence-trial` dispatcher + `handleRunTrialForPlace` + `handleStartRun` patterns (read lines 670–740 + 1240–1320 + 1370–1430 in full), `proven` for the admin `PlaceDetailModal` structure (read lines 354–420 in full), `proven` for the `orch_0788` pg_cron + pg_net + vault pattern (read full migration in full).
- **DB claims:** `proven` — every row count + column shape came from live `mcp__supabase__execute_sql` against production on 2026-05-30. 988 stale pairs / 26,682 total pairs / 37,270 AI pairs / 2,366 places with AI / 7 non-OPERATIONAL all confirmed.
- **Prior artifact claims:** `proven` for Sub-A spec + Sub-B spec (read in full as Sub-D context), `proven` for research §9 Q6 (read verbatim).
- **External research claims:** `proven` for the Supabase pg_cron docs URL (verified 2026-05-30), `proven` for the Gemini 2.5 Flash pricing URL (cited at existing edge fn line 2224).
- **DEC-183 numbering:** `proven` — max existing is DEC-182 (Sub-B close).

No `proven` claim is contradicted by a `probable` or `suspected` claim.

---

**End of SPEC.**
