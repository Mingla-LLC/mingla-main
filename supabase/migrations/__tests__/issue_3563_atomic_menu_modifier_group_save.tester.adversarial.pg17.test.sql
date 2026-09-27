-- Issue #3563 independent PostgreSQL 17 adversarial suite.
--
-- Different angle from the implementor happy path: execute hostile roles and
-- identities, malformed payload families, and a trigger-forced failure after
-- writes have begun. Every refused call is compared against byte-identical
-- group/option state. The whole suite rolls back.
\set ON_ERROR_STOP on
BEGIN;

DO $catalog$
DECLARE
  v_sig regprocedure := 'public.biz_save_menu_modifier_group_v1(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb)'::regprocedure;
BEGIN
  IF (SELECT l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = v_sig) <> 'plpgsql'
     OR (SELECT provolatile FROM pg_proc WHERE oid = v_sig) <> 'v'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_sig)
     OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = v_sig) <> 'postgres'
     OR (SELECT proconfig FROM pg_proc WHERE oid = v_sig)
        IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION 'ISSUE-3563 T-CATALOG-1: owner/language/volatility/security/search_path drifted';
  END IF;
  IF EXISTS (
       SELECT 1 FROM pg_proc p, pg_catalog.aclexplode(p.proacl) a
       WHERE p.oid = v_sig AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
     )
     OR has_function_privilege('anon', v_sig, 'EXECUTE')
     OR has_function_privilege('service_role', v_sig, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'ISSUE-3563 T-CATALOG-2: function execute ACL is not authenticated-only';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.menu_modifier_groups'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.menu_modifiers'::regclass) THEN
    RAISE EXCEPTION 'ISSUE-3563 T-CATALOG-3: modifier RLS was weakened';
  END IF;
  IF has_table_privilege('anon', 'public.menu_modifier_groups', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('anon', 'public.menu_modifiers', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.menu_modifier_groups', 'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     OR has_table_privilege('authenticated', 'public.menu_modifiers', 'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
    RAISE EXCEPTION 'ISSUE-3563 T-CATALOG-4: issue #1856 table-grant posture drifted';
  END IF;
END;
$catalog$;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('3563a000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-a-3563@example.test',now(),now()),
  ('3563a000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','finance-3563@example.test',now(),now()),
  ('3563a000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-b-3563@example.test',now(),now());
INSERT INTO public.creator_accounts (id, created_at)
VALUES
  ('3563a000-0000-4000-8000-000000000001',now()),
  ('3563a000-0000-4000-8000-000000000002',now()),
  ('3563a000-0000-4000-8000-000000000003',now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES
  ('3563a100-0000-4000-8000-000000000001','3563a000-0000-4000-8000-000000000001','Issue 3563 Tester A','issue-3563-tester-a','USD',now(),now()),
  ('3563a100-0000-4000-8000-000000000002','3563a000-0000-4000-8000-000000000003','Issue 3563 Tester B','issue-3563-tester-b','EUR',now(),now());
INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at)
VALUES ('3563a100-0000-4000-8000-000000000001','3563a000-0000-4000-8000-000000000002','finance_manager',now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status)
VALUES
  ('3563a200-0000-4000-8000-000000000001','3563a100-0000-4000-8000-000000000001','issue3563testera','Tester Venue A',40.7,-74.0,'restaurant','verified'),
  ('3563a200-0000-4000-8000-000000000002','3563a100-0000-4000-8000-000000000002','issue3563testerb','Tester Venue B',48.8,2.3,'restaurant','verified');
INSERT INTO public.menus (id, brand_id, venue_id, name, sort_order)
VALUES
  ('3563a300-0000-4000-8000-000000000001','3563a100-0000-4000-8000-000000000001','3563a200-0000-4000-8000-000000000001','Dinner A',0),
  ('3563a300-0000-4000-8000-000000000002','3563a100-0000-4000-8000-000000000002','3563a200-0000-4000-8000-000000000002','Dinner B',0);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, sort_order)
VALUES
  ('3563a400-0000-4000-8000-000000000001','3563a300-0000-4000-8000-000000000001','3563a100-0000-4000-8000-000000000001','Burger A',1500,'USD',0),
  ('3563a400-0000-4000-8000-000000000002','3563a300-0000-4000-8000-000000000002','3563a100-0000-4000-8000-000000000002','Burger B',1600,'EUR',0);
INSERT INTO public.menu_modifier_groups (id, brand_id, menu_item_id, name, selection_mode, min_select, max_select, is_active, sort_order)
VALUES
  ('3563a500-0000-4000-8000-000000000001','3563a100-0000-4000-8000-000000000001','3563a400-0000-4000-8000-000000000001','Heat','multi',0,3,true,0),
  ('3563a500-0000-4000-8000-000000000002','3563a100-0000-4000-8000-000000000002','3563a400-0000-4000-8000-000000000002','Foreign','single',0,1,true,0);
INSERT INTO public.menu_modifiers (id, group_id, brand_id, name, price_delta_cents, currency, is_available, sort_order)
VALUES
  ('3563a600-0000-4000-8000-000000000001','3563a500-0000-4000-8000-000000000001','3563a100-0000-4000-8000-000000000001','Keep',-50,'USD',true,0),
  ('3563a600-0000-4000-8000-000000000002','3563a500-0000-4000-8000-000000000001','3563a100-0000-4000-8000-000000000001','Referenced removal',75,'USD',true,1),
  ('3563a600-0000-4000-8000-000000000003','3563a500-0000-4000-8000-000000000001','3563a100-0000-4000-8000-000000000001','Unreferenced removal',100,'USD',true,2),
  ('3563a600-0000-4000-8000-000000000004','3563a500-0000-4000-8000-000000000002','3563a100-0000-4000-8000-000000000002','Foreign option',25,'EUR',true,0);

INSERT INTO public.venue_order_sessions (id, brand_id, venue_id, currency)
VALUES ('3563a700-0000-4000-8000-000000000001','3563a100-0000-4000-8000-000000000001','3563a200-0000-4000-8000-000000000001','USD');
INSERT INTO public.venue_orders (
  id, session_id, brand_id, venue_id, source, pickup_code, buyer_name,
  money_path, currency, subtotal_cents, service_charge_bps,
  service_charge_cents, tip_cents, effective_take_rate_bps,
  service_fee_bps, mingla_fee_cents, platform_service_fee_cents,
  pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents,
  tax_amount_cents, total_cents, idempotency_key
) VALUES (
  '3563a700-0000-4000-8000-000000000002','3563a700-0000-4000-8000-000000000001',
  '3563a100-0000-4000-8000-000000000001','3563a200-0000-4000-8000-000000000001',
  'guest_page','63','Tester Buyer','venue_collected','USD',1575,0,0,0,0,0,0,0,
  false,false,false,1575,0,1575,'issue-3563-tester-history'
);
INSERT INTO public.venue_order_items (
  id, venue_order_id, menu_item_id, line_no, item_name_at_order,
  unit_price_cents, currency, quantity, modifiers_total_cents, line_total_cents
) VALUES (
  '3563a700-0000-4000-8000-000000000003','3563a700-0000-4000-8000-000000000002',
  '3563a400-0000-4000-8000-000000000001',1,'Burger A',1500,'USD',1,75,1575
);
INSERT INTO public.venue_order_item_modifiers (
  venue_order_item_id, menu_modifier_id, group_name_at_order,
  modifier_name_at_order, price_delta_cents, currency
) VALUES (
  '3563a700-0000-4000-8000-000000000003','3563a600-0000-4000-8000-000000000002',
  'Heat','Referenced removal',75,'USD'
);

CREATE FUNCTION pg_temp.issue_3563_state() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT pg_catalog.jsonb_build_object(
    'groups', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(g) ORDER BY g.id)
      FROM public.menu_modifier_groups g
      WHERE g.id::text LIKE '3563a5%'
    ), '[]'::jsonb),
    'options', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) ORDER BY m.id)
      FROM public.menu_modifiers m
      WHERE m.id::text LIKE '3563a6%'
         OR m.group_id::text LIKE '3563a9%'
    ), '[]'::jsonb)
  )
