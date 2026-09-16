-- Issue #3197 implementor happy-path contract (PostgreSQL 17).
--
-- Seth's policy (2026-09-12): every public brand, event (incl. RSVP), trip,
-- experience and verified venue page that passes the #2986 content floor is
-- indexable within a minute, with no review step. This suite drives the real
-- per-minute reconciler against every kind and reads the result back through
-- the two public readers the Host server actually calls: the anonymous
-- resolver and the sitemap.
--
-- Conventions:
--   * one transaction + ROLLBACK: no fixture survives;
--   * fixture ids in the 31970000- namespace, emails on example.test;
--   * the reconciler is called directly, never by waiting for pg_cron. The CI
--     image runs the pg_cron daemon, so every call first takes the
--     reconciler's own advisory lock (blocking, transaction-scoped and
--     re-entrant) so a concurrent tick can never turn a call into
--     {"skipped":"locked"};
--   * every assertion is scoped to fixture ids. Committed data elsewhere in the
--     lane may also qualify and be promoted inside this transaction, so no
--     global count is ever asserted.

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

CREATE TEMP TABLE t3197_ids(kind text NOT NULL, id uuid PRIMARY KEY, path text NOT NULL UNIQUE);

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
VALUES ('31970000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','owner-i3197@example.test','x',now(),now());
INSERT INTO public.creator_accounts(id) VALUES ('31970000-0000-4000-8000-000000000001');
INSERT INTO public.brands(
  id,account_id,name,slug,description,kind,cover_media_url,cover_media_type,claim_status,default_currency,pricing_currency,
  created_at,updated_at)
VALUES (
  '31970000-0000-4000-8000-000000000010','31970000-0000-4000-8000-000000000001',
  'Issue 3197 Host','i3197host',
  'A real public host description with enough useful detail for explorers to understand this organizer.',
  'popup','https://images.example.test/i3197-brand.jpg','image','none','USD','usd',
  now()-interval '1 hour',now()-interval '1 hour');

INSERT INTO public.events(
  id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,
  location_text,is_online,city,cover_media_url,cover_media_type,cover_media_alt,destination_text,theme,published_at,updated_at)
VALUES
  ('31970000-0000-4000-8000-000000000101','31970000-0000-4000-8000-000000000010','31970000-0000-4000-8000-000000000001',
   'Issue 3197 Launch Night','A ticketed public launch night with enough unique detail to make this page useful to an explorer.',
   'launch-night','event','public','scheduled','America/New_York','Downtown Durham',false,'Durham',
   'https://images.example.test/i3197-event.jpg','image','Guests at the launch',NULL,'{}',now(),now()-interval '1 hour'),
  ('31970000-0000-4000-8000-000000000102','31970000-0000-4000-8000-000000000010','31970000-0000-4000-8000-000000000001',
   'Issue 3197 Garden RSVP','A free RSVP garden gathering with enough unique detail to make this page useful to an explorer.',
   'garden-rsvp','rsvp','public','scheduled','Africa/Lagos','Ikoyi Gardens',false,'Lagos',
   'https://images.example.test/i3197-rsvp.jpg','image','A garden gathering',NULL,'{}',now(),now()-interval '1 hour'),
  ('31970000-0000-4000-8000-000000000103','31970000-0000-4000-8000-000000000010','31970000-0000-4000-8000-000000000001',
   'Issue 3197 Coast Trip','A sourced public trip with enough itinerary context to make this page useful to an explorer.',
   'coast-trip','trip','public','scheduled','Africa/Lagos','Victoria Island',false,'Lagos',
   'https://images.example.test/i3197-trip.jpg','image','Travellers on the coast','Lagos Island','{}',now(),now()-interval '1 hour'),
  ('31970000-0000-4000-8000-000000000104','31970000-0000-4000-8000-000000000010','31970000-0000-4000-8000-000000000001',
   'Issue 3197 Studio Session','A sourced public experience with enough schedule context to make this page useful to an explorer.',
   'studio-session','experience','public','scheduled','Europe/London',NULL,false,'London',
   'https://images.example.test/i3197-experience.jpg','image','Guests in the studio',NULL,'{}',now(),now()-interval '1 hour');

