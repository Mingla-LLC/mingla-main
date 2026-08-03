\set ON_ERROR_STOP on
BEGIN;

DO $lock_order$
DECLARE
  v_function text;
  p_brand integer;
  p_offering integer;
  p_room integer;
  p_place integer;
  p_unit integer;
  p_slice integer;
  p_commitment integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.issue_1388_create_stay_group(uuid,text,jsonb,bigint,uuid)'
      ::regprocedure
  ) INTO v_function;
  p_brand := strpos(v_function, 'FROM public.brands');
  p_offering := strpos(v_function, 'FROM public.stay_offerings offering');
  p_room := strpos(v_function, 'FROM public.stay_room_nights night');
  p_place := strpos(v_function, 'FROM public.stay_place_windows window_row');
  p_unit := strpos(v_function, 'FROM public.stay_units unit_row');
  p_slice := strpos(
    v_function,
    'FROM public.stay_inventory_hold_slices slice_row'
  );
  p_commitment := strpos(
    v_function,
    'FROM public.stay_inventory_commitments commitment'
  );
  IF NOT (
    p_brand > 0
    AND p_brand < p_offering
    AND p_offering < p_room
    AND p_room < p_place
    AND p_place < p_unit
    AND p_unit < p_slice
    AND p_slice < p_commitment
  )
     OR v_function NOT LIKE '%ORDER BY offering.id%FOR UPDATE OF offering%'
     OR v_function NOT LIKE
       '%ORDER BY night.offering_id, night.local_date%FOR UPDATE OF night%'
     OR v_function NOT LIKE
       '%ORDER BY window_row.offering_id, window_row.starts_at, window_row.id%'
     OR v_function NOT LIKE
       '%ORDER BY unit_row.offering_id, unit_row.id%FOR UPDATE OF unit_row%'
  THEN
    RAISE EXCEPTION 'A-1 FAIL: deterministic mixed-resource lock order changed';
  END IF;
  RAISE NOTICE 'A-1 PASS: lock order is server-fixed, never cart order';
END;
$lock_order$;

DO $mode_and_precharge$
DECLARE
  v_quote text;
  v_request text;
BEGIN
  SELECT pg_get_functiondef(
    'public.issue_1388_quote_stay_cart(uuid,jsonb,text,uuid)'::regprocedure
  ) INTO v_quote;
  SELECT pg_get_functiondef(
    'public.issue_1388_manage_request(text,uuid,bigint,text,uuid)'
      ::regprocedure
  ) INTO v_request;
  IF v_quote NOT LIKE '%v_mode := ''request''%'
     OR v_quote LIKE '%p_mode%'
     OR v_quote NOT LIKE '%stay_room_dates_must_match%'
     OR v_request LIKE '%payment_attempt%'
     OR v_request LIKE '%provider_%'
     OR v_request NOT LIKE '%approved_payment_required%'
     OR v_request NOT LIKE '%payment_deadline = v_payment_deadline%'
  THEN
    RAISE EXCEPTION 'A-2 FAIL: client mode or pre-approval payment seam';
  END IF;
  RAISE NOTICE 'A-2 PASS: mode is derived and Request approval creates no charge';
END;
$mode_and_precharge$;

DO $inventory_math$
DECLARE
  v_quote text;
  v_create text;
BEGIN
  SELECT pg_get_functiondef(
    'public.issue_1388_quote_stay_cart(uuid,jsonb,text,uuid)'::regprocedure
  ) INTO v_quote;
  SELECT pg_get_functiondef(
    'public.issue_1388_create_stay_group(uuid,text,jsonb,bigint,uuid)'
      ::regprocedure
  ) INTO v_create;
  IF v_quote NOT LIKE
       '%h.state = ''active'' AND h.expires_at > now()%'
     OR v_quote NOT LIKE '%h.state = ''reconciliation_required''%'
     OR v_quote NOT LIKE '%v_night.sellable_quantity - v_held - v_committed%'
     OR v_quote NOT LIKE
       '%v_window.sellable_capacity - v_held - v_committed%'
     OR v_create NOT LIKE '%buffer_before_minutes%'
     OR v_create NOT LIKE '%buffer_after_minutes%'
     OR v_create NOT LIKE '%exclusive_unit_id = u.id%'
     OR v_create NOT LIKE '%stay_dependent_place_requires_room%'
  THEN
    RAISE EXCEPTION 'A-3 FAIL: availability/capacity/buffer dependency weakened';
  END IF;
  RAISE NOTICE 'A-3 PASS: all inventory bases subtract live holds/commitments';
