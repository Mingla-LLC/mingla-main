-- Issue #4276 wave 3, C1 to C9, M1 and M3: one server-driven run for a city, from box
-- to final score, that survives a closed browser.
--
-- C1. city_pipeline_runs and city_pipeline_stages. A cron tick moves the run on; the
-- stages call the existing functions, which stay sole writers. A run exists only
-- because an admin started it (started_by is NOT NULL and start needs a person). One
-- city runs at a time, and the 4-run Gemini limit is unchanged.
--
-- C3, C4. Search batches are claimed and finished in one statement each, with a claim
-- token. A batch left 'running' past the timeout is reclaimed by the next claim, and
-- a late finish from the first worker counts for nothing, so nothing is counted twice.
--
-- C7. New places stay hidden until they have finished. serving_hold parks the final
-- check's verdict in held_final_check_passed and keeps is_servable away from true, so
-- every serving path hides a held place without being changed, including any that
-- isn't listed anywhere. The trigger does it, so run-bouncer stays the sole writer of
-- the verdict. It refuses to hold a place that is live now, so no live place can be
-- affected. Only city_pipeline_release_places turns a held verdict into is_servable.
--
-- System-run recovery.
--   * A drift or admin re-evaluation paused for Serper resumes on its own once a
--     health check newer than the pause is healthy, on a backoff. These are one place
--     each. Operator city runs stay manual: they can be thousands of places, and a
--     person should choose to spend that when the provider comes back.
--   * While a paused re-evaluation holds a city, further drift goes to
--     place_drift_queue_events, so at most one paused system run per city can exist.
--   * Events with no consumer now have one: when a city frees up, its oldest event is
--     re-queued, under a daily cap, and marked handled with every event for that place.
--   * A run making no progress for 30 minutes stops holding its city and the 4-run
--     limit: a system run fails, an operator run pauses with a reason. Re-kicks go to
--     the least recently kicked runs, so 4 stuck runs can't starve the others.
--
-- #2099 PIN. No new table has a place_pool_id or venue_id column or a foreign key to
-- place_pool, so its fingerprinted list doesn't move.
--
-- Rollback: unschedule city_pipeline_tick, drop the conductor tables and functions,
-- release every held place first (SELECT public.city_pipeline_release_places per city)
-- and re-run tg_kick_pending_trial_runs and the drift trigger from
-- 20280410004276_issue_4276_drift_modes_and_rescore_queue.sql.

BEGIN;

-- ── C7: holding new places ──────────────────────────────────────────────────
ALTER TABLE public.place_pool
  ADD COLUMN serving_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN held_final_check_passed boolean;

COMMENT ON COLUMN public.place_pool.serving_hold IS
  'Issue #4276 C7: a new place not yet finished (reviews, Intelligence, final score). '
  'is_servable cannot become true while this is set.';
COMMENT ON COLUMN public.place_pool.held_final_check_passed IS
  'Issue #4276 C7: the final check''s verdict while the place is held.';

CREATE INDEX idx_place_pool_serving_hold
  ON public.place_pool (city_id)
  WHERE serving_hold;

CREATE OR REPLACE FUNCTION public.tg_place_pool_serving_hold()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.serving_hold AND NOT NEW.serving_hold THEN
    NEW.held_final_check_passed := NULL;
    RETURN NEW;
  END IF;
  IF NOT NEW.serving_hold THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NOT OLD.serving_hold THEN
    IF OLD.is_servable IS TRUE THEN
      RAISE EXCEPTION 'place % is live, so it cannot be held', OLD.id USING ERRCODE = 'PT409';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.is_servable IS TRUE THEN
    NEW.held_final_check_passed := true;
    NEW.is_servable := false;
  ELSIF NEW.is_servable IS FALSE THEN
    NEW.held_final_check_passed := false;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_place_pool_serving_hold() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER place_pool_serving_hold
  BEFORE INSERT OR UPDATE OF is_servable, serving_hold ON public.place_pool
  FOR EACH ROW EXECUTE FUNCTION public.tg_place_pool_serving_hold();

-- ── C1: runs and stages ─────────────────────────────────────────────────────
CREATE TABLE public.city_pipeline_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- NULL means unknown: Serper's price is never invented.
  serper_usd_per_request numeric CHECK (serper_usd_per_request IS NULL OR serper_usd_per_request >= 0),
  db_pause_bytes bigint NOT NULL DEFAULT 7516192768, -- 7 GiB
  failure_rate_limit numeric NOT NULL DEFAULT 0.25 CHECK (failure_rate_limit > 0 AND failure_rate_limit <= 1),
  failure_min_sample integer NOT NULL DEFAULT 20 CHECK (failure_min_sample > 0),
  auto_reeval_daily_cap integer NOT NULL DEFAULT 200 CHECK (auto_reeval_daily_cap >= 0),
  storage_total_bytes bigint,
  storage_ok boolean,
  storage_message text,
  storage_measured_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

INSERT INTO public.city_pipeline_settings (id) VALUES (true);

COMMENT ON TABLE public.city_pipeline_settings IS
  'Issue #4276 C9, M1: limits for the conductor, the configured Serper rate, and the '
  'cached storage measurement (a full scan, so never run per tick).';

CREATE TABLE public.city_pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES public.seeding_cities (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'paused', 'awaiting_approval', 'complete', 'failed', 'cancelled')),
  scope text NOT NULL DEFAULT 'new_only' CHECK (scope IN ('new_only', 'whole_city')),
  skip_search boolean NOT NULL DEFAULT false,
  rules_only boolean NOT NULL DEFAULT false,
  rules_only_by uuid,
  spend_limit_usd numeric NOT NULL CHECK (spend_limit_usd > 0),
  started_by uuid NOT NULL,
  current_stage text,
  pause_reason text,
  pause_detail jsonb,
  lease_until timestamptz,
  last_tick_at timestamptz,
  last_error text,
  error_streak integer NOT NULL DEFAULT 0,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.city_pipeline_runs IS
  'Issue #4276 C1: one admin-started run of a city through every stage. Pause and '
  'awaiting_approval hold the city but not the single running slot.';

-- One run per city, including one waiting on a person: cancel or resume it (C5).
CREATE UNIQUE INDEX uniq_city_pipeline_active_city
  ON public.city_pipeline_runs (city_id)
  WHERE status IN ('queued', 'running', 'paused', 'awaiting_approval');

