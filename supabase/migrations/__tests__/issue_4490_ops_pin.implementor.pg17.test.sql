-- #4490 spec 08 O5 part A: executable PostgreSQL 17 proof for staff PINs on a
-- shared Till device (migration 20281203684490). The suite owns its fixture
-- and rolls back.
--
-- MINGLA-INVARIANT: I-4490-PIN-NEVER-SIGNS-IN | issue #4490 | a PIN only switches the person acting on an already signed-in Till device login: issue_4490_pin_unlock refuses any account that is not a Till device at that venue, a Till device never holds a PIN, and a PIN session is honoured only for that device account, that venue and that device's auth session.
-- MINGLA-INVARIANT: I-4490-PIN-HASH-UNREADABLE | issue #4490 | brand_member_pins, venue_staff_switch_sessions, venue_pin_attempts and venue_pin_approvals have RLS on and no anon/authenticated grants; only bcrypt PIN hashes and sha256 token hashes are stored; every PIN function is service role only.
-- MINGLA-INVARIANT: I-4490-TILL-DEVICE-NEVER-ACTS-ALONE | issue #4490 | a Till device login is never the actor of a Till payment or refund row, and a row recorded for a device needs a live PIN session (or a fresh approval) for its actor, checked in the same transaction.
--
-- FAILS-ON-REVERT: without 20281203684490 the first PIN call fails (no issue_4490_pin_set).
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490p_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490P FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490p_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490P FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490P FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490p_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
  PERFORM set_config('request.jwt.claims', CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
    ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
  PERFORM set_config('role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
END
$f$;
CREATE FUNCTION public.t4490p_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490p_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490p_ok(boolean,text), public.t4490p_expect(text,text,text,text),
  public.t4490p_as(uuid), public.t4490p_service(), public.t4490p_reset() TO PUBLIC;

CREATE TEMP TABLE t4490p_ids (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON t4490p_ids TO PUBLIC;
CREATE FUNCTION public.t4490p_id(p_k text) RETURNS text LANGUAGE sql AS $f$
  SELECT v FROM t4490p_ids WHERE k = p_k
$f$;
GRANT EXECUTE ON FUNCTION public.t4490p_id(text) TO PUBLIC;
-- The edge's hash of a session token (sha256 of its 32 bytes).
CREATE FUNCTION public.t4490p_hash(p_token text) RETURNS bytea LANGUAGE sql AS $f$
  SELECT extensions.digest(decode(p_token, 'hex'), 'sha256')
$f$;
GRANT EXECUTE ON FUNCTION public.t4490p_hash(text) TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner, 02 seller (venue.sell at A), 03 manager (restaurant manager
-- at A: sell, kitchen, money), 04 finance manager, 05 Till device at A and B,
-- 06 kitchen only at A, 07 removed seller, 08 other brand owner, 09 a second
-- Till device at A, 10 seller at A without a PIN.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900500-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'pin-o5-' || n || '@example.test', now(), now()
FROM generate_series(1, 10) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES
  ('44900500-0000-4000-8000-000000000001', now()), ('44900500-0000-4000-8000-000000000008', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900500-0000-4000-9000-000000000010', '44900500-0000-4000-8000-000000000001',
   'PIN O5 4490', 'pin-o5-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now()),
  ('44900500-0000-4000-9000-000000000020', '44900500-0000-4000-8000-000000000008',
   'PIN O5 Other 4490', 'pin-o5-other-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-9000-000000000010', 'pino5a', 'PIN Bar A',
   6.45, 3.40, 'bar_lounge', 'verified', 'NG'),
  ('44900500-0000-4000-9000-0000000000b1', '44900500-0000-4000-9000-000000000010', 'pino5b', 'PIN Bar B',
   6.45, 3.41, 'bar_lounge', 'verified', 'NG'),
  ('44900500-0000-4000-9000-0000000000c1', '44900500-0000-4000-9000-000000000020', 'pino5c', 'Other Bar',
   6.46, 3.42, 'bar_lounge', 'verified', 'NG');
-- A brand's owner gets a team row when the brand is made; give those rows known ids.
INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at)
SELECT b, u, 'brand_owner', now() FROM (VALUES
  ('44900500-0000-4000-9000-000000000010'::uuid, '44900500-0000-4000-8000-000000000001'::uuid),
  ('44900500-0000-4000-9000-000000000020'::uuid, '44900500-0000-4000-8000-000000000008'::uuid)) x(b, u)
WHERE NOT EXISTS (SELECT 1 FROM public.brand_team_members m WHERE m.brand_id = x.b AND m.user_id = x.u AND m.removed_at IS NULL);
UPDATE public.brand_team_members SET id = '44900500-0000-4000-a000-000000000001', accepted_at = COALESCE(accepted_at, now())
WHERE brand_id = '44900500-0000-4000-9000-000000000010' AND user_id = '44900500-0000-4000-8000-000000000001' AND removed_at IS NULL;
UPDATE public.brand_team_members SET id = '44900500-0000-4000-a000-000000000008', accepted_at = COALESCE(accepted_at, now())
WHERE brand_id = '44900500-0000-4000-9000-000000000020' AND user_id = '44900500-0000-4000-8000-000000000008' AND removed_at IS NULL;
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at, removed_at) VALUES
  ('44900500-0000-4000-a000-000000000002', '44900500-0000-4000-9000-000000000010', '44900500-0000-4000-8000-000000000002', 'venue_staff', now(), NULL),
  ('44900500-0000-4000-a000-000000000003', '44900500-0000-4000-9000-000000000010', '44900500-0000-4000-8000-000000000003', 'venue_staff', now(), NULL),
  ('44900500-0000-4000-a000-000000000004', '44900500-0000-4000-9000-000000000010', '44900500-0000-4000-8000-000000000004', 'finance_manager', now(), NULL),
  ('44900500-0000-4000-a000-000000000005', '44900500-0000-4000-9000-000000000010', '44900500-0000-4000-8000-000000000005', 'venue_staff', now(), NULL),
  ('44900500-0000-4000-a000-000000000006', '44900500-0000-4000-9000-000000000010', '44900500-0000-4000-8000-000000000006', 'venue_staff', now(), NULL),
  ('44900500-0000-4000-a000-000000000007', '44900500-0000-4000-9000-000000000010', '44900500-0000-4000-8000-000000000007', 'venue_staff', now(), NULL),
  ('44900500-0000-4000-a000-000000000009', '44900500-0000-4000-9000-000000000010', '44900500-0000-4000-8000-000000000009', 'venue_staff', now(), NULL),
  ('44900500-0000-4000-a000-000000000010', '44900500-0000-4000-9000-000000000010', '44900500-0000-4000-8000-000000000010', 'venue_staff', now(), NULL);
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900500-0000-4000-a000-000000000002', '44900500-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900500-0000-4000-a000-000000000003', '44900500-0000-4000-9000-0000000000a1', 'restaurant_manager',
   ARRAY['venue.sell', 'venue.kitchen', 'venue.manage_money', 'restaurant.view_orders', 'restaurant.manage_orders']),
  ('44900500-0000-4000-a000-000000000005', '44900500-0000-4000-9000-0000000000a1', 'till_device',
   ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen', 'venue.check_in']),
  ('44900500-0000-4000-a000-000000000005', '44900500-0000-4000-9000-0000000000b1', 'till_device',
   ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen', 'venue.check_in']),
  ('44900500-0000-4000-a000-000000000006', '44900500-0000-4000-9000-0000000000a1', 'kitchen_bar', ARRAY['venue.kitchen']),
  ('44900500-0000-4000-a000-000000000007', '44900500-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900500-0000-4000-a000-000000000009', '44900500-0000-4000-9000-0000000000a1', 'till_device',
   ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen', 'venue.check_in']),
  ('44900500-0000-4000-a000-000000000010', '44900500-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900500-0000-4000-b000-000000000001', '44900500-0000-4000-9000-000000000010', '44900500-0000-4000-9000-0000000000a1', 'Bar', true);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available) VALUES
  ('44900500-0000-4000-b000-000000000011', '44900500-0000-4000-b000-000000000001', '44900500-0000-4000-9000-000000000010', 'Chapman', 250000, 'NGN', true);

SELECT public.t4490p_as('44900500-0000-4000-8000-000000000001');
DO $feat$
BEGIN
  PERFORM public.issue_4490_set_venue_feature('44900500-0000-4000-9000-0000000000a1', 'menu', true, NULL, NULL, NULL, 'o5-menu-a');
  PERFORM public.issue_4490_set_venue_feature('44900500-0000-4000-9000-0000000000a1', 'till', true, NULL, NULL, NULL, 'o5-till-a');
  PERFORM public.issue_4490_set_venue_feature('44900500-0000-4000-9000-0000000000b1', 'till', true, NULL, NULL, NULL, 'o5-till-b');
END
$feat$;
SELECT public.t4490p_reset();
-- The removed seller (07) left after the grant was written.
UPDATE public.brand_team_members SET removed_at = now() WHERE id = '44900500-0000-4000-a000-000000000007';

-- A held menu round of n x Chapman, exactly as venue-till inserts it.
CREATE FUNCTION public.t4490p_round(p_sale uuid, p_actor uuid, p_qty integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_order uuid := gen_random_uuid();
  v_sub integer := 250000 * p_qty;
BEGIN
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = p_sale;
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, taken_by_user_id, pickup_code,
    money_path, currency, subtotal_cents, list_subtotal_cents, discount_cents, service_charge_bps, service_charge_cents,
    tip_cents, effective_take_rate_bps, service_fee_bps, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, total_cents, payment_status, fulfillment_status, idempotency_key, metadata
  ) VALUES (
    v_order, v_sale.session_id, v_sale.brand_id, v_sale.venue_id, 'staff', p_actor,
    lpad((100 + floor(random() * 800))::int::text, 3, '0'),
    'venue_collected', 'NGN', v_sub, v_sub, 0, 0, 0, 0, 0, 0, false, false, false,
    v_sub, v_sub, 'pending', 'held', 'till-round:' || v_order,
    jsonb_build_object('unsettled_staff_order', true, 'till_sale_id', p_sale));
  INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
    currency, quantity, modifiers_total_cents, line_total_cents)
  VALUES (v_order, '44900500-0000-4000-b000-000000000011', 1, 'Chapman', 250000, 'NGN', p_qty, 0, 250000 * p_qty);
  RETURN v_order;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490p_round(uuid, uuid, integer) TO PUBLIC;

-- ---------------------------------------------------------------------------
-- PIN-1 Nothing is readable by clients (I-4490-PIN-HASH-UNREADABLE).
-- ---------------------------------------------------------------------------
SELECT public.t4490p_reset();
SELECT public.t4490p_ok(
  (SELECT bool_and(c.relrowsecurity) FROM pg_class c WHERE c.oid IN (
     'public.brand_member_pins'::regclass, 'public.venue_staff_switch_sessions'::regclass,
     'public.venue_pin_attempts'::regclass, 'public.venue_pin_approvals'::regclass))
  AND NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['public.brand_member_pins', 'public.venue_staff_switch_sessions',
                               'public.venue_pin_attempts', 'public.venue_pin_approvals']) t,
                  unnest(ARRAY['anon', 'authenticated']) r,
                  unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
    WHERE has_table_privilege(r, t, p))
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename IN
    ('brand_member_pins', 'venue_staff_switch_sessions', 'venue_pin_attempts', 'venue_pin_approvals')),
  'PIN-1a the four PIN tables have RLS on, no policies and no anon/authenticated privilege');
