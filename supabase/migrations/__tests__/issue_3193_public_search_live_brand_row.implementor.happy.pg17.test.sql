-- Issue #3193 implementor happy-path contract (PostgreSQL 17).
-- Covers every row selection #3193 changes: brand (H1-H6), event / trip /
-- experience and venue (H7-H9).
--
-- The defect was a missing `ORDER BY`: `public.public_search_source_facts`
-- selected the brand with `WHERE b.slug = v_parts[2] LIMIT 1` -- no `deleted_at`
-- filter, no ordering -- so a slug carrying soft-deleted twins resolved from
-- whichever row the chosen plan emitted first. No static gate can see a missing
-- `ORDER BY`, and no #2986 fixture ever created two rows under one slug, so this
-- suite is behavioural: it builds a multi-row slug, sweeps planner
-- configurations, and asserts on what the real anonymous resolver returns.
--
-- [TEST-MOD-APPROVED #3193] P2-1 from the #3193 tester: the ambiguity controls
-- (H3, and the ambiguity class in H8/H9) asserted WHICH row the pre-fix
-- unordered `LIMIT 1` returns under the planner's default -- and that answer
-- flips with table statistics. On a fresh table (`reltuples=-1`) `brands` is
-- the scanned side and the first-INSERTED row comes out; after `VACUUM`
-- (`reltuples=0`) `brands` becomes the hash BUILD side and a hash bucket
-- returns rows in REVERSE insertion order, so the live row comes out and the
-- suite failed on CORRECT code. CI's image runs autovacuum (1-minute naptime,
-- 50-dead-tuple threshold), so main passed on timing, not by construction.
-- The fix is a MIRROR twin for every ambiguity fixture -- same shape, insertion
-- order and ids reversed -- and a claim that holds whichever way any plan
-- emits rows: under EVERY plan, at least one of the pair reads a tombstone.
-- Measured before writing it: 5 table states (fresh, dirty, VACUUM, VACUUM
-- ANALYZE, dirty-after-vacuum) x 5 plans x 3 branches, exactly one of each
-- pair was wrong in all 75 cells. The sweeps also force custom plans, so a
-- cached generic plan cannot make five configurations run one plan (P4-1).
--
-- One transaction + ROLLBACK: no fixture survives, and H3's temporary
-- `CREATE OR REPLACE` of the production function is rolled back with everything
-- else.

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE i3193_defs(name text PRIMARY KEY, def text NOT NULL);
CREATE TEMP TABLE i3193_sweep(body text NOT NULL, path text NOT NULL, cfg text NOT NULL, doc jsonb, PRIMARY KEY(body,path,cfg));

-- The five planner configurations swept below. `planner-default` is the one
-- production runs; the other four force the join and scan strategies that make
-- an unordered `LIMIT 1` return a different row.
CREATE FUNCTION pg_temp.i3193_plan_cfg(p_cfg text) RETURNS void LANGUAGE plpgsql AS $cfg$
BEGIN
  -- A cached generic plan would let five configurations re-run ONE plan.
  SET LOCAL plan_cache_mode = force_custom_plan;
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
  ELSIF p_cfg='planner-default' THEN
    RESET enable_indexscan; RESET enable_bitmapscan; RESET enable_indexonlyscan;
    RESET enable_seqscan; RESET enable_hashjoin; RESET enable_mergejoin;
  ELSE
    RAISE EXCEPTION 'ISSUE-3193 unknown plan configuration %',p_cfg;
  END IF;
END
$cfg$;

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
VALUES ('31930000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','owner-i3193@example.test','x',now(),now());
INSERT INTO public.creator_accounts(id) VALUES ('31930000-0000-4000-8000-000000000001');

-- Three rows under one slug, two soft-deleted, reproducing production:
-- `lanternroom` was created, soft-deleted, created, soft-deleted, and created a
-- third time inside 100 minutes, and the unordered `LIMIT 1` served a tombstone.
-- `idx_brands_slug_active` is UNIQUE (lower(slug)) WHERE deleted_at IS NULL, so
-- only one of these three may be live -- which is exactly the guarantee the
-- shipped ordering exists to honour.
INSERT INTO public.brands(
  id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,
  created_at,updated_at,deleted_at)
VALUES
  ('31930000-0000-4000-8000-000000000010','31930000-0000-4000-8000-000000000001',
   'Issue 3193 Dead Twin One','i3193dup',
   'The first soft-deleted copy of this brand. A public reader must never resolve from it.',
   'popup','none','USD','usd',now()-interval '3 hour',now()-interval '3 hour',now()-interval '2 hour'),
  ('31930000-0000-4000-8000-000000000011','31930000-0000-4000-8000-000000000001',
   'Issue 3193 Dead Twin Two','i3193dup',
   'The second soft-deleted copy of this brand. A public reader must never resolve from it.',
   'popup','none','USD','usd',now()-interval '2 hour',now()-interval '2 hour',now()-interval '1 hour'),
  ('31930000-0000-4000-8000-000000000012','31930000-0000-4000-8000-000000000001',
   'Issue 3193 Live Brand','i3193dup',
   'The live brand a host recreated under the same slug, with a real public description for explorers.',
   'popup','none','USD','usd',now()-interval '1 hour',now()-interval '1 hour',NULL);

