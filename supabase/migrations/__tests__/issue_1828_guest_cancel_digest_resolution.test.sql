-- ===========================================================================
-- Issue #1828 — the three digest() call sites, EXECUTED.
--
-- This suite exists because the previous one did not. Every prior assertion
-- about these functions read `pg_get_functiondef()` and matched SOURCE TEXT,
-- and source text is byte-identical whether or not `digest` can resolve. That
-- is how a P1 — a guest cannot self-cancel a venue reservation — shipped to
-- production behind green CI. So: nothing here reads a function's source to
-- decide whether it works. Every group CALLS the function.
--
-- Runs inside ONE transaction and ROLLBACKs — it leaves no rows behind, and
-- the SAVEPOINT in group F restores the shipped definitions before the end.
--
-- FAILS-ON-REVERT is not asserted by hand-waving: group F takes the LIVE
-- definition of each function, strips exactly `extensions.` off the digest
-- call, re-creates it, and re-runs the same calls that passed in groups A–D.
-- Each one must come back 42883. Then it rolls back to the savepoint and
-- proves the same calls pass again. Same transaction, same inputs, one
-- variable: the qualifier.
-- ===========================================================================
\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures. Explicit ids and the REAL column sets — brands, venue_listings and
-- reservations all carry NOT NULLs and cross-table triggers
-- (_orch1255_venue_belongs_to_brand) that a loose fixture trips over. Shape
-- mirrors #1790's proven seed rather than inventing one.
--
-- TWO identical reservations are seeded on purpose: res1 carries the happy
-- path in groups A–B, res2 is held untouched so group F can fire the exact
-- same call against a virgin row and attribute the difference to the revert
-- alone rather than to res1 already being cancelled.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t1828_fx (k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE t1828_tok (k text PRIMARY KEY, v text);

DO $seed$
DECLARE
  v_user  uuid := '00000000-1828-4000-8000-000000000001';
  v_brand uuid := '00000000-1828-4000-8000-000000000002';
  v_venue uuid := '00000000-1828-4000-8000-000000000003';
  v_res1  uuid; v_res2 uuid;
  v_ses1  uuid; v_ses2 uuid;
  v_audit uuid;
  v_tok1  text := 'issue-1828-guest-token-one';
  v_tok2  text := 'issue-1828-guest-token-two';
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', 'owner-1828@example.test', now(), now());
  INSERT INTO public.creator_accounts (id, created_at) VALUES (v_user, now());

  INSERT INTO public.brands (id, account_id, name, slug, default_currency,
                             payment_provider, created_at, updated_at)
  VALUES (v_brand, v_user, 'Issue 1828 Brand', 'issue1828brand', 'GBP',
          'stripe', now(), now());

  INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng,
                                     venue_category, claim_status)
  VALUES (v_venue, v_brand, 'trattoria1828', 'The Trattoria', 51.51, -0.13,
          'restaurant', 'verified');

  -- fee_refundable + a 24h cutoff are what make the cancellation REFUND-
  -- ELIGIBLE. Without them the function still cancels but returns a NULL
  -- refund, and group B would be asserting nothing.
  INSERT INTO public.venue_reservation_settings
    (brand_id, venue_id, reservations_enabled, fee_enabled, fee_refundable,
     cancel_cutoff_hours)
  VALUES (v_brand, v_venue, true, true, true, 24);

  -- reserved_for is 72h out, comfortably inside the 24h cutoff.
  INSERT INTO public.reservations
    (brand_id, venue_id, reserved_for, party_size, status, payment_status,
     source, created_via, guest_name, guest_email, guest_phone_e164)
  VALUES (v_brand, v_venue, now() + interval '72 hours', 2, 'confirmed', 'paid',
          'mingla', 'guest', 'Ada Guest', 'ada-1828@example.test', '+12015550199')
  RETURNING id INTO v_res1;

  INSERT INTO public.reservations
    (brand_id, venue_id, reserved_for, party_size, status, payment_status,
     source, created_via, guest_name, guest_email, guest_phone_e164)
  VALUES (v_brand, v_venue, now() + interval '72 hours', 2, 'confirmed', 'paid',
          'mingla', 'guest', 'Bo Guest', 'bo-1828@example.test', '+12015550188')
  RETURNING id INTO v_res2;

  -- The token hash is minted the way the checkout edge function mints it:
  -- 'v1:' || sha256 hex. The fixture qualifies `extensions.digest` because the
  -- fixture is NOT the thing under test — the FUNCTIONS are. If they compute a
  -- different hash than this, the lookup misses and every group fails.
  INSERT INTO public.reservation_checkout_sessions
    (brand_id, venue_id, reservation_id, reserved_for, party_size,
     buyer_name, buyer_email, buyer_phone_e164, amount_cents, currency,
     created_via, status, guest_cancel_token, guest_cancel_token_hash,
     application_fee_amount_cents, stripe_payment_intent_id, stripe_account_id)
  VALUES (v_brand, v_venue, v_res1, now() + interval '72 hours', 2,
          'Ada Guest', 'ada-1828@example.test', '+12015550199', 5000, 'GBP',
          'web', 'completed', v_tok1,
          'v1:' || encode(extensions.digest(v_tok1, 'sha256'), 'hex'),
          500, 'pi_issue1828_one', 'acct_issue1828')
  RETURNING id INTO v_ses1;

  INSERT INTO public.reservation_checkout_sessions
    (brand_id, venue_id, reservation_id, reserved_for, party_size,
     buyer_name, buyer_email, buyer_phone_e164, amount_cents, currency,
     created_via, status, guest_cancel_token, guest_cancel_token_hash,
     application_fee_amount_cents, stripe_payment_intent_id, stripe_account_id)
  VALUES (v_brand, v_venue, v_res2, now() + interval '72 hours', 2,
          'Bo Guest', 'bo-1828@example.test', '+12015550188', 5000, 'GBP',
          'web', 'completed', v_tok2,
          'v1:' || encode(extensions.digest(v_tok2, 'sha256'), 'hex'),
          500, 'pi_issue1828_two', 'acct_issue1828')
  RETURNING id INTO v_ses2;

  INSERT INTO public.audit_log
    (user_id, brand_id, action, target_type, target_id, before, after,
     ip, user_agent)
  VALUES (v_user, v_brand, 'issue_1828_probe', 'reservation', v_res1::text,
          jsonb_build_object('email', 'ada-1828@example.test', 'party_size', 2),
          jsonb_build_object('email', 'ada-1828@example.test', 'status', 'confirmed'),
          '203.0.113.7', 'Mozilla/5.0 (issue-1828)')
  RETURNING id INTO v_audit;

  INSERT INTO t1828_fx VALUES
    ('user', v_user), ('brand', v_brand), ('venue', v_venue),
    ('res1', v_res1), ('res2', v_res2),
    ('ses1', v_ses1), ('ses2', v_ses2), ('audit', v_audit);
  INSERT INTO t1828_tok VALUES ('tok1', v_tok1), ('tok2', v_tok2);