$$;

-- Anonymous has no execute grant at all. A real attempted call must fail and
-- leave the byte-identical fixture intact.
DO $anonymous$
DECLARE v_before jsonb := pg_temp.issue_3563_state(); v_state text;
BEGIN
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.biz_save_menu_modifier_group_v1(
      '3563a100-0000-4000-8000-000000000001','3563a400-0000-4000-8000-000000000001',
      '3563a500-0000-4000-8000-000000000001','Anonymous','single',0,1,0,
      '[{"id":"3563a600-0000-4000-8000-000000000001","name":"Nope","price_delta_cents":0,"sort_order":0}]'::jsonb
    );
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; RESET ROLE; END;
  IF v_state IS DISTINCT FROM '42501' OR pg_temp.issue_3563_state() IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3563 T-AUTH-1: anonymous attempt was not a zero-side-effect 42501 (%)', coalesce(v_state,'success');
  END IF;
END;
$anonymous$;

-- Below-manager, foreign brand/item/group/option attacks all execute as the
-- signed-in Business role and must fail closed without touching any row.
DO $scopes$
DECLARE
  v_before jsonb;
  v_state text;
  v_case record;
BEGIN
  FOR v_case IN SELECT * FROM (VALUES
    ('below-manager','3563a000-0000-4000-8000-000000000002'::uuid,'3563a100-0000-4000-8000-000000000001'::uuid,'3563a400-0000-4000-8000-000000000001'::uuid,'3563a500-0000-4000-8000-000000000001'::uuid,
      '[{"id":"3563a600-0000-4000-8000-000000000001","name":"Nope","price_delta_cents":0,"sort_order":0}]'::jsonb),
    ('foreign-brand','3563a000-0000-4000-8000-000000000001'::uuid,'3563a100-0000-4000-8000-000000000002'::uuid,'3563a400-0000-4000-8000-000000000002'::uuid,'3563a500-0000-4000-8000-000000000002'::uuid,
      '[{"id":"3563a600-0000-4000-8000-000000000004","name":"Nope","price_delta_cents":0,"sort_order":0}]'::jsonb),
    ('foreign-item','3563a000-0000-4000-8000-000000000001'::uuid,'3563a100-0000-4000-8000-000000000001'::uuid,'3563a400-0000-4000-8000-000000000002'::uuid,'3563a900-0000-4000-8000-000000000001'::uuid,
      '[{"id":"3563a900-0000-4000-8000-000000000011","name":"Nope","price_delta_cents":0,"sort_order":0}]'::jsonb),
    ('foreign-group','3563a000-0000-4000-8000-000000000001'::uuid,'3563a100-0000-4000-8000-000000000001'::uuid,'3563a400-0000-4000-8000-000000000001'::uuid,'3563a500-0000-4000-8000-000000000002'::uuid,
      '[{"id":"3563a900-0000-4000-8000-000000000012","name":"Nope","price_delta_cents":0,"sort_order":0}]'::jsonb),
    ('foreign-option','3563a000-0000-4000-8000-000000000001'::uuid,'3563a100-0000-4000-8000-000000000001'::uuid,'3563a400-0000-4000-8000-000000000001'::uuid,'3563a500-0000-4000-8000-000000000001'::uuid,
      '[{"id":"3563a600-0000-4000-8000-000000000004","name":"Nope","price_delta_cents":0,"sort_order":0}]'::jsonb)
  ) AS cases(label, actor, brand_id, item_id, group_id, options) LOOP
    v_before := pg_temp.issue_3563_state(); v_state := NULL;
    PERFORM set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub',v_case.actor,'role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_case.actor::text, true);
    BEGIN
      SET LOCAL ROLE authenticated;
      PERFORM public.biz_save_menu_modifier_group_v1(
        v_case.brand_id,v_case.item_id,v_case.group_id,'Hostile','single',0,1,0,v_case.options
      );
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; RESET ROLE; END;
    IF v_state IS DISTINCT FROM '42501' OR pg_temp.issue_3563_state() IS DISTINCT FROM v_before THEN
      RAISE EXCEPTION 'ISSUE-3563 T-SCOPE: % was not a zero-side-effect 42501 (%)', v_case.label, coalesce(v_state,'success');
    END IF;
  END LOOP;