-- One city at a time.
CREATE UNIQUE INDEX uniq_city_pipeline_one_running
  ON public.city_pipeline_runs ((1))
  WHERE status = 'running';

CREATE TABLE public.city_pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.city_pipeline_runs (id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN (
    'box', 'fill', 'split', 'completeness', 'pre_check', 'photos', 'final_check',
    'intelligence', 'score', 'release', 'thumbnails'
  )),
  ord integer NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'complete', 'skipped')),
  estimate jsonb,
  approval jsonb,
  refs jsonb NOT NULL DEFAULT '{}'::jsonb,
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (run_id, stage),
  UNIQUE (run_id, ord)
);

COMMENT ON TABLE public.city_pipeline_stages IS
  'Issue #4276 C1, M1: what each stage estimated, what a person approved, and which '
  'seeding, photo and Intelligence runs it started (refs).';

ALTER TABLE public.city_pipeline_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.city_pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.city_pipeline_stages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.city_pipeline_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.city_pipeline_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.city_pipeline_stages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.city_pipeline_settings TO authenticated;
GRANT SELECT ON TABLE public.city_pipeline_runs TO authenticated;
GRANT SELECT ON TABLE public.city_pipeline_stages TO authenticated;
GRANT ALL ON TABLE public.city_pipeline_settings TO service_role;
GRANT ALL ON TABLE public.city_pipeline_runs TO service_role;
GRANT ALL ON TABLE public.city_pipeline_stages TO service_role;

CREATE POLICY city_pipeline_settings_admin_read ON public.city_pipeline_settings
  FOR SELECT TO authenticated USING (public.is_admin_user());
CREATE POLICY city_pipeline_runs_admin_read ON public.city_pipeline_runs
  FOR SELECT TO authenticated USING (public.is_admin_user());
CREATE POLICY city_pipeline_stages_admin_read ON public.city_pipeline_stages
  FOR SELECT TO authenticated USING (public.is_admin_user());

CREATE OR REPLACE FUNCTION public.city_pipeline_start(
  p_city_id uuid,
  p_started_by uuid,
  p_scope text,
  p_spend_limit_usd numeric,
  p_skip_search boolean DEFAULT false,
  p_rules_only boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE id = p_started_by AND status = 'active') THEN
    RAISE EXCEPTION 'a run needs an active admin' USING ERRCODE = 'PT403';
  END IF;

  BEGIN
    INSERT INTO public.city_pipeline_runs (
      city_id, scope, skip_search, rules_only, rules_only_by, spend_limit_usd, started_by, current_stage
    ) VALUES (
      p_city_id, p_scope, p_skip_search, p_rules_only,
      CASE WHEN p_rules_only THEN p_started_by END,
      p_spend_limit_usd, p_started_by,
      CASE WHEN p_skip_search THEN 'pre_check' ELSE 'box' END
    )
    RETURNING id INTO v_run_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'city % already has an active pipeline run; resume or cancel it', p_city_id
      USING ERRCODE = 'PT409';
  END;

  INSERT INTO public.city_pipeline_stages (run_id, stage, ord, status)
  SELECT v_run_id, s.stage, s.ord,
         CASE WHEN p_skip_search AND s.ord <= 4 THEN 'skipped' ELSE 'pending' END
  FROM (VALUES
    ('box', 1), ('fill', 2), ('split', 3), ('completeness', 4), ('pre_check', 5),
    ('photos', 6), ('final_check', 7), ('intelligence', 8), ('score', 9),
    ('release', 10), ('thumbnails', 11)
  ) AS s (stage, ord);

  RETURN v_run_id;
END;
$$;

-- Promotes the oldest queued run when nothing is running, then leases one run. A run
-- whose tick died keeps its lease only until the lease runs out.
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
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   )
  RETURNING r.*;
END;
$$;

-- ── C9: what the gates read ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.city_pipeline_gate_inputs()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'settings', (SELECT to_jsonb(s) FROM public.city_pipeline_settings s),
    'providers', (
      SELECT jsonb_object_agg(k.service_key, COALESCE(l.row, jsonb_build_object('status', 'unknown')))
      FROM (VALUES ('google_places'), ('gemini'), ('serper')) AS k (service_key)
      LEFT JOIN LATERAL (
        SELECT jsonb_build_object(
          'status', c.status, 'http_status', c.http_status, 'detail', c.detail, 'checked_at', c.checked_at
        ) AS row
        FROM public.api_health_checks c
        WHERE c.service_key = k.service_key AND c.layer = 'synthetic'
        ORDER BY c.checked_at DESC
        LIMIT 1
      ) l ON true
    )
  );
$$;

-- ── C7: which places, and release ───────────────────────────────────────────
-- Never-judged places have never been shown, so they count as new. A place's
-- is_servable being NULL is exactly that: production has 25,738 and none has a
-- recorded check.
CREATE OR REPLACE FUNCTION public.city_pipeline_hold_unjudged(p_city_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_held integer;
BEGIN
  UPDATE public.place_pool
     SET serving_hold = true
   WHERE city_id = p_city_id
     AND is_servable IS NULL
     AND is_active
     AND NOT serving_hold;
  GET DIAGNOSTICS v_held = ROW_COUNT;
  RETURN v_held;
END;
$$;

CREATE OR REPLACE FUNCTION public.city_pipeline_place_counts(p_city_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'held', count(*),
    'held_unjudged', count(*) FILTER (WHERE held_final_check_passed IS NULL),
    'held_passed', count(*) FILTER (WHERE held_final_check_passed),
    'held_rejected', count(*) FILTER (WHERE held_final_check_passed IS FALSE),
    'held_passed_with_ai', count(*) FILTER (WHERE held_final_check_passed AND ai_signal_scores IS NOT NULL),
    'held_passed_without_ai', count(*) FILTER (WHERE held_final_check_passed AND ai_signal_scores IS NULL)
  )
  FROM public.place_pool
  WHERE city_id = p_city_id AND serving_hold;
$$;

-- The final-score stage touches only what this run evaluated. Scoring a whole city
-- would release held pre-2026-11-05 AI results into live decks, which S2 forbids.
CREATE OR REPLACE FUNCTION public.city_pipeline_places_to_score(
  p_run_id uuid,
  p_after_id uuid,
  p_limit integer
)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH run AS (
    SELECT r.id, r.city_id, r.rules_only FROM public.city_pipeline_runs r WHERE r.id = p_run_id
  ),
  intel AS (
    SELECT (x.value)::uuid AS parent_run_id
    FROM public.city_pipeline_stages s
    JOIN run ON run.id = s.run_id
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s.refs -> 'intel_run_ids', '[]'::jsonb)) AS x (value)
    WHERE s.stage = 'intelligence'
  ),
  evaluated AS (
    SELECT DISTINCT t.place_pool_id AS id
    FROM public.place_intelligence_trial_runs t
    JOIN intel ON intel.parent_run_id = t.parent_run_id
    WHERE t.status = 'completed'
  ),
  wanted AS (
    SELECT pp.id
    FROM public.place_pool pp
    JOIN run ON run.city_id = pp.city_id
    WHERE pp.is_active AND pp.serving_hold AND pp.held_final_check_passed
      AND (run.rules_only OR pp.ai_signal_scores IS NOT NULL)
    UNION
    SELECT e.id FROM evaluated e
    JOIN public.place_pool pp ON pp.id = e.id
    WHERE pp.is_active AND (pp.is_servable IS TRUE OR pp.held_final_check_passed IS TRUE)
  )
  SELECT COALESCE(array_agg(w.id ORDER BY w.id), ARRAY[]::uuid[])
  FROM (
    SELECT id FROM wanted
    WHERE p_after_id IS NULL OR id > p_after_id
    ORDER BY id
    LIMIT p_limit
  ) w;