-- i3193dupmirror: the MIRROR of i3193dup -- the live row inserted FIRST and
-- holding the LOWEST id, the tombstones after it. Whichever direction a plan
-- emits rows (insertion order, reverse insertion order, id order), one of the
-- pair reaches a tombstone first under the pre-#3193 selection.
INSERT INTO public.brands(
  id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,
  created_at,updated_at,deleted_at)
VALUES
  ('31930000-0000-4000-8000-000000000014','31930000-0000-4000-8000-000000000001',
   'Issue 3193 Mirror Live Brand','i3193dupmirror',
   'The live brand of the mirror group, inserted first, with a real public description.',
   'popup','none','USD','usd',now()-interval '1 hour',now()-interval '1 hour',NULL),
  ('31930000-0000-4000-8000-000000000015','31930000-0000-4000-8000-000000000001',
   'Issue 3193 Mirror Dead Twin One','i3193dupmirror',
   'A soft-deleted copy in the mirror group. A public reader must never resolve from it.',
   'popup','none','USD','usd',now()-interval '3 hour',now()-interval '3 hour',now()-interval '2 hour'),
  ('31930000-0000-4000-8000-000000000016','31930000-0000-4000-8000-000000000001',
   'Issue 3193 Mirror Dead Twin Two','i3193dupmirror',
   'A second soft-deleted copy in the mirror group.',
   'popup','none','USD','usd',now()-interval '2 hour',now()-interval '2 hour',now()-interval '1 hour');

-- A live brand with a unique slug and zero published content. This is the case
-- the issue body wrongly believed resolved to `draft`.
INSERT INTO public.brands(
  id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency)
VALUES (
  '31930000-0000-4000-8000-000000000020','31930000-0000-4000-8000-000000000001',
  'Issue 3193 Empty Brand','i3193solo',
  'A live brand with no events at all, which must still be publicly reachable at its canonical path.',
  'popup','none','USD','usd');

-- H1: the live row decides the page. Three rows share `i3193dup`, two of them
-- tombstones, and the anonymous resolver must return `public_noindex` carrying
-- the LIVE brand's id and identity.
DO $h1$
DECLARE v jsonb;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO v USING '/b/i3193dup';
  RESET ROLE;
  IF v->>'state'<>'public_noindex' THEN
    RAISE EXCEPTION 'ISSUE-3193 H1 FAIL: duplicate-slug brand did not resolve public_noindex: %',v;
  END IF;
  IF v->'facts'->>'id'<>'31930000-0000-4000-8000-000000000012' THEN
    RAISE EXCEPTION 'ISSUE-3193 H1 FAIL: resolver read a row other than the live brand: %',v;
  END IF;
  IF v->'facts'->>'brandName'<>'Issue 3193 Live Brand' THEN
    RAISE EXCEPTION 'ISSUE-3193 H1 FAIL: facts carry a dead twin''s identity: %',v;
  END IF;
  IF (v->'facts'->>'eventCount')::bigint<>0 OR (v->>'integrityOk')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'ISSUE-3193 H1 FAIL: zero-event live brand resolved with wrong inventory truth: %',v;
  END IF;
END
$h1$;

-- H2: the fix is plan-independent. An unordered `LIMIT 1` returns whatever row
-- the chosen plan emits first, so proving a total order needs a sweep, not one
-- call. All five configurations must return the identical document for the
-- identical rows.
DO $h2$
DECLARE cfg text; v jsonb; v_distinct int; r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('/b/i3193dup','31930000-0000-4000-8000-000000000012'),
                                 ('/b/i3193dupmirror','31930000-0000-4000-8000-000000000014')) t(path,live_id) LOOP
    FOREACH cfg IN ARRAY ARRAY['seq-nestloop','seq-hash','seq-merge','index-scans','planner-default'] LOOP
      PERFORM pg_temp.i3193_plan_cfg(cfg);
      EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO v USING r.path;
      INSERT INTO i3193_sweep VALUES ('shipped',r.path,cfg,v);
      IF v->>'state'<>'public_noindex' OR v->'facts'->>'id'<>r.live_id THEN
        RAISE EXCEPTION 'ISSUE-3193 H2 FAIL: plan % read a row other than the live brand for %: %',cfg,r.path,v;
      END IF;
    END LOOP;
    PERFORM pg_temp.i3193_plan_cfg('planner-default');
    SELECT count(DISTINCT doc) INTO v_distinct FROM i3193_sweep WHERE body='shipped' AND path=r.path;
    IF v_distinct<>1 THEN
      RAISE EXCEPTION 'ISSUE-3193 H2 FAIL: the shipped resolver returned % different documents across plans for %',v_distinct,r.path;
    END IF;
  END LOOP;
END
$h2$;

