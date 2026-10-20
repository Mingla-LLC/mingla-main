-- #2879 / #2947 slice 7 — pre-sale queue join path (create_session_base exception).
-- Run after the full migration chain on PostgreSQL 17 as the database owner.
--
-- WHAT IS PROVED
--   C-01  Armed tier + infinity expires_at ⇒ create succeeds before sale_start_at;
--         engaged() is true on an empty armed pre-sale tier (rule 6 bootstrap).
--   C-02  Armed tier + finite expires_at ⇒ still ticket_sales_not_started.
--   C-03  Unarmed tier + infinity ⇒ still ticket_sales_not_started.
--   C-04  After sale opens, ordinary finite create works (control).
--   C-05  authenticated must NOT EXECUTE create_session_base (service_role only).
--
-- FAILS-ON-REVERT: drop the slice-7 exception → C-01 raises ticket_sales_not_started.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.i2947s7_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #2947 slice 7 FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.i2947s7_tier(p_tag text, p_sale_start timestamptz,
                                               OUT o_event uuid, OUT o_tier uuid)
LANGUAGE plpgsql AS $f$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
BEGIN
  o_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 'i2947s7-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
                            pricing_currency, default_currency)
    VALUES (v_brand, v_user, 'Issue 2947 S7 ' || p_tag, 'issue-2947-s7-' || p_tag || '-' || v_brand,
            'stripe', 'US', 'USD', 'USD');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, currency, published_at, theme)
    VALUES (o_event, v_brand, 'Issue 2947 S7 ' || p_tag, 'issue-2947-s7-' || p_tag || '-' || o_event,
            'event', 'scheduled', 'public', 'UTC', 'USD', now(),
            jsonb_build_object('business_event', jsonb_build_object(
              'format', 'in_person', 'hideAddressUntilTicket', false,
              'settings', jsonb_build_object('privateGuestList', false))));
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (o_event, now() + interval '30 days', now() + interval '30 days 4 hours', 'UTC', true);
  INSERT INTO public.ticket_types(event_id, name, price_cents, quantity_total, currency, sale_start_at)
    VALUES (o_event, 'GA', 0, 100, 'USD', p_sale_start) RETURNING id INTO o_tier;
END
$f$;

CREATE OR REPLACE FUNCTION pg_temp.i2947s7_hold(p_event uuid, p_tier uuid, p_expires timestamptz)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v := public.biz_ticket_checkout_create_session(
    p_event, NULL, 'PreSale Guest', 'presale@example.test', '+15550002947', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', p_tier, 'quantity', 1)),
    'i2947s7:' || gen_random_uuid()::text, p_expires, 0, 'auto', NULL);
  RETURN (v ->> 'checkoutSessionId')::uuid;
END
$f$;

CREATE OR REPLACE FUNCTION pg_temp.i2947s7_hold_err(p_event uuid, p_tier uuid, p_expires timestamptz)
RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.i2947s7_hold(p_event, p_tier, p_expires);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END
$f$;

-- ─── C-01: armed + infinity before sale_start succeeds ─────────────────────
BEGIN;
DO $c01$
DECLARE
  f record;
  v_s uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.i2947s7_tier('c01', now() + interval '2 days');
  UPDATE public.ticket_queue_admission_settings SET arm_threshold_concurrent_holds = 1;
  PERFORM public.issue_2947_queue_arm(f.o_tier);

  PERFORM pg_temp.i2947s7_assert(public.issue_2947_queue_engaged(f.o_tier),
    'C-01a empty armed pre-sale tier is engaged (rule 6 bootstrap)');

  v_s := pg_temp.i2947s7_hold(f.o_event, f.o_tier, 'infinity'::timestamptz);
  PERFORM pg_temp.i2947s7_assert(v_s IS NOT NULL, 'C-01b armed infinity create before sale_start returns a session');
  PERFORM pg_temp.i2947s7_assert(
    (SELECT expires_at FROM public.ticket_checkout_sessions WHERE id = v_s) = 'infinity'::timestamptz,
    'C-01c the session carries expires_at = infinity');
END
$c01$;
ROLLBACK;

-- ─── C-02: armed + finite before sale_start still refused ──────────────────
BEGIN;
DO $c02$
DECLARE
  f record;
BEGIN
  SELECT * INTO f FROM pg_temp.i2947s7_tier('c02', now() + interval '2 days');
  UPDATE public.ticket_queue_admission_settings SET arm_threshold_concurrent_holds = 1;
  PERFORM public.issue_2947_queue_arm(f.o_tier);

  PERFORM pg_temp.i2947s7_assert(
    pg_temp.i2947s7_hold_err(f.o_event, f.o_tier, now() + interval '15 minutes')
      ~ 'ticket_sales_not_started',
    'C-02 finite-expiry create before sale_start is still refused');
END
$c02$;
ROLLBACK;

-- ─── C-03: unarmed + infinity before sale_start refused ────────────────────
BEGIN;
DO $c03$
DECLARE
  f record;
BEGIN
  SELECT * INTO f FROM pg_temp.i2947s7_tier('c03', now() + interval '2 days');
  PERFORM pg_temp.i2947s7_assert(
    pg_temp.i2947s7_hold_err(f.o_event, f.o_tier, 'infinity'::timestamptz)
      ~ 'ticket_sales_not_started',
    'C-03 unarmed infinity create before sale_start is refused');
END
$c03$;
ROLLBACK;

-- ─── C-04: after sale opens, finite create works ───────────────────────────
BEGIN;
DO $c04$
DECLARE
  f record;
  v_s uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.i2947s7_tier('c04', now() - interval '1 hour');
  v_s := pg_temp.i2947s7_hold(f.o_event, f.o_tier, now() + interval '15 minutes');
  PERFORM pg_temp.i2947s7_assert(v_s IS NOT NULL, 'C-04 ordinary create after sale_start still works');
END
$c04$;
ROLLBACK;

-- ─── C-05: base stays service_role-only ────────────────────────────────────
-- [TEST-MOD-APPROVED #3281] Round 2 (#3996) moved the base to its 15-argument signature.
DO $c05$
BEGIN
  PERFORM pg_temp.i2947s7_assert(
    NOT has_function_privilege(
      'authenticated',
      'public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer)',
      'EXECUTE'),
    'C-05a authenticated cannot EXECUTE create_session_base');
  PERFORM pg_temp.i2947s7_assert(
    has_function_privilege(
      'service_role',
      'public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer)',
      'EXECUTE'),
    'C-05b service_role can EXECUTE create_session_base');
END
$c05$;
