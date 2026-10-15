\set ON_ERROR_STOP on

-- Issue #3801 -- tester adversarial proof for the public trip page package
-- order (migration 20270830003801, pg_public_trip_by_slug).
-- Run after the full migration chain on PostgreSQL 17.
--
-- A different angle from the implementor suite, which proves the plain case
-- (three packages, authored order) and one tie on created_at. This suite
-- attacks the edges of the ordering and the things the change must NOT move:
--
--   A-01  a full tie (same display_order, same created_at) falls to the tier id
--   A-02  display_order cannot be NULL, so NULLS LAST can never reorder a trip
--   A-03  a removed or hidden package leaves no ghost, wherever it would sort
--   A-04  one package, and no packages at all
--   A-05  fifty packages stored in a scrambled physical order, rewritten in
--         place, read twenty times: the same authored order every time
--   A-06  a draft, ended, cancelled, private, hidden, discover-only, deleted
--         or non-trip offering is still not returned
--   A-07  the response keys are exactly the ones buyers already receive; the
--         two columns read for sorting are not leaked
--   A-08  an anonymous buyer can call the reader and gets the authored order
--   A-09  authored order beats age and beats the tier id
--
-- FAILS-ON-REVERT (do not apply 20270830003801, or delete the ORDER BY from
-- the `tiers` json_agg): A-01, A-03, A-05, A-08 and A-09 fail on the returned
-- order (verified case by case against the chain without the migration).
-- A-02, A-04, A-06 and A-07 hold on BOTH sides by design: they are the guards
-- that the fix moved nothing but the order.
--
-- Every case executes the real function. Each case rolls back.

-- An offering with no packages. Status, visibility and type are parameters so
-- the gates can be attacked. Returns the two slugs the reader is called with.
CREATE OR REPLACE FUNCTION pg_temp.t3801_offering(
  p_tag text,
  p_status text DEFAULT 'scheduled',
  p_visibility text DEFAULT 'public',
  p_event_type text DEFAULT 'trip'
) RETURNS TABLE(v_event uuid, v_brand uuid, v_brand_slug text, v_trip_slug text)
LANGUAGE plpgsql AS $fixture$
DECLARE
  v_user uuid := gen_random_uuid();
BEGIN
  v_event := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_brand_slug := 'issue-3801-adv-' || p_tag || '-' || v_brand;
  v_trip_slug := 'issue-3801-adv-trip-' || p_tag || '-' || v_event;
  INSERT INTO auth.users(id, email)
    VALUES (v_user, 'issue-3801-adv-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'Issue 3801 adversarial ' || p_tag, v_brand_slug, 'USD');
  -- Fixture rows only: the write-side guards (publish, visibility) are not
  -- what is under test, the READER's gates are. Triggers are off for this one
  -- insert so a draft, private or cancelled row can exist to be read.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency)
    VALUES (v_event, v_brand, v_user, 'Issue 3801 adversarial trip', v_trip_slug, p_event_type, p_status, p_visibility, 'UTC', 'USD');
  SET LOCAL session_replication_role = origin;
  RETURN NEXT;
END;
$fixture$;

-- One package with a caller-chosen tier id, so the id tie-breaker can be
-- attacked. Returns the tier id.
CREATE OR REPLACE FUNCTION pg_temp.t3801_package(
  p_event uuid,
  p_name text,
  p_display_order integer,
  p_created_at timestamptz,
  p_tier_id uuid DEFAULT gen_random_uuid(),
  p_spots integer DEFAULT 4
) RETURNS uuid LANGUAGE plpgsql AS $package$
DECLARE
  v_tt uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, quantity_total,
                                  min_purchase_qty, available_online, available_in_person,
                                  display_order, created_at)
    VALUES (v_tt, p_event, p_name, 0, 'USD', true, p_spots, 1, true, false, p_display_order, p_created_at);
  INSERT INTO public.trip_pricing_tiers(id, event_id, ticket_type_id, tier_name)
    VALUES (p_tier_id, p_event, v_tt, p_name);
  RETURN p_tier_id;
END;
$package$;

-- The package names the reader returns, in the order it returns them.
CREATE OR REPLACE FUNCTION pg_temp.t3801_names(p_brand_slug text, p_trip_slug text)
RETURNS text LANGUAGE sql AS $names$
  SELECT string_agg(t.value ->> 'tierName', ',' ORDER BY t.ordinality)
    FROM json_array_elements(public.pg_public_trip_by_slug(p_brand_slug, p_trip_slug) -> 'tiers')
         WITH ORDINALITY AS t(value, ordinality)
