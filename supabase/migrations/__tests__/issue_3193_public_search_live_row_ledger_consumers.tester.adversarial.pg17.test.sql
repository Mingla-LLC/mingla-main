-- Issue #3193 TESTER adversarial contract (PostgreSQL 17).
--
-- WRITTEN BY THE TESTER (mingla-tester), not the implementor. The two suites
-- already registered for #3193 were both written by the implementor, including
-- the one named `tester.adversarial`. This file is the independent CLOSE-gate
-- test, and it attacks a different surface on purpose.
--
-- THE ANGLE. Both implementor suites ask one reader -- the anonymous resolver --
-- for one pair of states: `draft` or `public_noindex` (plus `gone` for the
-- fence). But `public.public_search_source_facts` has FOUR other consumers in
-- #2986, and none of them had ever been run against a slug with a
-- soft-deleted twin:
--   1. the promotion write path: `upsert_public_search_document` derives the
--      source version from it, and `tg_validate_public_search_document`
--      refuses `search_ready` unless its `facts.id` equals the promoted entity;
--   2. the redirect-target check in that same trigger, which refuses a
--      redirect whose target does not read `visible`;
--   3. the resolver's `search_ready` / `stale` / integrity branch, which
--      compares the ledger row's `entity_id` with `facts.id`;
--   4. `list_public_search_sitemap()`, the only enumerable public reader.
-- If any row selection reads a tombstone, a correctly verified live page
-- cannot be promoted, cannot be a redirect target, and silently drops out of
-- the sitemap. Those assertions fail when #3193 is reverted.
--
-- The other half is security: the editorial ledger must never let a
-- tombstone's approval transfer to its live heir (a different tenant, here),
-- a private or unlisted live event must never become promotable or enumerable
-- because its path once belonged to a public event, a live brand under a
-- closed account must stay dark, case variants must not reach anything, and a
-- tie between two LIVE rows (only possible with the unique index gone) must
-- still resolve to one deterministic row.
--
-- Plan sweeps: five planner configurations, as in the implementor suites, but
-- every forced configuration also sets `plan_cache_mode = force_custom_plan`.
-- PL/pgSQL caches the plans of the statements inside the resolver; once a
-- generic plan is cached, a later `SET enable_*` does not re-plan it, so a
-- sweep without this can re-run one cached plan five times.
--
-- One transaction + ROLLBACK: no fixture survives. The one DDL statement (T-10
-- drops `idx_brands_slug_active`) runs inside a SAVEPOINT that is rolled back
-- and then asserted restored.

\set ON_ERROR_STOP on
BEGIN;

-- -----------------------------------------------------------------------------
-- Harness
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE t3193_start AS
  SELECT md5(pg_get_functiondef('public.public_search_source_facts(text,text)'::regprocedure)) AS def_md5;

CREATE FUNCTION pg_temp.t3193_plan(p_cfg text) RETURNS void LANGUAGE plpgsql AS $cfg$
BEGIN
  IF p_cfg='planner-default' THEN
    RESET enable_indexscan; RESET enable_bitmapscan; RESET enable_indexonlyscan;
    RESET enable_seqscan; RESET enable_hashjoin; RESET enable_mergejoin; RESET plan_cache_mode;
    RETURN;
  END IF;
  SET LOCAL plan_cache_mode=force_custom_plan;
  IF p_cfg='seq-nestloop' THEN
    SET LOCAL enable_indexscan=off; SET LOCAL enable_bitmapscan=off; SET LOCAL enable_indexonlyscan=off;
    SET LOCAL enable_seqscan=on; SET LOCAL enable_hashjoin=off; SET LOCAL enable_mergejoin=off;
  ELSIF p_cfg='seq-hash' THEN
    SET LOCAL enable_indexscan=off; SET LOCAL enable_bitmapscan=off; SET LOCAL enable_indexonlyscan=off;
    SET LOCAL enable_seqscan=on; SET LOCAL enable_hashjoin=on; SET LOCAL enable_mergejoin=off;
  ELSIF p_cfg='seq-merge' THEN
    SET LOCAL enable_indexscan=off; SET LOCAL enable_bitmapscan=off; SET LOCAL enable_indexonlyscan=off;
    SET LOCAL enable_seqscan=on; SET LOCAL enable_hashjoin=off; SET LOCAL enable_mergejoin=on;
  ELSIF p_cfg='index-scans' THEN
    SET LOCAL enable_indexscan=on; SET LOCAL enable_bitmapscan=on; SET LOCAL enable_indexonlyscan=on;
    SET LOCAL enable_seqscan=off; SET LOCAL enable_hashjoin=on; SET LOCAL enable_mergejoin=on;
  ELSE
    RAISE EXCEPTION 'ISSUE-3193-TESTER unknown plan configuration %',p_cfg;
  END IF;
END
$cfg$;

CREATE FUNCTION pg_temp.t3193_cfgs() RETURNS text[] LANGUAGE sql IMMUTABLE AS
$$ SELECT ARRAY['seq-nestloop','seq-hash','seq-merge','index-scans','planner-default'] $$;

