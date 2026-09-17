-- Issue #3197 tester-style adversarial contract (PostgreSQL 17).
--
-- Written in the tester's posture by the implementor (no independent tester
-- has run yet): every block below attacks a way the automatic policy could
-- index the wrong page, keep a dead one, or hide its own failure.
--
--   A1  qualified inventory — a brand whose #2986 predicate is TRUE but whose
--       only "upcoming" event has ended, or fails its own floor, stays noindex;
--       a promoted brand is demoted when its last indexable offering ends.
--   A2  heir rebind — a path reused by a different account is rebound to the
--       heir; the predecessor's approval never transfers silently.
--   A3  heir clear — an operator `gone` row for a predecessor never 410s a
--       visible heir that does not qualify.
--   A4  operator hold wins — a row written through the #2986 RPC for the same
--       entity is never modified, and is reported as held, not divergent.
--   A5  mixed-case slug (#3232) — skipped and counted, never raises.
--   A6  test records — an is_test_record row is never promoted; prod-shaped
--       QA brands fail the floor; and the documented "no name filter" policy.
--   A7  ACL — anon and authenticated cannot execute any #3197 function.
--   A8  one poisoned write never aborts the run, and the monitor names it.
--   A9  the monitor raises when the reconciler is unscheduled or stalled.
--   A10 at rest the policy's rows are only search_ready; every transient
--       public_noindex write is immediately followed by DELETE; the policy
--       never writes draft, stale, expired_archived, gone or redirected.
--
-- One transaction + ROLLBACK. Fixture ids 31971000-, emails example.test.
-- Assertions are fixture-scoped only (see the implementor suite header).

\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.t3197_reconcile() RETURNS jsonb LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('issue_3197_public_search_reconcile'));
  RETURN public.issue_3197_reconcile_public_search();
END
$f$;

CREATE FUNCTION pg_temp.t3197_anon(p_path text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v jsonb;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO v USING p_path;
  RESET ROLE;
  RETURN v;
END
$f$;

CREATE FUNCTION pg_temp.t3197_in_sitemap(p_path text) RETURNS boolean LANGUAGE plpgsql AS $f$
DECLARE v boolean;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.list_public_search_sitemap() WHERE canonical_path=$1)' INTO v USING p_path;
  RESET ROLE;
  RETURN v;
END
$f$;

-- The real operator write path (#2986 RPC as service_role).
CREATE FUNCTION pg_temp.t3197_operator_write(p_kind text, p_id uuid, p_path text, p_state text, p_test boolean)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  v := public.upsert_public_search_document(
    p_kind,p_id,p_path,p_state,NULL,'{}'::jsonb,NULL,NULL,NULL,
    'Issue 3197 adversarial operator decision','ops_manual_hold',p_test);
  RESET ROLE;
  RETURN v;
END
$f$;

-- A brand on its own account with one offering; every id derived from a stem.
CREATE FUNCTION pg_temp.t3197_fixture(
  p_stem int, p_account uuid, p_slug text, p_event_slug text, p_event_title text,
  p_event_description text, p_start timestamptz, p_end timestamptz)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_brand uuid := ('31971000-0000-4000-8000-' || lpad((p_stem*100)::text,12,'0'))::uuid;
  v_event uuid := ('31971000-0000-4000-8000-' || lpad((p_stem*100+1)::text,12,'0'))::uuid;
BEGIN
  INSERT INTO public.brands(id,account_id,name,slug,description,kind,cover_media_url,cover_media_type,
    claim_status,default_currency,pricing_currency,created_at,updated_at)
  VALUES (v_brand,p_account,'Issue 3197 '||p_slug,p_slug,
    'A real public host description with enough useful detail for explorers to understand this organizer.',
    'popup','https://images.example.test/'||lower(p_slug)||'.jpg','image','none','USD','usd',
    now()-interval '1 hour',now()-interval '1 hour');
  IF p_event_slug IS NOT NULL THEN
    INSERT INTO public.events(id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,
      location_text,is_online,city,cover_media_url,cover_media_type,theme,published_at,updated_at)
    VALUES (v_event,v_brand,p_account,p_event_title,p_event_description,p_event_slug,'event','public','scheduled',
      'UTC','Downtown Durham',false,'Durham','https://images.example.test/'||p_event_slug||'.jpg','image','{}',now(),
      now()-interval '1 hour');
    INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone,updated_at)
    VALUES (v_event,p_start,p_end,true,'UTC',now()-interval '1 hour');
    INSERT INTO public.ticket_types(event_id,name,price_cents,currency,quantity_total,is_free,available_online,updated_at)
    VALUES (v_event,'General admission',2500,'USD',100,false,true,now()-interval '1 hour');
  END IF;
END
$f$;