$names$;

-- A-01: same display_order AND same created_at. The only thing left to order
-- by is the tier id; the rows are stored highest id first.
BEGIN;
DO $a01$
DECLARE
  f record;
  v_at timestamptz := '2026-01-01 00:00:00+00';
  v_names text;
BEGIN
  SELECT * INTO f FROM pg_temp.t3801_offering('a01');
  PERFORM pg_temp.t3801_package(f.v_event, 'id-f', 3, v_at, 'ffffffff-0000-4000-8000-000000000003');
  PERFORM pg_temp.t3801_package(f.v_event, 'id-9', 3, v_at, '99999999-0000-4000-8000-000000000002');
  PERFORM pg_temp.t3801_package(f.v_event, 'id-0', 3, v_at, '00000000-0000-4000-8000-000000000001');
  v_names := pg_temp.t3801_names(f.v_brand_slug, f.v_trip_slug);
  IF v_names IS DISTINCT FROM 'id-0,id-9,id-f' THEN
    RAISE EXCEPTION 'A-01 FAIL: a full tie must fall to the tier id; expected id-0,id-9,id-f, got %', v_names;
  END IF;
  RAISE NOTICE 'A-01 PASS: a full tie falls to the tier id';
END
$a01$;
ROLLBACK;

-- A-02: the ordering says NULLS LAST. That branch is only safe to ignore if a
-- package can never have a NULL position. Prove the column refuses one.
BEGIN;
DO $a02$
DECLARE
  f record;
  v_tier uuid;
  v_refused boolean := false;
BEGIN
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'ticket_types'
         AND column_name = 'display_order') IS DISTINCT FROM 'NO' THEN
    RAISE EXCEPTION 'A-02 FAIL: ticket_types.display_order became nullable; NULLS LAST is now reachable and needs its own proof';
  END IF;
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'ticket_types'
         AND column_name = 'created_at') IS DISTINCT FROM 'NO' THEN
    RAISE EXCEPTION 'A-02 FAIL: ticket_types.created_at became nullable; the tie-breaker is no longer total';
  END IF;
  SELECT * INTO f FROM pg_temp.t3801_offering('a02');
  v_tier := pg_temp.t3801_package(f.v_event, 'Only', 0, now());
  BEGIN
    UPDATE public.ticket_types SET display_order = NULL
     WHERE id = (SELECT ticket_type_id FROM public.trip_pricing_tiers WHERE id = v_tier);
  EXCEPTION WHEN not_null_violation THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'A-02 FAIL: a package accepted a NULL display_order';
  END IF;
  RAISE NOTICE 'A-02 PASS: a package cannot have a NULL position';
END
$a02$;
ROLLBACK;

-- A-03: a removed package and a hidden package, each given the position that
-- would put it FIRST and then the position that would put it LAST. Neither
-- may appear, and the survivors keep their order and their count.
BEGIN;
DO $a03$
DECLARE
  f record;
  v_removed uuid;
  v_hidden uuid;
  v_payload json;
  v_names text;
BEGIN
  SELECT * INTO f FROM pg_temp.t3801_offering('a03');
  PERFORM pg_temp.t3801_package(f.v_event, 'B', 20, now() - interval '1 minute');
  PERFORM pg_temp.t3801_package(f.v_event, 'A', 10, now() - interval '2 minutes');
  v_removed := pg_temp.t3801_package(f.v_event, 'Removed', -5, now() - interval '9 minutes');
  v_hidden := pg_temp.t3801_package(f.v_event, 'Hidden', -4, now() - interval '8 minutes');
  UPDATE public.ticket_types SET deleted_at = now()
   WHERE id = (SELECT ticket_type_id FROM public.trip_pricing_tiers WHERE id = v_removed);
  UPDATE public.ticket_types SET is_hidden = true
   WHERE id = (SELECT ticket_type_id FROM public.trip_pricing_tiers WHERE id = v_hidden);

  -- The tier rows of the removed and hidden packages are still there.
  IF (SELECT count(*) FROM public.trip_pricing_tiers WHERE event_id = f.v_event) <> 4 THEN
    RAISE EXCEPTION 'A-03 FAIL: fixture drift, expected four stored tier rows';
  END IF;

  v_names := pg_temp.t3801_names(f.v_brand_slug, f.v_trip_slug);
  IF v_names IS DISTINCT FROM 'A,B' THEN
    RAISE EXCEPTION 'A-03 FAIL: sorted-first ghosts: expected A,B, got %', v_names;
  END IF;

  UPDATE public.ticket_types SET display_order = 999
   WHERE id IN (SELECT ticket_type_id FROM public.trip_pricing_tiers WHERE id IN (v_removed, v_hidden));
  v_payload := public.pg_public_trip_by_slug(f.v_brand_slug, f.v_trip_slug);
  v_names := pg_temp.t3801_names(f.v_brand_slug, f.v_trip_slug);
  IF v_names IS DISTINCT FROM 'A,B' OR json_array_length(v_payload -> 'tiers') <> 2 THEN
    RAISE EXCEPTION 'A-03 FAIL: sorted-last ghosts: expected A,B, got %', v_names;
  END IF;
  IF v_payload::text LIKE '%' || v_removed::text || '%' OR v_payload::text LIKE '%' || v_hidden::text || '%' THEN
    RAISE EXCEPTION 'A-03 FAIL: a removed or hidden package id is present in the response';
  END IF;
  RAISE NOTICE 'A-03 PASS: removed and hidden packages leave no ghost at either end';