-- The anonymous resolver, exactly as the Host server calls it.
CREATE FUNCTION pg_temp.t3193_anon(p_path text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v jsonb;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO v USING p_path;
  RESET ROLE;
  RETURN v;
END
$f$;

-- The sitemap, as anon, as {path: last_modified}.
CREATE FUNCTION pg_temp.t3193_sitemap() RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v jsonb;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  EXECUTE 'SELECT COALESCE(jsonb_object_agg(canonical_path,last_modified),''{}''::jsonb)
             FROM public.list_public_search_sitemap()' INTO v;
  RESET ROLE;
  RETURN v;
END
$f$;

-- Source facts, as service_role (the only role holding EXECUTE).
CREATE FUNCTION pg_temp.t3193_source(p_path text, p_kind text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  v := public.public_search_source_facts(p_path,p_kind);
  RESET ROLE;
  RETURN v;
END
$f$;

-- Every validation key #2986 requires for a kind.
CREATE FUNCTION pg_temp.t3193_checks(p_kind text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT '{"facts_verified":true,"canonical_verified":true,"visible_html_verified":true,"metadata_verified":true,"schema_verified":true,"image_rights_verified":true,"action_verified":true}'::jsonb
    || CASE p_kind
         WHEN 'event' THEN '{"schedule_verified":true,"location_verified":true,"organizer_verified":true,"price_or_free_verified":true,"privacy_moderation_verified":true}'::jsonb
         WHEN 'brand' THEN '{"identity_verified":true,"inventory_verified":true,"ownership_source_verified":true,"action_or_inventory_verified":true}'::jsonb
         WHEN 'venue' THEN '{"identity_verified":true,"location_verified":true,"contact_hours_verified_when_shown":true,"offering_context_verified":true,"address_privacy_verified":true}'::jsonb
         ELSE '{}'::jsonb END
$f$;

-- The real admin/service write path. Returns the receipt, or {"refused": SQLERRM}.
CREATE FUNCTION pg_temp.t3193_write(p_kind text, p_id uuid, p_path text, p_state text,
  p_target text, p_source_at timestamptz) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v jsonb;
BEGIN
  BEGIN
    SET LOCAL ROLE service_role;
    PERFORM set_config('request.jwt.claim.role','service_role',true);
    v := public.upsert_public_search_document(
      p_kind,p_id,p_path,p_state,p_target,
      CASE WHEN p_state='search_ready' THEN pg_temp.t3193_checks(p_kind) ELSE '{}'::jsonb END,
      p_source_at,now(),CASE WHEN p_state='search_ready' THEN now()+interval '30 day' END,
      'Issue 3193 tester ledger-consumer fixture','issue_3193_pg_tester',false);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RETURN jsonb_build_object('refused',SQLERRM);
  END;
  RETURN v;
END
$f$;

-- Accounts. The tombstones' owner is inserted FIRST and has the SMALLEST id,
-- and every tombstone below has a smaller id than its live twin. That puts the
-- tombstone first in heap order, in pkey order, in merge-join order and in the
-- hash-probe order, so the pre-#3193 unordered `LIMIT 1` reads it under as
-- many plans as possible (T-0 measures how many) -- the revert signal is not
-- left to one lucky plan.
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) VALUES
  ('31932000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t3193-tomb-owner@example.test','x',now(),now()),
  ('31932000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t3193-live-owner@example.test','x',now(),now()),
  ('31932000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t3193-closed-owner@example.test','x',now(),now());
INSERT INTO public.creator_accounts(id,deleted_at) VALUES
  ('31932000-0000-4000-8000-000000000001',NULL),
  ('31932000-0000-4000-8000-000000000002',NULL),
  ('31932000-0000-4000-8000-000000000003',now()-interval '1 day');

-- -----------------------------------------------------------------------------
-- Fixture P -- `t3193promo`: a host deleted a brand and a different account
-- recreated it under the same slug. The tombstone (account A) still owns an
-- ENDED public event `meet` dated in the past and a verified venue `roof`. The
-- live brand (account B) owns a fully publishable RSVP `meet` and a verified
-- venue `roof`, and is itself fully publishable. All three live pages are what
-- an administrator would legitimately promote to `search_ready`.
-- Tombstones are made the only way production allows: brand live, children
-- created, event already ended, THEN the brand soft-deleted.
-- -----------------------------------------------------------------------------
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,
  cover_media_url,cover_media_type,created_at,updated_at) VALUES
  ('31932000-0000-4000-8000-000000000100','31932000-0000-4000-8000-000000000001','T3193 Promo Old','t3193promo',
   'The brand before its host deleted it. Nothing here may decide the live page.','popup','none','USD','usd',
   'https://images.example.test/t3193-old.jpg','image',now()-interval '5 hour',now()-interval '5 hour');
INSERT INTO public.events(id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,is_online,city,
  cover_media_url,cover_media_type,theme,published_at) VALUES
  ('31932000-0000-4000-8000-000000001100','31932000-0000-4000-8000-000000000100','31932000-0000-4000-8000-000000000001',
   'T3193 Old Meet','An ended public meet under the deleted brand, dated in the past for a real reason.','meet','event','public','ended',
   'UTC',false,'Lagos','https://images.example.test/t3193-old-meet.jpg','image','{}',now());
INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone) VALUES
  ('31932000-0000-4000-8000-000000001100',now()-interval '20 day',now()-interval '20 day'+interval '2 hour',true,'UTC');
INSERT INTO public.venue_listings(id,brand_id,slug,name,city,country_code,lat,lng,venue_category,claim_status,
  cover_media_url,cover_media_type,created_at) VALUES
  ('31932000-0000-4000-8000-000000001500','31932000-0000-4000-8000-000000000100','roof','T3193 Old Roof','Lagos','NG',6.45,3.39,
   'restaurant','verified','https://images.example.test/t3193-old-roof.jpg','image',now()-interval '5 hour');
UPDATE public.brands SET deleted_at=now()-interval '4 hour' WHERE id='31932000-0000-4000-8000-000000000100';

INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,
  cover_media_url,cover_media_type,created_at,updated_at) VALUES
  ('31932000-0000-4000-8000-000000000200','31932000-0000-4000-8000-000000000002','T3193 Promo Live','t3193promo',
   'The recreated live brand, with a real public description that explorers can actually use.','popup','none','USD','usd',
   'https://images.example.test/t3193-live.jpg','image',now()-interval '1 hour',now()-interval '1 hour');
INSERT INTO public.events(id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,is_online,city,
  cover_media_url,cover_media_type,theme,published_at) VALUES
  ('31932000-0000-4000-8000-000000001200','31932000-0000-4000-8000-000000000200','31932000-0000-4000-8000-000000000002',
   'T3193 Live Meet','A live public RSVP meet with enough real detail to be worth promoting to search.','meet','rsvp','public','scheduled',
   'UTC',false,'Lagos','https://images.example.test/t3193-live-meet.jpg','image','{}',now());
INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone) VALUES
  ('31932000-0000-4000-8000-000000001200',now()+interval '20 day',now()+interval '20 day 2 hour',true,'UTC');
INSERT INTO public.venue_listings(id,brand_id,slug,name,city,country_code,lat,lng,venue_category,claim_status,
  cover_media_url,cover_media_type,created_at) VALUES
  ('31932000-0000-4000-8000-000000001600','31932000-0000-4000-8000-000000000200','roof','T3193 Live Roof','Lagos','NG',6.45,3.39,
   'restaurant','verified','https://images.example.test/t3193-live-roof.jpg','image',now()-interval '1 hour');

CREATE TEMP TABLE t3193_promo(kind text PRIMARY KEY, path text NOT NULL, live_id uuid NOT NULL, tomb_id uuid NOT NULL);
INSERT INTO t3193_promo VALUES
  ('brand','/b/t3193promo',       '31932000-0000-4000-8000-000000000200','31932000-0000-4000-8000-000000000100'),
  ('event','/e/t3193promo/meet',  '31932000-0000-4000-8000-000000001200','31932000-0000-4000-8000-000000001100'),
  ('venue','/b/t3193promo/v/roof','31932000-0000-4000-8000-000000001600','31932000-0000-4000-8000-000000001500');

