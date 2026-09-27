-- Issue #3563 — happy-path and rollback proof for the Business modifier RPC.
-- Runs after the complete migration replay, inside one rolled-back transaction.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES (
  '35630000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'owner-3563@example.test', now(), now()
);
INSERT INTO public.creator_accounts (id, created_at)
VALUES ('35630000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES (
  '35630000-0000-4000-8000-000000000002',
  '35630000-0000-4000-8000-000000000001',
  'Issue 3563 Brand', 'issue-3563-brand', 'USD', now(), now()
);
INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status
) VALUES (
  '35630000-0000-4000-8000-000000000003',
  '35630000-0000-4000-8000-000000000002',
  'issue3563venue', 'Issue 3563 Venue', 40.7, -74.0, 'restaurant', 'verified'
);
INSERT INTO public.menus (id, brand_id, venue_id, name, sort_order)
VALUES (
  '35630000-0000-4000-8000-000000000004',
  '35630000-0000-4000-8000-000000000002',
  '35630000-0000-4000-8000-000000000003',
  'Dinner', 0
);
INSERT INTO public.menu_items (
  id, menu_id, brand_id, name, price_cents, currency, sort_order
) VALUES (
  '35630000-0000-4000-8000-000000000005',
  '35630000-0000-4000-8000-000000000004',
  '35630000-0000-4000-8000-000000000002',
  'Burger', 1500, 'USD', 0
);

DO $security$
DECLARE
  v_sig regprocedure := 'public.biz_save_menu_modifier_group_v1(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb)'::regprocedure;
BEGIN
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_sig) THEN
    RAISE EXCEPTION 'ISSUE-3563 S-1 FAIL: RPC is not SECURITY DEFINER';
  END IF;
  IF (SELECT proconfig FROM pg_proc WHERE oid = v_sig)
     IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION 'ISSUE-3563 S-2 FAIL: RPC search_path is not empty';
  END IF;
  IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = v_sig) <> 'postgres' THEN
    RAISE EXCEPTION 'ISSUE-3563 S-3 FAIL: RPC owner is not postgres';
  END IF;
  IF has_function_privilege('anon', v_sig, 'EXECUTE')
     OR has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'ISSUE-3563 S-4 FAIL: non-Business client role can execute RPC';
  END IF;
  IF NOT has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'ISSUE-3563 S-5 FAIL: authenticated cannot execute RPC';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.menu_modifier_groups'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.menu_modifiers'::regclass) THEN
    RAISE EXCEPTION 'ISSUE-3563 S-6 FAIL: existing table RLS was weakened';
  END IF;
  IF has_table_privilege('anon', 'public.menu_modifier_groups', 'SELECT')
     OR has_table_privilege('anon', 'public.menu_modifier_groups', 'INSERT,UPDATE,DELETE')
     OR has_table_privilege('anon', 'public.menu_modifiers', 'SELECT')
     OR has_table_privilege('anon', 'public.menu_modifiers', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'ISSUE-3563 S-7 FAIL: issue #1856 table grants were weakened';
  END IF;
END;
$security$;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"35630000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT set_config(
  'request.jwt.claim.sub',
  '35630000-0000-4000-8000-000000000001',
  true
);