$$;

-- The only path from a held verdict to is_servable. Rejected places just stop being
-- held. A passed place needs its AI result, unless a person chose rules only.
CREATE OR REPLACE FUNCTION public.city_pipeline_release_places(p_city_id uuid, p_rules_only boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rejected integer;
  v_released integer;
  v_unfinished integer;
BEGIN
  UPDATE public.place_pool
     SET is_servable = false, serving_hold = false
   WHERE city_id = p_city_id AND serving_hold AND held_final_check_passed IS FALSE;
  GET DIAGNOSTICS v_rejected = ROW_COUNT;

  UPDATE public.place_pool
     SET is_servable = true, serving_hold = false
   WHERE city_id = p_city_id AND serving_hold AND held_final_check_passed
     AND (p_rules_only OR ai_signal_scores IS NOT NULL);
  GET DIAGNOSTICS v_released = ROW_COUNT;

  SELECT count(*) INTO v_unfinished
    FROM public.place_pool
   WHERE city_id = p_city_id AND serving_hold;

  RETURN jsonb_build_object('released', v_released, 'rejected', v_rejected, 'unfinished', v_unfinished);
END;
$$;

-- ── C5: what is holding a city ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.city_pipeline_blockers(p_city_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH city AS (SELECT id, name, country FROM public.seeding_cities WHERE id = p_city_id),
  blockers AS (
    SELECT 'seeding' AS kind, r.id, r.status, r.created_at,
           (SELECT max(COALESCE(b.completed_at, b.started_at)) FROM public.seeding_batches b WHERE b.run_id = r.id) AS last_activity_at,
           jsonb_build_object('kind', r.kind, 'level', r.level, 'total', r.total_batches,
                              'completed', r.completed_batches, 'failed', r.failed_batches) AS detail
    FROM public.seeding_runs r JOIN city ON city.id = r.city_id
    WHERE r.status IN ('preparing', 'ready', 'running', 'paused')
    UNION ALL
    SELECT 'photos', r.id, r.status, r.created_at, r.started_at,
           jsonb_build_object('mode', r.mode, 'total', r.total_batches,
                              'completed', r.completed_batches, 'failed', r.failed_batches)
    FROM public.photo_backfill_runs r JOIN city ON city.name = r.city AND city.country = r.country
    WHERE r.status IN ('ready', 'running', 'paused')
    UNION ALL
    SELECT 'intelligence', r.id, r.status, r.created_at, r.last_heartbeat_at,
           jsonb_build_object('mode', r.mode, 'total', r.total_count, 'processed', r.processed_count,
                              'reason', r.error_reason)
    FROM public.place_intelligence_runs r JOIN city ON city.id = r.city_id
    WHERE r.status IN ('pending', 'queued', 'running', 'paused', 'cancelling')
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'kind', b.kind, 'id', b.id, 'status', b.status, 'created_at', b.created_at,
    'last_activity_at', b.last_activity_at, 'detail', b.detail,
    'stale', COALESCE(b.last_activity_at, b.created_at) < now() - interval '30 minutes'
  ) ORDER BY b.created_at), '[]'::jsonb)
  FROM blockers b;
$$;

-- ── C2: places with no city ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.city_pipeline_no_city_report()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH orphan AS (
    SELECT pp.id, pp.lat, pp.lng, pp.is_servable, pp.is_active
    FROM public.place_pool pp
    WHERE pp.city_id IS NULL
  ),
  matched AS (
    SELECT o.id, (array_agg(c.id))[1] AS city_id, (array_agg(c.name))[1] AS city_name, count(c.id) AS cities
    FROM orphan o
    LEFT JOIN public.seeding_cities c
      ON o.lat BETWEEN c.bbox_sw_lat AND c.bbox_ne_lat
     AND o.lng BETWEEN c.bbox_sw_lng AND c.bbox_ne_lng
    GROUP BY o.id
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM orphan),
    'active', (SELECT count(*) FROM orphan WHERE is_active),
    'unjudged', (SELECT count(*) FROM orphan WHERE is_servable IS NULL),
    'in_one_box', (SELECT count(*) FROM matched WHERE cities = 1),
    'in_no_box', (SELECT count(*) FROM matched WHERE cities = 0),
    'in_several_boxes', (SELECT count(*) FROM matched WHERE cities > 1),
    'by_city', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('city_id', x.city_id, 'name', x.city_name, 'places', x.places) ORDER BY x.places DESC), '[]'::jsonb)
      FROM (SELECT city_id, city_name, count(*) AS places FROM matched WHERE cities = 1 GROUP BY city_id, city_name) x
    )
  );
$$;

-- Only where exactly one city's box holds the place. Anything else stays on the report.
CREATE OR REPLACE FUNCTION public.city_pipeline_assign_no_city()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_assigned integer;
BEGIN
  WITH matched AS (
    SELECT pp.id, (array_agg(c.id))[1] AS city_id
    FROM public.place_pool pp
    JOIN public.seeding_cities c
      ON pp.lat BETWEEN c.bbox_sw_lat AND c.bbox_ne_lat
     AND pp.lng BETWEEN c.bbox_sw_lng AND c.bbox_ne_lng
    WHERE pp.city_id IS NULL
    GROUP BY pp.id
    HAVING count(c.id) = 1
  )
  UPDATE public.place_pool pp
     SET city_id = m.city_id
    FROM matched m
   WHERE pp.id = m.id AND pp.city_id IS NULL;
  GET DIAGNOSTICS v_assigned = ROW_COUNT;
  RETURN v_assigned;