-- T-0: anti-vacuity. The fixture must really reproduce the defect shape, or
-- every later assertion would pass on a reverted resolver for free:
--   brand: the pre-#3193 unordered selection reads the tombstone under at least
--          the planner's default configuration (the one production runs);
--   event: the pre-#3193 `ORDER BY ed.start_at NULLS LAST` reads the
--          tombstone's past-dated event under EVERY configuration.
-- Measured with dynamic SQL, which is planned fresh on every EXECUTE.
DO $t0$
DECLARE cfg text; v_id uuid; v_brand_tomb int := 0; v_brand_default uuid; v_event_tomb int := 0;
BEGIN
  FOREACH cfg IN ARRAY pg_temp.t3193_cfgs() LOOP
    PERFORM pg_temp.t3193_plan(cfg);
    EXECUTE $q$SELECT b.id FROM public.brands b JOIN public.creator_accounts ca ON ca.id=b.account_id
               WHERE b.slug='t3193promo' LIMIT 1$q$ INTO v_id;
    IF v_id='31932000-0000-4000-8000-000000000100' THEN v_brand_tomb := v_brand_tomb+1; END IF;
    IF cfg='planner-default' THEN v_brand_default := v_id; END IF;
    EXECUTE $q$SELECT e.id FROM public.brands b JOIN public.creator_accounts ca ON ca.id=b.account_id
               LEFT JOIN public.events e ON e.brand_id=b.id AND e.slug='meet'
               LEFT JOIN public.event_dates ed ON ed.event_id=e.id AND ed.is_master
               WHERE b.slug='t3193promo' ORDER BY ed.start_at NULLS LAST LIMIT 1$q$ INTO v_id;
    IF v_id='31932000-0000-4000-8000-000000001100' THEN v_event_tomb := v_event_tomb+1; END IF;
  END LOOP;
  PERFORM pg_temp.t3193_plan('planner-default');
  RAISE NOTICE 'ISSUE-3193-TESTER T-0: pre-fix brand selection read the tombstone under %/5 plans (default: %); pre-fix event selection under %/5',
    v_brand_tomb, CASE WHEN v_brand_default='31932000-0000-4000-8000-000000000100' THEN 'tombstone' ELSE 'live' END, v_event_tomb;
  IF v_brand_default IS DISTINCT FROM '31932000-0000-4000-8000-000000000100' THEN
    RAISE EXCEPTION 'ISSUE-3193-TESTER T-0 FAIL: the planner default no longer reads the tombstone with the pre-fix brand selection, so this fixture cannot fail on revert';
  END IF;
  IF v_event_tomb<>5 THEN
    RAISE EXCEPTION 'ISSUE-3193-TESTER T-0 FAIL: the pre-fix event order read the tombstone under only %/5 plans',v_event_tomb;
  END IF;
END
$t0$;

-- T-1: consumer zero -- the source facts every other consumer reads. For all
-- three live pages, under every plan, `facts.id` is the LIVE entity and the
-- tombstone's id appears nowhere in the document.
DO $t1$
DECLARE r record; cfg text; v jsonb;
BEGIN
  FOR r IN SELECT * FROM t3193_promo ORDER BY kind LOOP
    FOREACH cfg IN ARRAY pg_temp.t3193_cfgs() LOOP
      PERFORM pg_temp.t3193_plan(cfg);
      v := pg_temp.t3193_source(r.path,r.kind);
      IF v->>'sourceState'<>'visible' OR v->'facts'->>'id' IS DISTINCT FROM r.live_id::text THEN
        RAISE EXCEPTION 'ISSUE-3193-TESTER T-1 FAIL: % source facts under plan % did not read the live entity: %',r.path,cfg,v;
      END IF;
      IF position(r.tomb_id::text IN v::text)>0 THEN
        RAISE EXCEPTION 'ISSUE-3193-TESTER T-1 FAIL: % source facts carry the tombstone id: %',r.path,v;
      END IF;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.t3193_plan('planner-default');
END
$t1$;

-- T-2: consumer 1 -- PROMOTION. An administrator promotes each live page to
-- `search_ready` through the real RPC, under every plan. The validation
-- trigger re-reads the source and refuses unless `facts.id` equals the entity
-- being promoted, so a resolver that reads a tombstone makes a correctly
-- verified live page UNPROMOTABLE. Every write must be accepted, and every
-- receipt must bind the LIVE entity.
DO $t2$
DECLARE r record; cfg text; v jsonb; v_at timestamptz;
BEGIN
  FOR r IN SELECT * FROM t3193_promo ORDER BY kind LOOP
    FOREACH cfg IN ARRAY pg_temp.t3193_cfgs() LOOP
      PERFORM pg_temp.t3193_plan(cfg);
      v_at := (pg_temp.t3193_source(r.path,r.kind)->'facts'->>'sourceUpdatedAt')::timestamptz;
      v := pg_temp.t3193_write(r.kind,r.live_id,r.path,'search_ready',NULL,v_at);
      IF v ? 'refused' THEN
        RAISE EXCEPTION 'ISSUE-3193-TESTER T-2 FAIL: promoting the live % page % was refused under plan %: %',r.kind,r.path,cfg,v->>'refused';
      END IF;
      IF v->>'lifecycle_state'<>'search_ready' OR v->>'entity_id'<>r.live_id::text OR v->>'search_ready_at' IS NULL THEN
        RAISE EXCEPTION 'ISSUE-3193-TESTER T-2 FAIL: % promotion receipt is wrong under plan %: %',r.path,cfg,v;
      END IF;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.t3193_plan('planner-default');
  -- Promoting the TOMBSTONE's entity at the same path must be refused: the
  -- ledger cannot be pointed at a dead row while a live one owns the path.
  FOR r IN SELECT * FROM t3193_promo ORDER BY kind LOOP
    v := pg_temp.t3193_write(r.kind,r.tomb_id,r.path,'search_ready',NULL,
           (pg_temp.t3193_source(r.path,r.kind)->'facts'->>'sourceUpdatedAt')::timestamptz);
    IF NOT (v ? 'refused') THEN
      RAISE EXCEPTION 'ISSUE-3193-TESTER T-2 FAIL: the tombstone % was promoted at the live path %: %',r.tomb_id,r.path,v;
    END IF;
  END LOOP;
END
$t2$;

