\set ON_ERROR_STOP on

-- Issue #4130 (Wave 5) — Data room analytics. Run after the full migration
-- chain on PostgreSQL 17.
--
--   C-01  Shape: every page read exists, is SECURITY DEFINER with the Data
--         room gate as its first check, is refused to anon; the builders, the
--         reader and the snapshot writer are not callable by signed-in users;
--         the snapshot table has RLS on and no browser grant; the nightly job
--         is scheduled.
--   C-02  Gate: a signed-in outsider and a growth teammate are refused; a
--         founding partner and an admin are allowed.
--   C-03  Segments match the People RPC (admin_people_segments) exactly, and
--         the monthly new-user series adds up to the segment totals.
--   C-04  Staff and test accounts are left out: a staff sign-up moves only
--         "left out", never a segment, a funnel or a ticket count; a staff
--         buyer's ticket does not count, a real buyer's does.
--   C-05  Retention: a cohort too new to measure is NULL, never 0; an old
--         cohort with no return is 0, with a return in days 7..13 is 100.
--   C-06  Money: each currency stays separate; the only cross-currency
--         figure is the US dollar sum of each currency's own-day USD.
--   C-07  Snapshot: the nightly writer stores one row per section and a
--         re-run replaces them; reads come from the snapshot once it exists,
--         live before; a day with no snapshot is an error, not zeros.
-- MINGLA-INVARIANT: I-4130-DATA-ROOM-ANALYTICS-GATED | issue #4130 | proved by C-01..C-06 here.