END;
$scopes$;

-- Every payload below is invalid in a different way. The loop includes object,
-- empty, extra/missing keys, wrong type, duplicate IDs/order, noncontiguous
-- order, signed-delta overflow, integer overflow, invalid group bounds/name,
-- and min greater than option count.
SELECT set_config('request.jwt.claims','{"sub":"3563a000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','3563a000-0000-4000-8000-000000000001',true);
DO $malformed$
DECLARE
  v_before jsonb;
  v_state text;
  v_case record;
BEGIN
  FOR v_case IN SELECT * FROM (VALUES
    ('object-options','Heat','single',0,1,'{}'::jsonb),
    ('empty-options','Heat','single',0,1,'[]'::jsonb),
    ('extra-key','Heat','single',0,1,'[{"id":"3563a600-0000-4000-8000-000000000001","name":"Keep","price_delta_cents":0,"sort_order":0,"extra":true}]'::jsonb),
    ('missing-key','Heat','single',0,1,'[{"id":"3563a600-0000-4000-8000-000000000001","name":"Keep","sort_order":0}]'::jsonb),
    ('wrong-type','Heat','single',0,1,'[{"id":"3563a600-0000-4000-8000-000000000001","name":"Keep","price_delta_cents":"0","sort_order":0}]'::jsonb),
    ('duplicate-id','Heat','multi',0,2,'[{"id":"3563a600-0000-4000-8000-000000000001","name":"A","price_delta_cents":0,"sort_order":0},{"id":"3563a600-0000-4000-8000-000000000001","name":"B","price_delta_cents":0,"sort_order":1}]'::jsonb),
    ('duplicate-order','Heat','multi',0,2,'[{"id":"3563a600-0000-4000-8000-000000000001","name":"A","price_delta_cents":0,"sort_order":0},{"id":"3563a900-0000-4000-8000-000000000021","name":"B","price_delta_cents":0,"sort_order":0}]'::jsonb),
    ('noncontiguous-order','Heat','multi',0,2,'[{"id":"3563a600-0000-4000-8000-000000000001","name":"A","price_delta_cents":0,"sort_order":0},{"id":"3563a900-0000-4000-8000-000000000022","name":"B","price_delta_cents":0,"sort_order":2}]'::jsonb),
    ('delta-overflow','Heat','single',0,1,'[{"id":"3563a600-0000-4000-8000-000000000001","name":"Keep","price_delta_cents":100000001,"sort_order":0}]'::jsonb),
    ('integer-overflow','Heat','single',0,1,'[{"id":"3563a600-0000-4000-8000-000000000001","name":"Keep","price_delta_cents":0,"sort_order":2147483648}]'::jsonb),
    ('group-name-overflow',repeat('x',81),'single',0,1,'[{"id":"3563a600-0000-4000-8000-000000000001","name":"Keep","price_delta_cents":0,"sort_order":0}]'::jsonb),
    ('single-bounds','Heat','single',0,2,'[{"id":"3563a600-0000-4000-8000-000000000001","name":"Keep","price_delta_cents":0,"sort_order":0}]'::jsonb),
    ('min-overflow','Heat','multi',21,NULL,'[{"id":"3563a600-0000-4000-8000-000000000001","name":"Keep","price_delta_cents":0,"sort_order":0}]'::jsonb),
    ('min-exceeds-count','Heat','multi',2,2,'[{"id":"3563a600-0000-4000-8000-000000000001","name":"Keep","price_delta_cents":0,"sort_order":0}]'::jsonb)
  ) AS cases(label, group_name, mode, min_select, max_select, options) LOOP
    v_before := pg_temp.issue_3563_state(); v_state := NULL;
    BEGIN
      SET LOCAL ROLE authenticated;
      PERFORM public.biz_save_menu_modifier_group_v1(
        '3563a100-0000-4000-8000-000000000001','3563a400-0000-4000-8000-000000000001',
        '3563a500-0000-4000-8000-000000000001',v_case.group_name,v_case.mode,
        v_case.min_select,v_case.max_select,0,v_case.options
      );
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; RESET ROLE; END;
    IF v_state IS NULL OR pg_temp.issue_3563_state() IS DISTINCT FROM v_before THEN
      RAISE EXCEPTION 'ISSUE-3563 T-INPUT: % succeeded or changed state (%)', v_case.label, coalesce(v_state,'success');
    END IF;
  END LOOP;