-- H3: fails-on-revert control. Put the pre-#3193 row selection back into the real
-- function and re-run the same sweep over BOTH mirror twins. Under EVERY plan,
-- the planner's default included, at least one twin must resolve `draft` --
-- which `handlePublicSearchDocument` serves as HTTP 404, exactly what production
-- did for `lanternroom`. Which twin it is depends on the plan and on the table's
-- statistics; that one of them always is, is the defect, and it holds in every
-- table state (see the file header). Then the shipped body is restored and both
-- pages are public again. The substitution is
-- asserted to have actually changed the definition, so a silently unmatched
-- replace cannot read as a pass.
DO $h3$
DECLARE v_fixed text; v_reverted text; cfg text; v jsonb; va jsonb; vb jsonb; v_twin_wrong int := 0; v_plans int := 0;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_fixed
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='public_search_source_facts'
    AND pg_get_function_identity_arguments(p.oid)='p_path text, p_kind text';
  IF v_fixed IS NULL THEN
    RAISE EXCEPTION 'ISSUE-3193 H3 FAIL: public_search_source_facts(text,text) not found';
  END IF;
  INSERT INTO i3193_defs VALUES ('shipped',v_fixed);

  v_reverted := replace(
    v_fixed,
    E'    WHERE b.slug=v_parts[2]\n    ORDER BY (b.deleted_at IS NULL) DESC, b.created_at DESC, b.id\n    LIMIT 1;',
    E'    WHERE b.slug=v_parts[2] LIMIT 1;');
  IF v_reverted = v_fixed THEN
    RAISE EXCEPTION 'ISSUE-3193 H3 FAIL: the shipped live-row ordering is absent, so this control proves nothing';
  END IF;
  EXECUTE v_reverted;

  FOREACH cfg IN ARRAY ARRAY['seq-nestloop','seq-hash','seq-merge','index-scans','planner-default'] LOOP
    PERFORM pg_temp.i3193_plan_cfg(cfg);
    EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO va USING '/b/i3193dup';
    EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO vb USING '/b/i3193dupmirror';
    INSERT INTO i3193_sweep VALUES ('pre-3193','/b/i3193dup',cfg,va), ('pre-3193','/b/i3193dupmirror',cfg,vb);
    v_plans := v_plans+1;
    IF NOT ((va->>'state'='draft' AND va->'facts'='null'::jsonb) OR (vb->>'state'='draft' AND vb->'facts'='null'::jsonb)) THEN
      RAISE EXCEPTION 'ISSUE-3193 H3 FAIL: under plan % the pre-fix selection read the live row for BOTH mirror twins, so this fixture no longer reproduces the arbitrary row choice: % / %',cfg,va,vb;
    END IF;
    IF va->>'state'='draft' THEN v_twin_wrong := v_twin_wrong+1; END IF;
    IF vb->>'state'='draft' THEN v_twin_wrong := v_twin_wrong+1; END IF;
  END LOOP;
  PERFORM pg_temp.i3193_plan_cfg('planner-default');
  IF v_plans<>5 THEN
    RAISE EXCEPTION 'ISSUE-3193 H3 FAIL: swept % plans, expected 5',v_plans;
  END IF;
  RAISE NOTICE 'ISSUE-3193 brand control: pre-fix read a tombstone in % of 10 twin-plan cells; >= 1 of the pair under all 5 plans',v_twin_wrong;

  EXECUTE (SELECT def FROM i3193_defs WHERE name='shipped');
  EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO va USING '/b/i3193dup';
  EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO vb USING '/b/i3193dupmirror';
  IF va->>'state'<>'public_noindex' OR va->'facts'->>'id'<>'31930000-0000-4000-8000-000000000012'
     OR vb->>'state'<>'public_noindex' OR vb->'facts'->>'id'<>'31930000-0000-4000-8000-000000000014' THEN
    RAISE EXCEPTION 'ISSUE-3193 H3 FAIL: restoring the shipped body did not restore both live pages: % / %',va,vb;
  END IF;
END
$h3$;

-- H4: determinism. Twenty consecutive anonymous resolves of the duplicate-slug
-- path return byte-identical documents.
DO $h4$
DECLARE v jsonb; v_first jsonb; i int;
BEGIN
  FOR i IN 1..20 LOOP
    SET LOCAL ROLE anon;
    PERFORM set_config('request.jwt.claim.role','anon',true);
    EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO v USING '/b/i3193dup';
    RESET ROLE;
    IF i=1 THEN v_first := v; END IF;
    IF v IS DISTINCT FROM v_first THEN
      RAISE EXCEPTION 'ISSUE-3193 H4 FAIL: call % differed from call 1: % vs %',i,v,v_first;
    END IF;
    IF v->>'state'<>'public_noindex' OR v->'facts'->>'id'<>'31930000-0000-4000-8000-000000000012' THEN
      RAISE EXCEPTION 'ISSUE-3193 H4 FAIL: call % resolved the wrong row: %',i,v;
    END IF;
  END LOOP;
END
$h4$;

-- H5: a live brand with a unique slug and zero events stays publicly reachable.
-- The issue body claimed emptiness forced `draft`; it does not, and this pins
-- that a future change cannot quietly make emptiness hide a brand.
DO $h5$
DECLARE v jsonb;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO v USING '/b/i3193solo';
  RESET ROLE;
  IF v->>'state'<>'public_noindex' OR (v->'facts'->>'eventCount')::bigint<>0
     OR v->'facts'->>'id'<>'31930000-0000-4000-8000-000000000020' THEN
    RAISE EXCEPTION 'ISSUE-3193 H5 FAIL: an empty live brand is not publicly reachable: %',v;
  END IF;
