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
  v_venue uuid := '00000000-1773-4000-8000-000000000004';
  v_other_venue uuid := '00000000-1773-4000-8000-000000000005';
  v_id uuid := '00000000-1773-4000-8000-000000000010';
  v_other uuid := '00000000-1773-4000-8000-000000000011';
  v_strict uuid := '00000000-1773-4000-8000-000000000018';
  v_unsupported uuid := '00000000-1773-4000-8000-000000000014';
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
  INSERT INTO public.venue_listings(
    id,brand_id,slug,name,lat,lng,venue_category,claim_status
  ) VALUES
    (v_venue,v_brand,'venue1773','Issue 1773 Venue',35.78,-78.64,'restaurant','verified'),
    (v_other_venue,v_other_brand,'other1773','Issue 1773 Other Venue',35.79,-78.63,'restaurant','verified');

  INSERT INTO public.channel_suppressions(id,contact,channel,scope,reason,brand_id)
  VALUES('00000000-1773-4000-8000-000000000090','guest1773@example.test','email','marketing','unsubscribe',v_brand);

  INSERT INTO public.reservations(
    id,brand_id,venue_id,reserved_for,party_size,status,source,created_via,
    guest_name,guest_phone_e164,guest_phone_country_iso,guest_email
  ) VALUES(v_id,v_brand,v_venue,now()+interval '1 day',2,'requested','mingla','consumer',
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
  INSERT INTO public.reservations(
    id,brand_id,venue_id,reserved_for,party_size,status,source,created_via,
    guest_name,guest_phone_e164,guest_phone_country_iso,guest_email
  ) VALUES(v_strict,v_brand,v_venue,now()+interval '1 day',2,'confirmed','phone','operator',
    'Strict Phone','+19194199222',NULL,'strict1773@example.test');
  IF (public.biz_resolve_brand_person_source_derived('reservation',v_strict,'+19999999999')->>'linkOutcome')<>'unlinked' THEN
    RAISE EXCEPTION 'T-1773-03 strict phone spoof was accepted';
  END IF;
  INSERT INTO public.reservations(
    id,brand_id,venue_id,reserved_for,party_size,status,source,created_via,
    guest_name,guest_phone_e164,guest_phone_country_iso,guest_email
  ) VALUES(v_unsupported,v_brand,v_venue,now()+interval '1 day',2,'confirmed','phone','operator',
    'Unsupported ISO','(919) 419-9222','ZZ','unsupported1773@example.test');
  IF (public.biz_resolve_brand_person_source_derived('reservation',v_unsupported,'+19194199222')->>'linkOutcome')<>'unlinked' THEN
    RAISE EXCEPTION 'T-1773-03 unsupported ISO phone spoof was accepted';
  END IF;

  INSERT INTO public.reservations(id,brand_id,venue_id,reserved_for,party_size,status,source,created_via,guest_name,guest_email)
  VALUES(v_other,v_other_brand,v_other_venue,now()+interval '1 day',2,'confirmed','phone','operator','Other Brand Guest','new1773@example.test');
  v_result:=public.biz_resolve_brand_person_source_derived('reservation',v_other,NULL);
  IF v_result->>'linkOutcome'<>'linked' OR (SELECT brand_id FROM public.brand_people WHERE id=(v_result->>'personId')::uuid)<>v_other_brand THEN
    RAISE EXCEPTION 'T-1773-04 cross-brand isolation failed';
  END IF;

  FOREACH v_status IN ARRAY ARRAY['requested','confirmed','seated','completed','no_show','cancelled_by_guest','cancelled_by_venue','waitlisted'] LOOP
    v_status_id:=gen_random_uuid();
    INSERT INTO public.reservations(id,brand_id,venue_id,reserved_for,party_size,status,source,created_via,guest_name,guest_email)
    VALUES(v_status_id,v_brand,v_venue,now()+interval '2 days',1,v_status,'phone','operator','Status Guest',v_status||'@example.test');
    IF NOT EXISTS(SELECT 1 FROM public.brand_person_ingest_outbox WHERE source_kind='reservation' AND source_id=v_status_id) THEN
      RAISE EXCEPTION 'T-1773-05 status % was not eligible',v_status;
    END IF;
  END LOOP;
END;
$reservation$;

DO $legacy_paths$
DECLARE v_kind text; v_result jsonb;
BEGIN
  FOREACH v_kind IN ARRAY ARRAY['event_rsvp','rsvp_plus_one','order','ticket_holder'] LOOP
    v_result:=public.biz_resolve_brand_person_source_derived(v_kind,gen_random_uuid());
    IF v_result->>'linkOutcome'<>'retired' THEN
      RAISE EXCEPTION 'T-1773-05B old source path % regressed: %',v_kind,v_result;
    END IF;
  END LOOP;
END;
$legacy_paths$;

DO $retry_dead$
DECLARE v_job uuid := '00000000-1773-4000-8000-000000000080';
BEGIN
  INSERT INTO public.brand_person_ingest_outbox(
    id,source_kind,source_id,operation,revision_key,status,attempt_count
  ) VALUES(v_job,'reservation','00000000-1773-4000-8000-000000000081','upsert','retry-proof','processing',0);
  PERFORM public.biz_finish_brand_person_ingest(v_job,false,'ingest_resolver_failed');
  IF NOT EXISTS(SELECT 1 FROM public.brand_person_ingest_outbox WHERE id=v_job AND status='retryable' AND attempt_count=1 AND processed_at IS NULL AND last_safe_error_code='ingest_resolver_failed') THEN
    RAISE EXCEPTION 'T-1773-05C first failure did not become retryable';
  END IF;
  UPDATE public.brand_person_ingest_outbox SET status='processing',attempt_count=11,locked_at=now() WHERE id=v_job;
  PERFORM public.biz_finish_brand_person_ingest(v_job,false,'ingest_resolver_failed');
  IF NOT EXISTS(SELECT 1 FROM public.brand_person_ingest_outbox WHERE id=v_job AND status='dead' AND attempt_count=12 AND processed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'T-1773-05C twelfth failure did not become dead';
  END IF;
END;
$retry_dead$;

CREATE OR REPLACE FUNCTION pg_temp.issue_1773_force_suppression_failure()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN RAISE EXCEPTION 'forced_suppression_projection_failure'; END;
$function$;
CREATE TRIGGER issue_1773_force_suppression_failure
BEFORE INSERT ON public.brand_person_channel_suppressions
FOR EACH ROW EXECUTE FUNCTION pg_temp.issue_1773_force_suppression_failure();

DO $suppression_retry$
DECLARE
  v_id uuid := '00000000-1773-4000-8000-000000000015';
  v_result jsonb;
BEGIN
  INSERT INTO public.channel_suppressions(id,contact,channel,scope,reason,brand_id)
  VALUES('00000000-1773-4000-8000-000000000091','retry1773@example.test','email','marketing','unsubscribe','00000000-1773-4000-8000-000000000002');
  INSERT INTO public.reservations(id,brand_id,venue_id,reserved_for,party_size,status,source,created_via,guest_name,guest_email)
  VALUES(v_id,'00000000-1773-4000-8000-000000000002','00000000-1773-4000-8000-000000000004',now()+interval '1 day',1,'confirmed','phone','operator','Retry Guest','retry1773@example.test');
  BEGIN
    v_result:=public.biz_resolve_brand_person_source_derived('reservation',v_id,NULL);
    RAISE EXCEPTION 'T-1773-05D suppression failure did not fail resolver: %',v_result;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%forced_suppression_projection_failure%' THEN RAISE; END IF;
  END;
  IF EXISTS(SELECT 1 FROM public.brand_person_source_links WHERE source_kind='reservation' AND source_id=v_id AND detached_at IS NULL) THEN
    RAISE EXCEPTION 'T-1773-05D failed suppression transaction left a link';
  END IF;
END;
$suppression_retry$;

DROP TRIGGER issue_1773_force_suppression_failure ON public.brand_person_channel_suppressions;
DO $suppression_replay$
DECLARE
  v_id uuid := '00000000-1773-4000-8000-000000000015';
  v_result jsonb; v_person uuid;
BEGIN
  v_result:=public.biz_resolve_brand_person_source_derived('reservation',v_id,NULL);
  v_person:=(v_result->>'personId')::uuid;
  IF v_result->>'linkOutcome'<>'linked'
     OR NOT EXISTS(SELECT 1 FROM public.brand_person_channel_suppressions WHERE brand_person_id=v_person AND channel='email' AND lifted_at IS NULL) THEN
    RAISE EXCEPTION 'T-1773-05D suppression retry/replay failed: %',v_result;
  END IF;
END;
$suppression_replay$;

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
('00000000-1773-4000-8000-000000000013','ST-17730000000000000013','00000000-1773-4000-8000-000000000023',NULL,repeat('e',64),'00000000-1773-4000-8000-000000000033','00000000-1773-4000-8000-000000000002','USD','request','request_expired','{}',100,0,0,100,'stay-1773-empty',repeat('f',64),now(),now()),
('00000000-1773-4000-8000-000000000016','ST-17730000000000000016','00000000-1773-4000-8000-000000000026',NULL,repeat('1',64),'00000000-1773-4000-8000-000000000036','00000000-1773-4000-8000-000000000002','USD','instant','confirmed','{"name":"Lower ISO","email":"lower-iso1773@example.test","phone":"020 7946 0000","phoneCountryIso":"gb"}',100,0,0,100,'stay-1773-lower',repeat('2',64),now(),now()),
('00000000-1773-4000-8000-000000000017','ST-17730000000000000017','00000000-1773-4000-8000-000000000027',NULL,repeat('3',64),'00000000-1773-4000-8000-000000000037','00000000-1773-4000-8000-000000000002','USD','request','request_expired','{"name":"Never Confirmed","email":"never1773@example.test"}',100,0,0,100,'stay-1773-never',repeat('4',64),now(),now());
SET session_replication_role = origin;

DO $stay$
DECLARE
  v_group uuid := '00000000-1773-4000-8000-000000000010';
  v_email_group uuid := '00000000-1773-4000-8000-000000000012';
  v_empty_group uuid := '00000000-1773-4000-8000-000000000013';
  v_lower_group uuid := '00000000-1773-4000-8000-000000000016';
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
    (v_empty_group,'stay_reservation_confirmed','service','issue-1773-empty-confirmed'),
    (v_lower_group,'stay_reservation_confirmed','service','issue-1773-lower-confirmed');
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
  IF public.biz_resolve_brand_person_source_derived('stay_reservation',v_lower_group,'+442079460000')->>'linkOutcome'<>'unlinked' THEN
    RAISE EXCEPTION 'T-1773-08 lowercase ISO phone spoof was accepted';
  END IF;
  INSERT INTO public.stay_reservation_events(group_id,event_type,actor_type,idempotency_key)
  VALUES(v_group,'stay_reservation_cancelled','service','issue-1773-cancelled');
  IF (SELECT count(*) FROM public.brand_person_ingest_outbox WHERE source_kind='stay_reservation' AND source_id=v_group)<>1
     OR NOT EXISTS(SELECT 1 FROM public.brand_person_source_links WHERE source_kind='stay_reservation' AND source_id=v_group AND detached_at IS NULL) THEN
    RAISE EXCEPTION 'T-1773-09 cancellation retired immutable confirmation evidence';
  END IF;
END;
$stay$;

DO $backfill$
DECLARE v_first integer; v_second integer;
BEGIN
  DELETE FROM public.brand_person_ingest_outbox
   WHERE source_kind IN ('reservation','stay_reservation') AND status IN ('pending','processing','retryable');
  INSERT INTO public.brand_person_ingest_outbox(source_kind,source_id,operation,revision_key)
  SELECT 'reservation',r.id,'upsert',md5(jsonb_build_object(
    'sourceKind','reservation','sourceId',r.id,'brandId',r.brand_id,'userId',r.consumer_user_id,
    'name',lower(regexp_replace(btrim(COALESCE(r.guest_name,'')),'[[:space:]]+',' ','g')),
    'email',public.issue_1770_normalize_email(r.guest_email),'rawPhone',NULLIF(btrim(r.guest_phone_e164),''),
    'phoneCountryIso',r.guest_phone_country_iso,'createdAt',r.created_at)::text)
  FROM public.reservations r ON CONFLICT DO NOTHING;
  INSERT INTO public.brand_person_ingest_outbox(source_kind,source_id,operation,revision_key)
  SELECT 'stay_reservation',g.id,'upsert',public.issue_1773_stay_identity_revision(g.id)
  FROM public.stay_reservation_groups g
  WHERE EXISTS(SELECT 1 FROM public.stay_reservation_events e WHERE e.group_id=g.id AND e.event_type='stay_reservation_confirmed')
  ON CONFLICT DO NOTHING;
  SELECT count(*) INTO v_first FROM public.brand_person_ingest_outbox WHERE source_kind IN ('reservation','stay_reservation') AND status='pending';
  IF v_first<>(SELECT count(*) FROM public.reservations)+(SELECT count(DISTINCT group_id) FROM public.stay_reservation_events WHERE event_type='stay_reservation_confirmed')
     OR EXISTS(SELECT 1 FROM public.brand_person_ingest_outbox WHERE source_kind='stay_reservation' AND source_id='00000000-1773-4000-8000-000000000017') THEN
    RAISE EXCEPTION 'T-1773-09B backfill eligibility/count failed: %',v_first;
  END IF;
  -- Exact replay must add no active work.
  INSERT INTO public.brand_person_ingest_outbox(source_kind,source_id,operation,revision_key)
  SELECT 'stay_reservation',g.id,'upsert',public.issue_1773_stay_identity_revision(g.id)
  FROM public.stay_reservation_groups g
  WHERE EXISTS(SELECT 1 FROM public.stay_reservation_events e WHERE e.group_id=g.id AND e.event_type='stay_reservation_confirmed')
  ON CONFLICT DO NOTHING;
  SELECT count(*) INTO v_second FROM public.brand_person_ingest_outbox WHERE source_kind IN ('reservation','stay_reservation') AND status='pending';
  IF v_second<>v_first THEN RAISE EXCEPTION 'T-1773-09B backfill replay duplicated work'; END IF;
END;
$backfill$;

-- A queue failure must never roll back the authoritative reservation write.
ALTER TABLE public.brand_person_ingest_outbox ADD CONSTRAINT issue_1773_forced_enqueue_failure CHECK (false) NOT VALID;
INSERT INTO public.reservations(id,brand_id,venue_id,reserved_for,party_size,status,source,created_via,guest_name,guest_email)
VALUES('00000000-1773-4000-8000-000000000099','00000000-1773-4000-8000-000000000002','00000000-1773-4000-8000-000000000004',now()+interval '3 days',1,'confirmed','phone','operator','Fail Open','fail-open1773@example.test');
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
