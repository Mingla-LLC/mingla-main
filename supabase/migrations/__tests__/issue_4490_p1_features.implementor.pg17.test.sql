\set ON_ERROR_STOP on
-- #4490 P1-1: executable PostgreSQL 17 proof of venue spaces, features, the
-- nine venue types and the venue capabilities (20281203004490), and of the
-- #2099 pin owner (20281203054490). BEGIN ... ROLLBACK: every fixture rolls back.
--
-- MINGLA-INVARIANT: I-4490-FEATURE-SINGLE-HOME | issue #4490 | venue_features is the one home of whether a venue feature is on; reservations_enabled and ordering_enabled mirror it both ways (set_venue_feature writes the legacy switch, a direct legacy write moves the feature) and the feature set never holds a child without its parent.
-- MINGLA-INVARIANT: I-4490-VENUE-TABLES-NO-CLIENT-WRITES | issue #4490 | venue_spaces, venue_space_combinations and venue_features are read by brand members, Mingla admins and venue.* staff of that venue only; anon has no grant and every write goes through a SECURITY DEFINER RPC.
--
-- T-1  shape: RLS on, anon has no grant, authenticated SELECT only, RPCs SECURITY DEFINER with search_path,
--      internal helpers not callable by clients, capability and category CHECKs widened.
-- T-2  derived rows: a venue without stored rows reads the backfill values (menu on unless stay, tables and
--      waitlist = reservations_enabled, ordering = ordering_enabled, stays = category stay).
-- T-3  dependency matrix (each rule on and off), cascade, space requirement, built-feature gate, stays managed.
-- T-4  mirror: RPC -> legacy column (both switches, both directions); direct legacy write -> feature;
--      legacy on pulls its parent on; legacy off pushes dependents off; ordering needs a verified venue.
-- T-5  presets: idempotent replay, never turns anything off, unbuilt skipped, club has no guest list, stay = stays.
-- T-6  space-scoped feature ids validated; archive removes the space from every scope and its combinations.
-- T-7  RLS: owner and admin-rank member read, outsider 0 rows, anon denied, direct INSERT denied,
--      venue.* staff read their venue only, restaurant-only staff read nothing.
-- T-8  authority + conflicts: event_manager cannot switch features but can manage spaces; venue.manage_offers
--      staff manage spaces; stale_write PT409; idempotent replay and 23505 on a changed request.
-- T-9  spaces and combinations: validation, duplicate name PT409, parts sorted, cross-venue parts refused,
--      last space while a feature needs it PT409.
-- T-10 nine categories + secondary categories; venue.* capability grants work through the 4188 helper.
-- T-11 #2099 pin owner: the live dependency-schema fingerprint equals the pin both RPCs carry, and the
--      correction accepts the new categories.
--
-- FAILS-ON-REVERT: drop 20281203004490 -> T-1 (tables missing); drop the mirror trigger -> T-4c;
-- drop the dependency check -> T-3a; drop the RLS policy predicate -> T-7c.

BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;

CREATE FUNCTION public.t4490_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490 FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490 FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;

CREATE FUNCTION public.t4490_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
  PERFORM set_config('role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
END
$f$;

CREATE FUNCTION public.t4490_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;

-- Fixture ---------------------------------------------------------------------
-- users: 01 owner, 02 brand_admin, 03 event_manager, 04 outsider,
--        05 staff venue.check_in on A, 06 staff restaurant.manage_menu on A,
--        07 staff venue.manage_offers on A, 08 staff venue.view_bookings on B
-- venues: A restaurant verified, B restaurant unverified, S stay verified, X another brand
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '-4490@example.test', now(), now()
FROM generate_series(1, 9) n;
INSERT INTO public.creator_accounts (id, created_at)
VALUES ('44900000-0000-4000-8000-000000000001', now()), ('44900000-0000-4000-8000-000000000009', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('44900000-0000-4000-9000-000000000010', '44900000-0000-4000-8000-000000000001', 'Gameland 4490', 'gameland-4490', 'NGN', now(), now()),
  ('44900000-0000-4000-9000-000000000020', '44900000-0000-4000-8000-000000000009', 'Other 4490', 'other-4490', 'NGN', now(), now());
INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at) VALUES
  ('44900000-0000-4000-9000-000000000010', '44900000-0000-4000-8000-000000000002', 'brand_admin', now()),
  ('44900000-0000-4000-9000-000000000010', '44900000-0000-4000-8000-000000000003', 'event_manager', now()),
  ('44900000-0000-4000-9000-000000000010', '44900000-0000-4000-8000-000000000005', 'venue_staff', now()),
  ('44900000-0000-4000-9000-000000000010', '44900000-0000-4000-8000-000000000006', 'venue_staff', now()),
  ('44900000-0000-4000-9000-000000000010', '44900000-0000-4000-8000-000000000007', 'venue_staff', now()),
  ('44900000-0000-4000-9000-000000000010', '44900000-0000-4000-8000-000000000008', 'venue_staff', now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status) VALUES
  ('44900000-0000-4000-9000-0000000000a1', '44900000-0000-4000-9000-000000000010', 'gogi4490', 'Gogi 4490', 6.45, 3.40, 'restaurant', 'verified'),
  ('44900000-0000-4000-9000-0000000000b1', '44900000-0000-4000-9000-000000000010', 'pending4490', 'Pending 4490', 6.46, 3.41, 'restaurant', 'pending_review'),
  ('44900000-0000-4000-9000-0000000000c1', '44900000-0000-4000-9000-000000000010', 'stay4490', 'Stay 4490', 6.47, 3.42, 'stay', 'verified'),
  ('44900000-0000-4000-9000-0000000000d1', '44900000-0000-4000-9000-000000000020', 'other4490', 'Other 4490', 6.48, 3.43, 'restaurant', 'verified');
INSERT INTO public.venue_reservation_settings (brand_id, venue_id, reservations_enabled) VALUES
  ('44900000-0000-4000-9000-000000000010', '44900000-0000-4000-9000-0000000000a1', true),
  ('44900000-0000-4000-9000-000000000010', '44900000-0000-4000-9000-0000000000b1', false);
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities)
SELECT m.id, g.venue_id, 'custom', g.caps
FROM public.brand_team_members m
JOIN (VALUES
  ('44900000-0000-4000-8000-000000000005'::uuid, '44900000-0000-4000-9000-0000000000a1'::uuid, ARRAY['venue.check_in']::text[]),
  ('44900000-0000-4000-8000-000000000006'::uuid, '44900000-0000-4000-9000-0000000000a1'::uuid, ARRAY['restaurant.manage_menu']::text[]),
  ('44900000-0000-4000-8000-000000000007'::uuid, '44900000-0000-4000-9000-0000000000a1'::uuid, ARRAY['venue.manage_offers', 'venue.manage_money']::text[]),
  ('44900000-0000-4000-8000-000000000008'::uuid, '44900000-0000-4000-9000-0000000000b1'::uuid, ARRAY['venue.view_bookings']::text[])
) AS g(user_id, venue_id, caps) ON g.user_id = m.user_id
WHERE m.brand_id = '44900000-0000-4000-9000-000000000010';

