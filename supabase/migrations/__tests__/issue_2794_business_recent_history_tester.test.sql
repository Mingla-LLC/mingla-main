BEGIN;

INSERT INTO auth.users (id) VALUES
  ('27940000-0000-4000-8000-000000000101'),
  ('27940000-0000-4000-8000-000000000102'),
  ('27940000-0000-4000-8000-000000000103'),
  ('27940000-0000-4000-8000-000000000104');
INSERT INTO public.creator_accounts (id)
VALUES ('27940000-0000-4000-8000-000000000101');
INSERT INTO public.brands (id, account_id, name, slug, default_currency)
VALUES ('27940000-0000-4000-8000-000000000110', '27940000-0000-4000-8000-000000000101', 'Recent Adversarial', 'recent-adversarial', 'USD');
INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at, removed_at) VALUES
  ('27940000-0000-4000-8000-000000000110', '27940000-0000-4000-8000-000000000103', 'scanner', now(), NULL),
  ('27940000-0000-4000-8000-000000000110', '27940000-0000-4000-8000-000000000104', 'event_manager', now(), now());
INSERT INTO public.events (id, brand_id, created_by, title, slug, status, visibility, event_type)
VALUES ('27940000-0000-4000-8000-000000000120', '27940000-0000-4000-8000-000000000110',
        '27940000-0000-4000-8000-000000000101', 'Adversarial Event', 'recent-adversarial-event',
        'draft', 'private', 'event');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '27940000-0000-4000-8000-000000000102', true);

