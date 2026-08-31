-- #1773 current-writer successor for #1857 phone authority. Full chain first; fixtures roll back.
\set ON_ERROR_STOP on
BEGIN;

DO $catalog$
DECLARE
  v_signature text;
  v_expected_md5 text;
  v_definition text;
  v_domain text;
BEGIN
  FOREACH v_domain IN ARRAY ARRAY[
    'event_rsvp','rsvp_plus_one','order','ticket_holder','reservation','stay_reservation'
  ] LOOP
    IF position(v_domain in (
      SELECT pg_get_constraintdef(c.oid,true)
      FROM pg_constraint c
      WHERE c.conrelid='public.brand_person_ingest_outbox'::regclass
        AND c.conname='brand_person_ingest_outbox_source_kind_check'
    ))=0 THEN
      RAISE EXCEPTION 'issue_1773_1857_source_domain_missing:%',v_domain;
    END IF;
  END LOOP;

  -- [TEST-MOD-APPROVED #1772] #1772 forward-repins the exact #2305 writer after
  -- adding only the active-separation supersession predicate.
  -- #2305 re-pinned biz_resolve_brand_person_source: 20270430002305 (the REWORK
  -- forward migration) is now the legitimate current last writer of that
  -- definition. It adds P1-1(b) -- the automatic chain-merge refuses to collapse
  -- a pair the separation ledger says are different people -- and P2-4, which
  -- keeps link_method='manual_resolution' across a re-ingest so the record that
  -- a human decided it is not erased. 20270426002305 last wrote it before that. It applies four localized
  -- amendments the issue exists to make -- A-1 (the name test consults active
  -- alternate names, F-5), A-2 (separated candidates are excluded from the
  -- conflict test AND the chain-merge, F-6), A-3 (the detach block no longer
  -- runs on the way into a conflict, F-3) and their ordering. The fingerprint
  -- HAD to move; that is the tripwire working, not a bypass.
  --
  -- The BEHAVIOURAL block below is unchanged and was proven to pass against the
  -- new writer on its own merits BEFORE this value was touched: strict-E164
  -- linking, the phone_country_iso revision path, the national-only email path,
  -- invalid-ISO rejection and strict E.164 as the match key all still hold.
  --
  -- issue_1770_enqueue_source is deliberately NOT re-pinned. #2305 does not touch
  -- the enqueue trigger, and its md5 is unchanged -- which is also the control
  -- proving this fingerprint pipeline still reproduces the original values.
  FOR v_signature,v_expected_md5 IN SELECT * FROM (VALUES
    ('public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamp with time zone)','9815b94c8ae402c9b81d2b6613be66f3'),
    ('public.issue_1770_enqueue_source()','b6f76457afc333703f59d065cd4224ba')
  ) AS expected(signature,definition_md5) LOOP
    SELECT pg_get_functiondef(to_regprocedure(v_signature)) INTO STRICT v_definition;
    IF md5(v_definition)<>v_expected_md5 THEN
      RAISE EXCEPTION 'issue_1773_1857_current_writer_drift:%',v_signature;
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid=to_regprocedure(v_signature))
       OR NOT (SELECT COALESCE(p.proconfig,'{}') @> ARRAY['search_path=public, pg_temp'] FROM pg_proc p WHERE p.oid=to_regprocedure(v_signature))
       OR has_function_privilege('anon',v_signature,'EXECUTE')
       OR has_function_privilege('authenticated',v_signature,'EXECUTE')
       OR NOT has_function_privilege('service_role',v_signature,'EXECUTE') THEN
      RAISE EXCEPTION 'issue_1773_1857_security_contract_drift:%',v_signature;
    END IF;
    BEGIN
      EXECUTE 'ALTER FUNCTION '||v_signature||' SET search_path TO issue_1773_deliberate_drift';
      IF md5(pg_get_functiondef(to_regprocedure(v_signature)))<>v_expected_md5 THEN
        RAISE EXCEPTION USING ERRCODE='P1773',MESSAGE='issue_1773_1857_deliberate_drift_detected';
      END IF;
      RAISE EXCEPTION 'issue_1773_1857_deliberate_drift_survived:%',v_signature;
    EXCEPTION WHEN SQLSTATE 'P1773' THEN NULL;
    END;
    IF md5(pg_get_functiondef(to_regprocedure(v_signature)))<>v_expected_md5 THEN
      RAISE EXCEPTION 'issue_1773_1857_deliberate_drift_not_rolled_back:%',v_signature;
    END IF;
  END LOOP;