-- T-1 shape ---------------------------------------------------------------------
SELECT public.t4490_ok(bool_and(c.relrowsecurity), 'T-1a RLS on for the four new tables')
FROM pg_class c WHERE c.oid IN ('public.venue_spaces'::regclass, 'public.venue_space_combinations'::regclass,
  'public.venue_features'::regclass, 'public.issue_4490_write_receipts'::regclass);
SELECT public.t4490_ok(
  bool_and(NOT has_table_privilege('anon', t, 'SELECT') AND NOT has_table_privilege('anon', t, 'INSERT')
    AND NOT has_table_privilege('authenticated', t, 'INSERT') AND NOT has_table_privilege('authenticated', t, 'UPDATE')
    AND NOT has_table_privilege('authenticated', t, 'DELETE')),
  'T-1b anon has no grant; authenticated cannot write')
FROM unnest(ARRAY['public.venue_spaces', 'public.venue_space_combinations', 'public.venue_features',
  'public.issue_4490_write_receipts']) AS t;
SELECT public.t4490_ok(NOT has_table_privilege('authenticated', 'public.issue_4490_write_receipts', 'SELECT')
  AND has_table_privilege('authenticated', 'public.venue_features', 'SELECT'),
  'T-1c receipts are private; features readable through RLS');
SELECT public.t4490_ok(
  bool_and(p.prosecdef AND EXISTS (SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg = 'search_path=""')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')),
  'T-1d client RPCs are SECURITY DEFINER, search_path pinned, never anon')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('issue_4490_get_venue_features', 'issue_4490_set_venue_feature',
  'issue_4490_apply_feature_preset', 'issue_4490_manage_space', 'issue_4490_manage_space_combination');
SELECT public.t4490_ok(
  bool_and(NOT has_function_privilege('authenticated', f, 'EXECUTE')),
  'T-1e internal helpers are not callable by clients')
FROM unnest(ARRAY['public.issue_4490_write_feature_row(uuid,text,boolean,uuid[],jsonb,boolean)',
  'public.issue_4490_write_legacy_switch(uuid,text,boolean)', 'public.issue_4490_receipt_lookup(text,text,text)',
  'public.issue_4490_receipt_store(text,text,text,jsonb)', 'public.issue_4490_venue_feature_rows(uuid)']) AS f;
SELECT public.t4490_ok(
  pg_get_constraintdef(oid) LIKE '%venue.manage_money%' AND pg_get_constraintdef(oid) LIKE '%venue.check_in%',
  'T-1f member grant CHECK accepts venue.* capabilities')
FROM pg_constraint WHERE conname = 'brand_team_member_venue_capabilities_valid';
SELECT public.t4490_ok(count(*) = 1, 'T-1g btree_gist installed')
FROM pg_extension WHERE extname = 'btree_gist';

-- T-2 derived rows ------------------------------------------------------------
-- TEST-MOD-APPROVED #4490: the Till migration (ops_till_core) added the `till` and `kitchen_screens` feature keys; both read off until written.
SELECT public.t4490_ok(
  (SELECT jsonb_object_agg(feature_key, enabled) FROM public.issue_4490_venue_feature_rows('44900000-0000-4000-9000-0000000000a1'))
  = '{"entry":false,"group_packages":false,"private_hire":false,"by_the_hour":false,"table_reservations":true,"floor_plan":false,"pick_a_table":false,"menu":true,"table_ordering":false,"min_spend_tables":false,"guest_list":false,"memberships":false,"stays":false,"events_here":false,"waitlist":true,"till":false,"kitchen_screens":false}'::jsonb,
  'T-2a restaurant with reservations on: tables, waitlist and menu on; nothing else');
SELECT public.t4490_ok(
  (SELECT jsonb_object_agg(feature_key, enabled) FILTER (WHERE enabled) FROM public.issue_4490_venue_feature_rows('44900000-0000-4000-9000-0000000000c1'))
  = '{"stays":true}'::jsonb,
  'T-2b stay venue: only stays (no menu)');
SELECT public.t4490_ok(
  (SELECT count(*) FROM public.venue_features WHERE venue_id IN ('44900000-0000-4000-9000-0000000000a1', '44900000-0000-4000-9000-0000000000b1')) = 0,
  'T-2c a new venue and its legacy settings rows create no stored feature rows (derived until written)');

-- T-3 dependency matrix ------------------------------------------------------------
-- Owner of brand 10. A = verified restaurant with reservations on.
SELECT public.t4490_as('44900000-0000-4000-8000-000000000001');
DO $t3$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1', 'menu', false, NULL, NULL, NULL, 't3-menu-off-1');
  PERFORM public.t4490_ok(v->'changed_keys' = '["menu"]'::jsonb, 'T-3a menu off with nothing depending on it');
END
$t3$;
SELECT public.t4490_expect($$SELECT public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1','table_ordering',true,NULL,NULL,NULL,'t3-ord-on-1')$$,
  'P0001', 'feature_requires:menu', 'T-3b table_ordering needs menu (no cascade)');
DO $t3c$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1', 'table_ordering', true, NULL, NULL, NULL, 't3-ord-on-2', true);
  PERFORM public.t4490_ok(v->'changed_keys' = '["menu","table_ordering"]'::jsonb, 'T-3c cascade turns the parent on first, in one call');
END
$t3c$;
SELECT public.t4490_expect($$SELECT public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1','menu',false,NULL,NULL,NULL,'t3-menu-off-2')$$,
  'P0001', 'feature_has_dependents:table_ordering', 'T-3d menu cannot go while table_ordering needs it');
DO $t3e$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1', 'menu', false, NULL, NULL, NULL, 't3-menu-off-3', true);
  PERFORM public.t4490_ok(v->'changed_keys' = '["table_ordering","menu"]'::jsonb, 'T-3e cascade off turns the dependent off too');
END
$t3e$;
SELECT public.t4490_reset();
SELECT public.t4490_ok(NOT ordering_enabled, 'T-3f cascade off wrote ordering_enabled = false')
FROM public.venue_ordering_settings WHERE venue_id = '44900000-0000-4000-9000-0000000000a1';
-- [TEST-MOD-APPROVED #4490] memberships shipped in P6; guest list (ruled out of the first build) is the unbuilt example now.
-- [TEST-MOD-APPROVED #4490] W2 fix 1: guest list shipped too (20281203394490), so
-- every feature is built and none is left to be the unbuilt example. The guard
-- is still proven: for this transaction the built list is every feature except
-- guest list (a stand-in for a phase that has not shipped), as the P-3+ block
-- below already does with every feature. Same assertions, same codes.
SELECT public.t4490_reset();
CREATE OR REPLACE FUNCTION public.issue_4490_built_features()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $f$
  SELECT array_remove(public.issue_4490_feature_keys(), 'guest_list'); $f$;
SELECT public.t4490_as('44900000-0000-4000-8000-000000000001');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1','guest_list',true,NULL,NULL,NULL,'t3-pick-1',true)$$,
  'P0001', 'feature_not_available:guest_list', 'T-3g a feature whose phase has not shipped cannot be switched on (even by cascade)');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1','guest_list',true,NULL,NULL,NULL,'t3-guest-1')$$,
  'P0001', 'feature_not_available:guest_list', 'T-3h guest list is not built');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000c1','stays',false,NULL,NULL,NULL,'t3-stays-1')$$,
  'P0001', 'feature_managed:stays', 'T-3i stays follows the Stay workspace, never a switch');