END;
$$;

-- ── C3, C4: one statement to claim, one to finish ───────────────────────────
ALTER TABLE public.seeding_batches
  ADD COLUMN claim_token uuid,
  ADD COLUMN reclaim_count integer NOT NULL DEFAULT 0,
  ADD COLUMN is_retry_claim boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.seeding_batches.claim_token IS
  'Issue #4276 C3, C4: whoever holds the current token may finish this search. A worker '
  'whose claim timed out finishes nothing and counts nothing.';

CREATE INDEX idx_seeding_batches_claimable
  ON public.seeding_batches (run_id, batch_index)
  WHERE status IN ('pending', 'running');

CREATE OR REPLACE FUNCTION public.seeding_claim_next_batch(
  p_run_id uuid,
  p_stale_after_seconds integer DEFAULT 300
)
RETURNS SETOF public.seeding_batches
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.seeding_batches b
     SET reclaim_count = b.reclaim_count + CASE WHEN b.status = 'running' THEN 1 ELSE 0 END,
         status = 'running',
         started_at = now(),
         claim_token = gen_random_uuid()
   WHERE b.id = (
     SELECT c.id FROM public.seeding_batches c
      WHERE c.run_id = p_run_id
        AND (c.status = 'pending'
             OR (c.status = 'running'
                 AND c.started_at < now() - make_interval(secs => p_stale_after_seconds)))
      ORDER BY c.batch_index
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   )
  RETURNING b.*;
$$;

CREATE OR REPLACE FUNCTION public.seeding_claim_retry_batch(p_run_id uuid, p_batch_id uuid)
RETURNS SETOF public.seeding_batches
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.seeding_batches b
     SET status = 'running',
         started_at = now(),
         completed_at = NULL,
         retry_count = COALESCE(b.retry_count, 0) + 1,
         error_message = NULL,
         error_details = NULL,
         is_retry_claim = true,
         claim_token = gen_random_uuid()
   WHERE b.id = p_batch_id
     AND b.run_id = p_run_id
     AND b.status = 'failed'
     AND NOT EXISTS (
       SELECT 1 FROM public.seeding_batches r
        WHERE r.run_id = p_run_id AND r.status = 'running'
     )
  RETURNING b.*;
$$;

