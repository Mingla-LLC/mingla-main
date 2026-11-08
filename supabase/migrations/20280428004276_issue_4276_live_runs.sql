-- Issue #4276 (live runs): a city run that waits out a rate limit instead of pausing,
-- and one read that shows every run live.
--
-- Abuja's first run (2026-11-07) paused after 118 of 4,536 searches: the edge runtime
-- rate-limits one function calling another, the conductor counted that as a failure,
-- and three such ticks paused the run with stage_error. Nothing on the admin page said
-- whether a run was moving.
--
-- 1. city_pipeline_runs gets three columns the conductor writes on every tick:
--      last_progress_at  when a tick last moved a stage forward;
--      last_outcome      what the last tick did and why
--                        {kind, why, retry_after_ms, at, calls};
--      next_attempt_at   when a run waiting out a rate limit may be ticked again.
-- 2. city_pipeline_claim_tick (latest definition: 20280410034276) skips a running run
--    whose next_attempt_at is still ahead. It already returns the whole row, so the
--    conductor reads the lease it was given (lease_until) and only clears that lease.
-- 3. tg_kick_city_pipeline (latest definition: 20280410034276) does not post while the
--    only running run is waiting out its next_attempt_at, so a waiting run costs nothing.
-- 4. admin_city_pipeline_live(p_days): every active run and every run finished in the
--    last p_days, with its stages and each stage's progress read from the child run
--    (seeding_runs, photo_backfill_runs, place_intelligence_runs). Admins only
--    (is_admin_user()), read-only, one statement.
--
-- Static SQL only. Nothing here raises a conflict; there is no 40001 anywhere.
--
-- Rollback:
--   DROP FUNCTION public.admin_city_pipeline_live(integer);
--   re-run city_pipeline_claim_tick and tg_kick_city_pipeline from
--   20280410034276_issue_4276_city_pipeline_conductor.sql;
--   ALTER TABLE public.city_pipeline_runs DROP COLUMN next_attempt_at,
--     DROP COLUMN last_outcome, DROP COLUMN last_progress_at;
--   (drop the columns only after the conductor that writes them is rolled back).

BEGIN;

ALTER TABLE public.city_pipeline_runs
  ADD COLUMN last_progress_at timestamptz,
  ADD COLUMN last_outcome jsonb,
  ADD COLUMN next_attempt_at timestamptz;

COMMENT ON COLUMN public.city_pipeline_runs.last_progress_at IS
  'Issue #4276: when a tick last moved a stage forward (a batch finished, a cursor moved, a stage ended).';
COMMENT ON COLUMN public.city_pipeline_runs.last_outcome IS
  'Issue #4276: what the last tick did: {kind: progress|wait|budget|approval|pause|error|complete, why, retry_after_ms, at, calls}.';
COMMENT ON COLUMN public.city_pipeline_runs.next_attempt_at IS
  'Issue #4276: a run waiting out a function rate limit is not ticked again before this.';

-- Promotes the oldest queued run when nothing is running, then leases one run. A run
-- whose tick died keeps its lease only until the lease runs out. A run waiting out a
-- rate limit is left alone until next_attempt_at.
CREATE OR REPLACE FUNCTION public.city_pipeline_claim_tick(p_lease_seconds integer DEFAULT 170)
RETURNS SETOF public.city_pipeline_runs
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.city_pipeline_runs WHERE status = 'running') THEN
    BEGIN
      UPDATE public.city_pipeline_runs r
         SET status = 'running',
             started_at = COALESCE(r.started_at, now()),
             pause_reason = NULL,
             pause_detail = NULL,
             updated_at = now()
       WHERE r.id = (
         SELECT q.id FROM public.city_pipeline_runs q
          WHERE q.status = 'queued'
          ORDER BY q.updated_at, q.created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       );
    EXCEPTION WHEN unique_violation THEN
      NULL; -- another tick promoted one first
    END;
  END IF;

  RETURN QUERY
  UPDATE public.city_pipeline_runs r
     SET lease_until = now() + make_interval(secs => p_lease_seconds),
         last_tick_at = now(),
         updated_at = now()
   WHERE r.id = (
     SELECT c.id FROM public.city_pipeline_runs c
      WHERE c.status = 'running'
        AND (c.lease_until IS NULL OR c.lease_until < now())
        AND (c.next_attempt_at IS NULL OR c.next_attempt_at <= now())
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   )
  RETURNING r.*;
