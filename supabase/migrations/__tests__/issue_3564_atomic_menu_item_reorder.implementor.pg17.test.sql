-- Issue #3564 — implementor proof for atomic complete-order menu-item reorder.
-- Runs after the exact from-zero PostgreSQL 17 migration replay and rolls back.
\set ON_ERROR_STOP on
BEGIN;

DO $catalog$
DECLARE
  v_sig regprocedure := 'public.biz_reorder_menu_items_v1(uuid,uuid,uuid,jsonb,uuid[])'::regprocedure;
  v_definition text;
BEGIN
  IF (SELECT l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = v_sig) <> 'plpgsql'
     OR (SELECT provolatile FROM pg_proc WHERE oid = v_sig) <> 'v'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_sig)
     OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = v_sig) <> 'postgres'
     OR (SELECT proconfig FROM pg_proc WHERE oid = v_sig)
        IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION 'ISSUE-3564 I-CATALOG-1: RPC owner/language/volatility/security/search_path drifted';
  END IF;
  IF EXISTS (
       SELECT 1 FROM pg_proc p, pg_catalog.aclexplode(p.proacl) a
       WHERE p.oid = v_sig AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
     )
     OR has_function_privilege('anon', v_sig, 'EXECUTE')
     OR has_function_privilege('service_role', v_sig, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'ISSUE-3564 I-CATALOG-2: function execute ACL is not authenticated-only';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.menus'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.menu_items'::regclass) THEN
    RAISE EXCEPTION 'ISSUE-3564 I-CATALOG-3: existing table RLS was weakened';
  END IF;
  -- #1856 deliberately recorded these legacy broad table grants as debt. This
  -- issue changes only a function ACL, so pin the inherited posture exactly
  -- rather than silently repairing or widening it in this unrelated migration.
  IF NOT has_table_privilege('anon', 'public.menus', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     OR NOT has_table_privilege('anon', 'public.menu_items', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     OR NOT has_table_privilege('authenticated', 'public.menus', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     OR NOT has_table_privilege('authenticated', 'public.menu_items', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     OR NOT has_table_privilege('service_role', 'public.menus', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     OR NOT has_table_privilege('service_role', 'public.menu_items', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
    RAISE EXCEPTION 'ISSUE-3564 I-CATALOG-4: inherited #1856 menu table-grant posture drifted';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'menus') <> 2
     OR (SELECT pg_catalog.count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'menu_items') <> 2 THEN
    RAISE EXCEPTION 'ISSUE-3564 I-CATALOG-5: existing menu policy set changed';
  END IF;
  v_definition := pg_catalog.pg_get_functiondef(v_sig);
  IF v_definition !~ '(?s)FROM public\.menus candidate.*FOR UPDATE'
     OR v_definition !~ '(?s)FROM public\.menu_items current_item.*ORDER BY current_item\.id.*FOR UPDATE' THEN
    RAISE EXCEPTION 'ISSUE-3564 I-CATALOG-6: deterministic parent/item locks are missing';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.regexp_matches(
        v_definition,
        'UPDATE public\.menu_items item',
        'g'
      )) <> 1 THEN
    RAISE EXCEPTION 'ISSUE-3564 I-CATALOG-7: reorder is not one set-based item update';
  END IF;
  IF v_definition !~ '(?s)brand_id IS DISTINCT FROM p_brand_id.*menu_item_reorder_child_scope_forbidden'
     OR v_definition !~ '(?s)UPDATE public\.menu_items item.*item\.menu_id = p_menu_id.*item\.brand_id = p_brand_id' THEN
    RAISE EXCEPTION 'ISSUE-3564 I-CATALOG-8: child brand fail-closed/update scope is missing';
  END IF;
END;
$catalog$;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('3564a000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-3564@example.test',now(),now()),
  ('3564a000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','finance-3564@example.test',now(),now()),
  ('3564a000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','foreign-3564@example.test',now(),now());
INSERT INTO public.creator_accounts (id, created_at)
VALUES
  ('3564a000-0000-4000-8000-000000000001',now()),
  ('3564a000-0000-4000-8000-000000000002',now()),
  ('3564a000-0000-4000-8000-000000000003',now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES
  ('3564a100-0000-4000-8000-000000000001','3564a000-0000-4000-8000-000000000001','Issue 3564 Brand','issue-3564-brand','USD',now(),now()),
  ('3564a100-0000-4000-8000-000000000002','3564a000-0000-4000-8000-000000000003','Issue 3564 Foreign','issue-3564-foreign','EUR',now(),now());
INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at)
VALUES ('3564a100-0000-4000-8000-000000000001','3564a000-0000-4000-8000-000000000002','finance_manager',now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status)
VALUES
  ('3564a200-0000-4000-8000-000000000001','3564a100-0000-4000-8000-000000000001','issue3564venue','Issue 3564 Venue',40.7,-74.0,'restaurant','verified'),
  ('3564a200-0000-4000-8000-000000000002','3564a100-0000-4000-8000-000000000002','issue3564foreign','Issue 3564 Foreign Venue',48.8,2.3,'restaurant','verified');
INSERT INTO public.menus (id, brand_id, venue_id, name, sort_order)
VALUES
  ('3564a300-0000-4000-8000-000000000001','3564a100-0000-4000-8000-000000000001','3564a200-0000-4000-8000-000000000001','Dinner',0),
  ('3564a300-0000-4000-8000-000000000002','3564a100-0000-4000-8000-000000000002','3564a200-0000-4000-8000-000000000002','Foreign',0),
  ('3564a300-0000-4000-8000-000000000003','3564a100-0000-4000-8000-000000000001','3564a200-0000-4000-8000-000000000001','Two items',1);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, sort_order, is_available)
VALUES
  ('3564a400-0000-4000-8000-000000000001','3564a300-0000-4000-8000-000000000001','3564a100-0000-4000-8000-000000000001','Alpha',100,'USD',0,true),
  ('3564a400-0000-4000-8000-000000000002','3564a300-0000-4000-8000-000000000001','3564a100-0000-4000-8000-000000000001','Bravo',200,'USD',1,true),
  ('3564a400-0000-4000-8000-000000000003','3564a300-0000-4000-8000-000000000001','3564a100-0000-4000-8000-000000000001','Charlie',300,'USD',2,false),
  ('3564a400-0000-4000-8000-000000000004','3564a300-0000-4000-8000-000000000001','3564a100-0000-4000-8000-000000000001','Delta',400,'USD',3,true),
  ('3564a400-0000-4000-8000-000000000005','3564a300-0000-4000-8000-000000000002','3564a100-0000-4000-8000-000000000002','Foreign item',500,'EUR',0,true),
  ('3564a400-0000-4000-8000-000000000007','3564a300-0000-4000-8000-000000000003','3564a100-0000-4000-8000-000000000001','Two A',700,'USD',0,true),
  ('3564a400-0000-4000-8000-000000000008','3564a300-0000-4000-8000-000000000003','3564a100-0000-4000-8000-000000000001','Two B',800,'USD',1,true);

CREATE FUNCTION pg_temp.issue_3564_state() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('id',item.id,'sort_order',item.sort_order)
    ORDER BY item.id
  ), '[]'::jsonb)
  FROM public.menu_items item
  WHERE item.menu_id = '3564a300-0000-4000-8000-000000000001'
$$;

-- The complete multi-item replacement returns the canonical contiguous order,
-- and the same stale expected snapshot is a successful ambiguous replay.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"3564a000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','3564a000-0000-4000-8000-000000000001',true);
DO $two_item$
DECLARE v_result jsonb;
BEGIN
  v_result := public.biz_reorder_menu_items_v1(
    '3564a100-0000-4000-8000-000000000001',
    '3564a200-0000-4000-8000-000000000001',
    '3564a300-0000-4000-8000-000000000003',
    '[
      {"id":"3564a400-0000-4000-8000-000000000007","sort_order":0},
      {"id":"3564a400-0000-4000-8000-000000000008","sort_order":1}
    ]'::jsonb,
    ARRAY[
      '3564a400-0000-4000-8000-000000000008',
      '3564a400-0000-4000-8000-000000000007'
    ]::uuid[]
  );
  IF v_result#>>'{items,0,id}' <> '3564a400-0000-4000-8000-000000000008'
     OR v_result#>>'{items,1,id}' <> '3564a400-0000-4000-8000-000000000007' THEN
    RAISE EXCEPTION 'ISSUE-3564 I-TWO-1: distinct two-item swap failed: %', v_result;
  END IF;