-- A stale token changes nothing. A retry replaces what the failed attempt counted.
CREATE OR REPLACE FUNCTION public.seeding_finish_batch(
  p_batch_id uuid,
  p_claim_token uuid,
  p_status text,
  p_api_calls integer,
  p_cost_usd double precision,
  p_places_returned integer,
  p_rejected_no_photos integer,
  p_rejected_closed integer,
  p_rejected_excluded_type integer,
  p_new_inserted integer,
  p_duplicate_skipped integer,
  p_error_message text,
  p_error_details jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_prior public.seeding_batches%ROWTYPE;
  v_run public.seeding_runs%ROWTYPE;
  v_retry boolean;
  v_next_status text;
BEGIN
  IF p_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'a finished search is completed or failed, not %', p_status;
  END IF;

  SELECT * INTO v_prior FROM public.seeding_batches
   WHERE id = p_batch_id AND claim_token = p_claim_token AND status = 'running'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', false);
  END IF;
  v_retry := v_prior.is_retry_claim;

  UPDATE public.seeding_batches
     SET status = p_status,
         google_api_calls = CASE WHEN v_retry THEN COALESCE(google_api_calls, 0) + p_api_calls ELSE p_api_calls END,
         places_returned = p_places_returned,
         places_rejected_no_photos = p_rejected_no_photos,
         places_rejected_closed = p_rejected_closed,
         places_rejected_excluded_type = p_rejected_excluded_type,
         places_new_inserted = p_new_inserted,
         places_duplicate_skipped = p_duplicate_skipped,
         estimated_cost_usd = CASE WHEN v_retry THEN COALESCE(estimated_cost_usd, 0) + p_cost_usd ELSE p_cost_usd END,
         error_message = p_error_message,
         error_details = p_error_details,
         completed_at = now(),
         claim_token = NULL,
         is_retry_claim = false
   WHERE id = p_batch_id;

  UPDATE public.seeding_runs r
     SET total_api_calls = r.total_api_calls + p_api_calls,
         total_cost_usd = r.total_cost_usd + p_cost_usd,
         total_places_new = r.total_places_new + p_new_inserted
           - CASE WHEN v_retry THEN COALESCE(v_prior.places_new_inserted, 0) ELSE 0 END,
         total_places_duped = r.total_places_duped + p_duplicate_skipped
           - CASE WHEN v_retry THEN COALESCE(v_prior.places_duplicate_skipped, 0) ELSE 0 END,
         completed_batches = r.completed_batches + CASE WHEN p_status = 'completed' THEN 1 ELSE 0 END,
         failed_batches = r.failed_batches
           + CASE WHEN p_status = 'failed' AND NOT v_retry THEN 1 ELSE 0 END
           - CASE WHEN p_status = 'completed' AND v_retry THEN 1 ELSE 0 END,
         status = 'paused'
   WHERE r.id = v_prior.run_id
  RETURNING r.* INTO v_run;

  v_next_status := 'paused';
  IF NOT EXISTS (
    SELECT 1 FROM public.seeding_batches b
     WHERE b.run_id = v_prior.run_id AND b.status IN ('pending', 'running', 'failed')
  ) THEN
    v_next_status := 'completed';
    UPDATE public.seeding_runs
       SET status = 'completed', current_batch_index = NULL, completed_at = now()
     WHERE id = v_prior.run_id;
  END IF;

  RETURN jsonb_build_object(
    'applied', true,
    'run_status', v_next_status,
    'completed_batches', v_run.completed_batches,
    'failed_batches', v_run.failed_batches,
    'total_batches', v_run.total_batches,
    'total_places_new', v_run.total_places_new,
    'total_places_duped', v_run.total_places_duped,
    'total_cost_usd', v_run.total_cost_usd,
    'has_pending', EXISTS (
      SELECT 1 FROM public.seeding_batches b WHERE b.run_id = v_prior.run_id AND b.status = 'pending'
    )
  );
END;
$$;

-- ── M1: spend per city and stage ────────────────────────────────────────────
ALTER TABLE public.place_intelligence_runs
  ADD COLUMN serper_requests integer NOT NULL DEFAULT 0,
  ADD COLUMN paused_at timestamptz,
  ADD COLUMN auto_resume_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN next_auto_resume_at timestamptz,
  ADD COLUMN last_kicked_at timestamptz,
  ADD COLUMN last_progress_at timestamptz,
  ADD COLUMN last_progress_count integer;

COMMENT ON COLUMN public.place_intelligence_runs.serper_requests IS
  'Issue #4276 M1: review requests this run sent to Serper. Priced only from '
  'city_pipeline_settings.serper_usd_per_request.';

CREATE OR REPLACE FUNCTION public.increment_run_serper_requests(p_run_id uuid, p_requests integer)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.place_intelligence_runs
     SET serper_requests = serper_requests + GREATEST(p_requests, 0)
   WHERE id = p_run_id;
$$;

-- Read from the records each writer already keeps, so the ledger can't disagree with
-- them. Serper's cost is NULL until a rate is configured; its requests always count.
CREATE OR REPLACE FUNCTION public.city_pipeline_spend_rows(p_city_id uuid, p_run_id uuid DEFAULT NULL)
RETURNS TABLE (stage text, provider text, units bigint, estimated_usd numeric, actual_usd numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH refs AS (
    SELECT COALESCE(jsonb_agg(DISTINCT x.value) FILTER (WHERE x.key = 'seeding_run_ids'), '[]'::jsonb) AS seeding,
           COALESCE(jsonb_agg(DISTINCT x.value) FILTER (WHERE x.key = 'photo_run_ids'), '[]'::jsonb) AS photos,
           COALESCE(jsonb_agg(DISTINCT x.value) FILTER (WHERE x.key = 'intel_run_ids'), '[]'::jsonb) AS intel,
           COALESCE(jsonb_agg(DISTINCT x.value) FILTER (WHERE x.key = 'completeness_check_ids'), '[]'::jsonb) AS checks
    FROM public.city_pipeline_stages s
    CROSS JOIN LATERAL jsonb_each(s.refs) AS e (key, val)
    CROSS JOIN LATERAL jsonb_array_elements_text(e.val) AS a (value)
    CROSS JOIN LATERAL (SELECT e.key, a.value) AS x
    WHERE s.run_id = p_run_id
  ),
  rate AS (SELECT serper_usd_per_request AS usd FROM public.city_pipeline_settings),
  city AS (SELECT id, name, country FROM public.seeding_cities WHERE id = p_city_id)
  SELECT r.stage, r.provider, sum(r.units)::bigint, sum(r.estimated_usd), sum(r.actual_usd)
  FROM (
    SELECT sr.kind AS stage, 'google' AS provider, sr.total_api_calls::bigint AS units,
           sr.estimated_cost_usd::numeric AS estimated_usd, sr.total_cost_usd::numeric AS actual_usd
    FROM public.seeding_runs sr, refs
    WHERE sr.city_id = p_city_id
      AND (p_run_id IS NULL OR refs.seeding ? sr.id::text)
    UNION ALL
    SELECT 'photos', 'google', COALESCE(pr.total_succeeded, 0)::bigint,
           pr.estimated_cost_usd::numeric, pr.actual_cost_usd::numeric
    FROM public.photo_backfill_runs pr
    JOIN city ON city.name = pr.city AND city.country = pr.country, refs
    WHERE p_run_id IS NULL OR refs.photos ? pr.id::text
    UNION ALL
    SELECT 'completeness', 'google', cc.searches_planned::bigint, NULL, cc.cost_usd::numeric
    FROM public.seeding_completeness_checks cc, refs
    WHERE cc.city_id = p_city_id
      AND (p_run_id IS NULL OR refs.checks ? cc.id::text)
    UNION ALL
    SELECT CASE WHEN ir.mode = 'drift_reeval' THEN 'automatic_reeval'
                WHEN ir.mode = 'admin_reeval' THEN 'admin_reeval'
                ELSE 'intelligence' END,
           'gemini', ir.succeeded_count::bigint, ir.estimated_cost_usd::numeric, ir.cost_so_far_usd::numeric
    FROM public.place_intelligence_runs ir, refs
    WHERE ir.city_id = p_city_id
      AND (p_run_id IS NULL OR refs.intel ? ir.id::text)
    UNION ALL
    SELECT CASE WHEN ir.mode = 'drift_reeval' THEN 'automatic_reeval'
                WHEN ir.mode = 'admin_reeval' THEN 'admin_reeval'
                ELSE 'intelligence' END,
           'serper', ir.serper_requests::bigint, NULL, ir.serper_requests * rate.usd
    FROM public.place_intelligence_runs ir, refs, rate
    WHERE ir.city_id = p_city_id
      AND ir.serper_requests > 0
      AND (p_run_id IS NULL OR refs.intel ? ir.id::text)
  ) r
  GROUP BY r.stage, r.provider;
$$;

CREATE OR REPLACE FUNCTION public.city_pipeline_spend_ledger(p_city_id uuid, p_run_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH rate AS (SELECT serper_usd_per_request AS usd FROM public.city_pipeline_settings),
  rows AS (SELECT * FROM public.city_pipeline_spend_rows(p_city_id, p_run_id))
  SELECT jsonb_build_object(
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'stage', r.stage, 'provider', r.provider, 'units', r.units,
        'estimated_usd', r.estimated_usd, 'actual_usd', r.actual_usd
      ) ORDER BY r.stage, r.provider) FROM rows r
    ), '[]'::jsonb),
    'known_actual_usd', COALESCE((SELECT sum(r.actual_usd) FROM rows r), 0),
    'serper_requests', COALESCE((SELECT sum(r.units) FROM rows r WHERE r.provider = 'serper'), 0),
    'serper_usd_per_request', (SELECT usd FROM rate),
    'serper_cost_known', (SELECT usd IS NOT NULL FROM rate)
  );
$$;

-- M2: the number to compare with PER_PLACE_COST_USD after the first real sample.
CREATE OR REPLACE FUNCTION public.city_pipeline_gemini_cost_sample(p_model text DEFAULT 'gemini-3.6-flash')
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'model', p_model,
    'places', count(*),
    'mean_cost_usd', avg(t.cost_usd),
    'max_cost_usd', max(t.cost_usd),
    'enough', count(*) >= 50
  )
  FROM (
    SELECT cost_usd FROM public.place_intelligence_trial_runs
     WHERE model = p_model AND status = 'completed' AND cost_usd > 0
     ORDER BY completed_at DESC NULLS LAST
     LIMIT 500
  ) t;