END;
$$;

-- Posts only when a person's run is waiting and may be ticked now, so an idle cron, or
-- a run waiting out a rate limit, costs nothing and can't start anything.
CREATE OR REPLACE FUNCTION public.tg_kick_city_pipeline()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.city_pipeline_runs
     WHERE status = 'queued'
        OR (status = 'running'
            AND (lease_until IS NULL OR lease_until < now())
            AND (next_attempt_at IS NULL OR next_attempt_at <= now()))
  ) THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'tg_kick_city_pipeline: vault is missing supabase_url or service_role_key, skipping tick';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/run-city-pipeline',
    body := jsonb_build_object('action', 'tick'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    timeout_milliseconds := 150000
  );
END;
$$;

-- ── The live read ───────────────────────────────────────────────────────────
-- One statement. Spend comes from the same ledger the conductor checks
-- (city_pipeline_spend_ledger), held places from city_pipeline_place_counts. Each
-- stage's progress reads its child run: the cursor's id, else the last id in refs.
-- Search progress adds up every seeding run the stage started, so rounds add up.
CREATE OR REPLACE FUNCTION public.admin_city_pipeline_live(p_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'runs', COALESCE((
      SELECT jsonb_agg(x.run ORDER BY x.active_rank, x.created_at DESC, x.id)
      FROM (
        SELECT
          r.id,
          r.created_at,
          CASE WHEN r.status IN ('queued', 'running', 'paused', 'awaiting_approval') THEN 0 ELSE 1 END AS active_rank,
          jsonb_build_object(
            'id', r.id,
            'city_id', r.city_id,
            'city_name', c.name,
            'country', c.country,
            'status', r.status,
            'current_stage', r.current_stage,
            'pause_reason', r.pause_reason,
            'pause_detail', r.pause_detail,
            'spend_limit_usd', r.spend_limit_usd,
            'spent_usd', COALESCE((ledger.v ->> 'known_actual_usd')::numeric, 0),
            'serper_requests', COALESCE((ledger.v ->> 'serper_requests')::bigint, 0),
            'last_tick_at', r.last_tick_at,
            'last_progress_at', r.last_progress_at,
            'last_outcome', r.last_outcome,
            'next_attempt_at', r.next_attempt_at,
            'error_streak', r.error_streak,
            'last_error', r.last_error,
            'rules_only', r.rules_only,
            'created_at', r.created_at,
            'started_at', r.started_at,
            'completed_at', r.completed_at,
            'held_places', COALESCE((counts.v ->> 'held')::bigint, 0),
            'stages', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'stage', s.stage,
                'ord', s.ord,
                'status', s.status,
                'started_at', s.started_at,
                'completed_at', s.completed_at,
                'estimate', s.estimate,
                'result', s.result,
                'approval', s.approval,
                'progress', CASE
                  WHEN s.stage IN ('fill', 'split') THEN seed.progress
                  WHEN s.stage = 'photos' THEN photo.progress
                  WHEN s.stage = 'intelligence' THEN intel.progress
                  WHEN s.stage IN ('pre_check', 'final_check') AND s.status IN ('running', 'complete') THEN
                    jsonb_build_object(
                      'kind', 'check',
                      'processed', COALESCE(s.cursor -> 'processed', s.result -> 'processed')
                    )
                  WHEN s.stage = 'score' AND s.cursor ? 'signal_index' THEN
                    jsonb_build_object(
                      'kind', 'score',
                      'signal_index', s.cursor -> 'signal_index',
                      'signals', CASE WHEN jsonb_typeof(s.cursor -> 'signals') = 'array'
                                      THEN to_jsonb(jsonb_array_length(s.cursor -> 'signals')) END,
                      'written', s.cursor -> 'written'
                    )
                  WHEN s.stage = 'completeness' AND s.status IN ('running', 'complete') THEN
                    jsonb_build_object('kind', 'completeness')
                      || CASE WHEN jsonb_typeof(s.result) = 'object' THEN s.result ELSE '{}'::jsonb END
                END
              ) ORDER BY s.ord)
              FROM public.city_pipeline_stages s
              -- Search: every seeding run in refs plus the cursor's, summed; the status
              -- is the current child's.
              LEFT JOIN LATERAL (
                SELECT CASE WHEN count(sr.id) = 0 THEN NULL ELSE jsonb_build_object(
                  'kind', 'search',
                  'done', COALESCE(sum(sr.completed_batches), 0),
                  'failed', COALESCE(sum(sr.failed_batches), 0),
                  'total', COALESCE(sum(sr.total_batches), 0),
                  'places_new', COALESCE(sum(sr.total_places_new), 0),
                  'places_duped', COALESCE(sum(sr.total_places_duped), 0),
                  'cost_usd', COALESCE(sum(sr.total_cost_usd), 0),
                  'child_status', max(sr.status) FILTER (WHERE sr.id::text = COALESCE(
                    NULLIF(s.cursor ->> 'seeding_run_id', ''),
                    s.refs -> 'seeding_run_ids' ->> -1
                  ))
                ) END AS progress
                FROM public.seeding_runs sr
                WHERE s.stage IN ('fill', 'split')
                  AND sr.id IN (
                    SELECT ids.v::uuid
                    FROM jsonb_array_elements_text(
                      CASE WHEN jsonb_typeof(s.refs -> 'seeding_run_ids') = 'array'
                           THEN s.refs -> 'seeding_run_ids' ELSE '[]'::jsonb END
                    ) AS ids (v)
                    UNION
                    SELECT (s.cursor ->> 'seeding_run_id')::uuid
                    WHERE NULLIF(s.cursor ->> 'seeding_run_id', '') IS NOT NULL
                  )
              ) seed ON true
              LEFT JOIN LATERAL (
                SELECT jsonb_build_object(
                  'kind', 'photos',
                  'done', pr.completed_batches,
                  'failed', pr.failed_batches,
                  'total', pr.total_batches,
                  'places_total', pr.total_places,
                  'succeeded', pr.total_succeeded,
                  'failed_places', pr.total_failed,
                  'cost_usd', pr.actual_cost_usd,
                  'child_status', pr.status
                ) AS progress
                FROM public.photo_backfill_runs pr
                WHERE s.stage = 'photos'
                  AND pr.id::text = COALESCE(
                    NULLIF(s.cursor ->> 'photo_run_id', ''),
                    s.refs -> 'photo_run_ids' ->> -1
                  )
              ) photo ON true
              LEFT JOIN LATERAL (
                SELECT jsonb_build_object(
                  'kind', 'intelligence',
                  'done', ir.processed_count,
                  'total', ir.total_count,
                  'succeeded', ir.succeeded_count,
                  'failed', ir.failed_count,
                  'cost_usd', ir.cost_so_far_usd,
                  'serper_requests', ir.serper_requests,
                  'child_status', ir.status
                ) AS progress
                FROM public.place_intelligence_runs ir
                WHERE s.stage = 'intelligence'
                  AND ir.id::text = COALESCE(
                    NULLIF(s.cursor ->> 'intel_run_id', ''),
                    s.refs -> 'intel_run_ids' ->> -1
                  )
              ) intel ON true
              WHERE s.run_id = r.id
            ), '[]'::jsonb)
          ) AS run
        FROM public.city_pipeline_runs r
        JOIN public.seeding_cities c ON c.id = r.city_id
        CROSS JOIN LATERAL (SELECT public.city_pipeline_spend_ledger(r.city_id, r.id) AS v) ledger
        CROSS JOIN LATERAL (SELECT public.city_pipeline_place_counts(r.city_id) AS v) counts
        WHERE r.status IN ('queued', 'running', 'paused', 'awaiting_approval')
           OR (r.status IN ('complete', 'cancelled', 'failed')
               AND COALESCE(r.completed_at, r.updated_at) >= now() - make_interval(days => GREATEST(COALESCE(p_days, 7), 0)))
      ) x
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_city_pipeline_live(integer) FROM PUBLIC, anon;
-- Only signed-in admins can use it: is_admin_user() is false for the service role, so
-- a grant there would only ever raise (same as admin_place_pipeline_spend_totals).
REVOKE ALL ON FUNCTION public.admin_city_pipeline_live(integer) FROM service_role;
GRANT EXECUTE ON FUNCTION public.admin_city_pipeline_live(integer) TO authenticated;

COMMENT ON FUNCTION public.admin_city_pipeline_live(integer) IS
  'Issue #4276: every active city pipeline run and every run finished in the last p_days, '
  'with stages, in-stage progress from the child runs, spend and held places; admins only.';

-- The two redefined functions keep their service-only grants.
REVOKE ALL ON FUNCTION public.city_pipeline_claim_tick(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_kick_city_pipeline() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.city_pipeline_claim_tick(integer) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
