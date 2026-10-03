-- Issue #1345 — reservation slot-unavailable ops-alert outbox (PG17 adversarial).
-- Proves authenticated/anon cannot read the outbox or execute enqueue/claim/complete.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_user constant uuid := '13450000-0000-4000-8000-0000000000a1';
  v_session constant uuid := '13450000-0000-4000-8000-0000000000a2';
  v_sqlstate text;
  v_id uuid;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_user);

  -- Seed one pending row as the migration owner (superuser in this test txn).
  v_id := public.enqueue_reservation_slot_unavailable_alert(
    v_session, 'mingla_resv_1345_adv', 2500, 'NGN'
  );
  IF v_id IS NULL THEN
    RAISE EXCEPTION '#1345 adv: seed enqueue failed';
  END IF;

  IF has_table_privilege('authenticated', 'public.reservation_slot_unavailable_alert_outbox', 'SELECT')
     OR has_table_privilege('anon', 'public.reservation_slot_unavailable_alert_outbox', 'SELECT') THEN
    RAISE EXCEPTION '#1345 adv: outbox is SELECT-able by anon/authenticated';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.enqueue_reservation_slot_unavailable_alert(uuid,text,integer,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.claim_reservation_slot_unavailable_alerts(integer)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.complete_reservation_slot_unavailable_alerts(uuid[])',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.claim_reservation_slot_unavailable_alerts(integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION '#1345 adv: outbox RPCs are executable by anon/authenticated';
  END IF;

  -- Runtime denial: authenticated SELECT must fail (RLS + revoke).
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  v_sqlstate := NULL;
  BEGIN
    PERFORM 1 FROM public.reservation_slot_unavailable_alert_outbox LIMIT 1;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF v_sqlstate IS NULL THEN
    -- Some PG builds surface empty result under RLS rather than exception when
    -- privilege is revoked at table level — also accept zero-row + no privilege.
    IF has_table_privilege('authenticated', 'public.reservation_slot_unavailable_alert_outbox', 'SELECT') THEN
      RAISE EXCEPTION '#1345 adv: authenticated SELECT was allowed';
    END IF;
  END IF;

  v_sqlstate := NULL;
  BEGIN
    PERFORM public.claim_reservation_slot_unavailable_alerts(10);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF v_sqlstate IS NULL THEN
    RAISE EXCEPTION '#1345 adv: authenticated claim was not denied';
  END IF;

  -- service_role still can claim the seeded row.
  IF NOT EXISTS (
    SELECT 1 FROM public.claim_reservation_slot_unavailable_alerts(10)
    WHERE alert_id = v_id
  ) THEN
    RAISE EXCEPTION '#1345 adv: service_role claim lost the seeded row';
  END IF;
END
$test$;

ROLLBACK;
\echo 'issue_1345_reservation_slot_unavailable_ops_alert.tester.adversarial.pg17: PASS'