INSERT INTO public.event_dates(id,event_id,start_at,end_at,is_master,timezone,updated_at)
VALUES
  ('31970000-0000-4000-8000-000000000201','31970000-0000-4000-8000-000000000101',now()+interval '30 day',now()+interval '30 day 3 hour',true,'America/New_York',now()-interval '1 hour'),
  ('31970000-0000-4000-8000-000000000202','31970000-0000-4000-8000-000000000102',now()+interval '12 day',now()+interval '12 day 4 hour',true,'Africa/Lagos',now()-interval '1 hour'),
  ('31970000-0000-4000-8000-000000000203','31970000-0000-4000-8000-000000000103',now()+interval '40 day',now()+interval '43 day',true,'Africa/Lagos',now()-interval '1 hour'),
  ('31970000-0000-4000-8000-000000000204','31970000-0000-4000-8000-000000000104',now()+interval '20 day',now()+interval '20 day 2 hour',true,'Europe/London',now()-interval '1 hour');

INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,quantity_total,is_free,available_online,updated_at)
VALUES
  ('31970000-0000-4000-8000-000000000401','31970000-0000-4000-8000-000000000101','General admission',2500,'USD',100,false,true,now()-interval '1 hour'),
  ('31970000-0000-4000-8000-000000000403','31970000-0000-4000-8000-000000000103','Trip reservation',5000,'USD',20,false,true,now()-interval '1 hour'),
  ('31970000-0000-4000-8000-000000000404','31970000-0000-4000-8000-000000000104','Studio place',0,'GBP',12,true,true,now()-interval '1 hour');

INSERT INTO public.experience_stops(
  id,event_id,stop_order,place_name,address,city,country_code,lat,lng,ai_description,updated_at)
VALUES (
  '31970000-0000-4000-8000-000000000205','31970000-0000-4000-8000-000000000104',0,
  'Issue 3197 Studio','Central London','London','GB',51.5072,-0.1276,
  'A useful public meeting-point description for the experience fixture.',now()-interval '1 hour');

INSERT INTO public.place_pool(id,name,lat,lng,generative_summary,updated_at)
VALUES ('31970000-0000-4000-8000-000000000301','Issue 3197 Rooftop',35.78,-78.64,
        'A verified rooftop venue with a useful public description of its atmosphere and guest experience.',now()-interval '1 hour');
INSERT INTO public.venue_listings(
  id,brand_id,place_pool_id,slug,name,city,country_code,lat,lng,venue_category,claim_status,cover_media_url,cover_media_type,updated_at)
VALUES (
  '31970000-0000-4000-8000-000000000302','31970000-0000-4000-8000-000000000010',
  '31970000-0000-4000-8000-000000000301','rooftop','Issue 3197 Rooftop','Raleigh','US',35.78,-78.64,
  'restaurant','verified','https://images.example.test/i3197-venue.jpg','image',now()-interval '1 hour');

-- Source tokens are aged one hour so the convergence monitor's two-minute
-- settling allowance does not apply to them (H4).
INSERT INTO t3197_ids VALUES
  ('brand','31970000-0000-4000-8000-000000000010','/b/i3197host'),
  ('event','31970000-0000-4000-8000-000000000101','/e/i3197host/launch-night'),
  ('event','31970000-0000-4000-8000-000000000102','/e/i3197host/garden-rsvp'),
  ('trip','31970000-0000-4000-8000-000000000103','/t/i3197host/coast-trip'),
  ('experience','31970000-0000-4000-8000-000000000104','/exp/i3197host/studio-session'),
  ('venue','31970000-0000-4000-8000-000000000302','/b/i3197host/v/rooftop');