DO $first_save$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.biz_save_menu_modifier_group_v1(
    '35630000-0000-4000-8000-000000000002',
    '35630000-0000-4000-8000-000000000005',
    '35630000-0000-4000-8000-000000000010',
    'Temperature', 'single', 1, 1, 0,
    '[
      {"id":"35630000-0000-4000-8000-000000000011","name":"Rare","price_delta_cents":-125,"sort_order":0},
      {"id":"35630000-0000-4000-8000-000000000012","name":"Medium","price_delta_cents":50,"sort_order":1},
      {"id":"35630000-0000-4000-8000-000000000013","name":"Well done","price_delta_cents":0,"sort_order":2}
    ]'::jsonb
  );
  IF v_result->>'id' <> '35630000-0000-4000-8000-000000000010'
     OR jsonb_array_length(v_result->'modifiers') <> 3
     OR v_result#>>'{modifiers,0,id}' <> '35630000-0000-4000-8000-000000000011'
     OR (v_result#>>'{modifiers,0,price_delta_cents}')::integer <> -125
     OR v_result#>>'{modifiers,0,currency}' <> 'USD' THEN
    RAISE EXCEPTION 'ISSUE-3563 H-1 FAIL: canonical first response is wrong: %', v_result;
  END IF;

  -- Same caller identities are an idempotent ambiguous-retry boundary.
  PERFORM public.biz_save_menu_modifier_group_v1(
    '35630000-0000-4000-8000-000000000002',
    '35630000-0000-4000-8000-000000000005',
    '35630000-0000-4000-8000-000000000010',
    'Temperature', 'single', 1, 1, 0,
    '[
      {"id":"35630000-0000-4000-8000-000000000011","name":"Rare","price_delta_cents":-125,"sort_order":0},
      {"id":"35630000-0000-4000-8000-000000000012","name":"Medium","price_delta_cents":50,"sort_order":1},
      {"id":"35630000-0000-4000-8000-000000000013","name":"Well done","price_delta_cents":0,"sort_order":2}
    ]'::jsonb
  );
  IF (SELECT count(*) FROM public.menu_modifier_groups
       WHERE id = '35630000-0000-4000-8000-000000000010') <> 1
     OR (SELECT count(*) FROM public.menu_modifiers
          WHERE group_id = '35630000-0000-4000-8000-000000000010') <> 3 THEN
    RAISE EXCEPTION 'ISSUE-3563 H-2 FAIL: same-ID retry duplicated rows';
  END IF;
END;
$first_save$;

RESET ROLE;

-- Give option 12 real order history so omission must tombstone, not delete it.
INSERT INTO public.venue_order_sessions (
  id, brand_id, venue_id, currency
) VALUES (
  '35630000-0000-4000-8000-000000000020',
  '35630000-0000-4000-8000-000000000002',
  '35630000-0000-4000-8000-000000000003', 'USD'
);
INSERT INTO public.venue_orders (
  id, session_id, brand_id, venue_id, source, pickup_code, buyer_name,
  money_path, currency, subtotal_cents, service_charge_bps,
  service_charge_cents, tip_cents, effective_take_rate_bps,
  service_fee_bps, mingla_fee_cents, platform_service_fee_cents,
  pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents,
  tax_amount_cents, total_cents, idempotency_key
) VALUES (
  '35630000-0000-4000-8000-000000000021',
  '35630000-0000-4000-8000-000000000020',
  '35630000-0000-4000-8000-000000000002',
  '35630000-0000-4000-8000-000000000003',
  'guest_page', '63', 'Issue 3563 Buyer', 'venue_collected', 'USD',
  1550, 0, 0, 0, 0, 0, 0, 0, false, false, false, 1550, 0, 1550,
  'issue-3563-history'
);
INSERT INTO public.venue_order_items (
  id, venue_order_id, menu_item_id, line_no, item_name_at_order,
  unit_price_cents, currency, quantity, modifiers_total_cents, line_total_cents
) VALUES (
  '35630000-0000-4000-8000-000000000022',
  '35630000-0000-4000-8000-000000000021',
  '35630000-0000-4000-8000-000000000005', 1, 'Burger',
  1500, 'USD', 1, 50, 1550
);
INSERT INTO public.venue_order_item_modifiers (
  venue_order_item_id, menu_modifier_id, group_name_at_order,
  modifier_name_at_order, price_delta_cents, currency
) VALUES (
  '35630000-0000-4000-8000-000000000022',
  '35630000-0000-4000-8000-000000000012',
  'Temperature', 'Medium', 50, 'USD'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"35630000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT set_config(
  'request.jwt.claim.sub',
  '35630000-0000-4000-8000-000000000001',
  true
);

DO $replace_set$
DECLARE
  v_result jsonb;
  v_before jsonb;
  v_after jsonb;