SELECT public.t4490_reset();

-- Every feature built (this transaction only) to prove the rules that P2+ ship.
CREATE OR REPLACE FUNCTION public.issue_4490_built_features()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $f$ SELECT public.issue_4490_feature_keys(); $f$;
SELECT public.t4490_as('44900000-0000-4000-8000-000000000001');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1','pick_a_table',true,NULL,NULL,NULL,'t3-pick-2')$$,
  'P0001', 'feature_requires:floor_plan', 'T-3j pick_a_table needs floor_plan (tables already on)');
-- [TEST-MOD-APPROVED #4490] fix round 1 (B2, N20): a feature that needs a space is no longer
-- refused before the space exists (the add-venue wizard switches features on before any
-- space can exist); it goes on and the read says what it still needs. T-3k / T-3l assert
-- that, then switch both back off so T-3m below runs as before.
DO $t3k$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1', 'pick_a_table', true, NULL, NULL, NULL, 't3-pick-3', true);
  PERFORM public.t4490_ok(v->'changed_keys' = '["floor_plan","pick_a_table"]'::jsonb
    AND (SELECT f->'needs' FROM jsonb_array_elements(v->'features'->'features') f WHERE f->>'key' = 'floor_plan') ? 'space',
    'T-3k with no space yet, floor plan and pick a table go on; the floor plan still needs a space');
  v := public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1', 'private_hire', true, NULL, NULL, NULL, 't3-hire-1');
  PERFORM public.t4490_ok(v->'needs' = '["space"]'::jsonb, 'T-3l private hire goes on and needs a space');
  PERFORM public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1', 'floor_plan', false, NULL, NULL, NULL, 't3-fp-undo', true);
  PERFORM public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1', 'private_hire', false, NULL, NULL, NULL, 't3-hire-undo');
END
$t3k$;
DO $t3m$
DECLARE
  v jsonb;
BEGIN
  PERFORM public.issue_4490_manage_space('create', '44900000-0000-4000-9000-0000000000a1',
    '{"name":"Main Floor","capacity_seated":60}'::jsonb);
  v := public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1', 'pick_a_table', true, NULL, NULL, NULL, 't3-pick-4', true);
  PERFORM public.t4490_ok(v->'changed_keys' = '["floor_plan","pick_a_table"]'::jsonb, 'T-3m with a space, cascade turns floor_plan then pick_a_table on');
  v := public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1', 'min_spend_tables', true, NULL, NULL, NULL, 't3-min-1');
  PERFORM public.t4490_ok(v->'changed_keys' = '["min_spend_tables"]'::jsonb, 'T-3n min_spend_tables on (tables on)');
  v := public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1', 'memberships', true, NULL, NULL, NULL, 't3-mem-1');
  PERFORM public.t4490_ok(v->'changed_keys' = '["memberships"]'::jsonb, 'T-3o memberships has no hard dependency');
END
$t3m$;
SELECT public.t4490_expect($$SELECT public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1','table_reservations',false,NULL,NULL,NULL,'t3-tr-off-1')$$,
  'P0001', 'feature_has_dependents:floor_plan,pick_a_table,min_spend_tables', 'T-3p tables cannot go while floor plan, pick a table and min spend need them');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1','floor_plan',false,NULL,NULL,NULL,'t3-fp-off-1')$$,
  'P0001', 'feature_has_dependents:pick_a_table', 'T-3q floor plan cannot go while pick a table needs it');
DO $t3r$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1', 'table_reservations', false, NULL, NULL, NULL, 't3-tr-off-2', true);
  PERFORM public.t4490_ok(v->'changed_keys' = '["floor_plan","pick_a_table","min_spend_tables","table_reservations"]'::jsonb,
    'T-3r cascade off takes every dependent down with tables');
END
$t3r$;
SELECT public.t4490_reset();
SELECT public.t4490_ok(NOT reservations_enabled, 'T-3s and wrote reservations_enabled = false')
FROM public.venue_reservation_settings WHERE venue_id = '44900000-0000-4000-9000-0000000000a1';

-- Back to the shipped P1 list.
CREATE OR REPLACE FUNCTION public.issue_4490_built_features()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $f$
  SELECT ARRAY['table_reservations', 'waitlist', 'menu', 'table_ordering', 'events_here', 'stays']::text[];
$f$;
UPDATE public.venue_features SET enabled = false WHERE venue_id = '44900000-0000-4000-9000-0000000000a1' AND feature_key = 'memberships';

-- T-4 mirror ---------------------------------------------------------------------
SELECT public.t4490_as('44900000-0000-4000-8000-000000000001');
DO $t4a$
DECLARE
  v_before bigint;
  v_after bigint;