-- H1: before any reconcile, every page is public_noindex and unlisted, and
-- the verdict function already says all six qualify, with a checklist the
-- #2986 validator accepts.
DO $h1$
DECLARE r record; v jsonb; d jsonb;
BEGIN
  FOR r IN SELECT * FROM t3197_ids ORDER BY path LOOP
    IF EXISTS (SELECT 1 FROM public.public_search_documents WHERE entity_id=r.id OR canonical_path=r.path) THEN
      RAISE EXCEPTION 'ISSUE-3197 H1 FAIL: % already has a search row before any reconcile',r.path;
    END IF;
    v := pg_temp.t3197_anon(r.path);
    IF v->>'state'<>'public_noindex' OR v->'facts'->>'id' IS DISTINCT FROM r.id::text THEN
      RAISE EXCEPTION 'ISSUE-3197 H1 FAIL: % did not start public_noindex: %',r.path,v;
    END IF;
    IF pg_temp.t3197_in_sitemap(r.path) THEN
      RAISE EXCEPTION 'ISSUE-3197 H1 FAIL: % is in the sitemap before promotion',r.path;
    END IF;
    d := public.issue_3197_public_search_decide(r.kind,r.id);
    IF (d->>'eligible')::boolean IS NOT TRUE OR d->>'path'<>r.path OR (d->>'pathValid')::boolean IS NOT TRUE
       OR jsonb_array_length(d->'blockers')<>0 THEN
      RAISE EXCEPTION 'ISSUE-3197 H1 FAIL: % should qualify: %',r.path,d;
    END IF;
    IF NOT public.public_search_validation_complete(r.kind,d->'checks') THEN
      RAISE EXCEPTION 'ISSUE-3197 H1 FAIL: the policy checklist for % does not satisfy #2986: %',r.kind,d->'checks';
    END IF;
  END LOOP;
END
$h1$;

-- H2: ONE reconcile call promotes every kind. Each row carries the policy
-- source and a reason saying the checklist was asserted by policy, the full
-- checklist, a 48-hour review window and no test flag. The anonymous resolver
-- serves search_ready with integrity, and the sitemap lists every path.
DO $h2$
DECLARE r record; v jsonb; s jsonb; doc public.public_search_documents%ROWTYPE;
BEGIN
  s := pg_temp.t3197_reconcile();
  IF s ? 'skipped' THEN RAISE EXCEPTION 'ISSUE-3197 H2 FAIL: reconcile skipped: %',s; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(s->'errors') e, t3197_ids i
              WHERE e->>'entityId'=i.id::text OR e->>'path'=i.path) THEN
    RAISE EXCEPTION 'ISSUE-3197 H2 FAIL: reconcile reported an error for a fixture: %',s->'errors';
  END IF;
  FOR r IN SELECT * FROM t3197_ids ORDER BY path LOOP
    SELECT * INTO doc FROM public.public_search_documents WHERE canonical_path=r.path;
    IF NOT FOUND THEN RAISE EXCEPTION 'ISSUE-3197 H2 FAIL: % was not promoted; summary %',r.path,s; END IF;
    IF doc.lifecycle_state<>'search_ready' OR doc.entity_id<>r.id OR doc.entity_kind<>r.kind
       OR doc.change_source<>'issue_3197_auto_policy'
       OR position('asserted true by product policy (Seth, 2026-09-12, #3197), not individually verified' IN doc.change_reason)=0
       OR doc.validation_checks<>public.issue_3197_public_search_policy_checks(r.kind)
       OR doc.is_test_record OR doc.updated_by IS NOT NULL OR doc.redirect_target_path IS NOT NULL
       OR doc.verified_at IS NULL OR doc.search_ready_at IS NULL
       OR doc.review_due_at<>now()+interval '48 hours' THEN
      RAISE EXCEPTION 'ISSUE-3197 H2 FAIL: % row is not the policy row: %',r.path,to_jsonb(doc);
    END IF;
    v := pg_temp.t3197_anon(r.path);
    IF v->>'state'<>'search_ready' OR (v->>'integrityOk')::boolean IS NOT TRUE OR v->'facts'->>'id'<>r.id::text THEN
      RAISE EXCEPTION 'ISSUE-3197 H2 FAIL: % does not resolve search_ready for anon: %',r.path,v;
    END IF;
    IF NOT pg_temp.t3197_in_sitemap(r.path) THEN
      RAISE EXCEPTION 'ISSUE-3197 H2 FAIL: % is missing from the sitemap',r.path;
    END IF;
    IF (SELECT count(*) FROM public.public_search_document_audit a
         WHERE a.document_id=doc.id AND a.operation='INSERT' AND a.change_source='issue_3197_auto_policy')<>1 THEN
      RAISE EXCEPTION 'ISSUE-3197 H2 FAIL: % promotion is not audited exactly once',r.path;
    END IF;
  END LOOP;
  IF (s->>'promoted')::int < 6 THEN
    RAISE EXCEPTION 'ISSUE-3197 H2 FAIL: summary promoted % (< the 6 fixtures): %',s->>'promoted',s;
  END IF;