BEGIN
  v_result := public.biz_save_menu_modifier_group_v1(
    '35630000-0000-4000-8000-000000000002',
    '35630000-0000-4000-8000-000000000005',
    '35630000-0000-4000-8000-000000000010',
    'Cooking and extras', 'multi', 0, 2, 3,
    '[
      {"id":"35630000-0000-4000-8000-000000000014","name":"Cheese","price_delta_cents":200,"sort_order":0},
      {"id":"35630000-0000-4000-8000-000000000011","name":"Rare please","price_delta_cents":-100,"sort_order":1}
    ]'::jsonb
  );
  IF jsonb_array_length(v_result->'modifiers') <> 2
     OR v_result#>>'{modifiers,0,id}' <> '35630000-0000-4000-8000-000000000014'
     OR v_result#>>'{modifiers,1,id}' <> '35630000-0000-4000-8000-000000000011' THEN
    RAISE EXCEPTION 'ISSUE-3563 H-3 FAIL: replacement response is not canonical: %', v_result;
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.menu_modifiers
        WHERE id = '35630000-0000-4000-8000-000000000012' AND NOT is_available
     ) OR EXISTS (
       SELECT 1 FROM public.menu_modifiers
        WHERE id = '35630000-0000-4000-8000-000000000013'
     ) THEN
    RAISE EXCEPTION 'ISSUE-3563 H-4 FAIL: omitted tombstone/delete semantics are wrong';
  END IF;

  v_after := public.pg_public_menu_modifiers(
    ARRAY['35630000-0000-4000-8000-000000000005'::uuid]
  );
  IF jsonb_array_length(
       v_after#>'{35630000-0000-4000-8000-000000000005,0,modifiers}'
     ) <> 2
     OR v_after#>>'{35630000-0000-4000-8000-000000000005,0,modifiers,0,id}'
        <> '35630000-0000-4000-8000-000000000014'
     OR v_after#>>'{35630000-0000-4000-8000-000000000005,0,modifiers,1,id}'
        <> '35630000-0000-4000-8000-000000000011' THEN
    RAISE EXCEPTION 'ISSUE-3563 H-5 FAIL: public readback leaked or reordered options: %', v_after;
  END IF;

  SELECT pg_catalog.jsonb_build_object(
           'group', to_jsonb(g),
           'options', (
             SELECT pg_catalog.jsonb_agg(to_jsonb(m) ORDER BY m.id)
               FROM public.menu_modifiers m
              WHERE m.group_id = g.id
           )
         )
    INTO v_before
    FROM public.menu_modifier_groups g
   WHERE g.id = '35630000-0000-4000-8000-000000000010';
  BEGIN
    PERFORM public.biz_save_menu_modifier_group_v1(
      '35630000-0000-4000-8000-000000000002',
      '35630000-0000-4000-8000-000000000005',
      '35630000-0000-4000-8000-000000000010',
      'Must roll back', 'multi', 0, 2, 8,
      '[
        {"id":"35630000-0000-4000-8000-000000000014","name":"Cheese changed","price_delta_cents":999,"sort_order":0},
        {"id":"35630000-0000-4000-8000-000000000015","name":"Bad order","price_delta_cents":0,"sort_order":2}
      ]'::jsonb
    );
    RAISE EXCEPTION 'ISSUE-3563 H-6 FAIL: non-contiguous input succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  SELECT pg_catalog.jsonb_build_object(
           'group', to_jsonb(g),
           'options', (
             SELECT pg_catalog.jsonb_agg(to_jsonb(m) ORDER BY m.id)
               FROM public.menu_modifiers m
              WHERE m.group_id = g.id
           )
         )
    INTO v_after
    FROM public.menu_modifier_groups g
   WHERE g.id = '35630000-0000-4000-8000-000000000010';
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3563 H-6 FAIL: rejected call changed committed state';
  END IF;
END;
$replace_set$;

RESET ROLE;
ROLLBACK;