-- T-3: consumer 3 -- the resolver's search_ready / integrity branch. Every
-- promoted live page resolves `search_ready` with `integrityOk` true and the
-- live entity's facts, under every plan, as ONE identical document per path.
-- (A tombstone read here returns `draft`; a live read of the wrong entity would
-- return `dependency_failure`.)
CREATE TEMP TABLE t3193_docs(path text NOT NULL, cfg text NOT NULL, doc jsonb, PRIMARY KEY(path,cfg));
DO $t3$
DECLARE r record; cfg text; v jsonb; v_distinct int;
BEGIN
  FOR r IN SELECT * FROM t3193_promo ORDER BY kind LOOP
    FOREACH cfg IN ARRAY pg_temp.t3193_cfgs() LOOP
      PERFORM pg_temp.t3193_plan(cfg);
      v := pg_temp.t3193_anon(r.path);
      INSERT INTO t3193_docs VALUES (r.path,cfg,v);
      IF v->>'state'<>'search_ready' OR (v->>'integrityOk')::boolean IS NOT TRUE
         OR v->'facts'->>'id' IS DISTINCT FROM r.live_id::text THEN
        RAISE EXCEPTION 'ISSUE-3193-TESTER T-3 FAIL: promoted % did not resolve search_ready on the live entity under plan %: %',r.path,cfg,v;
      END IF;
    END LOOP;
    PERFORM pg_temp.t3193_plan('planner-default');
    SELECT count(DISTINCT doc) INTO v_distinct FROM t3193_docs WHERE path=r.path;
    IF v_distinct<>1 THEN
      RAISE EXCEPTION 'ISSUE-3193-TESTER T-3 FAIL: % returned % different documents across plans',r.path,v_distinct;
    END IF;
  END LOOP;
END
$t3$;

-- T-4: consumer 4 -- the SITEMAP, the only enumerable public reader. It
-- re-reads the source three times per row and drops any row whose `facts.id`
-- is not the ledger's entity. All three promoted live pages must be listed,
-- under every plan, with `last_modified` equal to the live source version --
-- and no `t3193promo` path may be listed twice.
DO $t4$
DECLARE r record; cfg text; v jsonb;
BEGIN
  FOREACH cfg IN ARRAY pg_temp.t3193_cfgs() LOOP
    PERFORM pg_temp.t3193_plan(cfg);
    v := pg_temp.t3193_sitemap();
    FOR r IN SELECT * FROM t3193_promo ORDER BY kind LOOP
      IF NOT (v ? r.path) THEN
        RAISE EXCEPTION 'ISSUE-3193-TESTER T-4 FAIL: promoted live page % is missing from the sitemap under plan %: %',r.path,cfg,v;
      END IF;
      IF (v->>r.path)::timestamptz IS DISTINCT FROM
         (pg_temp.t3193_source(r.path,r.kind)->'facts'->>'sourceUpdatedAt')::timestamptz THEN
        RAISE EXCEPTION 'ISSUE-3193-TESTER T-4 FAIL: sitemap lastmod for % is not the live source version under plan %',r.path,cfg;
      END IF;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.t3193_plan('planner-default');
END
$t4$;

-- T-5: consumer 2 -- the REDIRECT-TARGET check. An administrator retires an
-- old path and points it at each live page. The trigger refuses any target
-- whose source is not `visible`, so a resolver that reads a tombstone refuses
-- a redirect to a live, promoted page. The source paths belong to no entity
-- (`missing`), which is the only kind of source a redirect may overlay.
CREATE TEMP TABLE t3193_redirects(src text PRIMARY KEY, kind text NOT NULL, target text NOT NULL);
INSERT INTO t3193_redirects VALUES
  ('/b/t3193moved',        'brand','/b/t3193promo'),
  ('/e/t3193moved/old',    'event','/e/t3193promo/meet'),
  ('/b/t3193moved/v/old',  'venue','/b/t3193promo/v/roof');
DO $t5$
DECLARE r record; v jsonb;
BEGIN
  FOR r IN SELECT * FROM t3193_redirects ORDER BY src LOOP
    v := pg_temp.t3193_write(r.kind,gen_random_uuid(),r.src,'redirected',r.target,NULL);
    IF v ? 'refused' THEN
      RAISE EXCEPTION 'ISSUE-3193-TESTER T-5 FAIL: a redirect to the live page % was refused: %',r.target,v->>'refused';
    END IF;
    v := pg_temp.t3193_anon(r.src);
    IF v->>'state'<>'redirected' OR v->>'redirectTargetPath'<>r.target OR v ? 'facts' THEN
      RAISE EXCEPTION 'ISSUE-3193-TESTER T-5 FAIL: retired % does not redirect factlessly to %: %',r.src,r.target,v;
    END IF;
  END LOOP;
END
$t5$;

-- -----------------------------------------------------------------------------
-- Fixture H -- `t3193heir`: approval must NEVER transfer to an heir.
-- Account A's brand was promoted to `search_ready` while it was live, then
-- deleted. Account B -- a different tenant -- recreated a brand under the same
-- slug. The ledger row still names A's dead brand. After #3193 the resolver
-- reads B's live brand, so the ledger and the source now disagree about WHO
-- this page is.
-- -----------------------------------------------------------------------------
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,
  cover_media_url,cover_media_type,created_at,updated_at) VALUES
  ('31932000-0000-4000-8000-000000000300','31932000-0000-4000-8000-000000000001','T3193 Heir Predecessor','t3193heir',
   'The original brand an administrator verified and promoted to search while it was live.','popup','none','USD','usd',
   'https://images.example.test/t3193-pred.jpg','image',now()-interval '6 hour',now()-interval '6 hour');
INSERT INTO public.events(id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,is_online,city,
  cover_media_url,cover_media_type,theme,published_at) VALUES
  ('31932000-0000-4000-8000-000000001300','31932000-0000-4000-8000-000000000300','31932000-0000-4000-8000-000000000001',
   'T3193 Pred Show','An undated public show that made the predecessor promotable.','pshow','rsvp','public','scheduled',
   'UTC',false,'Lagos','https://images.example.test/t3193-pred-show.jpg','image','{}',now());

DO $h_setup$
DECLARE v jsonb;
BEGIN
  v := pg_temp.t3193_write('brand','31932000-0000-4000-8000-000000000300','/b/t3193heir','search_ready',NULL,
         (pg_temp.t3193_source('/b/t3193heir','brand')->'facts'->>'sourceUpdatedAt')::timestamptz);
  IF v ? 'refused' OR v->>'lifecycle_state'<>'search_ready' THEN
    RAISE EXCEPTION 'ISSUE-3193-TESTER T-6 setup FAIL: the predecessor could not be promoted while live, so the heir test is vacuous: %',v;
  END IF;
END
$h_setup$;

UPDATE public.brands SET deleted_at=now()-interval '3 hour' WHERE id='31932000-0000-4000-8000-000000000300';

INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,
  cover_media_url,cover_media_type,created_at,updated_at) VALUES
  ('31932000-0000-4000-8000-000000000400','31932000-0000-4000-8000-000000000002','T3193 Heir','t3193heir',
   'A different host who took the freed slug and built a real, fully publishable brand on it.','popup','none','USD','usd',
   'https://images.example.test/t3193-heir.jpg','image',now()-interval '1 hour',now()-interval '1 hour');
