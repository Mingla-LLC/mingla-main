BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.issue2979_tester_uuid(seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT (substr(md5('issue2979-tester:'||seed),1,8)||'-'||substr(md5('issue2979-tester:'||seed),9,4)||'-4'||substr(md5('issue2979-tester:'||seed),14,3)||'-8'||substr(md5('issue2979-tester:'||seed),18,3)||'-'||substr(md5('issue2979-tester:'||seed),21,12))::uuid
$$;

CREATE TEMP TABLE issue2979_tester_failures(message text NOT NULL);

SET session_replication_role = replica;
INSERT INTO auth.users(id) VALUES
  (pg_temp.issue2979_tester_uuid('creator')),
  (pg_temp.issue2979_tester_uuid('claimant-a')),
  (pg_temp.issue2979_tester_uuid('claimant-b'));
INSERT INTO public.creator_accounts(id,email)
VALUES(pg_temp.issue2979_tester_uuid('creator'),'issue2979-tester-creator@example.test');
INSERT INTO public.brands(id,account_id,name,slug)
VALUES(
  pg_temp.issue2979_tester_uuid('brand'),
  pg_temp.issue2979_tester_uuid('creator'),
  'Issue 2979 Tester',
  'issue-2979-tester'
);
INSERT INTO public.events(
  id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,theme
) VALUES (
  pg_temp.issue2979_tester_uuid('event'),
  pg_temp.issue2979_tester_uuid('brand'),
  pg_temp.issue2979_tester_uuid('creator'),
  'Issue 2979 Tester Event',
  'issue-2979-tester-event',
  'event','scheduled','public','UTC','{}'::jsonb
);
INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,quantity_total)
VALUES(
  pg_temp.issue2979_tester_uuid('tier'),
  pg_temp.issue2979_tester_uuid('event'),
  'General',1000,'USD',20
);
SET session_replication_role = origin;

-- Scenario A: a successful proof claim must cancel/reconcile queued recovery
-- work so an all-claimed population can finalize without waiting 72 hours.
INSERT INTO public.orders(
  id,event_id,buyer_email,buyer_phone_e164,buyer_name,total_cents,currency,
  payment_status,source,attendance_claim_token_digest,
  attendance_claim_token_generation,attendance_claim_token_created_at,
  attendance_claim_legacy_token_digest,attendance_claim_legacy_token_created_at
) VALUES (
  pg_temp.issue2979_tester_uuid('queued-order'),
  pg_temp.issue2979_tester_uuid('event'),
  'queued@example.test','+15555550101','Queued Claim',1000,'USD','paid','legacy',
  decode(repeat('a1',32),'hex'),'governed_v2',now(),
  decode(repeat('b1',32),'hex'),now()
);
INSERT INTO public.tickets(id,order_id,ticket_type_id,event_id,qr_code,status,approval_status)
VALUES(
  pg_temp.issue2979_tester_uuid('queued-ticket'),
  pg_temp.issue2979_tester_uuid('queued-order'),
  pg_temp.issue2979_tester_uuid('tier'),
  pg_temp.issue2979_tester_uuid('event'),
  'issue-2979-tester-queued','valid','auto'
);
WITH delivery AS (
  INSERT INTO public.attendance_claim_deliveries(
    kind,source_id,event_id,status,next_attempt_at
  ) VALUES (
    'order_recovery_email',
    pg_temp.issue2979_tester_uuid('queued-order'),
    pg_temp.issue2979_tester_uuid('event'),'pending',now()
  ) RETURNING id
)
INSERT INTO public.attendance_claim_recovery_items(
  order_id,selected_token_created_at,state,primary_delivery_id
)
SELECT pg_temp.issue2979_tester_uuid('queued-order'),now(),
       'replacement_issued',id FROM delivery;

DO $queued_claim$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.claim_attendance_internal_v2(
    pg_temp.issue2979_tester_uuid('claimant-a'),'order',
    pg_temp.issue2979_tester_uuid('event'),
    pg_temp.issue2979_tester_uuid('queued-order'),
    decode(repeat('a1',32),'hex'),decode(repeat('b1',32),'hex')
  );
  IF v_result->>'result' <> 'claimed' THEN
    INSERT INTO issue2979_tester_failures VALUES
      ('valid governed proof did not claim: '||v_result::text);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.attendance_claim_deliveries
     WHERE source_id = pg_temp.issue2979_tester_uuid('queued-order')
       AND kind IN ('order_recovery_email','order_recovery_sms')
       AND status IN ('pending','processing','failed_retryable')
  ) THEN
    INSERT INTO issue2979_tester_failures VALUES
      ('successful claim left active recovery delivery work');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.attendance_claim_recovery_items
     WHERE order_id = pg_temp.issue2979_tester_uuid('queued-order')
       AND state = 'claimed' AND resolved_via = 'governed_token'
  ) THEN
    INSERT INTO issue2979_tester_failures VALUES
      ('successful claim did not preserve terminal claimed audit state');
  END IF;
  BEGIN
    PERFORM public.finalize_issue_2979_attendance_claim_recovery();
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO issue2979_tester_failures VALUES
      ('all-claimed recovery could not finalize: '||SQLERRM);
  END;
