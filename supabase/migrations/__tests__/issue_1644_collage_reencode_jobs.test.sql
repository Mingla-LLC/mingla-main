-- Issue #1644 Stage 2 — contract test for the collage re-encode manifest + write path.
--
-- WHY THIS IS DELIBERATELY BEHAVIOURAL, NOT STRUCTURAL
-- ----------------------------------------------------
-- `issue_1644_collage_reencode_commit` is the ONLY sanctioned write to
-- `place_pool.photo_collage_url` outside `run-place-intelligence-trial`
-- (I-COLLAGE-SOLE-OWNER). A bug in it repoints live places at objects that do not
-- exist, and the delete step then removes the only copies of the originals. So
-- this test does not merely check that the function exists — it drives the whole
-- state machine and asserts the resulting rows, including every refusal path.
--
-- Runs inside a transaction and ROLLBACKs, so it is safe to re-run and leaves no
-- residue.

\set ON_ERROR_STOP on

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. STRUCTURE — the table, its RLS, and the format-only CHECK
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_rls boolean;
  v_policies integer;
BEGIN
  SELECT c.relrowsecurity INTO v_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'place_collage_reencode_jobs';

  IF v_rls IS NULL THEN
    RAISE EXCEPTION 'public.place_collage_reencode_jobs does not exist';
  END IF;
  IF NOT v_rls THEN
    RAISE EXCEPTION 'place_collage_reencode_jobs MUST have RLS enabled (else it needs an rls-allowlist.json entry)';
  END IF;

  SELECT count(*) INTO v_policies
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'place_collage_reencode_jobs';
  IF v_policies = 0 THEN
    RAISE EXCEPTION 'RLS is on but no policy exists — service_role would be locked out of its own job table';
  END IF;

  IF has_table_privilege('anon', 'public.place_collage_reencode_jobs', 'SELECT') THEN
    RAISE EXCEPTION 'anon MUST NOT be able to read the re-encode manifest';
  END IF;
  IF has_table_privilege('authenticated', 'public.place_collage_reencode_jobs', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated MUST NOT be able to read the re-encode manifest';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.place_collage_reencode_jobs', 'SELECT') THEN
    RAISE EXCEPTION 'service_role MUST be able to read the manifest — the worker cannot resume without it';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. GRANTS — every function is service_role-only (ORCH-1392: no anon-executable
--    SECURITY DEFINER without an allowlist entry, and we want no entry)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_sig text;
  v_sigs text[] := ARRAY[
    'public.issue_1644_collage_reencode_plan(uuid, integer)',
    'public.issue_1644_collage_reencode_claim(uuid, integer)',
    'public.issue_1644_collage_reencode_commit(uuid)',
    'public.issue_1644_collage_reencode_rollback(uuid)',
    'public.issue_1644_collage_reencode_stats(uuid)',
    'public.issue_1644_collage_bucket_accepts_webp()'
  ];
BEGIN
  FOREACH v_sig IN ARRAY v_sigs LOOP
    IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role MUST be able to execute %', v_sig;
    END IF;
    IF has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon MUST NOT execute % (ORCH-1392 allowlist violation)', v_sig;
    END IF;
    IF has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated MUST NOT execute %', v_sig;
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. THE FORMAT-ONLY CONSTRAINT IS REAL — the table itself must reject a row
--    whose new_key is anything other than the old key with .png -> .webp.
--    Without this, "format only" would be a comment rather than a guarantee.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_place uuid;
  v_run   uuid := gen_random_uuid();
  v_ok    boolean;
