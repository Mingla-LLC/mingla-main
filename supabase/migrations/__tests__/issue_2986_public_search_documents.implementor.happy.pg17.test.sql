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

-- H4b: source review is a compare-and-set contract across all five kinds.
-- A stale or future review token can never be laundered into search_ready.
-- Conservative public_noindex demotion remains available during source churn,
-- stores the newly derived source version, and cannot enter the sitemap. The
-- exact newly reviewed token then restores search_ready for every family.
CREATE TEMP TABLE i2986_review_tokens AS
SELECT i.kind,i.id,i.path,d.validation_checks,
       (public.public_search_source_facts(i.path,i.kind)->'facts'->>'sourceUpdatedAt')::timestamptz AS reviewed_t1,
       NULL::timestamptz AS current_t2
FROM i2986_ids i
JOIN public.public_search_documents d ON d.canonical_path=i.path;

DO $h4b_source_change$
BEGIN
  -- Model five independently committed source edits without relying on this
  -- rollback-only transaction's transaction_timestamp()-based touch triggers.
  EXECUTE 'ALTER TABLE public.events DISABLE TRIGGER trg_events_updated_at';
  UPDATE public.events SET updated_at=clock_timestamp()
  WHERE id IN (
    '29860000-0000-4000-8000-000000000101',
    '29860000-0000-4000-8000-000000000102');
  EXECUTE 'ALTER TABLE public.events ENABLE TRIGGER trg_events_updated_at';

  UPDATE public.experience_stops SET updated_at=clock_timestamp()
  WHERE id='29860000-0000-4000-8000-000000000204';

  EXECUTE 'ALTER TABLE public.place_pool DISABLE TRIGGER update_place_pool_updated_at';
  UPDATE public.place_pool SET updated_at=clock_timestamp()
  WHERE id='29860000-0000-4000-8000-000000000301';
  EXECUTE 'ALTER TABLE public.place_pool ENABLE TRIGGER update_place_pool_updated_at';

  -- Event 101 also advances the owning brand's derived inventory timestamp;
  -- the other updates advance trip, experience and venue independently.
  UPDATE i2986_review_tokens t
  SET current_t2=(
    public.public_search_source_facts(t.path,t.kind)->'facts'->>'sourceUpdatedAt'
  )::timestamptz;

  IF EXISTS (SELECT 1 FROM i2986_review_tokens WHERE current_t2<=reviewed_t1) THEN
    RAISE EXCEPTION 'ISSUE-2986 H4b FAIL: source edit did not advance every family review token';
  END IF;
END
$h4b_source_change$;

DO $h4b$
DECLARE
  r record;
  v jsonb;
  v_stale_rejected int := 0;
  v_future_rejected int := 0;
  v_count int;