CREATE FUNCTION pg_temp.t3197_brand(p_stem int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('31971000-0000-4000-8000-' || lpad((p_stem*100)::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.t3197_event(p_stem int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('31971000-0000-4000-8000-' || lpad((p_stem*100+1)::text,12,'0'))::uuid $$;

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) VALUES
  ('31971000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a-i3197@example.test','x',now(),now()),
  ('31971000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b-i3197@example.test','x',now(),now());
INSERT INTO public.creator_accounts(id) VALUES
  ('31971000-0000-4000-8000-000000000001'),
  ('31971000-0000-4000-8000-000000000002');

-- Every document id this suite ever touches, for A10.
CREATE TEMP TABLE t3197_seen_docs(doc_id uuid PRIMARY KEY);

SELECT pg_temp.t3197_fixture(1,'31971000-0000-4000-8000-000000000001','i3197ended','past-show','Issue 3197 Past Show',
  'A ticketed show that already happened, with enough detail to pass every content rule.',
  now()-interval '10 day',now()-interval '10 day'+interval '3 hour');
SELECT pg_temp.t3197_fixture(2,'31971000-0000-4000-8000-000000000001','i3197thin','thin-show','Issue 3197 Thin Show',
  'Thirty-eight characters of copy, sadly',
  now()+interval '10 day',now()+interval '10 day 3 hour');
SELECT pg_temp.t3197_fixture(3,'31971000-0000-4000-8000-000000000001','i3197ending','last-show','Issue 3197 Last Show',
  'The last upcoming show under this brand, with enough detail to pass every content rule.',
  now()+interval '10 day',now()+interval '10 day 3 hour');

-- A1a: the #2986 literal brand predicate trusts events.status. Prove the
-- fixture really is the production defect, then prove the policy refuses it.
DO $a1a$
DECLARE r record; d jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      (1,'/b/i3197ended','past-show ended; its own floor fails'),
      (2,'/b/i3197thin','thin-show is upcoming but fails its own floor (the smokerhythm shape)')) t(stem,path,why) LOOP
    IF NOT public.public_search_source_is_search_ready('brand',pg_temp.t3197_brand(r.stem)) THEN
      RAISE EXCEPTION 'ISSUE-3197 A1a FAIL: fixture % no longer reproduces the #2986 brand predicate defect',r.path;
    END IF;
    IF public.public_search_source_is_search_ready('event',pg_temp.t3197_event(r.stem)) THEN
      RAISE EXCEPTION 'ISSUE-3197 A1a FAIL: fixture %''s offering should fail its own floor (%)',r.path,r.why;
    END IF;
    d := public.issue_3197_public_search_decide('brand',pg_temp.t3197_brand(r.stem));
    IF (d->>'eligible')::boolean OR d->'blockers'<>'["no_qualified_inventory"]'::jsonb THEN
      RAISE EXCEPTION 'ISSUE-3197 A1a FAIL: % must be blocked ONLY by no_qualified_inventory: %',r.path,d;
    END IF;
  END LOOP;
  -- thin-show is future-dated: "end_at > now()" alone would have qualified the brand.
  IF NOT EXISTS (SELECT 1 FROM public.event_dates WHERE event_id=pg_temp.t3197_event(2) AND is_master AND end_at>now()) THEN
    RAISE EXCEPTION 'ISSUE-3197 A1a FAIL: thin-show must be future-dated to be a real control';
  END IF;

  PERFORM pg_temp.t3197_reconcile();
  FOR r IN SELECT * FROM (VALUES (1,'/b/i3197ended','/e/i3197ended/past-show'),(2,'/b/i3197thin','/e/i3197thin/thin-show')) t(stem,bpath,epath) LOOP
    IF EXISTS (SELECT 1 FROM public.public_search_documents
                WHERE entity_id IN (pg_temp.t3197_brand(r.stem),pg_temp.t3197_event(r.stem))
                   OR canonical_path IN (r.bpath,r.epath)) THEN
      RAISE EXCEPTION 'ISSUE-3197 A1a FAIL: % was promoted without qualified inventory',r.bpath;
    END IF;
    IF (pg_temp.t3197_anon(r.bpath))->>'state'<>'public_noindex' OR pg_temp.t3197_in_sitemap(r.bpath) THEN
      RAISE EXCEPTION 'ISSUE-3197 A1a FAIL: % is indexable',r.bpath;
    END IF;
  END LOOP;
END
$a1a$;

-- A1b: a promoted brand is demoted when its last indexable offering ends.
DO $a1b$
DECLARE v_brand_doc uuid; v_reason text;
BEGIN
  PERFORM pg_temp.t3197_reconcile();
  SELECT id INTO v_brand_doc FROM public.public_search_documents
   WHERE canonical_path='/b/i3197ending' AND lifecycle_state='search_ready' AND entity_id=pg_temp.t3197_brand(3);
  IF v_brand_doc IS NULL OR NOT EXISTS (SELECT 1 FROM public.public_search_documents
       WHERE canonical_path='/e/i3197ending/last-show' AND lifecycle_state='search_ready') THEN
    RAISE EXCEPTION 'ISSUE-3197 A1b FAIL: the qualifying brand and its show were not promoted';
  END IF;
  INSERT INTO t3197_seen_docs SELECT id FROM public.public_search_documents
   WHERE canonical_path IN ('/b/i3197ending','/e/i3197ending/last-show') ON CONFLICT DO NOTHING;

  UPDATE public.event_dates SET start_at=now()-interval '2 day', end_at=now()-interval '2 day'+interval '3 hour'
   WHERE event_id=pg_temp.t3197_event(3) AND is_master;
  PERFORM pg_temp.t3197_reconcile();

  IF EXISTS (SELECT 1 FROM public.public_search_documents
              WHERE canonical_path IN ('/b/i3197ending','/e/i3197ending/last-show')) THEN
    RAISE EXCEPTION 'ISSUE-3197 A1b FAIL: a brand whose last offering ended kept its search row';
  END IF;
  SELECT a.after_row->>'change_reason' INTO v_reason FROM public.public_search_document_audit a
   WHERE a.document_id=v_brand_doc AND a.operation='UPDATE' ORDER BY a.id DESC LIMIT 1;
  IF position('no_qualified_inventory' IN v_reason)=0 THEN
    RAISE EXCEPTION 'ISSUE-3197 A1b FAIL: the brand demotion does not name no_qualified_inventory: %',v_reason;
  END IF;
  IF (pg_temp.t3197_anon('/b/i3197ending'))->>'state'<>'public_noindex' OR pg_temp.t3197_in_sitemap('/b/i3197ending') THEN
    RAISE EXCEPTION 'ISSUE-3197 A1b FAIL: the demoted brand is still indexable';
  END IF;
END
$a1b$;

-- A2: HEIR REBIND. Account A's brand and show are promoted; A deletes the
-- brand; account B creates the same slug with its own qualifying show. Before
-- the tick the heir's pages are a 503 (the predecessor's row); after one tick
-- both rows are rebound to the heir, the audit keeps the predecessor, and the
-- heir is indexable on its OWN facts.
SELECT pg_temp.t3197_fixture(4,'31971000-0000-4000-8000-000000000001','i3197heir','opening','Issue 3197 Opening',
  'The predecessor host''s opening night, with enough detail to pass every content rule.',
  now()+interval '15 day',now()+interval '15 day 3 hour');
DO $a2$
DECLARE r record; v jsonb; doc public.public_search_documents%ROWTYPE; v_before jsonb;
BEGIN
  PERFORM pg_temp.t3197_reconcile();
  IF (SELECT count(*) FROM public.public_search_documents
       WHERE canonical_path IN ('/b/i3197heir','/e/i3197heir/opening') AND lifecycle_state='search_ready'
         AND change_source='issue_3197_auto_policy')<>2 THEN
    RAISE EXCEPTION 'ISSUE-3197 A2 FAIL: the predecessor was not promoted';
  END IF;
  INSERT INTO t3197_seen_docs SELECT id FROM public.public_search_documents
   WHERE canonical_path IN ('/b/i3197heir','/e/i3197heir/opening') ON CONFLICT DO NOTHING;

  UPDATE public.events SET status='cancelled' WHERE id=pg_temp.t3197_event(4);
  UPDATE public.brands SET deleted_at=now() WHERE id=pg_temp.t3197_brand(4);
  PERFORM pg_temp.t3197_fixture(5,'31971000-0000-4000-8000-000000000002','i3197heir','opening','Issue 3197 Heir Opening',
    'A different host reusing the web name, with its own opening night and real detail.',
    now()+interval '20 day',now()+interval '20 day 3 hour');

  FOR r IN SELECT * FROM (VALUES ('/b/i3197heir'),('/e/i3197heir/opening')) t(path) LOOP
    v := pg_temp.t3197_anon(r.path);
    IF v->>'state'<>'dependency_failure' THEN
      RAISE EXCEPTION 'ISSUE-3197 A2 FAIL: before the tick % should expose the predecessor row as dependency_failure: %',r.path,v;
    END IF;
  END LOOP;

  PERFORM pg_temp.t3197_reconcile();

  FOR r IN SELECT * FROM (VALUES
      ('/b/i3197heir',pg_temp.t3197_brand(4),pg_temp.t3197_brand(5)),
      ('/e/i3197heir/opening',pg_temp.t3197_event(4),pg_temp.t3197_event(5))) t(path,old_id,new_id) LOOP
    SELECT * INTO doc FROM public.public_search_documents WHERE canonical_path=r.path;
    IF NOT FOUND OR doc.entity_id<>r.new_id OR doc.lifecycle_state<>'search_ready'
       OR doc.change_source<>'issue_3197_auto_policy'
       OR position('Path reassigned' IN doc.change_reason)=0
       OR position(r.old_id::text IN doc.change_reason)=0 OR position(r.new_id::text IN doc.change_reason)=0 THEN
      RAISE EXCEPTION 'ISSUE-3197 A2 FAIL: % was not rebound to the heir: %',r.path,to_jsonb(doc);
    END IF;
    SELECT a.before_row INTO v_before FROM public.public_search_document_audit a
     WHERE a.document_id=doc.id AND a.operation='UPDATE' ORDER BY a.id DESC LIMIT 1;
    IF v_before->>'entity_id'<>r.old_id::text THEN
      RAISE EXCEPTION 'ISSUE-3197 A2 FAIL: the rebind audit lost the predecessor for %: %',r.path,v_before;
    END IF;
    v := pg_temp.t3197_anon(r.path);
    IF v->>'state'<>'search_ready' OR v->'facts'->>'id'<>r.new_id::text OR NOT pg_temp.t3197_in_sitemap(r.path) THEN
      RAISE EXCEPTION 'ISSUE-3197 A2 FAIL: the heir % is not indexable on its own facts: %',r.path,v;
    END IF;
  END LOOP;
END
$a2$;

-- A3: HEIR CLEAR. An operator marked the predecessor's page `gone`. A visible
-- heir that does NOT qualify must not inherit the 410: the row is cleared and
-- the heir serves its own public_noindex page.
SELECT pg_temp.t3197_fixture(6,'31971000-0000-4000-8000-000000000001','i3197gone',NULL,NULL,NULL,NULL,NULL);
DO $a3$
DECLARE v jsonb; v_doc uuid; s jsonb;
BEGIN
  v := pg_temp.t3197_operator_write('brand',pg_temp.t3197_brand(6),'/b/i3197gone','gone',false);
  v_doc := (v->>'id')::uuid;
  INSERT INTO t3197_seen_docs VALUES (v_doc) ON CONFLICT DO NOTHING;
  UPDATE public.brands SET deleted_at=now() WHERE id=pg_temp.t3197_brand(6);
  INSERT INTO public.brands(id,account_id,name,slug,kind,claim_status,default_currency,pricing_currency)
  VALUES (pg_temp.t3197_brand(7),'31971000-0000-4000-8000-000000000002','Issue 3197 Gone Heir','i3197gone','popup','none','USD','usd');

  IF (pg_temp.t3197_anon('/b/i3197gone'))->>'state'<>'gone' THEN
    RAISE EXCEPTION 'ISSUE-3197 A3 FAIL: fixture should reproduce the heir-410 hazard before the tick';
  END IF;
  s := pg_temp.t3197_reconcile();
  IF EXISTS (SELECT 1 FROM public.public_search_documents WHERE id=v_doc OR canonical_path='/b/i3197gone') THEN
    RAISE EXCEPTION 'ISSUE-3197 A3 FAIL: the predecessor gone row still decides the heir page';
  END IF;
  v := pg_temp.t3197_anon('/b/i3197gone');
  IF v->>'state'<>'public_noindex' OR v->'facts'->>'id'<>pg_temp.t3197_brand(7)::text THEN
    RAISE EXCEPTION 'ISSUE-3197 A3 FAIL: the heir should serve its own public_noindex page: %',v;
  END IF;
  IF (s->>'cleared')::int < 1 THEN
    RAISE EXCEPTION 'ISSUE-3197 A3 FAIL: the summary does not count the cleared row: %',s;
  END IF;
END
$a3$;

-- A4: OPERATOR HOLD WINS. An operator holds a qualifying show at
-- public_noindex through the #2986 RPC. Three ticks never touch that row, the
-- monitor reports it as held rather than divergent, and it stays unindexed.
SELECT pg_temp.t3197_fixture(8,'31971000-0000-4000-8000-000000000001','i3197hold','held-show','Issue 3197 Held Show',
  'A qualifying show an operator has deliberately held out of search for now.',
  now()+interval '9 day',now()+interval '9 day 3 hour');
DO $a4$
DECLARE v jsonb; v_doc uuid; v_updated timestamptz; v_mark bigint; d jsonb; i int; s jsonb;
BEGIN
  v := pg_temp.t3197_operator_write('event',pg_temp.t3197_event(8),'/e/i3197hold/held-show','public_noindex',false);
  v_doc := (v->>'id')::uuid;
  INSERT INTO t3197_seen_docs VALUES (v_doc) ON CONFLICT DO NOTHING;
  SELECT updated_at INTO v_updated FROM public.public_search_documents WHERE id=v_doc;
  SELECT max(id) INTO v_mark FROM public.public_search_document_audit;
  IF NOT (public.issue_3197_public_search_decide('event',pg_temp.t3197_event(8))->>'eligible')::boolean THEN
    RAISE EXCEPTION 'ISSUE-3197 A4 FAIL: the held show must itself qualify, or the hold proves nothing';
  END IF;
  FOR i IN 1..3 LOOP s := pg_temp.t3197_reconcile(); END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.public_search_documents WHERE id=v_doc AND lifecycle_state='public_noindex'
                   AND change_source='ops_manual_hold' AND updated_at=v_updated) THEN
    RAISE EXCEPTION 'ISSUE-3197 A4 FAIL: the reconciler modified an operator hold';
  END IF;
  IF EXISTS (SELECT 1 FROM public.public_search_document_audit WHERE document_id=v_doc AND id>v_mark) THEN
    RAISE EXCEPTION 'ISSUE-3197 A4 FAIL: the operator hold gained an audit entry';
  END IF;
  IF (s->>'held')::int < 1 THEN
    RAISE EXCEPTION 'ISSUE-3197 A4 FAIL: the summary does not report the hold: %',s;
  END IF;
  IF pg_temp.t3197_in_sitemap('/e/i3197hold/held-show') OR (pg_temp.t3197_anon('/e/i3197hold/held-show'))->>'state'<>'public_noindex' THEN
    RAISE EXCEPTION 'ISSUE-3197 A4 FAIL: the held show is indexable';
  END IF;
  d := public.issue_3197_public_search_divergence();
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(d->'divergences') x WHERE x->>'path'='/e/i3197hold/held-show') THEN
    RAISE EXCEPTION 'ISSUE-3197 A4 FAIL: an operator hold is reported as divergence: %',d;
  END IF;
  IF (d->>'held')::int < 1 THEN
    RAISE EXCEPTION 'ISSUE-3197 A4 FAIL: the monitor does not count the hold: %',d;
  END IF;