$$;

-- ── M3: the materialized view refresh and its 10-minute cron ────────────────
CREATE OR REPLACE FUNCTION public.city_pipeline_mv_refresh_health(p_window_hours integer DEFAULT 24)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'jobname', 'refresh_admin_place_pool_mv',
    'runs', count(d.*),
    'max_seconds', round(max(EXTRACT(EPOCH FROM (d.end_time - d.start_time)))::numeric, 1),
    'interval_seconds', 600
  )
  FROM cron.job j
  LEFT JOIN cron.job_run_details d
    ON d.jobid = j.jobid
   AND d.status = 'succeeded'
   AND d.start_time > now() - make_interval(hours => GREATEST(p_window_hours, 1))
  WHERE j.jobname = 'refresh_admin_place_pool_mv';
$function$;

-- ── Recovery ────────────────────────────────────────────────────────────────
ALTER TABLE public.place_drift_queue_events
  ADD COLUMN handled_at timestamptz,
  ADD COLUMN handled_outcome text
    CHECK (handled_outcome IN ('requeued', 'superseded', 'not_eligible', 'requeue_failed'));

CREATE INDEX idx_place_drift_queue_events_open
  ON public.place_drift_queue_events (city_id, created_at)
  WHERE handled_at IS NULL;

CREATE OR REPLACE FUNCTION public.place_intel_provider_healthy(p_service_key text, p_since timestamptz DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT c.status = 'healthy' AND (p_since IS NULL OR c.checked_at > p_since)
    FROM public.api_health_checks c
    WHERE c.service_key = p_service_key AND c.layer = 'synthetic'
    ORDER BY c.checked_at DESC
    LIMIT 1
  ), false);
$$;

-- A run making no progress stops holding its city and the limit of 4.
CREATE OR REPLACE FUNCTION public.place_intel_reap_stalled_runs()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r record;
  v_reaped integer := 0;
BEGIN
  UPDATE public.place_intelligence_runs
     SET last_progress_at = now(), last_progress_count = processed_count
   WHERE status = 'running'
     AND last_progress_count IS DISTINCT FROM processed_count;

  FOR r IN
    SELECT id, mode FROM public.place_intelligence_runs
     WHERE status = 'running'
       AND last_progress_at < now() - interval '30 minutes'
     FOR UPDATE SKIP LOCKED
  LOOP
    IF r.mode IN ('drift_reeval', 'admin_reeval') THEN
      UPDATE public.place_intelligence_runs
         SET status = 'failed', error_reason = 'stalled_no_progress', completed_at = now()
       WHERE id = r.id;
      UPDATE public.place_intelligence_trial_runs
         SET status = 'failed', completed_at = now(), error_message = 'run stalled with no progress'
       WHERE parent_run_id = r.id AND status IN ('pending', 'running');
    ELSE
      UPDATE public.place_intelligence_runs
         SET status = 'paused', error_reason = 'stalled_no_progress', paused_at = now()
       WHERE id = r.id;
    END IF;
    v_reaped := v_reaped + 1;
  END LOOP;
  RETURN v_reaped;
END;
$$;

-- System runs only. Operator runs stay manual: see the header.
CREATE OR REPLACE FUNCTION public.place_intel_auto_resume_system_runs(p_limit integer DEFAULT 10)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r record;
  v_resumed integer := 0;
BEGIN
  FOR r IN
    SELECT id, paused_at, auto_resume_attempts FROM public.place_intelligence_runs
     WHERE status = 'paused'
       AND mode IN ('drift_reeval', 'admin_reeval')
       AND error_reason = 'review_provider_out_of_credits'
       AND (next_auto_resume_at IS NULL OR next_auto_resume_at <= now())
     ORDER BY created_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    CONTINUE WHEN NOT public.place_intel_provider_healthy('serper', r.paused_at);
    BEGIN
      UPDATE public.place_intelligence_runs
         SET status = 'queued',
             error_reason = NULL,
             auto_resume_attempts = r.auto_resume_attempts + 1,
             -- It may pause again if the health check was wrong, so back off.
             next_auto_resume_at = now() + LEAST(
               interval '6 hours',
               interval '15 minutes' * power(2, LEAST(r.auto_resume_attempts, 8))
             )
       WHERE id = r.id;
      v_resumed := v_resumed + 1;
    EXCEPTION WHEN unique_violation THEN
      NULL; -- the city is busy; the next tick tries again
    END;
  END LOOP;
  RETURN v_resumed;
END;
$$;

-- The consumer for events the trigger couldn't queue. One place per free city per
-- tick, under a daily cap, and only while the review provider is healthy.
CREATE OR REPLACE FUNCTION public.place_intel_requeue_skipped_drift(p_limit integer DEFAULT 4)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  e record;
  v_run_id uuid;
  v_room integer;
  v_requeued integer := 0;
  v_rows integer;