INSERT INTO public.events(id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,is_online,city,
  cover_media_url,cover_media_type,theme,published_at) VALUES
  ('31932000-0000-4000-8000-000000001400','31932000-0000-4000-8000-000000000400','31932000-0000-4000-8000-000000000002',
   'T3193 Heir Show','An undated public show that makes the heir promotable on its own merits.','hshow','rsvp','public','scheduled',
   'UTC',false,'Lagos','https://images.example.test/t3193-heir-show.jpg','image','{}',now());

-- T-6: the predecessor's approval does not transfer. Under every plan the heir's
-- page is NOT `search_ready`, carries no facts at all, and is flagged as an
-- integrity failure (the #2986 contract for a ledger row that names a
-- different entity than the source); and the path is NOT in the sitemap.
DO $t6$
DECLARE cfg text; v jsonb;
BEGIN
  FOREACH cfg IN ARRAY pg_temp.t3193_cfgs() LOOP
    PERFORM pg_temp.t3193_plan(cfg);
    v := pg_temp.t3193_anon('/b/t3193heir');
    IF v->>'state'='search_ready' THEN
      RAISE EXCEPTION 'ISSUE-3193-TESTER T-6 FAIL: a dead predecessor''s search approval made the heir indexable under plan %: %',cfg,v;
    END IF;
    IF v->>'state'<>'dependency_failure' OR (v->>'integrityOk')::boolean IS NOT FALSE
       OR (v ? 'facts' AND v->'facts'<>'null'::jsonb) THEN
      RAISE EXCEPTION 'ISSUE-3193-TESTER T-6 FAIL: the heir under a predecessor''s ledger row is not a factless integrity failure under plan %: %',cfg,v;
    END IF;
    IF pg_temp.t3193_sitemap() ? '/b/t3193heir' THEN
      RAISE EXCEPTION 'ISSUE-3193-TESTER T-6 FAIL: the heir entered the sitemap on its predecessor''s approval under plan %',cfg;
    END IF;
  END LOOP;
  PERFORM pg_temp.t3193_plan('planner-default');
END
$t6$;

-- T-7: the legitimate recovery -- an administrator re-verifies the HEIR and
-- rebinds the path to it. Accepted (the trigger now reads the heir), the page
-- resolves `search_ready` on the heir, and it is listed once in the sitemap.
-- The audit trail records the rebinding from the predecessor to the heir.
DO $t7$
DECLARE v jsonb;
BEGIN
  v := pg_temp.t3193_write('brand','31932000-0000-4000-8000-000000000400','/b/t3193heir','search_ready',NULL,
         (pg_temp.t3193_source('/b/t3193heir','brand')->'facts'->>'sourceUpdatedAt')::timestamptz);
  IF v ? 'refused' OR v->>'entity_id'<>'31932000-0000-4000-8000-000000000400' THEN
    RAISE EXCEPTION 'ISSUE-3193-TESTER T-7 FAIL: re-verifying the live heir at its own path was refused: %',v;
  END IF;
  v := pg_temp.t3193_anon('/b/t3193heir');
  IF v->>'state'<>'search_ready' OR v->'facts'->>'id'<>'31932000-0000-4000-8000-000000000400'
     OR v->'facts'->>'brandName'<>'T3193 Heir' THEN
    RAISE EXCEPTION 'ISSUE-3193-TESTER T-7 FAIL: the rebound heir does not resolve search_ready on itself: %',v;
  END IF;
  IF NOT (pg_temp.t3193_sitemap() ? '/b/t3193heir') THEN
    RAISE EXCEPTION 'ISSUE-3193-TESTER T-7 FAIL: the rebound heir is not in the sitemap';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.public_search_document_audit a
    WHERE a.operation='UPDATE' AND a.change_source='issue_3193_pg_tester'
      AND a.before_row->>'canonical_path'='/b/t3193heir'
      AND a.before_row->>'entity_id'='31932000-0000-4000-8000-000000000300'
      AND a.after_row->>'entity_id'='31932000-0000-4000-8000-000000000400') THEN
    RAISE EXCEPTION 'ISSUE-3193-TESTER T-7 FAIL: the audit trail does not record the predecessor -> heir rebinding';
  END IF;
END
$t7$;

-- -----------------------------------------------------------------------------
-- Fixture V -- privacy twins. The tombstone owned a PUBLIC event under the
-- same path; the live brand's event is PRIVATE (`t3193priv`) or UNLISTED
-- (`t3193hidden`). The path's public past must not make either promotable or
-- enumerable.
-- -----------------------------------------------------------------------------
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,created_at,updated_at) VALUES
  ('31932000-0000-4000-8000-000000000500','31932000-0000-4000-8000-000000000001','T3193 Priv Old','t3193priv','Deleted brand that once had a public show here.','popup','none','USD','usd',now()-interval '5 hour',now()-interval '5 hour'),
  ('31932000-0000-4000-8000-000000000510','31932000-0000-4000-8000-000000000001','T3193 Hidden Old','t3193hidden','Deleted brand that once had a public show here.','popup','none','USD','usd',now()-interval '5 hour',now()-interval '5 hour');
INSERT INTO public.events(id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,is_online,city,cover_media_url,cover_media_type,theme,published_at) VALUES
  ('31932000-0000-4000-8000-000000005000','31932000-0000-4000-8000-000000000500','31932000-0000-4000-8000-000000000001','T3193 Old Public Show','An ended public show that used to own this exact path on the web.','show','event','public','ended','UTC',false,'Lagos','https://images.example.test/t3193-ps.jpg','image','{}',now()),
  ('31932000-0000-4000-8000-000000005100','31932000-0000-4000-8000-000000000510','31932000-0000-4000-8000-000000000001','T3193 Old Public Show','An ended public show that used to own this exact path on the web.','show','event','public','ended','UTC',false,'Lagos','https://images.example.test/t3193-ps.jpg','image','{}',now());
INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone) VALUES
  ('31932000-0000-4000-8000-000000005000',now()-interval '15 day',now()-interval '15 day'+interval '2 hour',true,'UTC'),
  ('31932000-0000-4000-8000-000000005100',now()-interval '15 day',now()-interval '15 day'+interval '2 hour',true,'UTC');
UPDATE public.brands SET deleted_at=now()-interval '4 hour'
WHERE id IN ('31932000-0000-4000-8000-000000000500','31932000-0000-4000-8000-000000000510');
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,cover_media_url,cover_media_type,created_at,updated_at) VALUES
  ('31932000-0000-4000-8000-000000000600','31932000-0000-4000-8000-000000000002','T3193 Priv Live','t3193priv','A live brand whose show at this path is private to invitees only.','popup','none','USD','usd','https://images.example.test/t3193-pl.jpg','image',now()-interval '1 hour',now()-interval '1 hour'),
  ('31932000-0000-4000-8000-000000000610','31932000-0000-4000-8000-000000000002','T3193 Hidden Live','t3193hidden','A live brand whose show at this path is unlisted, link-only.','popup','none','USD','usd','https://images.example.test/t3193-hl.jpg','image',now()-interval '1 hour',now()-interval '1 hour');