END
$a4$;

-- A5: MIXED-CASE SLUG (#3232). The page has no canonical public path. It is
-- skipped and counted, nothing raises, and nothing is written.
SELECT pg_temp.t3197_fixture(9,'31971000-0000-4000-8000-000000000001','I3197Mixed','mixed-show','Issue 3197 Mixed Show',
  'A show under a brand whose web name carries capital letters and real detail.',
  now()+interval '11 day',now()+interval '11 day 3 hour');
DO $a5$
DECLARE s jsonb; d jsonb;
BEGIN
  d := public.issue_3197_public_search_decide('brand',pg_temp.t3197_brand(9));
  IF (d->>'pathValid')::boolean OR NOT (d->'blockers') ? 'path_grammar' THEN
    RAISE EXCEPTION 'ISSUE-3197 A5 FAIL: a mixed-case brand path is not reported as path_grammar: %',d;
  END IF;
  s := pg_temp.t3197_reconcile();
  IF EXISTS (SELECT 1 FROM public.public_search_documents
              WHERE entity_id IN (pg_temp.t3197_brand(9),pg_temp.t3197_event(9))) THEN
    RAISE EXCEPTION 'ISSUE-3197 A5 FAIL: a mixed-case page got a search row';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s->'skippedPaths') x WHERE x->>'entityId'=pg_temp.t3197_brand(9)::text)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s->'skippedPaths') x WHERE x->>'entityId'=pg_temp.t3197_event(9)::text)
     OR (s->>'skippedPath')::int < 2 THEN
    RAISE EXCEPTION 'ISSUE-3197 A5 FAIL: the mixed-case brand and show were not skipped and counted: %',s;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(s->'errors') x
              WHERE x->>'entityId' IN (pg_temp.t3197_brand(9)::text,pg_temp.t3197_event(9)::text)) THEN
    RAISE EXCEPTION 'ISSUE-3197 A5 FAIL: a mixed-case page raised inside the reconciler: %',s->'errors';
  END IF;