END
$h5$;

-- H6: the change moved which row is read, not the predicate. For every slug in
-- this fixture set the resolver's answer must equal the #2986 brand predicate
-- evaluated on the live-preferring pick.
DO $h6$
DECLARE r record; v jsonb; v_expected text;
BEGIN
  FOR r IN SELECT DISTINCT slug FROM public.brands WHERE slug LIKE 'i3193%' ORDER BY slug LOOP
    SELECT CASE WHEN b.deleted_at IS NULL AND ca.deleted_at IS NULL AND (
             b.kind IS DISTINCT FROM 'physical' OR b.claim_status='verified' OR EXISTS (
               SELECT 1 FROM public.events e WHERE e.brand_id=b.id
                 AND e.status IN ('scheduled','live','ended','cancelled')
                 AND public.pg_offering_visibility_gate(e.visibility,e.deleted_at,'direct')))
           THEN 'public_noindex' ELSE 'draft' END
    INTO v_expected
    FROM public.brands b JOIN public.creator_accounts ca ON ca.id=b.account_id
    WHERE b.slug=r.slug
    ORDER BY (b.deleted_at IS NULL) DESC, b.created_at DESC, b.id
    LIMIT 1;
    EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO v USING '/b/'||r.slug;
    IF v->>'state' IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'ISSUE-3193 H6 FAIL: % resolved % but the #2986 predicate on the live pick says %',
        r.slug,v->>'state',v_expected;
    END IF;
  END LOOP;
END
$h6$;

-- =============================================================================
-- Event / trip / experience and venue branches (#3193, OQ-1 folded in).
--
-- Production has no live duplicate to test against, so every shape below is
-- CONSTRUCTED. Two duplicate axes exist for the event family, and both are here:
-- a slug carrying soft-deleted BRAND twins, and one live brand carrying a
-- soft-deleted EVENT twin (`idx_events_brand_slug_active` constrains live rows
-- only). Each fixture is tagged with the class of defect it reproduces, MEASURED
-- on this schema rather than assumed:
--   ambiguity     — the pre-fix selection has no usable order, so the answer
--                   depends on the plan AND on the table's statistics. Every
--                   ambiguity fixture therefore has a MIRROR twin (insertion order
--                   and ids reversed, linked by `mirror_of`), and the anti-vacuity
--                   claim is about the pair: under EVERY plan, at least one twin
--                   reads a tombstone. [TEST-MOD-APPROVED #3193] This replaced
--                   "wrong under the default AND >= 2 distinct results", which
--                   failed on CORRECT code after a VACUUM flipped the default
--                   plan's direction (the #3193 tester's P2-1).
--   deterministic — the pre-fix `ORDER BY ed.start_at NULLS LAST` reliably ranks
--                   a tombstone's dated entity above the live, dateless one. There
--                   is nothing ambiguous to vary, so no twin is needed; the
--                   condition is: wrong under ALL five plans, in any table state.
--                   These fixtures prove the fix identically on any planner.
-- Tombstones that CARRY an entity are created the only way production allows:
-- brand live, entity created, entity already ended, THEN the brand soft-deleted
-- (`tg_require_event_brand_currency` refuses an event under a deleted brand, and
-- `issue_2063_guard_brand_soft_delete` refuses to delete a brand with upcoming
-- dated scheduled/live events).
-- =============================================================================

CREATE TEMP TABLE i3193_expect(path text PRIMARY KEY, live_id uuid NOT NULL,
  branch text NOT NULL CHECK (branch IN ('event','venue')),
  class text NOT NULL CHECK (class IN ('ambiguity','deterministic')),
  mirror_of text,
  CHECK ((class='ambiguity') = (mirror_of IS NOT NULL)));
CREATE TEMP TABLE i3193_multi(body text NOT NULL, path text NOT NULL, cfg text NOT NULL, doc jsonb,
  PRIMARY KEY (body,path,cfg));

-- evdup (ambiguity) — THE production-exposed shape: brand twins, and the live
-- event has no master `event_dates` row. Tombstones first, live brand last.
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,created_at,updated_at,deleted_at) VALUES
  ('31930000-0000-4000-8000-000000000101','31930000-0000-4000-8000-000000000001','I3193 EvDup Dead One','i3193evdup','Soft-deleted brand twin.','popup','none','USD','usd',now()-interval '3 hour',now()-interval '3 hour',now()-interval '2 hour'),
  ('31930000-0000-4000-8000-000000000102','31930000-0000-4000-8000-000000000001','I3193 EvDup Dead Two','i3193evdup','Soft-deleted brand twin.','popup','none','USD','usd',now()-interval '2 hour',now()-interval '2 hour',now()-interval '1 hour'),
  ('31930000-0000-4000-8000-000000000103','31930000-0000-4000-8000-000000000001','I3193 EvDup Live','i3193evdup','The live brand.','popup','none','USD','usd',now()-interval '1 hour',now()-interval '1 hour',NULL);
INSERT INTO public.events(id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,is_online,city,theme,published_at) VALUES
  ('31930000-0000-4000-8000-000000001040','31930000-0000-4000-8000-000000000103','31930000-0000-4000-8000-000000000001','I3193 Live Gig','A live, published event with no master date yet.','gig','event','public','scheduled','UTC',false,'Lagos','{}',now());