END
$h2$;

-- H2b: IndexNow (#3176). Promotion reaches the crawler queue: every promoted
-- page has exactly one pending `updated` URL, queued by the #3176 trigger on
-- the row the reconciler wrote.
DO $h2b$
DECLARE r record;
BEGIN
  IF to_regclass('public.search_indexnow_outbox') IS NULL THEN
    RAISE EXCEPTION 'ISSUE-3197 H2b FAIL: the #3176 IndexNow outbox is missing from the full-chain schema';
  END IF;
  FOR r IN SELECT * FROM t3197_ids ORDER BY path LOOP
    IF (SELECT count(*) FROM public.search_indexnow_outbox o
         WHERE o.canonical_url='https://host.usemingla.com'||r.path
           AND o.operation='updated' AND o.delivery_state='pending' AND o.entity_kind=r.kind)<>1 THEN
      RAISE EXCEPTION 'ISSUE-3197 H2b FAIL: promoted % did not queue exactly one IndexNow update',r.path;
    END IF;
  END LOOP;
END
$h2b$;

CREATE TEMP TABLE t3197_audit_mark AS
  SELECT (SELECT COALESCE(max(a.id),0) FROM public.public_search_document_audit a) AS last_id;

-- H3: a second call is idempotent for unchanged pages — zero audit rows.
DO $h3$
DECLARE s jsonb;
BEGIN
  s := pg_temp.t3197_reconcile();
  IF EXISTS (SELECT 1 FROM public.public_search_document_audit a
              JOIN public.public_search_documents d ON d.id=a.document_id
              JOIN t3197_ids i ON i.id=d.entity_id
             WHERE a.id>(SELECT last_id FROM t3197_audit_mark)) THEN
    RAISE EXCEPTION 'ISSUE-3197 H3 FAIL: an unchanged page was rewritten on the second call';
  END IF;
  IF (s->>'unchanged')::int < 6 THEN
    RAISE EXCEPTION 'ISSUE-3197 H3 FAIL: summary unchanged % (< 6): %',s->>'unchanged',s;
  END IF;
END
$h3$;

-- H4: convergence. Right after a reconcile, the monitor finds no divergence
-- and does not raise; the fixtures are counted as indexed, not settling.
DO $h4$
DECLARE v jsonb; d jsonb;
BEGIN
  PERFORM pg_temp.t3197_reconcile();
  d := public.issue_3197_public_search_divergence();
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(d->'divergences') x, t3197_ids i
              WHERE x->>'entityId'=i.id::text OR x->>'path'=i.path) THEN
    RAISE EXCEPTION 'ISSUE-3197 H4 FAIL: a promoted fixture is reported divergent: %',d;
  END IF;
  IF (d->>'indexed')::int < 6 OR (d->>'eligible')::int < 6 THEN
    RAISE EXCEPTION 'ISSUE-3197 H4 FAIL: divergence denominator does not count the fixtures: %',d;
  END IF;
  v := public.issue_3197_assert_public_search_converged(interval '0', NULL);
  IF (v->>'converged')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'ISSUE-3197 H4 FAIL: converged did not report convergence: %',v;
  END IF;
END
$h4$;

