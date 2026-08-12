-- #1773 reservation + historically confirmed Stay ingestion contract.
-- Apply the full migration chain first. Fixtures roll back.
\set ON_ERROR_STOP on
BEGIN;

DO $catalog$
DECLARE v_definition text;
BEGIN
  IF to_regprocedure('public.biz_resolve_brand_person_source_derived(text,uuid,text)') IS NULL
     OR has_function_privilege('anon','public.biz_resolve_brand_person_source_derived(text,uuid,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.biz_resolve_brand_person_source_derived(text,uuid,text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.biz_resolve_brand_person_source_derived(text,uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'T-1773-00 resolver overload/ACL drift';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_definition FROM pg_constraint
   WHERE conrelid='public.brand_person_ingest_outbox'::regclass
     AND conname='brand_person_ingest_outbox_source_kind_check';
  IF v_definition NOT LIKE '%reservation%' OR v_definition NOT LIKE '%stay_reservation%' THEN
    RAISE EXCEPTION 'T-1773-00 outbox domain drift';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.reservations'::regclass AND tgname='issue_1773_reservation_ingest' AND NOT tgisinternal)
     OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.stay_reservation_events'::regclass AND tgname='issue_1773_confirmed_stay_ingest' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'T-1773-00 trigger drift';
  END IF;
END;
$catalog$;

DO $reservation$
DECLARE
  v_owner uuid := '00000000-1773-4000-8000-000000000001';
  v_brand uuid := '00000000-1773-4000-8000-000000000002';
  v_other_brand uuid := '00000000-1773-4000-8000-000000000003';
  v_id uuid := '00000000-1773-4000-8000-000000000010';
  v_other uuid := '00000000-1773-4000-8000-000000000011';
  v_status text;
  v_status_id uuid;
  v_before integer;
  v_result jsonb;
  v_person uuid;
BEGIN
  INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
  VALUES(v_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner1773@example.test',now(),now());
  INSERT INTO public.creator_accounts(id,created_at) VALUES(v_owner,now());
  INSERT INTO public.brands(id,account_id,slug,name,default_currency,created_at,updated_at) VALUES
    (v_brand,v_owner,'issue-1773-brand','Issue 1773 Brand','USD',now(),now()),
    (v_other_brand,v_owner,'issue-1773-other','Issue 1773 Other','USD',now(),now());

  INSERT INTO public.channel_suppressions(id,contact,channel,scope,reason,brand_id)
  VALUES('00000000-1773-4000-8000-000000000090','guest1773@example.test','email','marketing','unsubscribe',v_brand);

  INSERT INTO public.reservations(
    id,brand_id,reserved_for,party_size,status,source,created_via,
    guest_name,guest_phone_e164,guest_phone_country_iso,guest_email
  ) VALUES(v_id,v_brand,now()+interval '1 day',2,'requested','mingla','consumer',
    'Guest 1773','(919) 419-9222','US',' Guest1773@Example.Test ');
  IF (SELECT count(*) FROM public.brand_person_ingest_outbox WHERE source_kind='reservation' AND source_id=v_id)<>1 THEN
    RAISE EXCEPTION 'T-1773-01 reservation insert did not enqueue once';
  END IF;
  v_result:=public.biz_resolve_brand_person_source_derived('reservation',v_id,'+19194199222');
  v_person:=(v_result->>'personId')::uuid;
  IF v_result->>'linkOutcome'<>'linked'
     OR NOT EXISTS(SELECT 1 FROM public.brand_person_source_links WHERE source_kind='reservation' AND source_id=v_id AND detached_at IS NULL)
     OR NOT EXISTS(SELECT 1 FROM public.brand_person_contact_method_sources s JOIN public.brand_person_contact_methods c ON c.id=s.contact_method_id WHERE c.brand_person_id=v_person AND c.normalized_value='+19194199222' AND s.provenance_kind='reservation' AND s.phone_country_iso='US')
     OR NOT EXISTS(SELECT 1 FROM public.brand_person_channel_suppressions WHERE brand_person_id=v_person AND channel='email' AND lifted_at IS NULL) THEN
    RAISE EXCEPTION 'T-1773-01 reservation projection/suppression failed: %',v_result;
  END IF;

  SELECT count(*) INTO v_before FROM public.brand_person_ingest_outbox WHERE source_kind='reservation' AND source_id=v_id;
  UPDATE public.reservations SET status='completed',reserved_for=reserved_for+interval '1 hour',guest_notes='operational only' WHERE id=v_id;
  IF (SELECT count(*) FROM public.brand_person_ingest_outbox WHERE source_kind='reservation' AND source_id=v_id)<>v_before THEN
    RAISE EXCEPTION 'T-1773-02 operational update enqueued';
  END IF;
  UPDATE public.reservations SET guest_email='new1773@example.test' WHERE id=v_id;
  IF (SELECT count(*) FROM public.brand_person_ingest_outbox WHERE source_kind='reservation' AND source_id=v_id)<>v_before+1 THEN
    RAISE EXCEPTION 'T-1773-02 identity update did not enqueue one revision';
  END IF;
  IF (public.biz_resolve_brand_person_source_derived('reservation',v_id,'+19999999999')->>'linkOutcome')<>'unlinked' THEN
    RAISE EXCEPTION 'T-1773-03 strict phone spoof was accepted';
  END IF;

  INSERT INTO public.reservations(id,brand_id,reserved_for,party_size,status,source,created_via,guest_name,guest_email)
  VALUES(v_other,v_other_brand,now()+interval '1 day',2,'confirmed','phone','operator','Other Brand Guest','new1773@example.test');
  v_result:=public.biz_resolve_brand_person_source_derived('reservation',v_other,NULL);
  IF v_result->>'linkOutcome'<>'linked' OR (SELECT brand_id FROM public.brand_people WHERE id=(v_result->>'personId')::uuid)<>v_other_brand THEN
    RAISE EXCEPTION 'T-1773-04 cross-brand isolation failed';
  END IF;

  FOREACH v_status IN ARRAY ARRAY['requested','confirmed','seated','completed','no_show','cancelled_by_guest','cancelled_by_venue','waitlisted'] LOOP
    v_status_id:=gen_random_uuid();
    INSERT INTO public.reservations(id,brand_id,reserved_for,party_size,status,source,created_via,guest_name,guest_email)
    VALUES(v_status_id,v_brand,now()+interval '2 days',1,v_status,'phone','operator','Status Guest',v_status||'@example.test');
    IF NOT EXISTS(SELECT 1 FROM public.brand_person_ingest_outbox WHERE source_kind='reservation' AND source_id=v_status_id) THEN
      RAISE EXCEPTION 'T-1773-05 status % was not eligible',v_status;
    END IF;
  END LOOP;
END;
$reservation$;

-- Build constrained Stay fixtures without manufacturing the entire quote and
-- inventory graph; live trigger behavior resumes before event insertion.
SET session_replication_role = replica;
INSERT INTO public.stay_reservation_groups(
  id,public_reference,quote_id,user_id,actor_key_hash,venue_id,brand_id,currency_code,
  mode,state,guest_snapshot,source_subtotal_minor,fee_total_minor,tax_total_minor,total_minor,
  idempotency_key,request_hash,created_at,updated_at
) VALUES
('00000000-1773-4000-8000-000000000010','ST-17730000000000000010','00000000-1773-4000-8000-000000000020',NULL,repeat('a',64),'00000000-1773-4000-8000-000000000030','00000000-1773-4000-8000-000000000002','USD','instant','confirmed','{"name":"Stay Guest","email":"stay1773@example.test","phone":"020 7946 0000","phoneCountryIso":"GB"}',100,0,0,100,'stay-1773-main',repeat('b',64),now(),now()),
('00000000-1773-4000-8000-000000000012','ST-17730000000000000012','00000000-1773-4000-8000-000000000022',NULL,repeat('c',64),'00000000-1773-4000-8000-000000000032','00000000-1773-4000-8000-000000000002','USD','request','declined','{"name":"Email Only","email":"email-only1773@example.test"}',100,0,0,100,'stay-1773-email',repeat('d',64),now(),now()),
('00000000-1773-4000-8000-000000000013','ST-17730000000000000013','00000000-1773-4000-8000-000000000023',NULL,repeat('e',64),'00000000-1773-4000-8000-000000000033','00000000-1773-4000-8000-000000000002','USD','request','request_expired','{}',100,0,0,100,'stay-1773-empty',repeat('f',64),now(),now());
SET session_replication_role = origin;

DO $stay$
DECLARE
  v_group uuid := '00000000-1773-4000-8000-000000000010';
  v_email_group uuid := '00000000-1773-4000-8000-000000000012';
  v_empty_group uuid := '00000000-1773-4000-8000-000000000013';
  v_result jsonb;
BEGIN
  IF EXISTS(SELECT 1 FROM public.brand_person_ingest_outbox WHERE source_kind='stay_reservation' AND source_id IN (v_group,v_email_group,v_empty_group)) THEN
    RAISE EXCEPTION 'T-1773-06 unconfirmed group enqueued';
  END IF;
  INSERT INTO public.stay_reservation_events(group_id,event_type,actor_type,idempotency_key)
  VALUES(v_group,'stay_request_created','service','issue-1773-request');
  IF EXISTS(SELECT 1 FROM public.brand_person_ingest_outbox WHERE source_kind='stay_reservation' AND source_id=v_group) THEN
    RAISE EXCEPTION 'T-1773-06 non-confirmation event enqueued';
  END IF;
  INSERT INTO public.stay_reservation_events(group_id,event_type,actor_type,idempotency_key) VALUES
    (v_group,'stay_reservation_confirmed','service','issue-1773-confirmed'),
    (v_email_group,'stay_reservation_confirmed','service','issue-1773-email-confirmed'),
    (v_empty_group,'stay_reservation_confirmed','service','issue-1773-empty-confirmed');
  IF (SELECT count(*) FROM public.brand_person_ingest_outbox WHERE source_kind='stay_reservation' AND source_id=v_group)<>1 THEN
    RAISE EXCEPTION 'T-1773-07 confirmation did not enqueue exactly once';
  END IF;
  v_result:=public.biz_resolve_brand_person_source_derived('stay_reservation',v_group,'+442079460000');
  IF v_result->>'linkOutcome'<>'linked'
     OR NOT EXISTS(SELECT 1 FROM public.brand_person_source_links WHERE source_kind='reservation' AND source_id=v_group AND detached_at IS NULL)
     OR NOT EXISTS(SELECT 1 FROM public.brand_person_source_links WHERE source_kind='stay_reservation' AND source_id=v_group AND detached_at IS NULL) THEN
    RAISE EXCEPTION 'T-1773-07 distinct same-UUID source identities failed: %',v_result;
  END IF;
  IF public.biz_resolve_brand_person_source_derived('stay_reservation',v_email_group,NULL)->>'linkOutcome'<>'linked' THEN
    RAISE EXCEPTION 'T-1773-08 missing optional Stay phone keys failed';
  END IF;
  IF public.biz_resolve_brand_person_source_derived('stay_reservation',v_empty_group,NULL)->>'linkOutcome'<>'unlinked' THEN
    RAISE EXCEPTION 'T-1773-08 unusable Stay identity did not return unlinked';
  END IF;
  INSERT INTO public.stay_reservation_events(group_id,event_type,actor_type,idempotency_key)
  VALUES(v_group,'stay_reservation_cancelled','service','issue-1773-cancelled');
  IF (SELECT count(*) FROM public.brand_person_ingest_outbox WHERE source_kind='stay_reservation' AND source_id=v_group)<>1
     OR NOT EXISTS(SELECT 1 FROM public.brand_person_source_links WHERE source_kind='stay_reservation' AND source_id=v_group AND detached_at IS NULL) THEN
    RAISE EXCEPTION 'T-1773-09 cancellation retired immutable confirmation evidence';
  END IF;
END;
$stay$;

-- A queue failure must never roll back the authoritative reservation write.
ALTER TABLE public.brand_person_ingest_outbox ADD CONSTRAINT issue_1773_forced_enqueue_failure CHECK (false) NOT VALID;
INSERT INTO public.reservations(id,brand_id,reserved_for,party_size,status,source,created_via,guest_name,guest_email)
VALUES('00000000-1773-4000-8000-000000000099','00000000-1773-4000-8000-000000000002',now()+interval '3 days',1,'confirmed','phone','operator','Fail Open','fail-open1773@example.test');
ALTER TABLE public.brand_person_ingest_outbox DROP CONSTRAINT issue_1773_forced_enqueue_failure;
DO $failopen$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.reservations WHERE id='00000000-1773-4000-8000-000000000099')
     OR EXISTS(SELECT 1 FROM public.brand_person_ingest_outbox WHERE source_kind='reservation' AND source_id='00000000-1773-4000-8000-000000000099') THEN
    RAISE EXCEPTION 'T-1773-10 source-write fail-open contract failed';
  END IF;
END;
$failopen$;

DELETE FROM public.reservations WHERE id='00000000-1773-4000-8000-000000000010';
DO $retire$
DECLARE v_result jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.brand_person_ingest_outbox WHERE source_kind='reservation' AND source_id='00000000-1773-4000-8000-000000000010' AND operation='retire') THEN
    RAISE EXCEPTION 'T-1773-11 reservation delete did not enqueue retire';
  END IF;
  v_result:=public.biz_resolve_brand_person_source_derived('reservation','00000000-1773-4000-8000-000000000010',NULL);
  IF v_result->>'linkOutcome'<>'retired'
     OR EXISTS(SELECT 1 FROM public.brand_person_source_links WHERE source_kind='reservation' AND source_id='00000000-1773-4000-8000-000000000010' AND detached_at IS NULL)
     OR NOT EXISTS(SELECT 1 FROM public.brand_person_source_links WHERE source_kind='stay_reservation' AND source_id='00000000-1773-4000-8000-000000000010' AND detached_at IS NULL) THEN
    RAISE EXCEPTION 'T-1773-11 scoped retirement failed: %',v_result;
  END IF;
END;
$retire$;

ROLLBACK;
