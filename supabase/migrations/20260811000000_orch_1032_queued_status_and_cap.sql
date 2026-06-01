-- ORCH-1032: add 'queued' parent status + widen per-city unique active index +
-- widen cron promotion (this migration owns the status CHECK + index; the §4.4
-- cron fn is in the SAME migration file so the cap is consistent in one atomic
-- apply).
--
-- Filename note: SPEC §4.1 proposed prefix 20260809000000, but at IMPLEMENT the
-- linked remote already carried 20260809000000 (meta_orch_1009_sub_e),
-- 20260809000300, and 20260810000000 (orch_1027_launch_cities). Bumped to
-- 20260811000000 to stay strictly greater than the max local + linked-remote
-- head (verified via mcp__supabase__list_migrations 2026-06-01) and above the
-- sibling worktree prefixes (20260809000000 / 20260809000300).
--
-- ADDITIVE ONLY — safe to apply while runs are actively 'running':
--   * ALTER ... DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT  (CHECK widen is a
--     metadata-only validation pass over existing rows; new set is a strict
--     superset of the old, so every existing row already satisfies it — no
--     rewrite, no exclusive lock that blocks worker UPDATEs beyond the brief
--     ACCESS EXCLUSIVE needed to swap the constraint. Postgres validates the
--     new CHECK against existing rows; all current rows are in the old 6-value
--     set ⊂ new 7-value set, so validation cannot fail.)
--   * DROP INDEX / CREATE UNIQUE INDEX  (the partial unique index is recreated;
--     CREATE UNIQUE INDEX without CONCURRENTLY takes a SHARE lock that blocks
--     writes to place_intelligence_runs only for the build duration — the table
--     is tiny (low hundreds of rows), build is sub-second. Acceptable: workers
--     UPDATE via increment_run_counters which momentarily waits, then proceeds.)
--   * CREATE OR REPLACE FUNCTION  (atomic; in-flight cron tick uses old body
--     until commit, next tick uses new — same property the v3 patch relied on.)
-- No DROP TABLE, no column type change, no NOT NULL add, no data migration.
--
-- Live probe at IMPLEMENT (read-only, 2026-06-01): live status constraint name
-- IS 'place_intelligence_runs_status_check'; live index WHERE was
-- ('pending','running','cancelling'); 5 runs 'running' (Washington/Lagos/Durham/
-- Brussels/Fort Lauderdale) — NOT touched by this migration.
--
-- Docs verified (COMMS-0003):
--   CHECK constraints: https://www.postgresql.org/docs/current/ddl-constraints.html
--   Partial indexes:   https://www.postgresql.org/docs/current/indexes-partial.html
--   pg_cron:           https://supabase.com/docs/guides/cron
--   pg_net http_post:  https://supabase.com/docs/guides/database/extensions/pg_net
--   SELECT FOR UPDATE SKIP LOCKED:
--     https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE

BEGIN;

-- ── S-1a: widen status CHECK to admit 'queued' ──────────────────────────────
-- Live constraint name confirmed via read-only probe (2026-06-01):
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'public.place_intelligence_runs'::regclass AND contype='c'
--     AND pg_get_constraintdef(oid) LIKE '%status%';
--   => 'place_intelligence_runs_status_check'
ALTER TABLE public.place_intelligence_runs
  DROP CONSTRAINT IF EXISTS place_intelligence_runs_status_check;

ALTER TABLE public.place_intelligence_runs
  ADD CONSTRAINT place_intelligence_runs_status_check
  CHECK (status IN ('pending','queued','running','cancelling','cancelled','complete','failed'));

-- ── S-1b: widen per-city unique partial active index to count 'queued' ──────
-- A city must NOT have a queued run AND a running run simultaneously (and never
-- two queued). Adding 'queued' to the WHERE keeps "one active commitment per
-- city" — start_run's 23505 duplicate guard now also fires if the city already
-- has a queued run. Safe with active rows: index is recreated, current rows all
-- hold distinct city_id in the active set.
DROP INDEX IF EXISTS public.uniq_one_running_run_per_city;
CREATE UNIQUE INDEX uniq_one_running_run_per_city
  ON public.place_intelligence_runs (city_id)
  WHERE status IN ('pending','queued','running','cancelling');