SELECT public.t4490p_ok(NOT EXISTS (
    SELECT 1 FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
    WHERE n.nspname = 'public' AND (pr.proname LIKE 'issue_4490_pin_%' OR pr.proname = 'issue_4490_floor_audit'
                                    OR pr.proname = 'issue_4490_till_void_on_device')
      AND (has_function_privilege('anon', pr.oid, 'EXECUTE') OR has_function_privilege('authenticated', pr.oid, 'EXECUTE'))),
  'PIN-1b every PIN function is service role only');
SELECT public.t4490p_as('44900500-0000-4000-8000-000000000002');
SELECT public.t4490p_expect($q$SELECT count(*) FROM public.brand_member_pins$q$, '42501', NULL,
  'PIN-1c a signed-in member reading brand_member_pins is refused');
SELECT public.t4490p_expect($q$SELECT public.issue_4490_pin_set('44900500-0000-4000-a000-000000000002',
  '44900500-0000-4000-8000-000000000002', '2580')$q$, '42501', NULL,
  'PIN-1d a signed-in member cannot call pin_set directly (only the edge, as the service role)');
SELECT public.t4490p_reset();

-- ---------------------------------------------------------------------------
-- PIN-2 Setting a PIN.
-- ---------------------------------------------------------------------------
SELECT public.t4490p_service();
DO $set$
DECLARE
  v jsonb;
  w text;
BEGIN
  FOREACH w IN ARRAY ARRAY['0000', '1111', '1234', '4321', '012345', '98765', '123', '1234567', 'abcd', '12a4', ''] LOOP
    BEGIN
      PERFORM public.issue_4490_pin_set('44900500-0000-4000-a000-000000000002', '44900500-0000-4000-8000-000000000002', w);
      RAISE EXCEPTION 'T4490P FAIL: PIN-2a weak or malformed PIN % accepted', w;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      NULL;
    END;
  END LOOP;
  PERFORM public.t4490p_ok(true, 'PIN-2a 0000, 1111, 1234, 4321, 012345, 98765 and malformed PINs are refused');
  PERFORM public.t4490p_ok(NOT public.issue_4490_pin_is_weak('2580') AND NOT public.issue_4490_pin_is_weak('739104')
      AND NOT public.issue_4490_pin_is_weak('1235'),
    'PIN-2b an ordinary 4 to 6 digit PIN is not weak');
  v := public.issue_4490_pin_set('44900500-0000-4000-a000-000000000002', '44900500-0000-4000-8000-000000000002', '2580');
  PERFORM public.t4490p_ok((v->>'ok')::boolean
      AND (SELECT pin_hash LIKE '$2a$10$%' AND pin_hash <> '2580' AND position('2580' IN pin_hash) = 0
           FROM public.brand_member_pins WHERE member_id = '44900500-0000-4000-a000-000000000002'),
    'PIN-2c the PIN is stored as a bcrypt (cost 10) hash only');
  PERFORM public.issue_4490_pin_set('44900500-0000-4000-a000-000000000003', '44900500-0000-4000-8000-000000000003', '4826');
  PERFORM public.issue_4490_pin_set('44900500-0000-4000-a000-000000000001', '44900500-0000-4000-8000-000000000001', '9157');
  PERFORM public.issue_4490_pin_set('44900500-0000-4000-a000-000000000004', '44900500-0000-4000-8000-000000000004', '3691');
  PERFORM public.issue_4490_pin_set('44900500-0000-4000-a000-000000000006', '44900500-0000-4000-8000-000000000006', '7413');
  PERFORM public.t4490p_ok(
    (SELECT count(*) FROM public.audit_log WHERE action = 'pin.set' AND brand_id = '44900500-0000-4000-9000-000000000010') = 5
    AND NOT EXISTS (SELECT 1 FROM public.audit_log WHERE action LIKE 'pin.%'
                    AND (after ? 'pin' OR after ? 'pin_hash' OR after::text LIKE '%$2a$%')),
    'PIN-2d each PIN set is audited (pin.set) with no PIN or hash in the row');
