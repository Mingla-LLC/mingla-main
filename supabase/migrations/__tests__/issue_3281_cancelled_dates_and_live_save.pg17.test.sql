\set ON_ERROR_STOP on

-- Issue #3281 bundle 3 — cancelled dates everywhere, a live save that adds a
-- date and scopes a ticket to it, and a live RSVP edit that keeps its date.
-- Migration 20280523003281_issue_3281_cancelled_dates_and_live_save.sql.
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.
--
-- MINGLA-INVARIANT: I-3281-CANCELLED-DATE-NEVER-ISSUED | issue #3281 | no comp, private link, sign-up, host approval or auto-approve issues a pass on a cancelled date; an event whose upcoming dates are all cancelled answers occurrence_not_available, and one with no upcoming date keeps its "ended" answer.
-- MINGLA-INVARIANT: I-3281-CANCELLED-DATE-SHOWN-CANCELLED | issue #3281 | the buyer bundle lists a cancelled date with cancelled=true, sold out and no places left; the RSVP schedule and a private link's dates skip it.
-- MINGLA-INVARIANT: I-3281-LIVE-SAVE-DATES-BEFORE-TICKETS | issue #3281 | business_update_live_event_atomic writes dates before tickets and strips removed dates once after the tickets; a direct business_patch_event_when still strips.
-- MINGLA-INVARIANT: I-3281-LIVE-RSVP-KEEPS-ITS-DATE | issue #3281 | a live RSVP edit updates its date row in place and never changes its status, cancelled_at or occurrence_key.
--
-- Red before green: on the bodies before 20280523003281, 16 of the 21 blocks
-- fail. The five that pass on both sides are regression guards for what must
-- not change: w4_sold_day, w4_direct_strip, w4_offering_date_past (free to
-- paid), w4_recurring and w5_rsvp_inserts.
--
-- Chosen behaviour (offering_date_past): business_patch_event_when judges the
-- tickets stored before the save and the live save judges the saved tickets
-- again, so a save is refused when either side is a paid online ticket with
-- every date in the past. Paid to free in the same save as moving every date
-- into the past is therefore refused (it was allowed when tickets were
-- written first); save the tickets first, then the dates.

BEGIN;

CREATE FUNCTION pg_temp.b3_assert(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #3281 b3 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

CREATE FUNCTION pg_temp.b3_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

CREATE FUNCTION pg_temp.b3_cancel(p_date uuid) RETURNS void LANGUAGE sql AS $$
  UPDATE public.event_dates SET status = 'cancelled', cancelled_at = now() WHERE id = p_date;
$$;

CREATE FUNCTION pg_temp.b3_pepper() RETURNS text LANGUAGE sql AS $$
  SELECT 'issue-3281-b3-test-qr-pepper-secret'::text;
$$;

-- An event with p_dates upcoming dates (one day apart, keys k1..kN) and a
-- free visible tier plus a hidden paid tier. p_mode: per_day | all_days |
-- recurring | single. The brand can take card payments.
CREATE FUNCTION pg_temp.b3_fixture(
  p_tag text, p_dates integer, p_mode text, p_capacity integer,
  OUT o_event uuid, OUT o_free uuid, OUT o_paid uuid, OUT o_owner uuid, OUT o_brand uuid,
  OUT o_mgr uuid, OUT o_d1 uuid, OUT o_d2 uuid, OUT o_d3 uuid
) LANGUAGE plpgsql AS $$
DECLARE v_i integer; v_id uuid;
BEGIN
  o_owner := gen_random_uuid(); o_event := gen_random_uuid(); o_brand := gen_random_uuid();
  o_mgr := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (o_owner, 'b3-' || o_owner || '@example.test');
  INSERT INTO auth.users(id, email) VALUES (o_mgr, 'b3-mgr-' || o_mgr || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (o_owner);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, default_currency)
    VALUES (o_brand, o_owner, 'B3 ' || p_tag, 'b3-' || p_tag || '-' || o_brand, 'stripe', 'GBP');
  INSERT INTO public.stripe_connect_accounts(
    brand_id, stripe_account_id, charges_enabled, payouts_enabled, country, default_currency
  ) VALUES (o_brand, 'acct_b3_' || replace(o_brand::text, '-', ''), true, true, 'GB', 'gbp');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
    VALUES (o_brand, o_mgr, 'event_manager', now(), now());
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency,
      is_multi_date, is_recurring, multi_date_pricing_mode, recurrence_rules)
    VALUES (o_event, o_brand, 'B3 ' || p_tag, 'b3-' || p_tag || '-' || o_event, 'event', 'draft', 'draft',
      'UTC', 'GBP', p_mode IN ('per_day', 'all_days'), p_mode = 'recurring',
      CASE WHEN p_mode = 'all_days' THEN 'all_days' ELSE 'per_day' END,
      CASE WHEN p_mode = 'recurring' THEN '{"preset":"daily","termination":{"kind":"count","count":3}}'::jsonb END);
  FOR v_i IN 1 .. p_dates LOOP
    INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master, occurrence_key)
      VALUES (o_event, now() + (v_i || ' days')::interval, now() + (v_i || ' days')::interval + interval '5 hours',
        'UTC', v_i = 1, 'k' || v_i)
      RETURNING id INTO v_id;
    IF v_i = 1 THEN o_d1 := v_id; ELSIF v_i = 2 THEN o_d2 := v_id; ELSIF v_i = 3 THEN o_d3 := v_id; END IF;
  END LOOP;
  INSERT INTO public.ticket_types(event_id, name, price_cents, currency, is_free, quantity_total, is_unlimited,
      min_purchase_qty, max_purchase_qty, available_online, available_in_person, display_order, is_hidden)
    VALUES (o_event, 'Guest list', 0, 'GBP', true, p_capacity, false, 1, 10, true, true, 0, false)
    RETURNING id INTO o_free;
  INSERT INTO public.ticket_types(event_id, name, price_cents, currency, is_free, quantity_total, is_unlimited,
      min_purchase_qty, max_purchase_qty, available_online, available_in_person, display_order, is_hidden)
    VALUES (o_event, 'Secret paid', 1000, 'GBP', false, 20, false, 1, 4, true, true, 1, true)
    RETURNING id INTO o_paid;
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now() WHERE id = o_event;
  PERFORM set_config('mingla.publish_free_only', '', true);
END $$;

-- A date that has already ended.
CREATE FUNCTION pg_temp.b3_past_date(p_event uuid) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master, occurrence_key)
  VALUES (p_event, now() - interval '3 days', now() - interval '3 days' + interval '5 hours', 'UTC', false, 'kpast')
  RETURNING id;
$$;

CREATE FUNCTION pg_temp.b3_people(p_n integer, p_tag text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object(
    'name', 'Person ' || i, 'email', p_tag || '-' || i || '@example.test',
    'phoneE164', '+1555000' || lpad(i::text, 4, '0')) ORDER BY i)
  FROM generate_series(1, p_n) AS i;
$$;

CREATE FUNCTION pg_temp.b3_guest(p_tag text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_build_object('index', 0, 'name', 'Guest ' || p_tag,
    'email', 'b3-guest-' || p_tag || '@example.test', 'phoneE164', NULL));
$$;