END;
$two_item$;

DO $happy$
DECLARE v_result jsonb;
BEGIN
  v_result := public.biz_reorder_menu_items_v1(
    '3564a100-0000-4000-8000-000000000001',
    '3564a200-0000-4000-8000-000000000001',
    '3564a300-0000-4000-8000-000000000001',
    '[
      {"id":"3564a400-0000-4000-8000-000000000001","sort_order":0},
      {"id":"3564a400-0000-4000-8000-000000000002","sort_order":1},
      {"id":"3564a400-0000-4000-8000-000000000003","sort_order":2},
      {"id":"3564a400-0000-4000-8000-000000000004","sort_order":3}
    ]'::jsonb,
    ARRAY[
      '3564a400-0000-4000-8000-000000000003',
      '3564a400-0000-4000-8000-000000000001',
      '3564a400-0000-4000-8000-000000000004',
      '3564a400-0000-4000-8000-000000000002'
    ]::uuid[]
  );
  IF v_result->>'brand_id' <> '3564a100-0000-4000-8000-000000000001'
     OR v_result->>'venue_id' <> '3564a200-0000-4000-8000-000000000001'
     OR v_result->>'menu_id' <> '3564a300-0000-4000-8000-000000000001'
     OR v_result#>>'{items,0,id}' <> '3564a400-0000-4000-8000-000000000003'
     OR v_result#>>'{items,3,id}' <> '3564a400-0000-4000-8000-000000000002'
     OR (v_result#>>'{items,3,sort_order}')::integer <> 3 THEN
    RAISE EXCEPTION 'ISSUE-3564 I-HAPPY-1: canonical response is wrong: %', v_result;
  END IF;

  v_result := public.biz_reorder_menu_items_v1(
    '3564a100-0000-4000-8000-000000000001',
    '3564a200-0000-4000-8000-000000000001',
    '3564a300-0000-4000-8000-000000000001',
    '[
      {"id":"3564a400-0000-4000-8000-000000000001","sort_order":0},
      {"id":"3564a400-0000-4000-8000-000000000002","sort_order":1},
      {"id":"3564a400-0000-4000-8000-000000000003","sort_order":2},
      {"id":"3564a400-0000-4000-8000-000000000004","sort_order":3}
    ]'::jsonb,
    ARRAY[
      '3564a400-0000-4000-8000-000000000003',
      '3564a400-0000-4000-8000-000000000001',
      '3564a400-0000-4000-8000-000000000004',
      '3564a400-0000-4000-8000-000000000002'
    ]::uuid[]
  );
  IF v_result#>>'{items,0,id}' <> '3564a400-0000-4000-8000-000000000003' THEN
    RAISE EXCEPTION 'ISSUE-3564 I-HAPPY-2: desired-already-current replay failed';
  END IF;
  IF (SELECT pg_catalog.string_agg(item.id::text, ',' ORDER BY item.item_sort_order)
        FROM public.public_menus_view item
       WHERE item.menu_id = '3564a300-0000-4000-8000-000000000001')
     <> '3564a400-0000-4000-8000-000000000001,3564a400-0000-4000-8000-000000000004,3564a400-0000-4000-8000-000000000002' THEN
    RAISE EXCEPTION 'ISSUE-3564 I-HAPPY-3: public read did not receive canonical order';
  END IF;
  IF (SELECT item.sort_order FROM public.menu_items item WHERE item.id = '3564a400-0000-4000-8000-000000000003') <> 0
     OR (SELECT item.is_available FROM public.menu_items item WHERE item.id = '3564a400-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'ISSUE-3564 I-HAPPY-4: unavailable item was omitted or availability changed';
  END IF;
END;
$happy$;

-- Exercise adjacent moves from the first, a middle, and the last position.
-- Every call owns all four rows, including the unavailable item.
DO $boundaries$
DECLARE v_result jsonb;
BEGIN
  v_result := public.biz_reorder_menu_items_v1(
    '3564a100-0000-4000-8000-000000000001','3564a200-0000-4000-8000-000000000001','3564a300-0000-4000-8000-000000000001',
    '[{"id":"3564a400-0000-4000-8000-000000000003","sort_order":0},{"id":"3564a400-0000-4000-8000-000000000001","sort_order":1},{"id":"3564a400-0000-4000-8000-000000000004","sort_order":2},{"id":"3564a400-0000-4000-8000-000000000002","sort_order":3}]'::jsonb,
    ARRAY['3564a400-0000-4000-8000-000000000001','3564a400-0000-4000-8000-000000000003','3564a400-0000-4000-8000-000000000004','3564a400-0000-4000-8000-000000000002']::uuid[]
  );
  IF v_result#>>'{items,0,id}' <> '3564a400-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'ISSUE-3564 I-BOUNDARY-1: first-position down move failed';
  END IF;

  v_result := public.biz_reorder_menu_items_v1(
    '3564a100-0000-4000-8000-000000000001','3564a200-0000-4000-8000-000000000001','3564a300-0000-4000-8000-000000000001',
    '[{"id":"3564a400-0000-4000-8000-000000000001","sort_order":0},{"id":"3564a400-0000-4000-8000-000000000003","sort_order":1},{"id":"3564a400-0000-4000-8000-000000000004","sort_order":2},{"id":"3564a400-0000-4000-8000-000000000002","sort_order":3}]'::jsonb,
    ARRAY['3564a400-0000-4000-8000-000000000001','3564a400-0000-4000-8000-000000000004','3564a400-0000-4000-8000-000000000003','3564a400-0000-4000-8000-000000000002']::uuid[]
  );
  IF v_result#>>'{items,1,id}' <> '3564a400-0000-4000-8000-000000000004' THEN
    RAISE EXCEPTION 'ISSUE-3564 I-BOUNDARY-2: middle-position up move failed';
  END IF;

  v_result := public.biz_reorder_menu_items_v1(
    '3564a100-0000-4000-8000-000000000001','3564a200-0000-4000-8000-000000000001','3564a300-0000-4000-8000-000000000001',
    '[{"id":"3564a400-0000-4000-8000-000000000001","sort_order":0},{"id":"3564a400-0000-4000-8000-000000000004","sort_order":1},{"id":"3564a400-0000-4000-8000-000000000003","sort_order":2},{"id":"3564a400-0000-4000-8000-000000000002","sort_order":3}]'::jsonb,
    ARRAY['3564a400-0000-4000-8000-000000000001','3564a400-0000-4000-8000-000000000004','3564a400-0000-4000-8000-000000000002','3564a400-0000-4000-8000-000000000003']::uuid[]
  );
  IF v_result#>>'{items,2,id}' <> '3564a400-0000-4000-8000-000000000002'
     OR EXISTS (
       SELECT 1 FROM public.menu_items item
       WHERE item.menu_id = '3564a300-0000-4000-8000-000000000001'
         AND item.sort_order NOT BETWEEN 0 AND 3
     ) THEN
    RAISE EXCEPTION 'ISSUE-3564 I-BOUNDARY-3: last-position up/contiguous normalization failed';
  END IF;
END;
$boundaries$;

-- Stale positions, incomplete/duplicate sets, and a forced mid-update failure
-- all preserve the byte-identical pre-call item state.
DO $rollback$
DECLARE
  v_before jsonb;
  v_state text;
BEGIN
  v_before := pg_temp.issue_3564_state();
  BEGIN
    PERFORM public.biz_reorder_menu_items_v1(
      '3564a100-0000-4000-8000-000000000001','3564a200-0000-4000-8000-000000000001','3564a300-0000-4000-8000-000000000001',
      '[{"id":"3564a400-0000-4000-8000-000000000001","sort_order":0},{"id":"3564a400-0000-4000-8000-000000000002","sort_order":1},{"id":"3564a400-0000-4000-8000-000000000003","sort_order":2},{"id":"3564a400-0000-4000-8000-000000000004","sort_order":3}]'::jsonb,
      ARRAY['3564a400-0000-4000-8000-000000000001','3564a400-0000-4000-8000-000000000003','3564a400-0000-4000-8000-000000000004','3564a400-0000-4000-8000-000000000002']::uuid[]
    );
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  IF v_state IS DISTINCT FROM '40001' OR pg_temp.issue_3564_state() IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3564 I-ROLLBACK-1: stale snapshot was not zero-side-effect 40001 (%)', coalesce(v_state,'success');
  END IF;

  v_state := NULL;
  BEGIN
    PERFORM public.biz_reorder_menu_items_v1(
      '3564a100-0000-4000-8000-000000000001','3564a200-0000-4000-8000-000000000001','3564a300-0000-4000-8000-000000000001',
      '[{"id":"3564a400-0000-4000-8000-000000000003","sort_order":0}]'::jsonb,
      ARRAY['3564a400-0000-4000-8000-000000000003','3564a400-0000-4000-8000-000000000001']::uuid[]
    );
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  IF v_state IS DISTINCT FROM '22023' OR pg_temp.issue_3564_state() IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3564 I-ROLLBACK-2: internally mismatched sets were not zero-side-effect 22023 (%)', coalesce(v_state,'success');
  END IF;

  v_state := NULL;
  BEGIN
    PERFORM public.biz_reorder_menu_items_v1(
      '3564a100-0000-4000-8000-000000000001','3564a200-0000-4000-8000-000000000001','3564a300-0000-4000-8000-000000000001',
      '[{"id":"3564a400-0000-4000-8000-000000000003","sort_order":0}]'::jsonb,
      ARRAY['3564a400-0000-4000-8000-000000000003']::uuid[]
    );
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  IF v_state IS DISTINCT FROM '40001' OR pg_temp.issue_3564_state() IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3564 I-ROLLBACK-2B: valid client set vs locked membership was not zero-side-effect 40001 (%)', coalesce(v_state,'success');
  END IF;

  v_state := NULL;
  BEGIN
    PERFORM public.biz_reorder_menu_items_v1(
      '3564a100-0000-4000-8000-000000000001','3564a200-0000-4000-8000-000000000001','3564a300-0000-4000-8000-000000000001',
      '[{"id":"3564a400-0000-4000-8000-000000000003","sort_order":0},{"id":"3564a400-0000-4000-8000-000000000001","sort_order":1},{"id":"3564a400-0000-4000-8000-000000000004","sort_order":2},{"id":"3564a400-0000-4000-8000-000000000002","sort_order":3}]'::jsonb,
      ARRAY['3564a400-0000-4000-8000-000000000003','3564a400-0000-4000-8000-000000000003','3564a400-0000-4000-8000-000000000004','3564a400-0000-4000-8000-000000000002']::uuid[]
    );
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  IF v_state IS DISTINCT FROM '22023' OR pg_temp.issue_3564_state() IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3564 I-ROLLBACK-3: duplicate desired set was not refused atomically (%)', coalesce(v_state,'success');
  END IF;

  v_state := NULL;
  BEGIN
    PERFORM public.biz_reorder_menu_items_v1(
      '3564a100-0000-4000-8000-000000000001','3564a200-0000-4000-8000-000000000001','3564a300-0000-4000-8000-000000000001',
      '[{"id":"3564a400-0000-4000-8000-000000000001","sort_order":0},{"id":"3564a400-0000-4000-8000-000000000002","sort_order":1},{"id":"3564a400-0000-4000-8000-000000000003","sort_order":2},{"id":"3564a400-0000-4000-8000-000000000005","sort_order":0}]'::jsonb,
      ARRAY['3564a400-0000-4000-8000-000000000001','3564a400-0000-4000-8000-000000000002','3564a400-0000-4000-8000-000000000003','3564a400-0000-4000-8000-000000000005']::uuid[]
    );
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  IF v_state IS DISTINCT FROM '40001' OR pg_temp.issue_3564_state() IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3564 I-ROLLBACK-4: foreign matching client set was not zero-side-effect 40001 (%)', coalesce(v_state,'success');
  END IF;
END;
$rollback$;

DO $malformed$
DECLARE v_before jsonb := pg_temp.issue_3564_state(); v_state text;
BEGIN
  BEGIN
    PERFORM public.biz_reorder_menu_items_v1(
      '3564a100-0000-4000-8000-000000000001','3564a200-0000-4000-8000-000000000001','3564a300-0000-4000-8000-000000000001',
      '{}'::jsonb,
      ARRAY[]::uuid[]
    );
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  IF v_state IS DISTINCT FROM '22023' OR pg_temp.issue_3564_state() IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3564 I-MALFORMED-1: non-array expected JSON was not zero-side-effect 22023 (%)', coalesce(v_state,'success');
  END IF;

  v_state := NULL;
  BEGIN
    PERFORM public.biz_reorder_menu_items_v1(
      '3564a100-0000-4000-8000-000000000001','3564a200-0000-4000-8000-000000000001','3564a300-0000-4000-8000-000000000001',
      '[{"id":"3564a400-0000-4000-8000-000000000001","sort_order":0,"extra":true}]'::jsonb,
      ARRAY['3564a400-0000-4000-8000-000000000001']::uuid[]
    );
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  IF v_state IS DISTINCT FROM '22023' OR pg_temp.issue_3564_state() IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3564 I-MALFORMED-2: extra expected key was not zero-side-effect 22023 (%)', coalesce(v_state,'success');
  END IF;

  v_state := NULL;
  BEGIN
    PERFORM public.biz_reorder_menu_items_v1(
      '3564a100-0000-4000-8000-000000000001','3564a200-0000-4000-8000-000000000001','3564a300-0000-4000-8000-000000000001',
      '[{"id":"3564a400-0000-4000-8000-000000000001","sort_order":1.5}]'::jsonb,
      NULL::uuid[]
    );
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  IF v_state IS DISTINCT FROM '22023' OR pg_temp.issue_3564_state() IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3564 I-MALFORMED-3: null desired array was not zero-side-effect 22023 (%)', coalesce(v_state,'success');
  END IF;

  v_state := NULL;
  BEGIN
    PERFORM public.biz_reorder_menu_items_v1(
      '3564a100-0000-4000-8000-000000000001','3564a200-0000-4000-8000-000000000001','3564a300-0000-4000-8000-000000000001',
      '[{"id":"3564a400-0000-4000-8000-000000000001","sort_order":1.5}]'::jsonb,
      ARRAY['3564a400-0000-4000-8000-000000000001']::uuid[]
    );
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  IF v_state IS DISTINCT FROM '22023' OR pg_temp.issue_3564_state() IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3564 I-MALFORMED-4: non-integer expected value was not zero-side-effect 22023 (%)', coalesce(v_state,'success');
  END IF;
END;
$malformed$;

RESET ROLE;

-- Below-manager and foreign venue scopes fail as permission errors without a
-- row change. This proves the definer function does not bypass its own gate.
DO $authorization$
DECLARE v_before jsonb; v_state text;
BEGIN
  v_before := pg_temp.issue_3564_state();
  PERFORM set_config('request.jwt.claims','{"sub":"3564a000-0000-4000-8000-000000000002","role":"authenticated"}',true);
  PERFORM set_config('request.jwt.claim.sub','3564a000-0000-4000-8000-000000000002',true);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.biz_reorder_menu_items_v1(
      '3564a100-0000-4000-8000-000000000001','3564a200-0000-4000-8000-000000000001','3564a300-0000-4000-8000-000000000001','[]'::jsonb,ARRAY[]::uuid[]
    );
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; RESET ROLE; END;
  IF v_state IS DISTINCT FROM '42501' OR pg_temp.issue_3564_state() IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3564 I-AUTH-1: below-manager call was not zero-side-effect 42501 (%)', coalesce(v_state,'success');
  END IF;

  v_state := NULL;
  PERFORM set_config('request.jwt.claims','{"sub":"3564a000-0000-4000-8000-000000000001","role":"authenticated"}',true);
  PERFORM set_config('request.jwt.claim.sub','3564a000-0000-4000-8000-000000000001',true);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.biz_reorder_menu_items_v1(
      '3564a100-0000-4000-8000-000000000001','3564a200-0000-4000-8000-000000000002','3564a300-0000-4000-8000-000000000001','[]'::jsonb,ARRAY[]::uuid[]
    );
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; RESET ROLE; END;
  IF v_state IS DISTINCT FROM '42501' OR pg_temp.issue_3564_state() IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3564 I-AUTH-2: foreign venue scope was not zero-side-effect 42501 (%)', coalesce(v_state,'success');
  END IF;

  v_state := NULL;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.biz_reorder_menu_items_v1(
      '3564a100-0000-4000-8000-000000000001','3564a200-0000-4000-8000-000000000001','3564a300-0000-4000-8000-000000000002','[]'::jsonb,ARRAY[]::uuid[]
    );
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; RESET ROLE; END;
  IF v_state IS DISTINCT FROM '42501' OR pg_temp.issue_3564_state() IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3564 I-AUTH-3: wrong-menu scope was not zero-side-effect 42501 (%)', coalesce(v_state,'success');
  END IF;

  v_state := NULL;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.biz_reorder_menu_items_v1(
      '3564a100-0000-4000-8000-000000000002','3564a200-0000-4000-8000-000000000001','3564a300-0000-4000-8000-000000000001','[]'::jsonb,ARRAY[]::uuid[]
    );
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; RESET ROLE; END;
  IF v_state IS DISTINCT FROM '42501' OR pg_temp.issue_3564_state() IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3564 I-AUTH-4: wrong-brand scope was not zero-side-effect 42501 (%)', coalesce(v_state,'success');
  END IF;

  v_state := NULL;
  PERFORM set_config('request.jwt.claims','{}',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.biz_reorder_menu_items_v1(
      '3564a100-0000-4000-8000-000000000001','3564a200-0000-4000-8000-000000000001','3564a300-0000-4000-8000-000000000001','[]'::jsonb,ARRAY[]::uuid[]
    );
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; RESET ROLE; END;
  IF v_state IS DISTINCT FROM '42501' OR pg_temp.issue_3564_state() IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3564 I-AUTH-5: unauthenticated call was not zero-side-effect 42501 (%)', coalesce(v_state,'success');
  END IF;
END;
$authorization$;

-- menu_items has independent menu and brand foreign keys. A malformed child
-- under the authorized parent but owned by another brand must fail closed
-- after locking, without changing or returning any row from either brand.
INSERT INTO public.menu_items (
  id, menu_id, brand_id, name, price_cents, currency, sort_order
) VALUES (
  '3564a400-0000-4000-8000-000000000006',
  '3564a300-0000-4000-8000-000000000001',
  '3564a100-0000-4000-8000-000000000002',
  'Malformed cross-brand child',
  600,
  'EUR',
  99
);

DO $cross_brand_child$
DECLARE v_before jsonb := pg_temp.issue_3564_state(); v_state text; v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"3564a000-0000-4000-8000-000000000001","role":"authenticated"}',true);
  PERFORM set_config('request.jwt.claim.sub','3564a000-0000-4000-8000-000000000001',true);
  BEGIN
    SET LOCAL ROLE authenticated;
    v_result := public.biz_reorder_menu_items_v1(
      '3564a100-0000-4000-8000-000000000001',
      '3564a200-0000-4000-8000-000000000001',
      '3564a300-0000-4000-8000-000000000001',
      '[]'::jsonb,
      ARRAY[]::uuid[]
    );
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; RESET ROLE; END;
  IF v_state IS DISTINCT FROM '42501'
     OR v_result IS NOT NULL
     OR pg_temp.issue_3564_state() IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3564 I-AUTH-6: cross-brand child did not fail closed with zero writes/no response (%, %)', coalesce(v_state,'success'), v_result;
  END IF;
END;
$cross_brand_child$;

DELETE FROM public.menu_items
 WHERE id = '3564a400-0000-4000-8000-000000000006';

CREATE FUNCTION public.issue_3564_force_update_failure() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF NEW.id = '3564a400-0000-4000-8000-000000000004'::uuid THEN
    RAISE EXCEPTION 'issue_3564_forced_update_failure';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_3564_force_update_failure
AFTER UPDATE ON public.menu_items
FOR EACH ROW EXECUTE FUNCTION public.issue_3564_force_update_failure();

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"3564a000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','3564a000-0000-4000-8000-000000000001',true);

DO $forced_failure$
DECLARE v_before jsonb := pg_temp.issue_3564_state(); v_state text; v_message text;
BEGIN
  BEGIN
    PERFORM public.biz_reorder_menu_items_v1(
      '3564a100-0000-4000-8000-000000000001','3564a200-0000-4000-8000-000000000001','3564a300-0000-4000-8000-000000000001',
      '[{"id":"3564a400-0000-4000-8000-000000000001","sort_order":0},{"id":"3564a400-0000-4000-8000-000000000004","sort_order":1},{"id":"3564a400-0000-4000-8000-000000000002","sort_order":2},{"id":"3564a400-0000-4000-8000-000000000003","sort_order":3}]'::jsonb,
      ARRAY['3564a400-0000-4000-8000-000000000004','3564a400-0000-4000-8000-000000000001','3564a400-0000-4000-8000-000000000002','3564a400-0000-4000-8000-000000000003']::uuid[]
    );
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_message := SQLERRM; END;
  IF v_message IS DISTINCT FROM 'issue_3564_forced_update_failure'
     OR pg_temp.issue_3564_state() IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3564 I-ROLLBACK-5: forced mid-update failure left partial order or did not reach trigger (%, %)', coalesce(v_state,'success'), coalesce(v_message,'no message');
  END IF;
END;
$forced_failure$;

RESET ROLE;
DROP TRIGGER issue_3564_force_update_failure ON public.menu_items;
DROP FUNCTION public.issue_3564_force_update_failure();

ROLLBACK;
