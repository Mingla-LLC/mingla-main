-- issue #2728 tester adversarial regression guard.
-- The lateral output alias deliberately shares `sold_count` with the later
-- ticket_types column. `c.sold_count` is load-bearing for historical replay
-- and live SQL-function startup; never remove or redirect that qualifier.

\set ON_ERROR_STOP on
\timing off

-- Different angle from the implementor fixture: first prove PostgreSQL itself
-- rejects the ambiguous shape, then prove the shipped RPC includes zero-sale
-- live tiers even when both materialised shadow counters are forged non-zero.
CREATE SCHEMA issue_2728_tester;

DO $ambiguity_oracle$
DECLARE
  v_caught_42702 boolean := false;
BEGIN
  BEGIN
    EXECUTE $ddl$
      CREATE FUNCTION issue_2728_tester.ambiguous_probe(p_event_id uuid)
      RETURNS jsonb
      LANGUAGE sql
      AS $function$
        SELECT COALESCE(
          jsonb_object_agg(tt.id::text, sold_count),
          '{}'::jsonb
        )
        FROM public.ticket_types tt
        LEFT JOIN LATERAL (
          SELECT 0::int AS sold_count
        ) c ON true
        WHERE tt.event_id = p_event_id
      $function$
    $ddl$;
  EXCEPTION
    WHEN ambiguous_column THEN
      v_caught_42702 := (SQLSTATE = '42702');
  END;

  IF v_caught_42702 IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'issue #2728 tester E2: PostgreSQL did not reject the unqualified collision with SQLSTATE 42702';
  END IF;
END $ambiguity_oracle$;

CREATE TEMP TABLE issue_2728_tester_metadata_before ON COMMIT PRESERVE ROWS AS
SELECT
  p.proowner,
  p.prolang,
  p.prorettype,
  p.proargtypes,
  p.proargnames,
  p.provolatile,
  p.prosecdef,
  p.proconfig,
  p.proacl,
  obj_description(p.oid, 'pg_proc') AS description
FROM pg_proc p
WHERE p.oid = 'public.biz_trip_tickets_sold_by_tier(uuid)'::regprocedure;

-- Reapply the fix-forward from inside the executable suite. This proves the
-- repair is idempotent and preserves the already-deployed function metadata.
\ir ../20270605002728_issue_2728_ticket_sold_count_namespace.sql

DO $preclean$
BEGIN
  DELETE FROM public.ticket_types
   WHERE event_id = '27281000-0000-4000-8000-000000000003'::uuid;
  DELETE FROM public.events
   WHERE id = '27281000-0000-4000-8000-000000000003'::uuid;
  DELETE FROM public.brands
   WHERE id = '27281000-0000-4000-8000-000000000002'::uuid;
  DELETE FROM public.creator_accounts
   WHERE id IN (
     '27281000-0000-4000-8000-000000000001'::uuid,
     '27281000-0000-4000-8000-000000000009'::uuid
   );
  DELETE FROM auth.users
   WHERE id IN (
     '27281000-0000-4000-8000-000000000001'::uuid,
     '27281000-0000-4000-8000-000000000009'::uuid
   );
END $preclean$;

INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
VALUES
  ('27281000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'manager@i2728-tester.test', 'x', now(), now()),
  ('27281000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'stranger@i2728-tester.test', 'x', now(), now());

INSERT INTO public.creator_accounts(id)
VALUES
  ('27281000-0000-4000-8000-000000000001'),
  ('27281000-0000-4000-8000-000000000009');

INSERT INTO public.brands(id, account_id, name, slug, claim_status, pricing_currency, default_currency)
VALUES (
  '27281000-0000-4000-8000-000000000002',
  '27281000-0000-4000-8000-000000000001',
  'I2728 Tester Brand', 'i2728-tester-brand', 'verified', 'usd', 'USD'
);

INSERT INTO public.events(
  id, brand_id, title, slug, event_type, visibility, status, timezone, published_at, currency
) VALUES (
  '27281000-0000-4000-8000-000000000003',
  '27281000-0000-4000-8000-000000000002',
  'I2728 Tester Trip', 'i2728-tester-trip', 'trip', 'public', 'live', 'UTC', now(), 'usd'
);

INSERT INTO public.ticket_types(
  id, event_id, name, price_cents, currency, quantity_total, is_unlimited, is_free, deleted_at
) VALUES
  ('27281000-0000-4000-8000-000000000004', '27281000-0000-4000-8000-000000000003',
   'Zero tier A', 1000, 'usd', 10, false, false, NULL),
  ('27281000-0000-4000-8000-000000000005', '27281000-0000-4000-8000-000000000003',
   'Zero tier B', 2000, 'usd', 10, false, false, NULL);

UPDATE public.ticket_types
   SET sold_count = CASE id
     WHEN '27281000-0000-4000-8000-000000000004'::uuid THEN 41
     ELSE 42
   END
 WHERE event_id = '27281000-0000-4000-8000-000000000003'::uuid;

DO $assertions$
DECLARE
  v_actual jsonb;
  v_definition text;
  v_metadata_preserved boolean;
BEGIN
  SELECT ROW(
           p.proowner, p.prolang, p.prorettype, p.proargtypes, p.proargnames,
           p.provolatile, p.prosecdef, p.proconfig, p.proacl,
           obj_description(p.oid, 'pg_proc')
         ) IS NOT DISTINCT FROM ROW(
           b.proowner, b.prolang, b.prorettype, b.proargtypes, b.proargnames,
           b.provolatile, b.prosecdef, b.proconfig, b.proacl, b.description
         )
    INTO v_metadata_preserved
  FROM pg_proc p
  CROSS JOIN issue_2728_tester_metadata_before b
  WHERE p.oid = 'public.biz_trip_tickets_sold_by_tier(uuid)'::regprocedure;

  IF v_metadata_preserved IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'issue #2728 tester E6/E8: idempotent repair changed function metadata or ACL';
  END IF;

  SELECT pg_get_functiondef('public.biz_trip_tickets_sold_by_tier(uuid)'::regprocedure)
    INTO v_definition;
  IF position('jsonb_object_agg(tt.id::text, c.sold_count)' IN v_definition) = 0
     OR position('tt.sold_count' IN v_definition) <> 0
     OR position('biz_is_event_manager_plus(p_event_id, auth.uid())' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'issue #2728 tester E4/E5: qualified ticket-row or manager contract changed';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '27281000-0000-4000-8000-000000000001', true);
  SELECT public.biz_trip_tickets_sold_by_tier('27281000-0000-4000-8000-000000000003')
    INTO v_actual;
  IF v_actual IS DISTINCT FROM jsonb_build_object(
    '27281000-0000-4000-8000-000000000004', 0,
    '27281000-0000-4000-8000-000000000005', 0
  ) THEN
    RAISE EXCEPTION
      'issue #2728 tester E4: zero-sale live tiers returned %, expected two zeroes despite forged counters',
      v_actual;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '27281000-0000-4000-8000-000000000009', true);
  SELECT public.biz_trip_tickets_sold_by_tier('27281000-0000-4000-8000-000000000003')
    INTO v_actual;
  IF v_actual IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'issue #2728 tester E1/E5: unauthorised caller received %', v_actual;
  END IF;
END $assertions$;

DO $cleanup$
BEGIN
  DELETE FROM public.ticket_types
   WHERE event_id = '27281000-0000-4000-8000-000000000003'::uuid;
  DELETE FROM public.events
   WHERE id = '27281000-0000-4000-8000-000000000003'::uuid;
  DELETE FROM public.brands
   WHERE id = '27281000-0000-4000-8000-000000000002'::uuid;
  DELETE FROM public.creator_accounts
   WHERE id IN (
     '27281000-0000-4000-8000-000000000001'::uuid,
     '27281000-0000-4000-8000-000000000009'::uuid
   );
  DELETE FROM auth.users
   WHERE id IN (
     '27281000-0000-4000-8000-000000000001'::uuid,
     '27281000-0000-4000-8000-000000000009'::uuid
   );
  DROP SCHEMA issue_2728_tester;
END $cleanup$;

\echo 'issue #2728 tester adversarial regression: PASS'