END
$set$;
SELECT public.t4490p_expect($q$SELECT public.issue_4490_pin_set('44900500-0000-4000-a000-000000000002',
  '44900500-0000-4000-8000-000000000003', '5826')$q$, '42501', 'not_authorized',
  'PIN-2e a member can set only their own PIN');
SELECT public.t4490p_expect($q$SELECT public.issue_4490_pin_set('44900500-0000-4000-a000-000000000005',
  '44900500-0000-4000-8000-000000000005', '5826')$q$, '42501', 'not_authorized',
  'PIN-2f a Till device login never gets a PIN (a PIN never signs anyone in)');
SELECT public.t4490p_expect($q$SELECT public.issue_4490_pin_set('44900500-0000-4000-a000-000000000007',
  '44900500-0000-4000-8000-000000000007', '5826')$q$, '42501', 'not_authorized',
  'PIN-2g a removed member cannot set a PIN');

-- ---------------------------------------------------------------------------
-- PIN-3 Who's selling and the gate.
-- ---------------------------------------------------------------------------
DO $who$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_pin_staff('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-8000-000000000005');
  PERFORM public.t4490p_ok((v->>'gated')::boolean AND (v->>'autoLockMinutes')::int = 2
      AND (SELECT array_agg(e->>'memberId' ORDER BY e->>'memberId') FROM jsonb_array_elements(v->'staff') e)
          = ARRAY['44900500-0000-4000-a000-000000000001', '44900500-0000-4000-a000-000000000002',
                  '44900500-0000-4000-a000-000000000003', '44900500-0000-4000-a000-000000000004']
      AND (v->>'managerHasPin')::boolean
      AND NOT (v::text LIKE '%@example.test%') AND NOT (v::text LIKE '%$2a$%'),
    'PIN-3a Who''s selling lists PIN holders who may sell or approve (owner, seller, manager, finance), never the device, a kitchen-only member, a removed member or a member without a PIN; no email, no hash');
  PERFORM public.t4490p_ok(
    (SELECT (e->>'canSell')::boolean = false AND (e->>'canApprove')::boolean FROM jsonb_array_elements(v->'staff') e
     WHERE e->>'memberId' = '44900500-0000-4000-a000-000000000004')
    AND (SELECT (e->>'canSell')::boolean AND NOT (e->>'canApprove')::boolean FROM jsonb_array_elements(v->'staff') e
     WHERE e->>'memberId' = '44900500-0000-4000-a000-000000000002'),
    'PIN-3b the list marks who sells and who may approve money (finance approves, cannot sell)');
  v := public.issue_4490_pin_staff('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-8000-000000000001');
  PERFORM public.t4490p_ok(v = '{"gated": false}'::jsonb,
    'PIN-3c an owner''s own account is never gated (sells as themselves)');
  PERFORM public.t4490p_ok(public.issue_4490_pin_gate('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-8000-000000000005')
      AND NOT public.issue_4490_pin_gate('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-8000-000000000002')
      AND NOT public.issue_4490_pin_gate('44900500-0000-4000-9000-0000000000c1', '44900500-0000-4000-8000-000000000005'),
    'PIN-3d only a Till device login at that venue is gated');
END
$who$;
-- #4579 (on main since d3527e3b93), full parity (Seth, #4490 23 Nov 19:22): an
-- auto-added Mingla admin is venue staff like any Brand admin. They are listed
-- on the PIN pad by #4579's public name with the Mingla mark ("<name> from
-- Mingla"), never an email or handle, and they may hold and use a Till PIN.
-- TEST-MOD-APPROVED #4490 (merge of #4579): PIN-3e/3f asserted the old exclusion
-- through a suite-added column; Seth chose full parity and #4579's column exists.
DO $mingla$
DECLARE
  v jsonb;
  e jsonb;
BEGIN
  SET LOCAL ROLE postgres;
  INSERT INTO public.admin_users (id, email, role, status) VALUES
    ('44900500-0000-4000-b000-000000000004', 'pin-o5-4@example.test', 'admin', 'invited');
  UPDATE public.profiles SET display_name = 'Kunle' WHERE id = '44900500-0000-4000-8000-000000000004';
  IF NOT FOUND THEN
    INSERT INTO public.profiles (id, display_name) VALUES ('44900500-0000-4000-8000-000000000004', 'Kunle');
  END IF;
  UPDATE public.brand_team_members
     SET granted_via = 'mingla_admin', granted_admin_user_id = '44900500-0000-4000-b000-000000000004'
   WHERE id = '44900500-0000-4000-a000-000000000004';
  v := public.issue_4490_pin_staff('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-8000-000000000005');
  SELECT x INTO e FROM jsonb_array_elements(v->'staff') x WHERE x->>'memberId' = '44900500-0000-4000-a000-000000000004';
  PERFORM public.t4490p_ok(e IS NOT NULL
      AND e->>'name' = 'Kunle from Mingla'
      AND (e->>'isMinglaTeam')::boolean
      AND (e->>'canApprove')::boolean
      AND v::text !~* 'example\.test'
      AND public.issue_4490_pin_member_eligible('44900500-0000-4000-9000-0000000000a1',
                                                '44900500-0000-4000-a000-000000000004', 'refund'),
    'PIN-3e a Mingla admin (granted_via = mingla_admin) is on the PIN pad as "Kunle from Mingla", can approve, no email (#4579 parity) ' || coalesce(e::text, 'missing'));
  -- No safe public name (the display name is the email handle): "Mingla Team".
  UPDATE public.profiles SET display_name = 'pin-o5-4' WHERE id = '44900500-0000-4000-8000-000000000004';
  v := public.issue_4490_pin_staff('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-8000-000000000005');
  SELECT x INTO e FROM jsonb_array_elements(v->'staff') x WHERE x->>'memberId' = '44900500-0000-4000-a000-000000000004';
  PERFORM public.t4490p_ok(e->>'name' = 'Mingla Team' AND v::text !~* 'pin-o5-4',
    'PIN-3f a Mingla admin whose only name is their email handle shows as "Mingla Team" ' || coalesce(e::text, 'missing'));
  -- Back to an invited member for the rest of the suite.
  UPDATE public.brand_team_members SET granted_via = 'invite', granted_admin_user_id = NULL
   WHERE id = '44900500-0000-4000-a000-000000000004';
  UPDATE public.profiles SET display_name = NULL WHERE id = '44900500-0000-4000-8000-000000000004';
  DELETE FROM public.admin_users WHERE id = '44900500-0000-4000-b000-000000000004';
  RESET ROLE;
  PERFORM public.t4490p_service();
END
$mingla$;