-- A link; returns its token hash.
CREATE FUNCTION pg_temp.b3_link(p_owner uuid, p_event uuid, p_tier uuid, p_date uuid, p_approval text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_hash text := md5(random()::text) || md5(random()::text);
BEGIN
  PERFORM public.biz_ticket_link_create(p_owner, p_event, p_tier, p_date, 'B3 link', NULL, 1, p_approval,
    NULL, gen_random_uuid(), decode(md5(random()::text), 'hex'), v_hash);
  RETURN v_hash;
END $$;

CREATE FUNCTION pg_temp.b3_signup(p_hash text, p_tag text, p_dates uuid[]) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.pg_ticket_link_signup_days(p_hash, pg_temp.b3_people(1, p_tag), p_dates, gen_random_uuid(),
    NULL, pg_temp.b3_pepper());
$$;

CREATE FUNCTION pg_temp.b3_signup_err(p_hash text, p_tag text, p_dates uuid[]) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.b3_err(format('SELECT pg_temp.b3_signup(%L, %L, %L::uuid[])', p_hash, p_tag, p_dates));
$$;

CREATE FUNCTION pg_temp.b3_occ(p_bundle jsonb, p_date uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT o FROM jsonb_array_elements(p_bundle -> 'occurrences') o WHERE o ->> 'id' = p_date::text;
$$;

CREATE FUNCTION pg_temp.b3_ticket(p_bundle jsonb, p_tier uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT t FROM jsonb_array_elements(p_bundle -> 'tickets') t WHERE t ->> 'id' = p_tier::text;
$$;

-- ═══ W1  comps ══════════════════════════════════════════════════════════════
DO $w1_comp$
DECLARE f record; v_past uuid; v_err text; v_r jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.b3_fixture('comp', 3, 'per_day', 10);
  v_past := pg_temp.b3_past_date(f.o_event);
  PERFORM pg_temp.b3_cancel(f.o_d2);

  v_err := pg_temp.b3_err(format('SELECT public.biz_comp_issue(%L,%L,%L,%L,%L::jsonb,NULL,%L,%L)',
    f.o_mgr, f.o_event, f.o_free, f.o_d2, pg_temp.b3_guest('c1'), gen_random_uuid(), pg_temp.b3_pepper()));
  PERFORM pg_temp.b3_assert(v_err = 'occurrence_not_available', 'W1 comp: an explicit cancelled date is refused (' || COALESCE(v_err, 'issued') || ')');
  v_err := pg_temp.b3_err(format('SELECT public.biz_comp_issue(%L,%L,%L,%L,%L::jsonb,NULL,%L,%L)',
    f.o_mgr, f.o_event, f.o_free, v_past, pg_temp.b3_guest('c2'), gen_random_uuid(), pg_temp.b3_pepper()));
  PERFORM pg_temp.b3_assert(v_err = 'occurrence_not_available', 'W1 comp: an ended date keeps its old answer');
  v_r := public.biz_comp_issue(f.o_mgr, f.o_event, f.o_free, f.o_d1, pg_temp.b3_guest('c3'), NULL,
    gen_random_uuid(), pg_temp.b3_pepper());
  PERFORM pg_temp.b3_assert(EXISTS (SELECT 1 FROM public.orders WHERE event_id = f.o_event AND event_date_id = f.o_d1),
    'W1 comp: an active date still issues');

  -- biz_issue_comp resolves its time to an active date only.
  v_err := pg_temp.b3_err(format('SELECT public.biz_issue_comp(%L,%L,%L,''Gig guest'',NULL,1,''host'',%L,%L,%L)',
    f.o_brand, f.o_event, (SELECT start_at FROM public.event_dates WHERE id = f.o_d2), gen_random_uuid(), f.o_mgr,
    pg_temp.b3_pepper()));
  PERFORM pg_temp.b3_assert(v_err = 'occurrence_not_found', 'W1 issue_comp: a cancelled date''s time resolves to no date (' || COALESCE(v_err, 'issued') || ')');
  PERFORM public.biz_issue_comp(f.o_brand, f.o_event, (SELECT start_at FROM public.event_dates WHERE id = f.o_d3),
    'Gig guest', NULL, 1, 'host', gen_random_uuid(), f.o_mgr, pg_temp.b3_pepper());
  PERFORM pg_temp.b3_assert(EXISTS (SELECT 1 FROM public.orders WHERE event_id = f.o_event AND event_date_id = f.o_d3),
    'W1 issue_comp: an active date''s time still issues');

  -- Every upcoming date cancelled: occurrence_not_available, not "ended".
  PERFORM pg_temp.b3_cancel(f.o_d1);
  PERFORM pg_temp.b3_cancel(f.o_d3);
  v_err := pg_temp.b3_err(format('SELECT public.biz_comp_issue(%L,%L,%L,NULL,%L::jsonb,NULL,%L,%L)',
    f.o_mgr, f.o_event, f.o_free, pg_temp.b3_guest('c4'), gen_random_uuid(), pg_temp.b3_pepper()));
  PERFORM pg_temp.b3_assert(v_err = 'occurrence_not_available', 'W1 comp: all upcoming dates cancelled -> occurrence_not_available (' || COALESCE(v_err, 'issued') || ')');

  -- No upcoming date at all (one of them cancelled): the old "ended" answer.
  UPDATE public.event_dates SET start_at = now() - interval '2 days', end_at = now() - interval '1 day'
   WHERE event_id = f.o_event AND end_at > now();
  v_err := pg_temp.b3_err(format('SELECT public.biz_comp_issue(%L,%L,%L,NULL,%L::jsonb,NULL,%L,%L)',
    f.o_mgr, f.o_event, f.o_free, pg_temp.b3_guest('c5'), gen_random_uuid(), pg_temp.b3_pepper()));
  PERFORM pg_temp.b3_assert(v_err = 'event_already_ended', 'W1 comp: an ended event keeps event_already_ended');
END $w1_comp$;

-- ═══ W1  link create ═══════════════════════════════════════════════════════
DO $w1_link_create$
DECLARE f record; v_past uuid; v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.b3_fixture('lc', 3, 'per_day', 10);
  v_past := pg_temp.b3_past_date(f.o_event);
  PERFORM pg_temp.b3_cancel(f.o_d2);
  v_err := NULL;
  BEGIN PERFORM pg_temp.b3_link(f.o_owner, f.o_event, f.o_free, f.o_d2, 'auto'); EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  PERFORM pg_temp.b3_assert(v_err = 'occurrence_not_available', 'W1 link create: a cancelled date is refused (' || COALESCE(v_err, 'created') || ')');
  v_err := NULL;
  BEGIN PERFORM pg_temp.b3_link(f.o_owner, f.o_event, f.o_free, v_past, 'auto'); EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  PERFORM pg_temp.b3_assert(v_err = 'occurrence_not_available', 'W1 link create: an ended date keeps its old answer');
  PERFORM pg_temp.b3_link(f.o_owner, f.o_event, f.o_free, f.o_d1, 'auto');

  PERFORM pg_temp.b3_cancel(f.o_d1);
  PERFORM pg_temp.b3_cancel(f.o_d3);
  v_err := NULL;
  BEGIN PERFORM pg_temp.b3_link(f.o_owner, f.o_event, f.o_free, NULL, 'auto'); EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  PERFORM pg_temp.b3_assert(v_err = 'occurrence_not_available', 'W1 link create: all upcoming dates cancelled -> occurrence_not_available (' || COALESCE(v_err, 'created') || ')');
  UPDATE public.event_dates SET start_at = now() - interval '2 days', end_at = now() - interval '1 day'
   WHERE event_id = f.o_event AND end_at > now();
  v_err := NULL;
  BEGIN PERFORM pg_temp.b3_link(f.o_owner, f.o_event, f.o_free, NULL, 'auto'); EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  PERFORM pg_temp.b3_assert(v_err = 'event_ended', 'W1 link create: an ended event keeps event_ended');
END $w1_link_create$;

-- ═══ W1  sign-up (auto-approve) ═════════════════════════════════════════════
DO $w1_signup$
DECLARE f record; v_past uuid; v_hash text; v_r jsonb; v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.b3_fixture('sd', 3, 'per_day', 10);
  v_past := pg_temp.b3_past_date(f.o_event);
  v_hash := pg_temp.b3_link(f.o_owner, f.o_event, f.o_free, NULL, 'auto');
  PERFORM pg_temp.b3_cancel(f.o_d2);
  v_err := pg_temp.b3_signup_err(v_hash, 'sd1', ARRAY[f.o_d2]);
  PERFORM pg_temp.b3_assert(v_err = 'occurrence_not_available', 'W1 sign-up: a cancelled date is refused (' || COALESCE(v_err, 'issued') || ')');
  v_err := pg_temp.b3_signup_err(v_hash, 'sd2', ARRAY[f.o_d1, f.o_d2]);
  PERFORM pg_temp.b3_assert(v_err = 'occurrence_not_available', 'W1 sign-up: a cancelled date among others is refused');
  v_err := pg_temp.b3_signup_err(v_hash, 'sd3', ARRAY[v_past]);
  PERFORM pg_temp.b3_assert(v_err = 'occurrence_not_available', 'W1 sign-up: an ended date keeps its old answer');
  PERFORM pg_temp.b3_assert(NOT EXISTS (SELECT 1 FROM public.orders WHERE event_id = f.o_event),
    'W1 sign-up: nothing was issued by the refusals');
  v_r := pg_temp.b3_signup(v_hash, 'sd4', ARRAY[f.o_d1]);
  PERFORM pg_temp.b3_assert(v_r ->> 'status' = 'issued', 'W1 sign-up: auto-approve after a cancel still issues an active date');

  PERFORM pg_temp.b3_cancel(f.o_d1);
  PERFORM pg_temp.b3_cancel(f.o_d3);
  v_err := pg_temp.b3_signup_err(v_hash, 'sd5', NULL);
  PERFORM pg_temp.b3_assert(v_err = 'occurrence_not_available', 'W1 sign-up: all upcoming dates cancelled -> occurrence_not_available (' || COALESCE(v_err, 'issued') || ')');
END $w1_signup$;

DO $w1_signup_all_days$
DECLARE f record; v_hash text; v_r jsonb; v_order uuid; v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.b3_fixture('ad', 3, 'all_days', 10);
  v_hash := pg_temp.b3_link(f.o_owner, f.o_event, f.o_free, NULL, 'auto');
  PERFORM pg_temp.b3_cancel(f.o_d2);
  v_r := pg_temp.b3_signup(v_hash, 'ad1', NULL);
  SELECT id INTO v_order FROM public.orders WHERE event_id = f.o_event;
  PERFORM pg_temp.b3_assert(v_r ->> 'status' = 'issued'
    AND v_r -> 'eventDateIds' = jsonb_build_array(f.o_d1, f.o_d3)
    AND (SELECT array_agg(ted.event_date_id ORDER BY d.start_at) FROM public.ticket_event_dates ted
           JOIN public.tickets t ON t.id = ted.ticket_id JOIN public.event_dates d ON d.id = ted.event_date_id
          WHERE t.order_id = v_order) = ARRAY[f.o_d1, f.o_d3],
    'W1 sign-up: an all-days pass covers the active dates only (' || COALESCE(v_r ->> 'eventDateIds', 'none') || ')');
  PERFORM pg_temp.b3_cancel(f.o_d1);
  PERFORM pg_temp.b3_cancel(f.o_d3);
  v_err := pg_temp.b3_signup_err(v_hash, 'ad2', NULL);
  PERFORM pg_temp.b3_assert(v_err = 'occurrence_not_available', 'W1 sign-up: an all-days pass with every date cancelled -> occurrence_not_available (' || COALESCE(v_err, 'issued') || ')');
END $w1_signup_all_days$;

-- A link pinned to a recurring night that is then cancelled. One active night
-- is left, so the event asks for no choice and the pinned date is checked.
DO $w1_signup_pinned$
DECLARE f record; v_hash text; v_host_hash text; v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.b3_fixture('rp', 2, 'recurring', 10);
  v_hash := pg_temp.b3_link(f.o_owner, f.o_event, f.o_free, f.o_d2, 'auto');
  v_host_hash := pg_temp.b3_link(f.o_owner, f.o_event, f.o_free, f.o_d2, 'host');
  PERFORM pg_temp.b3_cancel(f.o_d2);
  PERFORM pg_temp.b3_assert(NOT COALESCE((public.issue_3313_event_day_choice(f.o_event) ->> 'requiresChoice')::boolean, false),
    'W1 pinned: one active night left asks for no choice');
  v_err := pg_temp.b3_signup_err(v_hash, 'rp1', NULL);
  PERFORM pg_temp.b3_assert(v_err = 'occurrence_not_available'
    AND NOT EXISTS (SELECT 1 FROM public.orders WHERE event_id = f.o_event),
    'W1 sign-up: a link pinned to a cancelled night issues nothing (' || COALESCE(v_err, 'issued') || ')');
  -- With host approval the sign-up itself is refused: no request is left waiting.
  v_err := pg_temp.b3_signup_err(v_host_hash, 'rp2', NULL);
  PERFORM pg_temp.b3_assert(v_err = 'occurrence_not_available'
    AND NOT EXISTS (SELECT 1 FROM public.ticket_link_signups WHERE event_id = f.o_event),
    'W1 sign-up: a host-approved link pinned to a cancelled night takes no request (' || COALESCE(v_err, 'accepted') || ')');
END $w1_signup_pinned$;

-- ═══ W1  host approval after a cancel ══════════════════════════════════════
DO $w1_approve_per_day$
DECLARE f record; v_hash text; v_r jsonb; v_signup uuid; v_sold integer;
BEGIN
  -- One place left: the cancelled date must not use it.
  SELECT * INTO f FROM pg_temp.b3_fixture('ap', 3, 'per_day', 1);
  v_hash := pg_temp.b3_link(f.o_owner, f.o_event, f.o_free, NULL, 'host');
  v_r := pg_temp.b3_signup(v_hash, 'ap1', ARRAY[f.o_d1, f.o_d2]);
  PERFORM pg_temp.b3_assert(v_r ->> 'status' = 'pending', 'W1 approval: the request waits');
  SELECT id INTO v_signup FROM public.ticket_link_signups WHERE event_id = f.o_event;
  SELECT sold_count INTO v_sold FROM public.ticket_types WHERE id = f.o_free;
  PERFORM pg_temp.b3_cancel(f.o_d2);
  v_r := public.biz_ticket_link_decide(f.o_owner, v_signup, 'approve', gen_random_uuid(), pg_temp.b3_pepper());
  PERFORM pg_temp.b3_assert(v_r ->> 'status' = 'issued' AND (v_r ->> 'issuedPasses')::int = 1,
    'W1 approval: one pass is issued (' || v_r::text || ')');
  PERFORM pg_temp.b3_assert(
    (SELECT status FROM public.ticket_link_member_passes WHERE signup_id = v_signup AND event_date_id = f.o_d2) = 'declined'
    AND (SELECT status FROM public.ticket_link_member_passes WHERE signup_id = v_signup AND event_date_id = f.o_d1) = 'issued',
    'W1 approval: the cancelled date is declined, the active one issued');
  PERFORM pg_temp.b3_assert((SELECT sold_count FROM public.ticket_types WHERE id = f.o_free) = v_sold + 1
    AND NOT EXISTS (SELECT 1 FROM public.orders WHERE event_id = f.o_event AND event_date_id = f.o_d2),
    'W1 approval: capacity is counted once and nothing is issued on the cancelled date');
END $w1_approve_per_day$;

DO $w1_approve_all_cancelled$
DECLARE f record; v_hash text; v_signup uuid; v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.b3_fixture('an', 2, 'per_day', 10);
  v_hash := pg_temp.b3_link(f.o_owner, f.o_event, f.o_free, NULL, 'host');
  PERFORM pg_temp.b3_signup(v_hash, 'an1', ARRAY[f.o_d1, f.o_d2]);
  SELECT id INTO v_signup FROM public.ticket_link_signups WHERE event_id = f.o_event;
  PERFORM pg_temp.b3_cancel(f.o_d1);
  PERFORM pg_temp.b3_cancel(f.o_d2);
  v_err := pg_temp.b3_err(format('SELECT public.biz_ticket_link_decide(%L,%L,''approve'',%L,%L)',
    f.o_owner, v_signup, gen_random_uuid(), pg_temp.b3_pepper()));
  PERFORM pg_temp.b3_assert(v_err = 'occurrence_not_available', 'W1 approval: every date cancelled raises (' || COALESCE(v_err, 'issued') || ')');
  PERFORM pg_temp.b3_assert((SELECT status FROM public.ticket_link_signups WHERE id = v_signup) = 'pending'
    AND NOT EXISTS (SELECT 1 FROM public.ticket_link_member_passes WHERE signup_id = v_signup AND status <> 'pending')
    AND NOT EXISTS (SELECT 1 FROM public.orders WHERE event_id = f.o_event),
    'W1 approval: the request stays pending and nothing is issued');
END $w1_approve_all_cancelled$;

DO $w1_approve_all_days$
DECLARE f record; v_hash text; v_signup uuid; v_r jsonb; v_order uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.b3_fixture('aa', 3, 'all_days', 10);
  v_hash := pg_temp.b3_link(f.o_owner, f.o_event, f.o_free, NULL, 'host');
  PERFORM pg_temp.b3_signup(v_hash, 'aa1', NULL);
  SELECT id INTO v_signup FROM public.ticket_link_signups WHERE event_id = f.o_event;
  PERFORM pg_temp.b3_assert((SELECT count(*) FROM public.ticket_link_member_passes WHERE signup_id = v_signup) = 3,
    'W1 approval: an all-days request names every date');
  PERFORM pg_temp.b3_cancel(f.o_d2);
  v_r := public.biz_ticket_link_decide(f.o_owner, v_signup, 'approve', gen_random_uuid(), pg_temp.b3_pepper());
  SELECT id INTO v_order FROM public.orders WHERE event_id = f.o_event;
  PERFORM pg_temp.b3_assert(v_r ->> 'status' = 'issued'
    AND (SELECT count(*) FROM public.orders WHERE event_id = f.o_event) = 1
    AND (SELECT array_agg(ted.event_date_id ORDER BY d.start_at) FROM public.ticket_event_dates ted
           JOIN public.tickets t ON t.id = ted.ticket_id JOIN public.event_dates d ON d.id = ted.event_date_id
          WHERE t.order_id = v_order) = ARRAY[f.o_d1, f.o_d3],
    'W1 approval: the all-days pass is recomputed without the cancelled date');
END $w1_approve_all_days$;

DO $w1_approve_single$
DECLARE f record; v_hash text; v_signup uuid; v_err text;
BEGIN
  -- A single-date event: the request carries no date of its own.
  SELECT * INTO f FROM pg_temp.b3_fixture('np', 1, 'single', 10);
  v_hash := pg_temp.b3_link(f.o_owner, f.o_event, f.o_free, NULL, 'host');
  PERFORM public.pg_ticket_link_signup(v_hash, pg_temp.b3_people(1, 'np1'), NULL, gen_random_uuid(), NULL, pg_temp.b3_pepper());
  SELECT id INTO v_signup FROM public.ticket_link_signups WHERE event_id = f.o_event;
  PERFORM pg_temp.b3_assert(NOT (SELECT per_date FROM public.ticket_link_signups WHERE id = v_signup),
    'W1 approval: a single-date request is not per date');
  PERFORM pg_temp.b3_cancel(f.o_d1);
  v_err := pg_temp.b3_err(format('SELECT public.biz_ticket_link_decide(%L,%L,''approve'',%L,%L)',
    f.o_owner, v_signup, gen_random_uuid(), pg_temp.b3_pepper()));
  PERFORM pg_temp.b3_assert(v_err = 'occurrence_not_available'
    AND (SELECT status FROM public.ticket_link_signups WHERE id = v_signup) = 'pending'
    AND NOT EXISTS (SELECT 1 FROM public.orders WHERE event_id = f.o_event),
    'W1 approval: a single-date request whose date was cancelled is refused and stays pending (' || COALESCE(v_err, 'issued') || ')');

  -- A recurring event with one night left: the request carries that night.
  SELECT * INTO f FROM pg_temp.b3_fixture('nq', 1, 'recurring', 10);
  v_hash := pg_temp.b3_link(f.o_owner, f.o_event, f.o_free, NULL, 'host');
  PERFORM public.pg_ticket_link_signup(v_hash, pg_temp.b3_people(1, 'nq1'), NULL, gen_random_uuid(), NULL, pg_temp.b3_pepper());
  SELECT id INTO v_signup FROM public.ticket_link_signups WHERE event_id = f.o_event;
  PERFORM pg_temp.b3_assert((SELECT event_date_id FROM public.ticket_link_signups WHERE id = v_signup) = f.o_d1
    AND NOT (SELECT per_date FROM public.ticket_link_signups WHERE id = v_signup),
    'W1 approval: the request carries its night');
  -- Another night is added, so the dateless check alone would not refuse.
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (f.o_event, now() + interval '4 days', now() + interval '4 days 5 hours', 'UTC', false);
  PERFORM pg_temp.b3_cancel(f.o_d1);
  v_err := pg_temp.b3_err(format('SELECT public.biz_ticket_link_decide(%L,%L,''approve'',%L,%L)',
    f.o_owner, v_signup, gen_random_uuid(), pg_temp.b3_pepper()));
  PERFORM pg_temp.b3_assert(v_err = 'occurrence_not_available'
    AND (SELECT status FROM public.ticket_link_signups WHERE id = v_signup) = 'pending'
    AND NOT EXISTS (SELECT 1 FROM public.orders WHERE event_id = f.o_event),
    'W1 approval: a request on a cancelled night is refused and stays pending (' || COALESCE(v_err, 'issued') || ')');
END $w1_approve_single$;

-- ═══ W2  buyer bundle ══════════════════════════════════════════════════════
DO $w2_bundle_multi$
DECLARE f record; v_b jsonb; v_o jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.b3_fixture('bm', 3, 'per_day', 10);
  UPDATE public.ticket_types SET valid_occurrence_keys = ARRAY['k1','k2'] WHERE id = f.o_free;
  PERFORM pg_temp.b3_cancel(f.o_d2);
  v_b := public.pg_direct_event_checkout_bundle(f.o_event)::jsonb;
  v_o := pg_temp.b3_occ(v_b, f.o_d2);
  PERFORM pg_temp.b3_assert(jsonb_array_length(v_b -> 'occurrences') = 3, 'W2 bundle: a cancelled date stays listed');
  PERFORM pg_temp.b3_assert(v_o -> 'cancelled' = 'true' AND v_o -> 'soldOut' = 'true' AND v_o -> 'placesLeft' = '0'
    AND v_o -> 'placesLeftByTicket' = jsonb_build_object(f.o_free::text, 0),
    'W2 bundle (multi-date): the cancelled date reads cancelled, sold out, no places (' || v_o::text || ')');
  v_o := pg_temp.b3_occ(v_b, f.o_d1);
  PERFORM pg_temp.b3_assert(v_o -> 'cancelled' = 'false' AND v_o -> 'soldOut' = 'null' AND v_o -> 'placesLeft' = 'null',
    'W2 bundle (multi-date): an active date is unchanged');
  PERFORM pg_temp.b3_assert(pg_temp.b3_ticket(v_b, f.o_free) -> 'soldOutOccurrenceIds' = jsonb_build_array(f.o_d2),
    'W2 bundle: a day-limited ticket lists the cancelled date as sold out (' || COALESCE(pg_temp.b3_ticket(v_b, f.o_free) ->> 'soldOutOccurrenceIds', 'none') || ')');

  UPDATE public.events SET theme = jsonb_build_object('business_event', jsonb_build_object(
    'settings', jsonb_build_object('hideRemainingCount', true))) WHERE id = f.o_event;
  v_b := public.pg_direct_event_checkout_bundle(f.o_event)::jsonb;
  v_o := pg_temp.b3_occ(v_b, f.o_d2);
  PERFORM pg_temp.b3_assert(v_o -> 'cancelled' = 'true' AND v_o -> 'soldOut' = 'true'
    AND v_o -> 'placesLeft' = 'null' AND v_o -> 'placesLeftByTicket' = 'null',
    'W2 bundle (hide remaining): the cancelled date is sold out and shows no counts (' || v_o::text || ')');
END $w2_bundle_multi$;

DO $w2_bundle_recurring$
DECLARE f record; v_b jsonb; v_o jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.b3_fixture('br', 3, 'recurring', 1);
  PERFORM pg_temp.b3_cancel(f.o_d2);
  v_b := public.pg_direct_event_checkout_bundle(f.o_event)::jsonb;
  v_o := pg_temp.b3_occ(v_b, f.o_d2);
  PERFORM pg_temp.b3_assert(v_o -> 'cancelled' = 'true' AND v_o -> 'soldOut' = 'true' AND v_o -> 'placesLeft' = '0'
    AND v_o -> 'placesLeftByTicket' = jsonb_build_object(f.o_free::text, 0),
    'W2 bundle (recurring): the cancelled night reads cancelled, sold out, no places (' || v_o::text || ')');
  v_o := pg_temp.b3_occ(v_b, f.o_d1);
  PERFORM pg_temp.b3_assert(v_o -> 'cancelled' = 'false' AND v_o -> 'soldOut' = 'false' AND v_o -> 'placesLeft' = '1',
    'W2 bundle (recurring): an open night is unchanged (' || v_o::text || ')');
  -- Fill both active nights: the ticket reads sold out although the cancelled night is empty.
  PERFORM public.biz_comp_issue(f.o_mgr, f.o_event, f.o_free, f.o_d1, pg_temp.b3_guest('br1'), NULL, gen_random_uuid(), pg_temp.b3_pepper());
  PERFORM public.biz_comp_issue(f.o_mgr, f.o_event, f.o_free, f.o_d3, pg_temp.b3_guest('br3'), NULL, gen_random_uuid(), pg_temp.b3_pepper());
  v_b := public.pg_direct_event_checkout_bundle(f.o_event)::jsonb;
  PERFORM pg_temp.b3_assert(pg_temp.b3_ticket(v_b, f.o_free) -> 'remaining' = '0',
    'W2 bundle (recurring): remaining ignores the cancelled night (' || COALESCE(pg_temp.b3_ticket(v_b, f.o_free) ->> 'remaining', 'null') || ')');
END $w2_bundle_recurring$;

-- ═══ W2  RSVP schedule ═════════════════════════════════════════════════════
DO $w2_rsvp$
DECLARE v_user uuid := gen_random_uuid(); v_brand uuid := gen_random_uuid(); v_event uuid := gen_random_uuid();
  v_d1 uuid; v_d2 uuid; v_r jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_user);
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES (v_brand, v_user, 'B3 rsvp', 'b3-rsvp-' || v_brand, 'USD');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency, is_multi_date)
    VALUES (v_event, v_brand, 'B3 rsvp', 'b3-rsvp-' || v_event, 'rsvp', 'draft', 'draft', 'UTC', 'USD', true);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, now() + interval '1 day', now() + interval '1 day 2 hours', 'UTC', true) RETURNING id INTO v_d1;
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, now() + interval '2 days', now() + interval '2 days 2 hours', 'UTC', false) RETURNING id INTO v_d2;
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now() WHERE id = v_event;
  PERFORM pg_temp.b3_cancel(v_d1);
  v_r := public.pg_public_rsvp_by_slug('b3-rsvp-' || v_brand, 'b3-rsvp-' || v_event)::jsonb;
  PERFORM pg_temp.b3_assert(jsonb_path_query_first(v_r, '$.**.upcoming_count') = '1'
    AND (jsonb_path_query_first(v_r, '$.**.next_start_at') #>> '{}')::timestamptz
        = (SELECT start_at FROM public.event_dates WHERE id = v_d2),
    'W2 RSVP: the schedule skips the cancelled date (' || COALESCE(jsonb_path_query_first(v_r, '$.**.schedule_line')::text, 'null') || ')');
END $w2_rsvp$;

-- ═══ W2  private link dates ════════════════════════════════════════════════
DO $w2_link$
DECLARE f record; v_paid_hash text; v_free_hash text; v_r jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.b3_fixture('lr', 3, 'per_day', 10);
  UPDATE public.ticket_types SET valid_occurrence_keys = ARRAY['k1','k2','k3'] WHERE id = f.o_paid;
  v_paid_hash := pg_temp.b3_link(f.o_owner, f.o_event, f.o_paid, NULL, 'auto');
  v_free_hash := pg_temp.b3_link(f.o_owner, f.o_event, f.o_free, NULL, 'auto');
  PERFORM pg_temp.b3_cancel(f.o_d2);
  v_r := public.pg_ticket_link_resolve(v_paid_hash);
  PERFORM pg_temp.b3_assert(
    (SELECT array_agg((x ->> 'id')::uuid) FROM jsonb_array_elements(v_r -> 'dates') x) = ARRAY[f.o_d1, f.o_d3],
    'W2 link: the dates skip the cancelled one (' || COALESCE(v_r ->> 'dates', 'null') || ')');
  PERFORM pg_temp.b3_assert(v_r #> '{tier,validOccurrenceIds}' = jsonb_build_array(f.o_d1, f.o_d3),
    'W2 link: validOccurrenceIds skip the cancelled date (' || COALESCE(v_r #>> '{tier,validOccurrenceIds}', 'null') || ')');
  v_r := public.pg_ticket_link_resolve(v_free_hash);
  PERFORM pg_temp.b3_assert(jsonb_array_length(v_r -> 'dates') = 2, 'W2 link: a guest-list link''s dates skip it too');
END $w2_link$;

-- ═══ W4  live save: dates before tickets ═══════════════════════════════════
CREATE FUNCTION pg_temp.b3_tier_json(p_tier uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('id', tt.id, 'name', tt.name, 'isFree', tt.is_free, 'isUnlimited', false,
    'priceGbp', CASE WHEN tt.is_free THEN NULL ELSE tt.price_cents::numeric / 100 END,
    'capacity', tt.quantity_total, 'visibility', 'public', 'displayOrder', tt.display_order, 'availableAt', 'both')
  FROM public.ticket_types tt WHERE tt.id = p_tier;
$$;

CREATE FUNCTION pg_temp.b3_when(p_dates jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('whenMode', 'multi_date', 'timezone', 'UTC', 'multiDates', p_dates);
$$;

CREATE FUNCTION pg_temp.b3_day(p_key text, p_offset integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('id', p_key, 'date', to_char(now() + (p_offset || ' days')::interval, 'YYYY-MM-DD'),
    'startTime', '18:00', 'endTime', '23:00');
$$;

CREATE FUNCTION pg_temp.b3_save(p_event uuid, p_patch jsonb) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.business_update_live_event_atomic(p_event, p_patch, 'Dates and tickets edit',
    (SELECT COALESCE((theme #>> '{business_event,clientRevision}')::integer, 0) + 1
       FROM public.events WHERE id = p_event));
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $$;

CREATE FUNCTION pg_temp.b3_keys(p_tier uuid) RETURNS text[] LANGUAGE sql AS $$
  SELECT valid_occurrence_keys FROM public.ticket_types WHERE id = p_tier;
$$;

-- A published multi-date event (md_a, md_b) through the wizard's publish:
-- "A only" on md_a, "B only" on md_b with an extra on md_b, "All" on every date.
CREATE FUNCTION pg_temp.b3_live(
  p_tag text, OUT o_event uuid, OUT o_user uuid, OUT o_brand uuid,
  OUT o_a uuid, OUT o_b uuid, OUT o_all uuid
) LANGUAGE plpgsql AS $$
BEGIN
  o_user := gen_random_uuid(); o_brand := gen_random_uuid(); o_event := gen_random_uuid();
  INSERT INTO auth.users (id) VALUES (o_user);
  INSERT INTO public.creator_accounts (id) VALUES (o_user);
  INSERT INTO public.brands (id, account_id, name, slug, payment_provider, default_currency)
    VALUES (o_brand, o_user, 'B3 live ' || p_tag, 'b3-live-' || p_tag || '-' || o_brand, 'stripe', 'GBP');
  INSERT INTO public.stripe_connect_accounts(
    brand_id, stripe_account_id, charges_enabled, payouts_enabled, country, default_currency
  ) VALUES (o_brand, 'acct_b3l_' || replace(o_brand::text, '-', ''), true, true, 'GB', 'gbp');
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = '1.0', mingla_tos_accepted_at = now()
   WHERE brand_id = o_brand AND user_id = o_user;
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (o_event, o_brand, 'B3 live', 'b3-live-' || o_event, 'event', 'draft', 'draft', 'UTC');
  PERFORM set_config('request.jwt.claim.sub', o_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM public.business_publish_event_draft(o_event, jsonb_build_object(
    'title', 'B3 live weekend', 'timezone', 'UTC', 'is_online', true, 'is_multi_date', true,
    'online_url', 'https://zoom.us/j/123456789',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'format', 'online', 'requestedVisibility', 'public', 'partyTypes', jsonb_build_array('festival'),
      'vibeTags', jsonb_build_array('exclusive', 'vibrant', 'artsy'),
      'whenMode', 'multi_date', 'multiDates', jsonb_build_array(pg_temp.b3_day('md_a', 10), pg_temp.b3_day('md_b', 11)),
      'tickets', jsonb_build_array(
        jsonb_build_object('name', 'A only', 'isFree', true, 'price', 0, 'capacity', 50,
          'validDayIds', jsonb_build_array('md_a')),
        jsonb_build_object('name', 'B only', 'isFree', true, 'price', 0, 'capacity', 50,
          'validDayIds', jsonb_build_array('md_b'),
          'extras', jsonb_build_array(jsonb_build_object('id', 'x_b', 'name', 'B brunch', 'priceGbp', 0,
            'capacity', 5, 'validDayIds', jsonb_build_array('md_b')))),
        jsonb_build_object('name', 'All', 'isFree', true, 'price', 0, 'capacity', 50))))), NULL);
  SELECT id INTO o_a FROM public.ticket_types WHERE event_id = o_event AND name = 'A only';
  SELECT id INTO o_b FROM public.ticket_types WHERE event_id = o_event AND name = 'B only';
  SELECT id INTO o_all FROM public.ticket_types WHERE event_id = o_event AND name = 'All';
END $$;

DO $w4_scope_new_dates$
DECLARE f record; v_err text; v_c uuid := gen_random_uuid(); v_extra uuid; v_tiers jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.b3_live('scope');
  PERFORM pg_temp.b3_assert(pg_temp.b3_keys(f.o_b) = ARRAY['md_b'], 'W4 fixture: B only is on md_b');

  -- Add md_c and, in the same save, a ticket and an extra on md_c.
  v_tiers := jsonb_build_array(pg_temp.b3_tier_json(f.o_a) || jsonb_build_object('validDayIds', jsonb_build_array('md_a')),
    pg_temp.b3_tier_json(f.o_b), pg_temp.b3_tier_json(f.o_all),
    jsonb_build_object('id', v_c, 'name', 'C only', 'isFree', true, 'isUnlimited', false, 'capacity', 20,
      'visibility', 'public', 'displayOrder', 3, 'availableAt', 'both', 'validDayIds', jsonb_build_array('md_c'),
      'extras', jsonb_build_array(jsonb_build_object('id', 'x_c', 'name', 'C shuttle', 'priceGbp', 0,
        'capacity', 4, 'validDayIds', jsonb_build_array('md_c')))));
  v_err := pg_temp.b3_save(f.o_event, jsonb_build_object(
    'core', jsonb_build_object('tickets', v_tiers),
    'when', pg_temp.b3_when(jsonb_build_array(pg_temp.b3_day('md_a', 10), pg_temp.b3_day('md_b', 11), pg_temp.b3_day('md_c', 12)))));
  SELECT id INTO v_extra FROM public.ticket_add_ons WHERE ticket_type_id = v_c;
  PERFORM pg_temp.b3_assert(v_err IS NULL AND pg_temp.b3_keys(v_c) = ARRAY['md_c']
    AND (SELECT valid_occurrence_keys FROM public.ticket_add_ons WHERE id = v_extra) = ARRAY['md_c'],
    'W4: one save adds a date and a ticket and an extra on it (' || COALESCE(v_err, 'saved') || ')');

  -- Remove md_b and move B only (and its extra) to the existing md_a.
  v_tiers := jsonb_build_array(pg_temp.b3_tier_json(f.o_a),
    pg_temp.b3_tier_json(f.o_b) || jsonb_build_object('validDayIds', jsonb_build_array('md_a'),
      'extras', jsonb_build_array(jsonb_build_object('id', (SELECT id FROM public.ticket_add_ons WHERE ticket_type_id = f.o_b),
        'name', 'B brunch', 'priceGbp', 0, 'capacity', 5, 'validDayIds', jsonb_build_array('md_a')))),
    pg_temp.b3_tier_json(f.o_all), pg_temp.b3_tier_json(v_c));
  v_err := pg_temp.b3_save(f.o_event, jsonb_build_object('core', jsonb_build_object('tickets', v_tiers),
    'when', pg_temp.b3_when(jsonb_build_array(pg_temp.b3_day('md_a', 10), pg_temp.b3_day('md_c', 12)))));
  PERFORM pg_temp.b3_assert(v_err IS NULL AND pg_temp.b3_keys(f.o_b) = ARRAY['md_a']
    AND (SELECT valid_occurrence_keys FROM public.ticket_add_ons WHERE ticket_type_id = f.o_b) = ARRAY['md_a']
    AND NOT EXISTS (SELECT 1 FROM public.event_dates WHERE event_id = f.o_event AND occurrence_key = 'md_b'),
    'W4: removing a date and moving its ticket to an existing date saves (' || COALESCE(v_err, 'saved') || ')');

  -- Remove md_c and move C only (and its extra) to a new md_d.
  v_tiers := jsonb_build_array(pg_temp.b3_tier_json(f.o_a), pg_temp.b3_tier_json(f.o_b), pg_temp.b3_tier_json(f.o_all),
    pg_temp.b3_tier_json(v_c) || jsonb_build_object('validDayIds', jsonb_build_array('md_d'),
      'extras', jsonb_build_array(jsonb_build_object('id', v_extra, 'name', 'C shuttle', 'priceGbp', 0,
        'capacity', 4, 'validDayIds', jsonb_build_array('md_d')))));
  v_err := pg_temp.b3_save(f.o_event, jsonb_build_object('core', jsonb_build_object('tickets', v_tiers),
    'when', pg_temp.b3_when(jsonb_build_array(pg_temp.b3_day('md_a', 10), pg_temp.b3_day('md_d', 13)))));
  PERFORM pg_temp.b3_assert(v_err IS NULL AND pg_temp.b3_keys(v_c) = ARRAY['md_d']
    AND (SELECT valid_occurrence_keys FROM public.ticket_add_ons WHERE id = v_extra) = ARRAY['md_d'],
    'W4: removing a date and moving its ticket to a new date saves (' || COALESCE(v_err, 'saved') || ')');

  -- Removing md_d while C only still lists only md_d is refused, never widened.
  v_err := pg_temp.b3_save(f.o_event, jsonb_build_object(
    'when', pg_temp.b3_when(jsonb_build_array(pg_temp.b3_day('md_a', 10)))));
  PERFORM pg_temp.b3_assert(v_err = 'tier_day_scope_empty' AND pg_temp.b3_keys(v_c) = ARRAY['md_d'],
    'W4: a ticket left only on a removed date is refused (dates only) (' || COALESCE(v_err, 'saved') || ')');
  v_err := pg_temp.b3_save(f.o_event, jsonb_build_object(
    'core', jsonb_build_object('tickets', jsonb_build_array(pg_temp.b3_tier_json(f.o_a), pg_temp.b3_tier_json(f.o_b),
      pg_temp.b3_tier_json(f.o_all), pg_temp.b3_tier_json(v_c))),
    'when', pg_temp.b3_when(jsonb_build_array(pg_temp.b3_day('md_a', 10)))));
  PERFORM pg_temp.b3_assert(v_err = 'tier_day_scope_empty' AND pg_temp.b3_keys(v_c) = ARRAY['md_d']
    AND EXISTS (SELECT 1 FROM public.event_dates WHERE event_id = f.o_event AND occurrence_key = 'md_d'),
    'W4: a ticket left only on a removed date is refused (with tickets) and nothing moves (' || COALESCE(v_err, 'saved') || ')');
END $w4_scope_new_dates$;

DO $w4_sold_day$
DECLARE f record; v_mgr uuid := gen_random_uuid(); v_err text; v_day uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.b3_live('sold');
  INSERT INTO auth.users(id) VALUES (v_mgr);
  INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
    VALUES (f.o_brand, v_mgr, 'event_manager', now(), now());
  SELECT id INTO v_day FROM public.event_dates WHERE event_id = f.o_event AND occurrence_key = 'md_a';
  PERFORM public.biz_comp_issue(v_mgr, f.o_event, f.o_all, v_day, pg_temp.b3_guest('w4sold'), NULL,
    gen_random_uuid(), pg_temp.b3_pepper());
  PERFORM set_config('request.jwt.claim.sub', f.o_user::text, true);
  v_err := pg_temp.b3_save(f.o_event, jsonb_build_object(
    'core', jsonb_build_object('tickets', jsonb_build_array(
      pg_temp.b3_tier_json(f.o_a) || jsonb_build_object('validDayIds', jsonb_build_array('md_b')),
      pg_temp.b3_tier_json(f.o_b), pg_temp.b3_tier_json(f.o_all))),
    'when', pg_temp.b3_when(jsonb_build_array(pg_temp.b3_day('md_b', 11)))));
  PERFORM pg_temp.b3_assert(v_err = 'multi_date_remove_with_sales'
    AND EXISTS (SELECT 1 FROM public.event_dates WHERE id = v_day),
    'W4: removing a date with a sold pass is still refused (' || COALESCE(v_err, 'saved') || ')');
END $w4_sold_day$;

-- A direct when-save still strips removed dates (and the live save above left
-- no deferral switched on in this transaction).
DO $w4_direct_strip$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM pg_temp.b3_live('direct');
  PERFORM public.business_patch_event_when(f.o_event, pg_temp.b3_when(jsonb_build_array(pg_temp.b3_day('md_a', 10),
    pg_temp.b3_day('md_b', 11), pg_temp.b3_day('md_c', 12))), 'Add a third date', NULL);
  PERFORM pg_temp.b3_assert(pg_temp.b3_save(f.o_event, jsonb_build_object(
      'core', jsonb_build_object('tickets', jsonb_build_array(pg_temp.b3_tier_json(f.o_a),
        pg_temp.b3_tier_json(f.o_b), pg_temp.b3_tier_json(f.o_all) || jsonb_build_object('validDayIds', jsonb_build_array('md_a', 'md_c'))))))
    IS NULL AND pg_temp.b3_keys(f.o_all) = ARRAY['md_a', 'md_c'], 'W4: a tickets-only live save');
  PERFORM public.business_patch_event_when(f.o_event, pg_temp.b3_when(jsonb_build_array(pg_temp.b3_day('md_a', 10),
    pg_temp.b3_day('md_b', 11))), 'Remove the third date', NULL);
  PERFORM pg_temp.b3_assert(current_setting('mingla.issue_3281_defer_day_strip', true) IS DISTINCT FROM 'on'
    AND pg_temp.b3_keys(f.o_all) = ARRAY['md_a'],
    'W4: a direct business_patch_event_when still strips the removed date (' || COALESCE(array_to_string(pg_temp.b3_keys(f.o_all), ','), 'null') || ')');
END $w4_direct_strip$;

-- offering_date_past: judged on the stored tickets inside
-- business_patch_event_when and again on the saved ones.
DO $w4_offering_date_past$
DECLARE f record; v_err text; v_past jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.b3_live('past');
  v_past := pg_temp.b3_when(jsonb_build_array(pg_temp.b3_day('md_a', -3), pg_temp.b3_day('md_b', -2)));
  -- Free to paid while every date moves into the past: refused (as before).
  v_err := pg_temp.b3_save(f.o_event, jsonb_build_object(
    'core', jsonb_build_object('tickets', jsonb_build_array(pg_temp.b3_tier_json(f.o_a), pg_temp.b3_tier_json(f.o_b),
      pg_temp.b3_tier_json(f.o_all) || jsonb_build_object('isFree', false, 'priceGbp', 10, 'availableAt', 'online'))),
    'when', v_past));
  PERFORM pg_temp.b3_assert(v_err = 'offering_date_past' AND (SELECT is_free FROM public.ticket_types WHERE id = f.o_all),
    'W4: making a ticket paid while moving every date into the past is refused (' || COALESCE(v_err, 'saved') || ')');
  -- Free stays free: the past move itself is allowed.
  v_err := pg_temp.b3_save(f.o_event, jsonb_build_object('when', v_past));
  PERFORM pg_temp.b3_assert(v_err IS NULL, 'W4: a free event can still move into the past (' || COALESCE(v_err, 'saved') || ')');
END $w4_offering_date_past$;

DO $w4_offering_paid_to_free$
DECLARE f record; v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.b3_live('p2f');
  PERFORM pg_temp.b3_assert(pg_temp.b3_save(f.o_event, jsonb_build_object(
      'core', jsonb_build_object('tickets', jsonb_build_array(pg_temp.b3_tier_json(f.o_a), pg_temp.b3_tier_json(f.o_b),
        pg_temp.b3_tier_json(f.o_all) || jsonb_build_object('isFree', false, 'priceGbp', 10, 'availableAt', 'online')))))
    IS NULL, 'W4 fixture: a ticket made paid');
  -- Paid to free while every date moves into the past: the stored ticket is
  -- paid when the dates are written, so this save is refused (chosen behaviour).
  v_err := pg_temp.b3_save(f.o_event, jsonb_build_object(
    'core', jsonb_build_object('tickets', jsonb_build_array(pg_temp.b3_tier_json(f.o_a), pg_temp.b3_tier_json(f.o_b),
      pg_temp.b3_tier_json(f.o_all) || jsonb_build_object('isFree', true, 'priceGbp', NULL))),
    'when', pg_temp.b3_when(jsonb_build_array(pg_temp.b3_day('md_a', -3), pg_temp.b3_day('md_b', -2)))));
  PERFORM pg_temp.b3_assert(v_err = 'offering_date_past', 'W4: paid to free with every date in the past is refused (' || COALESCE(v_err, 'saved') || ')');
END $w4_offering_paid_to_free$;

-- A recurring live save (dates and tickets in one save) works as before.
DO $w4_recurring$
DECLARE v_user uuid := gen_random_uuid(); v_brand uuid := gen_random_uuid(); v_event uuid := gen_random_uuid();
  v_rule jsonb := '{"preset":"daily","termination":{"kind":"count","count":4}}'::jsonb;
  v_date text := to_char(now() + interval '5 days', 'YYYY-MM-DD'); v_ids uuid[]; v_tier uuid; v_err text;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_user);
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug) VALUES (v_brand, v_user, 'B3 rec', 'b3-rec-' || v_brand);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme)
    VALUES (v_event, v_brand, v_user, 'B3 rec', 'b3-rec-' || v_event, 'event', 'draft', 'draft', 'UTC',
      jsonb_build_object('business_draft', jsonb_build_object('clientRevision', 0, 'requestedVisibility', 'public')));
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM public.issue_1719_publish_event_with_poster(v_event, jsonb_build_object(
    'title', 'B3 rec', 'timezone', 'UTC', 'is_online', true, 'online_url', 'https://meet.example.test/b3',
    'is_recurring', true, 'recurrence_rules', v_rule,
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'format', 'online', 'requestedVisibility', 'public', 'clientRevision', 1,
      'tickets', jsonb_build_array(jsonb_build_object('name', 'Seat', 'isFree', true, 'price', 0, 'capacity', 10)),
      'partyTypes', jsonb_build_array('festival'), 'vibeTags', jsonb_build_array('social'),
      'whenMode', 'recurring', 'recurrenceRule', v_rule,
      'when', jsonb_build_object('date', v_date, 'doorsOpen', '19:00', 'endsAt', '23:00')))), 1);
  SELECT array_agg(id ORDER BY start_at) INTO v_ids FROM public.event_dates WHERE event_id = v_event;
  SELECT id INTO v_tier FROM public.ticket_types WHERE event_id = v_event;
  v_err := pg_temp.b3_save(v_event, jsonb_build_object(
    'core', jsonb_build_object('tickets', jsonb_build_array(pg_temp.b3_tier_json(v_tier) || jsonb_build_object('name', 'Seat renamed'))),
    'when', jsonb_build_object('whenMode', 'recurring', 'timezone', 'UTC', 'multiDates', NULL, 'recurrenceRule', v_rule,
      'when', jsonb_build_object('date', v_date, 'doorsOpen', '20:00', 'endsAt', '23:30'))));
  PERFORM pg_temp.b3_assert(v_err IS NULL AND cardinality(v_ids) = 4
    AND (SELECT array_agg(id ORDER BY start_at) FROM public.event_dates WHERE event_id = v_event) = v_ids
    AND (SELECT count(*) FROM public.event_dates WHERE event_id = v_event AND (start_at AT TIME ZONE 'UTC')::time = '20:00') = 4
    AND (SELECT name FROM public.ticket_types WHERE id = v_tier) = 'Seat renamed',
    'W4: a recurring live save retimes every night in place and edits the ticket (' || COALESCE(v_err, 'saved') || ')');
END $w4_recurring$;

-- ═══ W5  a live RSVP edit keeps its date row ═══════════════════════════════
CREATE FUNCTION pg_temp.b3_rsvp(p_tag text, OUT o_event uuid, OUT o_user uuid) LANGUAGE plpgsql AS $$
DECLARE v_brand uuid := gen_random_uuid();
BEGIN
  o_user := gen_random_uuid(); o_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (o_user, 'b3-rsvp-' || p_tag || '-' || o_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (o_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, o_user, 'B3 RSVP ' || p_tag, 'b3-rsvp-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', o_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency, theme)
  VALUES (o_event, v_brand, o_user, 'B3 RSVP', 'b3-rsvp-draft-' || o_event, 'rsvp', 'draft', 'draft', 'UTC', 'USD',
    jsonb_build_object('business_draft', jsonb_build_object('isRsvp', true, 'tickets', '[]'::jsonb, 'clientRevision', 0)));
  PERFORM public.business_update_rsvp_graph(o_event, jsonb_build_object(
    '__expectedClientRevision', 1, 'title', 'B3 RSVP', 'description', NULL,
    'location_text', 'Lantern Room', 'online_url', NULL, 'currency', 'USD', 'is_online', false,
    'timezone', 'UTC', 'city', 'Brooklyn',
    'theme', jsonb_build_object('coverHue', 25, 'business_draft', jsonb_build_object(
      'format', 'in_person', 'partyTypes', jsonb_build_array('house-party'), 'vibeTags', '[]'::jsonb,
      'musicGenres', '[]'::jsonb, 'city', 'Brooklyn', 'requestedVisibility', 'public', 'whenMode', 'single',
      'when', jsonb_build_object('date', to_char((now() + interval '30 days')::date, 'YYYY-MM-DD'),
        'doorsOpen', '19:00', 'endsAt', '23:00', 'timezone', 'UTC'),
      'location', jsonb_build_object('venueName', 'Lantern Room', 'address', NULL),
      'hideAddressUntilTicket', false, 'tickets', '[]'::jsonb, 'isRsvp', true, 'rsvpApprovalMode', 'auto',
      'rsvpDiscoverable', false, 'rsvpContributionEnabled', false, 'rsvpContributionSuggestedCents', NULL,
      'rsvpContributionMinCents', NULL, 'clientRevision', 1))), NULL, NULL);
  PERFORM public.business_publish_rsvp_graph(o_event, gen_random_uuid());
END $$;

DO $w5_rsvp_keeps_date$
DECLARE f record; v_id uuid; v_new_date text := to_char((now() + interval '40 days')::date, 'YYYY-MM-DD'); v_row record;
BEGIN
  SELECT * INTO f FROM pg_temp.b3_rsvp('keep');
  SELECT id INTO v_id FROM public.event_dates WHERE event_id = f.o_event;
  PERFORM pg_temp.b3_assert(v_id IS NOT NULL AND (SELECT count(*) FROM public.event_dates WHERE event_id = f.o_event) = 1,
    'W5 fixture: the RSVP has one date row');
  UPDATE public.event_dates SET occurrence_key = 'rsvp_key' WHERE id = v_id;
  PERFORM public.biz_update_live_rsvp(f.o_event, jsonb_build_object('title', 'B3 RSVP',
    'when', jsonb_build_object('date', v_new_date, 'doorsOpen', '18:00', 'endsAt', '22:00')), 'Moving the date');
  SELECT * INTO v_row FROM public.event_dates WHERE event_id = f.o_event;
  PERFORM pg_temp.b3_assert((SELECT count(*) FROM public.event_dates WHERE event_id = f.o_event) = 1
    AND v_row.id = v_id AND v_row.occurrence_key = 'rsvp_key' AND v_row.is_master
    AND to_char(v_row.start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') = v_new_date || ' 18:00',
    'W5: a live RSVP edit moves its date in place (id and occurrence_key kept)');

  -- A cancelled date stays cancelled through an edit.
  PERFORM pg_temp.b3_cancel(v_id);
  PERFORM public.biz_update_live_rsvp(f.o_event, jsonb_build_object('title', 'B3 RSVP',
    'when', jsonb_build_object('date', v_new_date, 'doorsOpen', '19:00', 'endsAt', '22:00')), 'Moving the time');
  SELECT * INTO v_row FROM public.event_dates WHERE event_id = f.o_event;
  PERFORM pg_temp.b3_assert(v_row.id = v_id AND v_row.status = 'cancelled' AND v_row.cancelled_at IS NOT NULL
    AND to_char(v_row.start_at AT TIME ZONE 'UTC', 'HH24:MI') = '19:00',
    'W5: a cancelled RSVP date stays cancelled through an edit');
END $w5_rsvp_keeps_date$;

DO $w5_rsvp_inserts$
DECLARE f record; v_new_date text := to_char((now() + interval '41 days')::date, 'YYYY-MM-DD');
BEGIN
  SELECT * INTO f FROM pg_temp.b3_rsvp('ins');
  DELETE FROM public.event_dates WHERE event_id = f.o_event;
  PERFORM public.biz_update_live_rsvp(f.o_event, jsonb_build_object('title', 'B3 RSVP',
    'when', jsonb_build_object('date', v_new_date, 'doorsOpen', '18:00', 'endsAt', '22:00')), 'Setting a date');
  PERFORM pg_temp.b3_assert((SELECT count(*) FROM public.event_dates WHERE event_id = f.o_event AND is_master
      AND status = 'active') = 1,
    'W5: an RSVP with no date row gets one');
END $w5_rsvp_inserts$;

ROLLBACK;