END;
$inventory_math$;

DO $snapshot_and_money$
DECLARE
  v_column record;
BEGIN
  FOR v_column IN
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'stay_quotes',
        'stay_quote_lines',
        'stay_reservation_groups',
        'stay_reservation_lines'
      )
      AND column_name IN (
        'source_subtotal_minor',
        'fee_total_minor',
        'tax_total_minor',
        'total_minor',
        'base_minor',
        'fee_minor',
        'tax_minor'
      )
  LOOP
    IF v_column.data_type <> 'bigint' THEN
      RAISE EXCEPTION 'A-4 FAIL: %.% is % not bigint',
        v_column.table_name, v_column.column_name, v_column.data_type;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'stay_quote_lines_history_guard'
      AND tgenabled <> 'D'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'stay_reservation_events_history_guard'
      AND tgenabled <> 'D'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'stay_groups_state_guard'
      AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'A-4 FAIL: immutable snapshot/state guards missing';
  END IF;
  RAISE NOTICE 'A-4 PASS: money is bigint and frozen truth is guarded';
END;
$snapshot_and_money$;

DO $security$
DECLARE
  v_table text;
  v_group_projection text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'stay_quotes',
    'stay_quote_lines',
    'stay_quote_fee_lines',
    'stay_quote_allocations',
    'stay_reservation_groups',
    'stay_reservation_lines',
    'stay_inventory_holds',
    'stay_inventory_hold_slices',
    'stay_inventory_commitments',
    'stay_reservation_events'
  ]
  LOOP
    IF has_table_privilege('anon', 'public.' || v_table, 'SELECT')
       OR has_table_privilege('anon', 'public.' || v_table, 'INSERT')
       OR has_table_privilege(
         'authenticated', 'public.' || v_table, 'SELECT'
       ) THEN
      RAISE EXCEPTION 'A-5 FAIL: direct client privilege on %', v_table;
    END IF;
  END LOOP;
  IF has_function_privilege(
    'anon',
    'public.biz_manage_stay_reservation(text,jsonb,bigint,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.issue_1388_expire_groups(integer,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'A-5 FAIL: public mutation/sweep privilege';
  END IF;
  SELECT pg_get_functiondef(
    'public.issue_1388_group_projection(uuid)'::regprocedure
  ) INTO v_group_projection;
  IF v_group_projection LIKE '%''actorKeyHash''%'
     OR v_group_projection LIKE '%''idempotencyKey''%'
     OR v_group_projection LIKE '%''requestHash''%' THEN
    RAISE EXCEPTION 'A-5 FAIL: private ownership/idempotency material projected';
  END IF;
  RAISE NOTICE 'A-5 PASS: reservation data is RPC-only and secrets stay private';
END;
$security$;

DO $canonical_namespace$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (
        c.relname LIKE 'hotel\_%' ESCAPE '\'
        OR c.relname LIKE 'resort\_%' ESCAPE '\'
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        p.proname LIKE 'hotel\_%' ESCAPE '\'
        OR p.proname LIKE 'resort\_%' ESCAPE '\'
      )
  ) THEN
    RAISE EXCEPTION 'A-6 FAIL: descriptive kind became a product namespace';
  END IF;
  RAISE NOTICE 'A-6 PASS: only the canonical Stay namespace exists';
END;
$canonical_namespace$;

ROLLBACK;