BEGIN
  INSERT INTO public.place_pool (name, lat, lng)
  VALUES ('#1644 constraint probe', 1.0, 1.0)
  RETURNING id INTO v_place;

  -- (a) cross-place rewrite must be impossible
  BEGIN
    INSERT INTO public.place_collage_reencode_jobs (run_id, place_pool_id, old_key, new_key, old_bytes)
    VALUES (v_run, v_place, v_place || '/aaaaaaaaaaaa.png', '00000000-0000-0000-0000-000000000000/aaaaaaaaaaaa.webp', 100);
    v_ok := true;
  EXCEPTION WHEN check_violation THEN
    v_ok := false;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'the format-only CHECK must reject a cross-place rewrite';
  END IF;

  -- (b) different fingerprint must be impossible
  BEGIN
    INSERT INTO public.place_collage_reencode_jobs (run_id, place_pool_id, old_key, new_key, old_bytes)
    VALUES (v_run, v_place, v_place || '/aaaaaaaaaaaa.png', v_place || '/bbbbbbbbbbbb.webp', 100);
    v_ok := true;
  EXCEPTION WHEN check_violation THEN
    v_ok := false;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'the format-only CHECK must reject a different-fingerprint rewrite';
  END IF;

  -- (c) zero-byte source must be impossible (a 0-byte "original" is a failed upload)
  BEGIN
    INSERT INTO public.place_collage_reencode_jobs (run_id, place_pool_id, old_key, new_key, old_bytes)
    VALUES (v_run, v_place, v_place || '/aaaaaaaaaaaa.png', v_place || '/aaaaaaaaaaaa.webp', 0);
    v_ok := true;
  EXCEPTION WHEN check_violation THEN
    v_ok := false;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'old_bytes must be positive';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. PLAN — only picks objects the pool is ACTUALLY POINTING AT
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_bucket   text := 'place-collages';
  v_run      uuid := gen_random_uuid();
  v_pointed  uuid;
  v_orphan   uuid;
  v_planned  integer;
  v_keys     text[];
BEGIN
  INSERT INTO storage.buckets (id, name) VALUES (v_bucket, v_bucket) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.place_pool (name, lat, lng) VALUES ('#1644 pointed', 1, 1) RETURNING id INTO v_pointed;
  INSERT INTO public.place_pool (name, lat, lng) VALUES ('#1644 orphan',  1, 1) RETURNING id INTO v_orphan;

  UPDATE public.place_pool
     SET photo_collage_url = 'https://x.supabase.co/storage/v1/object/public/place-collages/' || v_pointed || '/aaaaaaaaaaaa.png'
   WHERE id = v_pointed;
  -- The orphan's pool row points at a DIFFERENT fingerprint than the stored object.
  UPDATE public.place_pool
     SET photo_collage_url = 'https://x.supabase.co/storage/v1/object/public/place-collages/' || v_orphan || '/ffffffffffff.png'
   WHERE id = v_orphan;

  INSERT INTO storage.objects (bucket_id, name, metadata) VALUES
    (v_bucket, v_pointed || '/aaaaaaaaaaaa.png', jsonb_build_object('size', 1000000)),
    (v_bucket, v_orphan  || '/cccccccccccc.png', jsonb_build_object('size', 900000)),
    -- a zero-byte failed upload must never be planned
    (v_bucket, v_pointed || '/dddddddddddd.png', jsonb_build_object('size', 0));

  SELECT public.issue_1644_collage_reencode_plan(v_run) INTO v_planned;

  IF v_planned <> 1 THEN
    RAISE EXCEPTION 'plan must select exactly the 1 object the pool points at, got %', v_planned;
  END IF;

  SELECT array_agg(old_key ORDER BY old_key) INTO v_keys
  FROM public.place_collage_reencode_jobs WHERE run_id = v_run;
  IF v_keys <> ARRAY[v_pointed || '/aaaaaaaaaaaa.png'] THEN
    RAISE EXCEPTION 'plan selected the wrong object(s): %', v_keys;
  END IF;

  -- Idempotency: a re-plan of the same run must add nothing.
  SELECT public.issue_1644_collage_reencode_plan(v_run) INTO v_planned;
  IF v_planned <> 0 THEN
    RAISE EXCEPTION 're-planning must be a no-op, inserted % more rows', v_planned;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. CLAIM — atomic, bounded, and increments attempts
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_run   uuid := gen_random_uuid();
  v_place uuid;
  v_n     integer;
  v_ok    boolean;