INSERT INTO public.events(id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,is_online,city,cover_media_url,cover_media_type,theme,published_at) VALUES
  ('31932000-0000-4000-8000-000000006000','31932000-0000-4000-8000-000000000600','31932000-0000-4000-8000-000000000002','T3193 Private Show','A private RSVP show for invitees, with enough detail to look promotable.','show','rsvp','private','scheduled','UTC',false,'Lagos','https://images.example.test/t3193-pv.jpg','image','{}',now()),
  ('31932000-0000-4000-8000-000000006100','31932000-0000-4000-8000-000000000610','31932000-0000-4000-8000-000000000002','T3193 Unlisted Show','An unlisted RSVP show for people with the link, with enough detail to look promotable.','show','rsvp','hidden','scheduled','UTC',false,'Lagos','https://images.example.test/t3193-hd.jpg','image','{}',now());
INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone) VALUES
  ('31932000-0000-4000-8000-000000006000',now()+interval '15 day',now()+interval '15 day 2 hour',true,'UTC'),
  ('31932000-0000-4000-8000-000000006100',now()+interval '15 day',now()+interval '15 day 2 hour',true,'UTC');

-- T-8: PRIVATE live event, public tombstone twin. Under every plan: `draft`,
-- no facts, and never the tombstone's public show. It cannot be promoted, it
-- cannot be a redirect target, and it is not in the sitemap.
-- T-8b: UNLISTED live event, public tombstone twin. The exact-link contract
-- (#2117 'direct') makes it `public_noindex` with ITS OWN facts -- never the
-- tombstone's -- but it cannot be promoted and cannot be enumerated.
DO $t8$
DECLARE cfg text; v jsonb;
BEGIN
  FOREACH cfg IN ARRAY pg_temp.t3193_cfgs() LOOP
    PERFORM pg_temp.t3193_plan(cfg);
    v := pg_temp.t3193_anon('/e/t3193priv/show');
    IF v->>'state'<>'draft' OR v->'facts' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'ISSUE-3193-TESTER T-8 FAIL: a private live event with a public twin is reachable under plan %: %',cfg,v;
    END IF;
    v := pg_temp.t3193_anon('/e/t3193hidden/show');
    IF v->>'state'<>'public_noindex' OR v->'facts'->>'id'<>'31932000-0000-4000-8000-000000006100'
       OR v->'facts'->>'visibility'<>'hidden' THEN
      RAISE EXCEPTION 'ISSUE-3193-TESTER T-8b FAIL: the unlisted live event did not resolve exact-link noindex on itself under plan %: %',cfg,v;
    END IF;
  END LOOP;
  PERFORM pg_temp.t3193_plan('planner-default');

  v := pg_temp.t3193_write('event','31932000-0000-4000-8000-000000006000','/e/t3193priv/show','search_ready',NULL,now());
  IF NOT (v ? 'refused') THEN RAISE EXCEPTION 'ISSUE-3193-TESTER T-8 FAIL: a private event was promoted to search: %',v; END IF;
  v := pg_temp.t3193_write('event','31932000-0000-4000-8000-000000005000','/e/t3193priv/show','search_ready',NULL,now());
  IF NOT (v ? 'refused') THEN RAISE EXCEPTION 'ISSUE-3193-TESTER T-8 FAIL: the tombstone''s public show was promoted at the private path: %',v; END IF;
  v := pg_temp.t3193_write('event',gen_random_uuid(),'/e/t3193moved/priv','redirected','/e/t3193priv/show',NULL);
  IF NOT (v ? 'refused') THEN RAISE EXCEPTION 'ISSUE-3193-TESTER T-8 FAIL: a redirect to a private event was accepted: %',v; END IF;

  v := pg_temp.t3193_write('event','31932000-0000-4000-8000-000000006100','/e/t3193hidden/show','search_ready',NULL,
         (pg_temp.t3193_source('/e/t3193hidden/show','event')->'facts'->>'sourceUpdatedAt')::timestamptz);
  IF NOT (v ? 'refused') THEN RAISE EXCEPTION 'ISSUE-3193-TESTER T-8b FAIL: an unlisted event was promoted to search: %',v; END IF;
  v := pg_temp.t3193_write('event','31932000-0000-4000-8000-000000005100','/e/t3193hidden/show','search_ready',NULL,now());
  IF NOT (v ? 'refused') THEN RAISE EXCEPTION 'ISSUE-3193-TESTER T-8b FAIL: the tombstone''s public show was promoted at the unlisted path: %',v; END IF;

  v := pg_temp.t3193_sitemap();
  IF v ? '/e/t3193priv/show' OR v ? '/e/t3193hidden/show' THEN
    RAISE EXCEPTION 'ISSUE-3193-TESTER T-8 FAIL: a private or unlisted path is enumerable: %',v;
  END IF;
END
$t8$;

-- -----------------------------------------------------------------------------
-- Fixture O -- the owner axis. `t3193orphan`: the LIVE brand row sits under a
-- CLOSED creator account; the soft-deleted twin sits under a LIVE account and
-- still owns a public ended `talk` and a verified `roof`. Neither row is
-- eligible, and a live-first order must not stitch a live brand to a live
-- account out of two different rows.
-- -----------------------------------------------------------------------------
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,cover_media_url,cover_media_type,created_at,updated_at) VALUES
  ('31932000-0000-4000-8000-000000000700','31932000-0000-4000-8000-000000000001','T3193 Orphan Twin','t3193orphan','Soft-deleted twin under a live account, still owning children.','popup','none','USD','usd','https://images.example.test/t3193-ot.jpg','image',now()-interval '5 hour',now()-interval '5 hour');
INSERT INTO public.events(id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,is_online,city,cover_media_url,cover_media_type,theme,published_at) VALUES
  ('31932000-0000-4000-8000-000000007000','31932000-0000-4000-8000-000000000700','31932000-0000-4000-8000-000000000001','T3193 Orphan Talk','An ended public talk under the soft-deleted twin.','talk','event','public','ended','UTC',false,'Lagos','https://images.example.test/t3193-ott.jpg','image','{}',now());
INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone) VALUES
  ('31932000-0000-4000-8000-000000007000',now()-interval '9 day',now()-interval '9 day'+interval '2 hour',true,'UTC');
INSERT INTO public.venue_listings(id,brand_id,slug,name,city,country_code,lat,lng,venue_category,claim_status,cover_media_url,cover_media_type,created_at) VALUES
  ('31932000-0000-4000-8000-000000007100','31932000-0000-4000-8000-000000000700','roof','T3193 Orphan Twin Roof','Lagos','NG',6.45,3.39,'restaurant','verified','https://images.example.test/t3193-otr.jpg','image',now()-interval '5 hour');
