-- ===========================================================================
-- Issue #1846 — the Phase-3 tester's four findings, executed against the REAL
-- applied schema.
--
-- Each group reproduces the defect's OWN shape and would have gone red on the
-- shipped code. The two that matter most are written to fail the way the bug
-- actually failed:
--
--   * T-C1b asserts the WRITE-BACK, not the refund row. A test that checked
--     "a source_refunds row exists" passed happily while every refunded order
--     read as `paid` forever — that test is exactly what let C-1(b) ship.
--   * T-H1 does not read a policy definition. It BECOMES a rank-40
--     event_manager the way PostgREST does (SET ROLE authenticated + the JWT
--     claim GUC) and requires the write to be refused. A strict-grep gate
--     cannot see a PostgREST verb, and neither can a catalog assertion that
--     only proves a policy exists.
--
-- Runs inside ONE transaction and ROLLBACKs — it leaves no rows.
-- ===========================================================================
BEGIN;

CREATE TEMP TABLE t1846_fx (k text PRIMARY KEY, v uuid);

DO $seed$
DECLARE
  v_brand   uuid := '00000000-1846-4000-8000-000000000002';
  v_venue   uuid := '00000000-1846-4000-8000-000000000010';
  v_table   uuid := '00000000-1846-4000-8000-000000000020';
  v_owner   uuid := '00000000-1846-4000-8000-000000000001';
  v_mgr     uuid := '00000000-1846-4000-8000-000000000003';
  v_spot uuid;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'owner-1846@example.test', now(), now()),
    (v_mgr, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'manager-1846@example.test', now(), now());
  INSERT INTO public.creator_accounts (id, created_at) VALUES (v_owner, now()), (v_mgr, now());

  INSERT INTO public.brands (id, account_id, name, slug, default_currency,
                             payment_provider, payout_hold_cutover_at, created_at, updated_at)
  VALUES (v_brand, v_owner, 'Issue 1846 Brand', 'issue1846brand', 'GBP',
          'stripe', now() - interval '365 days', now(), now());

  INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng,
                                     venue_category, claim_status)
  VALUES (v_venue, v_brand, 'brasserie1846', 'The Brasserie', 51.50, -0.12,
          'restaurant', 'verified');

  INSERT INTO public.venue_tables (id, brand_id, venue_id, name, capacity, zone, sort_order)
  VALUES (v_table, v_brand, v_venue, 'Table 12', 4, 'indoor', 1);
  SELECT id INTO v_spot FROM public.qr_spots WHERE venue_table_id = v_table;

  UPDATE public.brand_team_members
     SET role = 'brand_owner', accepted_at = coalesce(accepted_at, now())
   WHERE brand_id = v_brand AND user_id = v_owner AND removed_at IS NULL;
  IF NOT FOUND THEN
    INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
    VALUES (v_brand, v_owner, 'brand_owner', now(), now());
  END IF;
  -- A REAL rank-40 event_manager: the exact role the tester used to walk
  -- straight through PostgREST and flip the ordering switch.
  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
  VALUES (v_brand, v_mgr, 'event_manager', now(), now());

  INSERT INTO t1846_fx VALUES
    ('brand', v_brand), ('venue', v_venue), ('table', v_table), ('spot', v_spot),
    ('owner', v_owner), ('manager', v_mgr);
END $seed$;