BEGIN
  INSERT INTO public.place_pool (name, lat, lng) VALUES ('#1644 claim', 1, 1) RETURNING id INTO v_place;
  INSERT INTO public.place_collage_reencode_jobs (run_id, place_pool_id, old_key, new_key, old_bytes)
  VALUES
    (v_run, v_place, v_place || '/111111111111.png', v_place || '/111111111111.webp', 300),
    (v_run, v_place, v_place || '/222222222222.png', v_place || '/222222222222.webp', 200),
    (v_run, v_place, v_place || '/333333333333.png', v_place || '/333333333333.webp', 100);

  SELECT count(*) INTO v_n FROM public.issue_1644_collage_reencode_claim(v_run, 2);
  IF v_n <> 2 THEN RAISE EXCEPTION 'claim(2) must return 2 rows, got %', v_n; END IF;

  SELECT count(*) INTO v_n
  FROM public.place_collage_reencode_jobs
  WHERE run_id = v_run AND status = 'claimed' AND attempts = 1;
  IF v_n <> 2 THEN RAISE EXCEPTION 'claimed rows must be marked claimed with attempts=1, got %', v_n; END IF;

  -- Largest-first: the 100-byte row must be the one still pending.
  SELECT count(*) INTO v_n
  FROM public.place_collage_reencode_jobs
  WHERE run_id = v_run AND status = 'pending' AND old_bytes = 100;
  IF v_n <> 1 THEN RAISE EXCEPTION 'claim must hand out the largest objects first'; END IF;

  -- An unbounded claim would let one worker swallow the whole 34,024-row manifest.
  BEGIN
    PERFORM public.issue_1644_collage_reencode_claim(v_run, 100000);
    v_ok := true;
  EXCEPTION WHEN others THEN
    v_ok := false;
  END;
  IF v_ok THEN RAISE EXCEPTION 'claim must refuse an unbounded p_limit'; END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. COMMIT — the whole ordering contract, both the happy path and the refusals
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_run    uuid := gen_random_uuid();
  v_place  uuid;
  v_job    uuid;
  v_prefix text := 'https://x.supabase.co/storage/v1/object/public/place-collages/';
  v_res    jsonb;
  v_url    text;
  v_hist   text;
  v_ok     boolean;
BEGIN
  INSERT INTO public.place_pool (name, lat, lng) VALUES ('#1644 commit', 1, 1) RETURNING id INTO v_place;
  UPDATE public.place_pool
     SET photo_collage_url = v_prefix || v_place || '/abcabcabcabc.png',
         photo_collage_fingerprint = 'abcabcabcabc-full-sha'
   WHERE id = v_place;

  INSERT INTO public.place_intelligence_trial_runs (run_id, place_pool_id, input_payload, collage_url)
  VALUES (gen_random_uuid(), v_place, '{}'::jsonb, v_prefix || v_place || '/abcabcabcabc.png');

  INSERT INTO public.place_collage_reencode_jobs (run_id, place_pool_id, old_key, new_key, old_bytes)
  VALUES (v_run, v_place, v_place || '/abcabcabcabc.png', v_place || '/abcabcabcabc.webp', 1000000)
  RETURNING id INTO v_job;

  -- (a) REFUSE an unverified job. This is the ordering contract: the replacement
  --     must be proven to exist and be fetchable before any live URL moves.
  BEGIN
    PERFORM public.issue_1644_collage_reencode_commit(v_job);
    v_ok := true;
  EXCEPTION WHEN others THEN
    v_ok := false;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'commit MUST refuse a job that has not been verified';
  END IF;

  -- (b) HAPPY PATH
  UPDATE public.place_collage_reencode_jobs
     SET status = 'verified', new_bytes = 95000, verified_at = now()
   WHERE id = v_job;

  SELECT public.issue_1644_collage_reencode_commit(v_job) INTO v_res;
  IF v_res ->> 'status' <> 'committed' THEN
    RAISE EXCEPTION 'commit should have committed, returned %', v_res;
  END IF;
  IF (v_res ->> 'pool_rows_updated')::int <> 1 THEN
    RAISE EXCEPTION 'commit must update exactly 1 place_pool row, returned %', v_res;
  END IF;
  IF (v_res ->> 'history_rows_updated')::int <> 1 THEN
    RAISE EXCEPTION 'commit must repoint the trial-run history or the admin thumbnails break after delete: %', v_res;
  END IF;

  SELECT photo_collage_url INTO v_url FROM public.place_pool WHERE id = v_place;
  IF v_url <> v_prefix || v_place || '/abcabcabcabc.webp' THEN
    RAISE EXCEPTION 'place_pool URL not swapped correctly: %', v_url;
  END IF;

  SELECT collage_url INTO v_hist FROM public.place_intelligence_trial_runs WHERE place_pool_id = v_place;
  IF v_hist <> v_prefix || v_place || '/abcabcabcabc.webp' THEN
    RAISE EXCEPTION 'trial-run history URL not swapped correctly: %', v_hist;
  END IF;

  -- The fingerprint must be UNTOUCHED. It fingerprints the SOURCE PHOTOS, so
  -- writing it would break the pipeline's idempotency cache-hit branch.
  IF (SELECT photo_collage_fingerprint FROM public.place_pool WHERE id = v_place)
     <> 'abcabcabcabc-full-sha' THEN
    RAISE EXCEPTION 'commit must NOT write photo_collage_fingerprint';
  END IF;

  -- (c) IDEMPOTENT REPLAY
  SELECT public.issue_1644_collage_reencode_commit(v_job) INTO v_res;
  IF (v_res ->> 'already')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'a repeated commit must be a reported no-op, got %', v_res;
  END IF;

  -- (d) ROLLBACK restores both surfaces
  SELECT public.issue_1644_collage_reencode_rollback(v_job) INTO v_res;
  IF (v_res ->> 'rolled_back')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'rollback should have reverted the commit, got %', v_res;
  END IF;
  SELECT photo_collage_url INTO v_url FROM public.place_pool WHERE id = v_place;
  IF v_url <> v_prefix || v_place || '/abcabcabcabc.png' THEN
    RAISE EXCEPTION 'rollback did not restore the .png URL: %', v_url;
  END IF;
  SELECT collage_url INTO v_hist FROM public.place_intelligence_trial_runs WHERE place_pool_id = v_place;
  IF v_hist <> v_prefix || v_place || '/abcabcabcabc.png' THEN
    RAISE EXCEPTION 'rollback did not restore the history URL: %', v_hist;
  END IF;

  -- (e) ROLLBACK REFUSES once the PNG is gone — there would be nothing to point at.
  UPDATE public.place_collage_reencode_jobs SET status = 'deleted', deleted_at = now() WHERE id = v_job;
  BEGIN
    PERFORM public.issue_1644_collage_reencode_rollback(v_job);
    v_ok := true;
  EXCEPTION WHEN others THEN
    v_ok := false;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'rollback MUST refuse a job whose .png has already been deleted';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. COMMIT SKIPS (never silently mis-points) when the world moved underneath it
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_run    uuid := gen_random_uuid();
  v_place  uuid;
  v_job    uuid;
  v_prefix text := 'https://x.supabase.co/storage/v1/object/public/place-collages/';
  v_res    jsonb;