UPDATE public.brands SET deleted_at=now()-interval '4 hour' WHERE id='31932000-0000-4000-8000-000000000700';
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,cover_media_url,cover_media_type,created_at,updated_at) VALUES
  ('31932000-0000-4000-8000-000000000800','31932000-0000-4000-8000-000000000003','T3193 Orphan Live','t3193orphan','A live brand row whose owning creator account has been closed.','popup','none','USD','usd','https://images.example.test/t3193-ol.jpg','image',now()-interval '1 hour',now()-interval '1 hour');
INSERT INTO public.events(id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,is_online,city,cover_media_url,cover_media_type,theme,published_at) VALUES
  ('31932000-0000-4000-8000-000000008000','31932000-0000-4000-8000-000000000800','31932000-0000-4000-8000-000000000003','T3193 Orphan Live Talk','A public talk under a live brand whose account is closed.','talk','rsvp','public','scheduled','UTC',false,'Lagos','https://images.example.test/t3193-olt.jpg','image','{}',now());
INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone) VALUES
  ('31932000-0000-4000-8000-000000008000',now()+interval '9 day',now()+interval '9 day 2 hour',true,'UTC');
INSERT INTO public.venue_listings(id,brand_id,slug,name,city,country_code,lat,lng,venue_category,claim_status,cover_media_url,cover_media_type,created_at) VALUES
  ('31932000-0000-4000-8000-000000008100','31932000-0000-4000-8000-000000000800','roof','T3193 Orphan Live Roof','Lagos','NG',6.45,3.39,'restaurant','verified','https://images.example.test/t3193-olr.jpg','image',now()-interval '1 hour');

-- T-9: every family on the owner-axis slug stays `draft` with no facts under
-- every plan, and none of the four live-looking entities can be promoted.
DO $t9$
DECLARE cfg text; p text; v jsonb; r record;
BEGIN
  FOREACH cfg IN ARRAY pg_temp.t3193_cfgs() LOOP
    PERFORM pg_temp.t3193_plan(cfg);
    FOREACH p IN ARRAY ARRAY['/b/t3193orphan','/e/t3193orphan/talk','/b/t3193orphan/v/roof'] LOOP
      v := pg_temp.t3193_anon(p);
      IF v->>'state'<>'draft' OR v->'facts' IS DISTINCT FROM 'null'::jsonb THEN
        RAISE EXCEPTION 'ISSUE-3193-TESTER T-9 FAIL: % on the owner-axis slug is reachable under plan %: %',p,cfg,v;
      END IF;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.t3193_plan('planner-default');
  FOR r IN SELECT * FROM (VALUES
      ('brand','31932000-0000-4000-8000-000000000800'::uuid,'/b/t3193orphan'),
      ('event','31932000-0000-4000-8000-000000008000'::uuid,'/e/t3193orphan/talk'),
      ('venue','31932000-0000-4000-8000-000000008100'::uuid,'/b/t3193orphan/v/roof'),
      ('event','31932000-0000-4000-8000-000000007000'::uuid,'/e/t3193orphan/talk')) AS t(kind,id,path) LOOP
    v := pg_temp.t3193_write(r.kind,r.id,r.path,'search_ready',NULL,now());
    IF NOT (v ? 'refused') THEN
      RAISE EXCEPTION 'ISSUE-3193-TESTER T-9 FAIL: % % on the owner-axis slug was promoted: %',r.kind,r.id,v;
    END IF;
  END LOOP;
END
$t9$;

-- -----------------------------------------------------------------------------
-- T-10: CASE. Slug identity is case-insensitive for uniqueness
-- (`idx_brands_slug_active` is on lower(slug)), but the resolver compares
-- `b.slug = <path segment>` exactly and the #2986 path grammar rejects any
-- upper-case path. Pinned here:
--   (a) live `Foo` and live `foo` cannot coexist -- the premise that makes the
--       live-first key total; a soft-deleted case twin CAN coexist.
--   (b) an upper-case path never resolves anything, even when its lower-case
--       spelling is a promoted `search_ready` page.
--   (c) a live mixed-case brand with a lower-case tombstone twin: the lower-case
--       path must NEVER serve the tombstone's facts. (What it serves instead is
--       reported, not pinned -- see the tester's report on #3193.)
-- -----------------------------------------------------------------------------
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,created_at,updated_at,deleted_at) VALUES
  ('31932000-0000-4000-8000-000000000900','31932000-0000-4000-8000-000000000001','T3193 Case Tomb','t3193case','Lower-case soft-deleted twin.','popup','none','USD','usd',now()-interval '5 hour',now()-interval '5 hour',now()-interval '4 hour'),
  ('31932000-0000-4000-8000-000000000910','31932000-0000-4000-8000-000000000002','T3193 Case Live','T3193Case','Mixed-case live brand stored by a writer that did not lower-case.','popup','none','USD','usd',now()-interval '1 hour',now()-interval '1 hour',NULL);
DO $t10$
DECLARE v jsonb; v_blocked boolean := false; p text;
BEGIN
  BEGIN
    INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency)
    VALUES ('31932000-0000-4000-8000-000000000920','31932000-0000-4000-8000-000000000001','T3193 Case Clash','t3193case',
            'A second LIVE brand differing only in case.','popup','none','USD','usd');
  EXCEPTION WHEN unique_violation THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'ISSUE-3193-TESTER T-10a FAIL: two LIVE brands differing only in case coexist, so the live-first key is no longer total';
  END IF;
  v_blocked := false;
  BEGIN
    INSERT INTO public.events(id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,is_online,city,theme,published_at)
    VALUES ('31932000-0000-4000-8000-000000009200','31932000-0000-4000-8000-000000000200','31932000-0000-4000-8000-000000000002',
            'T3193 Case Clash Meet','A second LIVE event differing only in case.','MEET','rsvp','public','scheduled','UTC',false,'Lagos','{}',now());
  EXCEPTION WHEN unique_violation THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'ISSUE-3193-TESTER T-10a FAIL: two LIVE events of one brand differing only in case coexist';
  END IF;

  FOREACH p IN ARRAY ARRAY['/b/T3193promo','/e/t3193promo/MEET','/b/t3193promo/v/Roof','/b/T3193Case'] LOOP
    v := pg_temp.t3193_anon(p);
    IF v IS DISTINCT FROM '{"valid":false}'::jsonb THEN
      RAISE EXCEPTION 'ISSUE-3193-TESTER T-10b FAIL: upper-case path % resolved something: %',p,v;
    END IF;
  END LOOP;

  v := pg_temp.t3193_anon('/b/t3193case');
  IF position('31932000-0000-4000-8000-000000000900' IN v::text)>0 OR v->'facts'->>'brandName'='T3193 Case Tomb' THEN
    RAISE EXCEPTION 'ISSUE-3193-TESTER T-10c FAIL: the lower-case path served the soft-deleted twin''s facts: %',v;
  END IF;
  IF v->'facts' IS NOT NULL AND v->'facts'<>'null'::jsonb
     AND v->'facts'->>'id' IS DISTINCT FROM '31932000-0000-4000-8000-000000000910' THEN
    RAISE EXCEPTION 'ISSUE-3193-TESTER T-10c FAIL: the lower-case path served some row other than the live brand: %',v;
  END IF;
  RAISE NOTICE 'ISSUE-3193-TESTER T-10c observed: /b/t3193case with live slug T3193Case + tombstone t3193case -> state=%',v->>'state';