END;
$malformed$;

-- A hostile trigger raises only after the RPC has updated/inserted rows. This
-- is a true mid-transaction failure, not pre-validation. Both an existing-group
-- update and a brand-new group must roll back completely.
CREATE FUNCTION public.issue_3563_force_mid_transaction_failure() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF NEW.name = '__issue_3563_force_failure__' THEN
    RAISE EXCEPTION 'issue_3563_forced_mid_transaction_failure';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_3563_force_mid_transaction_failure
AFTER INSERT OR UPDATE ON public.menu_modifiers
FOR EACH ROW EXECUTE FUNCTION public.issue_3563_force_mid_transaction_failure();

DO $forced_rollback$
DECLARE v_before jsonb; v_state text;
BEGIN
  v_before := pg_temp.issue_3563_state();
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.biz_save_menu_modifier_group_v1(
      '3563a100-0000-4000-8000-000000000001','3563a400-0000-4000-8000-000000000001',
      '3563a500-0000-4000-8000-000000000001','Changed before trigger','multi',0,2,9,
      '[{"id":"3563a600-0000-4000-8000-000000000001","name":"__issue_3563_force_failure__","price_delta_cents":999,"sort_order":0}]'::jsonb
    );
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; RESET ROLE; END;
  IF v_state IS NULL OR pg_temp.issue_3563_state() IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3563 T-ROLLBACK-1: existing-group forced failure left partial state (%)', coalesce(v_state,'success');
  END IF;

  v_state := NULL;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.biz_save_menu_modifier_group_v1(
      '3563a100-0000-4000-8000-000000000001','3563a400-0000-4000-8000-000000000001',
      '3563a900-0000-4000-8000-000000000002','New group before trigger','single',0,1,1,
      '[{"id":"3563a900-0000-4000-8000-000000000023","name":"__issue_3563_force_failure__","price_delta_cents":0,"sort_order":0}]'::jsonb
    );
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; RESET ROLE; END;
  IF v_state IS NULL
     OR EXISTS (SELECT 1 FROM public.menu_modifier_groups WHERE id = '3563a900-0000-4000-8000-000000000002')
     OR EXISTS (SELECT 1 FROM public.menu_modifiers WHERE id = '3563a900-0000-4000-8000-000000000023')
     OR pg_temp.issue_3563_state() IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3563 T-ROLLBACK-2: new-group forced failure left partial state (%)', coalesce(v_state,'success');
  END IF;