BEGIN
  PERFORM public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1', 'table_reservations', true, NULL, NULL, NULL, 't4-tr-on-1');
  PERFORM public.t4490_ok((SELECT reservations_enabled FROM public.venue_reservation_settings WHERE venue_id = '44900000-0000-4000-9000-0000000000a1'),
    'T-4a RPC on writes reservations_enabled = true in the same transaction');
  SELECT version INTO v_before FROM public.venue_features WHERE venue_id = '44900000-0000-4000-9000-0000000000a1' AND feature_key = 'table_reservations';
  PERFORM public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1', 'table_reservations', false, NULL, NULL, NULL, 't4-tr-off-1');
  SELECT version INTO v_after FROM public.venue_features WHERE venue_id = '44900000-0000-4000-9000-0000000000a1' AND feature_key = 'table_reservations';
  PERFORM public.t4490_ok(v_after = v_before + 1
      AND NOT (SELECT reservations_enabled FROM public.venue_reservation_settings WHERE venue_id = '44900000-0000-4000-9000-0000000000a1'),
    'T-4b RPC off writes the legacy switch once; the reverse trigger does not echo it (one version bump)');
  PERFORM public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1', 'table_reservations', true, NULL, NULL, NULL, 't4-tr-on-2');
END
$t4a$;
-- An old Host build writes the legacy switch directly (event_manager, PostgREST upsert).
SELECT public.t4490_as('44900000-0000-4000-8000-000000000003');
INSERT INTO public.venue_reservation_settings (brand_id, venue_id, reservations_enabled)
VALUES ('44900000-0000-4000-9000-000000000010', '44900000-0000-4000-9000-0000000000a1', false)
ON CONFLICT (venue_id) DO UPDATE SET reservations_enabled = EXCLUDED.reservations_enabled;
SELECT public.t4490_reset();
SELECT public.t4490_ok(NOT enabled, 'T-4c a direct legacy write (old build) moves the stored feature off')
FROM public.venue_features WHERE venue_id = '44900000-0000-4000-9000-0000000000a1' AND feature_key = 'table_reservations';
-- B has no stored rows: the derived read follows the legacy column itself.
SELECT public.t4490_as('44900000-0000-4000-8000-000000000003');
UPDATE public.venue_reservation_settings SET reservations_enabled = true WHERE venue_id = '44900000-0000-4000-9000-0000000000b1';
SELECT public.t4490_reset();
SELECT public.t4490_ok(
  (SELECT enabled FROM public.issue_4490_venue_feature_rows('44900000-0000-4000-9000-0000000000b1') WHERE feature_key = 'table_reservations')
  AND NOT EXISTS (SELECT 1 FROM public.venue_features WHERE venue_id = '44900000-0000-4000-9000-0000000000b1'),
  'T-4d a venue without stored rows reads the legacy switch live (no row written)');
UPDATE public.venue_reservation_settings SET reservations_enabled = false WHERE venue_id = '44900000-0000-4000-9000-0000000000b1';
-- Legacy off pushes dependents off; legacy on pulls the parent on.
UPDATE public.venue_reservation_settings SET reservations_enabled = true WHERE venue_id = '44900000-0000-4000-9000-0000000000a1';
UPDATE public.venue_features SET enabled = true WHERE venue_id = '44900000-0000-4000-9000-0000000000a1' AND feature_key IN ('floor_plan', 'min_spend_tables');
UPDATE public.venue_reservation_settings SET reservations_enabled = false WHERE venue_id = '44900000-0000-4000-9000-0000000000a1';
SELECT public.t4490_ok(count(*) = 0, 'T-4e legacy reservations off turns floor_plan and min_spend_tables off')
FROM public.venue_features WHERE venue_id = '44900000-0000-4000-9000-0000000000a1'
  AND feature_key IN ('floor_plan', 'min_spend_tables', 'table_reservations') AND enabled;
UPDATE public.venue_ordering_settings SET ordering_enabled = true WHERE venue_id = '44900000-0000-4000-9000-0000000000a1';
SELECT public.t4490_ok(bool_and(enabled) AND count(*) = 2, 'T-4f legacy ordering on moves table_ordering on and pulls menu on')
FROM public.venue_features WHERE venue_id = '44900000-0000-4000-9000-0000000000a1' AND feature_key IN ('table_ordering', 'menu');
UPDATE public.venue_ordering_settings SET ordering_enabled = false WHERE venue_id = '44900000-0000-4000-9000-0000000000a1';
UPDATE public.venue_reservation_settings SET reservations_enabled = true WHERE venue_id = '44900000-0000-4000-9000-0000000000a1';
SELECT public.t4490_ok(enabled, 'T-4g legacy reservations on moves the stored feature back on')
FROM public.venue_features WHERE venue_id = '44900000-0000-4000-9000-0000000000a1' AND feature_key = 'table_reservations';
SELECT public.t4490_as('44900000-0000-4000-8000-000000000001');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000b1','table_ordering',true,NULL,NULL,NULL,'t4-ord-b-1')$$,
  'P0001', 'venue_not_orderable', 'T-4h ordering cannot be switched on for an unverified venue (#1791 gate kept)');
SELECT public.t4490_reset();