BEGIN
  FOR r IN SELECT * FROM i2986_review_tokens ORDER BY kind LOOP
    -- A conservative demotion must not be held hostage by a missing review.
    SET LOCAL ROLE service_role;
    PERFORM set_config('request.jwt.claim.role','service_role',true);
    v:=public.upsert_public_search_document(
      r.kind,r.id,r.path,'public_noindex',NULL,r.validation_checks,NULL,
      now(),now()+interval '30 day','missing review safe demotion proof','issue_2986_pg_happy',false);
    RESET ROLE;
    IF v->>'lifecycle_state'<>'public_noindex'
       OR (v->>'source_updated_at')::timestamptz IS DISTINCT FROM r.current_t2 THEN
      RAISE EXCEPTION 'ISSUE-2986 H4b FAIL: % missing-token demotion did not persist current source truth: %',r.kind,v;
    END IF;

    -- Restore with the exact token, then prove stale-token demotion is equally
    -- available and remains a visibility-reducing operation.
    SET LOCAL ROLE service_role;
    PERFORM set_config('request.jwt.claim.role','service_role',true);
    PERFORM public.upsert_public_search_document(
      r.kind,r.id,r.path,'search_ready',NULL,r.validation_checks,r.current_t2,
      now(),now()+interval '30 day','exact review intermediate restore','issue_2986_pg_happy',false);
    v:=public.upsert_public_search_document(
      r.kind,r.id,r.path,'public_noindex',NULL,r.validation_checks,r.reviewed_t1,
      now(),now()+interval '30 day','stale review safe demotion proof','issue_2986_pg_happy',false);
    RESET ROLE;
    IF v->>'lifecycle_state'<>'public_noindex'
       OR (v->>'source_updated_at')::timestamptz IS DISTINCT FROM r.current_t2 THEN
      RAISE EXCEPTION 'ISSUE-2986 H4b FAIL: % stale-token demotion did not persist current source truth: %',r.kind,v;
    END IF;

    SET LOCAL ROLE service_role;
    PERFORM set_config('request.jwt.claim.role','service_role',true);
    BEGIN
      PERFORM public.upsert_public_search_document(
        r.kind,r.id,r.path,'search_ready',NULL,r.validation_checks,r.reviewed_t1,
        now(),now()+interval '30 day','stale review promotion rejection','issue_2986_pg_happy',false);
    EXCEPTION WHEN SQLSTATE '22023' THEN
      v_stale_rejected:=v_stale_rejected+1;
    END;
    BEGIN
      PERFORM public.upsert_public_search_document(
        r.kind,r.id,r.path,'search_ready',NULL,r.validation_checks,r.current_t2+interval '1 day',
        now(),now()+interval '30 day','future review promotion rejection','issue_2986_pg_happy',false);
    EXCEPTION WHEN SQLSTATE '22023' THEN
      v_future_rejected:=v_future_rejected+1;
    END;
    RESET ROLE;

    SET LOCAL ROLE anon;
    PERFORM set_config('request.jwt.claim.role','anon',true);
    v:=public.resolve_public_search_document(r.path);
    RESET ROLE;
    IF v->>'state'<>'public_noindex' THEN
      RAISE EXCEPTION 'ISSUE-2986 H4b FAIL: rejected % promotions changed conservative state: %',r.kind,v;
    END IF;
  END LOOP;

  IF v_stale_rejected<>5 OR v_future_rejected<>5 THEN
    RAISE EXCEPTION 'ISSUE-2986 H4b FAIL: rejected stale %, future %, expected 5 each',
      v_stale_rejected,v_future_rejected;
  END IF;
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  SELECT count(*) INTO v_count FROM public.list_public_search_sitemap();
  RESET ROLE;
  IF v_count<>0 THEN
    RAISE EXCEPTION 'ISSUE-2986 H4b FAIL: noindex demotions left % sitemap rows',v_count;
  END IF;

  FOR r IN SELECT * FROM i2986_review_tokens ORDER BY kind LOOP
    SET LOCAL ROLE service_role;
    PERFORM set_config('request.jwt.claim.role','service_role',true);
    v:=public.upsert_public_search_document(
      r.kind,r.id,r.path,'search_ready',NULL,r.validation_checks,r.current_t2,
      now(),now()+interval '30 day','exact review promotion proof','issue_2986_pg_happy',false);
    RESET ROLE;
    IF v->>'lifecycle_state'<>'search_ready'
       OR (v->>'source_updated_at')::timestamptz IS DISTINCT FROM r.current_t2 THEN
      RAISE EXCEPTION 'ISSUE-2986 H4b FAIL: exact current token did not promote %: %',r.kind,v;
    END IF;
  END LOOP;

  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  SELECT count(*) INTO v_count FROM public.list_public_search_sitemap();
  RESET ROLE;
  IF v_count<>5 THEN
    RAISE EXCEPTION 'ISSUE-2986 H4b FAIL: exact current review restored % sitemap rows, expected 5',v_count;
  END IF;
END
$h4b$;

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

-- H6: elapsed master occurrences are not current inventory. All three
-- scheduled offering families reject a fresh search promotion, resolve stale,
-- expose no live action, and leave the sitemap even if their status row still
-- says scheduled.
DO $h6$
DECLARE
  r record;
  v jsonb;
  v_checks jsonb;
  v_source_updated_at timestamptz;
  v_rejected int := 0;
  v_count int;