BEGIN
  -- (a) the intelligence pipeline re-composed onto a different fingerprint
  INSERT INTO public.place_pool (name, lat, lng) VALUES ('#1644 moved', 1, 1) RETURNING id INTO v_place;
  UPDATE public.place_pool
     SET photo_collage_url = v_prefix || v_place || '/999999999999.png'
   WHERE id = v_place;

  INSERT INTO public.place_collage_reencode_jobs (run_id, place_pool_id, old_key, new_key, old_bytes, status, new_bytes)
  VALUES (v_run, v_place, v_place || '/abcabcabcabc.png', v_place || '/abcabcabcabc.webp', 1000000, 'verified', 90000)
  RETURNING id INTO v_job;

  SELECT public.issue_1644_collage_reencode_commit(v_job) INTO v_res;
  IF v_res ->> 'status' <> 'skipped' OR v_res ->> 'reason' <> 'pool_url_moved' THEN
    RAISE EXCEPTION 'commit must SKIP when the pool moved to another object, got %', v_res;
  END IF;
  IF (SELECT photo_collage_url FROM public.place_pool WHERE id = v_place)
     <> v_prefix || v_place || '/999999999999.png' THEN
    RAISE EXCEPTION 'a skipped commit must not have touched the pool URL';
  END IF;

  -- (b) the place lost its collage entirely
  INSERT INTO public.place_pool (name, lat, lng) VALUES ('#1644 nulled', 1, 1) RETURNING id INTO v_place;
  INSERT INTO public.place_collage_reencode_jobs (run_id, place_pool_id, old_key, new_key, old_bytes, status, new_bytes)
  VALUES (v_run, v_place, v_place || '/abcabcabcabc.png', v_place || '/abcabcabcabc.webp', 1000000, 'verified', 90000)
  RETURNING id INTO v_job;

  SELECT public.issue_1644_collage_reencode_commit(v_job) INTO v_res;
  IF v_res ->> 'status' <> 'skipped' OR v_res ->> 'reason' <> 'pool_url_null' THEN
    RAISE EXCEPTION 'commit must SKIP when the pool URL is null, got %', v_res;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. STATS — the operator-facing roll-up must count real bytes, not zeroes
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_run   uuid := gen_random_uuid();
  v_place uuid;
  v_stats jsonb;
