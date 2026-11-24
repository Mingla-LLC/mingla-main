-- #4490 after #4579: executable PostgreSQL 17 proof for migration
-- 20281203774490 (Till staff names follow #4579's public-name rule). The suite
-- owns its fixture and rolls back.
--
-- MINGLA-INVARIANT: I-4490-STAFF-NAME-MINGLA-RULE | issue #4490 | every #4490 Till surface that names a staff member (Who's selling, the PIN pad and approvers, kitchen and stock "by", the PIN greeting, the day close and its CSV and PDF) names a Mingla Team member of the brand (#4579 issue_4579_is_mingla_team_member) only as issue_4579_admin_public_name plus "from Mingla" (or "Mingla Team"), through issue_4490_staff_name; never an email, a handle or a profile name.
--
-- Fixture: the real #4579 path. Two active Mingla admins are inserted into
-- admin_users, and #4579's trigger adds them to the brand as auto Brand admins.
-- A third Mingla admin already has an invited row on the brand, so #4579 adds
-- nothing for them and they keep their own name.
--
-- FAILS-ON-REVERT (verified on a fresh replay): without 20281203774490 the
-- floor name is the profile name ("Kunle", or the email handle), MT-1 to MT-5
-- fail, and MT-6 fails (the Mingla admin is left off the PIN pad).
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION public.t4490mt_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490MT FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490mt_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END
$f$;
CREATE FUNCTION public.t4490mt_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490mt_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490mt_ok(boolean, text), public.t4490mt_as(uuid),
  public.t4490mt_service(), public.t4490mt_reset() TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner, 02 invited seller, 03 Mingla admin "Kunle" (auto-added),
-- 04 Mingla admin with an invited row of their own, 05 Mingla admin whose only
-- name is their email handle (auto-added), 06 a Till device login.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900777-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'i4490-mt-' || n || '@example.test', now(), now()
FROM generate_series(1, 6) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44900777-0000-4000-8000-000000000001', now());
INSERT INTO public.profiles (id, display_name, first_name) VALUES
  ('44900777-0000-4000-8000-000000000002', 'Ada Seller', NULL),
  ('44900777-0000-4000-8000-000000000003', 'Kunle', 'i4490-mt-3'),
  ('44900777-0000-4000-8000-000000000004', 'Tunde Invited', NULL),
  ('44900777-0000-4000-8000-000000000005', 'i4490-mt-5', 'i4490-mt-5')
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, first_name = EXCLUDED.first_name;
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900777-0000-4000-9000-000000000010', '44900777-0000-4000-8000-000000000001',
   'Mingla Names 4490', 'mingla-names-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900777-0000-4000-9000-0000000000a1', '44900777-0000-4000-9000-000000000010', 'minglanamesa', 'Names Bar',
   6.45, 3.40, 'bar_lounge', 'verified', 'NG');
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900777-0000-4000-a000-000000000002', '44900777-0000-4000-9000-000000000010', '44900777-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900777-0000-4000-a000-000000000004', '44900777-0000-4000-9000-000000000010', '44900777-0000-4000-8000-000000000004', 'brand_admin', now()),
  ('44900777-0000-4000-a000-000000000006', '44900777-0000-4000-9000-000000000010', '44900777-0000-4000-8000-000000000006', 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900777-0000-4000-a000-000000000002', '44900777-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900777-0000-4000-a000-000000000006', '44900777-0000-4000-9000-0000000000a1', 'custom',
   ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen']);
-- #4579's real path: active Mingla admins are added to every live brand.
INSERT INTO public.admin_users (id, email, role, status) VALUES
  ('44900777-0000-4000-b000-000000000003', 'i4490-mt-3@example.test', 'admin', 'active'),
  ('44900777-0000-4000-b000-000000000004', 'i4490-mt-4@example.test', 'admin', 'active'),
  ('44900777-0000-4000-b000-000000000005', 'i4490-mt-5@example.test', 'admin', 'active');

SELECT public.t4490mt_ok(
  public.issue_4579_is_auto_member('44900777-0000-4000-9000-000000000010', '44900777-0000-4000-8000-000000000003')
  AND public.issue_4579_is_auto_member('44900777-0000-4000-9000-000000000010', '44900777-0000-4000-8000-000000000005')
  AND NOT public.issue_4579_is_mingla_team_member('44900777-0000-4000-9000-000000000010', '44900777-0000-4000-8000-000000000004'),
  'MT-0 fixture: #4579 added admins 03 and 05 as auto Brand admins; 04 keeps their invited row');

SELECT public.t4490mt_as('44900777-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature('44900777-0000-4000-9000-0000000000a1', 'till', true,
  NULL, NULL, NULL, 'mt-key-till-on', true);
SELECT public.t4490mt_reset();

SELECT public.t4490mt_service();

-- MT-1: the one floor name (kitchen, stock, PIN greeting, day close).
SELECT public.t4490mt_ok(
  public.issue_4490_floor_person_name('44900777-0000-4000-8000-000000000003', '44900777-0000-4000-9000-0000000000a1') = 'Kunle from Mingla'
  AND public.issue_4490_floor_person_name('44900777-0000-4000-8000-000000000005', '44900777-0000-4000-9000-0000000000a1') = 'Mingla Team'
  AND public.issue_4490_floor_person_name('44900777-0000-4000-8000-000000000004', '44900777-0000-4000-9000-0000000000a1') = 'Tunde Invited'
  AND public.issue_4490_floor_person_name('44900777-0000-4000-8000-000000000002', '44900777-0000-4000-9000-0000000000a1') = 'Ada Seller',
  'MT-1 floor name: a Mingla Team member is "<name> from Mingla" (or "Mingla Team"); an invited Mingla admin and staff keep their names');

-- MT-2: Who's selling: full parity (listed) with the Mingla name and flag.
DO $servers$
DECLARE
  v jsonb := public.issue_4490_till_servers('44900777-0000-4000-9000-0000000000a1', '44900777-0000-4000-8000-000000000001');
  kunle jsonb;
  team jsonb;
  ada jsonb;
BEGIN
  SELECT e INTO kunle FROM jsonb_array_elements(v) e WHERE e->>'userId' = '44900777-0000-4000-8000-000000000003';
  SELECT e INTO team FROM jsonb_array_elements(v) e WHERE e->>'userId' = '44900777-0000-4000-8000-000000000005';
  SELECT e INTO ada FROM jsonb_array_elements(v) e WHERE e->>'userId' = '44900777-0000-4000-8000-000000000002';
  PERFORM public.t4490mt_ok(kunle->>'name' = 'Kunle from Mingla' AND (kunle->>'isMinglaTeam')::boolean
      AND team->>'name' = 'Mingla Team' AND (team->>'isMinglaTeam')::boolean
      AND ada->>'name' = 'Ada Seller' AND NOT (ada->>'isMinglaTeam')::boolean,
    'MT-2 Who''s selling lists Mingla admins (full parity) as "Kunle from Mingla" / "Mingla Team" with isMinglaTeam ' || v::text);
  PERFORM public.t4490mt_ok(v::text !~* '(example\.test|i4490-mt-)',
    'MT-3 Who''s selling never carries an email or an email handle');
END
$servers$;

-- MT-4: the day close names the Mingla admin by the same rule.
SELECT public.t4490mt_ok(
  public.issue_4490_close_person('44900777-0000-4000-9000-0000000000a1', '44900777-0000-4000-8000-000000000003')
    = jsonb_build_object('userId', '44900777-0000-4000-8000-000000000003', 'kind', 'mingla_support', 'name', 'Kunle from Mingla')
  AND public.issue_4490_close_person('44900777-0000-4000-9000-0000000000a1', '44900777-0000-4000-8000-000000000005')->>'name' = 'Mingla Team'
  AND public.issue_4490_close_person('44900777-0000-4000-9000-0000000000a1', '44900777-0000-4000-8000-000000000004')->>'kind' = 'person',
  'MT-4 day close (sales and tips by person, Taken by, closed by, CSV and PDF): the Mingla admin is "Kunle from Mingla", kind mingla_support');

-- MT-5: every #4490 surface that names staff goes through the rule.
SELECT public.t4490mt_ok(NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('public.issue_4490_floor_person_name(uuid,uuid)', 'issue_4490_staff_name'),
      ('public.issue_4490_till_servers(uuid,uuid)', 'issue_4490_staff_name'),
      ('public.issue_4490_pin_staff(uuid,uuid)', 'issue_4490_staff_name'),
      ('public.issue_4490_close_person(uuid,uuid)', 'issue_4490_floor_person_name'),
      ('public.issue_4490_station_ticket_projection(uuid,text)', 'issue_4490_floor_person_name'),
      ('public.issue_4490_stock_projection(uuid)', 'issue_4490_floor_person_name'),
      ('public.issue_4490_pin_unlock(uuid,uuid,uuid,text,uuid)', 'issue_4490_floor_person_name'),
      ('public.issue_4490_pin_session_resolve(bytea,uuid,uuid,uuid)', 'issue_4490_floor_person_name'),
      ('public.issue_4490_station_accept(uuid,text,uuid)', 'issue_4490_floor_person_name'),
      ('public.issue_4490_station_ticket_ready(uuid,text,uuid)', 'issue_4490_floor_person_name'),
      ('public.issue_4490_order_picked_up(uuid,text,uuid)', 'issue_4490_floor_person_name')) x(sig, needle)
    WHERE position(x.needle IN pg_get_functiondef(x.sig::regprocedure)) = 0)
  AND position('issue_4579_admin_public_name' IN pg_get_functiondef('public.issue_4490_staff_name(uuid,uuid,text)'::regprocedure)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.proname LIKE 'issue\_4490\_%'
      AND p.proname NOT IN ('issue_4490_floor_person_name', 'issue_4490_till_servers', 'issue_4490_pin_staff')
      AND pg_get_functiondef(p.oid) ~ 'pr?\.(display_name|first_name)'
      AND pg_get_functiondef(p.oid) ~ 'public\.brand_team_members'),
  'MT-5 every staff-naming #4490 function goes through issue_4490_staff_name (no other reader builds a staff name from profiles)');