END $seed$;

CREATE OR REPLACE FUNCTION pg_temp.fx(p_k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v FROM t1828_fx WHERE k = p_k $$;

CREATE OR REPLACE FUNCTION pg_temp.tok(p_k text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT v FROM t1828_tok WHERE k = p_k $$;

-- Returns 'SQLSTATE:MESSAGE' for whatever a call lands on, or '<ok>' when it
-- returns normally. Every group compares against this rather than letting the
-- error escape, so a WRONG error can never be mistaken for the right one.
CREATE OR REPLACE FUNCTION pg_temp.landing_prepare(p_res uuid, p_tok text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.pg_prepare_guest_venue_cancellation_refund(p_res, p_tok);
  RETURN '<ok>';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.landing_summary(p_res uuid, p_tok text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.pg_guest_venue_refund_summary(p_res, p_tok);
  RETURN '<ok>';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.landing_anonymize(p_user uuid)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.anonymize_user_audit_log(p_user, 'issue-1828-salt');
  RETURN '<ok>';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;

-- ===========================================================================
-- A — THE P1 ITSELF: a guest self-cancels a venue reservation.
--
-- This is the call a real guest's "Cancel reservation" tap makes. On the
-- shipped-before-#1828 database it dies at the FIRST statement with
--   42883 function digest(text, unknown) does not exist
-- because the pinned search_path is `public, pg_temp` and pgcrypto lives in
-- `extensions`. Nothing is written, nothing is refunded, and the guest is
-- stuck with a booking they cannot get out of.
-- ===========================================================================
DO $group_a$
DECLARE
  v_result jsonb;
  v_status text;
  v_refund public.source_refunds%ROWTYPE;
  v_allocations integer;
  v_events integer;
BEGIN
  v_result := public.pg_prepare_guest_venue_cancellation_refund(
    pg_temp.fx('res1'), pg_temp.tok('tok1'));

  IF v_result IS NULL OR (v_result ->> 'cancelled') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'A-01 guest cancel did not report cancelled: %', v_result;
  END IF;

  SELECT status INTO v_status FROM public.reservations WHERE id = pg_temp.fx('res1');
  IF v_status <> 'cancelled_by_guest' THEN
    RAISE EXCEPTION 'A-02 reservation status is % (expected cancelled_by_guest)', v_status;
  END IF;

  -- A-03  The refund the guest is owed actually exists, on the eligible path.
  --       A cancel that produced no refund row would still satisfy A-01/A-02
  --       and would still be a money bug.
  SELECT * INTO v_refund FROM public.source_refunds
  WHERE source_type = 'venue_reservation'
    AND source_id = pg_temp.fx('ses1')
    AND refund_kind = 'venue_eligible_cancel';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A-03 no source_refunds row was prepared for the eligible cancel';
  END IF;
  IF v_refund.buyer_refund_requested_cents <> 5000
     OR v_refund.original_application_fee_cents <> 500
     OR v_refund.fee_reversal_required_cents <> 500
     OR v_refund.organizer_refund_liability_cents <> 4500
     OR v_refund.platform_fee_absorption_cents <> 500
     OR v_refund.currency <> 'GBP'
     OR v_refund.requested_by_type <> 'guest' THEN
    RAISE EXCEPTION 'A-04 refund arithmetic drifted: buyer=% fee=% required=% organizer=% platform=% ccy=% by=%',
      v_refund.buyer_refund_requested_cents, v_refund.original_application_fee_cents,
      v_refund.fee_reversal_required_cents, v_refund.organizer_refund_liability_cents,
      v_refund.platform_fee_absorption_cents, v_refund.currency, v_refund.requested_by_type;
  END IF;

  -- A-05  The ledger legs and the event the refund worker keys off.
  SELECT count(*) INTO v_allocations
  FROM public.source_refund_ledger_allocations WHERE refund_id = v_refund.id;
  IF v_allocations <> 3 THEN
    RAISE EXCEPTION 'A-05 expected 3 ledger allocations, found %', v_allocations;
  END IF;

  SELECT count(*) INTO v_events
  FROM public.source_refund_events
  WHERE refund_id = v_refund.id AND event_type = 'requested' AND actor_type = 'guest';
  IF v_events <> 1 THEN
    RAISE EXCEPTION 'A-06 expected 1 guest-requested refund event, found %', v_events;
  END IF;

  -- A-07  The guest is TOLD. The reservation trigger enqueues the cancellation
  --       notice; a silent cancel is a support ticket either way.
  IF NOT EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE category_key = 'buyer_reservation_cancelled'
      AND payload ->> 'reservation_id' = pg_temp.fx('res1')::text
  ) THEN
    RAISE EXCEPTION 'A-07 no buyer_reservation_cancelled notification was enqueued';
  END IF;
END $group_a$;

-- ===========================================================================
-- B — the guest's refund summary read, and the proof that the hash is
--     LOAD-BEARING rather than incidentally satisfied.
-- ===========================================================================
DO $group_b$
DECLARE
  v_summary jsonb;
  v_landing text;
BEGIN
  v_summary := public.pg_guest_venue_refund_summary(
    pg_temp.fx('res1'), pg_temp.tok('tok1'));
  IF v_summary IS NULL OR (v_summary ->> 'refund_id') IS NULL THEN
    RAISE EXCEPTION 'B-01 guest refund summary came back empty: %', v_summary;
  END IF;
  IF (v_summary ->> 'refund_id') <> (
       SELECT id::text FROM public.source_refunds
       WHERE source_id = pg_temp.fx('ses1') AND refund_kind = 'venue_eligible_cancel')
  THEN
    RAISE EXCEPTION 'B-02 summary returned a different refund than the cancel created';
  END IF;
  -- The number the guest is actually shown.
  IF (v_summary ->> 'amount_cents') <> '5000' OR (v_summary ->> 'currency') <> 'GBP' THEN
    RAISE EXCEPTION 'B-02b summary reports % %, expected 5000 GBP',
      v_summary ->> 'amount_cents', v_summary ->> 'currency';
  END IF;

  -- B-03  A WRONG token must not resolve. If the digest comparison were
  --       short-circuited or the hash column ignored, this would pass with a
  --       summary and the whole suite would be green for the wrong reason.
  v_landing := pg_temp.landing_summary(pg_temp.fx('res1'), 'issue-1828-wrong-token');
  IF v_landing <> 'P0001:reservation_not_found' THEN
    RAISE EXCEPTION 'B-03 a wrong guest token landed on % (expected reservation_not_found)', v_landing;
  END IF;

  -- B-04  Same for the cancel path: a wrong token cannot cancel someone else's
  --       booking. res2 is still open, so a bypass here would be visible.
  v_landing := pg_temp.landing_prepare(pg_temp.fx('res2'), 'issue-1828-wrong-token');
  IF v_landing <> 'P0001:reservation_not_found' THEN
    RAISE EXCEPTION 'B-04 a wrong guest token landed on % (expected reservation_not_found)', v_landing;
  END IF;
  IF (SELECT status FROM public.reservations WHERE id = pg_temp.fx('res2'))
     <> 'confirmed' THEN
    RAISE EXCEPTION 'B-05 res2 was mutated by a call with the wrong token';
  END IF;
END $group_b$;

-- ===========================================================================
-- C — anonymize_user_audit_log: GDPR erasure, executed.
-- ===========================================================================
DO $group_c$
DECLARE
  v_rows integer;
  v_row  public.audit_log%ROWTYPE;
BEGIN
  v_rows := public.anonymize_user_audit_log(pg_temp.fx('user'), 'issue-1828-salt');
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'C-01 anonymize reported % rows (expected 1)', v_rows;
  END IF;

  SELECT * INTO v_row FROM public.audit_log WHERE id = pg_temp.fx('audit');
  IF v_row.user_id IS NOT NULL OR v_row.ip IS NOT NULL OR v_row.user_agent IS NOT NULL THEN
    RAISE EXCEPTION 'C-02 identifying columns survived erasure';
  END IF;
  IF (v_row.before ->> 'email') <> '[REDACTED-GDPR]'
     OR (v_row.after ->> 'email') <> '[REDACTED-GDPR]' THEN
    RAISE EXCEPTION 'C-03 the PII key was not redacted: before=% after=%',
      v_row.before, v_row.after;
  END IF;
  -- C-04  Field-level redaction, not deletion: the non-PII keys and the row
  --       itself must survive (legal retention).
  IF (v_row.before ->> 'party_size') <> '2' OR v_row.action <> 'issue_1828_probe' THEN
    RAISE EXCEPTION 'C-04 erasure destroyed retained fields: %', v_row.before;
  END IF;
END $group_c$;

-- ===========================================================================
-- D — the class probe is clean on the applied schema.
--     (The dedicated class suite is
--      issue_1828_extension_call_qualification.test.sql; this is the local
--      restatement so group F can show it flip.)
-- ===========================================================================
DO $group_d$
DECLARE v_offenders text;
BEGIN
  SELECT string_agg(function_signature || ' -> ' || unqualified_routine, ', '
                    ORDER BY function_signature)
    INTO v_offenders
  FROM public.audit_unqualified_extension_calls();
  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION 'D-01 unqualified extension calls present: %', v_offenders;
  END IF;
END $group_d$;

-- ===========================================================================
-- F — FAILS-ON-REVERT, mechanically.
--
-- The reverted body is not typed out here — it is DERIVED from the live
-- definition by stripping `extensions.` off the digest calls. So it is the
-- shipped function minus exactly the fix and nothing else, and it cannot drift
-- away from whatever the migration actually installed.
--
-- Each of A-01, B-01 and C-01's calls is then re-fired and must come back
-- 42883. Then ROLLBACK TO SAVEPOINT restores the shipped definitions and the
-- same calls pass again.
-- ===========================================================================
SAVEPOINT issue_1828_before_revert;

DO $group_f_revert$
DECLARE
  v_name    text;
  v_def     text;
  v_broken  text;
  v_landing text;
  v_offenders integer;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'public.pg_prepare_guest_venue_cancellation_refund(uuid,text)',
    'public.pg_guest_venue_refund_summary(uuid,text)',
    'public.anonymize_user_audit_log(uuid,text)'
  ] LOOP
    v_def := pg_get_functiondef(v_name::regprocedure);
    v_broken := replace(v_def, 'extensions.digest(', 'digest(');
    IF v_broken = v_def THEN
      RAISE EXCEPTION 'F-00 % carries no extensions.digest( call — the fix is not installed, so this suite would pass vacuously', v_name;
    END IF;
    EXECUTE v_broken;
  END LOOP;

  -- F-01  The P1 call, on the virgin reservation, with the correct token.
  v_landing := pg_temp.landing_prepare(pg_temp.fx('res2'), pg_temp.tok('tok2'));
  IF v_landing NOT LIKE '42883:%' THEN
    RAISE EXCEPTION 'F-01 reverted guest cancel landed on % (expected 42883)', v_landing;
  END IF;

  -- F-02  The guest's refund summary read.
  v_landing := pg_temp.landing_summary(pg_temp.fx('res1'), pg_temp.tok('tok1'));
  IF v_landing NOT LIKE '42883:%' THEN
    RAISE EXCEPTION 'F-02 reverted refund summary landed on % (expected 42883)', v_landing;
  END IF;

  -- F-03  GDPR erasure.
  v_landing := pg_temp.landing_anonymize(pg_temp.fx('user'));
  IF v_landing NOT LIKE '42883:%' THEN
    RAISE EXCEPTION 'F-03 reverted anonymize landed on % (expected 42883)', v_landing;
  END IF;

  -- F-04  And the class probe sees all three — proving group D is not vacuous.
  SELECT count(*) INTO v_offenders FROM public.audit_unqualified_extension_calls();
  IF v_offenders <> 3 THEN
    RAISE EXCEPTION 'F-04 class probe reported % offenders on the reverted schema (expected 3)', v_offenders;
  END IF;
END $group_f_revert$;

ROLLBACK TO SAVEPOINT issue_1828_before_revert;

DO $group_f_restore$
DECLARE
  v_result jsonb;
  v_offenders integer;
BEGIN
  -- F-05  Identical call, identical row, fix restored: it works.
  v_result := public.pg_prepare_guest_venue_cancellation_refund(
    pg_temp.fx('res2'), pg_temp.tok('tok2'));
  IF v_result IS NULL OR (v_result ->> 'cancelled') IS DISTINCT FROM 'true'
     OR (v_result -> 'refund') IS NULL OR (v_result -> 'refund') = 'null'::jsonb THEN
    RAISE EXCEPTION 'F-05 restored guest cancel did not produce a refund: %', v_result;
  END IF;

  SELECT count(*) INTO v_offenders FROM public.audit_unqualified_extension_calls();
  IF v_offenders <> 0 THEN
    RAISE EXCEPTION 'F-06 class probe still reports % offenders after restore', v_offenders;
  END IF;
END $group_f_restore$;

ROLLBACK;
