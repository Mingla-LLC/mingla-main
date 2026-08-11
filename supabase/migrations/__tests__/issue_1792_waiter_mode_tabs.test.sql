-- ===========================================================================
-- Issue #1792 (#1767 Phase 3b) — WAITER MODE, executed against the real applied
-- schema.
--
-- Behavioural, not structural: it writes real rows through the real CHECKs,
-- opens and closes real tabs through the real SECURITY DEFINER RPCs as a real
-- `auth.uid()` with a real `brand_team_members` rank, runs the real payout
-- sweep, and DROPS the new trigger to prove the bug it prevents really comes
-- back when it is gone.
--
-- The three claims this file exists to prove:
--
--   A. A `venue_collected` order — the waiter's "we took the cash" path —
--      produces NO fee snapshot and NO payout release, ever, with a
--      Mingla-path positive control beside it so a pass cannot come from the
--      sweep simply doing nothing.
--   B. A tab's ROUNDS and its SETTLEMENT can never both be counted. The bill
--      excludes itself from the rounds it bills; a stranded bill is cancelled
--      rather than paid beside them; and closing for cash while a live bill is
--      out is REFUSED rather than resolved in the platform's favour.
--   C. `metadata.tab_settlement` cannot be erased. Three mechanisms read it,
--      and the suite proves what breaks without it by taking the guard away.
--
-- Runs inside ONE transaction and ROLLBACKs — it leaves no rows.
-- ===========================================================================
BEGIN;

CREATE TEMP TABLE t1792_fx (k text PRIMARY KEY, v uuid);

DO $seed$
DECLARE
  v_brand   uuid := '00000000-1792-4000-8000-000000000002';
  v_venue   uuid := '00000000-1792-4000-8000-000000000010';
  v_table   uuid := '00000000-1792-4000-8000-000000000020';
  v_owner   uuid := '00000000-1792-4000-8000-000000000001';
  v_waiter  uuid := '00000000-1792-4000-8000-000000000003';
  v_outsider uuid := '00000000-1792-4000-8000-000000000004';
  v_spot uuid; v_menu uuid; v_item uuid;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'owner-1792@example.test', now(), now()),
    (v_waiter, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'waiter-1792@example.test', now(), now()),
    (v_outsider, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'outsider-1792@example.test', now(), now());
  INSERT INTO public.creator_accounts (id, created_at)
  VALUES (v_owner, now()), (v_waiter, now()), (v_outsider, now());

  INSERT INTO public.brands (id, account_id, name, slug, default_currency,
                             payment_provider, payout_hold_cutover_at, created_at, updated_at)
  VALUES (v_brand, v_owner, 'Issue 1792 Brand', 'issue1792brand', 'GBP',
          'stripe', now() - interval '365 days', now(), now());

  INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng,
                                     venue_category, claim_status)
  VALUES (v_venue, v_brand, 'brasserie1792', 'The Brasserie', 51.50, -0.12,
          'restaurant', 'verified');

  INSERT INTO public.venue_tables (id, brand_id, venue_id, name, capacity, zone, sort_order)
  VALUES (v_table, v_brand, v_venue, 'Table 12', 4, 'indoor', 1);

  -- #1789's auto-provision trigger already minted this table's spot; ADOPT it
  -- rather than race it, exactly as #1790's and #1791's fixtures do.
  SELECT id INTO v_spot FROM public.qr_spots WHERE venue_table_id = v_table;
  IF v_spot IS NULL THEN
    INSERT INTO public.qr_spots (brand_id, venue_id, kind, venue_table_id, label,
                                 serving_venue_id, code)
    VALUES (v_brand, v_venue, 'table', v_table, 'Table 12', v_venue, 'kq7m3pd2xt')
    RETURNING id INTO v_spot;
  END IF;

  -- #1792 — biz_venue_tab_open now reads staff_tabs_enabled.
  INSERT INTO public.venue_ordering_settings (venue_id, brand_id, ordering_enabled)
  VALUES (v_venue, v_brand, true)
  ON CONFLICT (venue_id) DO UPDATE SET ordering_enabled = true;

  INSERT INTO public.menus (brand_id, venue_id, name)
  VALUES (v_brand, v_venue, 'All day') RETURNING id INTO v_menu;
  INSERT INTO public.menu_items (menu_id, brand_id, name, price_cents, currency)
  VALUES (v_menu, v_brand, 'Negroni', 1200, 'GBP') RETURNING id INTO v_item;

  -- REAL membership + REAL ranks. The owner may open and close tabs; the
  -- waiter is a rank-10 `scanner` (ruling OQ-4) and may not.
  UPDATE public.brand_team_members
     SET role = 'brand_owner', accepted_at = coalesce(accepted_at, now())
   WHERE brand_id = v_brand AND user_id = v_owner AND removed_at IS NULL;
  IF NOT FOUND THEN
    INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
    VALUES (v_brand, v_owner, 'brand_owner', now(), now());
  END IF;
  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
  VALUES (v_brand, v_waiter, 'scanner', now(), now());

  INSERT INTO t1792_fx VALUES
    ('brand', v_brand), ('venue', v_venue), ('table', v_table), ('spot', v_spot),
    ('menu', v_menu), ('item', v_item), ('owner', v_owner),
    ('waiter', v_waiter), ('outsider', v_outsider);
