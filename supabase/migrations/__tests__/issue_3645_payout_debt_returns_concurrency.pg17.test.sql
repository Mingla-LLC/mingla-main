-- Issue #3645 bundle 2d — real two-session PostgreSQL 17 regressions for the
-- payout debt hand-back. Fixtures are committed (dblink sessions must see
-- them) in an isolated UUID namespace; payout rows are append-only, so they
-- stay in this suite-owned database.
\set ON_ERROR_STOP on
\getenv issue3645_2d_pw PGPASSWORD
CREATE SCHEMA issue_3645_2d_cc;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA issue_3645_2d_cc;
SELECT n.nspname AS issue3645_2d_dblink_schema
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'dblink' \gset
SET search_path = public, :"issue3645_2d_dblink_schema";
CREATE TABLE issue_3645_2d_cc.conn AS
SELECT format('host=127.0.0.1 port=%s dbname=%I user=%I password=%s',
  current_setting('port'), current_database(), current_user, :'issue3645_2d_pw') AS conn;

-- One brand per scenario, so a debt reopened in one cannot be withheld in another.
CREATE FUNCTION pg_temp.uid(p_kind integer, p_brand integer, p_n integer) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT ('3645d000-' || lpad(p_kind::text, 4, '0') || '-4000-8000-'
    || lpad((p_brand * 1000 + p_n)::text, 12, '0'))::uuid
$$;

CREATE FUNCTION pg_temp.brand(p_b integer) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_owner uuid := pg_temp.uid(1, p_b, 0);
  v_brand uuid := pg_temp.uid(2, p_b, 0);
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'issue-3645-2d-' || p_b || '@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 2d ' || p_b, 'issue-3645-2d-' || p_b,
    'stripe', 'US', 'USD', 'USD', timestamptz '2020-01-01 00:00:00+00'
  );
  INSERT INTO public.venue_listings(
    id, brand_id, slug, name, lat, lng, venue_category, claim_status
  ) VALUES (
    pg_temp.uid(3, p_b, 0), v_brand, 'issue36452d' || p_b, 'Issue 3645 2d stay ' || p_b,
    40.8, -74.1, 'stay', 'verified'
  );
  INSERT INTO public.stay_settings(
    venue_id, brand_id, property_kind, timezone, default_booking_mode, booking_state
  ) VALUES (pg_temp.uid(3, p_b, 0), v_brand, 'hotel', 'UTC', 'instant', 'active');
  RETURN v_brand;
END
$$;

-- A paid stay line of brand p_b (10450 charged, 450 fee), attached by the
-- real dark sweep, which withholds the brand's open debt: net 10000 − debt.
CREATE FUNCTION pg_temp.stay(p_b integer, p_n integer) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_now constant timestamptz := timestamptz '2026-10-21 12:00:00+00';
  v_group uuid := pg_temp.uid(4, p_b, p_n);
  v_line uuid := pg_temp.uid(5, p_b, p_n);
  v_attempt uuid := pg_temp.uid(6, p_b, p_n);
  v_release uuid;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.stay_reservation_groups(
    id, public_reference, quote_id, actor_key_hash, venue_id, brand_id,
    currency_code, mode, state, guest_snapshot, source_subtotal_minor,
    fee_total_minor, tax_total_minor, total_minor, idempotency_key, request_hash
  ) VALUES (
    v_group, 'ST-36452' || lpad((p_b * 1000 + p_n)::text, 15, '0'), gen_random_uuid(),
    repeat('a', 64), pg_temp.uid(3, p_b, 0), pg_temp.uid(2, p_b, 0), 'USD',
    'instant', 'confirmed', '{}'::jsonb, 10000, 450, 0, 10450,
    'issue-3645-2d-group-' || p_b || '-' || p_n, repeat('b', 64)
  );
  INSERT INTO public.stay_reservation_lines(
    id, group_id, quote_line_id, offering_id, kind, state, room_check_in,
    room_check_out, room_quantity, adults, children, base_minor, fee_minor,
    tax_minor, total_minor, offering_snapshot, price_snapshot, policy_snapshot
  ) VALUES (
    v_line, v_group, gen_random_uuid(), gen_random_uuid(), 'room', 'confirmed',
    (v_now + interval '8 days')::date + p_n, (v_now + interval '10 days')::date + p_n,
    1, 2, 0, 10000, 450, 0, 10450, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  );
  INSERT INTO public.stay_payment_attempts(
    id, group_id, provider, attempt_ordinal, amount_minor, currency_code,
    application_fee_minor, provider_fee_minor, state, provider_payment_ref,
    idempotency_key, request_hash, succeeded_at
  ) VALUES (
    v_attempt, v_group, 'stripe', 1, 10450, 'USD', 450, 300, 'succeeded',
    'pi_3645d_' || p_b || '_' || p_n, 'issue-3645-2d-attempt-' || p_b || '-' || p_n,
    repeat('c', 64), v_now - interval '25 hours'
  );
  INSERT INTO public.stay_payout_line_snapshots(
    reservation_line_id, payment_attempt_id, platform_fee_minor, provider_fee_minor
  ) VALUES (v_line, v_attempt, 450, 300);
  SET LOCAL session_replication_role = origin;

  PERFORM public.run_stay_payout_release_dark_sweep(v_now);
  SELECT item.release_id INTO v_release
  FROM public.payout_release_items item
  WHERE item.source_type = 'stay_reservation' AND item.source_id = v_line;
  IF v_release IS NULL THEN
    RAISE EXCEPTION 'fixture: stay %/% did not attach', p_b, p_n;
  END IF;
  RETURN v_release;
