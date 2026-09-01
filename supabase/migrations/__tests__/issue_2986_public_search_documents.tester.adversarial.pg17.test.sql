-- Issue #2986 independent adversarial contract (PostgreSQL 17).
-- Distinct angle from the happy suite: attacks privacy, mutation authority,
-- malformed paths, redirect chains, forged readiness and enumeration leakage.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
VALUES ('29860000-0000-4000-8000-000000000401','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','owner-i2986adv@example.test','x',now(),now());
INSERT INTO public.creator_accounts(id) VALUES ('29860000-0000-4000-8000-000000000401');
INSERT INTO public.brands(id,account_id,name,slug,description,cover_media_url,cover_media_type,default_currency,pricing_currency)
VALUES ('29860000-0000-4000-8000-000000000410','29860000-0000-4000-8000-000000000401',
        'Issue 2986 Adversary','i2986adv',
        'A real public identity with enough source detail for the adversarial search lifecycle fixture.',
        'https://images.example.test/i2986-adv-brand.jpg','image','USD','usd');

INSERT INTO public.events(
  id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,
  location_text,is_online,city,cover_media_url,cover_media_type,cover_media_alt,theme,published_at)
VALUES
  ('29860000-0000-4000-8000-000000000501','29860000-0000-4000-8000-000000000410','29860000-0000-4000-8000-000000000401',
   'Good public event','A sufficiently detailed and sourced event description used as the only valid search-ready adversarial control.',
   'good','event','public','scheduled','UTC','Public city venue',false,'Durham','https://images.example.test/good.jpg','image','Event cover','{}',now()),
  ('29860000-0000-4000-8000-000000000502','29860000-0000-4000-8000-000000000410','29860000-0000-4000-8000-000000000401',
   'Hidden event','A sufficiently detailed hidden-event description that remains visible only to someone holding this exact link.',
   'hidden','event','hidden','scheduled','UTC','SECRET EXACT STREET ADDRESS',false,'Durham','https://images.example.test/hidden.jpg','image','Hidden event cover',
   '{"business_event":{"hideAddressUntilTicket":true}}',now()),
  ('29860000-0000-4000-8000-000000000503','29860000-0000-4000-8000-000000000410','29860000-0000-4000-8000-000000000401',
   'Private event','Private material that must never be visible even when an attacker guesses the exact canonical path.',
   'private','event','private','scheduled','UTC','Private address',false,'Durham','https://images.example.test/private.jpg','image','Private cover','{}',now()),
  ('29860000-0000-4000-8000-000000000504','29860000-0000-4000-8000-000000000410','29860000-0000-4000-8000-000000000401',
   'Draft event','Draft material that must never be visible even when an attacker guesses the exact canonical path.',
   'draft','event','draft','draft','UTC','Draft address',false,'Durham','https://images.example.test/draft.jpg','image','Draft cover','{}',NULL),
  ('29860000-0000-4000-8000-000000000505','29860000-0000-4000-8000-000000000410','29860000-0000-4000-8000-000000000401',
   'Incomplete','short','incomplete','event','public','scheduled','UTC',NULL,false,NULL,NULL,NULL,NULL,'{}',now()),
  ('29860000-0000-4000-8000-000000000506','29860000-0000-4000-8000-000000000410','29860000-0000-4000-8000-000000000401',
   'Ended event','A retained ended event description that is useful as an archive but must never retain a live booking action.',
   'ended','event','public','ended','UTC','Public city venue',false,'Durham','https://images.example.test/ended.jpg','image','Ended cover','{}',now()),
  ('29860000-0000-4000-8000-000000000507','29860000-0000-4000-8000-000000000410','29860000-0000-4000-8000-000000000401',
   'Forged owner event','A valid-looking source whose overlay will deliberately point at the wrong entity identifier.',
   'forged','event','public','scheduled','UTC','Public city venue',false,'Durham','https://images.example.test/forged.jpg','image','Forged cover','{}',now()),
  ('29860000-0000-4000-8000-000000000508','29860000-0000-4000-8000-000000000410','29860000-0000-4000-8000-000000000401',
   'Stale event','A visible event retained in a conservative stale state while its facts are reviewed again.',
   'stale','event','public','scheduled','UTC','Public city venue',false,'Durham','https://images.example.test/stale.jpg','image','Stale cover','{}',now());

INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone)
SELECT id,now()+interval '15 day',now()+interval '15 day 2 hour',true,'UTC'
FROM public.events WHERE brand_id='29860000-0000-4000-8000-000000000410' AND status<>'draft';

INSERT INTO public.ticket_types(event_id,name,price_cents,currency,quantity_total,is_free,available_online)
SELECT id,'Public admission',1000,'USD',50,false,true
FROM public.events WHERE brand_id='29860000-0000-4000-8000-000000000410' AND status<>'draft';

-- A1: exact-link hidden is visible/noindex, exact address is absent, while
-- private and draft paths collapse to draft with no fact payload.
DO $a1$
DECLARE v jsonb;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  v:=public.resolve_public_search_document('/e/i2986adv/hidden');
  IF v->>'state'<>'public_noindex' OR v->'facts'->>'title'<>'Hidden event'
     OR v->'facts' ? 'location' OR v::text LIKE '%SECRET EXACT STREET ADDRESS%' THEN
    RAISE EXCEPTION 'ISSUE-2986 A1 FAIL: hidden/address contract drifted: %',v;
  END IF;
  FOREACH v IN ARRAY ARRAY[
    public.resolve_public_search_document('/e/i2986adv/private'),
    public.resolve_public_search_document('/e/i2986adv/draft')
  ] LOOP
    IF v->>'state'<>'draft' OR v->'facts' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'ISSUE-2986 A1 FAIL: private/draft leaked: %',v;
    END IF;
  END LOOP;
  v:=public.resolve_public_search_document('/e/i2986adv/never-existed');
  IF v->>'state'<>'draft' OR v->'facts' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'ISSUE-2986 A1 FAIL: never-existent path was not a factless 404 result: %',v;
  END IF;
  RESET ROLE;
END
$a1$;

-- A2: malformed/lookalike/encoded/alternate-host inputs are uniformly invalid
-- and never create an oracle about a real source row.
DO $a2$
DECLARE p text; v jsonb;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  FOREACH p IN ARRAY ARRAY[
    'https://host.usemingla.com/e/i2986adv/good','/e/i2986adv/good?utm=x','/e/i2986adv/good#x',
    '/e/i2986adv/%2fgood','/e/i2986adv/../good','/e//i2986adv/good','/e/i2986adv/Good',
    '/e/i2986аdv/good','/auth/callback','/checkout/abc'
  ] LOOP
    v:=public.resolve_public_search_document(p);
    IF v IS DISTINCT FROM '{"valid": false}'::jsonb THEN
      RAISE EXCEPTION 'ISSUE-2986 A2 FAIL: hostile path % returned %',p,v;
    END IF;
  END LOOP;
  RESET ROLE;
END
$a2$;