END $seed$;

CREATE OR REPLACE FUNCTION pg_temp.fx(p_k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v FROM t1792_fx WHERE k = p_k $$;

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.mint_session() RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.venue_order_sessions (brand_id, venue_id, qr_spot_id, currency)
  VALUES (pg_temp.fx('brand'), pg_temp.fx('venue'), pg_temp.fx('spot'), 'GBP')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

/**
 * A ROUND on a tab: exactly the shape `venue-order-staff { action: "create" }`
 * writes. `venue_collected` at create is the literally-true shape — no provider
 * has been called and Mingla holds nothing (the P-26/CHECK-4 ruling).
 */
CREATE OR REPLACE FUNCTION pg_temp.mint_round(
  p_session uuid,
  p_subtotal int,
  p_service int DEFAULT 0,
  p_created timestamptz DEFAULT now()
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.venue_orders (
    session_id, brand_id, venue_id, qr_spot_id, spot_label_at_order,
    venue_table_id, zone_at_order, source, taken_by_user_id,
    money_path, currency, subtotal_cents, service_charge_bps, service_charge_cents,
    tip_cents, effective_take_rate_bps, service_fee_bps, mingla_fee_cents,
    platform_service_fee_cents, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, tax_amount_cents, total_cents,
    payment_status, idempotency_key, metadata, created_at
  ) VALUES (
    p_session, pg_temp.fx('brand'), pg_temp.fx('venue'), pg_temp.fx('spot'),
    'Table 12', pg_temp.fx('table'), 'indoor', 'staff', pg_temp.fx('waiter'),
    'venue_collected', 'GBP', p_subtotal, 0, p_service,
    0, 0, 0, 0, 0, false, false, false,
    p_subtotal + p_service, 0, p_subtotal + p_service,
    'pending', 'idem:1792:' || gen_random_uuid()::text,
    '{"unsettled_staff_order": true}'::jsonb, p_created
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

/**
 * The SETTLEMENT order `biz_venue_tab_close(..., 'bill_to_phone')` tells the
 * caller to mint: a payment instrument with NO lines, carrying the tab's
 * outstanding total and marked `tab_settlement`.
 */
CREATE OR REPLACE FUNCTION pg_temp.mint_settlement(
  p_session uuid,
  p_subtotal int,
  p_service int,
  p_tip int,
  p_mingla boolean DEFAULT false,
  p_created timestamptz DEFAULT now()
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_basis int := p_subtotal + p_service;
  v_fee int := CASE WHEN p_mingla THEN round(v_basis::numeric * 1000 / 10000) ELSE 0 END;
  v_svc int := CASE WHEN p_mingla THEN round(v_basis::numeric * 300 / 10000) ELSE 0 END;
BEGIN
  INSERT INTO public.venue_orders (
    session_id, brand_id, venue_id, qr_spot_id, spot_label_at_order,
    source, taken_by_user_id,
    buyer_name, buyer_email, buyer_phone_e164,
    money_path, currency, subtotal_cents, service_charge_bps, service_charge_cents,
    tip_cents, effective_take_rate_bps, service_fee_bps, mingla_fee_cents,
    platform_service_fee_cents, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, tax_amount_cents, total_cents,
    provider, stripe_payment_intent_id, payment_status,
    idempotency_key, metadata, created_at
  ) VALUES (
    p_session, pg_temp.fx('brand'), pg_temp.fx('venue'), pg_temp.fx('spot'),
    'Table 12', 'staff', pg_temp.fx('owner'),
    'Amara', 'amara@example.test', '+447700900123',
    CASE WHEN p_mingla THEN 'mingla' ELSE 'venue_collected' END,
    'GBP', p_subtotal, 0, p_service,
    p_tip,
    CASE WHEN p_mingla THEN 1000 ELSE 0 END,
    CASE WHEN p_mingla THEN 300 ELSE 0 END,
    v_fee, v_svc, p_mingla, p_mingla, false,
    v_basis + v_fee + v_svc, 0, v_basis + v_fee + v_svc + p_tip,
    CASE WHEN p_mingla THEN 'stripe' ELSE NULL END,
    CASE WHEN p_mingla
         THEN 'pi_1792_' || replace(gen_random_uuid()::text, '-', '') ELSE NULL END,
    'pending',
    'venue_tab_settlement:' || p_session::text,
    jsonb_build_object('tab_settlement', true, 'settles_session_id', p_session::text),
    p_created
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ===========================================================================
-- C. THE SETTLEMENT MARKER CANNOT BE ERASED.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- T-1792-M1 — a whole-column metadata write cannot drop `tab_settlement`.
--
-- This is the SHIPPED bug: `venue-order-staff`'s billToPhone did exactly this
-- UPDATE, one statement after inserting the marker.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_s uuid; v_settle uuid; v_md jsonb;
BEGIN
  v_s := pg_temp.mint_session();
  v_settle := pg_temp.mint_settlement(v_s, 4800, 600, 0, false);

  UPDATE public.venue_orders
     SET metadata = '{"settlement_method": "bill_to_phone"}'::jsonb
   WHERE id = v_settle;

  SELECT metadata INTO v_md FROM public.venue_orders WHERE id = v_settle;
  IF coalesce(v_md->>'tab_settlement', '') <> 'true' THEN
    RAISE EXCEPTION 'issue_1792 T-1792-M1: a whole-column write ERASED the settlement marker';
  END IF;
  IF v_md->>'settles_session_id' IS DISTINCT FROM v_s::text THEN
    RAISE EXCEPTION 'issue_1792 T-1792-M1: the settled-session pointer was lost';
  END IF;
  -- The write it rode on must still land: the trigger re-asserts, it does not
  -- refuse. A refusal here would take a payment status down with it.
  IF v_md->>'settlement_method' <> 'bill_to_phone' THEN
    RAISE EXCEPTION 'issue_1792 T-1792-M1: the caller''s own patch was dropped';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-1792-M2 — the marker is only ever PRESERVED, never invented.
-- A row that was not a settlement row cannot become one by being updated.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_s uuid; v_round uuid; v_md jsonb;
BEGIN
  v_s := pg_temp.mint_session();
  v_round := pg_temp.mint_round(v_s, 1200);
  UPDATE public.venue_orders SET metadata = '{"anything": 1}'::jsonb WHERE id = v_round;
  SELECT metadata INTO v_md FROM public.venue_orders WHERE id = v_round;
  IF v_md ? 'tab_settlement' THEN
    RAISE EXCEPTION 'issue_1792 T-1792-M2: an ordinary round was marked as a settlement';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-1792-M3 — FAILS ON REVERT, executed. Drop the trigger and the shipped bug
-- comes straight back: the marker is erased, and the tab becomes UNCLOSABLE
-- because `biz_venue_tab_close`'s own guard now counts the bill as a stranded
-- Mingla order on its own tab.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_s uuid; v_settle uuid; v_md jsonb; v_raised boolean := false;
BEGIN
  DROP TRIGGER trg_venue_orders_settlement_marker_permanent ON public.venue_orders;

  v_s := pg_temp.mint_session();
  PERFORM pg_temp.mint_round(v_s, 4800);
  v_settle := pg_temp.mint_settlement(v_s, 4800, 0, 0, true);
  UPDATE public.venue_orders
     SET metadata = '{"settlement_method": "bill_to_phone"}'::jsonb
   WHERE id = v_settle;

  SELECT metadata INTO v_md FROM public.venue_orders WHERE id = v_settle;
  IF coalesce(v_md->>'tab_settlement', '') = 'true' THEN
    RAISE EXCEPTION
      'issue_1792 T-1792-M3: the marker survived WITHOUT the trigger — this test proves nothing';
  END IF;

  PERFORM pg_temp.act_as(pg_temp.fx('owner'));
  PERFORM public.biz_venue_tab_open(v_s);
  BEGIN
    PERFORM public.biz_venue_tab_close(v_s, 'bill_to_phone');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%tab_has_mingla_orders%' THEN v_raised := true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION
      'issue_1792 T-1792-M3: without the marker the tab still closed — the wedge is not reproduced';
  END IF;

  -- Put it back. Everything after this point runs against the shipped guard.
  CREATE TRIGGER trg_venue_orders_settlement_marker_permanent
    BEFORE UPDATE ON public.venue_orders
    FOR EACH ROW
    EXECUTE FUNCTION public._issue_1792_settlement_marker_is_permanent();
END $t$;

-- ===========================================================================
-- B. A TAB'S ROUNDS AND ITS SETTLEMENT CAN NEVER BOTH BE COUNTED.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- T-1792-T1 — a STRANDED bill is not a round. The outstanding total a retried
-- close returns is the rounds' total, not the rounds plus a copy of the bill.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_s uuid; v_res jsonb; v_first jsonb;
BEGIN
  v_s := pg_temp.mint_session();
  PERFORM pg_temp.mint_round(v_s, 2400, 300);
  PERFORM pg_temp.mint_round(v_s, 2400, 300);

  PERFORM pg_temp.act_as(pg_temp.fx('owner'));
  PERFORM public.biz_venue_tab_open(v_s);
  v_first := public.biz_venue_tab_close(v_s, 'bill_to_phone');

  IF (v_first->>'outstandingSubtotalCents')::int <> 4800
     OR (v_first->>'outstandingServiceChargeCents')::int <> 600 THEN
    RAISE EXCEPTION 'issue_1792 T-1792-T1: the first close billed % + %, expected 4800 + 600',
      v_first->>'outstandingSubtotalCents', v_first->>'outstandingServiceChargeCents';
  END IF;

  -- The caller minted the bill and the provider call then FAILED, leaving it in
  -- the venue_collected + pending shape on the session — the exact shape the
  -- outstanding sum matches.
  PERFORM pg_temp.mint_settlement(v_s, 4800, 600, 0, false);

  v_res := public.biz_venue_tab_close(v_s, 'bill_to_phone');
  IF (v_res->>'outstandingSubtotalCents')::int <> 4800 THEN
    RAISE EXCEPTION
      'issue_1792 T-1792-T1: a retried close billed % — the table was charged for a copy of its own bill',
      v_res->>'outstandingSubtotalCents';
  END IF;
  IF (v_res->>'outstandingServiceChargeCents')::int <> 600 THEN
    RAISE EXCEPTION 'issue_1792 T-1792-T1: the service charge doubled on retry (%)',
      v_res->>'outstandingServiceChargeCents';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-1792-T2 — the paid bill closes the tab, settles the rounds, and the money
-- is counted ONCE. This is the Phase-6 exclusion made observable: the sum of
-- the session's NON-settlement paid rows equals the tab total, and the sum of
-- ALL its paid rows is exactly double it — which is what a revenue query that
-- forgot the marker would report.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_s uuid; v_settle uuid; v_close jsonb; v_res jsonb;
  v_state text; v_pending int; v_rounds int; v_all int; v_bill int;
BEGIN
  v_s := pg_temp.mint_session();
  PERFORM pg_temp.mint_round(v_s, 2400, 0);
  PERFORM pg_temp.mint_round(v_s, 2400, 0);

  PERFORM pg_temp.act_as(pg_temp.fx('owner'));
  PERFORM public.biz_venue_tab_open(v_s);
  v_close := public.biz_venue_tab_close(v_s, 'bill_to_phone');
  IF v_close->>'tabState' <> 'settling' THEN
    RAISE EXCEPTION 'issue_1792 T-1792-T2: bill_to_phone did not park the tab at settling';
  END IF;

  -- The caller mints the bill on the Mingla rail and the guest pays it.
  v_settle := pg_temp.mint_settlement(
    v_s,
    (v_close->>'outstandingSubtotalCents')::int,
    (v_close->>'outstandingServiceChargeCents')::int,
    (v_close->>'outstandingTipCents')::int,
    true);
  SELECT total_cents INTO v_bill FROM public.venue_orders WHERE id = v_settle;

  v_res := public.pg_venue_order_finalize_payment(
    v_settle, 'stripe', v_bill, 'GBP', 'pi_x', 'ch_x', 120, 'txn_x');
  IF v_res->>'status' <> 'finalized' THEN
    RAISE EXCEPTION 'issue_1792 T-1792-T2: the settlement payment did not finalize (%)',
      v_res->>'status';
  END IF;

  SELECT tab_state INTO v_state FROM public.venue_order_sessions WHERE id = v_s;
  IF v_state <> 'closed' THEN
    RAISE EXCEPTION 'issue_1792 T-1792-T2: the paid bill did not CLOSE the tab (state %)', v_state;
  END IF;
  SELECT count(*) INTO v_pending FROM public.venue_orders
   WHERE session_id = v_s AND payment_status = 'pending';
  IF v_pending <> 0 THEN
    RAISE EXCEPTION 'issue_1792 T-1792-T2: % rounds were left unpaid on a closed tab', v_pending;
  END IF;

  -- THE DOUBLE-COUNT, made arithmetic.
  SELECT coalesce(sum(total_cents), 0) INTO v_rounds
    FROM public.venue_orders
   WHERE session_id = v_s AND payment_status = 'paid'
     AND coalesce(metadata->>'tab_settlement', '') <> 'true';
  SELECT coalesce(sum(total_cents), 0) INTO v_all
    FROM public.venue_orders
   WHERE session_id = v_s AND payment_status = 'paid';

  IF v_rounds <> 4800 THEN
    RAISE EXCEPTION 'issue_1792 T-1792-T2: the rounds sum to % , expected 4800', v_rounds;
  END IF;
  -- The bill carries Mingla's fees on top, so the naive sum is MORE than double
  -- the food. The point is that it is not 4800, and the marker is the only
  -- thing standing between a revenue query and that number.
  IF v_all <= v_rounds THEN
    RAISE EXCEPTION
      'issue_1792 T-1792-T2: the settlement row is not in the session at all — the exclusion is untested';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-1792-T3 — closing for CASH cancels a stranded bill rather than paying it
-- beside the rounds it copies.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_s uuid; v_settle uuid; v_paid int; v_settle_status text; v_rounds int;
BEGIN
  v_s := pg_temp.mint_session();
  PERFORM pg_temp.mint_round(v_s, 2400, 0);
  PERFORM pg_temp.mint_round(v_s, 2400, 0);
  v_settle := pg_temp.mint_settlement(v_s, 4800, 0, 0, false);

  PERFORM pg_temp.act_as(pg_temp.fx('owner'));
  PERFORM public.biz_venue_tab_open(v_s);
  PERFORM public.biz_venue_tab_close(v_s, 'venue_collected');

  SELECT payment_status INTO v_settle_status
    FROM public.venue_orders WHERE id = v_settle;
  IF v_settle_status <> 'cancelled' THEN
    RAISE EXCEPTION
      'issue_1792 T-1792-T3: the stranded bill is % — it must be cancelled, never paid beside its own rounds',
      v_settle_status;
  END IF;

  SELECT coalesce(sum(total_cents), 0) INTO v_paid
    FROM public.venue_orders WHERE session_id = v_s AND payment_status = 'paid';
  IF v_paid <> 4800 THEN
    RAISE EXCEPTION 'issue_1792 T-1792-T3: the cash tab booked %, expected 4800', v_paid;
  END IF;
  SELECT count(*) INTO v_rounds FROM public.venue_orders
   WHERE session_id = v_s AND payment_status = 'paid';
  IF v_rounds <> 2 THEN
    RAISE EXCEPTION 'issue_1792 T-1792-T3: % rows were marked paid, expected the 2 rounds', v_rounds;
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-1792-T4 — a LIVE bill is not cancellable behind the guest's back. Closing
-- for cash while a Mingla-path bill is still pending is REFUSED, with its own
-- error, so the venue finishes what it sent instead of taking cash on top.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_s uuid; v_raised boolean := false; v_state text;
BEGIN
  v_s := pg_temp.mint_session();
  PERFORM pg_temp.mint_round(v_s, 2400, 0);
  PERFORM pg_temp.mint_settlement(v_s, 2400, 0, 0, true);

  PERFORM pg_temp.act_as(pg_temp.fx('owner'));
  PERFORM public.biz_venue_tab_open(v_s);
  BEGIN
    PERFORM public.biz_venue_tab_close(v_s, 'venue_collected');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%tab_bill_already_sent%' THEN v_raised := true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION
      'issue_1792 T-1792-T4: cash-closed a tab with a live bill out — the guest could still pay it';
  END IF;
  SELECT tab_state INTO v_state FROM public.venue_order_sessions WHERE id = v_s;
  IF v_state <> 'open' THEN
    RAISE EXCEPTION 'issue_1792 T-1792-T4: a refused close still moved the tab to %', v_state;
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-1792-T5 — the tab lifecycle's floors still hold. `per_round` is not a close
-- method, a rank-10 waiter cannot open or close a tab, and neither can a
-- non-member.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_s uuid; v_raised boolean;
BEGIN
  v_s := pg_temp.mint_session();
  PERFORM pg_temp.mint_round(v_s, 1200);

  -- A floor waiter may take the order (OQ-4) but not extend credit.
  PERFORM pg_temp.act_as(pg_temp.fx('waiter'));
  v_raised := false;
  BEGIN PERFORM public.biz_venue_tab_open(v_s);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%not_authorized%' THEN v_raised := true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1792 T-1792-T5: a rank-10 scanner opened a tab';
  END IF;

  PERFORM pg_temp.act_as(pg_temp.fx('outsider'));
  v_raised := false;
  BEGIN PERFORM public.biz_venue_tab_open(v_s);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%not_authorized%' THEN v_raised := true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1792 T-1792-T5: a non-member opened a tab on another brand';
  END IF;

  PERFORM pg_temp.act_as(pg_temp.fx('owner'));
  PERFORM public.biz_venue_tab_open(v_s);
  v_raised := false;
  BEGIN PERFORM public.biz_venue_tab_close(v_s, 'per_round');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%invalid_settlement_method%' THEN v_raised := true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1792 T-1792-T5: per_round was accepted as a close method';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-1792-T6 — P-16's switch is REAL, and it refuses ONLY on an explicit false.
-- A venue that switched staff tabs off cannot have one opened on them; a venue
-- that has expressed no preference (no settings row) still can, because the
-- column DEFAULTS to true and silence is not an opt-out.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_s uuid; v_raised boolean; v_state text;
BEGIN
  v_s := pg_temp.mint_session();
  PERFORM pg_temp.mint_round(v_s, 1200);
  PERFORM pg_temp.act_as(pg_temp.fx('owner'));

  UPDATE public.venue_ordering_settings SET staff_tabs_enabled = false
   WHERE venue_id = pg_temp.fx('venue');
  v_raised := false;
  BEGIN PERFORM public.biz_venue_tab_open(v_s);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%staff_tabs_disabled%' THEN v_raised := true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION
      'issue_1792 T-1792-T6: a tab opened on a venue that switched staff tabs OFF';
  END IF;
  SELECT tab_state INTO v_state FROM public.venue_order_sessions WHERE id = v_s;
  IF v_state <> 'none' THEN
    RAISE EXCEPTION 'issue_1792 T-1792-T6: a refused open still moved the tab to %', v_state;
  END IF;

  -- POSITIVE CONTROL: switched back on, the SAME call succeeds. Without this
  -- the assertion above would pass on a function that refused everything.
  UPDATE public.venue_ordering_settings SET staff_tabs_enabled = true
   WHERE venue_id = pg_temp.fx('venue');
  PERFORM public.biz_venue_tab_open(v_s);
  SELECT tab_state INTO v_state FROM public.venue_order_sessions WHERE id = v_s;
  IF v_state <> 'open' THEN
    RAISE EXCEPTION 'issue_1792 T-1792-T6: the control open did not take (state %)', v_state;
  END IF;

  -- NO SETTINGS ROW: still allowed. Refusing here would be a stricter rule than
  -- the schema states, and it is what broke #1790's shipped tab suite when this
  -- gate first failed closed.
  DELETE FROM public.venue_ordering_settings WHERE venue_id = pg_temp.fx('venue');
  v_s := pg_temp.mint_session();
  PERFORM pg_temp.mint_round(v_s, 1200);
  PERFORM public.biz_venue_tab_open(v_s);
  SELECT tab_state INTO v_state FROM public.venue_order_sessions WHERE id = v_s;
  IF v_state <> 'open' THEN
    RAISE EXCEPTION
      'issue_1792 T-1792-T6: a venue with NO settings row was refused a tab (state %)', v_state;
  END IF;
  INSERT INTO public.venue_ordering_settings (venue_id, brand_id, ordering_enabled)
  VALUES (pg_temp.fx('venue'), pg_temp.fx('brand'), true)
  ON CONFLICT (venue_id) DO UPDATE SET ordering_enabled = true;
END $t$;

-- ---------------------------------------------------------------------------
-- T-1792-S1 — `biz_venue_tab_summaries`: the member floor, and the sum that
-- MATCHES what the close RPC bills. The card a waiter reads and the bill the
-- guest gets are the same arithmetic, by construction.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_s uuid; v_out jsonb; v_tab jsonb; v_close jsonb; v_raised boolean := false;
BEGIN
  v_s := pg_temp.mint_session();
  PERFORM pg_temp.mint_round(v_s, 2400, 300);
  PERFORM pg_temp.mint_round(v_s, 2400, 300);
  -- ...and a stranded bill, which must NOT inflate the card either.
  PERFORM pg_temp.mint_settlement(v_s, 4800, 600, 0, false);

  PERFORM pg_temp.act_as(pg_temp.fx('outsider'));
  BEGIN PERFORM public.biz_venue_tab_summaries(pg_temp.fx('brand'));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%not_authorized%' THEN v_raised := true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1792 T-1792-S1: a non-member read another brand''s open tabs';
  END IF;

  PERFORM pg_temp.act_as(pg_temp.fx('owner'));
  PERFORM public.biz_venue_tab_open(v_s);

  -- A rank-10 waiter READS tabs (they serve them); only closing is gated.
  PERFORM pg_temp.act_as(pg_temp.fx('waiter'));
  v_out := public.biz_venue_tab_summaries(pg_temp.fx('brand'));
  SELECT t INTO v_tab
    FROM jsonb_array_elements(v_out->'tabs') t
   WHERE t->>'sessionId' = v_s::text;
  IF v_tab IS NULL THEN
    RAISE EXCEPTION 'issue_1792 T-1792-S1: an open tab was missing from the summaries';
  END IF;
  IF (v_tab->>'roundCount')::int <> 2 THEN
    RAISE EXCEPTION 'issue_1792 T-1792-S1: roundCount is % — the bill was counted as a round',
      v_tab->>'roundCount';
  END IF;
  IF (v_tab->>'outstandingTotalCents')::int <> 5400 THEN
    RAISE EXCEPTION 'issue_1792 T-1792-S1: the card says %, expected 5400',
      v_tab->>'outstandingTotalCents';
  END IF;
  IF v_tab->>'spotLabel' <> 'Table 12' THEN
    RAISE EXCEPTION 'issue_1792 T-1792-S1: the tab does not name where it is';
  END IF;

  -- THE POINT: the card and the bill agree, because they share the predicate.
  PERFORM pg_temp.act_as(pg_temp.fx('owner'));
  v_close := public.biz_venue_tab_close(v_s, 'bill_to_phone');
  IF (v_close->>'outstandingSubtotalCents')::int
       + (v_close->>'outstandingServiceChargeCents')::int
       + (v_close->>'outstandingTipCents')::int
     <> (v_tab->>'outstandingTotalCents')::int THEN
    RAISE EXCEPTION
      'issue_1792 T-1792-S1: the card and the bill disagree (% vs %)',
      v_tab->>'outstandingTotalCents', v_close;
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-1792-S2 — a CLOSED tab leaves the card. `settling` stays, because the
-- waiter still has a table with a bill on it.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_s uuid; v_out jsonb; v_n int;
BEGIN
  v_s := pg_temp.mint_session();
  PERFORM pg_temp.mint_round(v_s, 1200);
  PERFORM pg_temp.act_as(pg_temp.fx('owner'));
  PERFORM public.biz_venue_tab_open(v_s);

  v_out := public.biz_venue_tab_summaries(pg_temp.fx('brand'));
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_out->'tabs') t
   WHERE t->>'sessionId' = v_s::text;
  IF v_n <> 1 THEN RAISE EXCEPTION 'issue_1792 T-1792-S2: an OPEN tab was not listed'; END IF;

  PERFORM public.biz_venue_tab_close(v_s, 'venue_collected');
  v_out := public.biz_venue_tab_summaries(pg_temp.fx('brand'));
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_out->'tabs') t
   WHERE t->>'sessionId' = v_s::text;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'issue_1792 T-1792-S2: a CLOSED tab is still on the card';
  END IF;
END $t$;

-- ===========================================================================
-- A. THE VENUE TOOK THE MONEY: NO FEE, NO PAYOUT ROW, EVER.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- T-1792-P1 — a whole waiter-mode cash service, ten days old, produces ZERO
-- fee snapshots and ZERO payout releases — beside a Mingla-path positive
-- control that DOES attach, so a pass cannot come from the sweep doing nothing.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_cash_session uuid; v_bill_session uuid;
  v_r1 uuid; v_r2 uuid; v_settle uuid; v_bill int;
  v_created timestamptz := now() - interval '10 days';
  v_cnt int; v_rel int;
BEGIN
  -- (1) A cash tab: two rounds, settled venue_collected.
  v_cash_session := pg_temp.mint_session();
  v_r1 := pg_temp.mint_round(v_cash_session, 2400, 0, v_created);
  v_r2 := pg_temp.mint_round(v_cash_session, 2400, 0, v_created);
  PERFORM pg_temp.act_as(pg_temp.fx('owner'));
  PERFORM public.biz_venue_tab_open(v_cash_session);
  PERFORM public.biz_venue_tab_close(v_cash_session, 'venue_collected');

  -- (2) The positive control: a billed tab whose settlement really was charged.
  v_bill_session := pg_temp.mint_session();
  PERFORM pg_temp.mint_round(v_bill_session, 4800, 0, v_created);
  PERFORM public.biz_venue_tab_open(v_bill_session);
  PERFORM public.biz_venue_tab_close(v_bill_session, 'bill_to_phone');
  v_settle := pg_temp.mint_settlement(v_bill_session, 4800, 0, 0, true, v_created);
  SELECT total_cents INTO v_bill FROM public.venue_orders WHERE id = v_settle;
  PERFORM public.pg_venue_order_finalize_payment(
    v_settle, 'stripe', v_bill, 'GBP', 'pi_ctl', 'ch_ctl', 150, 'txn_ctl');

  PERFORM public.run_payout_release_dark_sweep(now());

  -- The cash rounds: no fee snapshot, no payout item, no release.
  SELECT count(*) INTO v_cnt FROM public.payout_source_fee_snapshots
   WHERE source_type = 'venue_menu_order' AND source_id IN (v_r1, v_r2);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'issue_1792 T-1792-P1: a venue_collected round produced % fee snapshot(s)', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.payout_release_items
   WHERE source_type = 'venue_menu_order' AND source_id IN (v_r1, v_r2);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'issue_1792 T-1792-P1: a venue_collected round produced % payout item(s)', v_cnt;
  END IF;

  -- And the rows themselves cannot carry a fee at all — the CHECK, not a query.
  SELECT count(*) INTO v_cnt FROM public.venue_orders
   WHERE id IN (v_r1, v_r2)
     AND (mingla_fee_cents <> 0 OR platform_service_fee_cents <> 0
          OR provider IS NOT NULL OR tax_amount_cents <> 0);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'issue_1792 T-1792-P1: a venue_collected round carried a fee or a provider';
  END IF;

  -- POSITIVE CONTROL: the billed settlement DID attach. Without this the two
  -- zeroes above would pass on a sweep that never ran.
  SELECT count(*) INTO v_rel FROM public.payout_release_items
   WHERE source_type = 'venue_menu_order' AND source_id = v_settle;
  IF v_rel <> 1 THEN
    RAISE EXCEPTION
      'issue_1792 T-1792-P1: the CONTROL settlement produced % payout items — the sweep is not proving anything',
      v_rel;
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-1792-P2 — the promise is STRUCTURAL, not procedural: a venue_collected row
-- carrying a provider, a fee, or Mingla-computed tax is unwritable.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_s uuid; v_raised boolean;
BEGIN
  v_s := pg_temp.mint_session();

  v_raised := false;
  BEGIN
    INSERT INTO public.venue_orders (
      session_id, brand_id, venue_id, qr_spot_id, source, taken_by_user_id,
      money_path, currency, subtotal_cents, service_charge_bps, service_charge_cents,
      tip_cents, effective_take_rate_bps, service_fee_bps, mingla_fee_cents,
      platform_service_fee_cents, pass_mingla_fee, pass_service_fee, pass_tax,
      buyer_subtotal_cents, tax_amount_cents, total_cents, provider,
      payment_status, idempotency_key
    ) VALUES (
      v_s, pg_temp.fx('brand'), pg_temp.fx('venue'), pg_temp.fx('spot'), 'staff',
      pg_temp.fx('waiter'), 'venue_collected', 'GBP', 1200, 0, 0, 0, 0, 0, 0, 0,
      false, false, false, 1200, 0, 1200, 'stripe', 'pending', 'idem:1792:bad-provider');
  EXCEPTION WHEN check_violation THEN v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1792 T-1792-P2: a venue_collected order took a PROVIDER';
  END IF;

  v_raised := false;
  BEGIN
    INSERT INTO public.venue_orders (
      session_id, brand_id, venue_id, qr_spot_id, source, taken_by_user_id,
      money_path, currency, subtotal_cents, service_charge_bps, service_charge_cents,
      tip_cents, effective_take_rate_bps, service_fee_bps, mingla_fee_cents,
      platform_service_fee_cents, pass_mingla_fee, pass_service_fee, pass_tax,
      buyer_subtotal_cents, tax_amount_cents, total_cents,
      payment_status, idempotency_key
    ) VALUES (
      v_s, pg_temp.fx('brand'), pg_temp.fx('venue'), pg_temp.fx('spot'), 'staff',
      pg_temp.fx('waiter'), 'venue_collected', 'GBP', 1200, 0, 0, 0, 1000, 0, 120, 0,
      false, false, false, 1200, 0, 1200, 'pending', 'idem:1792:bad-fee');
  EXCEPTION WHEN check_violation THEN v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1792 T-1792-P2: a venue_collected order took a MINGLA FEE';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-1792-Q1 — THE KITCHEN CANNOT TELL. A staff round and a scanned guest order
-- are the same row shape in every column the queue reads; only `source` and
-- `taken_by_user_id` differ, and neither is a queue column.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_s uuid; v_staff uuid; v_guest uuid; v_diff text[];
BEGIN
  v_s := pg_temp.mint_session();
  v_staff := pg_temp.mint_round(v_s, 2400, 0);
  INSERT INTO public.venue_orders (
    session_id, brand_id, venue_id, qr_spot_id, spot_label_at_order,
    venue_table_id, zone_at_order, source,
    money_path, currency, subtotal_cents, service_charge_bps, service_charge_cents,
    tip_cents, effective_take_rate_bps, service_fee_bps, mingla_fee_cents,
    platform_service_fee_cents, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, tax_amount_cents, total_cents,
    payment_status, idempotency_key
  ) VALUES (
    v_s, pg_temp.fx('brand'), pg_temp.fx('venue'), pg_temp.fx('spot'),
    'Table 12', pg_temp.fx('table'), 'indoor', 'guest_qr',
    'venue_collected', 'GBP', 2400, 0, 0, 0, 0, 0, 0, 0, false, false, false,
    2400, 0, 2400, 'pending', 'idem:1792:guest'
  ) RETURNING id INTO v_guest;

  -- Every column the Orders queue actually selects (useVenueOrders.ORDER_COLUMNS)
  -- must be identical between the two, `source` alone excepted.
  SELECT array_agg(col) INTO v_diff FROM (
    SELECT 'fulfillment_status' AS col WHERE (SELECT fulfillment_status FROM public.venue_orders WHERE id=v_staff)
       IS DISTINCT FROM (SELECT fulfillment_status FROM public.venue_orders WHERE id=v_guest)
    UNION ALL SELECT 'spot_label_at_order' WHERE (SELECT spot_label_at_order FROM public.venue_orders WHERE id=v_staff)
       IS DISTINCT FROM (SELECT spot_label_at_order FROM public.venue_orders WHERE id=v_guest)
    UNION ALL SELECT 'zone_at_order' WHERE (SELECT zone_at_order FROM public.venue_orders WHERE id=v_staff)
       IS DISTINCT FROM (SELECT zone_at_order FROM public.venue_orders WHERE id=v_guest)
    UNION ALL SELECT 'pickup_code' WHERE (SELECT pickup_code FROM public.venue_orders WHERE id=v_staff)
       IS DISTINCT FROM (SELECT pickup_code FROM public.venue_orders WHERE id=v_guest)
    UNION ALL SELECT 'total_cents' WHERE (SELECT total_cents FROM public.venue_orders WHERE id=v_staff)
       IS DISTINCT FROM (SELECT total_cents FROM public.venue_orders WHERE id=v_guest)
    UNION ALL SELECT 'escalation_level' WHERE (SELECT escalation_level FROM public.venue_orders WHERE id=v_staff)
       IS DISTINCT FROM (SELECT escalation_level FROM public.venue_orders WHERE id=v_guest)
    UNION ALL SELECT 'acknowledged_at' WHERE (SELECT acknowledged_at FROM public.venue_orders WHERE id=v_staff)
       IS DISTINCT FROM (SELECT acknowledged_at FROM public.venue_orders WHERE id=v_guest)
  ) d;
  IF v_diff IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_1792 T-1792-Q1: a staff ticket differs from a scanned one in the queue''s own columns: %',
      v_diff;
  END IF;

  -- The escalation ladder treats them the same too: `pg_venue_order_escalation_scan`
  -- selects on acknowledged_at, never on source. A staff ticket nobody picks up
  -- escalates exactly like a guest's.
  IF (SELECT count(*) FROM public.venue_orders
       WHERE id IN (v_staff, v_guest) AND acknowledged_at IS NULL
         AND fulfillment_status = 'placed') <> 2 THEN
    RAISE EXCEPTION 'issue_1792 T-1792-Q1: the two tickets are not both unacknowledged';
  END IF;

  -- Vacuity guard: the two rows must really differ in provenance, or the whole
  -- group is comparing a row with itself.
  IF (SELECT source FROM public.venue_orders WHERE id = v_staff) <> 'staff'
     OR (SELECT source FROM public.venue_orders WHERE id = v_guest) <> 'guest_qr'
     OR (SELECT taken_by_user_id FROM public.venue_orders WHERE id = v_staff) IS NULL
     OR (SELECT taken_by_user_id FROM public.venue_orders WHERE id = v_guest) IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1792 T-1792-Q1: the fixture is not comparing a staff order to a guest one';
  END IF;
END $t$;

ROLLBACK;
