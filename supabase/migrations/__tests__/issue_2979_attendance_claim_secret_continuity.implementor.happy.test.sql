BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.issue2979_uuid(seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT (substr(md5('issue2979:'||seed),1,8)||'-'||substr(md5('issue2979:'||seed),9,4)||'-4'||substr(md5('issue2979:'||seed),14,3)||'-8'||substr(md5('issue2979:'||seed),18,3)||'-'||substr(md5('issue2979:'||seed),21,12))::uuid
$$;

SET session_replication_role = replica;
INSERT INTO auth.users(id) VALUES
  (pg_temp.issue2979_uuid('creator')),
  (pg_temp.issue2979_uuid('legacy-claimant')),
  (pg_temp.issue2979_uuid('governed-claimant'));
INSERT INTO public.creator_accounts(id,email)
VALUES(pg_temp.issue2979_uuid('creator'),'issue2979-creator@example.test');
INSERT INTO public.brands(id,account_id,name,slug)
VALUES(
  pg_temp.issue2979_uuid('brand'),
  pg_temp.issue2979_uuid('creator'),
  'Issue 2979',
  'issue-2979-continuity'
);
INSERT INTO public.events(
  id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,theme
) VALUES (
  pg_temp.issue2979_uuid('event'),
  pg_temp.issue2979_uuid('brand'),
  pg_temp.issue2979_uuid('creator'),
  'Issue 2979 Event',
  'issue-2979-continuity-event',
  'event','scheduled','public','UTC','{}'::jsonb
);
INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,quantity_total)
VALUES(
  pg_temp.issue2979_uuid('tier'),
  pg_temp.issue2979_uuid('event'),
  'General',1000,'USD',10
);
INSERT INTO public.orders(
  id,event_id,buyer_email,buyer_name,total_cents,currency,payment_status,source,
  attendance_claim_token_digest,attendance_claim_token_generation,
  attendance_claim_token_created_at,attendance_claim_legacy_token_digest,
  attendance_claim_legacy_token_created_at
) VALUES
  (
    pg_temp.issue2979_uuid('deploy-window-order'),
    pg_temp.issue2979_uuid('event'),
    'deploy-window@example.test','Deploy Window',1000,'USD','paid','legacy',
    decode(repeat('aa',32),'hex'),'legacy_v1',now(),
    decode(repeat('aa',32),'hex'),now()
  ),
  (
    pg_temp.issue2979_uuid('missing-reader-order'),
    pg_temp.issue2979_uuid('event'),
    'missing-reader@example.test','Missing Reader',1000,'USD','paid','legacy',
    decode(repeat('bb',32),'hex'),'governed_v2',now(),
    decode(repeat('cc',32),'hex'),now()
  );
INSERT INTO public.tickets(
  id,order_id,ticket_type_id,event_id,qr_code,status,approval_status
) VALUES
  (
    pg_temp.issue2979_uuid('deploy-window-ticket'),
    pg_temp.issue2979_uuid('deploy-window-order'),
    pg_temp.issue2979_uuid('tier'),pg_temp.issue2979_uuid('event'),
    'issue-2979-deploy-window','valid','auto'
  ),
  (
    pg_temp.issue2979_uuid('missing-reader-ticket'),
    pg_temp.issue2979_uuid('missing-reader-order'),
    pg_temp.issue2979_uuid('tier'),pg_temp.issue2979_uuid('event'),
    'issue-2979-missing-reader','valid','auto'
  );
SET session_replication_role = origin;