-- ---------------------------------------------------------------------------
-- PIN-4 Unlock, wrong PINs, the 5-minute lock, no oracle.
-- ---------------------------------------------------------------------------
DO $unlock$
DECLARE
  v jsonb;
  i int;
BEGIN
  FOR i IN 1..4 LOOP
    v := public.issue_4490_pin_unlock('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-8000-000000000005',
      '44900500-0000-4000-a000-000000000002', '0001', NULL);
    PERFORM public.t4490p_ok(v->>'reason' = 'wrong' AND (v->>'triesLeft')::int = 5 - i AND NOT (v ? 'token'),
      format('PIN-4a wrong PIN %s: "Wrong PIN. %s tries left"', i, 5 - i));
  END LOOP;
  v := public.issue_4490_pin_unlock('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-8000-000000000005',
    '44900500-0000-4000-a000-000000000002', '0001', NULL);
  PERFORM public.t4490p_ok(v->>'reason' = 'locked'
      AND (SELECT locked_until BETWEEN now() + interval '299 seconds' AND now() + interval '301 seconds'
           FROM public.brand_member_pins WHERE member_id = '44900500-0000-4000-a000-000000000002'),
    'PIN-4b the fifth wrong PIN locks the member for 5 minutes');
  PERFORM public.t4490p_ok((SELECT count(*) FROM public.audit_log WHERE action = 'pin.locked'
      AND user_id = '44900500-0000-4000-8000-000000000002'
      AND after->>'device_user_id' = '44900500-0000-4000-8000-000000000005' AND after->>'lock' = '5_minutes') = 1,
    'PIN-4c the lock is audited (pin.locked, member as user, device in after)');
  v := public.issue_4490_pin_unlock('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-8000-000000000005',
    '44900500-0000-4000-a000-000000000002', '2580', NULL);
  PERFORM public.t4490p_ok(v->>'reason' = 'locked' AND NOT (v ? 'token'),
    'PIN-4d while locked even the right PIN does not open a session');
  -- Another member's right PIN does not unlock the locked member.
  v := public.issue_4490_pin_unlock('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-8000-000000000005',
    '44900500-0000-4000-a000-000000000003', '4826', NULL);
  PERFORM public.t4490p_ok((v->>'ok')::boolean
      AND (SELECT locked_until > now() FROM public.brand_member_pins WHERE member_id = '44900500-0000-4000-a000-000000000002'),
    'PIN-4e a locked member stays locked when another member switches in');
  -- Same answer for unknown member, a member without a PIN, another brand's member, a removed member.
  PERFORM public.t4490p_ok(
    (SELECT bool_and(public.issue_4490_pin_unlock('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-8000-000000000005',
        m, '2580', NULL) = '{"ok": false, "reason": "wrong", "triesLeft": null}'::jsonb)
     FROM unnest(ARRAY['44900500-0000-4000-a000-0000000000ff', '44900500-0000-4000-a000-000000000010',
                       '44900500-0000-4000-a000-000000000008', '44900500-0000-4000-a000-000000000007',
                       '44900500-0000-4000-a000-000000000006']::uuid[]) m),
    'PIN-4f unknown member, no PIN, other brand, removed and kitchen-only all answer the same "wrong"');
  -- Lock expiry: the 5 minutes pass.
  UPDATE public.brand_member_pins SET locked_until = now() - interval '1 second'
  WHERE member_id = '44900500-0000-4000-a000-000000000002';
  v := public.issue_4490_pin_unlock('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-8000-000000000005',
    '44900500-0000-4000-a000-000000000002', '2580', NULL);
  PERFORM public.t4490p_ok((v->>'ok')::boolean AND v->>'token' ~ '^[0-9a-f]{64}$'
      AND (v->'member'->>'userId') = '44900500-0000-4000-8000-000000000002',
    'PIN-4g after the 5 minutes the right PIN opens a session with a 32-byte token');
  INSERT INTO t4490p_ids VALUES ('tokA', v->>'token'), ('sesA', v->>'sessionId');
  PERFORM public.t4490p_ok(
    (SELECT s.token_hash = public.t4490p_hash(v->>'token') AND position(v->>'token' IN s::text) = 0
            AND s.expires_at <= s.created_at + interval '12 hours' AND s.member_user_id = '44900500-0000-4000-8000-000000000002'
     FROM public.venue_staff_switch_sessions s WHERE s.id = (v->>'sessionId')::uuid),
    'PIN-4h only the sha256 of the token is stored; the session expires within 12 hours');
  PERFORM public.t4490p_ok(
    (SELECT ended_reason FROM public.venue_staff_switch_sessions
     WHERE member_user_id = '44900500-0000-4000-8000-000000000003' AND device_user_id = '44900500-0000-4000-8000-000000000005') = 'switched',
    'PIN-4i switching in ends the previous session on that device (one live session per device and venue)');
END
$unlock$;
SELECT public.t4490p_expect($q$SELECT public.issue_4490_pin_unlock('44900500-0000-4000-9000-0000000000a1',
  '44900500-0000-4000-8000-000000000001', '44900500-0000-4000-a000-000000000002', '2580', NULL)$q$,
  '42501', 'not_authorized', 'PIN-4j an account that is not a Till device cannot switch with a PIN (I-4490-PIN-NEVER-SIGNS-IN)');

-- ---------------------------------------------------------------------------
-- PIN-5 Resolve: device, venue, expiry, idle, auth session, member.
-- ---------------------------------------------------------------------------
DO $resolve$
DECLARE
  v jsonb;
  v_seen timestamptz;
BEGIN
  UPDATE public.venue_staff_switch_sessions SET last_seen_at = now() - interval '30 seconds'
  WHERE id = public.t4490p_id('sesA')::uuid;
  v := public.issue_4490_pin_session_resolve(public.t4490p_hash(public.t4490p_id('tokA')),
    '44900500-0000-4000-8000-000000000005', '44900500-0000-4000-9000-0000000000a1', NULL);
  SELECT last_seen_at INTO v_seen FROM public.venue_staff_switch_sessions WHERE id = public.t4490p_id('sesA')::uuid;
  PERFORM public.t4490p_ok(v->>'memberUserId' = '44900500-0000-4000-8000-000000000002' AND v_seen = now(),
    'PIN-5a a live token resolves to its member and touches last_seen_at');
END
$resolve$;
SELECT public.t4490p_expect($q$SELECT public.issue_4490_pin_session_resolve(public.t4490p_hash(public.t4490p_id('tokA')),
  '44900500-0000-4000-8000-000000000009', '44900500-0000-4000-9000-0000000000a1', NULL)$q$,
  '28000', 'pin_session_invalid', 'PIN-5b a token from device A is refused on device B');
SELECT public.t4490p_expect($q$SELECT public.issue_4490_pin_session_resolve(public.t4490p_hash(public.t4490p_id('tokA')),
  '44900500-0000-4000-8000-000000000005', '44900500-0000-4000-9000-0000000000b1', NULL)$q$,
  '28000', 'pin_session_invalid', 'PIN-5c a token from venue A is refused at venue B (same device)');
SELECT public.t4490p_expect($q$SELECT public.issue_4490_pin_session_resolve(public.t4490p_hash(public.t4490p_id('tokA')),
  '44900500-0000-4000-8000-000000000005', '44900500-0000-4000-9000-0000000000a1', gen_random_uuid())$q$,
  '28000', 'pin_session_invalid', 'PIN-5d a token from another sign-in of the device is refused (sign-out ends it)');