END
$$;

-- A paid-out origin release for brand p_b that debts hang off.
CREATE FUNCTION pg_temp.origin(p_b integer, p_n integer, p_cash integer) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid := pg_temp.uid(7, p_b, p_n);
BEGIN
  INSERT INTO public.brand_payout_releases(
    id, brand_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, net_release_cents,
    organiser_cash_delivered_cents, status, released_at
  ) VALUES (
    v_id, pg_temp.uid(2, p_b, 0), 'issue-3645-2d-origin-' || p_b || '-' || p_n,
    'order', 'stripe', 'usd', timestamptz '2026-09-01 00:00:00+00',
    timestamptz '2026-09-02 00:00:00+00', p_cash, p_cash, p_cash, 'released',
    timestamptz '2026-09-02 00:00:00+00'
  );
  RETURN v_id;
END
$$;

-- An open permanent debt (kind post_release_refund) of p_principal.
CREATE FUNCTION pg_temp.debt(p_b integer, p_n integer, p_principal integer, p_opened timestamptz)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.organiser_payout_debts(
    brand_id, currency, origin_release_id, kind, principal_cents,
    idempotency_key, opened_at
  ) VALUES (
    pg_temp.uid(2, p_b, 0), 'usd', pg_temp.origin(p_b, p_n, p_principal),
    'post_release_refund', p_principal, 'issue-3645-2d-debt-' || p_b || '-' || p_n,
    p_opened
  ) RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- An open postponement debt of p_cash maturing at p_anchor + 3 days.
CREATE FUNCTION pg_temp.temp_debt(p_b integer, p_n integer, p_cash integer, p_anchor timestamptz)
RETURNS uuid LANGUAGE sql AS $$
  SELECT public.open_post_release_postponement_debt(
    pg_temp.origin(p_b, p_n, p_cash), p_anchor
  )
$$;

CREATE FUNCTION pg_temp.dispute(
  p_b integer, p_n integer, p_ref text, p_amount integer, p_status text
) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.issue_1389_record_stay_dispute(
    'evt_' || p_ref || '_' || p_status, 'charge.dispute.updated',
    'pi_3645d_' || p_b || '_' || p_n, p_ref, p_amount, 'USD', p_status
  )
$$;

CREATE FUNCTION pg_temp.rel(p_release uuid)
RETURNS public.brand_payout_releases
LANGUAGE sql STABLE AS $$
  SELECT * FROM public.brand_payout_releases WHERE id = p_release
$$;

CREATE FUNCTION pg_temp.d(p_debt uuid)
RETURNS public.organiser_payout_debts
LANGUAGE sql STABLE AS $$
  SELECT * FROM public.organiser_payout_debts WHERE id = p_debt
$$;

CREATE FUNCTION pg_temp.app(p_debt uuid, p_release uuid)
RETURNS public.payout_debt_applications
LANGUAGE sql STABLE AS $$
  SELECT * FROM public.payout_debt_applications
  WHERE debt_id = p_debt AND release_id = p_release
$$;

CREATE FUNCTION pg_temp.returned(p_debt uuid, p_release uuid, p_reason text)
RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(amount_cents), 0)::integer
  FROM public.payout_debt_application_returns
  WHERE debt_id = p_debt AND release_id = p_release AND reason = p_reason
