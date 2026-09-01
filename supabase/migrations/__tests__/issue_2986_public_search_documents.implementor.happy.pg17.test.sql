-- Issue #2986 implementor happy-path contract (PostgreSQL 17).
-- Executes every entity family through the real anonymous resolver and sitemap.
-- One transaction + rollback: no fixture survives.

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE i2986_ids(kind text PRIMARY KEY, id uuid NOT NULL, path text NOT NULL);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
VALUES ('29860000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','owner-i2986@example.test','x',now(),now());
INSERT INTO public.creator_accounts(id) VALUES ('29860000-0000-4000-8000-000000000001');
INSERT INTO public.brands(
  id,account_id,name,slug,description,cover_media_url,cover_media_type,claim_status,default_currency,pricing_currency)
VALUES (
  '29860000-0000-4000-8000-000000000010','29860000-0000-4000-8000-000000000001',
  'Issue 2986 Host','i2986brand',
  'A real public host description with enough useful detail for explorers to understand this organizer.',
  'https://images.example.test/i2986-brand.jpg','image','verified','USD','usd');

INSERT INTO public.events(
  id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,
  location_text,is_online,city,cover_media_url,cover_media_type,cover_media_alt,destination_text,theme,published_at)
VALUES
  ('29860000-0000-4000-8000-000000000101','29860000-0000-4000-8000-000000000010','29860000-0000-4000-8000-000000000001',
   'Issue 2986 Event','A sourced public event description with enough unique detail to make this page useful to an explorer.',
   'event','event','public','scheduled','America/New_York','Downtown Durham',false,'Durham',
   'https://images.example.test/i2986-event.jpg','image','People enjoying the event',NULL,'{}',now()),
  ('29860000-0000-4000-8000-000000000102','29860000-0000-4000-8000-000000000010','29860000-0000-4000-8000-000000000001',
   'Issue 2986 Trip','A sourced public trip description with enough itinerary context to make this page useful to an explorer.',
   'trip','trip','public','scheduled','Africa/Lagos','Victoria Island',false,'Lagos',
   'https://images.example.test/i2986-trip.jpg','image','Travelers on the trip','Lagos Island','{}',now()),
  ('29860000-0000-4000-8000-000000000103','29860000-0000-4000-8000-000000000010','29860000-0000-4000-8000-000000000001',
   'Issue 2986 Experience','A sourced public experience description with enough schedule context to make this page useful to an explorer.',
   'experience','experience','public','scheduled','Europe/London',NULL,false,'London',
   'https://images.example.test/i2986-experience.jpg','image','Guests at the experience',NULL,'{}',now());

INSERT INTO public.event_dates(id,event_id,start_at,end_at,is_master,timezone)
VALUES
  ('29860000-0000-4000-8000-000000000201','29860000-0000-4000-8000-000000000101',now()+interval '30 day',now()+interval '30 day 3 hour',true,'America/New_York'),
  ('29860000-0000-4000-8000-000000000202','29860000-0000-4000-8000-000000000102',now()+interval '40 day',now()+interval '43 day',true,'Africa/Lagos'),
  ('29860000-0000-4000-8000-000000000203','29860000-0000-4000-8000-000000000103',now()+interval '20 day',now()+interval '20 day 2 hour',true,'Europe/London');

INSERT INTO public.ticket_types(event_id,name,price_cents,currency,quantity_total,is_free,available_online)
VALUES
  ('29860000-0000-4000-8000-000000000101','General admission',2500,'USD',100,false,true),
  ('29860000-0000-4000-8000-000000000102','Trip reservation',5000,'USD',20,false,true),
  ('29860000-0000-4000-8000-000000000103','Experience place',0,'GBP',12,true,true);

INSERT INTO public.experience_stops(
  id,event_id,stop_order,place_name,address,city,country_code,lat,lng,ai_description)
VALUES (
  '29860000-0000-4000-8000-000000000204','29860000-0000-4000-8000-000000000103',0,
  'Issue 2986 Studio','Central London','London','GB',51.5072,-0.1276,
  'A useful public meeting-point description for the verified experience fixture.');

INSERT INTO public.place_pool(id,name,lat,lng,generative_summary)
VALUES ('29860000-0000-4000-8000-000000000301','Issue 2986 Rooftop',35.78,-78.64,
        'A verified rooftop venue with a useful public description of its atmosphere and guest experience.');
INSERT INTO public.venue_listings(
  id,brand_id,place_pool_id,slug,name,city,country_code,lat,lng,venue_category,claim_status,cover_media_url,cover_media_type)
