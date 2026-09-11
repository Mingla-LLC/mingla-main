-- Issue #3193 implementor happy-path contract (PostgreSQL 17).
--
-- The defect was a missing `ORDER BY`: `public.public_search_source_facts`
-- selected the brand with `WHERE b.slug = v_parts[2] LIMIT 1` -- no `deleted_at`
-- filter, no ordering -- so a slug carrying soft-deleted twins resolved from
-- whichever row the chosen plan emitted first. No static gate can see a missing
-- `ORDER BY`, and no #2986 fixture ever created two rows under one slug, so this
-- suite is behavioural: it builds a multi-row slug, sweeps planner
-- configurations, and asserts on what the real anonymous resolver returns.
--
-- One transaction + ROLLBACK: no fixture survives, and H3's temporary
-- `CREATE OR REPLACE` of the production function is rolled back with everything
-- else.

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE i3193_defs(name text PRIMARY KEY, def text NOT NULL);
CREATE TEMP TABLE i3193_sweep(body text NOT NULL, cfg text NOT NULL, doc jsonb, PRIMARY KEY(body,cfg));

-- The five planner configurations swept below. `planner-default` is the one
-- production runs; the other four force the join and scan strategies that make
-- an unordered `LIMIT 1` return a different row.
CREATE FUNCTION pg_temp.i3193_plan_cfg(p_cfg text) RETURNS void LANGUAGE plpgsql AS $cfg$
BEGIN
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
DECLARE cfg text; v jsonb; v_distinct int;
BEGIN
  FOREACH cfg IN ARRAY ARRAY['seq-nestloop','seq-hash','seq-merge','index-scans','planner-default'] LOOP
    PERFORM pg_temp.i3193_plan_cfg(cfg);
    EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO v USING '/b/i3193dup';
    INSERT INTO i3193_sweep VALUES ('shipped',cfg,v);
    IF v->>'state'<>'public_noindex' OR v->'facts'->>'id'<>'31930000-0000-4000-8000-000000000012' THEN
      RAISE EXCEPTION 'ISSUE-3193 H2 FAIL: plan % read a row other than the live brand: %',cfg,v;
    END IF;
  END LOOP;
  PERFORM pg_temp.i3193_plan_cfg('planner-default');
  SELECT count(DISTINCT doc) INTO v_distinct FROM i3193_sweep WHERE body='shipped';
  IF v_distinct<>1 THEN
    RAISE EXCEPTION 'ISSUE-3193 H2 FAIL: the shipped resolver returned % different documents across plans',v_distinct;
  END IF;
END
$h2$;

-- H3: fails-on-revert control. Put the pre-#3193 row selection back into the real
-- function and re-run the same sweep over the same rows. Two things must hold,
-- and together they ARE the defect: under the planner's own default configuration
-- the page resolves `draft` -- which `handlePublicSearchDocument` serves as HTTP
-- 404, exactly what production did for `lanternroom` -- and the answer is not even
-- stable across plans, which is why no static gate could have caught it. Then the
-- shipped body is restored and the page is public again. The substitution is
-- asserted to have actually changed the definition, so a silently unmatched
-- replace cannot read as a pass.
DO $h3$
DECLARE v_fixed text; v_reverted text; cfg text; v jsonb; v_distinct int; v_default jsonb;
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
    EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO v USING '/b/i3193dup';
    INSERT INTO i3193_sweep VALUES ('pre-3193',cfg,v);
    IF cfg='planner-default' THEN v_default := v; END IF;
  END LOOP;
  PERFORM pg_temp.i3193_plan_cfg('planner-default');

  IF v_default->>'state'<>'draft' OR v_default->'facts' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'ISSUE-3193 H3 FAIL: the pre-fix selection did not reproduce the production 404 under the default plan: %',v_default;
  END IF;
  SELECT count(DISTINCT doc) INTO v_distinct FROM i3193_sweep WHERE body='pre-3193';
  IF v_distinct<2 THEN
    RAISE EXCEPTION 'ISSUE-3193 H3 FAIL: the pre-fix selection was stable across every plan, so this fixture no longer reproduces the arbitrary row choice';
  END IF;

  EXECUTE (SELECT def FROM i3193_defs WHERE name='shipped');
  EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO v USING '/b/i3193dup';
  IF v->>'state'<>'public_noindex' OR v->'facts'->>'id'<>'31930000-0000-4000-8000-000000000012' THEN
    RAISE EXCEPTION 'ISSUE-3193 H3 FAIL: restoring the shipped body did not restore the live page: %',v;
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

ROLLBACK;
SELECT 'issue_3193_public_search_live_brand_row implementor happy: PASS' AS result;