CREATE OR REPLACE FUNCTION pg_temp.w5_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4130 wave 5 FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- Runs p_sql as signed-in p_user; returns the SQLSTATE it raised, or NULL.
CREATE OR REPLACE FUNCTION pg_temp.w5_refused(p_user uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $a$
DECLARE
  v_state text;
BEGIN
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
    EXECUTE p_sql;
    RESET ROLE;
    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    RESET ROLE;
    RETURN v_state;
  END;
END
$a$;

-- A page read as signed-in p_user (the admin in these cases).
CREATE OR REPLACE FUNCTION pg_temp.w5_read(p_user uuid, p_fn text)
RETURNS jsonb LANGUAGE plpgsql AS $a$
DECLARE
  v jsonb;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  EXECUTE format('SELECT public.%I()', p_fn) INTO v;
  RESET ROLE;
  RETURN v;
END
$a$;

--------------------------------------------------------------------------------
BEGIN;
DO $c01$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_data_room_users(date)',
    'public.admin_data_room_overview(date)',
    'public.admin_data_room_explorers(date)',
    'public.admin_data_room_hosts(date)',
    'public.admin_data_room_funnels(date)',
    'public.admin_data_room_retention(date)',
    'public.admin_data_room_money(date)',
    'public.admin_data_room_snapshot_dates()'
  ] LOOP
    PERFORM pg_temp.w5_assert(to_regprocedure(v_fn) IS NOT NULL, 'C-01 exists ' || v_fn);
    PERFORM pg_temp.w5_assert(NOT has_function_privilege('anon', v_fn, 'EXECUTE'), 'C-01 anon cannot run ' || v_fn);
    PERFORM pg_temp.w5_assert(has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'C-01 signed-in may call ' || v_fn);
    PERFORM pg_temp.w5_assert(
      (SELECT p.prosecdef
              AND p.prosrc ~ '^\s*BEGIN\s+IF NOT public\.admin_data_room_allowed\(\) THEN RAISE EXCEPTION'
              AND 'search_path=public, pg_temp' = ANY (p.proconfig)
         FROM pg_proc p WHERE p.oid = v_fn::regprocedure),
      'C-01 definer, pinned search_path, gate first ' || v_fn);
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_data_room_allowed()',
    'public.analytics_dr_activity()',
    'public.analytics_dr_tickets()',
    'public.analytics_dr_users()',
    'public.analytics_dr_overview()',
    'public.analytics_dr_explorers()',
    'public.analytics_dr_hosts()',
    'public.analytics_dr_funnels()',
    'public.analytics_dr_retention()',
    'public.analytics_dr_money()',
    'public.analytics_dr_compute(text)',
    'public.analytics_dr_read(text,date)',
    'public.analytics_daily_snapshot_refresh()'
  ] LOOP
    PERFORM pg_temp.w5_assert(NOT has_function_privilege('authenticated', v_fn, 'EXECUTE'),
      'C-01 not callable by signed-in users ' || v_fn);
    PERFORM pg_temp.w5_assert(NOT has_function_privilege('anon', v_fn, 'EXECUTE'),
      'C-01 not callable by anon ' || v_fn);
  END LOOP;
  PERFORM pg_temp.w5_assert(
    (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.analytics_daily_snapshot'::regclass),
    'C-01 analytics_daily_snapshot has RLS on');
  PERFORM pg_temp.w5_assert(
    NOT has_table_privilege('authenticated', 'public.analytics_daily_snapshot', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.analytics_daily_snapshot', 'SELECT'),
    'C-01 browsers cannot read the snapshot table');
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM pg_temp.w5_assert(
      (SELECT count(*) = 1 FROM cron.job
        WHERE jobname = 'issue_4130_analytics_daily_snapshot'
          AND schedule = '20 0 * * *'
          AND command ~ 'analytics_daily_snapshot_refresh\(\)'),
      'C-01 nightly snapshot job scheduled once');
  END IF;
END
$c01$;
ROLLBACK;

--------------------------------------------------------------------------------
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
DO $main$
DECLARE
  v_admin    constant uuid := '41300000-0000-4000-a500-000000000001';
  v_partner  constant uuid := '41300000-0000-4000-a500-000000000002';
  v_growth   constant uuid := '41300000-0000-4000-a500-000000000003';
  v_outsider constant uuid := '41300000-0000-4000-a500-000000000004';
  v_explorer constant uuid := '41300000-0000-4000-a500-000000000010';
  v_host     constant uuid := '41300000-0000-4000-a500-000000000011';
  v_staff    constant uuid := '41300000-0000-4000-a500-000000000012';
  v_old_in   constant uuid := '41300000-0000-4000-a500-000000000013';
  v_old_out  constant uuid := '41300000-0000-4000-a500-000000000014';
  v_brand    constant uuid := '41300000-0000-4000-a500-000000000100';
  v_event    constant uuid := '41300000-0000-4000-a500-000000000200';
  v_type     constant uuid := '41300000-0000-4000-a500-000000000300';
  v_o_real   constant uuid := '41300000-0000-4000-a500-000000000400';
  v_o_staff  constant uuid := '41300000-0000-4000-a500-000000000401';
  v_o_usd    constant uuid := '41300000-0000-4000-a500-000000000402';
  v_snap     constant uuid := '41300000-0000-4000-a500-000000000500';
  v_old      constant timestamptz := '2001-01-15 12:00:00+00';
  v_fn text;
  v_state text;
  v_seg jsonb;
  v_before jsonb;
  v_after jsonb;
  v jsonb;
  v_ret jsonb;
  v_cells jsonb;
  v_cell jsonb;
  v_m_before jsonb;
  v_m_after jsonb;
  v_ngn bigint;
  v_usd bigint;
  v_ngn_usd bigint;
  v_usd_usd bigint;
  v_t_before bigint;
  v_f_before jsonb;
  v_n int;
BEGIN
  -- ── Who is who ─────────────────────────────────────────────────────────────
  INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
    (v_admin,    'w5-admin@mingla-fixture.org',    now()),
    (v_partner,  'w5-partner@mingla-fixture.org',  now()),
    (v_growth,   'w5-growth@mingla-fixture.org',   now()),
    (v_outsider, 'w5-outsider@mingla-fixture.org', now()),
    (v_explorer, 'w5-explorer@mingla-fixture.org', now()),
    (v_host,     'w5-host@mingla-fixture.org',     now()),
    (v_staff,    'w5-staff@usemingla.com',         now()),
    (v_old_in,   'w5-old-in@mingla-fixture.org',   now()),
    (v_old_out,  'w5-old-out@mingla-fixture.org',  now());
  INSERT INTO public.admin_users(email, role, status) VALUES ('w5-admin@mingla-fixture.org', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
  INSERT INTO public.admin_team_members(email, role, status, accepted_at) VALUES
    ('w5-partner@mingla-fixture.org', 'partner', 'active', now()),
    ('w5-growth@mingla-fixture.org',  'growth',  'active', now());

  -- ── C-02 the gate ──────────────────────────────────────────────────────────
  FOREACH v_fn IN ARRAY ARRAY['admin_data_room_users', 'admin_data_room_overview',
      'admin_data_room_explorers', 'admin_data_room_hosts', 'admin_data_room_funnels',
      'admin_data_room_retention', 'admin_data_room_money', 'admin_data_room_snapshot_dates'] LOOP
    v_state := pg_temp.w5_refused(v_outsider, format('SELECT public.%I()', v_fn));
    PERFORM pg_temp.w5_assert(v_state = '42501', 'C-02 outsider refused ' || v_fn || ' (' || COALESCE(v_state, 'allowed') || ')');
    v_state := pg_temp.w5_refused(v_growth, format('SELECT public.%I()', v_fn));
    PERFORM pg_temp.w5_assert(v_state = '42501', 'C-02 growth teammate refused ' || v_fn || ' (' || COALESCE(v_state, 'allowed') || ')');
    v_state := pg_temp.w5_refused(v_partner, format('SELECT public.%I()', v_fn));
    PERFORM pg_temp.w5_assert(v_state IS NULL, 'C-02 founding partner allowed ' || v_fn || ' (' || COALESCE(v_state, 'ok') || ')');
    v_state := pg_temp.w5_refused(v_admin, format('SELECT public.%I()', v_fn));
    PERFORM pg_temp.w5_assert(v_state IS NULL, 'C-02 admin allowed ' || v_fn || ' (' || COALESCE(v_state, 'ok') || ')');
  END LOOP;

  -- Counts before any fixture person exists (other suites may have left rows).
  v_before   := pg_temp.w5_read(v_admin, 'admin_data_room_users') -> 'data';
  v_f_before := pg_temp.w5_read(v_admin, 'admin_data_room_funnels') -> 'data';
  v_t_before := (pg_temp.w5_read(v_admin, 'admin_data_room_overview') -> 'data' -> 'kpis' ->> 'tickets_30d')::bigint;
  v_m_before := pg_temp.w5_read(v_admin, 'admin_data_room_money') -> 'data';

  -- ── People: an explorer, a host, a staff explorer, two old explorers ──────
  INSERT INTO public.profiles(id, email, display_name, has_completed_onboarding, is_seed, created_at) VALUES
    (v_explorer, 'w5-explorer@mingla-fixture.org', 'W5 Explorer', true,  false, now() - interval '1 day'),
    (v_host,     'w5-host@mingla-fixture.org',     'W5 Host',     false, false, now() - interval '1 day'),
    (v_staff,    'w5-staff@usemingla.com',         'W5 Staff',    true,  false, now() - interval '1 day'),
    (v_old_in,   'w5-old-in@mingla-fixture.org',   'W5 Old In',   true,  false, v_old),
    (v_old_out,  'w5-old-out@mingla-fixture.org',  'W5 Old Out',  true,  false, v_old);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_host, 'w5-host@mingla-fixture.org');

  -- Activity: the explorers saw the deck; the staff account did too.
  INSERT INTO public.engagement_metrics(user_id, event_kind, container_key, created_at) VALUES
    (v_explorer, 'seen_deck', 'w5-fixture', now() - interval '2 hours'),
    (v_staff,    'seen_deck', 'w5-fixture', now() - interval '2 hours'),
    -- Old-in comes back on day 8 (inside the D7 window, days 7..13).
    (v_old_in,   'seen_deck', 'w5-fixture', v_old + interval '8 days');

  -- ── C-03 segments match the People RPC ─────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_seg := public.admin_people_segments();
  v := public.admin_data_room_users();
  RESET ROLE;
  v_after := v -> 'data';
  PERFORM pg_temp.w5_assert(v ->> 'source' = 'live' AND v ->> 'as_of' IS NOT NULL,
    'C-07 with no snapshot today the read is live and says when');
  PERFORM pg_temp.w5_assert(
    (v_after -> 'segments' ->> 'explorer')::int   = (v_seg ->> 'explorer')::int
    AND (v_after -> 'segments' ->> 'host')::int   = (v_seg ->> 'host')::int
    AND (v_after -> 'segments' ->> 'both')::int   = (v_seg ->> 'both')::int
    AND (v_after -> 'segments' ->> 'incomplete')::int = (v_seg ->> 'incomplete')::int
    AND (v_after ->> 'total')::int = (v_seg ->> 'people')::int
    AND (v_after ->> 'internal_left_out')::int = (v_seg ->> 'internal')::int,
    'C-03 Data room segments equal admin_people_segments: ' || (v_after -> 'segments')::text || ' vs ' || v_seg::text);
  PERFORM pg_temp.w5_assert(
    (SELECT sum((m ->> 'explorer')::int + (m ->> 'host')::int + (m ->> 'both')::int + (m ->> 'incomplete')::int)
       FROM jsonb_array_elements(v_after -> 'months') m) = (v_after ->> 'total')::int,
    'C-03 monthly new users add up to the total');
  PERFORM pg_temp.w5_assert(
    (SELECT (m ->> 'explorer')::int = 2 FROM jsonb_array_elements(v_after -> 'months') m WHERE m ->> 'month' = '2001-01'),
    'C-03 the two January 2001 explorers are in their own month');

  -- ── C-04 staff and test left out ───────────────────────────────────────────
  PERFORM pg_temp.w5_assert(
    (v_after -> 'segments' ->> 'explorer')::int - (v_before -> 'segments' ->> 'explorer')::int = 3
    AND (v_after -> 'segments' ->> 'host')::int - (v_before -> 'segments' ->> 'host')::int = 1
    AND (v_after ->> 'total')::int - (v_before ->> 'total')::int = 4
    AND (v_after ->> 'internal_left_out')::int - (v_before ->> 'internal_left_out')::int = 1,
    'C-04 the staff sign-up moved only "left out" (explorers +3, hosts +1, total +4, left out +1)');
  v := pg_temp.w5_read(v_admin, 'admin_data_room_funnels') -> 'data';
  PERFORM pg_temp.w5_assert(
    (v -> 'explorer' -> 0 ->> 'count')::int - (v_f_before -> 'explorer' -> 0 ->> 'count')::int = 4
    AND (v -> 'explorer' -> 2 ->> 'count')::int - (v_f_before -> 'explorer' -> 2 ->> 'count')::int = 2,
    'C-04 explorer funnel counts the real sign-ups and deck views only (staff left out)');
  PERFORM pg_temp.w5_assert(
    (SELECT bool_and(x.n <= x.prev) FROM (
       SELECT (s.v ->> 'count')::int AS n,
              COALESCE(lag((s.v ->> 'count')::int) OVER (ORDER BY s.i), (s.v ->> 'count')::int) AS prev
         FROM jsonb_array_elements(v -> 'host') WITH ORDINALITY AS s(v, i)) x),
    'C-04 a funnel never widens');

  -- Tickets: one real buyer, one staff buyer (by email), on a real host's event.
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_host, 'W5 Brand', 'w5-brand-' || v_brand, 'NGN');
  INSERT INTO public.events(id, brand_id, title, slug, status, currency, created_by)
    VALUES (v_event, v_brand, 'W5 Night', 'w5-night-' || v_event, 'draft', 'NGN', v_host);
  INSERT INTO public.ticket_types(id, event_id, name) VALUES (v_type, v_event, 'W5 General');
  INSERT INTO public.orders(id, event_id, buyer_email, total_cents, buyer_total_cents, net_subtotal_cents,
      currency, payment_status, payment_method, source, created_at, confirmed_at,
      list_subtotal_cents, discount_cents, buyer_fees_cents, tax_cents, pricing_source)
  VALUES
    (v_o_real,  v_event, 'w5-buyer@mingla-fixture.org', 104500, 104500, 100000, 'NGN', 'paid', 'online_card',
      'legacy', now() - interval '2 days', now() - interval '2 days', 100000, 0, 4500, 0, 'computed_at_checkout'),
    (v_o_staff, v_event, 'w5-buyer@usemingla.com',      104500, 104500, 100000, 'NGN', 'paid', 'online_card',
      'legacy', now() - interval '2 days', now() - interval '2 days', 100000, 0, 4500, 0, 'computed_at_checkout'),
    (v_o_usd,   v_event, 'w5-dollar@mingla-fixture.org',  1000,   1000,    985, 'USD', 'paid', 'online_card',
      'legacy', now() - interval '2 days', now() - interval '2 days',    985, 0,   15, 0, 'computed_at_checkout');
  INSERT INTO public.tickets(order_id, ticket_type_id, event_id, qr_code, status) VALUES
    (v_o_real,  v_type, v_event, 'w5-qr-real',  'valid'),
    (v_o_staff, v_type, v_event, 'w5-qr-staff', 'valid');
  v := pg_temp.w5_read(v_admin, 'admin_data_room_overview') -> 'data';
  PERFORM pg_temp.w5_assert((v -> 'kpis' ->> 'tickets_30d')::bigint - v_t_before = 1,
    'C-04 a staff buyer''s ticket does not count; the real buyer''s does (+' ||
    ((v -> 'kpis' ->> 'tickets_30d')::bigint - v_t_before) || ')');

  -- ── C-05 retention: too new is NULL, never 0 ───────────────────────────────
  v_ret := pg_temp.w5_read(v_admin, 'admin_data_room_retention') -> 'data';
  v_cells := v_ret -> 'cohorts' -> 'explorer';
  SELECT c INTO v_cell FROM jsonb_array_elements(v_cells) c
   WHERE c ->> 'month' = to_char((now() AT TIME ZONE 'UTC') - interval '1 day', 'YYYY-MM');
  PERFORM pg_temp.w5_assert(v_cell IS NOT NULL, 'C-05 the recent explorer cohort is listed');
  PERFORM pg_temp.w5_assert(
    jsonb_typeof(v_cell -> 'd7') = 'null' AND jsonb_typeof(v_cell -> 'd30') = 'null'
    AND jsonb_typeof(v_cell -> 'd90') = 'null',
    'C-05 a cohort too new to measure is NULL, not 0: ' || v_cell::text);
  SELECT c INTO v_cell FROM jsonb_array_elements(v_cells) c WHERE c ->> 'month' = '2001-01';
  PERFORM pg_temp.w5_assert(
    (v_cell ->> 'people')::int = 2
    AND (v_cell ->> 'd7')::numeric = 50
    AND (v_cell ->> 'd30')::numeric = 0
    AND jsonb_typeof(v_cell -> 'd30') = 'number',
    'C-05 an old cohort: one of two came back in days 7..13 (D7 50%), none at D30 (0, measured): ' || v_cell::text);
  PERFORM pg_temp.w5_assert(
    (v_ret -> 'overall' -> 'explorer' -> 'd7' ->> 'eligible')::int >= 2,
    'C-05 the overall D7 counts only people whose window has passed');

  -- ── C-06 money: no sums across currencies ─────────────────────────────────
  INSERT INTO public.fx_rate_snapshots (id, provider, base_currency_code,
    provider_updated_at, provider_next_update_at, provider_eol_at, fetched_at,
    stale_after, expires_at, payload_sha256, status)
  VALUES (v_snap, 'exchange_rate_api_open_v6', 'USD', now() - interval '40 days', now() - interval '39 days',
    now() - interval '38 days', now() - interval '40 days', now() - interval '39 days', now() - interval '38 days',
    'issue-4130-w5', 'superseded');
  INSERT INTO public.fx_rates (snapshot_id, currency_code, rate_per_base) VALUES (v_snap, 'NGN', 1000), (v_snap, 'USD', 1);
  v_m_after := pg_temp.w5_read(v_admin, 'admin_data_room_money') -> 'data';
  SELECT COALESCE(sum((r ->> 'cents')::bigint) FILTER (WHERE r ->> 'currency' = 'NGN'), 0),
         COALESCE(sum((r ->> 'cents')::bigint) FILTER (WHERE r ->> 'currency' = 'USD'), 0)
    INTO v_ngn, v_usd
    FROM jsonb_array_elements(v_m_after -> 'last_30d') r WHERE r ->> 'kind' = 'buyers_paid';
  SELECT v_ngn - COALESCE(sum((r ->> 'cents')::bigint) FILTER (WHERE r ->> 'currency' = 'NGN'), 0),
         v_usd - COALESCE(sum((r ->> 'cents')::bigint) FILTER (WHERE r ->> 'currency' = 'USD'), 0)
    INTO v_ngn, v_usd
    FROM jsonb_array_elements(v_m_before -> 'last_30d') r WHERE r ->> 'kind' = 'buyers_paid';
  PERFORM pg_temp.w5_assert(v_ngn = 209000 AND v_usd = 1000,
    'C-06 naira and dollars stay in their own rows (NGN +' || v_ngn || ', USD +' || v_usd || ')');
  PERFORM pg_temp.w5_assert(
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_m_after -> 'last_30d') r
                 WHERE NULLIF(r ->> 'currency', '') IS NULL)
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_m_after -> 'weekly') r
                     WHERE NULLIF(r ->> 'currency', '') IS NULL),
    'C-06 every money row names exactly one currency');
  SELECT sum((r ->> 'usd_cents')::bigint) INTO v_ngn_usd
    FROM jsonb_array_elements(v_m_after -> 'last_30d') r WHERE r ->> 'kind' = 'buyers_paid';
  PERFORM pg_temp.w5_assert(
    (v_m_after -> 'last_30d_usd' ->> 'buyers_paid')::bigint = v_ngn_usd,
    'C-06 the only cross-currency figure is the sum of each currency''s US dollars');
  SELECT (r ->> 'usd_cents')::bigint INTO v_usd_usd
    FROM jsonb_array_elements(v_m_after -> 'last_30d') r WHERE r ->> 'kind' = 'buyers_paid' AND r ->> 'currency' = 'NGN';
  PERFORM pg_temp.w5_assert(v_usd_usd IS NOT NULL AND v_usd_usd >= 209,
    'C-06 naira converts at its own-day rate (209,000 kobo at 1,000 per USD is at least 209 US cents)');

  -- ── C-07 snapshot ──────────────────────────────────────────────────────────
  PERFORM pg_temp.w5_assert(public.analytics_daily_snapshot_refresh() = 7, 'C-07 the writer stores seven sections');
  PERFORM pg_temp.w5_assert(public.analytics_daily_snapshot_refresh() = 7, 'C-07 a second run the same day works');
  SELECT count(*) INTO v_n FROM public.analytics_daily_snapshot
   WHERE snapshot_date = (now() AT TIME ZONE 'UTC')::date;
  PERFORM pg_temp.w5_assert(v_n = 7, 'C-07 a re-run replaces the day''s rows (7, not 14)');
  v := pg_temp.w5_read(v_admin, 'admin_data_room_users');
  PERFORM pg_temp.w5_assert(v ->> 'source' = 'snapshot'
      AND v ->> 'snapshot_date' = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
      AND (v -> 'data' ->> 'total')::int = (v_after ->> 'total')::int,
    'C-07 once tonight''s snapshot exists, reads come from it');
  v := pg_temp.w5_read(v_admin, 'admin_data_room_snapshot_dates');
  PERFORM pg_temp.w5_assert(v ? to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), 'C-07 the stored day is listed');
  v_state := pg_temp.w5_refused(v_admin, 'SELECT public.admin_data_room_users(DATE ''2001-01-01'')');
  PERFORM pg_temp.w5_assert(v_state = 'P0002', 'C-07 a day with no snapshot is an error, not zeros');
END
$main$;
ROLLBACK;