END;
$queued_claim$;

DELETE FROM public.attendance_claim_deliveries
 WHERE source_id = pg_temp.issue2979_tester_uuid('queued-order');
DELETE FROM public.orders WHERE id = pg_temp.issue2979_tester_uuid('queued-order');

-- Scenario B: provider completion with an old in-flight lease must not
-- resurrect a claim that won the race.
INSERT INTO public.orders(
  id,event_id,buyer_email,buyer_phone_e164,buyer_name,total_cents,currency,
  payment_status,source,attendance_claim_token_digest,
  attendance_claim_token_generation,attendance_claim_token_created_at,
  attendance_claim_legacy_token_digest,attendance_claim_legacy_token_created_at
) VALUES (
  pg_temp.issue2979_tester_uuid('race-order'),
  pg_temp.issue2979_tester_uuid('event'),
  'race@example.test','+15555550102','Race Claim',1000,'USD','paid','legacy',
  decode(repeat('a2',32),'hex'),'governed_v2',now(),
  decode(repeat('b2',32),'hex'),now()
);
INSERT INTO public.tickets(id,order_id,ticket_type_id,event_id,qr_code,status,approval_status)
VALUES(
  pg_temp.issue2979_tester_uuid('race-ticket'),
  pg_temp.issue2979_tester_uuid('race-order'),
  pg_temp.issue2979_tester_uuid('tier'),
  pg_temp.issue2979_tester_uuid('event'),
  'issue-2979-tester-race','valid','auto'
);
WITH delivery AS (
  INSERT INTO public.attendance_claim_deliveries(
    id,kind,source_id,event_id,status,attempt_count,next_attempt_at,lease_id,
    lease_expires_at,provider_attempt_started_at
  ) VALUES (
    pg_temp.issue2979_tester_uuid('race-delivery'),'order_recovery_email',
    pg_temp.issue2979_tester_uuid('race-order'),
    pg_temp.issue2979_tester_uuid('event'),'processing',1,NULL,
    pg_temp.issue2979_tester_uuid('race-lease'),now()+interval '2 minutes',now()
  ) RETURNING id
)
INSERT INTO public.attendance_claim_recovery_items(
  order_id,selected_token_created_at,state,primary_delivery_id
)
SELECT pg_temp.issue2979_tester_uuid('race-order'),now(),
       'replacement_issued',id FROM delivery;

DO $provider_race$
DECLARE
  v_claim jsonb;
  v_completion jsonb;
BEGIN
  v_claim := public.claim_attendance_internal_v2(
    pg_temp.issue2979_tester_uuid('claimant-b'),'order',
    pg_temp.issue2979_tester_uuid('event'),
    pg_temp.issue2979_tester_uuid('race-order'),
    decode(repeat('a2',32),'hex'),decode(repeat('b2',32),'hex')
  );
  v_completion := public.complete_issue_2979_attendance_claim_delivery(
    pg_temp.issue2979_tester_uuid('race-order'),
    pg_temp.issue2979_tester_uuid('race-delivery'),
    pg_temp.issue2979_tester_uuid('race-lease'),'accepted',NULL
  );
  IF v_claim->>'result' <> 'claimed' THEN
    INSERT INTO issue2979_tester_failures VALUES
      ('provider race claim did not win: '||v_claim::text);
  END IF;
  IF v_completion->>'result' IN
      ('delivery_safe','attention_required','retryable','secondary_required') THEN
    INSERT INTO issue2979_tester_failures VALUES
      ('late provider completion resurrected a claimed item: '||v_completion::text);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.attendance_claim_recovery_items
     WHERE order_id = pg_temp.issue2979_tester_uuid('race-order')
       AND state = 'claimed' AND resolved_via = 'governed_token'
  ) THEN
    INSERT INTO issue2979_tester_failures VALUES
      ('late provider completion overwrote terminal claimed state');
  END IF;
  BEGIN
    PERFORM public.finalize_issue_2979_attendance_claim_recovery();
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO issue2979_tester_failures VALUES
      ('claimed provider-race population could not finalize: '||SQLERRM);
  END;
END;
$provider_race$;

DELETE FROM public.attendance_claim_deliveries
 WHERE source_id = pg_temp.issue2979_tester_uuid('race-order');
DELETE FROM public.orders WHERE id = pg_temp.issue2979_tester_uuid('race-order');