END;
$forced_rollback$;

DROP TRIGGER issue_3563_force_mid_transaction_failure ON public.menu_modifiers;
DROP FUNCTION public.issue_3563_force_mid_transaction_failure();

-- Exact active-set success: referenced omission tombstones, unreferenced
-- omission deletes, item currency wins, signed deltas/order survive, and the
-- public reader exposes only the complete active set.
DO $tombstone_public$
DECLARE v_result jsonb; v_public jsonb;
BEGIN
  SET LOCAL ROLE authenticated;
  v_result := public.biz_save_menu_modifier_group_v1(
    '3563a100-0000-4000-8000-000000000001','3563a400-0000-4000-8000-000000000001',
    '3563a500-0000-4000-8000-000000000001','Final heat','multi',0,2,4,
    '[
      {"id":"3563a900-0000-4000-8000-000000000024","name":"New first","price_delta_cents":-125,"sort_order":0},
      {"id":"3563a600-0000-4000-8000-000000000001","name":"Keep second","price_delta_cents":50,"sort_order":1}
    ]'::jsonb
  );
  RESET ROLE;
  IF v_result#>>'{modifiers,0,id}' <> '3563a900-0000-4000-8000-000000000024'
     OR v_result#>>'{modifiers,1,id}' <> '3563a600-0000-4000-8000-000000000001'
     OR (v_result#>>'{modifiers,0,price_delta_cents}')::integer <> -125
     OR v_result#>>'{modifiers,0,currency}' <> 'USD' THEN
    RAISE EXCEPTION 'ISSUE-3563 T-ACTIVE-1: canonical order/delta/currency wrong: %', v_result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.menu_modifiers WHERE id='3563a600-0000-4000-8000-000000000002' AND NOT is_available)
     OR EXISTS (SELECT 1 FROM public.menu_modifiers WHERE id='3563a600-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'ISSUE-3563 T-ACTIVE-2: referenced/unreferenced omission semantics wrong';
  END IF;
  v_public := public.pg_public_menu_modifiers(ARRAY['3563a400-0000-4000-8000-000000000001'::uuid]);
  IF pg_catalog.jsonb_array_length(v_public#>'{3563a400-0000-4000-8000-000000000001,0,modifiers}') <> 2
     OR v_public#>>'{3563a400-0000-4000-8000-000000000001,0,modifiers,0,id}' <> '3563a900-0000-4000-8000-000000000024'
     OR v_public::text LIKE '%3563a600-0000-4000-8000-000000000002%' THEN
    RAISE EXCEPTION 'ISSUE-3563 T-ACTIVE-3: public read leaked/reordered a tombstone: %', v_public;
  END IF;
END;
$tombstone_public$;

ROLLBACK;