VALUES (
  '29860000-0000-4000-8000-000000000302','29860000-0000-4000-8000-000000000010',
  '29860000-0000-4000-8000-000000000301','rooftop','Issue 2986 Rooftop','Raleigh','US',35.78,-78.64,
  'restaurant','verified','https://images.example.test/i2986-venue.jpg','image');

INSERT INTO i2986_ids VALUES
  ('event','29860000-0000-4000-8000-000000000101','/e/i2986brand/event'),
  ('trip','29860000-0000-4000-8000-000000000102','/t/i2986brand/trip'),
  ('experience','29860000-0000-4000-8000-000000000103','/exp/i2986brand/experience'),
  ('brand','29860000-0000-4000-8000-000000000010','/b/i2986brand'),
  ('venue','29860000-0000-4000-8000-000000000302','/b/i2986brand/v/rooftop');

-- H1: zero overlay rows still produce visible public_noindex documents through
-- the anonymous exact-path resolver, with no direct table grant.
DO $h1$
DECLARE r record; v jsonb;
BEGIN
  IF has_table_privilege('anon','public.public_search_documents','SELECT') THEN
    RAISE EXCEPTION 'ISSUE-2986 H1 FAIL: anon can read the overlay table';
  END IF;
  FOR r IN SELECT * FROM i2986_ids ORDER BY kind LOOP
    SET LOCAL ROLE anon;
    PERFORM set_config('request.jwt.claim.role','anon',true);
    v := public.resolve_public_search_document(r.path);
    RESET ROLE;
    IF v->>'state'<>'public_noindex' OR v->>'kind'<>r.kind OR (v->>'integrityOk')::boolean IS NOT TRUE
       OR v->'facts'->>'id'<>r.id::text OR v->'facts'->>'title' IS NULL THEN
      RAISE EXCEPTION 'ISSUE-2986 H1 FAIL: % did not resolve public_noindex with exact facts: %',r.kind,v;
    END IF;
  END LOOP;
END
$h1$;

-- H2: service promotion is individually evidence-gated; every valid family
-- becomes search_ready and the audit records all five transitions.
DO $h2$
DECLARE r record; v_checks jsonb; v jsonb;
BEGIN
  FOR r IN SELECT * FROM i2986_ids ORDER BY kind LOOP
    v_checks := jsonb_build_object(
      'facts_verified',true,'canonical_verified',true,'visible_html_verified',true,
      'metadata_verified',true,'schema_verified',true,'image_rights_verified',true,'action_verified',true);
    IF r.kind='event' THEN
      v_checks := v_checks||'{"schedule_verified":true,"location_verified":true,"organizer_verified":true,"price_or_free_verified":true,"privacy_moderation_verified":true}'::jsonb;
    ELSIF r.kind='trip' THEN
      v_checks := v_checks||'{"schedule_verified":true,"location_verified":true,"itinerary_verified":true,"destination_verified":true,"operator_verified":true,"fulfillment_verified":true,"price_or_inquiry_verified":true,"availability_verified":true}'::jsonb;
    ELSIF r.kind='experience' THEN
      v_checks := v_checks||'{"schedule_verified":true,"location_verified":true,"operator_verified":true,"duration_verified":true,"inclusions_verified":true,"fulfillment_verified":true,"price_or_inquiry_verified":true,"availability_verified":true}'::jsonb;
    ELSIF r.kind='brand' THEN
      v_checks := v_checks||'{"identity_verified":true,"inventory_verified":true,"ownership_source_verified":true,"action_or_inventory_verified":true}'::jsonb;
    ELSE
      v_checks := v_checks||'{"identity_verified":true,"location_verified":true,"contact_hours_verified_when_shown":true,"offering_context_verified":true,"address_privacy_verified":true}'::jsonb;
    END IF;
    SET LOCAL ROLE service_role;
    PERFORM set_config('request.jwt.claim.role','service_role',true);
    v := public.upsert_public_search_document(
      r.kind,r.id,r.path,'search_ready',NULL,v_checks,now(),now(),now()+interval '30 day',
      'Issue 2986 verified fixture','issue_2986_pg_happy',false);
    RESET ROLE;
    IF v->>'lifecycle_state'<>'search_ready' OR v->>'search_ready_at' IS NULL THEN
      RAISE EXCEPTION 'ISSUE-2986 H2 FAIL: % promotion receipt invalid: %',r.kind,v;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.public_search_document_audit WHERE change_source='issue_2986_pg_happy')<>5 THEN
    RAISE EXCEPTION 'ISSUE-2986 H2 FAIL: five promotions did not produce five audit rows';
  END IF;
END
$h2$;