-- T-5 presets ---------------------------------------------------------------------
-- [TEST-MOD-APPROVED #4490] the Till migration (ops_till_core) added `till` (club) and `till` + `kitchen_screens` (restaurant) to the presets.
-- [TEST-MOD-APPROVED #4490] fix round 1 (B3): the server presets follow the client table (club adds Menu and Table ordering).
SELECT public.t4490_ok(public.issue_4490_feature_preset('club') = ARRAY['entry','table_reservations','min_spend_tables','menu','table_ordering','events_here','till']
  AND public.issue_4490_feature_preset('stay') = ARRAY['stays']
  AND public.issue_4490_feature_preset('restaurant') = ARRAY['table_reservations','waitlist','menu','table_ordering','till','kitchen_screens']
  AND public.issue_4490_feature_preset('nightclub') IS NULL,
  'T-5a presets: club has no guest list, stay is stays only');
SELECT public.t4490_as('44900000-0000-4000-8000-000000000001');
-- [TEST-MOD-APPROVED #4490] the Till migration (ops_till_core) put `till` and `kitchen_screens` in the restaurant preset; both are skipped as not_available_yet until the Till flag is on.
DO $t5$
DECLARE
  v1 jsonb;
  v2 jsonb;
  v3 jsonb;
BEGIN
  PERFORM public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000b1', 'events_here', true, NULL, NULL, NULL, 't5-ev-b-1');
  v1 := public.issue_4490_apply_feature_preset('44900000-0000-4000-9000-0000000000b1', 'restaurant', 't5-preset-1');
  PERFORM public.t4490_ok(v1->'applied' = '["table_reservations"]'::jsonb
    AND v1->'skipped' = '[{"key":"waitlist","reason":"already_on"},{"key":"menu","reason":"already_on"},{"key":"table_ordering","reason":"venue_not_orderable"},{"key":"till","reason":"not_available_yet"},{"key":"kitchen_screens","reason":"not_available_yet"}]'::jsonb,
    'T-5b restaurant preset on an unverified venue: tables on, ordering held back');
  v2 := public.issue_4490_apply_feature_preset('44900000-0000-4000-9000-0000000000b1', 'restaurant', 't5-preset-1');
  PERFORM public.t4490_ok((v2->>'replayed')::boolean AND v2->'applied' = v1->'applied', 'T-5c same key replays the first result');
  v3 := public.issue_4490_apply_feature_preset('44900000-0000-4000-9000-0000000000b1', 'restaurant', 't5-preset-2');
  PERFORM public.t4490_ok(v3->'applied' = '[]'::jsonb, 'T-5d applying again changes nothing');
  PERFORM public.t4490_ok((SELECT enabled FROM public.venue_features WHERE venue_id = '44900000-0000-4000-9000-0000000000b1' AND feature_key = 'events_here'),
    'T-5e a preset never turns anything off');
  v1 := public.issue_4490_apply_feature_preset('44900000-0000-4000-9000-0000000000a1', 'play', 't5-preset-3');
  -- [TEST-MOD-APPROVED #4490] fix round 1 (B3): the play preset now also starts Table ordering (this venue is verified).
  PERFORM public.t4490_ok(v1->'applied' = '["table_ordering", "events_here"]'::jsonb
    AND v1->'skipped' @> '[{"key":"entry","reason":"not_available_yet"},{"key":"private_hire","reason":"not_available_yet"}]'::jsonb,
    'T-5f unbuilt preset switches are skipped, built ones applied: ' || (v1->'applied')::text || ' ' || (v1->'skipped')::text);
END
$t5$;
SELECT public.t4490_as('44900000-0000-4000-8000-000000000003');
SELECT public.t4490_expect($$SELECT public.issue_4490_apply_feature_preset('44900000-0000-4000-9000-0000000000a1','restaurant','t5-preset-em')$$,
  '42501', 'not_authorized', 'T-5g an event manager cannot apply a preset (owner/admin only)');
SELECT public.t4490_reset();

-- T-6 space-scoped features ----------------------------------------------------------
INSERT INTO public.venue_spaces (id, venue_id, brand_id, name, capacity_standing)
VALUES ('44900000-0000-4000-a000-0000000000d1', '44900000-0000-4000-9000-0000000000d1', '44900000-0000-4000-9000-000000000020', 'Foreign Hall', 50);
SELECT public.t4490_as('44900000-0000-4000-8000-000000000001');
DO $t6$
DECLARE
  v_s1 uuid;
  v_s2 uuid;
  v jsonb;
BEGIN
  v_s1 := (public.issue_4490_manage_space('create', '44900000-0000-4000-9000-0000000000a1', '{"name":"Lounge Side","capacity_seated":30}'::jsonb)->>'id')::uuid;
  v_s2 := (public.issue_4490_manage_space('create', '44900000-0000-4000-9000-0000000000a1', '{"name":"Terrace","setting":"outdoor","capacity_standing":80}'::jsonb)->>'id')::uuid;
  PERFORM public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1', 'events_here', true,
    ARRAY[v_s2, v_s1], '{"note":"weekends"}'::jsonb, NULL, 't6-event-1');
  PERFORM public.t4490_ok((SELECT space_ids = ARRAY(SELECT unnest(ARRAY[v_s1, v_s2]) ORDER BY 1) AND settings = '{"note":"weekends"}'::jsonb
      FROM public.venue_features WHERE venue_id = '44900000-0000-4000-9000-0000000000a1' AND feature_key = 'events_here'),
    'T-6a scoped space ids stored sorted, settings kept');
  PERFORM public.issue_4490_manage_space_combination('create', '44900000-0000-4000-9000-0000000000a1',
    jsonb_build_object('name', 'Whole Floor', 'space_ids', jsonb_build_array(v_s2, v_s1)));
  PERFORM public.issue_4490_manage_space('archive', '44900000-0000-4000-9000-0000000000a1', jsonb_build_object('id', v_s1));
  PERFORM public.t4490_ok((SELECT space_ids = ARRAY[v_s2] FROM public.venue_features
      WHERE venue_id = '44900000-0000-4000-9000-0000000000a1' AND feature_key = 'events_here'),
    'T-6b archiving a space removes it from every feature scope');
  PERFORM public.t4490_ok((SELECT archived_at IS NOT NULL FROM public.venue_space_combinations WHERE name = 'Whole Floor'),
    'T-6c archiving a part archives its combinations');
END
$t6$;
SELECT public.t4490_expect($$SELECT public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1','events_here',true,ARRAY['44900000-0000-4000-a000-0000000000d1']::uuid[],NULL,NULL,'t6-event-2')$$,
  '22023', 'feature_space_ids_invalid', 'T-6d a space of another venue cannot scope a feature');
SELECT public.t4490_reset();

-- T-7 RLS ---------------------------------------------------------------------------
SELECT public.t4490_as('44900000-0000-4000-8000-000000000001');
SELECT public.t4490_ok(count(*) > 0, 'T-7a owner reads venue A features') FROM public.venue_features WHERE venue_id = '44900000-0000-4000-9000-0000000000a1';
SELECT public.t4490_as('44900000-0000-4000-8000-000000000002');
SELECT public.t4490_ok(count(*) > 0, 'T-7b brand admin reads them') FROM public.venue_features WHERE venue_id = '44900000-0000-4000-9000-0000000000a1';
SELECT public.t4490_as('44900000-0000-4000-8000-000000000004');
SELECT public.t4490_ok(
  (SELECT count(*) FROM public.venue_features) = 0 AND (SELECT count(*) FROM public.venue_spaces) = 0
  AND (SELECT count(*) FROM public.venue_space_combinations) = 0,
  'T-7c an outsider reads 0 rows of every new table');
SELECT public.t4490_expect($$SELECT public.issue_4490_get_venue_features('44900000-0000-4000-9000-0000000000a1')$$,
  '42501', 'not_authorized', 'T-7d an outsider cannot read the feature RPC');
SELECT public.t4490_as('44900000-0000-4000-8000-000000000001');
SELECT public.t4490_expect($$INSERT INTO public.venue_features (venue_id, brand_id, feature_key, enabled) VALUES ('44900000-0000-4000-9000-0000000000c1','44900000-0000-4000-9000-000000000010','events_here',true)$$,
  '42501', NULL, 'T-7e a direct INSERT by the owner is denied');
SELECT public.t4490_expect($$UPDATE public.venue_spaces SET name = 'x'$$, '42501', NULL, 'T-7f a direct UPDATE by the owner is denied');
SELECT public.t4490_as(NULL);
SELECT public.t4490_expect($$SELECT count(*) FROM public.venue_features$$, '42501', NULL, 'T-7g anon has no read');
SELECT public.t4490_expect($$SELECT public.issue_4490_get_venue_features('44900000-0000-4000-9000-0000000000a1')$$,
  '42501', NULL, 'T-7h anon cannot call the feature RPC');
SELECT public.t4490_as('44900000-0000-4000-8000-000000000005');
SELECT public.t4490_ok(
  (SELECT count(*) FROM public.venue_features WHERE venue_id = '44900000-0000-4000-9000-0000000000a1') > 0
  AND (SELECT count(*) FROM public.venue_spaces WHERE venue_id = '44900000-0000-4000-9000-0000000000a1') > 0
  AND (SELECT count(*) FROM public.venue_features WHERE venue_id = '44900000-0000-4000-9000-0000000000b1') = 0,
  'T-7i check-in-only staff read their venue, not another');
SELECT public.t4490_ok((public.issue_4490_get_venue_features('44900000-0000-4000-9000-0000000000a1')->>'venue_id') IS NOT NULL,
  'T-7j check-in-only staff read the feature RPC for their venue');
SELECT public.t4490_as('44900000-0000-4000-8000-000000000006');
SELECT public.t4490_ok((SELECT count(*) FROM public.venue_features) = 0, 'T-7k restaurant-only staff read no venue feature rows');
SELECT public.t4490_as('44900000-0000-4000-8000-000000000008');
SELECT public.t4490_ok(
  (SELECT count(*) FROM public.venue_features WHERE venue_id = '44900000-0000-4000-9000-0000000000b1') > 0
  AND (SELECT count(*) FROM public.venue_features WHERE venue_id = '44900000-0000-4000-9000-0000000000a1') = 0,
  'T-7l view_bookings staff of B read B only');
SELECT public.t4490_reset();

-- T-8 authority and conflicts --------------------------------------------------------------
SELECT public.t4490_as('44900000-0000-4000-8000-000000000003');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1','events_here',false,NULL,NULL,NULL,'t8-emgr-1')$$,
  '42501', 'not_authorized', 'T-8a an event manager cannot switch features');
SELECT public.t4490_ok((public.issue_4490_manage_space('create', '44900000-0000-4000-9000-0000000000a1', '{"name":"Arcade","capacity_standing":120}'::jsonb)->>'name') = 'Arcade',
  'T-8b an event manager can add a space');
SELECT public.t4490_as('44900000-0000-4000-8000-000000000007');
SELECT public.t4490_ok((public.issue_4490_manage_space('create', '44900000-0000-4000-9000-0000000000a1', '{"name":"Bowling","capacity_standing":40}'::jsonb)->>'name') = 'Bowling',
  'T-8c venue.manage_offers staff can add a space');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1','events_here',false,NULL,NULL,NULL,'t8-staff-1')$$,
  '42501', 'not_authorized', 'T-8d venue staff cannot switch features');
SELECT public.t4490_as('44900000-0000-4000-8000-000000000005');
SELECT public.t4490_expect($$SELECT public.issue_4490_manage_space('create','44900000-0000-4000-9000-0000000000a1','{"name":"Nope","capacity_standing":4}'::jsonb)$$,
  '42501', 'not_authorized', 'T-8e check-in-only staff cannot add a space');
SELECT public.t4490_as('44900000-0000-4000-8000-000000000001');
DO $t8$
DECLARE
  v_version bigint;
  v1 jsonb;
  v2 jsonb;
BEGIN
  SELECT version INTO v_version FROM public.venue_features WHERE venue_id = '44900000-0000-4000-9000-0000000000a1' AND feature_key = 'events_here';
  v1 := public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1', 'events_here', false, NULL, NULL, v_version, 't8-event-1');
  v2 := public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1', 'events_here', false, NULL, NULL, v_version, 't8-event-1');
  PERFORM public.t4490_ok(NOT (v1->>'replayed')::boolean AND (v2->>'replayed')::boolean AND v1->'changed_keys' = v2->'changed_keys',
    'T-8f a replay with the same key returns the first result');
END
$t8$;
SELECT public.t4490_expect($$SELECT public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1','events_here',true,NULL,NULL,NULL,'t8-event-1')$$,
  '23505', 'offer_idempotency_conflict', 'T-8g the same key with a different request is refused');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1','events_here',true,NULL,NULL,1,'t8-event-2')$$,
  'PT409', 'stale_write', 'T-8h a stale expected version is a PT409 conflict (never 40001)');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1','events_here',true,NULL,NULL,NULL,'short')$$,
  '22023', 'idempotency_key_invalid', 'T-8i idempotency key must be 8..200 characters');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000a1','vip_lounge',true,NULL,NULL,NULL,'t8-bad-key')$$,
  '22023', 'invalid_feature_key', 'T-8j unknown feature key');