$$;

CREATE TABLE issue_3645_2d_cc.ids(k text PRIMARY KEY, v uuid NOT NULL);

-- Fixtures, committed. The stay rows go in with triggers off (pg_temp.stay
-- does that); nothing here updates them afterwards, so their missing quote
-- and offering rows are never re-checked.
DO $fixtures$
DECLARE
  v_r uuid;
BEGIN
  -- C1: an open debt of 30000; the first release withholds 10000 of it.
  PERFORM pg_temp.brand(21);
  INSERT INTO issue_3645_2d_cc.ids VALUES
    ('c1_debt', pg_temp.debt(21, 1, 30000, timestamptz '2026-10-01 00:00:00+00'));
  INSERT INTO issue_3645_2d_cc.ids VALUES ('c1_r1', pg_temp.stay(21, 1));

  -- C2: a postponement debt withheld in full from a release that a hold has
  -- left short (the hold is recorded, not settled yet).
  PERFORM pg_temp.brand(22);
  INSERT INTO issue_3645_2d_cc.ids VALUES
    ('c2_temp', pg_temp.temp_debt(22, 1, 2000, timestamptz '2026-12-01 00:00:00+00'));
  v_r := pg_temp.stay(22, 1);
  INSERT INTO issue_3645_2d_cc.ids VALUES ('c2_r', v_r);
  INSERT INTO public.stay_payout_release_holds(
    release_id, line_id, kind, refunded_cents, disputed_cents, net_hold_cents,
    provider_ref, idempotency_key
  ) VALUES (
    v_r, pg_temp.uid(5, 22, 1), 'dispute_opened', 0, 9000, 9000, 'dp_3645d_22',
    'issue-3645-2d-hold-22'
  );

  -- C3: a postponement debt that is due, withheld from an unpaid release.
  PERFORM pg_temp.brand(23);
  INSERT INTO issue_3645_2d_cc.ids VALUES
    ('c3_temp', pg_temp.temp_debt(23, 1, 2000, timestamptz '2026-10-25 00:00:00+00'));
  INSERT INTO issue_3645_2d_cc.ids VALUES ('c3_r', pg_temp.stay(23, 1));
END
$fixtures$;

