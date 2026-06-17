-- ===========================================================================
-- META-ORCH-1148 e2e-validation gap — soft-deleted table is NOT bookable
-- ---------------------------------------------------------------------------
-- Live-SQL test (I-PROPOSED-1148-SOFT-DELETED-TABLE-NOT-BOOKABLE). Run AFTER the
-- 20261013000002 migration is applied, against a live Supabase Postgres:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/migrations/__tests__/orch_1148_table_soft_delete_engine.test.sql
--
-- Self-contained: creates an isolated test brand + venue config + ONE reservable
-- table inside a transaction, asserts the engine returns slots, then SOFT-DELETES
-- the table (stamps deleted_at directly — mirrors biz_venue_table_soft_delete's
-- UPDATE) and asserts the engine now returns ZERO slots. ROLLS BACK (no surviving
-- rows).
--
-- Fails-on-revert: if the engine's eligible-tables CTE drops the
-- `AND t.deleted_at IS NULL` filter, the soft-deleted table keeps producing slots
-- and assertion A-DEL-2 RAISEs.
-- ===========================================================================

\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_brand uuid := gen_random_uuid();
  v_account uuid;
  v_table uuid := gen_random_uuid();
  v_wed date;
  v_before int;
  v_after int;
BEGIN
  v_wed := date_trunc('week', (now() + interval '120 days'))::date + 2; -- Wednesday

  SELECT id INTO v_account FROM public.creator_accounts LIMIT 1;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'soft-delete test: needs at least one public.creator_accounts row to anchor the test brand';
  END IF;

  INSERT INTO public.brands (id, account_id, name, slug)
  VALUES (v_brand, v_account, 'SoftDelete Test Venue',
          'orch1148-softdel-' || substr(v_brand::text, 1, 8))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.venue_reservation_settings (brand_id, reservations_enabled)
  VALUES (v_brand, true)
  ON CONFLICT (brand_id) DO UPDATE SET reservations_enabled = true;

  INSERT INTO public.venue_availability_config (
    brand_id, service_periods, turn_times, buffer_minutes,
    max_reservations_per_slot, slot_granularity_minutes, advance_window_days,
    min_notice_minutes, iana_timezone
  ) VALUES (
    v_brand,
    -- Wednesday 17:00–21:00 service
    jsonb_build_array(jsonb_build_object('name','Dinner','days',jsonb_build_array(3),'start','17:00','end','21:00')),
    '{"p2": 90, "p4": 90}'::jsonb,
    0, 5, 60, 30, 0, 'UTC'
  )
  ON CONFLICT (brand_id) DO UPDATE
    SET service_periods = EXCLUDED.service_periods,
        turn_times = EXCLUDED.turn_times,
        slot_granularity_minutes = EXCLUDED.slot_granularity_minutes,
        advance_window_days = EXCLUDED.advance_window_days,
        iana_timezone = EXCLUDED.iana_timezone;

  -- ONE reservable, party-fitting, LIVE table.
  INSERT INTO public.venue_tables (id, brand_id, name, capacity, min_party, max_party, reservation_policy, is_active)
  VALUES (v_table, v_brand, 'T1', 4, 1, 4, 'reservable', true);

  -- A-DEL-1: with the live table, the engine offers slots.
  SELECT count(*) INTO v_before
  FROM public.pg_venue_available_slots(v_brand, v_wed, 2);
  IF v_before = 0 THEN
    RAISE EXCEPTION 'A-DEL-1 FAIL: expected slots for a live reservable table, got 0';
  END IF;

  -- SOFT DELETE the table (mirror biz_venue_table_soft_delete's UPDATE).
  UPDATE public.venue_tables SET deleted_at = now() WHERE id = v_table;

  -- A-DEL-2: a soft-deleted table produces ZERO slots (the engine excludes it).
  SELECT count(*) INTO v_after
  FROM public.pg_venue_available_slots(v_brand, v_wed, 2);
  IF v_after <> 0 THEN
    RAISE EXCEPTION 'A-DEL-2 FAIL: soft-deleted table still produced % slots (engine deleted_at filter reverted?)', v_after;
  END IF;

  RAISE NOTICE 'orch_1148 soft-delete engine test PASSED (before=% after=0)', v_before;
END;
$test$;

ROLLBACK;
