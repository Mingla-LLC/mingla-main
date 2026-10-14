\set ON_ERROR_STOP on

-- Issue #3801 -- implementor proof that the public trip page receives a trip's
-- packages in the order the host authored them.
-- Run after the full migration chain on PostgreSQL 17.
--
-- BEFORE. pg_public_trip_by_slug built its `tiers` array with a json_agg that
-- had no ORDER BY, so the array followed the physical row order of
-- trip_pricing_tiers. A host who authored Private, Couple, Shared could see
-- Shared, Couple, Private on the public page and in the Explorer app.
--
-- AFTER. The array is ordered by the package's ticket_types.display_order
-- (nulls last), then its created_at, then the tier id.
--
-- FAILS-ON-REVERT (delete the ORDER BY from the `tiers` json_agg, or do not
-- apply 20270830003801): T-01 fails on the catalog assertion, and T-02 and
-- T-03 fail on the returned order. T-04 holds on BOTH sides: it is the guard
-- that the fix changed nothing about the shape of a package or who may call
-- the reader.
--
-- Every case executes the real function. Each case rolls back.

-- A public, scheduled trip with no packages yet. Returns the two slugs the
-- reader is called with.
CREATE OR REPLACE FUNCTION pg_temp.issue_3801_trip_fixture(p_tag text)
RETURNS TABLE(v_event uuid, v_brand_slug text, v_trip_slug text)
LANGUAGE plpgsql AS $fixture$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
BEGIN
  v_event := gen_random_uuid();
  v_brand_slug := 'issue-3801-order-' || p_tag || '-' || v_brand;
  v_trip_slug := 'issue-3801-trip-' || p_tag || '-' || v_event;
  INSERT INTO auth.users(id, email)
    VALUES (v_user, 'issue-3801-order-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'Issue 3801 order ' || p_tag, v_brand_slug, 'USD');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency)
    VALUES (v_event, v_brand, v_user, 'Issue 3801 trip', v_trip_slug, 'trip', 'scheduled', 'public', 'UTC', 'USD');
  RETURN NEXT;
END;
$fixture$;

-- One package: its ticket type and its trip tier row.
CREATE OR REPLACE FUNCTION pg_temp.issue_3801_add_package(
  p_event uuid,
  p_name text,
  p_spots integer,
  p_display_order integer,
  p_created_at timestamptz
) RETURNS uuid LANGUAGE plpgsql AS $package$
DECLARE
  v_tt uuid := gen_random_uuid();
  v_tier uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, quantity_total,
                                  min_purchase_qty, available_online, available_in_person,
                                  display_order, created_at)
    VALUES (v_tt, p_event, p_name, 0, 'USD', true, p_spots, 1, true, false, p_display_order, p_created_at);
  INSERT INTO public.trip_pricing_tiers(id, event_id, ticket_type_id, tier_name)
    VALUES (v_tier, p_event, v_tt, p_name);
  RETURN v_tier;
END;
$package$;

-- The package names the reader returns, in the order it returns them.
CREATE OR REPLACE FUNCTION pg_temp.issue_3801_returned_names(p_brand_slug text, p_trip_slug text)
RETURNS text LANGUAGE sql AS $names$
  SELECT string_agg(t.value ->> 'tierName', ', ' ORDER BY t.ordinality)
    FROM json_array_elements(public.pg_public_trip_by_slug(p_brand_slug, p_trip_slug) -> 'tiers')
         WITH ORDINALITY AS t(value, ordinality)
$names$;

-- T-01: the installed definition orders the packages.
DO $t01$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'pg_public_trip_by_slug'
     AND pg_get_function_identity_arguments(p.oid) = 'p_brand_slug text, p_event_slug text';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'T-01 FAIL: pg_public_trip_by_slug(text, text) is not installed';
  END IF;
  IF v_src !~ 'ORDER BY\s+tiers\.display_order\s+ASC\s+NULLS\s+LAST\s*,\s*tiers\.created_at\s+ASC\s*,\s*tiers\.id\s+ASC' THEN
    RAISE EXCEPTION 'T-01 FAIL: the tiers array is not ordered by display_order, created_at, id';
  END IF;
  RAISE NOTICE 'T-01 PASS: the installed reader orders the packages';
END
$t01$;