BEGIN
  IF NOT public.place_intel_provider_healthy('serper') OR NOT public.place_intel_provider_healthy('gemini') THEN
    RETURN 0;
  END IF;

  SELECT s.auto_reeval_daily_cap - (
    SELECT count(*) FROM public.place_intelligence_runs r
     WHERE r.mode = 'drift_reeval' AND r.created_at > now() - interval '24 hours'
  ) INTO v_room
  FROM public.city_pipeline_settings s;
  v_room := LEAST(COALESCE(v_room, 0), p_limit);
  IF v_room <= 0 THEN
    RETURN 0;
  END IF;

  FOR e IN
    SELECT DISTINCT ON (ev.city_id)
           ev.id, ev.place_id, ev.city_id, ev.drift_kind
    FROM public.place_drift_queue_events ev
    WHERE ev.handled_at IS NULL
      AND (ev.city_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.place_intelligence_runs r
         WHERE r.city_id = ev.city_id
           AND r.status IN ('pending', 'queued', 'running', 'paused', 'cancelling')
      ))
    ORDER BY ev.city_id, ev.created_at
    LIMIT v_room
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.place_pool pp
       WHERE pp.id = e.place_id AND pp.is_servable IS TRUE AND pp.ai_signal_scores IS NOT NULL
    ) THEN
      UPDATE public.place_drift_queue_events
         SET handled_at = now(), handled_outcome = 'not_eligible'
       WHERE place_id = e.place_id AND handled_at IS NULL;
      CONTINUE;
    END IF;

    v_run_id := gen_random_uuid();
    BEGIN
      INSERT INTO public.place_intelligence_runs (
        id, city_id, city_name, mode, sample_size, total_count,
        estimated_cost_usd, estimated_minutes, prompt_version, model, started_by, status
      ) VALUES (
        v_run_id, e.city_id,
        COALESCE((SELECT name FROM public.seeding_cities WHERE id = e.city_id LIMIT 1), 'drift'),
        'drift_reeval', 1, 1,
        -- MUST stay equal to PER_PLACE_COST_USD in run-place-intelligence-trial/index.ts.
        0.0089, 1, 'v4', 'gemini-3.6-flash', NULL, 'queued'
      );
      INSERT INTO public.place_intelligence_trial_runs (
        run_id, parent_run_id, place_pool_id, city_id, signal_id, anchor_index,
        input_payload, status, prompt_version, model, retry_count, source
      ) VALUES (
        v_run_id, v_run_id, e.place_id, e.city_id, NULL, NULL,
        jsonb_build_object('drift_kind', e.drift_kind, 'requeued_from_event', e.id),
        'pending', 'v4', 'gemini-3.6-flash', 0, 'auto-refresh-drift'
      )
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        DELETE FROM public.place_intelligence_runs WHERE id = v_run_id;
        UPDATE public.place_drift_queue_events
           SET handled_at = now(), handled_outcome = 'superseded'
         WHERE place_id = e.place_id AND handled_at IS NULL;
      ELSE
        UPDATE public.place_drift_queue_events
           SET handled_at = now(), handled_outcome = 'requeued'
         WHERE place_id = e.place_id AND handled_at IS NULL;
        v_requeued := v_requeued + 1;
      END IF;
    EXCEPTION
      WHEN unique_violation THEN
        NULL; -- the city was taken in between; the event stays open
      WHEN OTHERS THEN
        RAISE WARNING 'drift event % could not be re-queued: % %', e.id, SQLSTATE, SQLERRM;
        UPDATE public.place_drift_queue_events
           SET handled_at = now(), handled_outcome = 'requeue_failed', message = SQLERRM
         WHERE id = e.id;
    END;
  END LOOP;
  RETURN v_requeued;
END;
$$;