SELECT public.t4490_reset();

-- T-9 spaces and combinations --------------------------------------------------------------
SELECT public.t4490_as('44900000-0000-4000-8000-000000000001');
SELECT public.t4490_expect($$SELECT public.issue_4490_manage_space('create','44900000-0000-4000-9000-0000000000a1','{"name":"No Size"}'::jsonb)$$,
  '22023', 'space_invalid', 'T-9a a space needs a standing or seated capacity');
SELECT public.t4490_expect($$SELECT public.issue_4490_manage_space('create','44900000-0000-4000-9000-0000000000a1','{"name":"   ","capacity_standing":5}'::jsonb)$$,
  '22023', 'space_invalid', 'T-9b a space needs a name');
SELECT public.t4490_expect($$SELECT public.issue_4490_manage_space('create','44900000-0000-4000-9000-0000000000a1','{"name":" terrace ","capacity_standing":5}'::jsonb)$$,
  'PT409', 'space_name_taken', 'T-9c space names are unique per venue (trimmed, any case)');
SELECT public.t4490_expect($$SELECT public.issue_4490_manage_space('create','44900000-0000-4000-9000-0000000000a1','{"name":"Roof","setting":"sky","capacity_standing":5}'::jsonb)$$,
  '22023', 'space_setting_invalid', 'T-9d setting is indoor, covered or outdoor');