SELECT public.t4490p_expect($q$SELECT public.issue_4490_pin_session_resolve(extensions.digest('nope', 'sha256'),
  '44900500-0000-4000-8000-000000000005', '44900500-0000-4000-9000-0000000000a1', NULL)$q$,
  '28000', 'pin_session_invalid', 'PIN-5e an unknown token is refused');
DO $idle$
BEGIN
  UPDATE public.venue_staff_switch_sessions SET last_seen_at = now() - interval '121 seconds'
  WHERE id = public.t4490p_id('sesA')::uuid;
  BEGIN
    PERFORM public.issue_4490_pin_session_resolve(public.t4490p_hash(public.t4490p_id('tokA')),
      '44900500-0000-4000-8000-000000000005', '44900500-0000-4000-9000-0000000000a1', NULL);
    RAISE EXCEPTION 'T4490P FAIL: PIN-5f idle token resolved';
  EXCEPTION WHEN SQLSTATE '28000' THEN
    PERFORM public.t4490p_ok(true, 'PIN-5f a token idle longer than auto_lock_minutes (2) is refused');
  END;
  INSERT INTO public.venue_till_settings (venue_id, brand_id, auto_lock_minutes)
  VALUES ('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-9000-000000000010', 5)
  ON CONFLICT (venue_id) DO UPDATE SET auto_lock_minutes = 5;
  PERFORM public.issue_4490_pin_session_resolve(public.t4490p_hash(public.t4490p_id('tokA')),
    '44900500-0000-4000-8000-000000000005', '44900500-0000-4000-9000-0000000000a1', NULL);
  PERFORM public.t4490p_ok(true, 'PIN-5g the idle lock follows venue_till_settings.auto_lock_minutes (5: still live after 2 minutes)');
  UPDATE public.venue_staff_switch_sessions
  SET created_at = now() - interval '12 hours 1 minute', expires_at = now() - interval '1 minute', last_seen_at = now()
  WHERE id = public.t4490p_id('sesA')::uuid;
  BEGIN
    PERFORM public.issue_4490_pin_session_resolve(public.t4490p_hash(public.t4490p_id('tokA')),
      '44900500-0000-4000-8000-000000000005', '44900500-0000-4000-9000-0000000000a1', NULL);
    RAISE EXCEPTION 'T4490P FAIL: PIN-5h expired token resolved';
  EXCEPTION WHEN SQLSTATE '28000' THEN
    PERFORM public.t4490p_ok(true, 'PIN-5h an expired token is refused');
  END;
  UPDATE public.venue_staff_switch_sessions
  SET created_at = now(), expires_at = now() + interval '12 hours', last_seen_at = now()
  WHERE id = public.t4490p_id('sesA')::uuid;
END
$idle$;

-- ---------------------------------------------------------------------------
-- PIN-6 The money gate (I-4490-TILL-DEVICE-NEVER-ACTS-ALONE).
-- ---------------------------------------------------------------------------
DO $money$
DECLARE
  v jsonb;
  v_sale uuid;
  v_round uuid;
  v_pay uuid;
BEGIN
  v := public.issue_4490_till_open('44900500-0000-4000-9000-0000000000a1',
    '44900500-0000-4000-8000-000000000002', NULL, 'Ada', NULL, 'o5-open-1');
  v_sale := (v->>'id')::uuid;
  INSERT INTO t4490p_ids VALUES ('sale1', v_sale);
  v_round := public.t4490p_round(v_sale, '44900500-0000-4000-8000-000000000002', 2);
  v := public.issue_4490_till_attach_round(v_sale, v_round, '44900500-0000-4000-8000-000000000002', NULL);
  INSERT INTO t4490p_ids VALUES ('round1', v_round);
  -- The device as itself: refused.
  BEGIN
    PERFORM public.issue_4490_till_take_payment(v_sale, 'cash', 500000, 0, 500000,
      '44900500-0000-4000-8000-000000000005', '44900500-0000-4000-8000-000000000005', gen_random_uuid(),
      (SELECT version FROM public.venue_till_sales WHERE id = v_sale));
    RAISE EXCEPTION 'T4490P FAIL: PIN-6a device paid alone';
  EXCEPTION WHEN SQLSTATE '28000' THEN
    PERFORM public.t4490p_ok(SQLERRM = 'pin_session_required'
        AND NOT EXISTS (SELECT 1 FROM public.venue_till_payments WHERE sale_id = v_sale),
      'PIN-6a a Till device without a session is refused a payment (nothing written)');
  END;
  -- A session member on another device: refused (no live session there).
  BEGIN
    PERFORM public.issue_4490_till_take_payment(v_sale, 'cash', 500000, 0, 500000,
      '44900500-0000-4000-8000-000000000002', '44900500-0000-4000-8000-000000000009', gen_random_uuid(),
      (SELECT version FROM public.venue_till_sales WHERE id = v_sale));
    RAISE EXCEPTION 'T4490P FAIL: PIN-6b payment recorded for a device with no session';
  EXCEPTION WHEN SQLSTATE '28000' THEN
    PERFORM public.t4490p_ok(SQLERRM = 'pin_session_invalid', 'PIN-6b a device with no live session for that member is refused');
  END;
  -- The session member on the session's device: allowed, member recorded, device recorded.
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 500000, 0, 600000,
    '44900500-0000-4000-8000-000000000002', '44900500-0000-4000-8000-000000000005', gen_random_uuid(),
    (SELECT version FROM public.venue_till_sales WHERE id = v_sale));
  v_pay := (v->>'paymentId')::uuid;
  INSERT INTO t4490p_ids VALUES ('pay1', v_pay);
  PERFORM public.t4490p_ok(
    (SELECT taken_by_user_id = '44900500-0000-4000-8000-000000000002' AND device_user_id = '44900500-0000-4000-8000-000000000005'
            AND state = 'paid' FROM public.venue_till_payments WHERE id = v_pay),
    'PIN-6c in a PIN session the payment lands with the member as actor and the device recorded');
  PERFORM public.t4490p_ok(
    (SELECT count(*) FROM public.audit_log WHERE action = 'till.pay' AND target_id = v_pay::text
       AND user_id = '44900500-0000-4000-8000-000000000002'
       AND after->>'device_user_id' = '44900500-0000-4000-8000-000000000005'
       AND (after->>'amount_minor')::bigint = 500000) = 1,
    'PIN-6d the payment is audited (till.pay, member as user, device in after)');
END
$money$;
-- An owner's own phone: unchanged, no session, no device.
DO $owner$
DECLARE
  v jsonb;
  v_sale uuid;
  v_round uuid;
BEGIN
  v := public.issue_4490_till_open('44900500-0000-4000-9000-0000000000a1',
    '44900500-0000-4000-8000-000000000001', NULL, 'Owner', NULL, 'o5-open-owner');
  v_sale := (v->>'id')::uuid;
  v_round := public.t4490p_round(v_sale, '44900500-0000-4000-8000-000000000001', 1);
  PERFORM public.issue_4490_till_attach_round(v_sale, v_round, '44900500-0000-4000-8000-000000000001', NULL);
  v := public.issue_4490_till_take_payment(v_sale, 'cash', 250000, 0, 250000,
    '44900500-0000-4000-8000-000000000001', '44900500-0000-4000-8000-000000000001', gen_random_uuid(),
    (SELECT version FROM public.venue_till_sales WHERE id = v_sale));
  PERFORM public.t4490p_ok((SELECT state = 'paid' AND device_user_id = taken_by_user_id
      FROM public.venue_till_payments WHERE id = (v->>'paymentId')::uuid),
    'PIN-6e an owner selling on their own account needs no PIN session (unchanged)');