-- MT-6: a Mingla admin may hold a Till PIN and is on the PIN pad.
SELECT public.issue_4490_pin_set('44900777-0000-4000-a000-000000000002', '44900777-0000-4000-8000-000000000002', '2580');
DO $pin$
DECLARE
  v_member uuid;
  v jsonb;
  kunle jsonb;
BEGIN
  SELECT m.id INTO v_member FROM public.brand_team_members m
  WHERE m.brand_id = '44900777-0000-4000-9000-000000000010' AND m.user_id = '44900777-0000-4000-8000-000000000003'
    AND m.removed_at IS NULL;
  PERFORM public.issue_4490_pin_set(v_member, '44900777-0000-4000-8000-000000000003', '7391');
  v := public.issue_4490_pin_staff('44900777-0000-4000-9000-0000000000a1', '44900777-0000-4000-8000-000000000006');
  SELECT e INTO kunle FROM jsonb_array_elements(v->'staff') e WHERE e->>'memberId' = v_member::text;
  PERFORM public.t4490mt_ok((v->>'gated')::boolean AND kunle->>'name' = 'Kunle from Mingla'
      AND (kunle->>'isMinglaTeam')::boolean AND (kunle->>'canApprove')::boolean
      AND v::text !~* '(example\.test|i4490-mt-)'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'staff') e
                  WHERE e->>'name' = 'Ada Seller' AND NOT (e->>'isMinglaTeam')::boolean),
    'MT-6 the PIN pad lists the Mingla admin (full parity) as "Kunle from Mingla", an approver, never an email ' || v::text);
END
$pin$;

SELECT public.t4490mt_reset();
ROLLBACK;