DO $test$
DECLARE
  v_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'orders'
       AND column_name = 'attendance_claim_legacy_token_digest'
  ) THEN RAISE EXCEPTION 'missing legacy digest column'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'attendance_claim_recovery_items'
  ) THEN RAISE EXCEPTION 'missing recovery ledger'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'attendance_claim_deliveries'
       AND column_name = 'provider_attempt_started_at'
  ) THEN RAISE EXCEPTION 'missing durable provider boundary'; END IF;
  SELECT pg_get_functiondef('public.claim_attendance_internal_v2(uuid,text,uuid,uuid,bytea,bytea)'::regprocedure)
    INTO v_definition;
  IF position('FOR UPDATE' IN v_definition) = 0
     OR position('attendance_claim_legacy_token_digest = NULL' IN v_definition) = 0
     OR position('attendance_claim_token_generation = NULL' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'dual proof claim is not atomic';
  END IF;
  SELECT pg_get_functiondef('public.finalize_issue_2979_attendance_claim_recovery()'::regprocedure)
    INTO v_definition;
  IF position('72 hours' IN v_definition) = 0
     OR position('issue_2979_delivery_work_remaining' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'finalizer lacks grace/reconciliation gates';
  END IF;
  SELECT pg_get_functiondef('public.claim_issue_2979_attendance_claim_recovery_batch(integer,integer)'::regprocedure)
    INTO v_definition;
  IF position('provider_attempt_started_at IS NOT NULL' IN v_definition) = 0
     OR position('lease_expired_before_provider' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'ambiguous acceptance is not provider-bound';
  END IF;
  SELECT pg_get_functiondef('public.complete_issue_2979_attendance_claim_delivery(uuid,uuid,uuid,text,text)'::regprocedure)
    INTO v_definition;
  IF position('provider_boundary_missing' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'completion accepts unmarked provider outcomes';
  END IF;
END;
$test$;

DO $deploy_window$
DECLARE
  v_result jsonb;
BEGIN
  -- Migration-first window: the still-deployed old Edge function has one
  -- legacy-derived digest and calls the old five-argument wrapper.
  v_result := public.claim_attendance_internal(
    pg_temp.issue2979_uuid('legacy-claimant'),
    'order',
    pg_temp.issue2979_uuid('event'),
    pg_temp.issue2979_uuid('deploy-window-order'),
    decode(repeat('aa',32),'hex')
  );
  IF v_result->>'result' <> 'claimed' THEN
    RAISE EXCEPTION 'migration-first old wrapper rejected valid legacy proof: %',
      v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = pg_temp.issue2979_uuid('deploy-window-order')
       AND buyer_user_id = pg_temp.issue2979_uuid('legacy-claimant')
       AND attendance_claim_token_digest IS NULL
       AND attendance_claim_legacy_token_digest IS NULL
  ) THEN
    RAISE EXCEPTION 'old wrapper claim did not atomically consume both slots';
  END IF;

  -- The new six-argument contract still refuses a row carrying legacy proof
  -- material when the caller cannot supply a legacy-derived candidate.
  v_result := public.claim_attendance_internal_v2(
    pg_temp.issue2979_uuid('governed-claimant'),
    'order',
    pg_temp.issue2979_uuid('event'),
    pg_temp.issue2979_uuid('missing-reader-order'),
    decode(repeat('bb',32),'hex'),
    NULL
  );
  IF v_result->>'result' <> 'secret_unavailable' OR EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = pg_temp.issue2979_uuid('missing-reader-order')
       AND buyer_user_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'missing legacy reader did not fail closed: %', v_result;
  END IF;
END;
$deploy_window$;

-- A14: one-time legacy and governed proofs must not become idempotent after
-- ownership commits. Exact and alternate well-formed replays are both invalid.
SET session_replication_role = replica;
INSERT INTO auth.users(id) VALUES
  (pg_temp.issue2979_uuid('a14-legacy-claimant')),
  (pg_temp.issue2979_uuid('a14-governed-claimant'));
INSERT INTO public.profiles(
  id,display_name,username,visibility_mode,location,created_at
) VALUES
  (
    pg_temp.issue2979_uuid('a14-legacy-claimant'),
    'Legacy Claimant','issue2979legacy','public','Atlanta, GA',now()
  ),
  (
    pg_temp.issue2979_uuid('a14-governed-claimant'),
    'Governed Claimant','issue2979governed','public','Atlanta, GA',now()
  );
INSERT INTO public.orders(
  id,event_id,buyer_email,buyer_name,total_cents,currency,payment_status,source,
  attendance_claim_token_digest,attendance_claim_token_generation,
  attendance_claim_token_created_at,attendance_claim_legacy_token_digest,
  attendance_claim_legacy_token_created_at
) VALUES
  (
    pg_temp.issue2979_uuid('a14-legacy-order'),
    pg_temp.issue2979_uuid('event'),
    'a14-legacy@example.test','A14 Legacy',1000,'USD','paid','legacy',
    decode(repeat('a4',32),'hex'),'legacy_v1',now(),
    decode(repeat('a4',32),'hex'),now()
  ),
  (
    pg_temp.issue2979_uuid('a14-governed-order'),
    pg_temp.issue2979_uuid('event'),
    'a14-governed@example.test','A14 Governed',1000,'USD','paid','legacy',
    decode(repeat('b4',32),'hex'),'governed_v2',now(),
    decode(repeat('c4',32),'hex'),now()
  );
INSERT INTO public.tickets(
  id,order_id,ticket_type_id,event_id,qr_code,status,approval_status
) VALUES
  (
    pg_temp.issue2979_uuid('a14-legacy-ticket'),
    pg_temp.issue2979_uuid('a14-legacy-order'),
    pg_temp.issue2979_uuid('tier'),pg_temp.issue2979_uuid('event'),
    'issue-2979-a14-legacy','valid','auto'
  ),
  (
    pg_temp.issue2979_uuid('a14-governed-ticket'),
    pg_temp.issue2979_uuid('a14-governed-order'),
    pg_temp.issue2979_uuid('tier'),pg_temp.issue2979_uuid('event'),
    'issue-2979-a14-governed','valid','auto'
  );
SET session_replication_role = origin;

DO $a14_single_use$
DECLARE
  v_result jsonb;
  v_roster jsonb;
BEGIN
  v_result := public.claim_attendance_internal_v2(
    pg_temp.issue2979_uuid('a14-legacy-claimant'),
    'order',pg_temp.issue2979_uuid('event'),
    pg_temp.issue2979_uuid('a14-legacy-order'),
    decode(repeat('a4',32),'hex'),decode(repeat('a4',32),'hex')
  );
  IF v_result->>'result' <> 'claimed' THEN
    RAISE EXCEPTION 'A14 legacy first claim failed: %', v_result;
  END IF;
  v_result := public.claim_attendance_internal_v2(
    pg_temp.issue2979_uuid('a14-legacy-claimant'),
    'order',pg_temp.issue2979_uuid('event'),
    pg_temp.issue2979_uuid('a14-legacy-order'),
    decode(repeat('a4',32),'hex'),decode(repeat('a4',32),'hex')
  );
  IF v_result->>'result' <> 'invalid' THEN
    RAISE EXCEPTION 'A14 exact legacy replay succeeded: %', v_result;
  END IF;
  v_result := public.claim_attendance_internal_v2(
    pg_temp.issue2979_uuid('a14-legacy-claimant'),
    'order',pg_temp.issue2979_uuid('event'),
    pg_temp.issue2979_uuid('a14-legacy-order'),
    decode(repeat('d4',32),'hex'),decode(repeat('d4',32),'hex')
  );
  IF v_result->>'result' <> 'invalid' THEN
    RAISE EXCEPTION 'A14 alternate legacy replay succeeded: %', v_result;
  END IF;

  v_result := public.claim_attendance_internal_v2(
    pg_temp.issue2979_uuid('a14-governed-claimant'),
    'order',pg_temp.issue2979_uuid('event'),
    pg_temp.issue2979_uuid('a14-governed-order'),
    decode(repeat('b4',32),'hex'),decode(repeat('c4',32),'hex')
  );
  IF v_result->>'result' <> 'claimed' THEN
    RAISE EXCEPTION 'A14 governed first claim failed: %', v_result;
  END IF;
  v_result := public.claim_attendance_internal_v2(
    pg_temp.issue2979_uuid('a14-governed-claimant'),
    'order',pg_temp.issue2979_uuid('event'),
    pg_temp.issue2979_uuid('a14-governed-order'),
    decode(repeat('b4',32),'hex'),decode(repeat('c4',32),'hex')
  );
  IF v_result->>'result' <> 'invalid' THEN
    RAISE EXCEPTION 'A14 exact governed replay succeeded: %', v_result;
  END IF;
  v_result := public.claim_attendance_internal_v2(
    pg_temp.issue2979_uuid('a14-governed-claimant'),
    'order',pg_temp.issue2979_uuid('event'),
    pg_temp.issue2979_uuid('a14-governed-order'),
    decode(repeat('d5',32),'hex'),decode(repeat('e5',32),'hex')
  );
  IF v_result->>'result' <> 'invalid' THEN
    RAISE EXCEPTION 'A14 alternate governed replay succeeded: %', v_result;
  END IF;

  IF (SELECT count(*) FROM public.orders
       WHERE event_id = pg_temp.issue2979_uuid('event')
         AND buyer_user_id = pg_temp.issue2979_uuid('a14-legacy-claimant')) <> 1
     OR (SELECT count(*) FROM public.orders
       WHERE event_id = pg_temp.issue2979_uuid('event')
         AND buyer_user_id = pg_temp.issue2979_uuid('a14-governed-claimant')) <> 1
     OR EXISTS (
       SELECT 1 FROM public.orders
        WHERE id IN (
          pg_temp.issue2979_uuid('a14-legacy-order'),
          pg_temp.issue2979_uuid('a14-governed-order')
        ) AND (
          attendance_claim_token_digest IS NOT NULL
          OR attendance_claim_token_generation IS NOT NULL
          OR attendance_claim_legacy_token_digest IS NOT NULL
          OR attendance_claim_legacy_token_created_at IS NOT NULL
          OR attendance_claim_token_consumed_at IS NULL
        )
     ) THEN
    RAISE EXCEPTION 'A14 replay changed owner or proof-consumption truth';
  END IF;

  PERFORM set_config(
    'request.jwt.claim.sub',
    pg_temp.issue2979_uuid('a14-legacy-claimant')::text,
    true
  );
  v_roster := public.peer_list_event_guests(
    pg_temp.issue2979_uuid('event'),100,0
  )::jsonb;
  IF (SELECT count(*) FROM jsonb_array_elements(v_roster->'guests') guest
       WHERE guest->>'profileId' =
         pg_temp.issue2979_uuid('a14-legacy-claimant')::text) <> 1
     OR (SELECT count(*) FROM jsonb_array_elements(v_roster->'guests') guest
       WHERE guest->>'profileId' =
         pg_temp.issue2979_uuid('a14-governed-claimant')::text) <> 1 THEN
    RAISE EXCEPTION 'A14 replay duplicated or removed a Business roster owner: %',
      v_roster;
  END IF;
END;
$a14_single_use$;

ROLLBACK;