DO $test$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.biz_list_recent_entity_index('27940000-0000-4000-8000-000000000110');
  EXCEPTION WHEN OTHERS THEN denied := SQLERRM = 'recent_brand_forbidden'; END;
  IF NOT denied THEN RAISE EXCEPTION 'non-member could list Recent'; END IF;

  denied := false;
  BEGIN
    PERFORM public.biz_hydrate_recent_entities(
      '27940000-0000-4000-8000-000000000110', '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN denied := SQLERRM = 'recent_brand_forbidden'; END;
  IF NOT denied THEN RAISE EXCEPTION 'non-member could hydrate Recent'; END IF;

  denied := false;
  BEGIN
    PERFORM public.biz_record_recent_entity_open(
      '27940000-0000-4000-8000-000000000110', 'event',
      '27940000-0000-4000-8000-000000000120', now(), gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN denied := SQLERRM = 'recent_brand_forbidden'; END;
  IF NOT denied THEN RAISE EXCEPTION 'non-member could record Recent'; END IF;

  denied := false;
  BEGIN EXECUTE 'SELECT count(*) FROM public.business_recent_entity_opens';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'authenticated direct table read was allowed'; END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.biz_hydrate_recent_entities(uuid,jsonb)'::regprocedure) IS NOT TRUE THEN
    RAISE EXCEPTION 'hydrate is not security definer';
  END IF;
  IF (SELECT proconfig FROM pg_proc WHERE oid = 'public.biz_hydrate_recent_entities(uuid,jsonb)'::regprocedure)
       <> ARRAY['search_path=public, pg_temp']::text[] THEN
    RAISE EXCEPTION 'hydrate search_path is not pinned';
  END IF;
  IF has_function_privilege('anon', 'public.biz_hydrate_recent_entities(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute hydrate';
  END IF;
END;
$test$;

SELECT set_config('request.jwt.claim.sub', '27940000-0000-4000-8000-000000000103', true);
DO $scanner$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.biz_list_recent_entity_index('27940000-0000-4000-8000-000000000110');
  EXCEPTION WHEN OTHERS THEN denied := SQLERRM = 'recent_brand_forbidden'; END;
  IF NOT denied THEN RAISE EXCEPTION 'scanner could list Recent'; END IF;
END;
$scanner$;

SELECT set_config('request.jwt.claim.sub', '27940000-0000-4000-8000-000000000104', true);
DO $revoked$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.biz_list_recent_entity_index('27940000-0000-4000-8000-000000000110');
  EXCEPTION WHEN OTHERS THEN denied := SQLERRM = 'recent_brand_forbidden'; END;
  IF NOT denied THEN RAISE EXCEPTION 'revoked manager could list Recent'; END IF;
END;
$revoked$;

SELECT set_config('request.jwt.claim.sub', '27940000-0000-4000-8000-000000000101', true);
DO $owner_adversarial$
DECLARE denied boolean; refs jsonb;
BEGIN
  PERFORM public.biz_record_recent_entity_open(
    '27940000-0000-4000-8000-000000000110', 'event',
    '27940000-0000-4000-8000-000000000120', now(),
    '27940000-0000-4000-8001-000000000120');

  denied := false;
  BEGIN
    PERFORM public.biz_record_recent_entity_open(
      '27940000-0000-4000-8000-000000000110', 'event',
      '27940000-0000-4000-8000-000000000999', now(), gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN denied := SQLERRM = 'recent_entity_forbidden'; END;
  IF NOT denied THEN RAISE EXCEPTION 'arbitrary entity record was accepted'; END IF;

  denied := false;
  BEGIN
    PERFORM public.biz_hydrate_recent_entities(
      '27940000-0000-4000-8000-000000000110',
      jsonb_build_array(jsonb_build_object('entityType','event','entityId','27940000-0000-4000-8000-000000000999')));
  EXCEPTION WHEN OTHERS THEN denied := SQLERRM = 'recent_refs_forbidden'; END;
  IF NOT denied THEN RAISE EXCEPTION 'arbitrary hydration ref was accepted'; END IF;

  FOREACH refs IN ARRAY ARRAY[
    '{}'::jsonb,
    '[{}]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('entityType','event','entityId','27940000-0000-4000-8000-000000000120'),
      jsonb_build_object('entityType','event','entityId','27940000-0000-4000-8000-000000000120')),
    (SELECT jsonb_agg(jsonb_build_object(
       'entityType','event','entityId','27940000-0000-4000-8000-000000000120'))
       FROM generate_series(1,26))
  ] LOOP
    denied := false;
    BEGIN
      PERFORM public.biz_hydrate_recent_entities(
        '27940000-0000-4000-8000-000000000110', refs);
    EXCEPTION WHEN OTHERS THEN denied := SQLERRM = 'recent_refs_invalid'; END;
    IF NOT denied THEN RAISE EXCEPTION 'malformed/duplicate/oversized refs were accepted: %', refs; END IF;
  END LOOP;
END;
$owner_adversarial$;

RESET ROLE;
DO $catalog$
DECLARE fn regprocedure;
BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.business_recent_entity_opens'::regclass) THEN
    RAISE EXCEPTION 'Recent table RLS is not enabled and forced';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.business_recent_operation_receipts'::regclass) THEN
    RAISE EXCEPTION 'Recent receipt table RLS is not enabled and forced';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.business_recent_entity_opens'::regclass AND contype = 'u') <> 2 THEN
    RAISE EXCEPTION 'Recent uniqueness constraints drifted';
  END IF;
  IF to_regclass('public.business_recent_scope_order_idx') IS NULL THEN
    RAISE EXCEPTION 'Recent ordering index is missing';
  END IF;
  IF to_regclass('public.business_recent_receipt_scope_order_idx') IS NULL THEN
    RAISE EXCEPTION 'Recent receipt ordering index is missing';
  END IF;
  FOREACH fn IN ARRAY ARRAY[
    'public.biz_record_recent_entity_open(uuid,text,uuid,timestamptz,uuid)'::regprocedure,
    'public.biz_list_recent_entity_index(uuid)'::regprocedure,
    'public.biz_hydrate_recent_entities(uuid,jsonb)'::regprocedure
  ] LOOP
    IF NOT (SELECT prosecdef AND pg_get_userbyid(proowner) = 'postgres' AND proconfig = ARRAY['search_path=public, pg_temp']::text[] FROM pg_proc WHERE oid = fn) THEN
      RAISE EXCEPTION 'Recent RPC owner/mode/search_path drifted: %', fn;
    END IF;
    IF has_function_privilege('anon', fn, 'EXECUTE') OR NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Recent RPC grants drifted: %', fn;
    END IF;
  END LOOP;
END;
$catalog$;

DO $table_grants$
DECLARE table_name text; role_name text; privilege_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'public.business_recent_entity_opens',
    'public.business_recent_operation_receipts'
  ] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege(role_name, table_name, privilege_name) THEN
          RAISE EXCEPTION '% unexpectedly has % on %', role_name, privilege_name, table_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$table_grants$;

DO $terminal$
BEGIN
  IF has_table_privilege('authenticated', 'public.business_recent_entity_opens', 'SELECT') THEN
    RAISE EXCEPTION 'issue_2794_terminal_direct_table_denial';
  END IF;
END;
$terminal$;

ROLLBACK;

-- Four independent sessions record one private scope concurrently. Without the
-- scope advisory lock each statement can observe fewer than 200 committed rows
-- and leave the final scope above the retention ceiling.
CREATE EXTENSION IF NOT EXISTS dblink;
BEGIN;
INSERT INTO auth.users (id)
VALUES ('27940000-0000-4000-8000-000000000201');
INSERT INTO public.creator_accounts (id)
VALUES ('27940000-0000-4000-8000-000000000201');
INSERT INTO public.brands (id, account_id, name, slug, default_currency)
VALUES (
  '27940000-0000-4000-8000-000000000210',
  '27940000-0000-4000-8000-000000000201',
  'Recent Concurrency',
  'recent-concurrency',
  'USD'
);
INSERT INTO public.events (
  id, brand_id, created_by, title, slug, status, visibility, event_type
)
SELECT (
    '2795' || lpad(to_hex(g), 4, '0') || '-0000-4000-8000-' ||
    lpad(g::text, 12, '0')
  )::uuid,
  '27940000-0000-4000-8000-000000000210',
  '27940000-0000-4000-8000-000000000201',
  'Concurrent Recent ' || g,
  'concurrent-recent-' || g,
  'scheduled',
  'private',
  'event'
FROM generate_series(1, 240) g;
COMMIT;

-- The exact Supabase image deliberately makes postgres non-superuser. Give
-- this disposable suite role a suite-local password in its own committed
-- statement, then connect through 127.0.0.2 so pg_hba exercises password auth
-- rather than loopback trust. dblink correctly refuses non-password
-- connections for non-superusers.
SELECT format(
  'ALTER ROLE %I PASSWORD %L',
  current_user,
  'issue2794-dblink-only'
) AS sql \gexec

DO $concurrency$
DECLARE
  worker integer;
  first_id integer;
  last_id integer;
  connection_name text;
  query_text text;
  result_count bigint;
BEGIN
  FOR worker IN 1..4 LOOP
    first_id := ((worker - 1) * 60) + 1;
    last_id := worker * 60;
    connection_name := 'recent_worker_' || worker;
    PERFORM dblink_connect(
      connection_name,
      format(
        'hostaddr=127.0.0.2 port=%s dbname=%I user=%I password=%s',
        current_setting('port'),
        current_database(),
        current_user,
        'issue2794-dblink-only'
      )
    );
    query_text := format($query$
      SELECT count(*)
      FROM generate_series(%s, %s) g
      WHERE set_config(
        'request.jwt.claim.sub',
        '27940000-0000-4000-8000-000000000201',
        false
      ) IS NOT NULL
      AND public.biz_record_recent_entity_open(
        '27940000-0000-4000-8000-000000000210',
        'event',
        (
          '2795' || lpad(to_hex(g), 4, '0') || '-0000-4000-8000-' ||
          lpad(g::text, 12, '0')
        )::uuid,
        clock_timestamp() + g * interval '1 millisecond',
        (
          '2795' || lpad(to_hex(g), 4, '0') || '-0000-4000-8001-' ||
          lpad(g::text, 12, '0')
        )::uuid
      ) IS NOT NULL
    $query$, first_id, last_id);
    IF dblink_send_query(connection_name, query_text) <> 1 THEN
      RAISE EXCEPTION 'could not start Recent concurrency worker %', worker;
    END IF;
  END LOOP;

  FOR worker IN 1..4 LOOP
    connection_name := 'recent_worker_' || worker;
    SELECT count INTO result_count
      FROM dblink_get_result(connection_name) AS completed(count bigint);
    IF result_count <> 60 THEN
      RAISE EXCEPTION 'Recent concurrency worker % recorded % rows',
        worker, result_count;
    END IF;
    PERFORM dblink_disconnect(connection_name);
  END LOOP;
END;
$concurrency$;

DO $concurrency_assert$
BEGIN
  IF (
    SELECT count(*)
    FROM public.business_recent_entity_opens
    WHERE user_id = '27940000-0000-4000-8000-000000000201'
      AND brand_id = '27940000-0000-4000-8000-000000000210'
  ) <> 200 THEN
    RAISE EXCEPTION 'concurrent Recent retention was not exactly 200';
  END IF;
END;
$concurrency_assert$;

BEGIN;
DELETE FROM public.business_recent_operation_receipts
WHERE user_id = '27940000-0000-4000-8000-000000000201';
DELETE FROM public.business_recent_entity_opens
WHERE user_id = '27940000-0000-4000-8000-000000000201';
DELETE FROM public.events
WHERE brand_id = '27940000-0000-4000-8000-000000000210';
DELETE FROM public.brands
WHERE id = '27940000-0000-4000-8000-000000000210';
DELETE FROM auth.users
WHERE id = '27940000-0000-4000-8000-000000000201';
COMMIT;
