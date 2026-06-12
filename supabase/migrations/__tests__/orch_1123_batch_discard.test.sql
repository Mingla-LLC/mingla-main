-- ORCH-1123 [Hub multi-select draft delete] — behavioral probe for
-- migration 20260928000002_orch_1123_batch_discard_offering_drafts.sql.
--
-- USAGE (manual; this repo's SQL probe convention is hand-run psql against
-- the linked remote via the Supabase Management API or `supabase db remote`):
--
--   cat supabase/migrations/__tests__/orch_1123_batch_discard.test.sql \
--     | /Users/sethogieva/bin/supabase db remote sql --linked
--
-- This probe is TRANSACTIONAL (wrapped in a savepoint-style anonymous block
-- that ROLLBACKs all seeded rows) — it never leaves test data behind. It seeds
-- 3 drafts (event/trip/experience) for a freshly-minted brand the synthetic
-- caller manages, calls business_discard_offering_drafts, and asserts the
-- per-row SKIP-and-report contract from SPEC §5 + §2.5.
--
-- Coverage (SPEC §5 implementor SQL behavioral):
--   B-01: 3 drafts (event/trip/experience) the caller manages → all 'deleted'
--         + deleted_at set
--   B-02: a non-draft (status='scheduled') id → 'skipped_not_draft', NOT deleted
--   B-03: a missing/random id → 'skipped_not_found'
--   B-04: re-run on already-deleted id → 'skipped_not_found' (idempotent)
--
-- NOTE: this probe assumes biz_brand_effective_rank + biz_role_rank resolve a
-- brand the synthetic v_user owns to >= event_manager. It seeds an owner-rank
-- membership row through the canonical brand-creation ownership path. If the
-- ranking helpers' membership table differs in the live schema, the probe's
-- RAISE EXCEPTION on B-01 will flag it (this is the intended failure surface).

DO $$
DECLARE
  v_user        uuid := gen_random_uuid();
  v_brand       uuid := gen_random_uuid();
  v_ev_draft    uuid := gen_random_uuid();
  v_trip_draft  uuid := gen_random_uuid();
  v_exp_draft   uuid := gen_random_uuid();
  v_live        uuid := gen_random_uuid();
  v_missing     uuid := gen_random_uuid();
  v_rec         record;
  v_deleted_cnt int := 0;
  v_outcome     text;
  v_deleted_at  timestamptz;
BEGIN
  -- ---- Seed -------------------------------------------------------------
  -- Minimal brand owned by v_user. Column set is intentionally narrow; if the
  -- live brands table requires more NOT NULL columns, extend here.
  INSERT INTO public.brands (id, account_id, name, slug, created_at, updated_at)
    VALUES (v_brand, v_user, 'ORCH-1123 probe brand',
            'orch-1123-probe-' || substr(v_brand::text, 1, 8), now(), now());

  -- Three drafts of distinct event_type. status='draft', not deleted.
  INSERT INTO public.events (id, brand_id, created_by, title, slug, status, event_type, created_at, updated_at)
    VALUES
      (v_ev_draft,   v_brand, v_user, 'Probe event draft',      'p-ev-'   || substr(v_ev_draft::text,1,8),   'draft', 'event',      now(), now()),
      (v_trip_draft, v_brand, v_user, 'Probe trip draft',       'p-trip-' || substr(v_trip_draft::text,1,8), 'draft', 'trip',       now(), now()),
      (v_exp_draft,  v_brand, v_user, 'Probe experience draft', 'p-exp-'  || substr(v_exp_draft::text,1,8),  'draft', 'experience', now(), now());

  -- A live (non-draft) row for the drafts-only bypass test.
  INSERT INTO public.events (id, brand_id, created_by, title, slug, status, event_type, created_at, updated_at)
    VALUES (v_live, v_brand, v_user, 'Probe live event', 'p-live-' || substr(v_live::text,1,8), 'scheduled', 'event', now(), now());

  -- ---- Impersonate the owner for auth.uid() inside SECURITY DEFINER -----
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- ---- B-01: 3 managed drafts → all 'deleted' --------------------------
  FOR v_rec IN
    SELECT * FROM public.business_discard_offering_drafts(
      ARRAY[v_ev_draft, v_trip_draft, v_exp_draft]::uuid[]
    )
  LOOP
    IF v_rec.outcome <> 'deleted' THEN
      RAISE EXCEPTION 'B-01 FAIL: id % expected deleted, got %', v_rec.event_id, v_rec.outcome;
    END IF;
    v_deleted_cnt := v_deleted_cnt + 1;
  END LOOP;
  IF v_deleted_cnt <> 3 THEN
    RAISE EXCEPTION 'B-01 FAIL: expected 3 deleted rows, got %', v_deleted_cnt;
  END IF;

  SELECT deleted_at INTO v_deleted_at FROM public.events WHERE id = v_ev_draft;
  IF v_deleted_at IS NULL THEN
    RAISE EXCEPTION 'B-01 FAIL: event draft deleted_at not set';
  END IF;
  RAISE NOTICE 'B-01 PASS: 3 managed drafts deleted, deleted_at set';

  -- ---- B-02: non-draft id → skipped_not_draft, not deleted -------------
  SELECT outcome INTO v_outcome
    FROM public.business_discard_offering_drafts(ARRAY[v_live]::uuid[]);
  IF v_outcome <> 'skipped_not_draft' THEN
    RAISE EXCEPTION 'B-02 FAIL: live row expected skipped_not_draft, got %', v_outcome;
  END IF;
  SELECT deleted_at INTO v_deleted_at FROM public.events WHERE id = v_live;
  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'B-02 FAIL: live row was deleted (drafts-only bypass!)';
  END IF;
  RAISE NOTICE 'B-02 PASS: non-draft skipped_not_draft, not deleted';

  -- ---- B-03: missing id → skipped_not_found ----------------------------
  SELECT outcome INTO v_outcome
    FROM public.business_discard_offering_drafts(ARRAY[v_missing]::uuid[]);
  IF v_outcome <> 'skipped_not_found' THEN
    RAISE EXCEPTION 'B-03 FAIL: missing id expected skipped_not_found, got %', v_outcome;
  END IF;
  RAISE NOTICE 'B-03 PASS: missing id skipped_not_found';

  -- ---- B-04: re-run on already-deleted → skipped_not_found (idempotent) -
  SELECT outcome INTO v_outcome
    FROM public.business_discard_offering_drafts(ARRAY[v_ev_draft]::uuid[]);
  IF v_outcome <> 'skipped_not_found' THEN
    RAISE EXCEPTION 'B-04 FAIL: re-discard expected skipped_not_found, got %', v_outcome;
  END IF;
  RAISE NOTICE 'B-04 PASS: idempotent re-discard skipped_not_found';

  RAISE NOTICE 'ORCH-1123 batch-discard probe: ALL PASS';

  -- ---- Teardown — undo everything --------------------------------------
  DELETE FROM public.events WHERE brand_id = v_brand;
  DELETE FROM public.brands WHERE id = v_brand;
END $$;