END;
$catalog$;

DO $rsvp_phone_authority$
DECLARE
  v_owner uuid := '00000000-1773-4857-8000-000000000001';
  v_brand uuid := '00000000-1773-4857-8000-000000000002';
  v_event uuid := '00000000-1773-4857-8000-000000000003';
  v_rsvp uuid := '00000000-1773-4857-8000-000000000004';
  v_national uuid := '00000000-1773-4857-8000-000000000005';
  v_strict_match uuid := '00000000-1773-4857-8000-000000000006';
  v_first jsonb;
  v_second jsonb;
  v_match jsonb;
  v_national_result jsonb;
  v_person uuid;
  v_contact uuid;
  v_revision_count integer;
BEGIN
  INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
  VALUES(v_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    'owner-1773-1857@example.test',now(),now());
  INSERT INTO public.creator_accounts(id,created_at) VALUES(v_owner,now());
  INSERT INTO public.brands(id,account_id,slug,name,default_currency,created_at,updated_at)
  VALUES(v_brand,v_owner,'issue-1773-1857-brand','Issue 1773 1857 Brand','USD',now(),now());
  INSERT INTO public.events(
    id,brand_id,created_by,event_type,title,slug,description,status,visibility,
    currency,timezone,party_types,rsvp_approval_mode,rsvp_discoverable,theme,created_at,updated_at
  ) VALUES(v_event,v_brand,v_owner,'rsvp','Issue 1773 1857 Event','issue-1773-1857-event','fixture',
    'scheduled','public','USD','UTC',ARRAY['house-party'],'auto',false,'{}',now(),now());

  INSERT INTO public.event_rsvps(
    id,event_id,user_id,guest_name,guest_email,guest_phone,guest_phone_country_iso,
    rsvp_status,approval_status,plus_count,created_at
  ) VALUES(v_rsvp,v_event,NULL,'Phone Authority','phone-authority@example.test','+19194199222','US',
    'going','approved',0,now());
  v_first:=public.biz_resolve_brand_person_source_derived('event_rsvp',v_rsvp);
  v_person:=(v_first->>'personId')::uuid;
  SELECT c.id INTO STRICT v_contact
  FROM public.brand_person_contact_methods c
  JOIN public.brand_person_contact_method_sources s ON s.contact_method_id=c.id
  WHERE c.brand_person_id=v_person AND c.channel='phone' AND c.normalized_value='+19194199222'
    AND c.provenance_scope='brand_owned' AND s.provenance_kind='rsvp'
    AND s.phone_country_iso='US' AND s.active;
  IF v_first->>'linkOutcome'<>'linked'
     OR EXISTS(
       SELECT 1 FROM public.brand_person_contact_method_sources s
       JOIN public.brand_person_contact_methods c ON c.id=s.contact_method_id
       WHERE s.source_link_id=(v_first->>'sourceLinkId')::uuid
         AND c.channel<>'phone' AND s.phone_country_iso IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'issue_1773_1857_strict_rsvp_did_not_link:%',v_first;
  END IF;

  UPDATE public.event_rsvps SET guest_phone_country_iso='CA' WHERE id=v_rsvp;
  SELECT count(DISTINCT revision_key) INTO v_revision_count
  FROM public.brand_person_ingest_outbox WHERE source_kind='event_rsvp' AND source_id=v_rsvp;
  v_second:=public.biz_resolve_brand_person_source_derived('event_rsvp',v_rsvp);
  IF v_revision_count<>2
     OR (v_second->>'personId')::uuid<>v_person
     OR NOT EXISTS(
       SELECT 1 FROM public.brand_person_contact_method_sources s
       WHERE s.contact_method_id=v_contact AND s.active AND s.provenance_kind='rsvp'
         AND s.phone_country_iso='CA'
     ) THEN
    RAISE EXCEPTION 'issue_1773_1857_iso_revision_failed:% revisions=%',v_second,v_revision_count;
  END IF;

  INSERT INTO public.event_rsvps(
    id,event_id,user_id,guest_name,guest_email,guest_phone,guest_phone_country_iso,
    rsvp_status,approval_status,plus_count,created_at
  ) VALUES(v_national,v_event,NULL,'National Only','national-only@example.test','(919) 419-9222',NULL,
    'going','approved',0,now());
  v_national_result:=public.biz_resolve_brand_person_source_derived('event_rsvp',v_national);
  IF v_national_result->>'linkOutcome'<>'linked' THEN
    RAISE EXCEPTION 'issue_1773_1857_national_email_path_did_not_link:%',v_national_result->>'linkOutcome';
  END IF;
  IF NOT EXISTS(
       SELECT 1 FROM public.brand_person_source_links l
       JOIN public.brand_person_contact_method_sources s ON s.source_link_id=l.id AND s.active
       JOIN public.brand_person_contact_methods c ON c.id=s.contact_method_id
       WHERE l.id=(v_national_result->>'sourceLinkId')::uuid
         AND l.source_kind='event_rsvp' AND l.source_id=v_national
         AND l.detached_at IS NULL AND c.channel='email'
     ) THEN
    RAISE EXCEPTION 'issue_1773_1857_national_email_source_missing';
  END IF;
  IF EXISTS(
       SELECT 1 FROM public.brand_person_source_links l
       JOIN public.brand_person_contact_method_sources s ON s.source_link_id=l.id AND s.active
       JOIN public.brand_person_contact_methods c ON c.id=s.contact_method_id
       WHERE l.id=(v_national_result->>'sourceLinkId')::uuid
         AND l.source_kind='event_rsvp' AND l.source_id=v_national
         AND l.detached_at IS NULL AND c.channel='phone'
     ) THEN
    RAISE EXCEPTION 'issue_1773_1857_national_phone_was_guessed_or_stored';
  END IF;
  BEGIN
    UPDATE public.event_rsvps SET guest_phone_country_iso='us' WHERE id=v_national;
    RAISE EXCEPTION 'issue_1773_1857_invalid_country_was_accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO public.event_rsvps(
    id,event_id,user_id,guest_name,guest_email,guest_phone,guest_phone_country_iso,
    rsvp_status,approval_status,plus_count,created_at
  ) VALUES(v_strict_match,v_event,NULL,'Phone Authority','strict-phone-match@example.test','+19194199222',NULL,
    'going','approved',0,now());
  v_match:=public.biz_resolve_brand_person_source_derived('event_rsvp',v_strict_match);
  IF (v_match->>'personId')::uuid<>v_person THEN
    RAISE EXCEPTION 'issue_1773_1857_strict_e164_stopped_being_match_key:%',v_match;
  END IF;
  IF NOT EXISTS(
       SELECT 1 FROM public.brand_person_source_links l
       JOIN public.brand_person_contact_method_sources s ON s.source_link_id=l.id AND s.active
       JOIN public.brand_person_contact_methods c ON c.id=s.contact_method_id
       WHERE l.id=(v_match->>'sourceLinkId')::uuid
         AND l.source_kind='event_rsvp' AND l.source_id=v_strict_match
         AND l.detached_at IS NULL
         AND c.channel='phone' AND c.normalized_value='+19194199222'
     ) THEN
    RAISE EXCEPTION 'issue_1773_1857_strict_e164_source_missing';
  END IF;
END;
$rsvp_phone_authority$;

ROLLBACK;