-- ── S-1c: update the state-machine COMMENT ──────────────────────────────────
COMMENT ON TABLE public.place_intelligence_runs IS
  'ORCH-0737 (DEC-111); ORCH-1032 added queued. Run-level parent. Children are place_intelligence_trial_runs rows linked via parent_run_id FK. Status state machine: pending -> (queued -> running) | running -> (cancelling -> cancelled) | complete | failed. queued = accepted but waiting for a concurrency slot (started_at NULL, no first-chunk kick); tg_kick_pending_trial_runs promotes oldest queued -> running when running_count < MAX_CONCURRENT_RUNS. last_heartbeat_at updated by worker chunks; pg_cron re-kicks running/cancelling runs when heartbeat is stale (>90s).';

-- ── S-4: cron promotion (built on the ORCH-0737 v3 body; same file as S-1) ───
-- CREATE OR REPLACE the kicker. Adds a promotion block at tick start that
-- promotes the oldest queued run(s) into free slots and kicks them, THEN keeps
-- the v3 stale-heartbeat re-kick (status IN ('running','cancelling')) verbatim
-- except LIMIT 5 -> 4 to mirror the cap (HG-3 / INV-P4 preserved).
CREATE OR REPLACE FUNCTION public.tg_kick_pending_trial_runs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
  q record;
  worker_url text;
  service_key text;
  running_count int;
  free_slots int;
BEGIN
  worker_url := 'https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/run-place-intelligence-trial';

  SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;

  IF service_key IS NULL THEN
    RAISE NOTICE 'tg_kick_pending_trial_runs: service_role_key not in vault, skipping tick';
    RETURN;
  END IF;

  -- ── ORCH-1032 S-4: promote queued runs into free slots, THEN kick them ────
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
            started_at = now()
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

  -- ── existing stale-heartbeat re-kick (v3 — preserved verbatim, LIMIT 5→4) ──
  -- v3 patch (2026-05-06): WHERE widened from `status = 'running'` to include
  -- 'cancelling' so the worker can observe the cancel signal and finalize the
  -- transition (UI would otherwise sit at "cancelling" forever). 'cancelling'
  -- is transitional (worker finalizes to 'cancelled' on first kick after
  -- observe), so this only fires at most once per run. DO NOT regress (HG-3 /
  -- INV-P4). LIMIT 4 mirrors the cap (was 5 pre-ORCH-1032); at most 4 runs ever
  -- 'running', so 5 was already unreachable — kept equal to the constant for
  -- clarity + the T-14 match assertion. A run promoted above is freshly
  -- 'running' with NULL heartbeat so it could match here too — harmless
  -- (idempotent kick); the 90s-stale filter naturally excludes it next tick.
  FOR r IN
    SELECT id FROM public.place_intelligence_runs
    WHERE status IN ('running', 'cancelling')
      AND processed_count < total_count
      AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now() - interval '90 seconds')
    ORDER BY created_at ASC                                         -- oldest first
    LIMIT 4                                                          -- ORCH-1032: was 5; == MAX_CONCURRENT_RUNS
  LOOP
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

COMMENT ON FUNCTION public.tg_kick_pending_trial_runs IS
  'ORCH-0737 (DEC-111) v3 + ORCH-1032. pg_cron-driven kicker, every 1 min. ORCH-1032 S-4: at tick start, if running_count < MAX_CONCURRENT_RUNS (=4), promote the oldest queued run(s) to running (stamp started_at) up to the free-slot count and kick them via pg_net. Then re-kick already-running/cancelling runs with a stale heartbeat (>90s), LIMIT 4. queued runs auto-start as slots free. Service role key from vault.decrypted_secrets; if missing, skips silently (RAISE NOTICE). Docs: https://supabase.com/docs/guides/cron , https://supabase.com/docs/guides/database/extensions/pg_net';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK reference (if ORCH-1032 needs to be reverted):
--   BEGIN;
--   -- restore the v3 function body (LIMIT 5, no promotion block) from
--   -- 20260506000002_orch_0737_v3_cron_filter_cancelling.sql verbatim;
--   DROP INDEX IF EXISTS public.uniq_one_running_run_per_city;
--   CREATE UNIQUE INDEX uniq_one_running_run_per_city
--     ON public.place_intelligence_runs (city_id)
--     WHERE status IN ('pending','running','cancelling');
--   ALTER TABLE public.place_intelligence_runs
--     DROP CONSTRAINT IF EXISTS place_intelligence_runs_status_check;
--   ALTER TABLE public.place_intelligence_runs
--     ADD CONSTRAINT place_intelligence_runs_status_check
--     CHECK (status IN ('pending','running','cancelling','cancelled','complete','failed'));
--   -- NOTE: revert only safe once no rows remain in status='queued'.
--   COMMIT;
-- ─────────────────────────────────────────────────────────────────────────