END
$a5$;

-- A6: TEST RECORDS.
SELECT pg_temp.t3197_fixture(10,'31971000-0000-4000-8000-000000000001','i3197flagged','flagged-show','Issue 3197 Flagged Show',
  'A show an operator flagged as a test record, with otherwise complete detail.',
  now()+interval '8 day',now()+interval '8 day 3 hour');
SELECT pg_temp.t3197_fixture(11,'31971000-0000-4000-8000-000000000001','i3197qa','issue-3197-qa-fixture','Issue 3197 QA fixture test',
  'A fully complete public show whose name merely looks like internal QA content.',
  now()+interval '8 day',now()+interval '8 day 3 hour');
-- The production QA brand shape: no description, no image, no events.
INSERT INTO public.brands(id,account_id,name,slug,kind,claim_status,default_currency,pricing_currency)
VALUES (pg_temp.t3197_brand(12),'31971000-0000-4000-8000-000000000001','QA3197Retest','qa3197retest','popup','none','USD','usd');
DO $a6$
DECLARE v jsonb; v_doc uuid; d jsonb;
BEGIN
  -- (a) an is_test_record row is never promoted, however complete the page.
  v := pg_temp.t3197_operator_write('event',pg_temp.t3197_event(10),'/e/i3197flagged/flagged-show','public_noindex',true);
  v_doc := (v->>'id')::uuid;
  INSERT INTO t3197_seen_docs VALUES (v_doc) ON CONFLICT DO NOTHING;
  PERFORM pg_temp.t3197_reconcile();
  IF NOT EXISTS (SELECT 1 FROM public.public_search_documents WHERE id=v_doc AND is_test_record
                   AND lifecycle_state='public_noindex' AND change_source='ops_manual_hold') THEN
    RAISE EXCEPTION 'ISSUE-3197 A6a FAIL: the reconciler rewrote a test-record row';
  END IF;
  IF pg_temp.t3197_in_sitemap('/e/i3197flagged/flagged-show') THEN
    RAISE EXCEPTION 'ISSUE-3197 A6a FAIL: a test record reached the sitemap';
  END IF;
  -- (b) prod-shaped QA brands fail the content floor.
  d := public.issue_3197_public_search_decide('brand',pg_temp.t3197_brand(12));
  IF (d->>'eligible')::boolean OR NOT (d->'blockers') ? 'content_floor' OR NOT (d->'blockers') ? 'no_qualified_inventory'
     OR EXISTS (SELECT 1 FROM public.public_search_documents WHERE entity_id=pg_temp.t3197_brand(12)) THEN
    RAISE EXCEPTION 'ISSUE-3197 A6b FAIL: a prod-shaped QA brand qualified: %',d;
  END IF;
  -- (c) POLICY PIN, not a hazard: there is deliberately NO name-based test
  -- filter (see the migration header). A complete page whose name merely looks
  -- like QA content IS indexed. A future name filter must change this on purpose.
  IF NOT EXISTS (SELECT 1 FROM public.public_search_documents WHERE canonical_path='/e/i3197qa/issue-3197-qa-fixture'
                   AND lifecycle_state='search_ready' AND entity_id=pg_temp.t3197_event(11)) THEN
    RAISE EXCEPTION 'ISSUE-3197 A6c FAIL: the no-name-filter policy changed without this pin changing';
  END IF;
  INSERT INTO t3197_seen_docs SELECT id FROM public.public_search_documents
   WHERE canonical_path IN ('/b/i3197qa','/e/i3197qa/issue-3197-qa-fixture') ON CONFLICT DO NOTHING;