END
$owner$;

-- ---------------------------------------------------------------------------
-- PIN-7 Step-up and the manager on the spot; void of a sent item; refunds.
-- ---------------------------------------------------------------------------
DO $stepup$
DECLARE
  v jsonb;
  v_sale uuid;
  v_round uuid;
  v_item uuid;
BEGIN
  v := public.issue_4490_till_open('44900500-0000-4000-9000-0000000000a1',
    '44900500-0000-4000-8000-000000000002', NULL, 'Kemi', NULL, 'o5-open-2');
  v_sale := (v->>'id')::uuid;
  v_round := public.t4490p_round(v_sale, '44900500-0000-4000-8000-000000000002', 1);
  PERFORM public.issue_4490_till_attach_round(v_sale, v_round, '44900500-0000-4000-8000-000000000002', NULL);
  SELECT id INTO v_item FROM public.venue_order_items WHERE venue_order_id = v_round;
  -- Unsent: the session member voids without step-up.
  v := public.issue_4490_till_void_on_device(v_sale, NULL, v_item, '44900500-0000-4000-8000-000000000002',
    '44900500-0000-4000-8000-000000000005', 'changed their mind', true,
    (SELECT version FROM public.venue_till_sales WHERE id = v_sale), false);
  PERFORM public.t4490p_ok((SELECT prep_state = 'voided' AND voided_by_user_id = '44900500-0000-4000-8000-000000000002'
      FROM public.venue_order_items WHERE id = v_item)
    AND (SELECT count(*) FROM public.audit_log WHERE action = 'till.void' AND target_id = v_item::text
         AND user_id = '44900500-0000-4000-8000-000000000002'
         AND after->>'device_user_id' = '44900500-0000-4000-8000-000000000005') = 1,
    'PIN-7a an unsent item is voided in the session without step-up; audited (till.void) with the device');
  -- A sent item.
  v_round := public.t4490p_round(v_sale, '44900500-0000-4000-8000-000000000002', 1);
  PERFORM public.issue_4490_till_attach_round(v_sale, v_round, '44900500-0000-4000-8000-000000000002', NULL);
  PERFORM public.issue_4490_till_send(v_sale, '44900500-0000-4000-8000-000000000002');
  SELECT id INTO v_item FROM public.venue_order_items WHERE venue_order_id = v_round;
  INSERT INTO t4490p_ids VALUES ('sale2', v_sale), ('item2', v_item);
END
$stepup$;
SELECT public.t4490p_expect($q$SELECT public.issue_4490_till_void_on_device(public.t4490p_id('sale2')::uuid, NULL,
  public.t4490p_id('item2')::uuid, '44900500-0000-4000-8000-000000000002', '44900500-0000-4000-8000-000000000005',
  'made wrong', false, (SELECT version FROM public.venue_till_sales WHERE id = public.t4490p_id('sale2')::uuid), false)$q$,
  'P0001', 'pin_step_up_required', 'PIN-7b a sent item on a Till device needs a fresh PIN (step-up)');
DO $approve$
DECLARE
  v jsonb;
BEGIN
  -- The seller steps up with their own PIN: right PIN, but no money rights.
  v := public.issue_4490_pin_approve(public.t4490p_hash(public.t4490p_id('tokA')), '44900500-0000-4000-8000-000000000005',
    '44900500-0000-4000-9000-0000000000a1', NULL, NULL, '2580', 'void_sent', public.t4490p_id('item2'));
  PERFORM public.t4490p_ok(v = '{"ok": false, "reason": "no_rights"}'::jsonb,
    'PIN-7c a PIN member without money rights cannot approve a sent void, even with the right PIN');
  -- Wrong manager PIN counts as a wrong try for the manager.
  v := public.issue_4490_pin_approve(public.t4490p_hash(public.t4490p_id('tokA')), '44900500-0000-4000-8000-000000000005',
    '44900500-0000-4000-9000-0000000000a1', NULL, '44900500-0000-4000-a000-000000000003', '0001', 'void_sent', NULL);
  PERFORM public.t4490p_ok(v->>'reason' = 'wrong' AND (v->>'triesLeft')::int = 4,
    'PIN-7d a wrong approval PIN counts against that manager');
  -- The manager approves on the spot; the seller stays.
  v := public.issue_4490_pin_approve(public.t4490p_hash(public.t4490p_id('tokA')), '44900500-0000-4000-8000-000000000005',
    '44900500-0000-4000-9000-0000000000a1', NULL, '44900500-0000-4000-a000-000000000003', '4826', 'void_sent',
    public.t4490p_id('item2'));
  PERFORM public.t4490p_ok((v->>'ok')::boolean AND v->>'approverUserId' = '44900500-0000-4000-8000-000000000003'
      AND v->>'sellerUserId' = '44900500-0000-4000-8000-000000000002',
    'PIN-7e a manager approves on the spot with their own PIN; the seller stays the session member');
  v := public.issue_4490_till_void_on_device(public.t4490p_id('sale2')::uuid, NULL, public.t4490p_id('item2')::uuid,
    '44900500-0000-4000-8000-000000000003', '44900500-0000-4000-8000-000000000005', 'made wrong', false,
    (SELECT version FROM public.venue_till_sales WHERE id = public.t4490p_id('sale2')::uuid), true);
  PERFORM public.t4490p_ok(
    (SELECT prep_state = 'voided' AND voided_by_user_id = '44900500-0000-4000-8000-000000000003'
     FROM public.venue_order_items WHERE id = public.t4490p_id('item2')::uuid)
    AND (SELECT live FROM (SELECT ended_at IS NULL AS live FROM public.venue_staff_switch_sessions
                           WHERE id = public.t4490p_id('sesA')::uuid) s),
    'PIN-7f the approved void is recorded under the manager; the seller''s session goes on');