-- evdupmirror (ambiguity, twin of evdup) — the live brand inserted FIRST with the
-- LOWEST id, its tombstone twins after it.
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,created_at,updated_at,deleted_at) VALUES
  ('31930000-0000-4000-8000-000000000104','31930000-0000-4000-8000-000000000001','I3193 EvDupMirror Live','i3193evdupmirror','The live brand, inserted first.','popup','none','USD','usd',now()-interval '1 hour',now()-interval '1 hour',NULL),
  ('31930000-0000-4000-8000-000000000105','31930000-0000-4000-8000-000000000001','I3193 EvDupMirror Dead One','i3193evdupmirror','Soft-deleted brand twin.','popup','none','USD','usd',now()-interval '3 hour',now()-interval '3 hour',now()-interval '2 hour'),
  ('31930000-0000-4000-8000-000000000106','31930000-0000-4000-8000-000000000001','I3193 EvDupMirror Dead Two','i3193evdupmirror','Soft-deleted brand twin.','popup','none','USD','usd',now()-interval '2 hour',now()-interval '2 hour',now()-interval '1 hour');
INSERT INTO public.events(id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,is_online,city,theme,published_at) VALUES
  ('31930000-0000-4000-8000-000000001045','31930000-0000-4000-8000-000000000104','31930000-0000-4000-8000-000000000001','I3193 Mirror Live Gig','A live, published event with no master date yet.','gig','event','public','scheduled','UTC',false,'Lagos','{}',now());

-- evrecreated + triprecreated (deterministic) — the tombstone carries an ENDED,
-- past-dated entity under the same slug; the recreated live one has no date yet.
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,created_at,updated_at) VALUES
  ('31930000-0000-4000-8000-000000000111','31930000-0000-4000-8000-000000000001','I3193 EvRec Old','i3193evrecreated','The brand before it was deleted.','popup','none','USD','usd',now()-interval '3 hour',now()-interval '3 hour'),
  ('31930000-0000-4000-8000-000000000121','31930000-0000-4000-8000-000000000001','I3193 TripRec Old','i3193triprecreated','The brand before it was deleted.','popup','none','USD','usd',now()-interval '3 hour',now()-interval '3 hour');
INSERT INTO public.events(id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,is_online,city,theme,published_at,destination_text) VALUES
  ('31930000-0000-4000-8000-000000001130','31930000-0000-4000-8000-000000000111','31930000-0000-4000-8000-000000000001','I3193 Old Gig','Ended.','gig','event','public','ended','UTC',false,'Lagos','{}',now(),NULL),
  ('31930000-0000-4000-8000-000000001230','31930000-0000-4000-8000-000000000121','31930000-0000-4000-8000-000000000001','I3193 Old Escape','Ended.','escape','trip','public','ended','UTC',false,'Lagos','{}',now(),'Lekki');
INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone) VALUES
  ('31930000-0000-4000-8000-000000001130',now()-interval '10 day',now()-interval '10 day'+interval '2 hour',true,'UTC'),
  ('31930000-0000-4000-8000-000000001230',now()-interval '10 day',now()-interval '10 day'+interval '2 hour',true,'UTC');
UPDATE public.brands SET deleted_at=now()-interval '2 hour'
WHERE id IN ('31930000-0000-4000-8000-000000000111','31930000-0000-4000-8000-000000000121');
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,created_at,updated_at) VALUES
  ('31930000-0000-4000-8000-000000000112','31930000-0000-4000-8000-000000000001','I3193 EvRec New','i3193evrecreated','The recreated brand.','popup','none','USD','usd',now()-interval '1 hour',now()-interval '1 hour'),
  ('31930000-0000-4000-8000-000000000122','31930000-0000-4000-8000-000000000001','I3193 TripRec New','i3193triprecreated','The recreated brand.','popup','none','USD','usd',now()-interval '1 hour',now()-interval '1 hour');
INSERT INTO public.events(id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,is_online,city,theme,published_at,destination_text) VALUES
  ('31930000-0000-4000-8000-000000001140','31930000-0000-4000-8000-000000000112','31930000-0000-4000-8000-000000000001','I3193 New Gig','Recreated, not dated yet.','gig','event','public','scheduled','UTC',false,'Lagos','{}',now(),NULL),
  ('31930000-0000-4000-8000-000000001240','31930000-0000-4000-8000-000000000122','31930000-0000-4000-8000-000000000001','I3193 New Escape','Recreated, not dated yet.','escape','trip','public','scheduled','UTC',false,'Lagos','{}',now(),'Lekki');

-- exptwin + evtwin (deterministic) — the OTHER axis: one live brand carries a
-- soft-deleted event twin with an EARLIER date and the live event with a later one.
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency) VALUES
  ('31930000-0000-4000-8000-000000000131','31930000-0000-4000-8000-000000000001','I3193 ExpTwin','i3193exptwin','One live brand.','popup','none','USD','usd'),
  ('31930000-0000-4000-8000-000000000141','31930000-0000-4000-8000-000000000001','I3193 EvTwin','i3193evtwin','One live brand.','popup','none','USD','usd');