-- A paused re-evaluation holds this city's queue, so the next drift waits as an event
-- instead of creating another run to pause.
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
  v_child_rows integer := 0;
  v_sqlstate text;
  v_message text;
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
  -- Guard 2: only queue if the place HAS an AI evaluation.
  IF NEW.ai_signal_scores IS NULL THEN RETURN NEW; END IF;
  -- Guard 3: only servable places (matches the consumer-ranker scope).
  IF NEW.is_servable IS NOT TRUE THEN RETURN NEW; END IF;

  -- This block is one subtransaction: if either insert fails, neither row stays,
  -- so no childless parent can hold the city's run slot.
  BEGIN
    -- A drift re-evaluation already queued for this place covers this event too.
    IF EXISTS (
      SELECT 1 FROM public.place_intelligence_trial_runs t
      WHERE t.place_pool_id = NEW.id
        AND t.source = 'auto-refresh-drift'
        AND t.status IN ('pending', 'running')
    ) THEN
      RETURN NEW;
    END IF;

    -- #4276: a paused system run already waits on the provider for this city.
    IF EXISTS (
      SELECT 1 FROM public.place_intelligence_runs r
      WHERE r.city_id = NEW.city_id
        AND r.status = 'paused'
        AND r.mode IN ('drift_reeval', 'admin_reeval')
    ) THEN
      INSERT INTO public.place_drift_queue_events (
        place_id, city_id, drift_kind, outcome, sqlstate, message
      ) VALUES (
        NEW.id, NEW.city_id, v_drift_kind, 'skipped_active_run', NULL, 'paused system run holds this city'
      );
      RETURN NEW;
    END IF;

    INSERT INTO public.place_intelligence_runs (
      id, city_id, city_name, mode, sample_size, total_count,
      estimated_cost_usd, estimated_minutes,
      prompt_version, model, started_by, status
    ) VALUES (
      v_run_id, NEW.city_id,
      COALESCE((SELECT name FROM public.seeding_cities WHERE id = NEW.city_id LIMIT 1), 'drift'),
      'drift_reeval',
      1, 1,
      -- MUST stay equal to PER_PLACE_COST_USD in run-place-intelligence-trial/index.ts.
      0.0089, 1,
      'v4', 'gemini-3.6-flash',
      NULL,        -- system-initiated (no admin user)
      'queued'     -- the cron promotes it under the limit of 4 and stamps started_at
    );

    INSERT INTO public.place_intelligence_trial_runs (
      run_id, parent_run_id, place_pool_id, city_id, signal_id,
      anchor_index, input_payload, status, prompt_version, model,
      retry_count, source
    ) VALUES (
      v_run_id, v_run_id, NEW.id, NEW.city_id, NULL, NULL,
      jsonb_build_object('drift_kind', v_drift_kind,
                         'triggered_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      'pending', 'v4', 'gemini-3.6-flash', 0, 'auto-refresh-drift'
    )
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_child_rows = ROW_COUNT;
    IF v_child_rows = 0 THEN
      -- Lost a race with another drift event for this place: it has it covered.
      DELETE FROM public.place_intelligence_runs WHERE id = v_run_id;
    END IF;

    RETURN NEW;
  EXCEPTION
    WHEN unique_violation THEN
      -- A run already holds this city's slot. Keep the update; record the skip.
      v_sqlstate := SQLSTATE;
      v_message := SQLERRM;
      BEGIN
        INSERT INTO public.place_drift_queue_events (
          place_id, city_id, drift_kind, outcome, sqlstate, message
        ) VALUES (
          NEW.id, NEW.city_id, v_drift_kind, 'skipped_active_run', v_sqlstate, v_message
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'place drift skip for % could not be recorded: % %', NEW.id, SQLSTATE, SQLERRM;
      END;
      RETURN NEW;
    WHEN OTHERS THEN
      v_sqlstate := SQLSTATE;
      v_message := SQLERRM;
      RAISE WARNING 'place drift re-evaluation for % was not queued: % %', NEW.id, v_sqlstate, v_message;
      BEGIN
        INSERT INTO public.place_drift_queue_events (
          place_id, city_id, drift_kind, outcome, sqlstate, message
        ) VALUES (
          NEW.id, NEW.city_id, v_drift_kind, 'queue_failed', v_sqlstate, v_message
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'place drift failure for % could not be recorded: % %', NEW.id, SQLSTATE, SQLERRM;
      END;
      RETURN NEW;
  END;
END;
$$;

-- The existing kicker with recovery at its head, and re-kicks that go to the least
-- recently kicked runs. It also re-kicks a run whose counter is full, because only the
-- worker can finish one, and a run like that held its slot forever.
CREATE OR REPLACE FUNCTION public.tg_kick_pending_trial_runs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  q record;
  worker_url text;
  service_key text;
  running_count int;
  free_slots int;
BEGIN
  -- Recovery must not be able to stop the kicker.
  BEGIN
    PERFORM public.place_intel_reap_stalled_runs();
    PERFORM public.place_intel_auto_resume_system_runs();
    PERFORM public.place_intel_requeue_skipped_drift();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'place intelligence recovery failed: % %', SQLSTATE, SQLERRM;
  END;

  worker_url := 'https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/run-place-intelligence-trial';

  SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;

  IF service_key IS NULL THEN
    RAISE NOTICE 'tg_kick_pending_trial_runs: service_role_key not in vault, skipping tick';
    RETURN;
  END IF;

  -- MAX_CONCURRENT_RUNS = 4. MUST stay in sync with the TS constant
  -- MAX_CONCURRENT_RUNS in
  -- supabase/functions/run-place-intelligence-trial/index.ts (ORCH-1032 S-2).
  -- Change one, change the other in the SAME PR. Regression test SC-2 / T-14
  -- asserts the two literals match.
  SELECT count(*) INTO running_count
    FROM public.place_intelligence_runs
    WHERE status = 'running';

  free_slots := 4 - running_count;   -- LITERAL 4 == MAX_CONCURRENT_RUNS (ORCH-1032 S-2)

  IF free_slots > 0 THEN
    FOR q IN
      SELECT id FROM public.place_intelligence_runs
      WHERE status = 'queued'
      ORDER BY created_at ASC                                       -- oldest queued first
      LIMIT free_slots
      FOR UPDATE SKIP LOCKED                                        -- never block a concurrent tick
    LOOP
      UPDATE public.place_intelligence_runs
        SET status = 'running',
            started_at = now(),
            last_kicked_at = now()
        WHERE id = q.id;
      -- kick the freshly-promoted run immediately (don't wait for next tick)
      PERFORM net.http_post(
        url := worker_url,
        body := jsonb_build_object('action', 'process_chunk', 'run_id', q.id),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || service_key
        )
      );
    END LOOP;
  END IF;

  -- v3 patch (2026-05-06): WHERE includes 'cancelling' so the worker can observe the
  -- cancel signal and finalize. DO NOT regress (HG-3 / INV-P4). LIMIT 4 mirrors the
  -- cap. #4276: the 90-second stale filter stays, ordered by the last kick.
  FOR r IN
    SELECT id FROM public.place_intelligence_runs
    WHERE status IN ('running', 'cancelling')
      AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now() - interval '90 seconds')
      AND (last_kicked_at IS NULL OR last_kicked_at < now() - interval '90 seconds')
    ORDER BY last_kicked_at ASC NULLS FIRST, created_at ASC
    LIMIT 4                                                          -- ORCH-1032: was 5; == MAX_CONCURRENT_RUNS
  LOOP
    UPDATE public.place_intelligence_runs SET last_kicked_at = now() WHERE id = r.id;
    PERFORM net.http_post(
      url := worker_url,
      body := jsonb_build_object(
        'action', 'process_chunk',
        'run_id', r.id
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
      )
    );
  END LOOP;
END;
$$;

-- ── C1: the tick ────────────────────────────────────────────────────────────
-- Posts only when a person's run is waiting, so an idle cron costs nothing and can't
-- start anything.
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
        OR (status = 'running' AND (lease_until IS NULL OR lease_until < now()))
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

DO $cron$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'city_pipeline_tick';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
  PERFORM cron.schedule('city_pipeline_tick', '* * * * *', 'SELECT public.tg_kick_city_pipeline();');
END;
$cron$;

-- ── Grants: service role only, the admin reaches these through run-city-pipeline ──
REVOKE ALL ON FUNCTION public.city_pipeline_start(uuid, uuid, text, numeric, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.city_pipeline_claim_tick(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.city_pipeline_gate_inputs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.city_pipeline_hold_unjudged(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.city_pipeline_place_counts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.city_pipeline_places_to_score(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.city_pipeline_release_places(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.city_pipeline_blockers(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.city_pipeline_no_city_report() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.city_pipeline_assign_no_city() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seeding_claim_next_batch(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seeding_claim_retry_batch(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seeding_finish_batch(uuid, uuid, text, integer, double precision, integer, integer, integer, integer, integer, integer, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_run_serper_requests(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.city_pipeline_spend_rows(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.city_pipeline_spend_ledger(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.city_pipeline_gemini_cost_sample(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.city_pipeline_mv_refresh_health(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.place_intel_provider_healthy(text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.place_intel_reap_stalled_runs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.place_intel_auto_resume_system_runs(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.place_intel_requeue_skipped_drift(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_kick_city_pipeline() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.city_pipeline_start(uuid, uuid, text, numeric, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.city_pipeline_claim_tick(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.city_pipeline_gate_inputs() TO service_role;
GRANT EXECUTE ON FUNCTION public.city_pipeline_hold_unjudged(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.city_pipeline_place_counts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.city_pipeline_places_to_score(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.city_pipeline_release_places(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.city_pipeline_blockers(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.city_pipeline_no_city_report() TO service_role;
GRANT EXECUTE ON FUNCTION public.city_pipeline_assign_no_city() TO service_role;
GRANT EXECUTE ON FUNCTION public.seeding_claim_next_batch(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.seeding_claim_retry_batch(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.seeding_finish_batch(uuid, uuid, text, integer, double precision, integer, integer, integer, integer, integer, integer, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_run_serper_requests(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.city_pipeline_spend_rows(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.city_pipeline_spend_ledger(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.city_pipeline_gemini_cost_sample(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.city_pipeline_mv_refresh_health(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.place_intel_provider_healthy(text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.place_intel_reap_stalled_runs() TO service_role;
GRANT EXECUTE ON FUNCTION public.place_intel_auto_resume_system_runs(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.place_intel_requeue_skipped_drift(integer) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