SELECT public.t4490_expect($$SELECT public.issue_4490_manage_space('create','44900000-0000-4000-9000-0000000000a1','{"name":"Roof","capacity_standing":5,"plan_shape":{"x":0,"y":0,"w":1200,"h":10}}'::jsonb)$$,
  '22023', 'space_plan_invalid', 'T-9e plan shape stays inside 0..1000 plan units');
SELECT public.t4490_expect($$SELECT public.issue_4490_manage_space('create','44900000-0000-4000-9000-0000000000a1','{"name":"Roof","capacity_standing":5,"amenities":["01234567890123456789012345678901234567890"]}'::jsonb)$$,
  '22023', 'space_amenities_invalid', 'T-9f an amenity is 1..40 characters');
SELECT public.t4490_expect($$SELECT public.issue_4490_manage_space('create','44900000-0000-4000-9000-0000000000a1','{"name":"Roof","capacity_standing":200000}'::jsonb)$$,
  '22023', 'space_invalid', 'T-9g capacity is at most 100000');
DO $t9$
DECLARE
  v_half_a jsonb;
  v_half_b jsonb;
  v_combo jsonb;
  v jsonb;
BEGIN
  v_half_a := public.issue_4490_manage_space('create', '44900000-0000-4000-9000-0000000000a1',
    '{"name":"Half Green A","setting":"outdoor","capacity_standing":300,"capacity_seated":150,"amenities":["Shade","shade","Power"],"step_free":true,"plan_shape":{"x":10,"y":20,"w":300,"h":200,"rotation":0}}'::jsonb);
  PERFORM public.t4490_ok(v_half_a->'amenities' = '["Power","Shade"]'::jsonb AND (v_half_a->>'can_be_hired')::boolean
      AND (v_half_a->>'step_free')::boolean AND v_half_a->'plan_shape'->>'w' = '300',
    'T-9h space columns stored: amenities trimmed and de-duplicated, can_be_hired default, step_free, plan');
  v_half_b := public.issue_4490_manage_space('create', '44900000-0000-4000-9000-0000000000a1',
    '{"name":"Half Green B","setting":"outdoor","capacity_standing":300,"capacity_seated":150}'::jsonb);
  v_combo := public.issue_4490_manage_space_combination('create', '44900000-0000-4000-9000-0000000000a1',
    jsonb_build_object('name', 'Whole Green', 'space_ids', jsonb_build_array(v_half_b->>'id', v_half_a->>'id')));
  PERFORM public.t4490_ok((v_combo->>'capacity_standing')::int = 600 AND (v_combo->>'capacity_seated')::int = 300
      AND v_combo->'space_ids' = (SELECT jsonb_agg(x ORDER BY x) FROM unnest(ARRAY[(v_half_a->>'id')::uuid, (v_half_b->>'id')::uuid]) x),
    'T-9i a combination stores its parts sorted; capacity is the sum of the parts');
  v := public.issue_4490_manage_space('update', '44900000-0000-4000-9000-0000000000a1',
    jsonb_build_object('id', v_half_a->>'id', 'capacity_standing', 280), (v_half_a->>'version')::bigint);
  PERFORM public.t4490_ok((v->>'capacity_standing')::int = 280 AND (v->>'version')::bigint = (v_half_a->>'version')::bigint + 1
      AND v->>'name' = 'Half Green A', 'T-9j update patches only the fields sent and bumps the version');
  BEGIN
    PERFORM public.issue_4490_manage_space('update', '44900000-0000-4000-9000-0000000000a1',
      jsonb_build_object('id', v_half_a->>'id', 'capacity_standing', 270), (v_half_a->>'version')::bigint);
    RAISE EXCEPTION 'T4490 FAIL: T-9k stale space update accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    PERFORM public.t4490_ok(SQLERRM = 'stale_write', 'T-9k a stale space update is PT409 stale_write');
  END;
  BEGIN
    PERFORM public.issue_4490_manage_space_combination('create', '44900000-0000-4000-9000-0000000000a1',
      jsonb_build_object('name', 'Whole Green Again', 'space_ids', jsonb_build_array(v_half_a->>'id', v_half_b->>'id')));
    RAISE EXCEPTION 'T4490 FAIL: T-9l duplicate combination accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    PERFORM public.t4490_ok(SQLERRM = 'combination_exists', 'T-9l the same parts cannot be combined twice');
  END;
  BEGIN
    PERFORM public.issue_4490_manage_space_combination('create', '44900000-0000-4000-9000-0000000000a1',
      jsonb_build_object('name', 'Cross', 'space_ids', jsonb_build_array(v_half_a->>'id', '44900000-0000-4000-a000-0000000000d1')));
    RAISE EXCEPTION 'T4490 FAIL: T-9m cross-venue combination accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    PERFORM public.t4490_ok(SQLERRM = 'combination_parts_invalid', 'T-9m a combination cannot use another venue''s space');
  END;
  BEGIN
    PERFORM public.issue_4490_manage_space_combination('create', '44900000-0000-4000-9000-0000000000a1',
      jsonb_build_object('name', 'Solo', 'space_ids', jsonb_build_array(v_half_a->>'id')));
    RAISE EXCEPTION 'T4490 FAIL: T-9n one-part combination accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    PERFORM public.t4490_ok(SQLERRM = 'combination_parts_invalid', 'T-9n a combination has at least two parts');
  END;
  v := public.issue_4490_manage_space('reorder', '44900000-0000-4000-9000-0000000000a1',
    jsonb_build_object('ids', jsonb_build_array(v_half_b->>'id', v_half_a->>'id')));
  PERFORM public.t4490_ok(v->'spaces'->0->>'id' = v_half_b->>'id', 'T-9o reorder puts the listed spaces first, in order');