BEGIN
  INSERT INTO public.place_pool (name, lat, lng) VALUES ('#1644 stats', 1, 1) RETURNING id INTO v_place;
  INSERT INTO public.place_collage_reencode_jobs
    (run_id, place_pool_id, old_key, new_key, old_bytes, new_bytes, status)
  VALUES
    (v_run, v_place, v_place || '/aaa000000000.png', v_place || '/aaa000000000.webp', 1000000, 100000, 'committed'),
    (v_run, v_place, v_place || '/bbb000000000.png', v_place || '/bbb000000000.webp', 2000000, 150000, 'committed'),
    (v_run, v_place, v_place || '/ccc000000000.png', v_place || '/ccc000000000.webp', 500000, NULL,    'pending');

  SELECT public.issue_1644_collage_reencode_stats(v_run) INTO v_stats;

  IF (v_stats ->> 'jobs')::bigint <> 3 THEN
    RAISE EXCEPTION 'stats.jobs wrong: %', v_stats;
  END IF;
  IF (v_stats ->> 'old_bytes')::bigint <> 3500000 THEN
    RAISE EXCEPTION 'stats.old_bytes wrong: %', v_stats;
  END IF;
  IF (v_stats ->> 'new_bytes')::bigint <> 250000 THEN
    RAISE EXCEPTION 'stats.new_bytes wrong: %', v_stats;
  END IF;
  -- Realised reclaim counts ONLY committed/deleted rows: 3,000,000 - 250,000.
  IF (v_stats ->> 'reclaimable_bytes')::bigint <> 2750000 THEN
    RAISE EXCEPTION 'stats.reclaimable_bytes must count only committed/deleted rows: %', v_stats;
  END IF;
  IF (v_stats -> 'by_status' ->> 'committed')::int <> 2
     OR (v_stats -> 'by_status' ->> 'pending')::int <> 1 THEN
    RAISE EXCEPTION 'stats.by_status wrong: %', v_stats;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. THE BUCKET MIME PRE-FLIGHT — the check that would have caught the real
--    production blocker (place-collages allowed only png+jpeg, so every WebP
--    upload would have 400'd on object 1 of 34,024).
--
--    The CI image ships a MINIMAL storage.buckets with no allowed_mime_types
--    column, so the assertions branch on the column's presence: the pre-flight
--    must be honest in BOTH shapes rather than reporting a comforting `true`
--    because it could not look.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_has_column boolean;
  v_res jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'allowed_mime_types'
  ) INTO v_has_column;

  -- No bucket at all must be reported as NOT acceptable, never as "fine".
  DELETE FROM storage.objects WHERE bucket_id = 'place-collages';
  DELETE FROM storage.buckets WHERE id = 'place-collages';
  SELECT public.issue_1644_collage_bucket_accepts_webp() INTO v_res;
  IF (v_res ->> 'accepts_webp')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'a missing place-collages bucket must not be reported as webp-ready: %', v_res;
  END IF;
  IF v_res ->> 'reason' <> 'bucket_missing' THEN
    RAISE EXCEPTION 'expected reason=bucket_missing, got %', v_res;
  END IF;

  INSERT INTO storage.buckets (id, name) VALUES ('place-collages', 'place-collages');
  SELECT public.issue_1644_collage_bucket_accepts_webp() INTO v_res;

  IF v_has_column THEN
    -- Production shape: the migration must have added image/webp to the list.
    IF (v_res ->> 'accepts_webp')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION
        'place-collages must accept image/webp after this migration — otherwise every upload 400s: %',
        v_res;
    END IF;
  ELSE
    -- Minimal CI shape: no MIME policy exists, and the function must say WHY it
    -- is permissive rather than silently implying it verified a policy.
    IF v_res ->> 'reason' <> 'no_mime_policy_column' THEN
      RAISE EXCEPTION 'on a bucket table with no MIME policy the pre-flight must say so, got %', v_res;
    END IF;
  END IF;
END $$;

ROLLBACK;