CREATE FUNCTION pg_temp.cc(p_k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v FROM issue_3645_2d_cc.ids WHERE k = p_k $$;

CREATE FUNCTION pg_temp.conn() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT conn FROM issue_3645_2d_cc.conn $$;

-- C1: a settle that finds nothing short must not lock the brand's debts, or
-- an attach running at the same time skips them (SKIP LOCKED) and pays the
-- host in full.
DO $c1$
DECLARE
  v_r2 uuid;
  v_app public.payout_debt_applications;
BEGIN
  PERFORM dblink_connect('issue3645_c1', pg_temp.conn());
  PERFORM dblink_send_query('issue3645_c1', format($q$
    DO $do$ BEGIN
      PERFORM public.issue_3645_settle_release_projection(%L::uuid);
      PERFORM pg_sleep(3);
    END $do$
  $q$, pg_temp.cc('c1_r1')));
  PERFORM pg_sleep(0.5);
  IF dblink_is_busy('issue3645_c1') <> 1 THEN
    RAISE EXCEPTION 'C1 setup: the settle session finished too early';
  END IF;
  v_r2 := pg_temp.stay(21, 2);
  PERFORM * FROM dblink_get_result('issue3645_c1') AS t(status text);
  PERFORM dblink_disconnect('issue3645_c1');
  SELECT * INTO v_app FROM public.payout_debt_applications
  WHERE debt_id = pg_temp.cc('c1_debt') AND release_id = v_r2;
  IF v_app.amount_cents IS DISTINCT FROM 10000
     OR (SELECT net_release_cents FROM public.brand_payout_releases WHERE id = v_r2) <> 0 THEN
    RAISE EXCEPTION 'C1 FAIL: the attach did not withhold the debt while a settle ran (applied %)',
      v_app.amount_cents;
  END IF;
  RAISE NOTICE 'C1 PASS: an attach withholds debt while another release settles';
END
$c1$;

-- C2: settle (release, then debts) and a conversion (debt, then a row on the
-- same release) used to deadlock. The conversion now key-shares the release
-- first, so it waits instead.
DO $c2$
DECLARE
  v_err_a text;
  v_err_b text;
  v_app public.payout_debt_applications;
BEGIN
  PERFORM dblink_connect('issue3645_c2a', pg_temp.conn());
  PERFORM dblink_connect('issue3645_c2b', pg_temp.conn());
  PERFORM dblink_send_query('issue3645_c2a', format($q$
    DO $do$ BEGIN
      PERFORM 1 FROM public.brand_payout_releases WHERE id = %1$L::uuid FOR UPDATE;
      PERFORM pg_sleep(2);
      PERFORM public.issue_3645_return_unrecovered_release_debt(%1$L::uuid);
    END $do$
  $q$, pg_temp.cc('c2_r')));
  PERFORM pg_sleep(0.5);
  PERFORM dblink_send_query('issue3645_c2b', format($q$
    SELECT public.convert_postponement_debt_to_permanent(
      %L::uuid, 'post_release_refund', 500, now())::text
  $q$, pg_temp.uid(7, 22, 1)));
  PERFORM * FROM dblink_get_result('issue3645_c2a', false) AS t(r text);
  v_err_a := nullif(dblink_error_message('issue3645_c2a'), 'OK');
  PERFORM * FROM dblink_get_result('issue3645_c2b', false) AS t(r text);
  v_err_b := nullif(dblink_error_message('issue3645_c2b'), 'OK');
  PERFORM dblink_disconnect('issue3645_c2a');
  PERFORM dblink_disconnect('issue3645_c2b');
  IF v_err_a IS NOT NULL OR v_err_b IS NOT NULL THEN
    RAISE EXCEPTION 'C2 FAIL: settle % / conversion %', v_err_a, v_err_b;
  END IF;
  SELECT * INTO v_app FROM public.payout_debt_applications
  WHERE debt_id = pg_temp.cc('c2_temp') AND release_id = pg_temp.cc('c2_r');
  IF public.issue_3645_application_returned_cents(v_app.id) <> 1000
     OR v_app.converted_cents <> 500
     OR (SELECT recovered_cents FROM public.organiser_payout_debts WHERE id = pg_temp.cc('c2_temp')) <> 500 THEN
    RAISE EXCEPTION 'C2 FAIL: returned % converted %',
      public.issue_3645_application_returned_cents(v_app.id), v_app.converted_cents;
  END IF;
  RAISE NOTICE 'C2 PASS: settle and a conversion on the same debt both complete';
END
$c2$;

-- C3: maturity never waits on a release someone else holds: it leaves the
-- whole debt for the next tick, which hands it back through net.
DO $c3$
DECLARE
  v_debt public.organiser_payout_debts;
BEGIN
  PERFORM dblink_connect('issue3645_c3', pg_temp.conn());
  PERFORM dblink_send_query('issue3645_c3', format($q$
    DO $do$ BEGIN
      PERFORM 1 FROM public.brand_payout_releases WHERE id = %L::uuid FOR UPDATE;
      PERFORM pg_sleep(2);
    END $do$
  $q$, pg_temp.cc('c3_r')));
  PERFORM pg_sleep(0.5);
  PERFORM public.mature_postponement_debts(timestamptz '2026-10-29 00:00:00+00');
  SELECT * INTO v_debt FROM public.organiser_payout_debts WHERE id = pg_temp.cc('c3_temp');
  IF v_debt.status <> 'open' OR v_debt.recovered_cents <> 2000
     OR EXISTS (SELECT 1 FROM public.payout_debt_application_returns WHERE debt_id = v_debt.id) THEN
    RAISE EXCEPTION 'C3 FAIL: maturity touched a debt whose release was busy: %', row_to_json(v_debt);
  END IF;
  PERFORM * FROM dblink_get_result('issue3645_c3') AS t(status text);
  PERFORM dblink_disconnect('issue3645_c3');
END
$c3$;

DO $c3b$
BEGIN
  PERFORM public.mature_postponement_debts(timestamptz '2026-10-29 01:00:00+00');
  IF (SELECT coalesce(sum(amount_cents), 0) FROM public.payout_debt_application_returns
      WHERE debt_id = pg_temp.cc('c3_temp') AND reason = 'matured') <> 2000
     OR (SELECT net_release_cents FROM public.brand_payout_releases WHERE id = pg_temp.cc('c3_r')) <> 10000 THEN
    RAISE EXCEPTION 'C3 FAIL: the next tick did not hand the debt back';
  END IF;
  RAISE NOTICE 'C3 PASS: a busy release defers maturity a tick, untouched';
END
$c3b$;

\echo 'issue #3645 2d two-session payout debt paths passed (C1-C3)'