BEGIN
  UPDATE public.event_dates
  SET start_at=clock_timestamp()-interval '10 day',
      end_at=clock_timestamp()-interval '9 day'
  WHERE event_id IN (
    '29860000-0000-4000-8000-000000000101',
    '29860000-0000-4000-8000-000000000102',
    '29860000-0000-4000-8000-000000000103')
    AND is_master;

  FOR r IN SELECT * FROM i2986_ids WHERE kind IN ('event','trip','experience') ORDER BY kind LOOP
    v_checks := jsonb_build_object(
      'facts_verified',true,'canonical_verified',true,'visible_html_verified',true,
      'metadata_verified',true,'schema_verified',true,'image_rights_verified',true,'action_verified',true);
    IF r.kind='event' THEN
      v_checks := v_checks||'{"schedule_verified":true,"location_verified":true,"organizer_verified":true,"price_or_free_verified":true,"privacy_moderation_verified":true}'::jsonb;
    ELSIF r.kind='trip' THEN
      v_checks := v_checks||'{"schedule_verified":true,"location_verified":true,"itinerary_verified":true,"destination_verified":true,"operator_verified":true,"fulfillment_verified":true,"price_or_inquiry_verified":true,"availability_verified":true}'::jsonb;
    ELSE
      v_checks := v_checks||'{"schedule_verified":true,"location_verified":true,"operator_verified":true,"duration_verified":true,"inclusions_verified":true,"fulfillment_verified":true,"price_or_inquiry_verified":true,"availability_verified":true}'::jsonb;
    END IF;
    v_source_updated_at := (
      public.public_search_source_facts(r.path,r.kind)->'facts'->>'sourceUpdatedAt'
    )::timestamptz;
    SET LOCAL ROLE service_role;
    PERFORM set_config('request.jwt.claim.role','service_role',true);
    BEGIN
      PERFORM public.upsert_public_search_document(
        r.kind,r.id,r.path,'search_ready',NULL,v_checks,v_source_updated_at,
        now(),now()+interval '30 day','elapsed offering rejection proof','issue_2986_pg_happy',false);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%public_search_readiness_incomplete%' THEN
        v_rejected := v_rejected+1;
      ELSE
        RAISE;
      END IF;
    END;
    RESET ROLE;
  END LOOP;
  IF v_rejected<>3 THEN
    RAISE EXCEPTION 'ISSUE-2986 H6 FAIL: only % of 3 elapsed offering promotions were rejected',v_rejected;
  END IF;

  FOR r IN SELECT * FROM i2986_ids WHERE kind IN ('event','trip','experience') ORDER BY kind LOOP
    SET LOCAL ROLE anon;
    PERFORM set_config('request.jwt.claim.role','anon',true);
    v:=public.resolve_public_search_document(r.path);
    RESET ROLE;
    IF v->>'state'<>'stale' OR (v->'facts'->>'actionAvailable')::boolean IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'ISSUE-2986 H6 FAIL: elapsed % retained search/action truth: %',r.kind,v;
    END IF;
  END LOOP;
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  SELECT count(*) INTO v_count FROM public.list_public_search_sitemap();
  RESET ROLE;
  IF v_count<>0 THEN
    RAISE EXCEPTION 'ISSUE-2986 H6 FAIL: sitemap retained % rows after every promoted offering elapsed',v_count;
  END IF;
END
$h6$;

-- H7: private source eligibility wins over every factless lifecycle overlay.
-- Archive, redirect and gone labels must not expose an unverified physical
-- brand's title, description or media.
DO $h7$
DECLARE v jsonb; v_state text;
BEGIN
  INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
  VALUES ('29860000-0000-4000-8000-000000000601','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','private-i2986-happy@example.test','x',now(),now());
  INSERT INTO public.creator_accounts(id) VALUES ('29860000-0000-4000-8000-000000000601');
  INSERT INTO public.brands(
    id,account_id,name,slug,kind,claim_status,description,cover_media_url,cover_media_type,
    default_currency,pricing_currency)
  VALUES (
    '29860000-0000-4000-8000-000000000610','29860000-0000-4000-8000-000000000601',
    'Issue 2986 Private Brand','i2986private','physical','none',
    'Private brand facts used to prove that lifecycle overlays cannot bypass source eligibility.',
    'https://images.example.test/i2986-private.jpg','image','USD','usd');

  FOREACH v_state IN ARRAY ARRAY['expired_archived','redirected','gone'] LOOP
    SET LOCAL ROLE service_role;
    PERFORM set_config('request.jwt.claim.role','service_role',true);
    PERFORM public.upsert_public_search_document(
      'brand','29860000-0000-4000-8000-000000000610','/b/i2986private',v_state,
      CASE WHEN v_state='redirected' THEN '/b/i2986brand' ELSE NULL END,
      '{}',now(),now(),now()+interval '30 day','private overlay precedence proof','issue_2986_pg_happy',false);
    RESET ROLE;

    SET LOCAL ROLE anon;
    PERFORM set_config('request.jwt.claim.role','anon',true);
    v:=public.resolve_public_search_document('/b/i2986private');
    RESET ROLE;
    IF v->>'state' IS DISTINCT FROM 'draft' OR v->'facts' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'ISSUE-2986 H7 FAIL: % overlay exposed private facts: %',v_state,v;
    END IF;
  END LOOP;

  -- Even a source-visible Host cannot borrow an offering-only archive state.
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM public.upsert_public_search_document(
    'brand','29860000-0000-4000-8000-000000000010','/b/i2986brand','expired_archived',NULL,
    '{}',now(),now(),now()+interval '30 day','invalid brand archive proof','issue_2986_pg_happy',false);
  RESET ROLE;
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  v:=public.resolve_public_search_document('/b/i2986brand');
  RESET ROLE;
  IF v->>'state' IS DISTINCT FROM 'draft' OR v->'facts' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'ISSUE-2986 H7 FAIL: offering-only archive state exposed visible brand facts: %',v;
  END IF;
END
$h7$;

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