END
$approve$;
-- A refund needs the approver's money rights and a fresh approval.
SELECT public.t4490p_expect($q$SELECT public.issue_4490_till_refund(public.t4490p_id('pay1')::uuid, 100000, 0,
  'wrong drink', false, '44900500-0000-4000-8000-000000000004', '44900500-0000-4000-8000-000000000005', gen_random_uuid())$q$,
  -- [TEST-MOD-APPROVED #4490] 08-O5 fix 3: the refund row now asks for its step-up approval first, so the
  -- refusal names that (it was pin_session_invalid from the session check behind it).
  'P0001', 'pin_step_up_required',
  'PIN-7g a refund under someone with money rights but no approval on this device is refused');
DO $refund$
DECLARE
  v jsonb;
  v_refund uuid;
BEGIN
  v := public.issue_4490_pin_approve(public.t4490p_hash(public.t4490p_id('tokA')), '44900500-0000-4000-8000-000000000005',
    '44900500-0000-4000-9000-0000000000a1', NULL, '44900500-0000-4000-a000-000000000004', '3691', 'refund',
    public.t4490p_id('pay1'));
  PERFORM public.t4490p_ok((v->>'ok')::boolean, 'PIN-7h a finance manager (money rights, cannot sell) approves a refund');
  v := public.issue_4490_till_refund(public.t4490p_id('pay1')::uuid, 100000, 0, 'wrong drink', false,
    '44900500-0000-4000-8000-000000000004', '44900500-0000-4000-8000-000000000005', gen_random_uuid());
  SELECT id INTO v_refund FROM public.venue_till_refunds WHERE payment_id = public.t4490p_id('pay1')::uuid;
  PERFORM public.t4490p_ok(
    (SELECT by_user_id = '44900500-0000-4000-8000-000000000004' AND device_user_id = '44900500-0000-4000-8000-000000000005'
     FROM public.venue_till_refunds WHERE id = v_refund)
    AND (SELECT count(*) FROM public.audit_log WHERE action = 'till.refund' AND target_id = v_refund::text
         AND user_id = '44900500-0000-4000-8000-000000000004'
         AND after->>'device_user_id' = '44900500-0000-4000-8000-000000000005'
         AND after->>'approval_id' IS NOT NULL) = 1,
    'PIN-7i the refund lands under the approver with the device recorded and is audited (till.refund) with its approval');
END
$refund$;
SELECT public.t4490p_expect($q$SELECT public.issue_4490_till_refund(public.t4490p_id('pay1')::uuid, 50000, 0,
  'again', false, '44900500-0000-4000-8000-000000000002', '44900500-0000-4000-8000-000000000005', gen_random_uuid())$q$,
  '42501', NULL, 'PIN-7j the session member without money rights is refused a refund even in a valid session');

-- ---------------------------------------------------------------------------
-- PIN-8 Never in a PIN session: settings and PIN resets (the device account
-- and the session never carry those rights).
-- ---------------------------------------------------------------------------
SELECT public.t4490p_expect($q$SELECT public.issue_4490_pin_reset('44900500-0000-4000-8000-000000000005',
  '44900500-0000-4000-a000-000000000002')$q$, '42501', 'not_authorized',
  'PIN-8a a Till device login cannot reset a PIN');
SELECT public.t4490p_expect($q$SELECT public.issue_4490_till_settings_set('44900500-0000-4000-9000-0000000000a1',
  '{"autoLockMinutes": 10}'::jsonb, '44900500-0000-4000-8000-000000000005', NULL)$q$, '42501', NULL,
  'PIN-8b a Till device login cannot change Till settings');
SELECT public.t4490p_expect($q$SELECT public.issue_4490_pin_reset('44900500-0000-4000-8000-000000000002',
  '44900500-0000-4000-a000-000000000003')$q$, '42501', 'not_authorized',
  'PIN-8c a seller cannot reset someone else''s PIN');

-- ---------------------------------------------------------------------------
-- PIN-9 The per-device limit and the hard lock.
-- ---------------------------------------------------------------------------
DO $limits$
DECLARE
  v jsonb;
BEGIN
  -- Device 05's earlier tries in this suite are moved out of its 10-minute window.
  UPDATE public.venue_pin_attempts SET at = at - interval '11 minutes'
  WHERE device_user_id = '44900500-0000-4000-8000-000000000005';
  -- Device 09 has made 20 tries in the last 10 minutes.
  INSERT INTO public.venue_pin_attempts (device_user_id, venue_id, member_id, ok, purpose, at)
  SELECT '44900500-0000-4000-8000-000000000009', '44900500-0000-4000-9000-0000000000a1', NULL, false, 'unlock',
    now() - make_interval(secs => n * 20)
  FROM generate_series(1, 20) n;
  v := public.issue_4490_pin_unlock('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-8000-000000000009',
    '44900500-0000-4000-a000-000000000001', '9157', NULL);
  PERFORM public.t4490p_ok(v = '{"ok": false, "reason": "device_limited"}'::jsonb,
    'PIN-9a after 20 tries in 10 minutes a device is refused even the right PIN');
  UPDATE public.venue_pin_attempts SET at = at - interval '10 minutes'
  WHERE device_user_id = '44900500-0000-4000-8000-000000000009';
  v := public.issue_4490_pin_unlock('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-8000-000000000009',
    '44900500-0000-4000-a000-000000000001', '9157', NULL);
  PERFORM public.t4490p_ok((v->>'ok')::boolean, 'PIN-9b the limit is per 10 minutes; device 05''s tries never counted for 09');
  -- Hard lock: 10 wrong in 24 hours (6 earlier today after the PIN was set, then 4 more now, across two locks).
  UPDATE public.brand_member_pins SET set_at = now() - interval '3 hours' WHERE member_id = '44900500-0000-4000-a000-000000000001';
  INSERT INTO public.venue_pin_attempts (device_user_id, venue_id, member_id, ok, purpose, at)
  SELECT '44900500-0000-4000-8000-000000000005', '44900500-0000-4000-9000-0000000000a1',
    '44900500-0000-4000-a000-000000000001', false, 'unlock', now() - interval '2 hours' - make_interval(mins => n)
  FROM generate_series(1, 6) n;
  -- Wrong tries older than 24 hours never count.
  INSERT INTO public.venue_pin_attempts (device_user_id, venue_id, member_id, ok, purpose, at)
  SELECT '44900500-0000-4000-8000-000000000005', '44900500-0000-4000-9000-0000000000a1',
    '44900500-0000-4000-a000-000000000001', false, 'unlock', now() - interval '25 hours'
  FROM generate_series(1, 5) n;
  FOR i IN 1..3 LOOP
    v := public.issue_4490_pin_unlock('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-8000-000000000005',
      '44900500-0000-4000-a000-000000000001', '0001', NULL);
  END LOOP;
  PERFORM public.t4490p_ok(v->>'reason' = 'wrong', 'PIN-9c nine wrong in 24 hours: still "wrong"');
  v := public.issue_4490_pin_unlock('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-8000-000000000005',
    '44900500-0000-4000-a000-000000000001', '0001', NULL);
  PERFORM public.t4490p_ok(v->>'reason' = 'hard_locked'
      AND (SELECT hard_locked FROM public.brand_member_pins WHERE member_id = '44900500-0000-4000-a000-000000000001')
      AND (SELECT count(*) FROM public.audit_log WHERE action = 'pin.locked' AND after->>'lock' = 'until_reset'
           AND user_id = '44900500-0000-4000-8000-000000000001') = 1,
    'PIN-9d the tenth wrong PIN in 24 hours hard-locks the member until a reset (audited)');
  v := public.issue_4490_pin_unlock('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-8000-000000000005',
    '44900500-0000-4000-a000-000000000001', '9157', NULL);
  PERFORM public.t4490p_ok(v = '{"ok": false, "reason": "hard_locked"}'::jsonb,
    'PIN-9e a hard-locked member cannot switch in with the right PIN');
END
$limits$;
SELECT public.t4490p_expect($q$SELECT public.issue_4490_pin_set('44900500-0000-4000-a000-000000000001',
  '44900500-0000-4000-8000-000000000001', '8462')$q$, 'P0001', 'pin_hard_locked',
  'PIN-9f the member cannot clear a hard lock by setting a new PIN ("Ask a manager to unlock your PIN")');
DO $reset$
DECLARE
  v jsonb;
BEGIN
  -- The manager (venue.manage_money at A) cannot reset the owner (a brand role with no venue grant)...
  BEGIN
    PERFORM public.issue_4490_pin_reset('44900500-0000-4000-8000-000000000003', '44900500-0000-4000-a000-000000000001');
    RAISE EXCEPTION 'T4490P FAIL: PIN-9g manager reset the owner';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    PERFORM public.t4490p_ok(true, 'PIN-9g venue.manage_money resets only members granted at that venue');
  END;
  -- ...but resets the seller at their venue; the seller's live session ends.
  v := public.issue_4490_pin_reset('44900500-0000-4000-8000-000000000003', '44900500-0000-4000-a000-000000000002');
  PERFORM public.t4490p_ok((v->>'hadPin')::boolean
      AND NOT EXISTS (SELECT 1 FROM public.brand_member_pins WHERE member_id = '44900500-0000-4000-a000-000000000002')
      AND (SELECT ended_reason FROM public.venue_staff_switch_sessions WHERE id = public.t4490p_id('sesA')::uuid) = 'pin_reset'
      AND (SELECT count(*) FROM public.audit_log WHERE action = 'pin.reset'
           AND user_id = '44900500-0000-4000-8000-000000000003'
           AND target_id = '44900500-0000-4000-a000-000000000002') = 1,
    'PIN-9h a manager reset removes the PIN, ends the member''s sessions and is audited (pin.reset)');
  -- The owner (brand_admin+) resets the hard lock.
  v := public.issue_4490_pin_reset('44900500-0000-4000-8000-000000000001', '44900500-0000-4000-a000-000000000001');
  v := public.issue_4490_pin_set('44900500-0000-4000-a000-000000000001', '44900500-0000-4000-8000-000000000001', '8462');
  PERFORM public.t4490p_ok((v->>'ok')::boolean
      AND (SELECT NOT hard_locked AND failed_count = 0 FROM public.brand_member_pins
           WHERE member_id = '44900500-0000-4000-a000-000000000001'),
    'PIN-9i after a reset the member sets a fresh PIN and the 24-hour count starts again');
END
$reset$;

-- ---------------------------------------------------------------------------
-- PIN-10 Ended sessions: a request already in flight is refused at its write.
-- ---------------------------------------------------------------------------
DO $ended$
DECLARE
  v jsonb;
  v_sale uuid;
  v_round uuid;
BEGIN
  v := public.issue_4490_pin_unlock('44900500-0000-4000-9000-0000000000a1', '44900500-0000-4000-8000-000000000005',
    '44900500-0000-4000-a000-000000000003', '4826', 'e3b0c442-98fc-4c14-9afb-f4c8996fb924');
  PERFORM public.t4490p_ok((v->>'ok')::boolean, 'PIN-10a the manager switches in');
  v_sale := (public.issue_4490_till_open('44900500-0000-4000-9000-0000000000a1',
    '44900500-0000-4000-8000-000000000003', NULL, 'Tunde', NULL, 'o5-open-3')->>'id')::uuid;
  v_round := public.t4490p_round(v_sale, '44900500-0000-4000-8000-000000000003', 1);
  PERFORM public.issue_4490_till_attach_round(v_sale, v_round, '44900500-0000-4000-8000-000000000003', NULL);
  -- The edge resolved the session, then the device was signed out before the write.
  PERFORM public.t4490p_ok(public.issue_4490_pin_sessions_end_all('44900500-0000-4000-8000-000000000005') = 1,
    'PIN-10b signing the device out ends its sessions');
  BEGIN
    PERFORM public.issue_4490_till_take_payment(v_sale, 'cash', 250000, 0, 250000,
      '44900500-0000-4000-8000-000000000003', '44900500-0000-4000-8000-000000000005', gen_random_uuid(),
      (SELECT version FROM public.venue_till_sales WHERE id = v_sale));
    RAISE EXCEPTION 'T4490P FAIL: PIN-10c payment after sign-out';
  EXCEPTION WHEN SQLSTATE '28000' THEN
    PERFORM public.t4490p_ok(NOT EXISTS (SELECT 1 FROM public.venue_till_payments WHERE sale_id = v_sale),
      'PIN-10c a payment whose session ended before its write is refused and nothing is recorded');
  END;
  BEGIN
    PERFORM public.issue_4490_pin_session_resolve(public.t4490p_hash(v->>'token'),
      '44900500-0000-4000-8000-000000000005', '44900500-0000-4000-9000-0000000000a1',
      'e3b0c442-98fc-4c14-9afb-f4c8996fb924');
    RAISE EXCEPTION 'T4490P FAIL: PIN-10d ended token resolved';
  EXCEPTION WHEN SQLSTATE '28000' THEN
    PERFORM public.t4490p_ok(true, 'PIN-10d an ended token is refused');
  END;
  -- Sign-out approval: a manager's PIN, no session needed.
  v := public.issue_4490_pin_approve(NULL, '44900500-0000-4000-8000-000000000005', '44900500-0000-4000-9000-0000000000a1',
    NULL, '44900500-0000-4000-a000-000000000003', '4826', 'sign_out', NULL);
  PERFORM public.t4490p_ok((v->>'ok')::boolean, 'PIN-10e a manager''s PIN approves signing the Till device out');
  v := public.issue_4490_pin_approve(NULL, '44900500-0000-4000-8000-000000000005', '44900500-0000-4000-9000-0000000000a1',
    NULL, '44900500-0000-4000-a000-000000000004', '3691', 'sign_out', NULL);
  PERFORM public.t4490p_ok(v = '{"ok": false, "reason": "no_rights"}'::jsonb,
    'PIN-10f a finance manager without venue manager rights cannot approve a sign-out');
END
$ended$;
SELECT public.t4490p_expect($q$SELECT public.issue_4490_pin_approve(NULL, '44900500-0000-4000-8000-000000000005',
  '44900500-0000-4000-9000-0000000000a1', NULL, '44900500-0000-4000-a000-000000000003', '4826', 'refund', NULL)$q$,
  '28000', 'pin_session_invalid', 'PIN-10g a refund step-up needs a live session');
SELECT public.t4490p_expect($q$SELECT public.issue_4490_floor_audit('44900500-0000-4000-9000-000000000010',
  '44900500-0000-4000-8000-000000000001', NULL, 'brand.edit', 'brand', NULL, '{}'::jsonb)$q$, '22023',
  'floor_audit_action_invalid', 'PIN-10h the audit helper writes only the floor actions');
DO $audit$
BEGIN
  PERFORM public.issue_4490_floor_audit('44900500-0000-4000-9000-000000000010', '44900500-0000-4000-8000-000000000003',
    '44900500-0000-4000-8000-000000000005', 'till.close', 'venue_day_close', 'x',
    '{"pin": "4826", "token": "abc", "counted": 1}'::jsonb);
  PERFORM public.t4490p_ok((SELECT after FROM public.audit_log WHERE action = 'till.close' AND target_id = 'x')
      = '{"counted": 1, "device_user_id": "44900500-0000-4000-8000-000000000005"}'::jsonb,
    'PIN-10i the audit helper strips pin/token keys and records the device (for parts B and C)');
END
$audit$;
SELECT public.t4490p_reset();
SELECT public.t4490p_ok(NOT EXISTS (SELECT 1 FROM public.audit_log
    WHERE brand_id = '44900500-0000-4000-9000-000000000010'
      AND (after ? 'pin' OR after ? 'token' OR after ? 'pin_hash' OR after ? 'token_hash'
           OR after::text LIKE '%$2a$%' OR after::text ~ '"(2580|4826|9157|3691|8462)"')),
  'PIN-11 no audit row of this suite carries a PIN or a hash');

ROLLBACK;