END
$t10$;

-- -----------------------------------------------------------------------------
-- T-11: venue slug `roof` reused across two LIVE brands (legal: the venue
-- uniqueness is per brand). Each brand's path serves its own venue under every
-- plan; neither bleeds into the other or into `t3193promo`'s `roof`.
-- -----------------------------------------------------------------------------
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency) VALUES
  ('31932000-0000-4000-8000-000000000a00','31932000-0000-4000-8000-000000000001','T3193 VA','t3193va','Live brand A with a roof.','popup','none','USD','usd'),
  ('31932000-0000-4000-8000-000000000b00','31932000-0000-4000-8000-000000000002','T3193 VB','t3193vb','Live brand B with a roof.','popup','none','USD','usd');
INSERT INTO public.venue_listings(id,brand_id,slug,name,city,country_code,lat,lng,venue_category,claim_status) VALUES
  ('31932000-0000-4000-8000-00000000a100','31932000-0000-4000-8000-000000000a00','roof','T3193 VA Roof','Lagos','NG',6.45,3.39,'restaurant','verified'),
  ('31932000-0000-4000-8000-00000000b100','31932000-0000-4000-8000-000000000b00','roof','T3193 VB Roof','Abuja','NG',9.07,7.40,'restaurant','verified');
DO $t11$
DECLARE cfg text; v jsonb; r record;
BEGIN
  FOREACH cfg IN ARRAY pg_temp.t3193_cfgs() LOOP
    PERFORM pg_temp.t3193_plan(cfg);
    FOR r IN SELECT * FROM (VALUES
        ('/b/t3193va/v/roof','31932000-0000-4000-8000-00000000a100','T3193 VA'),
        ('/b/t3193vb/v/roof','31932000-0000-4000-8000-00000000b100','T3193 VB'),
        ('/b/t3193promo/v/roof','31932000-0000-4000-8000-000000001600','T3193 Promo Live')) AS t(path,id,brand) LOOP
      v := pg_temp.t3193_anon(r.path);
      IF v->'facts'->>'id' IS DISTINCT FROM r.id OR v->'facts'->>'brandName' IS DISTINCT FROM r.brand THEN
        RAISE EXCEPTION 'ISSUE-3193-TESTER T-11 FAIL: % served another brand''s venue under plan %: %',r.path,cfg,v;
      END IF;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.t3193_plan('planner-default');
END
$t11$;

-- -----------------------------------------------------------------------------
-- T-12: a tie between two LIVE rows. `idx_brands_slug_active` makes this
-- impossible, so the only way to build it is to take the index away -- inside a
-- SAVEPOINT that is rolled back below. The question is not whether this can
-- happen today (it cannot) but what the tie-break keys DO if the premise is
-- ever lost: the answer must still be ONE row, the same under every plan, and
-- it is the most recently created live row (`created_at DESC, id`).
-- -----------------------------------------------------------------------------
SAVEPOINT t3193_tie;
DROP INDEX public.idx_brands_slug_active;
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,created_at,updated_at) VALUES
  ('31932000-0000-4000-8000-000000000c00','31932000-0000-4000-8000-000000000001','T3193 Tie Older','t3193tie','The older of two live rows.','popup','none','USD','usd',now()-interval '2 hour',now()-interval '2 hour'),
  ('31932000-0000-4000-8000-000000000c10','31932000-0000-4000-8000-000000000002','T3193 Tie Newer','t3193tie','The newer of two live rows.','popup','none','USD','usd',now()-interval '1 hour',now()-interval '1 hour');
CREATE TEMP TABLE t3193_tie(cfg text PRIMARY KEY, doc jsonb);
DO $t12$
DECLARE cfg text; v jsonb; v_distinct int;
BEGIN
  FOREACH cfg IN ARRAY pg_temp.t3193_cfgs() LOOP
    PERFORM pg_temp.t3193_plan(cfg);
    v := pg_temp.t3193_anon('/b/t3193tie');
    INSERT INTO t3193_tie VALUES (cfg,v);
    IF v->>'state'<>'public_noindex' OR v->'facts'->>'id'<>'31932000-0000-4000-8000-000000000c10' THEN
      RAISE EXCEPTION 'ISSUE-3193-TESTER T-12 FAIL: with two live rows, plan % did not pick the newest live row: %',cfg,v;
    END IF;
  END LOOP;
  PERFORM pg_temp.t3193_plan('planner-default');
  SELECT count(DISTINCT doc) INTO v_distinct FROM t3193_tie;
  IF v_distinct<>1 THEN
    RAISE EXCEPTION 'ISSUE-3193-TESTER T-12 FAIL: a live-live tie resolved to % different documents across plans',v_distinct;
  END IF;
END
$t12$;
ROLLBACK TO SAVEPOINT t3193_tie;
DO $t12r$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_brands_slug_active'
                 AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%lower(slug)%' AND indexdef LIKE '%deleted_at IS NULL%') THEN
    RAISE EXCEPTION 'ISSUE-3193-TESTER T-12 FAIL: idx_brands_slug_active was not restored by the savepoint rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brands WHERE slug='t3193tie') THEN
    RAISE EXCEPTION 'ISSUE-3193-TESTER T-12 FAIL: tie fixtures survived the savepoint rollback';
  END IF;
END
$t12r$;

-- T-13: this suite is behavioural only -- it never replaces the resolver. The
-- body it finished against is byte-identical to the one it started against.
DO $t13$
BEGIN
  IF md5(pg_get_functiondef('public.public_search_source_facts(text,text)'::regprocedure))
     IS DISTINCT FROM (SELECT def_md5 FROM t3193_start) THEN
    RAISE EXCEPTION 'ISSUE-3193-TESTER T-13 FAIL: public_search_source_facts changed while the suite ran';
  END IF;
END
$t13$;

ROLLBACK;
SELECT 'issue_3193_public_search_live_row_ledger_consumers tester adversarial: PASS' AS result;