END
$a03$;
ROLLBACK;

-- A-04: one package, then none. `tiers` is always a JSON array, never null.
BEGIN;
DO $a04$
DECLARE
  f record;
  g record;
  v_payload json;
BEGIN
  SELECT * INTO f FROM pg_temp.t3801_offering('a04one');
  PERFORM pg_temp.t3801_package(f.v_event, 'Solo', 7, now());
  v_payload := public.pg_public_trip_by_slug(f.v_brand_slug, f.v_trip_slug);
  IF json_typeof(v_payload -> 'tiers') <> 'array' OR json_array_length(v_payload -> 'tiers') <> 1
     OR v_payload -> 'tiers' -> 0 ->> 'tierName' <> 'Solo' THEN
    RAISE EXCEPTION 'A-04 FAIL: one package did not come back as a one-item array: %', v_payload -> 'tiers';
  END IF;

  SELECT * INTO g FROM pg_temp.t3801_offering('a04none');
  v_payload := public.pg_public_trip_by_slug(g.v_brand_slug, g.v_trip_slug);
  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'A-04 FAIL: a public trip with no packages was not returned';
  END IF;
  IF json_typeof(v_payload -> 'tiers') <> 'array' OR json_array_length(v_payload -> 'tiers') <> 0 THEN
    RAISE EXCEPTION 'A-04 FAIL: no packages must be an empty array, got %', v_payload -> 'tiers';
  END IF;
  RAISE NOTICE 'A-04 PASS: one package and no packages keep their shape';
END
$a04$;
ROLLBACK;

-- A-05: fifty packages. Stored in a scrambled physical order, then half of
-- them rewritten in place (an UPDATE moves a row in the heap, which is what
-- made the old order drift between reloads). Twenty reads, one answer.
BEGIN;
DO $a05$
DECLARE
  f record;
  v_expected text;
  v_first text;
  v_names text;
  i integer;
  n integer;
BEGIN
  SELECT * INTO f FROM pg_temp.t3801_offering('a05');
  -- 37 is coprime with 50, so (i * 37) % 50 visits every position exactly once
  -- in an order that is neither ascending nor descending.
  FOR i IN 0..49 LOOP
    n := (i * 37) % 50;
    PERFORM pg_temp.t3801_package(f.v_event, 'P' || lpad(n::text, 2, '0'), n,
                                  '2026-01-01 00:00:00+00'::timestamptz - make_interval(mins => n));
  END LOOP;
  UPDATE public.trip_pricing_tiers SET tier_metadata = '{"touched": true}'::jsonb
   WHERE event_id = f.v_event AND tier_name < 'P25';
  UPDATE public.ticket_types SET name = name || ' '
   WHERE event_id = f.v_event AND display_order % 3 = 0;

  SELECT string_agg('P' || lpad(g::text, 2, '0'), ',' ORDER BY g) INTO v_expected FROM generate_series(0, 49) AS g;
  FOR i IN 1..20 LOOP
    v_names := pg_temp.t3801_names(f.v_brand_slug, f.v_trip_slug);
    IF i = 1 THEN v_first := v_names; END IF;
    IF v_names IS DISTINCT FROM v_first THEN
      RAISE EXCEPTION 'A-05 FAIL: read % returned a different order from read 1', i;
    END IF;
    IF v_names IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'A-05 FAIL: read % is not the authored order: %', i, v_names;
    END IF;
  END LOOP;
  RAISE NOTICE 'A-05 PASS: fifty packages, twenty reads, the authored order every time';
END
$a05$;
ROLLBACK;