END
$t9$;
SELECT public.t4490_reset();
-- The last space cannot go while a feature needs a space (venue B, rules built for this check).
CREATE OR REPLACE FUNCTION public.issue_4490_built_features()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $f$ SELECT public.issue_4490_feature_keys(); $f$;
SELECT public.t4490_as('44900000-0000-4000-8000-000000000001');
DO $t9p$
DECLARE
  v_only uuid;
BEGIN
  v_only := (public.issue_4490_manage_space('create', '44900000-0000-4000-9000-0000000000b1', '{"name":"Hall","capacity_standing":100}'::jsonb)->>'id')::uuid;
  PERFORM public.issue_4490_set_venue_feature('44900000-0000-4000-9000-0000000000b1', 'private_hire', true, NULL, NULL, NULL, 't9-hire-1');
  BEGIN
    PERFORM public.issue_4490_manage_space('archive', '44900000-0000-4000-9000-0000000000b1', jsonb_build_object('id', v_only));
    RAISE EXCEPTION 'T4490 FAIL: T-9p last space archived under private hire';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    PERFORM public.t4490_ok(SQLERRM = 'space_in_use', 'T-9p the last space cannot be archived while private hire needs it');
  END;
END
$t9p$;
SELECT public.t4490_reset();
CREATE OR REPLACE FUNCTION public.issue_4490_built_features()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $f$
  SELECT ARRAY['table_reservations', 'waitlist', 'menu', 'table_ordering', 'events_here', 'stays']::text[];
$f$;

-- T-10 categories and capabilities ----------------------------------------------------------
SELECT public.t4490_expect($$INSERT INTO public.venue_listings (brand_id, slug, name, lat, lng, venue_category) VALUES ('44900000-0000-4000-9000-000000000010','bad4490','Bad',6.4,3.4,'nightclub')$$,
  '23514', NULL, 'T-10a an unknown category is refused');
INSERT INTO public.venue_listings (brand_id, slug, name, lat, lng, venue_category, secondary_categories)
SELECT '44900000-0000-4000-9000-000000000010', 'cat' || replace(c, '_', '') || '4490', 'Cat ' || c, 6.4, 3.4, c,
  CASE WHEN c = 'club' THEN ARRAY['bar_lounge', 'event_space'] ELSE '{}'::text[] END
FROM unnest(ARRAY['bar_lounge', 'club', 'cafe', 'event_space', 'coworking']) AS c;
SELECT public.t4490_ok(count(*) = 5, 'T-10b the five new categories are accepted, with up to two secondary labels')
FROM public.venue_listings WHERE slug LIKE 'cat%4490';
UPDATE public.brands SET venue_category = 'cafe' WHERE id = '44900000-0000-4000-9000-000000000010';
SELECT public.t4490_expect($$UPDATE public.venue_listings SET secondary_categories = ARRAY['club'] WHERE slug = 'catclub4490'$$,
  '23514', NULL, 'T-10c the main category cannot repeat as a secondary one');
SELECT public.t4490_expect($$UPDATE public.venue_listings SET secondary_categories = ARRAY['cafe','cafe'] WHERE slug = 'catclub4490'$$,
  '23514', NULL, 'T-10d secondary labels are distinct');
SELECT public.t4490_expect($$UPDATE public.venue_listings SET secondary_categories = ARRAY['cafe','play','stay'] WHERE slug = 'catclub4490'$$,
  '23514', NULL, 'T-10e at most two secondary labels');
SELECT public.t4490_as('44900000-0000-4000-8000-000000000005');
SELECT public.t4490_ok(
  public.issue_4188_has_venue_capability('44900000-0000-4000-9000-0000000000a1', '44900000-0000-4000-8000-000000000005', 'venue.check_in')
  AND NOT public.issue_4188_has_venue_capability('44900000-0000-4000-9000-0000000000a1', '44900000-0000-4000-8000-000000000005', 'venue.manage_offers'),
  'T-10f a venue.check_in grant answers through the 4188 helper; nothing more');
SELECT public.t4490_reset();
DO $t10g$
DECLARE
  v_pid uuid := gen_random_uuid();
  v_vid uuid := gen_random_uuid();
  r jsonb;
BEGIN
  PERFORM public.t4490_ok(
    (public.issue_3386_identity_patch(v, NULL, 'coworking', NULL, NULL, NULL, NULL, NULL, NULL)->>'venue_category') = 'coworking',
    'T-10g a host edit can move a venue to a new category')
  FROM public.venue_listings v WHERE v.id = '44900000-0000-4000-9000-0000000000a1';
END
$t10g$;

-- T-11 #2099 pin owner -------------------------------------------------------------------
DO $t11$
DECLARE
  v_live text := public.issue_2099_pending_venue_dependency_inventory(
    '00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000002'::uuid) ->> 'schema_fingerprint';
  v_preview text := pg_get_functiondef('public.preview_pending_venue_identity_correction(uuid)'::regprocedure);
  v_correct text := pg_get_functiondef('public.correct_pending_venue_identity(uuid,uuid,uuid,timestamptz,text,text,text,text,text,text,text,uuid,text,text,text,uuid)'::regprocedure);
BEGIN
  PERFORM public.t4490_ok(strpos(v_preview, left(v_live, 32)) > 0 AND strpos(v_preview, substr(v_live, 33)) > 0
      AND strpos(v_correct, left(v_live, 32)) > 0 AND strpos(v_correct, substr(v_live, 33)) > 0
      AND strpos(v_correct, '957efbc24ad78cc3ae5e0d5bf79162c8') = 0,
    'T-11a both #2099 RPCs carry the live reviewed dependency-schema pin');
  PERFORM public.t4490_ok(strpos(v_correct, '''coworking''') > 0 AND strpos(v_correct, '''night_club''') > 0,
    'T-11b the pending-venue correction knows the nine categories');
  PERFORM public.t4490_ok(
    (SELECT bool_and(lane->>'classification' = 'disallowed') FROM jsonb_array_elements(
      public.issue_2099_pending_venue_dependency_inventory('44900000-0000-4000-9000-0000000000b1', NULL)->'lanes') lane
     WHERE lane->>'safe_label' = 'dependency')
    AND (SELECT sum((lane->>'count')::int) FROM jsonb_array_elements(
      public.issue_2099_pending_venue_dependency_inventory('44900000-0000-4000-9000-0000000000b1', NULL)->'lanes') lane
     WHERE lane->>'classification' = 'disallowed') > 0,
    'T-11c the venue feature lanes stay disallowed: a pending venue with stored feature rows is not auto-correctable');
END
$t11$;

ROLLBACK;