-- Scenario C: the global grace uses the latest delivery-safe transition,
-- refuses one second early, then retires only legacy material after 72 hours.
INSERT INTO public.orders(
  id,event_id,buyer_email,buyer_name,total_cents,currency,payment_status,source,
  attendance_claim_token_digest,attendance_claim_token_generation,
  attendance_claim_token_created_at,attendance_claim_legacy_token_digest,
  attendance_claim_legacy_token_created_at
) VALUES (
  pg_temp.issue2979_tester_uuid('grace-order'),
  pg_temp.issue2979_tester_uuid('event'),'grace@example.test','Grace',1000,
  'USD','paid','legacy',decode(repeat('a3',32),'hex'),'governed_v2',now(),
  decode(repeat('b3',32),'hex'),now()
);
INSERT INTO public.tickets(id,order_id,ticket_type_id,event_id,qr_code,status,approval_status)
VALUES(
  pg_temp.issue2979_tester_uuid('grace-ticket'),
  pg_temp.issue2979_tester_uuid('grace-order'),
  pg_temp.issue2979_tester_uuid('tier'),
  pg_temp.issue2979_tester_uuid('event'),
  'issue-2979-tester-grace','valid','auto'
);
WITH delivery AS (
  INSERT INTO public.attendance_claim_deliveries(
    kind,source_id,event_id,status,next_attempt_at,delivered_at
  ) VALUES (
    'order_recovery_email',pg_temp.issue2979_tester_uuid('grace-order'),
    pg_temp.issue2979_tester_uuid('event'),'sent',NULL,now()
  ) RETURNING id
)
INSERT INTO public.attendance_claim_recovery_items(
  order_id,selected_token_created_at,state,primary_delivery_id,delivery_safe_at
)
SELECT pg_temp.issue2979_tester_uuid('grace-order'),now(),
       'delivery_safe',id,now()-interval '71 hours 59 minutes 59 seconds'
  FROM delivery;

DO $grace$
DECLARE
  v_early_refused boolean := false;
BEGIN
  BEGIN
    PERFORM public.finalize_issue_2979_attendance_claim_recovery();
  EXCEPTION WHEN OTHERS THEN
    v_early_refused := SQLERRM LIKE '%issue_2979_grace_period_active%';
  END;
  IF NOT v_early_refused THEN
    INSERT INTO issue2979_tester_failures VALUES
      ('finalization did not refuse the 71:59:59 grace boundary');
  END IF;

  UPDATE public.attendance_claim_recovery_items
     SET delivery_safe_at = now()-interval '72 hours 1 second'
   WHERE order_id = pg_temp.issue2979_tester_uuid('grace-order');
  BEGIN
    PERFORM public.finalize_issue_2979_attendance_claim_recovery();
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO issue2979_tester_failures VALUES
      ('finalization refused after the full grace: '||SQLERRM);
  END;
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = pg_temp.issue2979_tester_uuid('grace-order')
       AND attendance_claim_token_generation = 'governed_v2'
       AND attendance_claim_token_digest = decode(repeat('a3',32),'hex')
       AND attendance_claim_legacy_token_digest IS NULL
  ) THEN
    INSERT INTO issue2979_tester_failures VALUES
      ('finalization did not preserve the governed replacement exactly');
  END IF;
END;
$grace$;

-- Scenario D: the PII-free operator preview must report every allowed state so
-- its per-state totals reconcile exactly to total.
INSERT INTO public.orders(
  id,event_id,buyer_email,buyer_name,total_cents,currency,payment_status,source,
  attendance_claim_legacy_token_digest,attendance_claim_legacy_token_created_at
) VALUES (
  pg_temp.issue2979_tester_uuid('preview-order'),
  pg_temp.issue2979_tester_uuid('event'),'preview@example.test','Preview',1000,
  'USD','paid','legacy',decode(repeat('b4',32),'hex'),now()
);
INSERT INTO public.attendance_claim_recovery_items(
  order_id,selected_token_created_at,state,resolved_via,reconciled_at
) VALUES (
  pg_temp.issue2979_tester_uuid('preview-order'),now(),'no_longer_eligible',
  'lifecycle_ineligible',now()
);

DO $preview_reconciliation$
DECLARE
  v_preview jsonb := public.preview_issue_2979_attendance_claim_recovery();
  v_sum integer;
BEGIN
  IF NOT (v_preview ? 'noLongerEligible') THEN
    INSERT INTO issue2979_tester_failures VALUES
      ('operator preview omits the allowed no_longer_eligible state');
  END IF;
  v_sum := coalesce((v_preview->>'selected')::integer,0)
    + coalesce((v_preview->>'replacementIssued')::integer,0)
    + coalesce((v_preview->>'deliverySafe')::integer,0)
    + coalesce((v_preview->>'claimed')::integer,0)
    + coalesce((v_preview->>'attentionRequired')::integer,0)
    + coalesce((v_preview->>'noLongerEligible')::integer,0)
    + coalesce((v_preview->>'legacyRetired')::integer,0);
  IF v_sum <> (v_preview->>'total')::integer THEN
    INSERT INTO issue2979_tester_failures VALUES
      ('operator preview state totals do not reconcile to total: '||v_preview::text);
  END IF;
END;
$preview_reconciliation$;

DO $verdict$
DECLARE
  v_failures text;
BEGIN
  SELECT string_agg(message, E'\n- ' ORDER BY message) INTO v_failures
    FROM issue2979_tester_failures;
  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION E'issue #2979 tester adversarial failures:\n- %', v_failures;
  END IF;
END;
$verdict$;

ROLLBACK;