END
$a6$;

-- A7: ACL. Supabase default privileges would grant EXECUTE to anon and
-- authenticated; the REVOKEs must actually hold at call time.
DO $a7$
DECLARE v_role text; v_call text; v_denied boolean;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_call IN ARRAY ARRAY[
      'SELECT public.issue_3197_public_search_policy_checks(''event'')',
      'SELECT public.issue_3197_public_search_decide(''brand'',''31971000-0000-4000-8000-000000000400'')',
      'SELECT public.issue_3197_reconcile_public_search()',
      'SELECT public.issue_3197_public_search_divergence()',
      'SELECT public.issue_3197_assert_public_search_converged(interval ''0'',NULL)'] LOOP
      v_denied := false;
      BEGIN
        EXECUTE format('SET LOCAL ROLE %I', v_role);
        PERFORM set_config('request.jwt.claim.role',v_role,true);
        EXECUTE v_call;
      EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
      END;
      RESET ROLE;
      IF NOT v_denied THEN
        RAISE EXCEPTION 'ISSUE-3197 A7 FAIL: % could run: %',v_role,v_call;
      END IF;
    END LOOP;
  END LOOP;
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM public.issue_3197_public_search_decide('brand',pg_temp.t3197_brand(5));
  RESET ROLE;
END
$a7$;