-- H5: checkout churn. A ticket tier write moves the event's source token; the
-- resolver immediately serves stale (noindex, out of the sitemap). One call
-- re-indexes it under the NEW token and audits why.
DO $h5$
DECLARE v jsonb; v_token timestamptz; doc public.public_search_documents%ROWTYPE; v_mark bigint;
BEGIN
  SELECT COALESCE(max(id),0) INTO v_mark FROM public.public_search_document_audit;
  -- Model an independently committed write without relying on this rollback
  -- transaction's frozen now(): the touch trigger would stamp now() again.
  EXECUTE 'ALTER TABLE public.ticket_types DISABLE TRIGGER trg_ticket_types_updated_at';
  UPDATE public.ticket_types SET updated_at=clock_timestamp() WHERE id='31970000-0000-4000-8000-000000000401';
  EXECUTE 'ALTER TABLE public.ticket_types ENABLE TRIGGER trg_ticket_types_updated_at';

  v := pg_temp.t3197_anon('/e/i3197host/launch-night');
  IF v->>'state'<>'stale' THEN
    RAISE EXCEPTION 'ISSUE-3197 H5 FAIL: a moved source token did not make the page stale: %',v;
  END IF;
  IF pg_temp.t3197_in_sitemap('/e/i3197host/launch-night') THEN
    RAISE EXCEPTION 'ISSUE-3197 H5 FAIL: a stale page stayed in the sitemap';
  END IF;

  PERFORM pg_temp.t3197_reconcile();
  v_token := (public.public_search_source_facts('/e/i3197host/launch-night','event')->'facts'->>'sourceUpdatedAt')::timestamptz;
  SELECT * INTO doc FROM public.public_search_documents WHERE canonical_path='/e/i3197host/launch-night';
  IF doc.lifecycle_state<>'search_ready' OR doc.source_updated_at<>v_token THEN
    RAISE EXCEPTION 'ISSUE-3197 H5 FAIL: the page was not re-indexed under the new token: %',to_jsonb(doc);
  END IF;
  IF (pg_temp.t3197_anon('/e/i3197host/launch-night'))->>'state'<>'search_ready'
     OR NOT pg_temp.t3197_in_sitemap('/e/i3197host/launch-night') THEN
    RAISE EXCEPTION 'ISSUE-3197 H5 FAIL: the re-indexed page is not served search_ready';
  END IF;
  IF (SELECT count(*) FROM public.public_search_document_audit a
       WHERE a.id>v_mark AND a.document_id=doc.id AND a.operation='UPDATE'
         AND a.change_source='issue_3197_auto_policy'
         AND position('(source_changed)' IN a.change_reason)>0)<>1 THEN
    RAISE EXCEPTION 'ISSUE-3197 H5 FAIL: the re-index is not audited once with reason source_changed';
  END IF;
END
$h5$;

-- H6: the dead-man window. A row with fewer than 24 hours left is refreshed to
-- a fresh 48 hours; a row with more is left alone.
DO $h6$
DECLARE doc public.public_search_documents%ROWTYPE; v_mark bigint;
BEGIN
  UPDATE public.public_search_documents SET review_due_at=now()+interval '23 hours'
   WHERE canonical_path='/b/i3197host/v/rooftop';
  UPDATE public.public_search_documents SET review_due_at=now()+interval '30 hours'
   WHERE canonical_path='/t/i3197host/coast-trip';
  SELECT COALESCE(max(id),0) INTO v_mark FROM public.public_search_document_audit;
  PERFORM pg_temp.t3197_reconcile();

  SELECT * INTO doc FROM public.public_search_documents WHERE canonical_path='/b/i3197host/v/rooftop';
  IF doc.review_due_at<>now()+interval '48 hours' OR position('(review_refresh)' IN doc.change_reason)=0 THEN
    RAISE EXCEPTION 'ISSUE-3197 H6 FAIL: a row with 23h left was not refreshed: %',to_jsonb(doc);
  END IF;
  SELECT * INTO doc FROM public.public_search_documents WHERE canonical_path='/t/i3197host/coast-trip';
  IF doc.review_due_at<>now()+interval '30 hours' THEN
    RAISE EXCEPTION 'ISSUE-3197 H6 FAIL: a row with 30h left was rewritten: %',to_jsonb(doc);
  END IF;
  IF EXISTS (SELECT 1 FROM public.public_search_document_audit a
              WHERE a.id>v_mark AND a.document_id=doc.id) THEN
    RAISE EXCEPTION 'ISSUE-3197 H6 FAIL: the 30h row gained an audit entry';
  END IF;