-- T-02: three packages stored in the opposite physical order to the order the
-- host authored come back in the authored order.
BEGIN;
DO $t02$
DECLARE
  f record;
  v_names text;
  v_count integer;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3801_trip_fixture('t02');
  -- Physical order: Shared, Couple, Private. Authored order: Private, Couple, Shared.
  PERFORM pg_temp.issue_3801_add_package(f.v_event, 'Shared', 8, 2, now() - interval '3 minutes');
  PERFORM pg_temp.issue_3801_add_package(f.v_event, 'Couple', 2, 1, now() - interval '2 minutes');
  PERFORM pg_temp.issue_3801_add_package(f.v_event, 'Private', 1, 0, now() - interval '1 minute');

  SELECT json_array_length(public.pg_public_trip_by_slug(f.v_brand_slug, f.v_trip_slug) -> 'tiers')
    INTO v_count;
  IF v_count IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'T-02 FAIL: expected three packages, the reader returned %', COALESCE(v_count::text, 'no trip');
  END IF;
  v_names := pg_temp.issue_3801_returned_names(f.v_brand_slug, f.v_trip_slug);
  IF v_names IS DISTINCT FROM 'Private, Couple, Shared' THEN
    RAISE EXCEPTION 'T-02 FAIL: expected Private, Couple, Shared; the reader returned %', v_names;
  END IF;
  RAISE NOTICE 'T-02 PASS: packages come back in the authored order';
END
$t02$;
ROLLBACK;

-- T-03: packages sharing one display_order come back oldest first, and a
-- hidden or removed package still does not appear.
BEGIN;
DO $t03$
DECLARE
  f record;
  v_names text;
  v_hidden uuid;
  v_removed uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3801_trip_fixture('t03');
  -- Physical order is newest first; every package has display_order 0.
  PERFORM pg_temp.issue_3801_add_package(f.v_event, 'Third', 4, 0, now() - interval '1 minute');
  PERFORM pg_temp.issue_3801_add_package(f.v_event, 'Second', 4, 0, now() - interval '2 minutes');
  PERFORM pg_temp.issue_3801_add_package(f.v_event, 'First', 4, 0, now() - interval '3 minutes');
  v_hidden := pg_temp.issue_3801_add_package(f.v_event, 'Hidden', 4, 0, now() - interval '9 minutes');
  v_removed := pg_temp.issue_3801_add_package(f.v_event, 'Removed', 4, 0, now() - interval '8 minutes');
  UPDATE public.ticket_types SET is_hidden = true
   WHERE id = (SELECT ticket_type_id FROM public.trip_pricing_tiers WHERE id = v_hidden);
  UPDATE public.ticket_types SET deleted_at = now()
   WHERE id = (SELECT ticket_type_id FROM public.trip_pricing_tiers WHERE id = v_removed);

  v_names := pg_temp.issue_3801_returned_names(f.v_brand_slug, f.v_trip_slug);
  IF v_names IS DISTINCT FROM 'First, Second, Third' THEN
    RAISE EXCEPTION 'T-03 FAIL: expected First, Second, Third; the reader returned %', v_names;
  END IF;
  RAISE NOTICE 'T-03 PASS: equal display_order falls back to oldest first; hidden and removed packages stay out';
END
$t03$;
ROLLBACK;

-- T-04: the shape of a package and the reader's callers are unchanged. Holds
-- before and after the fix.
BEGIN;
DO $t04$
DECLARE
  f record;
  v_keys text;
  v_tier jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3801_trip_fixture('t04');
  PERFORM pg_temp.issue_3801_add_package(f.v_event, 'Only', 6, 0, now());

  v_tier := (public.pg_public_trip_by_slug(f.v_brand_slug, f.v_trip_slug) -> 'tiers' -> 0)::jsonb;
  SELECT string_agg(k, ',' ORDER BY k) INTO v_keys FROM jsonb_object_keys(v_tier) AS k;
  IF v_keys IS DISTINCT FROM
     'currency,id,installments,isFree,isUnlimited,priceCents,quantityTotal,ticketsRemaining,ticketTypeId,tierMetadata,tierName' THEN
    RAISE EXCEPTION 'T-04 FAIL: the package keys changed: %', v_keys;
  END IF;
  IF (v_tier ->> 'quantityTotal')::integer IS DISTINCT FROM 6
     OR (v_tier ->> 'ticketsRemaining')::integer IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'T-04 FAIL: spots changed (total %, remaining %)',
      v_tier ->> 'quantityTotal', v_tier ->> 'ticketsRemaining';
  END IF;
  IF NOT has_function_privilege('anon', 'public.pg_public_trip_by_slug(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.pg_public_trip_by_slug(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T-04 FAIL: a public caller lost EXECUTE on the reader';
  END IF;
  RAISE NOTICE 'T-04 PASS: package shape and callers unchanged';
END
$t04$;
ROLLBACK;

SELECT 'issue_3801_public_trip_tiers_ordered: PASS' AS result;