-- A-06: everything the reader refused before, it still refuses. Each offering
-- has a package, so a leak would return a full payload, not an empty one.
BEGIN;
DO $a06$
DECLARE
  f record;
  c record;
  v_payload json;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('draft',     'public',   'trip'),
      ('ended',     'public',   'trip'),
      ('cancelled', 'public',   'trip'),
      ('scheduled', 'private',  'trip'),
      ('scheduled', 'hidden',   'trip'),
      ('scheduled', 'discover', 'trip'),
      ('scheduled', 'draft',    'trip'),
      ('live',      'private',  'trip'),
      ('scheduled', 'public',   'event'),
      ('scheduled', 'public',   'experience')
    ) AS v(status, visibility, event_type)
  LOOP
    SELECT * INTO f FROM pg_temp.t3801_offering(
      'a06' || c.status || c.visibility || c.event_type, c.status, c.visibility, c.event_type);
    PERFORM pg_temp.t3801_package(f.v_event, 'Leak', 0, now());
    v_payload := public.pg_public_trip_by_slug(f.v_brand_slug, f.v_trip_slug);
    IF v_payload IS NOT NULL THEN
      RAISE EXCEPTION 'A-06 FAIL: a % / % / % offering was returned to the public', c.status, c.visibility, c.event_type;
    END IF;
  END LOOP;

  -- The two statuses the reader does admit, so the loop above is not passing
  -- because the fixture can never be read.
  SELECT * INTO f FROM pg_temp.t3801_offering('a06live', 'live', 'public', 'trip');
  PERFORM pg_temp.t3801_package(f.v_event, 'Shown', 0, now());
  IF public.pg_public_trip_by_slug(f.v_brand_slug, f.v_trip_slug) IS NULL THEN
    RAISE EXCEPTION 'A-06 FAIL: a live public trip was not returned (the refusals above prove nothing)';
  END IF;

  -- A deleted trip, a deleted brand, the wrong brand slug, a slug that does
  -- not exist and a NULL slug.
  UPDATE public.brands SET deleted_at = now() WHERE id = f.v_brand;
  IF public.pg_public_trip_by_slug(f.v_brand_slug, f.v_trip_slug) IS NOT NULL THEN
    RAISE EXCEPTION 'A-06 FAIL: a trip of a deleted brand was returned';
  END IF;
  SELECT * INTO f FROM pg_temp.t3801_offering('a06del', 'scheduled', 'public', 'trip');
  PERFORM pg_temp.t3801_package(f.v_event, 'Gone', 0, now());
  IF public.pg_public_trip_by_slug('issue-3801-adv-no-such-brand', f.v_trip_slug) IS NOT NULL
     OR public.pg_public_trip_by_slug(f.v_brand_slug, 'issue-3801-adv-no-such-trip') IS NOT NULL
     OR public.pg_public_trip_by_slug(NULL, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'A-06 FAIL: a wrong, missing or NULL slug returned a trip';
  END IF;
  SET LOCAL session_replication_role = replica;
  UPDATE public.events SET deleted_at = now() WHERE id = f.v_event;
  SET LOCAL session_replication_role = origin;
  IF public.pg_public_trip_by_slug(f.v_brand_slug, f.v_trip_slug) IS NOT NULL THEN
    RAISE EXCEPTION 'A-06 FAIL: a deleted trip was returned';
  END IF;
  RAISE NOTICE 'A-06 PASS: unpublished, private, hidden, deleted and non-trip offerings stay out';
END
$a06$;
ROLLBACK;

-- A-07: the exact keys of the response and of a package. The two columns the
-- fix reads to sort by must not be handed to buyers.
BEGIN;
DO $a07$
DECLARE
  f record;
  v_payload jsonb;
  v_top text;
  v_tier text;
BEGIN
  SELECT * INTO f FROM pg_temp.t3801_offering('a07');
  PERFORM pg_temp.t3801_package(f.v_event, 'Two', 1, now());
  PERFORM pg_temp.t3801_package(f.v_event, 'One', 0, now());
  v_payload := public.pg_public_trip_by_slug(f.v_brand_slug, f.v_trip_slug)::jsonb;

  SELECT string_agg(k, ',' ORDER BY k) INTO v_top FROM jsonb_object_keys(v_payload) AS k;
  -- [TEST-MOD-APPROVED #3859] The public trip contract now truthfully exposes
  -- whether any currently purchasable line has a server-confirmed installment
  -- plan. Keep the full exact-key pin so no unrelated field can hitchhike.
  -- The prior exact-key list was incomplete once that buyer-facing fact shipped.
  IF v_top IS DISTINCT FROM
     'bookingDeadline,bookingsClosed,brand,brandId,brandSlug,coverGallery,coverMediaAlt,coverMediaType,coverMediaUrl,currency,days,departureLat,departureLng,departureText,description,destinationLat,destinationLng,destinationText,endAt,id,inclusions,installmentCapabilityAvailable,refundPolicy,startAt,status,themeAnimationOverride,themeColorOverride,themeFontOverride,tiers,timezone,title,tripSlug' THEN
    RAISE EXCEPTION 'A-07 FAIL: the response keys changed: %', v_top;
  END IF;

  FOR v_tier IN
    SELECT (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(t) AS k)
      FROM jsonb_array_elements(v_payload -> 'tiers') AS t
  LOOP
    IF v_tier IS DISTINCT FROM
       'currency,id,installments,isFree,isUnlimited,priceCents,quantityTotal,ticketsRemaining,ticketTypeId,tierMetadata,tierName' THEN
      RAISE EXCEPTION 'A-07 FAIL: a package''s keys changed: %', v_tier;
    END IF;
  END LOOP;
  IF v_payload::text ~* 'display_?order|created_?at' THEN
    RAISE EXCEPTION 'A-07 FAIL: a sort column leaked into the response';
  END IF;
  RAISE NOTICE 'A-07 PASS: response and package keys are exactly what buyers already receive';
END
$a07$;
ROLLBACK;

-- A-08: the caller that matters. An anonymous buyer calls the reader and gets
-- the authored order, and the reader kept its security contract.
BEGIN;
DO $a08$
DECLARE
  f record;
  v_names text;
BEGIN
  SELECT * INTO f FROM pg_temp.t3801_offering('a08');
  PERFORM pg_temp.t3801_package(f.v_event, 'Last', 2, now() - interval '3 minutes');
  PERFORM pg_temp.t3801_package(f.v_event, 'Middle', 1, now() - interval '2 minutes');
  PERFORM pg_temp.t3801_package(f.v_event, 'First', 0, now() - interval '1 minute');

  SET LOCAL ROLE anon;
  SELECT string_agg(t.value ->> 'tierName', ',' ORDER BY t.ordinality) INTO v_names
    FROM json_array_elements(public.pg_public_trip_by_slug(f.v_brand_slug, f.v_trip_slug) -> 'tiers')
         WITH ORDINALITY AS t(value, ordinality);
  RESET ROLE;

  IF v_names IS DISTINCT FROM 'First,Middle,Last' THEN
    RAISE EXCEPTION 'A-08 FAIL: an anonymous buyer got %, expected First,Middle,Last', COALESCE(v_names, 'nothing');
  END IF;
  IF (SELECT p.prosecdef IS NOT TRUE OR p.provolatile <> 's'
             OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']
        FROM pg_proc p WHERE p.oid = 'public.pg_public_trip_by_slug(text,text)'::regprocedure) THEN
    RAISE EXCEPTION 'A-08 FAIL: the reader is no longer STABLE SECURITY DEFINER with search_path pinned to public';
  END IF;
  RAISE NOTICE 'A-08 PASS: an anonymous buyer gets the authored order; security contract unchanged';
END
$a08$;
ROLLBACK;

-- A-09: precedence. The package the host put first is the NEWEST row with the
-- HIGHEST tier id; the one put last is the oldest with the lowest id. Only
-- display_order may decide.
BEGIN;
DO $a09$
DECLARE
  f record;
  v_names text;
BEGIN
  SELECT * INTO f FROM pg_temp.t3801_offering('a09');
  PERFORM pg_temp.t3801_package(f.v_event, 'last-oldest-lowest', 5, '2020-01-01 00:00:00+00', '00000000-0000-4000-8000-00000000000a');
  PERFORM pg_temp.t3801_package(f.v_event, 'mid', 3, '2023-01-01 00:00:00+00', '88888888-0000-4000-8000-00000000000b');
  PERFORM pg_temp.t3801_package(f.v_event, 'first-newest-highest', -1, '2026-01-01 00:00:00+00', 'ffffffff-0000-4000-8000-00000000000c');
  v_names := pg_temp.t3801_names(f.v_brand_slug, f.v_trip_slug);
  IF v_names IS DISTINCT FROM 'first-newest-highest,mid,last-oldest-lowest' THEN
    RAISE EXCEPTION 'A-09 FAIL: the authored position must beat age and id; got %', v_names;
  END IF;
  RAISE NOTICE 'A-09 PASS: the authored position beats age and tier id';
END
$a09$;
ROLLBACK;

SELECT 'issue_3801_public_trip_tiers_ordered tester adversarial: PASS' AS result;
