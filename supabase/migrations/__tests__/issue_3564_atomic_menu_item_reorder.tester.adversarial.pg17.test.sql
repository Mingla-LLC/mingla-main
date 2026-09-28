-- Issue #3564 — independent adversarial proof for the atomic menu-item writer.
-- This suite deliberately commits its isolated fixtures because dblink workers
-- must observe the same rows from genuinely independent database sessions.
\set ON_ERROR_STOP on
\getenv issue_3564_dblink_password PGPASSWORD
SET issue_3564.dblink_password TO :'issue_3564_dblink_password';
SET search_path = public, extensions, pg_catalog;

CREATE EXTENSION IF NOT EXISTS dblink;

DO $catalog$
DECLARE
  v_signature regprocedure :=
    'public.biz_reorder_menu_items_v1(uuid,uuid,uuid,jsonb,uuid[])'::regprocedure;
  v_definition text := pg_catalog.pg_get_functiondef(v_signature);
BEGIN
  IF pg_catalog.pg_get_userbyid((SELECT proowner FROM pg_catalog.pg_proc WHERE oid = v_signature)) <> 'postgres'
     OR (SELECT language.lanname
           FROM pg_catalog.pg_proc procedure
           JOIN pg_catalog.pg_language language
             ON language.oid = procedure.prolang
          WHERE procedure.oid = v_signature) <> 'plpgsql'
     OR (SELECT provolatile FROM pg_catalog.pg_proc WHERE oid = v_signature) <> 'v'
     OR NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_signature)
     OR (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_signature)
        IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION 'ISSUE-3564 T-CATALOG-1: owner/language/volatility/definer/search_path drift';
  END IF;

  IF has_function_privilege('anon', v_signature, 'EXECUTE')
     OR has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc p,
              pg_catalog.aclexplode(p.proacl) acl
        WHERE p.oid = v_signature
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'ISSUE-3564 T-CATALOG-2: RPC is not authenticated-only';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.menus'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.menu_items'::regclass)
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'menus') <> 2
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'menu_items') <> 2 THEN
    RAISE EXCEPTION 'ISSUE-3564 T-CATALOG-3: inherited menu RLS/policies drifted';
  END IF;

  IF NOT has_table_privilege('anon', 'public.menus', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     OR NOT has_table_privilege('anon', 'public.menu_items', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     OR NOT has_table_privilege('authenticated', 'public.menus', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     OR NOT has_table_privilege('authenticated', 'public.menu_items', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     OR NOT has_table_privilege('service_role', 'public.menus', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     OR NOT has_table_privilege('service_role', 'public.menu_items', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
    RAISE EXCEPTION 'ISSUE-3564 T-CATALOG-4: inherited #1856 table grants drifted';
  END IF;

  IF v_definition !~ '(?s)FROM public\.menus candidate\s+WHERE candidate\.id = p_menu_id\s+AND candidate\.brand_id = p_brand_id\s+AND candidate\.venue_id = p_venue_id\s+FOR UPDATE'
     OR v_definition !~ '(?s)FROM public\.menu_items current_item\s+WHERE current_item\.menu_id = p_menu_id\s+ORDER BY current_item\.id\s+FOR UPDATE'
     OR v_definition !~ '(?s)UPDATE public\.menu_items item\s+SET sort_order = desired\.sort_order.*item\.menu_id = p_menu_id\s+AND item\.brand_id = p_brand_id' THEN
    RAISE EXCEPTION 'ISSUE-3564 T-CATALOG-5: exact parent/child lock or scoped set update missing';
  END IF;
END;
$catalog$;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('3564b000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tester-3564@example.test',now(),now()),
  ('3564b000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tester-3564-foreign@example.test',now(),now());
INSERT INTO public.creator_accounts (id, created_at)
VALUES
  ('3564b000-0000-4000-8000-000000000001',now()),
  ('3564b000-0000-4000-8000-000000000002',now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES
  ('3564b100-0000-4000-8000-000000000001','3564b000-0000-4000-8000-000000000001','Issue 3564 Tester','issue-3564-tester','USD',now(),now()),
  ('3564b100-0000-4000-8000-000000000002','3564b000-0000-4000-8000-000000000002','Issue 3564 Tester Foreign','issue-3564-tester-foreign','EUR',now(),now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status)
VALUES
  ('3564b200-0000-4000-8000-000000000001','3564b100-0000-4000-8000-000000000001','issue3564tester','Issue 3564 Tester Venue',40.71,-74.01,'restaurant','verified'),
  ('3564b200-0000-4000-8000-000000000002','3564b100-0000-4000-8000-000000000002','issue3564testerforeign','Issue 3564 Tester Foreign Venue',48.81,2.31,'restaurant','verified');
INSERT INTO public.menus (id, brand_id, venue_id, name, sort_order)
VALUES
  ('3564b300-0000-4000-8000-000000000001','3564b100-0000-4000-8000-000000000001','3564b200-0000-4000-8000-000000000001','Tester Dinner',0),
  ('3564b300-0000-4000-8000-000000000002','3564b100-0000-4000-8000-000000000001','3564b200-0000-4000-8000-000000000001','Tester Drinks',1),
  ('3564b300-0000-4000-8000-000000000003','3564b100-0000-4000-8000-000000000002','3564b200-0000-4000-8000-000000000002','Tester Foreign',0);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, sort_order)
VALUES
  ('3564b400-0000-4000-8000-000000000001','3564b300-0000-4000-8000-000000000001','3564b100-0000-4000-8000-000000000001','Tester Alpha',100,'USD',0),
  ('3564b400-0000-4000-8000-000000000002','3564b300-0000-4000-8000-000000000001','3564b100-0000-4000-8000-000000000001','Tester Bravo',200,'USD',1),
  ('3564b400-0000-4000-8000-000000000003','3564b300-0000-4000-8000-000000000001','3564b100-0000-4000-8000-000000000001','Tester Charlie',300,'USD',2),
  ('3564b400-0000-4000-8000-000000000009','3564b300-0000-4000-8000-000000000003','3564b100-0000-4000-8000-000000000002','Tester Foreign Item',900,'EUR',0);

CREATE FUNCTION public.issue_3564_tester_attempt(
  p_brand_id uuid,
  p_venue_id uuid,
  p_menu_id uuid,
  p_expected_items jsonb,
  p_ordered_item_ids uuid[],
  p_delay_seconds double precision DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $attempt$
DECLARE
  v_result jsonb;
BEGIN
  BEGIN
    v_result := public.biz_reorder_menu_items_v1(
      p_brand_id,
      p_venue_id,
      p_menu_id,
      p_expected_items,
      p_ordered_item_ids
    );
    PERFORM pg_catalog.pg_sleep(p_delay_seconds);
    RETURN pg_catalog.jsonb_build_object('state','00000','result',v_result);
  EXCEPTION WHEN OTHERS THEN
    RETURN pg_catalog.jsonb_build_object(
      'state', SQLSTATE,
      'message', SQLERRM
    );
  END;
END;
$attempt$;
REVOKE ALL ON FUNCTION public.issue_3564_tester_attempt(
  uuid,uuid,uuid,jsonb,uuid[],double precision
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_3564_tester_attempt(
  uuid,uuid,uuid,jsonb,uuid[],double precision
) TO authenticated;

DO $concurrency$
DECLARE
  v_conn text := pg_catalog.format(
    'dbname=%L user=%L password=%L host=%L port=%L',
    pg_catalog.current_database(),
    'supabase_admin',
    pg_catalog.current_setting('issue_3564.dblink_password'),
    pg_catalog.current_setting('unix_socket_directories'),
    pg_catalog.current_setting('port')
  );
  v_claims text := '{"sub":"3564b000-0000-4000-8000-000000000001","role":"authenticated"}';
  v_expected_initial jsonb := '[
    {"id":"3564b400-0000-4000-8000-000000000001","sort_order":0},
    {"id":"3564b400-0000-4000-8000-000000000002","sort_order":1},
    {"id":"3564b400-0000-4000-8000-000000000003","sort_order":2}
  ]'::jsonb;
  v_expected_winner jsonb := '[
    {"id":"3564b400-0000-4000-8000-000000000002","sort_order":0},
    {"id":"3564b400-0000-4000-8000-000000000001","sort_order":1},
    {"id":"3564b400-0000-4000-8000-000000000003","sort_order":2}
  ]'::jsonb;
  v_expected_four jsonb := '[
    {"id":"3564b400-0000-4000-8000-000000000002","sort_order":0},
    {"id":"3564b400-0000-4000-8000-000000000001","sort_order":1},
    {"id":"3564b400-0000-4000-8000-000000000003","sort_order":2},
    {"id":"3564b400-0000-4000-8000-000000000004","sort_order":3}
  ]'::jsonb;
  v_winner_order uuid[] := ARRAY[
    '3564b400-0000-4000-8000-000000000002',
    '3564b400-0000-4000-8000-000000000001',
    '3564b400-0000-4000-8000-000000000003'
  ]::uuid[];
  v_loser_order uuid[] := ARRAY[
    '3564b400-0000-4000-8000-000000000001',
    '3564b400-0000-4000-8000-000000000003',
    '3564b400-0000-4000-8000-000000000002'
  ]::uuid[];
  v_four_order uuid[] := ARRAY[
    '3564b400-0000-4000-8000-000000000001',
    '3564b400-0000-4000-8000-000000000002',
    '3564b400-0000-4000-8000-000000000003',
    '3564b400-0000-4000-8000-000000000004'
  ]::uuid[];
  v_query text;
  v_winner jsonb;
  v_loser jsonb;
  v_attempt jsonb;
  v_a_pid integer;
  v_b_pid integer;
  v_blocked boolean := false;
  v_i integer;
  v_before jsonb;
BEGIN
  PERFORM dblink_connect('issue3564_tester_a', v_conn);
  PERFORM dblink_connect('issue3564_tester_b', v_conn);
  PERFORM dblink_exec('issue3564_tester_a', 'SET ROLE authenticated');
  PERFORM dblink_exec('issue3564_tester_b', 'SET ROLE authenticated');
  PERFORM * FROM dblink(
    'issue3564_tester_a',
    pg_catalog.format('SELECT set_config(''request.jwt.claims'',%L,false)',v_claims)
  ) AS configured(value text);
  PERFORM * FROM dblink(
    'issue3564_tester_b',
    pg_catalog.format('SELECT set_config(''request.jwt.claims'',%L,false)',v_claims)
  ) AS configured(value text);
  PERFORM * FROM dblink(
    'issue3564_tester_a',
    'SELECT set_config(''request.jwt.claim.sub'',''3564b000-0000-4000-8000-000000000001'',false)'
  ) AS configured(value text);
  PERFORM * FROM dblink(
    'issue3564_tester_b',
    'SELECT set_config(''request.jwt.claim.sub'',''3564b000-0000-4000-8000-000000000001'',false)'
  ) AS configured(value text);
  SELECT pid INTO v_a_pid FROM dblink(
    'issue3564_tester_a','SELECT pg_backend_pid()'
  ) AS worker(pid integer);
  SELECT pid INTO v_b_pid FROM dblink(
    'issue3564_tester_b','SELECT pg_backend_pid()'
  ) AS worker(pid integer);

  -- Two genuine sessions start from the same snapshot. Worker A commits the
  -- RPC inside an explicitly held transaction, proving the RPC-acquired exact
  -- parent/child locks survive the function return. Worker B must queue behind
  -- those locks and observe A's committed winner state before it can validate.
  PERFORM dblink_exec('issue3564_tester_a','BEGIN');
  v_query := pg_catalog.format(
    'SELECT public.issue_3564_tester_attempt(%L::uuid,%L::uuid,%L::uuid,%L::jsonb,%L::uuid[],0)',
    '3564b100-0000-4000-8000-000000000001',
    '3564b200-0000-4000-8000-000000000001',
    '3564b300-0000-4000-8000-000000000001',
    v_expected_initial,
    v_winner_order
  );
  SELECT attempt INTO v_winner
    FROM dblink('issue3564_tester_a',v_query) AS completed(attempt jsonb);
  IF v_winner->>'state' <> '00000' THEN
    RAISE EXCEPTION 'ISSUE-3564 T-RACE-1: winner did not acquire/hold the menu: %',v_winner;
  END IF;
  v_query := pg_catalog.format(
    'SELECT public.issue_3564_tester_attempt(%L::uuid,%L::uuid,%L::uuid,%L::jsonb,%L::uuid[],0)',
    '3564b100-0000-4000-8000-000000000001',
    '3564b200-0000-4000-8000-000000000001',
    '3564b300-0000-4000-8000-000000000001',
    v_expected_initial,
    v_loser_order
  );
  IF dblink_send_query('issue3564_tester_b', v_query) <> 1 THEN
    RAISE EXCEPTION 'ISSUE-3564 T-RACE-2: stale loser dispatch failed';
  END IF;
  FOR v_i IN 1..30 LOOP
    IF v_a_pid = ANY(pg_catalog.pg_blocking_pids(v_b_pid)) THEN
      v_blocked := true;
      EXIT;
    END IF;
    PERFORM pg_catalog.pg_sleep(0.05);
  END LOOP;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'ISSUE-3564 T-RACE-3: same-menu loser never blocked on winner';
  END IF;
  PERFORM dblink_exec('issue3564_tester_a','COMMIT');
  SELECT attempt INTO v_loser
    FROM dblink_get_result('issue3564_tester_b') AS completed(attempt jsonb);
  PERFORM * FROM dblink_get_result('issue3564_tester_b') AS drained(attempt jsonb);
  IF v_winner->>'state' <> '00000'
     OR v_loser->>'state' <> '40001'
     OR (v_winner#>>'{result,items,0,id}') <> '3564b400-0000-4000-8000-000000000002' THEN
    RAISE EXCEPTION 'ISSUE-3564 T-RACE-4: winner/stale-loser result wrong: winner=%, loser=%',v_winner,v_loser;
  END IF;
  IF (SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(item.id,item.sort_order)
        ORDER BY item.sort_order
      ) FROM public.menu_items item
      WHERE item.menu_id = '3564b300-0000-4000-8000-000000000001')
     IS DISTINCT FROM '[
       ["3564b400-0000-4000-8000-000000000002",0],
       ["3564b400-0000-4000-8000-000000000001",1],
       ["3564b400-0000-4000-8000-000000000003",2]
     ]'::jsonb THEN
    RAISE EXCEPTION 'ISSUE-3564 T-RACE-5: stale loser left a partial write';
  END IF;

  -- A lost acknowledgement may replay the old snapshot with the identical
  -- desired order. It must return success without changing canonical state.
  SELECT attempt INTO v_attempt FROM dblink(
    'issue3564_tester_b',
    pg_catalog.format(
      'SELECT public.issue_3564_tester_attempt(%L::uuid,%L::uuid,%L::uuid,%L::jsonb,%L::uuid[],0)',
      '3564b100-0000-4000-8000-000000000001',
      '3564b200-0000-4000-8000-000000000001',
      '3564b300-0000-4000-8000-000000000001',
      v_expected_initial,
      v_winner_order
    )
  ) AS replay(attempt jsonb);
  IF v_attempt->>'state' <> '00000'
     OR v_attempt#>>'{result,items,0,id}' <> '3564b400-0000-4000-8000-000000000002' THEN
    RAISE EXCEPTION 'ISSUE-3564 T-IDEMPOTENCE-1: identical desired replay failed: %',v_attempt;
  END IF;

  -- INSERT membership race: the FK holds the parent while the RPC queues. Once
  -- the insert commits, the old complete set loses with 40001 and writes none.
  PERFORM dblink_exec('issue3564_tester_a','BEGIN');
  PERFORM dblink_exec('issue3564_tester_a',$sql$
    INSERT INTO public.menu_items(id,menu_id,brand_id,name,price_cents,currency,sort_order)
    VALUES(
      '3564b400-0000-4000-8000-000000000004',
      '3564b300-0000-4000-8000-000000000001',
      '3564b100-0000-4000-8000-000000000001',
      'Tester Delta',400,'USD',3
    )
  $sql$);
  v_query := pg_catalog.format(
    'SELECT public.issue_3564_tester_attempt(%L::uuid,%L::uuid,%L::uuid,%L::jsonb,%L::uuid[],0)',
    '3564b100-0000-4000-8000-000000000001','3564b200-0000-4000-8000-000000000001','3564b300-0000-4000-8000-000000000001',
    v_expected_winner,v_loser_order
  );
  PERFORM dblink_send_query('issue3564_tester_b',v_query);
  PERFORM pg_catalog.pg_sleep(0.1);
  IF NOT (v_a_pid = ANY(pg_catalog.pg_blocking_pids(v_b_pid))) THEN
    RAISE EXCEPTION 'ISSUE-3564 T-MEMBERSHIP-1: insert race did not serialize on parent';
  END IF;
  PERFORM dblink_exec('issue3564_tester_a','COMMIT');
  SELECT attempt INTO v_attempt FROM dblink_get_result('issue3564_tester_b') AS completed(attempt jsonb);
  PERFORM * FROM dblink_get_result('issue3564_tester_b') AS drained(attempt jsonb);
  IF v_attempt->>'state' <> '40001' THEN
    RAISE EXCEPTION 'ISSUE-3564 T-MEMBERSHIP-2: insert race was not stale 40001: %',v_attempt;
  END IF;

  -- DELETE membership race: the RPC waits on the deterministically locked child
  -- set, then rejects the now-oversized client set without touching survivors.
  PERFORM dblink_exec('issue3564_tester_a','BEGIN');
  PERFORM dblink_exec('issue3564_tester_a',$sql$
    DELETE FROM public.menu_items
     WHERE id = '3564b400-0000-4000-8000-000000000004'
  $sql$);
  v_query := pg_catalog.format(
    'SELECT public.issue_3564_tester_attempt(%L::uuid,%L::uuid,%L::uuid,%L::jsonb,%L::uuid[],0)',
    '3564b100-0000-4000-8000-000000000001','3564b200-0000-4000-8000-000000000001','3564b300-0000-4000-8000-000000000001',
    v_expected_four,v_four_order
  );
  PERFORM dblink_send_query('issue3564_tester_b',v_query);
  PERFORM pg_catalog.pg_sleep(0.1);
  IF NOT (v_a_pid = ANY(pg_catalog.pg_blocking_pids(v_b_pid))) THEN
    RAISE EXCEPTION 'ISSUE-3564 T-MEMBERSHIP-3: delete race did not serialize on locked children';
  END IF;
  PERFORM dblink_exec('issue3564_tester_a','COMMIT');
  SELECT attempt INTO v_attempt FROM dblink_get_result('issue3564_tester_b') AS completed(attempt jsonb);
  PERFORM * FROM dblink_get_result('issue3564_tester_b') AS drained(attempt jsonb);
  IF v_attempt->>'state' <> '40001' THEN
    RAISE EXCEPTION 'ISSUE-3564 T-MEMBERSHIP-4: delete race was not stale 40001: %',v_attempt;
  END IF;

  IF dblink_exec('issue3564_tester_a',$sql$
    INSERT INTO public.menu_items(id,menu_id,brand_id,name,price_cents,currency,sort_order)
    VALUES(
      '3564b400-0000-4000-8000-000000000004',
      '3564b300-0000-4000-8000-000000000001',
      '3564b100-0000-4000-8000-000000000001',
      'Tester Delta',400,'USD',3
    )
  $sql$) <> 'INSERT 0 1' THEN
    RAISE EXCEPTION 'ISSUE-3564 T-MEMBERSHIP-4B: move-race fixture insert failed';
  END IF;

  -- MOVE membership race: moving one child to a sibling menu holds its row.
  -- The source reorder queues, observes the committed move, and fails atomically.
  PERFORM dblink_exec('issue3564_tester_a','BEGIN');
  PERFORM dblink_exec('issue3564_tester_a',$sql$
    UPDATE public.menu_items
       SET menu_id = '3564b300-0000-4000-8000-000000000002', sort_order = 0
     WHERE id = '3564b400-0000-4000-8000-000000000004'
  $sql$);
  v_query := pg_catalog.format(
    'SELECT public.issue_3564_tester_attempt(%L::uuid,%L::uuid,%L::uuid,%L::jsonb,%L::uuid[],0)',
    '3564b100-0000-4000-8000-000000000001','3564b200-0000-4000-8000-000000000001','3564b300-0000-4000-8000-000000000001',
    v_expected_four,v_four_order
  );
  PERFORM dblink_send_query('issue3564_tester_b',v_query);
  PERFORM pg_catalog.pg_sleep(0.1);
  IF NOT (v_a_pid = ANY(pg_catalog.pg_blocking_pids(v_b_pid))) THEN
    RAISE EXCEPTION 'ISSUE-3564 T-MEMBERSHIP-5: move race did not serialize on locked children';
  END IF;
  PERFORM dblink_exec('issue3564_tester_a','COMMIT');
  SELECT attempt INTO v_attempt FROM dblink_get_result('issue3564_tester_b') AS completed(attempt jsonb);
  PERFORM * FROM dblink_get_result('issue3564_tester_b') AS drained(attempt jsonb);
  IF v_attempt->>'state' <> '40001'
     OR NOT EXISTS (
       SELECT 1 FROM public.menu_items
        WHERE id = '3564b400-0000-4000-8000-000000000004'
          AND menu_id = '3564b300-0000-4000-8000-000000000002'
     ) THEN
    RAISE EXCEPTION 'ISSUE-3564 T-MEMBERSHIP-6: move race/adoption result wrong: %',v_attempt;
  END IF;

  IF dblink_exec('issue3564_tester_a',$sql$
    UPDATE public.menu_items
       SET menu_id = '3564b300-0000-4000-8000-000000000001', sort_order = 3
     WHERE id = '3564b400-0000-4000-8000-000000000004'
  $sql$) <> 'UPDATE 1' THEN
    RAISE EXCEPTION 'ISSUE-3564 T-MEMBERSHIP-6B: moved fixture did not return';
  END IF;

  SELECT pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_array(item.id,item.menu_id,item.brand_id,item.sort_order)
           ORDER BY item.id
         ) INTO v_before
    FROM public.menu_items item
   WHERE item.id IN (
     '3564b400-0000-4000-8000-000000000001',
     '3564b400-0000-4000-8000-000000000002',
     '3564b400-0000-4000-8000-000000000003',
     '3564b400-0000-4000-8000-000000000004',
     '3564b400-0000-4000-8000-000000000009'
   );

  -- A caller cannot adopt an item from another menu/brand into its desired set.
  SELECT attempt INTO v_attempt FROM dblink(
    'issue3564_tester_b',
    pg_catalog.format(
      'SELECT public.issue_3564_tester_attempt(%L::uuid,%L::uuid,%L::uuid,%L::jsonb,%L::uuid[],0)',
      '3564b100-0000-4000-8000-000000000001','3564b200-0000-4000-8000-000000000001','3564b300-0000-4000-8000-000000000001',
      '[{"id":"3564b400-0000-4000-8000-000000000002","sort_order":0},{"id":"3564b400-0000-4000-8000-000000000001","sort_order":1},{"id":"3564b400-0000-4000-8000-000000000003","sort_order":2},{"id":"3564b400-0000-4000-8000-000000000009","sort_order":0}]'::jsonb,
      ARRAY['3564b400-0000-4000-8000-000000000002','3564b400-0000-4000-8000-000000000001','3564b400-0000-4000-8000-000000000003','3564b400-0000-4000-8000-000000000009']::uuid[]
    )
  ) AS refused(attempt jsonb);
  IF v_attempt->>'state' <> '40001' THEN
    RAISE EXCEPTION 'ISSUE-3564 T-SCOPE-1: cross-menu/cross-brand adoption was not 40001: %',v_attempt;
  END IF;

  -- A malformed child brand under the correct parent must be indistinguishable
  -- from forbidden scope (42501), return no result, and leave every row intact.
  PERFORM dblink_exec('issue3564_tester_a','RESET ROLE');
  IF dblink_exec('issue3564_tester_a',$sql$
    INSERT INTO public.menu_items(id,menu_id,brand_id,name,price_cents,currency,sort_order)
    VALUES(
      '3564b400-0000-4000-8000-000000000008',
      '3564b300-0000-4000-8000-000000000001',
      '3564b100-0000-4000-8000-000000000002',
      'Malformed Tester Child',800,'EUR',99
    )
  $sql$) <> 'INSERT 0 1' THEN
    RAISE EXCEPTION 'ISSUE-3564 T-SCOPE-1B: malformed child fixture insert failed';
  END IF;
  SELECT attempt INTO v_attempt FROM dblink(
    'issue3564_tester_b',
    pg_catalog.format(
      'SELECT public.issue_3564_tester_attempt(%L::uuid,%L::uuid,%L::uuid,%L::jsonb,%L::uuid[],0)',
      '3564b100-0000-4000-8000-000000000001','3564b200-0000-4000-8000-000000000001','3564b300-0000-4000-8000-000000000001',
      v_expected_four,v_four_order
    )
  ) AS refused(attempt jsonb);
  IF v_attempt->>'state' <> '42501' OR v_attempt ? 'result' THEN
    RAISE EXCEPTION 'ISSUE-3564 T-SCOPE-2: malformed cross-brand child leaked/rewrote: %',v_attempt;
  END IF;

  IF (SELECT pg_catalog.count(*) FROM public.menu_items
       WHERE menu_id = '3564b300-0000-4000-8000-000000000001'
         AND brand_id = '3564b100-0000-4000-8000-000000000001') <> 4
     OR EXISTS (
       SELECT 1
         FROM (
           SELECT item.sort_order,
                  pg_catalog.row_number() OVER (ORDER BY item.sort_order,item.name,item.id) - 1 AS expected
             FROM public.menu_items item
            WHERE item.menu_id = '3564b300-0000-4000-8000-000000000001'
              AND item.brand_id = '3564b100-0000-4000-8000-000000000001'
         ) positions
        WHERE positions.sort_order <> positions.expected
     ) THEN
    RAISE EXCEPTION 'ISSUE-3564 T-CONTIGUOUS-1: surviving order is not exactly 0..n-1';
  END IF;

  IF dblink_exec('issue3564_tester_a',$sql$
    DELETE FROM public.menu_items
     WHERE id = '3564b400-0000-4000-8000-000000000008'
  $sql$) <> 'DELETE 1' THEN
    RAISE EXCEPTION 'ISSUE-3564 T-SCOPE-2B: malformed child fixture cleanup failed';
  END IF;
  IF (SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(item.id,item.menu_id,item.brand_id,item.sort_order)
        ORDER BY item.id
      ) FROM public.menu_items item
      WHERE item.id IN (
        '3564b400-0000-4000-8000-000000000001',
        '3564b400-0000-4000-8000-000000000002',
        '3564b400-0000-4000-8000-000000000003',
        '3564b400-0000-4000-8000-000000000004',
        '3564b400-0000-4000-8000-000000000009'
      )) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-3564 T-SCOPE-3: refusal paths changed unrelated row state';
  END IF;

  PERFORM dblink_disconnect('issue3564_tester_a');
  PERFORM dblink_disconnect('issue3564_tester_b');
END;
$concurrency$;

DROP FUNCTION public.issue_3564_tester_attempt(
  uuid,uuid,uuid,jsonb,uuid[],double precision
);
DELETE FROM public.menu_items
 WHERE id::text LIKE '3564b4%';
DELETE FROM public.menus
 WHERE id::text LIKE '3564b3%';
DELETE FROM public.venue_listings
 WHERE id::text LIKE '3564b2%';
DELETE FROM public.brands
 WHERE id::text LIKE '3564b1%';
DELETE FROM public.creator_accounts
 WHERE id::text LIKE '3564b0%';
DELETE FROM auth.users
 WHERE id::text LIKE '3564b0%';

DO $cleanup$
BEGIN
  IF EXISTS (SELECT 1 FROM public.menu_items WHERE id::text LIKE '3564b4%')
     OR EXISTS (SELECT 1 FROM public.menus WHERE id::text LIKE '3564b3%')
     OR EXISTS (SELECT 1 FROM public.brands WHERE id::text LIKE '3564b1%')
     OR to_regprocedure('public.issue_3564_tester_attempt(uuid,uuid,uuid,jsonb,uuid[],double precision)') IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE-3564 T-CLEANUP-1: committed tester fixtures leaked';
  END IF;
END;
$cleanup$;