INSERT INTO public.events(id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,is_online,city,theme,published_at,deleted_at) VALUES
  ('31930000-0000-4000-8000-000000001320','31930000-0000-4000-8000-000000000131','31930000-0000-4000-8000-000000000001','I3193 Dead Tour','Soft-deleted twin.','tour','experience','public','scheduled','UTC',false,'Lagos','{}',now(),now()-interval '1 hour'),
  ('31930000-0000-4000-8000-000000001330','31930000-0000-4000-8000-000000000131','31930000-0000-4000-8000-000000000001','I3193 Live Tour','The live experience.','tour','experience','public','scheduled','UTC',false,'Lagos','{}',now(),NULL),
  ('31930000-0000-4000-8000-000000001420','31930000-0000-4000-8000-000000000141','31930000-0000-4000-8000-000000000001','I3193 Dead Show','Soft-deleted twin.','show','event','public','scheduled','UTC',false,'Lagos','{}',now(),now()-interval '1 hour'),
  ('31930000-0000-4000-8000-000000001430','31930000-0000-4000-8000-000000000141','31930000-0000-4000-8000-000000000001','I3193 Live Show','The live event.','show','event','public','scheduled','UTC',false,'Lagos','{}',now(),NULL);
INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone) VALUES
  ('31930000-0000-4000-8000-000000001320',now()+interval '10 day',now()+interval '10 day 2 hour',true,'UTC'),
  ('31930000-0000-4000-8000-000000001330',now()+interval '20 day',now()+interval '20 day 2 hour',true,'UTC'),
  ('31930000-0000-4000-8000-000000001420',now()+interval '10 day',now()+interval '10 day 2 hour',true,'UTC'),
  ('31930000-0000-4000-8000-000000001430',now()+interval '20 day',now()+interval '20 day 2 hour',true,'UTC');

-- vdup (ambiguity) — the venue branch's inner join was believed to protect it.
-- `venue_listings_brand_slug_uniq` is per brand, so both twins own a `roof`.
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,created_at,updated_at,deleted_at) VALUES
  ('31930000-0000-4000-8000-000000000151','31930000-0000-4000-8000-000000000001','I3193 VDup Dead','i3193vdup','Soft-deleted brand twin.','popup','none','USD','usd',now()-interval '3 hour',now()-interval '3 hour',now()-interval '2 hour'),
  ('31930000-0000-4000-8000-000000000152','31930000-0000-4000-8000-000000000001','I3193 VDup Live','i3193vdup','The live brand.','popup','none','USD','usd',now()-interval '1 hour',now()-interval '1 hour',NULL);
INSERT INTO public.venue_listings(id,brand_id,slug,name,city,country_code,lat,lng,venue_category,claim_status,created_at) VALUES
  ('31930000-0000-4000-8000-000000001530','31930000-0000-4000-8000-000000000151','roof','I3193 Dead Roof','Lagos','NG',6.45,3.39,'restaurant','verified',now()-interval '3 hour'),
  ('31930000-0000-4000-8000-000000001540','31930000-0000-4000-8000-000000000152','roof','I3193 Live Roof','Lagos','NG',6.45,3.39,'restaurant','verified',now()-interval '1 hour');

-- vdupmirror (ambiguity, twin of vdup) — the live brand and its venue inserted
-- FIRST with the LOWEST ids, the tombstone brand and its venue after them.
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,created_at,updated_at,deleted_at) VALUES
  ('31930000-0000-4000-8000-000000000153','31930000-0000-4000-8000-000000000001','I3193 VDupMirror Live','i3193vdupmirror','The live brand, inserted first.','popup','none','USD','usd',now()-interval '1 hour',now()-interval '1 hour',NULL),
  ('31930000-0000-4000-8000-000000000154','31930000-0000-4000-8000-000000000001','I3193 VDupMirror Dead','i3193vdupmirror','Soft-deleted brand twin.','popup','none','USD','usd',now()-interval '3 hour',now()-interval '3 hour',now()-interval '2 hour');
INSERT INTO public.venue_listings(id,brand_id,slug,name,city,country_code,lat,lng,venue_category,claim_status,created_at) VALUES
  ('31930000-0000-4000-8000-000000001550','31930000-0000-4000-8000-000000000153','roof','I3193 Mirror Live Roof','Lagos','NG',6.45,3.39,'restaurant','verified',now()-interval '1 hour'),
  ('31930000-0000-4000-8000-000000001560','31930000-0000-4000-8000-000000000154','roof','I3193 Mirror Dead Roof','Lagos','NG',6.45,3.39,'restaurant','verified',now()-interval '3 hour');

INSERT INTO i3193_expect VALUES
  ('/e/i3193evdup/gig',            '31930000-0000-4000-8000-000000001040','event','ambiguity',    '/e/i3193evdupmirror/gig'),
  ('/e/i3193evdupmirror/gig',      '31930000-0000-4000-8000-000000001045','event','ambiguity',    '/e/i3193evdup/gig'),
  ('/e/i3193evrecreated/gig',      '31930000-0000-4000-8000-000000001140','event','deterministic',NULL),
  ('/t/i3193triprecreated/escape', '31930000-0000-4000-8000-000000001240','event','deterministic',NULL),
  ('/exp/i3193exptwin/tour',       '31930000-0000-4000-8000-000000001330','event','deterministic',NULL),
  ('/e/i3193evtwin/show',          '31930000-0000-4000-8000-000000001430','event','deterministic',NULL),
  ('/b/i3193vdup/v/roof',          '31930000-0000-4000-8000-000000001540','venue','ambiguity',    '/b/i3193vdupmirror/v/roof'),
  ('/b/i3193vdupmirror/v/roof',    '31930000-0000-4000-8000-000000001550','venue','ambiguity',    '/b/i3193vdup/v/roof');