-- H3/H4: anonymous resolver and separate sitemap now agree on the exact five
-- search-ready paths. This is also the pass-on-restore side of the negative
-- control below.
DO $h3$
DECLARE r record; v jsonb; v_count int;
BEGIN
  FOR r IN SELECT * FROM i2986_ids ORDER BY kind LOOP
    SET LOCAL ROLE anon;
    PERFORM set_config('request.jwt.claim.role','anon',true);
    v := public.resolve_public_search_document(r.path);
    RESET ROLE;
    IF v->>'state'<>'search_ready' OR v->'facts'->>'id'<>r.id::text THEN
      RAISE EXCEPTION 'ISSUE-2986 H3 FAIL: % did not restore search_ready truth: %',r.kind,v;
    END IF;
  END LOOP;
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  SELECT count(*) INTO v_count FROM public.list_public_search_sitemap();
  RESET ROLE;
  IF v_count<>5 THEN RAISE EXCEPTION 'ISSUE-2986 H4 FAIL: sitemap count %, expected 5',v_count; END IF;
  IF EXISTS (
    (SELECT path FROM i2986_ids)
    EXCEPT
    (SELECT canonical_path FROM public.list_public_search_sitemap())) THEN
    RAISE EXCEPTION 'ISSUE-2986 H4 FAIL: sitemap path set differs from promoted set';
  END IF;
END
$h3$;

-- H5: freshness includes derived facts, not only the owning row. Model later
-- committed updates to event inventory (which also changes its brand page), an
-- experience stop, and venue source copy; all four affected documents demote
-- to stale and disappear, leaving only the unchanged trip in the sitemap.
DO $h5$
DECLARE v jsonb; v_count int; p text;
BEGIN
  -- This suite is one rollback-only transaction and the repository timestamp
  -- triggers use transaction_timestamp(). Disable only those fixture clocks so
  -- the rows can model distinct later commits, then restore them immediately.
  EXECUTE 'ALTER TABLE public.events DISABLE TRIGGER trg_events_updated_at';
  UPDATE public.events SET updated_at=clock_timestamp()+interval '2 minute'
  WHERE id='29860000-0000-4000-8000-000000000101';
  EXECUTE 'ALTER TABLE public.events ENABLE TRIGGER trg_events_updated_at';
  UPDATE public.experience_stops SET updated_at=clock_timestamp()+interval '1 minute'
  WHERE id='29860000-0000-4000-8000-000000000204';
  EXECUTE 'ALTER TABLE public.place_pool DISABLE TRIGGER update_place_pool_updated_at';
  UPDATE public.place_pool SET updated_at=clock_timestamp()+interval '3 minute'
  WHERE id='29860000-0000-4000-8000-000000000301';
  EXECUTE 'ALTER TABLE public.place_pool ENABLE TRIGGER update_place_pool_updated_at';

  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  FOREACH p IN ARRAY ARRAY[
    '/e/i2986brand/event','/exp/i2986brand/experience',
    '/b/i2986brand','/b/i2986brand/v/rooftop'
  ] LOOP
    v:=public.resolve_public_search_document(p);
    IF v->>'state'<>'stale' THEN
      RAISE EXCEPTION 'ISSUE-2986 H5 FAIL: derived-source edit did not stale %: %',p,v;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.list_public_search_sitemap();
  RESET ROLE;
  IF v_count<>1 OR NOT EXISTS (
    SELECT 1 FROM public.list_public_search_sitemap()
    WHERE canonical_path='/t/i2986brand/trip') THEN
    RAISE EXCEPTION 'ISSUE-2986 H5 FAIL: sitemap did not retain only unchanged trip (count %)',v_count;
  END IF;
END
$h5$;

-- R1: pre-fix behavior had no approved overlay and could never distinguish a
-- verified page from ordinary public_noindex. It must fail the same readiness
-- assertion that the real resolver passes in H3.
CREATE FUNCTION pg_temp.issue2986_pre_fix_resolver(p_path text) RETURNS jsonb
LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('valid',true,'state','public_noindex','canonicalPath',p_path) $$;
DO $r1$
DECLARE r record; v jsonb; v_failed int := 0;
BEGIN
  FOR r IN SELECT * FROM i2986_ids LOOP
    v:=pg_temp.issue2986_pre_fix_resolver(r.path);
    IF v->>'state'<>'search_ready' THEN v_failed:=v_failed+1; END IF;
  END LOOP;
  IF v_failed<>5 THEN RAISE EXCEPTION 'ISSUE-2986 R1 FAIL: pre-fix negative control did not fail all five families'; END IF;
END
$r1$;

ROLLBACK;
SELECT 'issue_2986_public_search_documents implementor happy: PASS' AS result;