CREATE OR REPLACE FUNCTION pg_temp.fx(p_k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v FROM t1846_fx WHERE k = p_k $$;

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END $$;

/** A PAID Mingla-path order, priced so the numbers in the tester's report
 *  reproduce exactly: 1050 total against a 100 Mingla fee. */
CREATE OR REPLACE FUNCTION pg_temp.mint_paid_order(
  p_subtotal int DEFAULT 1000,
  p_tip int DEFAULT 0,
  p_created timestamptz DEFAULT now(),
  p_confirmed timestamptz DEFAULT NULL,
  p_money_path text DEFAULT 'mingla'
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_session uuid;
  v_fee int := CASE WHEN p_money_path = 'mingla' THEN round(p_subtotal::numeric * 1000 / 10000) ELSE 0 END;
  v_svc int := CASE WHEN p_money_path = 'mingla' THEN round(p_subtotal::numeric * 300 / 10000) ELSE 0 END;
  v_buyer int := p_subtotal + v_fee + v_svc;
  v_id uuid;
BEGIN
  INSERT INTO public.venue_order_sessions (brand_id, venue_id, qr_spot_id, currency)
  VALUES (pg_temp.fx('brand'), pg_temp.fx('venue'), pg_temp.fx('spot'), 'GBP')
  RETURNING id INTO v_session;

  INSERT INTO public.venue_orders (
    session_id, brand_id, venue_id, qr_spot_id, spot_label_at_order,
    venue_table_id, zone_at_order, source,
    buyer_name, buyer_email, buyer_phone_e164,
    money_path, currency, subtotal_cents, service_charge_bps, service_charge_cents,
    tip_cents, effective_take_rate_bps, service_fee_bps, mingla_fee_cents,
    platform_service_fee_cents, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, tax_amount_cents, total_cents,
    provider, stripe_payment_intent_id, payment_status, confirmed_at,
    guest_cancel_token_hash, idempotency_key, created_at
  ) VALUES (
    v_session, pg_temp.fx('brand'), pg_temp.fx('venue'), pg_temp.fx('spot'),
    'Table 12', pg_temp.fx('table'), 'indoor', 'guest_qr',
    'Amara', 'amara@example.test', '+447700900123',
    p_money_path, 'GBP', p_subtotal, 0, 0,
    p_tip,
    CASE WHEN p_money_path = 'mingla' THEN 1000 ELSE 0 END,
    CASE WHEN p_money_path = 'mingla' THEN 300 ELSE 0 END,
    v_fee, v_svc,
    p_money_path = 'mingla', p_money_path = 'mingla', false,
    v_buyer, 0, v_buyer + p_tip,
    CASE WHEN p_money_path = 'mingla' THEN 'stripe' ELSE NULL END,
    CASE WHEN p_money_path = 'mingla'
         THEN 'pi_1846_' || replace(gen_random_uuid()::text, '-', '') ELSE NULL END,
    'paid', coalesce(p_confirmed, p_created),
    'v1:' || encode(extensions.digest('guest-token-' || v_session::text, 'sha256'), 'hex'),
    'idem:1846:' || gen_random_uuid()::text, p_created
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

/** Drive a refund all the way through the provider rail, the way
 *  source-refund-sweep does: claim an attempt, then report it processed. */
CREATE OR REPLACE FUNCTION pg_temp.process_refund(p_refund uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_amount int;
BEGIN
  PERFORM public.ensure_source_refund_attempt(p_refund, 'buyer_refund');
  SELECT buyer_refund_requested_cents INTO v_amount
    FROM public.source_refunds WHERE id = p_refund;
  PERFORM public.record_source_refund_provider_event(
    p_refund, 'buyer_refund', 1, 'evt:1846:' || p_refund::text,
    'charge.refunded', 're_1846', 'processed', v_amount, 're_op_1846', NULL);
END $$;

-- ---------------------------------------------------------------------------
-- T-C1a — THE DOUBLE REFUND. The tester's exact sequence: a guest cancels an
-- unacknowledged order (a full refund, no request), and a manager then taps
-- Approve on the same charge. Before this change that minted a SECOND
-- full-value row — 2100 requested against a 1050 charge.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_o uuid; v_total int; v_rows int; v_sum int; v_err text;
BEGIN
  v_o := pg_temp.mint_paid_order();
  SELECT total_cents INTO v_total FROM public.venue_orders WHERE id = v_o;

  PERFORM public.pg_venue_order_guest_action(
    v_o, 'guest-token-' || (SELECT session_id FROM public.venue_orders WHERE id = v_o)::text,
    'cancel', 'changed my mind');

  PERFORM pg_temp.act_as(pg_temp.fx('owner'));
  v_err := NULL;
  BEGIN
    PERFORM public.biz_venue_order_refund_decision(v_o, 'approved', 'our bad');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN
    RAISE EXCEPTION 'issue_1846 T-C1a: a manager approved a refund on a charge already returned in full';
  END IF;
  IF v_err NOT LIKE '%no_refund_requested%' AND v_err NOT LIKE '%already_refunded%' THEN
    RAISE EXCEPTION 'issue_1846 T-C1a: refused for the WRONG reason (%)', v_err;
  END IF;

  -- THE NUMBER THAT MATTERS: one charge, one refund, and never more money
  -- promised back than was ever taken.
  SELECT count(*), coalesce(sum(buyer_refund_requested_cents), 0) INTO v_rows, v_sum
    FROM public.source_refunds
   WHERE source_type = 'venue_menu_order' AND source_id = v_o;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'issue_1846 T-C1a: % refund rows for one charge (expected 1)', v_rows;
  END IF;
  IF v_sum > v_total THEN
    RAISE EXCEPTION
      'issue_1846 T-C1a: % promised back against a % charge — the double refund is live',
      v_sum, v_total;
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-C1a2 — the guard that survives a guest who DID ask. An approve is legal
-- once, and the SECOND approve is a replay rather than a second refund.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_o uuid; v_rows int; v_res jsonb; v_err text;
BEGIN
  v_o := pg_temp.mint_paid_order();
  PERFORM pg_temp.act_as(pg_temp.fx('manager'));
  PERFORM public.biz_venue_order_transition(v_o, 'acknowledged', NULL);
  PERFORM public.pg_venue_order_guest_action(
    v_o, 'guest-token-' || (SELECT session_id FROM public.venue_orders WHERE id = v_o)::text,
    'request_refund', 'cold');

  -- Nothing to decide BEFORE a request is the other half of the guard; prove
  -- the happy path still works now that one exists.
  v_res := public.biz_venue_order_refund_decision(v_o, 'approved', 'Our mistake.');
  IF v_res->>'decision' <> 'approved' THEN
    RAISE EXCEPTION 'issue_1846 T-C1a2: a legitimate approval was refused';
  END IF;

  v_res := public.biz_venue_order_refund_decision(v_o, 'approved', 'again');
  IF (v_res->>'replayed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'issue_1846 T-C1a2: a second approval was not reported as a replay';
  END IF;

  SELECT count(*) INTO v_rows FROM public.source_refunds
   WHERE source_type = 'venue_menu_order' AND source_id = v_o;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'issue_1846 T-C1a2: % refund rows after a double approve', v_rows;
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-C1a3 — the mint dedupes on the ORDER, not the refund KIND. This is the
-- structural half: even called directly, a second kind cannot open a second
-- door onto one charge.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_o uuid; v_first jsonb; v_second jsonb; v_rows int;
BEGIN
  v_o := pg_temp.mint_paid_order();
  v_first := public.pg_venue_order_mint_refund(
    v_o, 'venue_order_guest_cancel', 'guest', NULL, 'Guest cancelled');
  IF v_first->>'refundId' IS NULL THEN
    RAISE EXCEPTION 'issue_1846 T-C1a3 VACUITY: the first refund was never minted';
  END IF;

  v_second := public.pg_venue_order_mint_refund(
    v_o, 'venue_order_venue_approved', 'brand_staff', pg_temp.fx('owner'), 'Venue approved');
  IF v_second->>'reason' <> 'already_requested' THEN
    RAISE EXCEPTION
      'issue_1846 T-C1a3: a DIFFERENT refund_kind opened a second door onto one charge (%)',
      v_second->>'reason';
  END IF;
  IF v_second->>'refundId' <> v_first->>'refundId' THEN
    RAISE EXCEPTION 'issue_1846 T-C1a3: the caller was not handed back the existing refund';
  END IF;

  SELECT count(*) INTO v_rows FROM public.source_refunds
   WHERE source_type = 'venue_menu_order' AND source_id = v_o;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'issue_1846 T-C1a3: % refund rows for one charge', v_rows;
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-C1b — THE WRITE-BACK. The group that would have caught the shipped bug.
--
-- A test asserting "a refund row was created" passed for the whole of #1791
-- while `record_source_refund_provider_event` routed venue-order events into
-- `event_rsvp_contributions` and updated zero rows. So this asserts the ORDER,
-- not the refund: a fully-processed refund that leaves `payment_status='paid'`
-- IS the failure.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_o uuid; v_refund uuid; v_total int;
  v_ps text; v_refunded int; v_fs text; v_rsvp_before int; v_rsvp_after int;
BEGIN
  v_o := pg_temp.mint_paid_order();
  SELECT total_cents INTO v_total FROM public.venue_orders WHERE id = v_o;

  PERFORM pg_temp.act_as(pg_temp.fx('manager'));
  PERFORM public.biz_venue_order_transition(v_o, 'acknowledged', NULL);
  PERFORM public.biz_venue_order_transition(v_o, 'ready', NULL);
  PERFORM public.biz_venue_order_transition(v_o, 'delivered', NULL);
  PERFORM public.pg_venue_order_guest_action(
    v_o, 'guest-token-' || (SELECT session_id FROM public.venue_orders WHERE id = v_o)::text,
    'request_refund', 'it was cold');
  PERFORM public.biz_venue_order_refund_decision(v_o, 'approved', 'Our mistake.');

  SELECT id INTO v_refund FROM public.source_refunds
   WHERE source_type = 'venue_menu_order' AND source_id = v_o;
  IF v_refund IS NULL THEN
    RAISE EXCEPTION 'issue_1846 T-C1b VACUITY: the approval minted no refund';
  END IF;

  -- Before the provider confirms, the order is still honestly `paid`.
  SELECT payment_status, refunded_amount_cents INTO v_ps, v_refunded
    FROM public.venue_orders WHERE id = v_o;
  IF v_ps <> 'paid' OR v_refunded <> 0 THEN
    RAISE EXCEPTION 'issue_1846 T-C1b: the order moved before the provider said so (%/%)',
      v_ps, v_refunded;
  END IF;

  SELECT count(*) INTO v_rsvp_before FROM public.event_rsvp_contributions;
  PERFORM pg_temp.process_refund(v_refund);
  SELECT count(*) INTO v_rsvp_after FROM public.event_rsvp_contributions;

  SELECT payment_status, refunded_amount_cents, fulfillment_status
    INTO v_ps, v_refunded, v_fs
    FROM public.venue_orders WHERE id = v_o;

  -- THE ASSERTION THAT MATTERS.
  IF v_ps <> 'refunded' THEN
    RAISE EXCEPTION
      'issue_1846 T-C1b: a fully-processed refund left payment_status=% — the refund never reconciled',
      v_ps;
  END IF;
  IF v_refunded <> v_total THEN
    RAISE EXCEPTION
      'issue_1846 T-C1b: refunded_amount_cents=% after a % refund — the payout sweep will over-release',
      v_refunded, v_total;
  END IF;
  -- A fully-refunded DELIVERED order must not still read "Delivered".
  IF v_fs <> 'refunded' THEN
    RAISE EXCEPTION
      'issue_1846 T-C1b: a fully-refunded delivered order still reads % on the queue', v_fs;
  END IF;
  -- ...and the rsvp table must not have been touched on the way past.
  IF v_rsvp_after <> v_rsvp_before THEN
    RAISE EXCEPTION 'issue_1846 T-C1b: a venue-order refund wrote to event_rsvp_contributions';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-C1b2 — a PARTIAL refund reads as partial, not as refunded, and the
-- reservation arm is untouched by the re-route (a regression guard for the
-- branch that already worked).
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_o uuid; v_refund uuid; v_ps text; v_refunded int;
BEGIN
  v_o := pg_temp.mint_paid_order();
  v_refund := (public.pg_venue_order_mint_refund(
    v_o, 'venue_order_guest_cancel', 'guest', NULL, 'Guest cancelled'))->>'refundId';
  -- Halve what the provider gives back, so the order lands partially refunded.
  UPDATE public.source_refunds
     SET buyer_refund_requested_cents = greatest(1, buyer_refund_requested_cents / 2)
   WHERE id = v_refund;

  PERFORM pg_temp.process_refund(v_refund);

  SELECT payment_status, refunded_amount_cents INTO v_ps, v_refunded
    FROM public.venue_orders WHERE id = v_o;
  IF v_ps <> 'partial_refund' THEN
    RAISE EXCEPTION 'issue_1846 T-C1b2: a partial refund reported payment_status=%', v_ps;
  END IF;
  IF v_refunded <= 0 THEN
    RAISE EXCEPTION 'issue_1846 T-C1b2: a partial refund wrote back nothing';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-H1 — THE ORDERING GATE, ATTACKED THE WAY THE TESTER ATTACKED IT.
--
-- Not a policy assertion — a live attempt. `SET LOCAL ROLE authenticated`
-- plus the JWT claim GUC is exactly the connection PostgREST hands a request,
-- and this member is a REAL rank-40 event_manager of the brand that owns the
-- venue. The write must be refused, and the RPC must still work for the very
-- same person.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_err text; v_enabled boolean; v_res jsonb;
  -- HOISTED ON PURPOSE. Every id and helper is resolved as `postgres` BEFORE
  -- the role switch, because a `pg_temp.` lookup performed as `authenticated`
  -- could itself raise 42501 — and this suite would then "prove" the lock
  -- while actually measuring temp-schema privileges. The statements executed
  -- under the switched role touch NOTHING but the table under attack.
  v_venue uuid := pg_temp.fx('venue');
  v_brand uuid := pg_temp.fx('brand');
  v_rand  uuid := gen_random_uuid();
BEGIN
  PERFORM pg_temp.act_as(pg_temp.fx('owner'));
  PERFORM public.biz_venue_ordering_set_enabled(v_venue, false);

  PERFORM pg_temp.act_as(pg_temp.fx('manager'));
  IF public.biz_brand_effective_rank_for_caller(v_brand)
     < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'issue_1846 T-H1 VACUITY: the fixture member is not actually rank-40';
  END IF;

  -- (1) The straight-through PostgREST write.
  v_err := NULL;
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.venue_ordering_settings SET ordering_enabled = true
     WHERE venue_id = v_venue;
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  RESET ROLE;
  IF v_err IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION
      'issue_1846 T-H1: a rank-40 member flipped ordering_enabled through PostgREST (sqlstate %) — the OQ-7 gate is fiction',
      coalesce(v_err, 'no error');
  END IF;

  -- (2) The same door that wrote an unattributable pause.
  v_err := NULL;
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.venue_ordering_settings
       SET paused_at = now(), paused_by_user_id = v_rand
     WHERE venue_id = v_venue;
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  RESET ROLE;
  IF v_err IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION
      'issue_1846 T-H1: a pause could still be written directly, and attributed to anyone (sqlstate %)',
      coalesce(v_err, 'no error');
  END IF;

  -- (3) INSERT is the same hole wearing a different verb.
  v_err := NULL;
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.venue_ordering_settings (venue_id, brand_id, ordering_enabled)
    VALUES (v_venue, v_brand, true)
    ON CONFLICT (venue_id) DO UPDATE SET ordering_enabled = true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  RESET ROLE;
  IF v_err IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'issue_1846 T-H1: an upsert walked through the lock (sqlstate %)',
      coalesce(v_err, 'no error');
  END IF;

  -- (4) The venue can STILL SEE its own switches. A lock that blinds the
  --     operator is a different bug, not a fix.
  v_err := NULL;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM 1 FROM public.venue_ordering_settings WHERE venue_id = v_venue;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  RESET ROLE;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1846 T-H1: the venue can no longer read its own settings (%)', v_err;
  END IF;

  -- (5) ...and the sanctioned RPC still works for that same rank-40 member,
  --     WITH its claim_status gate intact.
  v_res := public.biz_venue_ordering_set_enabled(v_venue, true);
  IF (v_res->>'orderingEnabled')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'issue_1846 T-H1: the RPC no longer works for a manager';
  END IF;
  SELECT ordering_enabled INTO v_enabled
    FROM public.venue_ordering_settings WHERE venue_id = v_venue;
  IF v_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'issue_1846 T-H1 VACUITY: the RPC reported success but wrote nothing';
  END IF;

  -- (6) The gate it exists to enforce is still enforced.
  UPDATE public.venue_listings SET claim_status = 'pending_review' WHERE id = v_venue;
  PERFORM public.biz_venue_ordering_set_enabled(v_venue, false);
  v_err := NULL;
  BEGIN PERFORM public.biz_venue_ordering_set_enabled(v_venue, true);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NULL OR v_err NOT LIKE '%venue_not_orderable%' THEN
    RAISE EXCEPTION 'issue_1846 T-H1: an unverified venue was switched on (%)',
      coalesce(v_err, 'no error');
  END IF;
  UPDATE public.venue_listings SET claim_status = 'verified' WHERE id = v_venue;
END $t$;

-- ---------------------------------------------------------------------------
-- T-H1b — the grant table itself, because a policy alone never was the lock.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_priv text;
BEGIN
  FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
    IF has_table_privilege('authenticated', 'public.venue_ordering_settings', v_priv) THEN
      RAISE EXCEPTION
        'issue_1846 T-H1b: `authenticated` still holds % on venue_ordering_settings', v_priv;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'public.venue_ordering_settings', 'SELECT') THEN
    RAISE EXCEPTION 'issue_1846 T-H1b: the venue lost SELECT on its own settings';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'venue_ordering_settings'
       AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')) THEN
    RAISE EXCEPTION
      'issue_1846 T-H1b: venue_ordering_settings grew a client WRITE policy again';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-M1 — the escalation clock starts at PAYMENT. An order opened 12 minutes
-- ago but paid 3 minutes ago is 3 minutes old to the ladder, so the FLOOR
-- hears about it first. Before this, a slow checkout jumped straight to rung
-- 3 — the final, owner-only alert — and nobody else was ever told.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_o uuid; v_rung int; v_secs int; v_rows int;
BEGIN
  v_o := pg_temp.mint_paid_order(
    1000, 0, now() - interval '12 minutes', now() - interval '3 minutes');

  SELECT count(*), max(s.rung), max(s.unacked_seconds) INTO v_rows, v_rung, v_secs
    FROM public.pg_venue_order_escalation_scan(now(), 50) s WHERE s.order_id = v_o;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'issue_1846 T-M1 VACUITY: the slow-checkout order was not scanned';
  END IF;
  IF v_rung <> 1 THEN
    RAISE EXCEPTION
      'issue_1846 T-M1: a 3-minute-old payment fired rung % — the floor and the managers were skipped',
      v_rung;
  END IF;
  -- The wait a human reads is the wait since they PAID, not since they opened
  -- the menu.
  IF v_secs > 400 THEN
    RAISE EXCEPTION 'issue_1846 T-M1: the alert claims a % second wait on a 3-minute-old payment', v_secs;
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-M2 — a settled CASH order never pages anyone. `biz_venue_tab_close`
-- flips venue-collected orders to `paid`, which is what let them into the
-- sweep despite #1791's comment claiming otherwise. Mingla holds no money
-- here and the waiter is holding the ticket.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_cash uuid; v_rows int;
BEGIN
  v_cash := pg_temp.mint_paid_order(
    1000, 0, now() - interval '30 minutes', now() - interval '30 minutes', 'venue_collected');
  IF NOT EXISTS (SELECT 1 FROM public.venue_orders
                  WHERE id = v_cash AND payment_status = 'paid'
                    AND money_path = 'venue_collected'
                    AND fulfillment_status = 'placed' AND acknowledged_at IS NULL) THEN
    RAISE EXCEPTION 'issue_1846 T-M2 VACUITY: the fixture is not the shape that used to escalate';
  END IF;

  SELECT count(*) INTO v_rows FROM public.pg_venue_order_escalation_scan(now(), 50) s
   WHERE s.order_id = v_cash;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION
      'issue_1846 T-M2: a settled cash order paged the owner about money Mingla does not hold';
  END IF;
  IF EXISTS (SELECT 1 FROM public.venue_orders WHERE id = v_cash AND escalation_level > 0) THEN
    RAISE EXCEPTION 'issue_1846 T-M2: the sweep still claimed a rung on a cash order';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-M2b — and the Mingla-path order beside it STILL escalates, so T-M2 cannot
-- pass by the sweep simply having stopped working.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_o uuid; v_rows int;
BEGIN
  v_o := pg_temp.mint_paid_order(
    1000, 0, now() - interval '30 minutes', now() - interval '30 minutes');
  SELECT count(*) INTO v_rows FROM public.pg_venue_order_escalation_scan(now(), 50) s
   WHERE s.order_id = v_o;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'issue_1846 T-M2b: the ladder stopped escalating real money';
  END IF;
END $t$;

ROLLBACK;