-- Every twin link must be symmetric and point at a real fixture of the same
-- branch, or a pair check could silently compare a path with nothing.
DO $pairs$
BEGIN
  IF EXISTS (SELECT 1 FROM i3193_expect a LEFT JOIN i3193_expect b ON b.path=a.mirror_of
             WHERE a.class='ambiguity' AND (b.path IS NULL OR b.mirror_of IS DISTINCT FROM a.path OR b.branch<>a.branch)) THEN
    RAISE EXCEPTION 'ISSUE-3193 fixture FAIL: an ambiguity fixture has no symmetric mirror twin';
  END IF;
END
$pairs$;

-- H7: the SHIPPED body resolves every constructed path to its live entity, as
-- `public_noindex`, under all five planner configurations, with ONE identical
-- document per path. This is the total-order guarantee for every touched branch.
DO $h7$
DECLARE r record; cfg text; v jsonb; v_distinct int;
BEGIN
  FOR r IN SELECT * FROM i3193_expect ORDER BY path LOOP
    FOREACH cfg IN ARRAY ARRAY['seq-nestloop','seq-hash','seq-merge','index-scans','planner-default'] LOOP
      PERFORM pg_temp.i3193_plan_cfg(cfg);
      EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO v USING r.path;
      INSERT INTO i3193_multi VALUES ('shipped',r.path,cfg,v);
      IF v->>'state'<>'public_noindex' OR v->'facts'->>'id' IS DISTINCT FROM r.live_id::text THEN
        RAISE EXCEPTION 'ISSUE-3193 H7 FAIL: % (% branch) under plan % did not resolve its live entity: %',r.path,r.branch,cfg,v;
      END IF;
    END LOOP;
    PERFORM pg_temp.i3193_plan_cfg('planner-default');
    SELECT count(DISTINCT doc) INTO v_distinct FROM i3193_multi WHERE body='shipped' AND path=r.path;
    IF v_distinct<>1 THEN
      RAISE EXCEPTION 'ISSUE-3193 H7 FAIL: % returned % different documents across plans',r.path,v_distinct;
    END IF;
  END LOOP;
END
$h7$;