-- A3: anon cannot read/mutate either table and an ordinary authenticated owner
-- cannot call the guarded mutation RPC successfully.
DO $a3$
DECLARE v_denied boolean := false;
BEGIN
  IF has_table_privilege('anon','public.public_search_documents','SELECT')
     OR has_table_privilege('authenticated','public.public_search_documents','SELECT')
     OR has_function_privilege('anon','public.upsert_public_search_document(text,uuid,text,text,text,jsonb,timestamptz,timestamptz,timestamptz,text,text,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'ISSUE-2986 A3 FAIL: anonymous/ordinary direct privilege widened';
  END IF;
  SET LOCAL ROLE anon;
  BEGIN PERFORM count(*) FROM public.public_search_documents;
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true; END;
  RESET ROLE;
  IF NOT v_denied THEN RAISE EXCEPTION 'ISSUE-2986 A3 FAIL: anon direct read did not raise'; END IF;

  v_denied:=false;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub','29860000-0000-4000-8000-000000000401',true);
  BEGIN
    PERFORM public.upsert_public_search_document(
      'event','29860000-0000-4000-8000-000000000501','/e/i2986adv/good','public_noindex',NULL,'{}',now(),NULL,NULL,
      'forged ordinary mutation','issue_2986_adv',false);
  EXCEPTION WHEN OTHERS THEN v_denied:=SQLERRM LIKE '%not_authorized%'; END;
  RESET ROLE;
  IF NOT v_denied THEN RAISE EXCEPTION 'ISSUE-2986 A3 FAIL: ordinary authenticated mutation was admitted'; END IF;
END
$a3$;

-- A4: promote one valid control; every forged search-ready shape fails at the
-- table trigger even for service_role (hidden, incomplete checks, test record,
-- and direct-table bypass).
DO $a4$
DECLARE
  v_common jsonb := '{"facts_verified":true,"canonical_verified":true,"visible_html_verified":true,"metadata_verified":true,"schema_verified":true,"image_rights_verified":true,"action_verified":true,"schedule_verified":true,"location_verified":true,"organizer_verified":true,"price_or_free_verified":true,"privacy_moderation_verified":true}';
  v_rejected int := 0;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM public.upsert_public_search_document(
    'event','29860000-0000-4000-8000-000000000501','/e/i2986adv/good','search_ready',NULL,v_common,now(),now(),now()+interval '30 day',
    'valid adversarial control','issue_2986_adv',false);

  BEGIN
    PERFORM public.upsert_public_search_document('event','29860000-0000-4000-8000-000000000502','/e/i2986adv/hidden','search_ready',NULL,v_common,now(),now(),now()+interval '30 day','hidden forgery','issue_2986_adv',false);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%public_search_readiness_incomplete%' THEN v_rejected:=v_rejected+1; END IF; END;
  BEGIN
    PERFORM public.upsert_public_search_document('event','29860000-0000-4000-8000-000000000505','/e/i2986adv/incomplete','search_ready',NULL,v_common,now(),now(),now()+interval '30 day','incomplete forgery','issue_2986_adv',false);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%public_search_readiness_incomplete%' THEN v_rejected:=v_rejected+1; END IF; END;
  BEGIN
    PERFORM public.upsert_public_search_document('event','29860000-0000-4000-8000-000000000507','/e/i2986adv/forged','search_ready',NULL,v_common,now(),now(),now()+interval '30 day','test record forgery','issue_2986_adv',true);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%public_search_readiness_incomplete%' THEN v_rejected:=v_rejected+1; END IF; END;
  BEGIN
    INSERT INTO public.public_search_documents(entity_kind,entity_id,canonical_path,lifecycle_state,validation_checks,verified_at,review_due_at,change_reason,change_source)
    VALUES ('event','29860000-0000-4000-8000-000000000508','/e/i2986adv/stale','search_ready','{}',now(),now()+interval '30 day','direct bypass forgery','issue_2986_adv');
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%public_search_readiness_incomplete%' THEN v_rejected:=v_rejected+1; END IF; END;
  RESET ROLE;
  IF v_rejected<>4 THEN RAISE EXCEPTION 'ISSUE-2986 A4 FAIL: only % of 4 readiness forgeries were rejected',v_rejected; END IF;
END
$a4$;

-- A5: path grammar and one-hop redirect rules are enforced at mutation time.
DO $a5$
DECLARE p text; v_rejected int := 0;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  FOREACH p IN ARRAY ARRAY[
    '/e/i2986adv/good?x=1','/e/i2986adv/good#x','/e/i2986adv/%2fgood','/e/i2986adv/../good',
    '/e//i2986adv/good','https://evil.test/e/i2986adv/good','/e/i2986аdv/good'
  ] LOOP
    BEGIN
      PERFORM public.upsert_public_search_document('event',gen_random_uuid(),p,'public_noindex',NULL,'{}',now(),NULL,NULL,'hostile path','issue_2986_adv',false);
    EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%public_search_invalid_canonical_path%' THEN v_rejected:=v_rejected+1; END IF; END;
  END LOOP;
  IF v_rejected<>7 THEN RAISE EXCEPTION 'ISSUE-2986 A5 FAIL: only % of 7 hostile paths rejected',v_rejected; END IF;

  PERFORM public.upsert_public_search_document('event',gen_random_uuid(),'/e/i2986adv/old','redirected','/e/i2986adv/good','{}',now(),NULL,NULL,'real replacement','issue_2986_adv',false);
  BEGIN
    PERFORM public.upsert_public_search_document('event',gen_random_uuid(),'/e/i2986adv/alias','redirected','/e/i2986adv/old','{}',now(),NULL,NULL,'redirect chain forgery','issue_2986_adv',false);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%public_search_redirect_chain_or_cycle%' THEN v_rejected:=v_rejected+1; END IF; END;
  BEGIN
    PERFORM public.upsert_public_search_document('event',gen_random_uuid(),'/e/i2986adv/cycle','redirected','/e/i2986adv/cycle','{}',now(),NULL,NULL,'self cycle forgery','issue_2986_adv',false);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%public_search_invalid_redirect_target%' THEN v_rejected:=v_rejected+1; END IF; END;
  RESET ROLE;
  IF v_rejected<>9 THEN RAISE EXCEPTION 'ISSUE-2986 A5 FAIL: redirect chain/cycle gate did not add two rejections (%)',v_rejected; END IF;
END
$a5$;

-- A6: explicit archive/stale/gone/test/forged rows remain absent from sitemap;
-- resolver returns archive/gone honestly and fails closed on entity mismatch.
DO $a6$
DECLARE v jsonb; v_count int;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM public.upsert_public_search_document('event','29860000-0000-4000-8000-000000000506','/e/i2986adv/ended','expired_archived',NULL,'{}',now(),now(),now()+interval '30 day','archive ended','issue_2986_adv',false);
  PERFORM public.upsert_public_search_document('event','29860000-0000-4000-8000-000000000508','/e/i2986adv/stale','stale',NULL,'{}',now(),now(),now()+interval '30 day','uncertain source','issue_2986_adv',false);
  PERFORM public.upsert_public_search_document('event',gen_random_uuid(),'/e/i2986adv/removed','gone',NULL,'{}',now(),now(),NULL,'deliberate removal','issue_2986_adv',false);
  PERFORM public.upsert_public_search_document('event',gen_random_uuid(),'/e/i2986adv/test','public_noindex',NULL,'{}',now(),NULL,NULL,'test page','issue_2986_adv',true);
  PERFORM public.upsert_public_search_document('event','29860000-0000-4000-8000-00000000ffff','/e/i2986adv/forged','public_noindex',NULL,'{}',now(),NULL,NULL,'forged owner','issue_2986_adv',false);
  RESET ROLE;

  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  v:=public.resolve_public_search_document('/e/i2986adv/ended');
  IF v->>'state'<>'expired_archived' OR v->'facts'->>'status'<>'ended' THEN RAISE EXCEPTION 'ISSUE-2986 A6 FAIL: archive truth %',v; END IF;
  v:=public.resolve_public_search_document('/e/i2986adv/removed');
  IF v->>'state'<>'gone' OR v ? 'facts' THEN RAISE EXCEPTION 'ISSUE-2986 A6 FAIL: gone truth %',v; END IF;
  v:=public.resolve_public_search_document('/e/i2986adv/forged');
  IF v->>'state'<>'dependency_failure' OR (v->>'integrityOk')::boolean IS NOT FALSE OR v ? 'facts' THEN
    RAISE EXCEPTION 'ISSUE-2986 A6 FAIL: entity mismatch did not fail closed %',v;
  END IF;
  SELECT count(*) INTO v_count FROM public.list_public_search_sitemap();
  RESET ROLE;
  IF v_count<>1 THEN RAISE EXCEPTION 'ISSUE-2986 A6 FAIL: sitemap enumerated % rows, expected only valid control',v_count; END IF;
END
$a6$;

-- A7: non-vacuity — every refusal above left no row, while accepted mutations
-- produced audit receipts. Removing the trigger/guard therefore turns red.
DO $a7$
BEGIN
  IF EXISTS (SELECT 1 FROM public.public_search_documents WHERE canonical_path IN ('/e/i2986adv/hidden','/e/i2986adv/incomplete')) THEN
    RAISE EXCEPTION 'ISSUE-2986 A7 FAIL: rejected readiness row persisted';
  END IF;
  IF (SELECT count(*) FROM public.public_search_document_audit WHERE change_source='issue_2986_adv') < 6 THEN
    RAISE EXCEPTION 'ISSUE-2986 A7 FAIL: accepted mutations were not audited';
  END IF;
END
$a7$;

-- A8: a source edit after verification automatically demotes search truth to
-- stale and removes it from enumeration; a fresh individual review restores it.
DO $a8$
DECLARE
  v jsonb;
  v_count int;
  v_source_updated_at timestamptz;
  v_common jsonb := '{"facts_verified":true,"canonical_verified":true,"visible_html_verified":true,"metadata_verified":true,"schema_verified":true,"image_rights_verified":true,"action_verified":true,"schedule_verified":true,"location_verified":true,"organizer_verified":true,"price_or_free_verified":true,"privacy_moderation_verified":true}';
BEGIN
  -- This suite is intentionally one rollback-only transaction. The repository's
  -- events timestamp trigger assigns transaction_timestamp() on every update,
  -- which would make a post-review edit look simultaneous with A4. Disable only
  -- that fixture clock trigger long enough to model the later committed source
  -- transaction that production receives, then restore it before resolving.
  EXECUTE 'ALTER TABLE public.events DISABLE TRIGGER trg_events_updated_at';
  UPDATE public.events SET updated_at=clock_timestamp()+interval '1 minute'
  WHERE id='29860000-0000-4000-8000-000000000501';
  EXECUTE 'ALTER TABLE public.events ENABLE TRIGGER trg_events_updated_at';
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  v:=public.resolve_public_search_document('/e/i2986adv/good');
  SELECT count(*) INTO v_count FROM public.list_public_search_sitemap();
  RESET ROLE;
  IF v->>'state'<>'stale' OR v_count<>0 THEN
    RAISE EXCEPTION 'ISSUE-2986 A8 FAIL: changed source stayed searchable (resolver %, sitemap %)',v,v_count;
  END IF;
  v_source_updated_at := (
    public.public_search_source_facts('/e/i2986adv/good','event')->'facts'->>'sourceUpdatedAt'
  )::timestamptz;

  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM public.upsert_public_search_document(
    'event','29860000-0000-4000-8000-000000000501','/e/i2986adv/good','search_ready',NULL,v_common,
    v_source_updated_at,now(),now()+interval '30 day','fresh source re-review','issue_2986_adv',false);
  RESET ROLE;
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  v:=public.resolve_public_search_document('/e/i2986adv/good');
  SELECT count(*) INTO v_count FROM public.list_public_search_sitemap();
  RESET ROLE;
  IF v->>'state'<>'search_ready' OR v_count<>1 THEN
    RAISE EXCEPTION 'ISSUE-2986 A8 FAIL: fresh review did not restore truth (resolver %, sitemap %)',v,v_count;
  END IF;
END
$a8$;

-- A10 (independent tester addition): lifecycle overlays are subordinate to
-- source privacy. An archive state intended for ended/cancelled offerings must
-- never turn an unverified physical brand into a public fact document.
DO $a10$
DECLARE v jsonb;
BEGIN
  INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
  VALUES ('29860000-0000-4000-8000-000000000901','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','brand-privacy-i2986@example.test','x',now(),now());
  INSERT INTO public.creator_accounts(id) VALUES ('29860000-0000-4000-8000-000000000901');
  INSERT INTO public.brands(
    id,account_id,name,slug,kind,claim_status,description,cover_media_url,cover_media_type,
    default_currency,pricing_currency)
  VALUES (
    '29860000-0000-4000-8000-000000000910','29860000-0000-4000-8000-000000000901',
    'Unverified Private Physical Brand','i2986privatebrand','physical','none',
    'Private unverified brand facts that must never be exposed through an overlay lifecycle mistake.',
    'https://images.example.test/i2986-private-brand.jpg','image','USD','usd');

  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM public.upsert_public_search_document(
    'brand','29860000-0000-4000-8000-000000000910','/b/i2986privatebrand','expired_archived',NULL,
    '{}',now(),now(),now()+interval '30 day',
    'adversarial private archive overlay','issue_2986_tester',false);
  RESET ROLE;

  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  v:=public.resolve_public_search_document('/b/i2986privatebrand');
  RESET ROLE;
  IF v->>'state' IS DISTINCT FROM 'draft'
     OR v->'facts' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'ISSUE-2986 A10 FAIL: lifecycle overlay exposed private/draft brand facts: %',v;
  END IF;
END
$a10$;

-- A9 (independent tester addition): a review timestamp is evidence about the
-- live source, not a caller-owned freshness override. A future source timestamp
-- must be rejected; otherwise later real source edits that are still earlier
-- than the forged timestamp remain search_ready. Likewise, a scheduled offering
-- whose master occurrence has already elapsed must not be promotable merely
-- because its status row was never advanced to ended.
DO $a9$
DECLARE
  v_common jsonb := '{"facts_verified":true,"canonical_verified":true,"visible_html_verified":true,"metadata_verified":true,"schema_verified":true,"image_rights_verified":true,"action_verified":true,"schedule_verified":true,"location_verified":true,"organizer_verified":true,"price_or_free_verified":true,"privacy_moderation_verified":true}';
  v jsonb;
  v_source_updated_at timestamptz;
  v_future_accepted boolean := false;
  v_future_edit_stayed_searchable boolean := false;
  v_elapsed_accepted boolean := false;
  v_elapsed_became_searchable boolean := false;
  v_failures text[] := ARRAY[]::text[];
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  BEGIN
    PERFORM public.upsert_public_search_document(
      'event','29860000-0000-4000-8000-000000000501','/e/i2986adv/good','search_ready',NULL,v_common,
      clock_timestamp()+interval '1 year',now(),now()+interval '30 day',
      'future source timestamp attack','issue_2986_tester',false);
    v_future_accepted := true;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%public_search_readiness_incomplete%' THEN RAISE; END IF;
  END;
  RESET ROLE;

  IF v_future_accepted THEN
    EXECUTE 'ALTER TABLE public.events DISABLE TRIGGER trg_events_updated_at';
    UPDATE public.events SET updated_at=clock_timestamp()+interval '6 month'
    WHERE id='29860000-0000-4000-8000-000000000501';
    EXECUTE 'ALTER TABLE public.events ENABLE TRIGGER trg_events_updated_at';
    SET LOCAL ROLE anon;
    PERFORM set_config('request.jwt.claim.role','anon',true);
    v:=public.resolve_public_search_document('/e/i2986adv/good');
    v_future_edit_stayed_searchable := v->>'state'='search_ready'
      AND EXISTS (
        SELECT 1 FROM public.list_public_search_sitemap()
        WHERE canonical_path='/e/i2986adv/good');
    RESET ROLE;
  END IF;

  UPDATE public.event_dates
  SET start_at=clock_timestamp()-interval '10 day',
      end_at=clock_timestamp()-interval '9 day'
  WHERE event_id='29860000-0000-4000-8000-000000000508' AND is_master;
  v_source_updated_at := (
    public.public_search_source_facts('/e/i2986adv/stale','event')->'facts'->>'sourceUpdatedAt'
  )::timestamptz;

  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  BEGIN
    PERFORM public.upsert_public_search_document(
      'event','29860000-0000-4000-8000-000000000508','/e/i2986adv/stale','search_ready',NULL,v_common,
      v_source_updated_at,now(),now()+interval '30 day',
      'elapsed scheduled offering attack','issue_2986_tester',false);
    v_elapsed_accepted := true;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%public_search_readiness_incomplete%' THEN RAISE; END IF;
  END;
  RESET ROLE;

  IF v_elapsed_accepted THEN
    SET LOCAL ROLE anon;
    PERFORM set_config('request.jwt.claim.role','anon',true);
    v:=public.resolve_public_search_document('/e/i2986adv/stale');
    v_elapsed_became_searchable := v->>'state'='search_ready'
      AND EXISTS (
        SELECT 1 FROM public.list_public_search_sitemap()
        WHERE canonical_path='/e/i2986adv/stale');
    RESET ROLE;
  END IF;

  IF v_future_accepted THEN v_failures:=array_append(v_failures,'future source timestamp accepted'); END IF;
  IF v_future_edit_stayed_searchable THEN v_failures:=array_append(v_failures,'later source edit remained searchable behind future timestamp'); END IF;
  IF v_elapsed_accepted THEN v_failures:=array_append(v_failures,'elapsed scheduled offering accepted'); END IF;
  IF v_elapsed_became_searchable THEN v_failures:=array_append(v_failures,'elapsed scheduled offering entered resolver/sitemap'); END IF;
  IF cardinality(v_failures)>0 THEN
    RAISE EXCEPTION 'ISSUE-2986 A9 FAIL: %',array_to_string(v_failures,'; ');
  END IF;
END
$a9$;

ROLLBACK;
SELECT 'issue_2986_public_search_documents tester adversarial: PASS' AS result;