-- A8: ONE POISONED WRITE. A write that raises for one entity is recorded in
-- errors[], every other entity in the same call is still promoted, the call
-- returns, and the monitor raises naming the stuck page.
SELECT pg_temp.t3197_fixture(13,'31971000-0000-4000-8000-000000000001','i3197poison','poison-show','Issue 3197 Poison Show',
  'A qualifying show whose search write is made to fail for this test.',
  now()+interval '7 day',now()+interval '7 day 3 hour');
SELECT pg_temp.t3197_fixture(14,'31971000-0000-4000-8000-000000000001','i3197healthy','healthy-show','Issue 3197 Healthy Show',
  'A qualifying show that must be promoted in the same call regardless.',
  now()+interval '7 day',now()+interval '7 day 3 hour');
CREATE FUNCTION public.t3197_poison_write() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  RAISE EXCEPTION 'i3197_poisoned_write' USING ERRCODE='P0001';
END
$f$;
CREATE TRIGGER t3197_poison BEFORE INSERT OR UPDATE ON public.public_search_documents
  FOR EACH ROW WHEN (NEW.entity_id = '31971000-0000-4000-8000-000000001301')
  EXECUTE FUNCTION public.t3197_poison_write();
DO $a8$
DECLARE s jsonb; v_raised text;
BEGIN
  s := pg_temp.t3197_reconcile();
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s->'errors') x
                  WHERE x->>'entityId'=pg_temp.t3197_event(13)::text AND x->>'message'='i3197_poisoned_write') THEN
    RAISE EXCEPTION 'ISSUE-3197 A8 FAIL: the poisoned write is not reported in errors: %',s;
  END IF;
  IF (SELECT count(*) FROM public.public_search_documents
       WHERE canonical_path IN ('/b/i3197healthy','/e/i3197healthy/healthy-show','/b/i3197poison')
         AND lifecycle_state='search_ready')<>3 THEN
    RAISE EXCEPTION 'ISSUE-3197 A8 FAIL: one poisoned entity blocked the rest of the run';
  END IF;
  INSERT INTO t3197_seen_docs SELECT id FROM public.public_search_documents
   WHERE canonical_path IN ('/b/i3197healthy','/e/i3197healthy/healthy-show','/b/i3197poison') ON CONFLICT DO NOTHING;
  BEGIN
    PERFORM public.issue_3197_assert_public_search_converged(interval '0',NULL);
  EXCEPTION WHEN OTHERS THEN
    v_raised := SQLERRM;
  END;
  IF v_raised IS NULL OR position('issue_3197_public_search_diverged' IN v_raised)=0
     OR position('/e/i3197poison/poison-show' IN v_raised)=0 THEN
    RAISE EXCEPTION 'ISSUE-3197 A8 FAIL: the monitor did not name the stuck page: %',v_raised;
  END IF;