-- H8/H9: fails-on-revert controls, one per branch. Put that branch's pre-#3193
-- selection back into the real function, sweep the same rows, and require the
-- defect for the fixture's MEASURED class under the planner's own default:
--   ambiguity: `draft` under planner-default AND >= 2 distinct documents
--   deterministic: `draft` under ALL five plans
-- `draft` is what `handlePublicSearchDocument` serves as HTTP 404. Then restore
-- the shipped body and require the live page back. Every substitution is asserted
-- to have changed the definition, so an unmatched replace cannot read as a pass.
CREATE FUNCTION pg_temp.i3193_branch_control(p_branch text, p_from text, p_to text) RETURNS void
LANGUAGE plpgsql AS $ctl$
DECLARE v_shipped text; v_reverted text; r record; cfg text; v jsonb;
        v_default jsonb; v_distinct int; v_wrong int; v_paths int := 0;
        v_pairs int := 0; v_self boolean; v_twin boolean; v_pcfg text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM i3193_expect WHERE branch=p_branch) THEN
    RAISE EXCEPTION 'ISSUE-3193 % control FAIL: no fixture paths for this branch, so the control would sweep nothing',p_branch;
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_shipped
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='public_search_source_facts'
    AND pg_get_function_identity_arguments(p.oid)='p_path text, p_kind text';
  v_reverted := replace(v_shipped, p_from, p_to);
  IF v_reverted = v_shipped THEN
    RAISE EXCEPTION 'ISSUE-3193 % control FAIL: the shipped % ordering is absent, so this control proves nothing',p_branch,p_branch;
  END IF;
  EXECUTE v_reverted;
  FOR r IN SELECT * FROM i3193_expect WHERE branch=p_branch ORDER BY path LOOP
    FOREACH cfg IN ARRAY ARRAY['seq-nestloop','seq-hash','seq-merge','index-scans','planner-default'] LOOP
      PERFORM pg_temp.i3193_plan_cfg(cfg);
      EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO v USING r.path;
      INSERT INTO i3193_multi VALUES ('pre-3193',r.path,cfg,v);
      IF cfg='planner-default' THEN v_default := v; END IF;
    END LOOP;
    PERFORM pg_temp.i3193_plan_cfg('planner-default');
    SELECT count(DISTINCT doc), count(*) FILTER (WHERE doc->>'state'='draft')
      INTO v_distinct, v_wrong FROM i3193_multi WHERE body='pre-3193' AND path=r.path;
    -- A deterministic fixture must reproduce the 404 under the default plan on
    -- its own. An ambiguity fixture is only required to as a PAIR (below): which
    -- twin the default plan exposes depends on the table's statistics.
    IF r.class='deterministic' AND (v_default->>'state'<>'draft' OR v_default->'facts' IS DISTINCT FROM 'null'::jsonb) THEN
      RAISE EXCEPTION 'ISSUE-3193 % control FAIL: pre-fix % did not reproduce the 404 under the default plan: %',p_branch,r.path,v_default;
    END IF;
    IF r.class='deterministic' AND v_wrong<>5 THEN
      RAISE EXCEPTION 'ISSUE-3193 % control FAIL: deterministic fixture % was right under % of 5 plans',p_branch,r.path,5-v_wrong;
    END IF;
    v_paths := v_paths+1;
    RAISE NOTICE 'ISSUE-3193 % control: % [%] pre-fix default=% distinct=% wrong=%/5',
      p_branch,r.path,r.class,v_default->>'state',v_distinct,v_wrong;
  END LOOP;
  IF v_paths <> (SELECT count(*) FROM i3193_expect WHERE branch=p_branch) THEN
    RAISE EXCEPTION 'ISSUE-3193 % control FAIL: swept % paths, expected %',p_branch,v_paths,(SELECT count(*) FROM i3193_expect WHERE branch=p_branch);
  END IF;
  -- The ambiguity rule, per mirror pair and per plan: at least one twin reads a
  -- tombstone. Checked once per unordered pair.
  FOR r IN SELECT * FROM i3193_expect WHERE branch=p_branch AND class='ambiguity' AND path < mirror_of ORDER BY path LOOP
    FOREACH v_pcfg IN ARRAY ARRAY['seq-nestloop','seq-hash','seq-merge','index-scans','planner-default'] LOOP
      SELECT m.doc->>'state'='draft' AND m.doc->'facts'='null'::jsonb INTO v_self FROM i3193_multi m WHERE m.body='pre-3193' AND m.path=r.path AND m.cfg=v_pcfg;
      SELECT m.doc->>'state'='draft' AND m.doc->'facts'='null'::jsonb INTO v_twin FROM i3193_multi m WHERE m.body='pre-3193' AND m.path=r.mirror_of AND m.cfg=v_pcfg;
      IF v_self IS NULL OR v_twin IS NULL THEN
        RAISE EXCEPTION 'ISSUE-3193 % control FAIL: pair % / % has no recorded pre-fix result under plan %',p_branch,r.path,r.mirror_of,v_pcfg;
      END IF;
      IF NOT (v_self OR v_twin) THEN
        RAISE EXCEPTION 'ISSUE-3193 % control FAIL: under plan % the pre-fix selection read the live row for BOTH twins % and %, so the pair no longer reproduces the arbitrary row choice',p_branch,v_pcfg,r.path,r.mirror_of;
      END IF;
    END LOOP;
    v_pairs := v_pairs+1;
    RAISE NOTICE 'ISSUE-3193 % control: pair % / % -> >= 1 twin read a tombstone under all 5 plans',p_branch,r.path,r.mirror_of;
  END LOOP;
  IF v_pairs <> (SELECT count(*) FROM i3193_expect WHERE branch=p_branch AND class='ambiguity') / 2 THEN
    RAISE EXCEPTION 'ISSUE-3193 % control FAIL: checked % mirror pairs, expected %',p_branch,v_pairs,(SELECT count(*) FROM i3193_expect WHERE branch=p_branch AND class='ambiguity')/2;
  END IF;
  EXECUTE v_shipped;
  FOR r IN SELECT * FROM i3193_expect WHERE branch=p_branch LOOP
    EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO v USING r.path;
    IF v->>'state'<>'public_noindex' OR v->'facts'->>'id' IS DISTINCT FROM r.live_id::text THEN
      RAISE EXCEPTION 'ISSUE-3193 % control FAIL: restoring the shipped body did not restore % : %',p_branch,r.path,v;
    END IF;
  END LOOP;
  DELETE FROM i3193_multi WHERE body='pre-3193';
END
$ctl$;

-- H8: event / trip / experience.
SELECT pg_temp.i3193_branch_control('event',
  E'    WHERE b.slug=v_parts[2]\n    ORDER BY (e.id IS NOT NULL AND ((p_kind=''event'' AND e.event_type IN (''event'',''rsvp'')) OR e.event_type=p_kind)) DESC,\n      (e.id IS NOT NULL) DESC,\n      (b.deleted_at IS NULL) DESC,\n      (e.deleted_at IS NULL) DESC,\n      ed.start_at NULLS LAST, e.id, b.id, ed.id\n    LIMIT 1;',
  E'    WHERE b.slug=v_parts[2]\n    ORDER BY ed.start_at NULLS LAST LIMIT 1;');

-- H9: venue.
SELECT pg_temp.i3193_branch_control('venue',
  E'    WHERE b.slug=v_parts[2] AND v.slug=v_parts[4]\n    ORDER BY (b.deleted_at IS NULL) DESC, v.created_at DESC, v.id\n    LIMIT 1;',
  E'    WHERE b.slug=v_parts[2] AND v.slug=v_parts[4] LIMIT 1;');

ROLLBACK;
SELECT 'issue_3193_public_search_live_brand_row implementor happy: PASS' AS result;