END
$h6$;

-- H7: demotion when a page stops qualifying — unlisted, private, deleted,
-- unpublished and an unverified venue — and then the brand, whose last
-- indexable offering is gone. Each demotion is one audited public_noindex
-- write naming the blocker, immediately followed by DELETE; no row survives,
-- the resolver no longer serves search_ready and the sitemap drops the path.
DO $h7$
DECLARE r record; v jsonb; v_doc uuid; v_ops text[]; v_last jsonb;
BEGIN
  CREATE TEMP TABLE t3197_doc_ids ON COMMIT DROP AS
    SELECT i.path, d.id AS doc_id FROM t3197_ids i JOIN public.public_search_documents d ON d.canonical_path=i.path;

  UPDATE public.events SET visibility='hidden' WHERE id='31970000-0000-4000-8000-000000000101';
  UPDATE public.events SET visibility='private' WHERE id='31970000-0000-4000-8000-000000000102';
  UPDATE public.events SET deleted_at=now() WHERE id='31970000-0000-4000-8000-000000000103';
  UPDATE public.events SET status='draft' WHERE id='31970000-0000-4000-8000-000000000104';
  UPDATE public.venue_listings SET claim_status='suspended' WHERE id='31970000-0000-4000-8000-000000000302';

  PERFORM pg_temp.t3197_reconcile();

  FOR r IN
    SELECT i.*, x.doc_id,
           CASE i.kind WHEN 'brand' THEN 'no_qualified_inventory' ELSE NULL END AS must_name
      FROM t3197_ids i JOIN t3197_doc_ids x ON x.path=i.path
     ORDER BY i.path
  LOOP
    IF EXISTS (SELECT 1 FROM public.public_search_documents WHERE id=r.doc_id OR entity_id=r.id) THEN
      RAISE EXCEPTION 'ISSUE-3197 H7 FAIL: % still has a search row after it stopped qualifying',r.path;
    END IF;
    SELECT array_agg(a.operation ORDER BY a.id), (array_agg(a.after_row ORDER BY a.id DESC) FILTER (WHERE a.operation='UPDATE'))[1]
      INTO v_ops, v_last
      FROM public.public_search_document_audit a WHERE a.document_id=r.doc_id;
    IF v_ops[array_length(v_ops,1)]<>'DELETE' OR v_ops[array_length(v_ops,1)-1]<>'UPDATE'
       OR v_last->>'lifecycle_state'<>'public_noindex'
       OR v_last->>'change_source'<>'issue_3197_auto_policy'
       OR position('Removed from search by the #3197 auto policy' IN v_last->>'change_reason')=0
       OR (r.must_name IS NOT NULL AND position(r.must_name IN v_last->>'change_reason')=0) THEN
      RAISE EXCEPTION 'ISSUE-3197 H7 FAIL: % demotion is not an audited public_noindex write then DELETE: ops %, last %',r.path,v_ops,v_last;
    END IF;
    v := pg_temp.t3197_anon(r.path);
    IF v->>'state' NOT IN ('draft','public_noindex') THEN
      RAISE EXCEPTION 'ISSUE-3197 H7 FAIL: demoted % resolves %',r.path,v;
    END IF;
    IF pg_temp.t3197_in_sitemap(r.path) THEN
      RAISE EXCEPTION 'ISSUE-3197 H7 FAIL: demoted % is still in the sitemap',r.path;
    END IF;
    -- IndexNow (#3176): the demotion queues a `deleted` URL for the page.
    IF NOT EXISTS (SELECT 1 FROM public.search_indexnow_outbox o
                    WHERE o.canonical_url='https://host.usemingla.com'||r.path
                      AND o.operation='deleted' AND o.delivery_state='pending') THEN
      RAISE EXCEPTION 'ISSUE-3197 H7 FAIL: demoted % did not queue an IndexNow deletion',r.path;
    END IF;
  END LOOP;
  -- The brand page itself is still visible; it is simply no longer indexable.
  IF (pg_temp.t3197_anon('/b/i3197host'))->>'state'<>'public_noindex' THEN
    RAISE EXCEPTION 'ISSUE-3197 H7 FAIL: the brand with no indexable offering should be public_noindex';
  END IF;
  IF NOT (public.issue_3197_public_search_decide('brand','31970000-0000-4000-8000-000000000010')->'blockers') ? 'no_qualified_inventory' THEN
    RAISE EXCEPTION 'ISSUE-3197 H7 FAIL: the brand verdict does not name no_qualified_inventory';
  END IF;
END
$h7$;

-- H8: re-publishing brings everything back on the next call — the reconciler
-- never left a lasting draft/stale/gone row that would 404 or 410 the page.
DO $h8$
DECLARE r record; v jsonb;
BEGIN
  UPDATE public.events SET visibility='public' WHERE id='31970000-0000-4000-8000-000000000101';
  UPDATE public.venue_listings SET claim_status='verified' WHERE id='31970000-0000-4000-8000-000000000302';
  PERFORM pg_temp.t3197_reconcile();
  FOR r IN SELECT * FROM t3197_ids WHERE id IN (
      '31970000-0000-4000-8000-000000000010','31970000-0000-4000-8000-000000000101','31970000-0000-4000-8000-000000000302') LOOP
    v := pg_temp.t3197_anon(r.path);
    IF v->>'state'<>'search_ready' OR NOT pg_temp.t3197_in_sitemap(r.path) THEN
      RAISE EXCEPTION 'ISSUE-3197 H8 FAIL: re-published % did not come back on the next call: %',r.path,v;
    END IF;
  END LOOP;
END
$h8$;

-- H9: the callers and the posture. Both cron jobs exist exactly once with their
-- literal commands, every function is a postgres-owned definer with a pinned
-- search_path, none is executable by anon or authenticated, and the table
-- comment records the policy change.
DO $h9$
DECLARE v_fn text;
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname='issue_3197_public_search_reconcile' AND active
        AND schedule='* * * * *' AND command='SELECT public.issue_3197_reconcile_public_search();')<>1 THEN
    RAISE EXCEPTION 'ISSUE-3197 H9 FAIL: the reconcile job is not scheduled every minute with its literal command';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname='issue_3197_public_search_converged' AND active
        AND schedule='*/10 * * * *' AND command='SELECT public.issue_3197_assert_public_search_converged();')<>1 THEN
    RAISE EXCEPTION 'ISSUE-3197 H9 FAIL: the convergence job is not scheduled with its literal command';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.issue_3197_public_search_decide(text,uuid)',
    'public.issue_3197_reconcile_public_search()',
    'public.issue_3197_public_search_divergence()',
    'public.issue_3197_assert_public_search_converged(interval,interval)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=v_fn::regprocedure AND p.prosecdef
                     AND pg_get_userbyid(p.proowner)='postgres'
                     AND array_to_string(p.proconfig,',')='search_path=public, pg_temp') THEN
      RAISE EXCEPTION 'ISSUE-3197 H9 FAIL: % posture drifted',v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.issue_3197_public_search_policy_checks(text)',
    'public.issue_3197_public_search_decide(text,uuid)',
    'public.issue_3197_reconcile_public_search()',
    'public.issue_3197_public_search_divergence()',
    'public.issue_3197_assert_public_search_converged(interval,interval)'] LOOP
    IF has_function_privilege('anon',v_fn,'EXECUTE') OR has_function_privilege('authenticated',v_fn,'EXECUTE') THEN
      RAISE EXCEPTION 'ISSUE-3197 H9 FAIL: % is executable by anon or authenticated',v_fn;
    END IF;
  END LOOP;
  IF position('POLICY CHANGED by #3197' IN obj_description('public.public_search_documents'::regclass,'pg_class'))=0 THEN
    RAISE EXCEPTION 'ISSUE-3197 H9 FAIL: the overlay table comment still describes the #2986 review model';
  END IF;
END
$h9$;

SELECT 'ISSUE-3197 implementor happy suite PASS' AS result;

ROLLBACK;