END
$a8$;
DROP TRIGGER t3197_poison ON public.public_search_documents;
DROP FUNCTION public.t3197_poison_write();
DO $a8b$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.t3197_reconcile();
  IF NOT EXISTS (SELECT 1 FROM public.public_search_documents
                  WHERE canonical_path='/e/i3197poison/poison-show' AND lifecycle_state='search_ready') THEN
    RAISE EXCEPTION 'ISSUE-3197 A8b FAIL: the unpoisoned page did not recover on the next call';
  END IF;
  INSERT INTO t3197_seen_docs SELECT id FROM public.public_search_documents
   WHERE canonical_path='/e/i3197poison/poison-show' ON CONFLICT DO NOTHING;
  v := public.issue_3197_assert_public_search_converged(interval '0',NULL);
  IF (v->>'converged')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'ISSUE-3197 A8b FAIL: the monitor did not clear after recovery: %',v;
  END IF;
END
$a8b$;

-- A9: the monitor raises when the reconciler is unscheduled or stalled, and
-- does not raise for a job that has never run yet.
DO $a9$
DECLARE v_job bigint; v_raised text; v jsonb;
BEGIN
  SELECT jobid INTO v_job FROM cron.job WHERE jobname='issue_3197_public_search_reconcile';

  -- (a) unscheduled (inactive). The subtransaction rolls the change back.
  v_raised := NULL;
  BEGIN
    PERFORM cron.alter_job(v_job, active := false);
    PERFORM public.issue_3197_assert_public_search_converged(interval '0',NULL);
    RAISE EXCEPTION 'i3197_no_raise';
  EXCEPTION WHEN OTHERS THEN
    v_raised := SQLERRM;
  END;
  IF v_raised<>'issue_3197_public_search_reconciler_unscheduled' THEN
    RAISE EXCEPTION 'ISSUE-3197 A9a FAIL: an inactive reconciler was not reported: %',v_raised;
  END IF;

  -- (b) stalled: history exists, the last success is older than the limit.
  v_raised := NULL;
  BEGIN
    DELETE FROM cron.job_run_details WHERE jobid=v_job;
    -- runid is supplied explicitly: postgres holds no USAGE on cron.runid_seq.
    INSERT INTO cron.job_run_details(jobid,runid,job_pid,database,username,command,status,return_message,start_time,end_time)
    VALUES (v_job,(SELECT COALESCE(max(runid),0)+1000001 FROM cron.job_run_details),0,'postgres','postgres',
            'SELECT public.issue_3197_reconcile_public_search();','succeeded','1 row',
            now()-interval '30 minutes',now()-interval '30 minutes'),
           (v_job,(SELECT COALESCE(max(runid),0)+1000002 FROM cron.job_run_details),0,'postgres','postgres',
            'SELECT public.issue_3197_reconcile_public_search();','failed','boom',
            now()-interval '1 minute',now()-interval '1 minute');
    PERFORM public.issue_3197_assert_public_search_converged(interval '0',interval '5 minutes');
    RAISE EXCEPTION 'i3197_no_raise';
  EXCEPTION WHEN OTHERS THEN
    v_raised := SQLERRM;
  END;
  IF position('issue_3197_public_search_reconciler_stalled' IN v_raised)<>1 THEN
    RAISE EXCEPTION 'ISSUE-3197 A9b FAIL: a stalled reconciler was not reported: %',v_raised;
  END IF;

  -- (c) a recent success, and (d) no history at all, do not raise.
  v_raised := NULL;
  BEGIN
    DELETE FROM cron.job_run_details WHERE jobid=v_job;
    v := public.issue_3197_assert_public_search_converged(interval '0',interval '5 minutes');
    INSERT INTO cron.job_run_details(jobid,runid,job_pid,database,username,command,status,return_message,start_time,end_time)
    VALUES (v_job,(SELECT COALESCE(max(runid),0)+1000003 FROM cron.job_run_details),0,'postgres','postgres',
            'SELECT public.issue_3197_reconcile_public_search();','succeeded','1 row',now(),now());
    v := public.issue_3197_assert_public_search_converged(interval '0',interval '5 minutes');
    RAISE EXCEPTION 'i3197_no_raise';
  EXCEPTION WHEN OTHERS THEN
    v_raised := SQLERRM;
  END;
  IF v_raised<>'i3197_no_raise' THEN
    RAISE EXCEPTION 'ISSUE-3197 A9c FAIL: a healthy or brand-new reconciler was reported: %',v_raised;
  END IF;

  IF position('pg_try_advisory_xact_lock(hashtext(''issue_3197_public_search_reconcile''))' IN
       pg_get_functiondef('public.issue_3197_reconcile_public_search()'::regprocedure))=0 THEN
    RAISE EXCEPTION 'ISSUE-3197 A9 FAIL: the reconciler lost its advisory lock';
  END IF;
END
$a9$;

-- A10: ONLY search_ready OR DELETE. Across every document this suite touched:
-- the policy's rows at rest are search_ready; each policy write is either
-- search_ready or a public_noindex immediately followed by DELETE of the same
-- document; no policy write is ever draft/stale/expired_archived/gone/redirected.
DO $a10$
DECLARE r record; v_next text;
BEGIN
  IF (SELECT count(*) FROM t3197_seen_docs) < 10 THEN
    RAISE EXCEPTION 'ISSUE-3197 A10 FAIL: anti-vacuity — only % documents were tracked',(SELECT count(*) FROM t3197_seen_docs);
  END IF;
  IF EXISTS (SELECT 1 FROM public.public_search_documents d JOIN t3197_seen_docs s ON s.doc_id=d.id
              WHERE d.change_source='issue_3197_auto_policy' AND d.lifecycle_state<>'search_ready') THEN
    RAISE EXCEPTION 'ISSUE-3197 A10 FAIL: a policy row is at rest in a non-search_ready state';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.public_search_document_audit a JOIN t3197_seen_docs s ON s.doc_id=a.document_id
                  WHERE a.change_source='issue_3197_auto_policy' AND a.after_row->>'lifecycle_state'='public_noindex') THEN
    RAISE EXCEPTION 'ISSUE-3197 A10 FAIL: anti-vacuity — no demotion was exercised';
  END IF;
  FOR r IN
    SELECT a.id, a.document_id, a.operation, a.after_row->>'lifecycle_state' AS state
      FROM public.public_search_document_audit a JOIN t3197_seen_docs s ON s.doc_id=a.document_id
     WHERE a.change_source='issue_3197_auto_policy' AND a.operation IN ('INSERT','UPDATE')
  LOOP
    IF r.state NOT IN ('search_ready','public_noindex') THEN
      RAISE EXCEPTION 'ISSUE-3197 A10 FAIL: the policy wrote lifecycle_state % (audit %)',r.state,r.id;
    END IF;
    IF r.state='public_noindex' THEN
      SELECT a2.operation INTO v_next FROM public.public_search_document_audit a2
       WHERE a2.document_id=r.document_id AND a2.id>r.id ORDER BY a2.id LIMIT 1;
      IF v_next IS DISTINCT FROM 'DELETE' THEN
        RAISE EXCEPTION 'ISSUE-3197 A10 FAIL: a policy public_noindex write (audit %) was not immediately deleted (next: %)',r.id,v_next;
      END IF;
    END IF;
  END LOOP;
END
$a10$;

SELECT 'ISSUE-3197 tester adversarial suite PASS' AS result;

ROLLBACK;
