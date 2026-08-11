-- ===========================================================================
-- Issue #1791 (SPEC #1788 Phase 3) — the Orders queue and the alerting spine,
-- EXECUTED against the real applied schema.
--
-- This is a BEHAVIOURAL suite, not a structural one: it writes real rows
-- through the real CHECKs, calls the real SECURITY DEFINER RPCs as a real
-- `auth.uid()` with a real `brand_team_members` rank, walks the escalation
-- ladder rung by rung, and asserts what the sweep did NOT do as hard as what
-- it did.
--
-- Every group names the change it guards and FAILS when that change is
-- reverted. Runs inside ONE transaction and ROLLBACKs — it leaves no rows.
-- ===========================================================================
BEGIN;

CREATE TEMP TABLE t1791_fx (k text PRIMARY KEY, v uuid);

DO $seed$
DECLARE
  v_brand   uuid := '00000000-1791-4000-8000-000000000002';
  v_venue   uuid := '00000000-1791-4000-8000-000000000010';
  v_table   uuid := '00000000-1791-4000-8000-000000000020';
  v_owner   uuid := '00000000-1791-4000-8000-000000000001';
  v_waiter  uuid := '00000000-1791-4000-8000-000000000003';
  v_outsider uuid := '00000000-1791-4000-8000-000000000004';
  v_spot uuid; v_menu uuid; v_item uuid;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'owner-1791@example.test', now(), now()),
    (v_waiter, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'waiter-1791@example.test', now(), now()),
    (v_outsider, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'outsider-1791@example.test', now(), now());
  INSERT INTO public.creator_accounts (id, created_at)
  VALUES (v_owner, now()), (v_waiter, now()), (v_outsider, now());

  INSERT INTO public.brands (id, account_id, name, slug, default_currency,
                             payment_provider, payout_hold_cutover_at, created_at, updated_at)
  VALUES (v_brand, v_owner, 'Issue 1791 Brand', 'issue1791brand', 'GBP',
          'stripe', now() - interval '365 days', now(), now());

  INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng,
                                     venue_category, claim_status)
  VALUES (v_venue, v_brand, 'brasserie1791', 'The Brasserie', 51.50, -0.12,
          'restaurant', 'verified');

  INSERT INTO public.venue_tables (id, brand_id, venue_id, name, capacity, zone, sort_order)
  VALUES (v_table, v_brand, v_venue, 'Table 12', 4, 'indoor', 1);

  -- #1789's auto-provision trigger already minted the spot for this table
  -- (qr_spots_table_uniq means at most one per physical unit) — ADOPT it rather
  -- than race it, exactly as #1790's fixture does.
  SELECT id INTO v_spot FROM public.qr_spots WHERE venue_table_id = v_table;
  IF v_spot IS NULL THEN
    INSERT INTO public.qr_spots (brand_id, venue_id, kind, venue_table_id, label,
                                 serving_venue_id, code)
    VALUES (v_brand, v_venue, 'table', v_table, 'Table 12', v_venue, 'kq7m3pd2xs')
    RETURNING id INTO v_spot;
  END IF;

  INSERT INTO public.menus (brand_id, venue_id, name)
  VALUES (v_brand, v_venue, 'All day') RETURNING id INTO v_menu;
  INSERT INTO public.menu_items (menu_id, brand_id, name, price_cents, currency)
  VALUES (v_menu, v_brand, 'Negroni', 1200, 'GBP') RETURNING id INTO v_item;

  -- REAL membership. B2a's owner trigger already made the owner's row; adopt
  -- and accept it (the rank function ignores a NULL accepted_at). The waiter is
  -- a rank-10 `scanner` ON PURPOSE: ruling OQ-4 relaxed the ack floor to ANY
  -- brand member precisely because the person holding the ticket on a floor is
  -- often the lowest rank in the system.
  UPDATE public.brand_team_members
     SET role = 'brand_owner', accepted_at = coalesce(accepted_at, now())
   WHERE brand_id = v_brand AND user_id = v_owner AND removed_at IS NULL;
  IF NOT FOUND THEN
    INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
    VALUES (v_brand, v_owner, 'brand_owner', now(), now());
  END IF;
  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
  VALUES (v_brand, v_waiter, 'scanner', now(), now());

  INSERT INTO t1791_fx VALUES
    ('brand', v_brand), ('venue', v_venue), ('table', v_table), ('spot', v_spot),
    ('menu', v_menu), ('item', v_item), ('owner', v_owner),
    ('waiter', v_waiter), ('outsider', v_outsider);
END $seed$;

CREATE OR REPLACE FUNCTION pg_temp.fx(p_k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v FROM t1791_fx WHERE k = p_k $$;

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
 * A PAID Mingla-path guest order that satisfies every CHECK. Callers override
 * `p_created` to place it in the past — that is how the ladder's rungs are
 * reached without waiting ten real minutes.
 */
CREATE OR REPLACE FUNCTION pg_temp.mint_paid_order(
  p_subtotal int DEFAULT 4000,
  p_tip int DEFAULT 500,
  p_created timestamptz DEFAULT now()
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_session uuid := pg_temp.mint_session();
  v_basis int := p_subtotal;
  v_fee int := round(v_basis::numeric * 1000 / 10000);
  v_svc int := round(v_basis::numeric * 300 / 10000);
  v_buyer int := v_basis + v_fee + v_svc;
  v_id uuid;
BEGIN
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
    'mingla', 'GBP', p_subtotal, 0, 0,
    p_tip, 1000, 300, v_fee, v_svc, true, true, false,
    v_buyer, 0, v_buyer + p_tip,
    'stripe', 'pi_1791_' || replace(gen_random_uuid()::text, '-', ''), 'paid', p_created,
    'v1:' || encode(digest('guest-token-' || v_session::text, 'sha256'), 'hex'),
    'idem:1791:' || gen_random_uuid()::text, p_created
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.guest_token(p_order uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT 'guest-token-' || session_id::text FROM public.venue_orders WHERE id = p_order
$$;

-- The REAL auth.uid() reads `request.jwt.claim.sub`, and the REAL rank
-- function reads `brand_team_members`. Both are exercised unstubbed — a
-- fixture that stubbed the rank would be testing nothing.
CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END $$;

-- ---------------------------------------------------------------------------
-- T-MAP1 — the legal-transition map (P-26). Terminal states are terminal, and
-- the map is EXACTLY the one the client mirrors. Widening it here without
-- widening venueOrderViews.ts is how a client grows a button the server bounces.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_legal text[][] := ARRAY[
    ['placed','acknowledged'], ['placed','cancelled'],
    ['acknowledged','in_progress'], ['acknowledged','ready'], ['acknowledged','cancelled'],
    ['in_progress','ready'], ['in_progress','cancelled'],
    ['ready','delivered'], ['ready','cancelled'],
    ['delivered','refunded']];
  v_illegal text[][] := ARRAY[
    ['placed','in_progress'], ['placed','ready'], ['placed','delivered'],
    ['acknowledged','delivered'], ['acknowledged','acknowledged'],
    ['ready','in_progress'], ['delivered','ready'],
    ['cancelled','acknowledged'], ['cancelled','cancelled'],
    ['refunded','delivered'], ['refunded','refunded']];
  i int;
BEGIN
  FOR i IN 1..array_length(v_legal, 1) LOOP
    IF NOT public.pg_venue_order_transition_is_legal(v_legal[i][1], v_legal[i][2]) THEN
      RAISE EXCEPTION 'issue_1791 T-MAP1: % -> % should be legal', v_legal[i][1], v_legal[i][2];
    END IF;
  END LOOP;
  FOR i IN 1..array_length(v_illegal, 1) LOOP
    IF public.pg_venue_order_transition_is_legal(v_illegal[i][1], v_illegal[i][2]) THEN
      RAISE EXCEPTION 'issue_1791 T-MAP1: % -> % should be ILLEGAL', v_illegal[i][1], v_illegal[i][2];
    END IF;
  END LOOP;
END $t$;

-- ---------------------------------------------------------------------------
-- T-ACK1 — ACKNOWLEDGED IS A HUMAN TAP, and the human is recorded.
-- (I-PROPOSED-1767-ACK-IS-A-HUMAN-TAP)
--
-- Three separate proofs, because "a render can never imply a tap" needs all
-- three: the CHECK makes a bare timestamp unwritable; the RPC takes the user id
-- from auth.uid() and NOT from an argument (there IS no such argument); and the
-- order cannot skip past `placed` without one.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_o uuid; v_raised boolean; v_res jsonb;
BEGIN
  v_o := pg_temp.mint_paid_order();

  -- (1) A timestamp with no person is structurally unwritable.
  v_raised := false;
  BEGIN
    UPDATE public.venue_orders SET acknowledged_at = now() WHERE id = v_o;
  EXCEPTION WHEN check_violation THEN v_raised := true; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1791 T-ACK1: an acknowledgement was written with no human user id';
  END IF;

  -- (2) An order cannot move past `placed` without being acknowledged first.
  v_raised := false;
  BEGIN
    UPDATE public.venue_orders SET fulfillment_status = 'ready' WHERE id = v_o;
  EXCEPTION WHEN check_violation THEN v_raised := true; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1791 T-ACK1: an order reached `ready` having never been acknowledged';
  END IF;

  -- (3) The RPC writes BOTH columns, and the id is the CALLER's — there is no
  -- parameter through which a client could nominate somebody else.
  PERFORM pg_temp.act_as(pg_temp.fx('waiter'));
  v_res := public.biz_venue_order_transition(v_o, 'acknowledged', NULL);
  IF v_res->>'fulfillmentStatus' <> 'acknowledged' THEN
    RAISE EXCEPTION 'issue_1791 T-ACK1: the transition RPC did not acknowledge the order';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.venue_orders
     WHERE id = v_o AND acknowledged_at IS NOT NULL
       AND acknowledged_by_user_id = pg_temp.fx('waiter')) THEN
    RAISE EXCEPTION 'issue_1791 T-ACK1: the acknowledging human was not recorded on the row';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-ACK2 — the ROLE FLOORS (ruling OQ-4). A rank-10 scanner CAN acknowledge
-- and advance; only event_manager+ can cancel; a non-member can do neither.
-- Raising the ack floor means the person actually holding the ticket cannot
-- say they have it — which is the whole reason OQ-4 relaxed it.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_o uuid; v_raised boolean;
BEGIN
  v_o := pg_temp.mint_paid_order();

  -- A stranger gets nothing.
  PERFORM pg_temp.act_as(pg_temp.fx('outsider'));
  v_raised := false;
  BEGIN PERFORM public.biz_venue_order_transition(v_o, 'acknowledged', NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM LIKE '%not_authorized%'; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1791 T-ACK2: a non-member acknowledged another brand''s order';
  END IF;

  -- The rank-10 waiter works the whole kitchen half of the machine.
  PERFORM pg_temp.act_as(pg_temp.fx('waiter'));
  PERFORM public.biz_venue_order_transition(v_o, 'acknowledged', NULL);
  PERFORM public.biz_venue_order_transition(v_o, 'in_progress', NULL);
  PERFORM public.biz_venue_order_transition(v_o, 'ready', NULL);
  IF NOT EXISTS (SELECT 1 FROM public.venue_orders
                  WHERE id = v_o AND fulfillment_status = 'ready'
                    AND in_progress_at IS NOT NULL AND ready_at IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_1791 T-ACK2: a brand member could not work the queue';
  END IF;

  -- ...but cancelling a PAID order is the front half of a refund: manager-plus.
  v_raised := false;
  BEGIN PERFORM public.biz_venue_order_transition(v_o, 'cancelled', NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM LIKE '%not_authorized%'; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1791 T-ACK2: a rank-10 member cancelled a paid order';
  END IF;

  PERFORM pg_temp.act_as(pg_temp.fx('owner'));
  PERFORM public.biz_venue_order_transition(v_o, 'cancelled', 'kitchen closed');
  IF NOT EXISTS (SELECT 1 FROM public.venue_orders
                  WHERE id = v_o AND fulfillment_status = 'cancelled'
                    AND metadata->>'last_transition_reason' = 'kitchen closed') THEN
    RAISE EXCEPTION 'issue_1791 T-ACK2: the owner''s cancel did not land with its reason';
  END IF;

  -- Terminal is terminal, even for the owner.
  v_raised := false;
  BEGIN PERFORM public.biz_venue_order_transition(v_o, 'acknowledged', NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM LIKE '%transition_not_allowed%'; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1791 T-ACK2: a cancelled order was re-opened';
  END IF;

  -- `refunded` is refused by this RPC on purpose: it is a claim that money went
  -- back, and only the refund rail may make it.
  v_raised := false;
  BEGIN PERFORM public.biz_venue_order_transition(v_o, 'refunded', NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM LIKE '%transition_not_allowed%'; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1791 T-ACK2: the transition RPC claimed a refund without moving money';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-ESC1 — THE LADDER. Each rung fires EXACTLY ONCE, in order, and rung 3 is
-- the last thing that ever happens. (P-55, D-7)
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_o uuid; v_rows int; v_rung int;
BEGIN
  v_o := pg_temp.mint_paid_order(4000, 500, now() - interval '3 minutes');

  -- Under two minutes: nothing at all.
  SELECT count(*) INTO v_rows FROM public.pg_venue_order_escalation_scan(
    now() - interval '2 minutes', 50) s WHERE s.order_id = v_o;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'issue_1791 T-ESC1: the ladder fired before T+2';
  END IF;

  -- T+3 → rung 1, once.
  SELECT count(*), max(s.rung) INTO v_rows, v_rung
    FROM public.pg_venue_order_escalation_scan(now(), 50) s WHERE s.order_id = v_o;
  IF v_rows <> 1 OR v_rung <> 1 THEN
    RAISE EXCEPTION 'issue_1791 T-ESC1: T+3 produced % row(s) at rung %', v_rows, v_rung;
  END IF;
  SELECT count(*) INTO v_rows FROM public.pg_venue_order_escalation_scan(now(), 50) s
   WHERE s.order_id = v_o;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'issue_1791 T-ESC1: rung 1 fired TWICE for one order';
  END IF;

  -- T+6 → rung 2, once.
  -- #1846 M-1 [TEST-MOD-APPROVED #1846] — the ladder is clocked from PAYMENT
  -- (confirmed_at), not from when the guest opened checkout, so walking the
  -- rungs means moving the clock the ladder actually reads. Moving created_at
  -- alone was pinning the very bug #1846 fixed: an order whose checkout took
  -- eleven minutes used to arrive already past every threshold. Both columns
  -- move together here so the fixture stays a coherent order.
  UPDATE public.venue_orders
     SET created_at = now() - interval '6 minutes',
         confirmed_at = now() - interval '6 minutes'
   WHERE id = v_o;
  SELECT count(*), max(s.rung) INTO v_rows, v_rung
    FROM public.pg_venue_order_escalation_scan(now(), 50) s WHERE s.order_id = v_o;
  IF v_rows <> 1 OR v_rung <> 2 THEN
    RAISE EXCEPTION 'issue_1791 T-ESC1: T+6 produced % row(s) at rung %', v_rows, v_rung;
  END IF;
  SELECT count(*) INTO v_rows FROM public.pg_venue_order_escalation_scan(now(), 50) s
   WHERE s.order_id = v_o;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'issue_1791 T-ESC1: rung 2 fired TWICE for one order';
  END IF;

  -- T+11 → rung 3, once.
  UPDATE public.venue_orders
     SET created_at = now() - interval '11 minutes',
         confirmed_at = now() - interval '11 minutes'
   WHERE id = v_o;
  SELECT count(*), max(s.rung) INTO v_rows, v_rung
    FROM public.pg_venue_order_escalation_scan(now(), 50) s WHERE s.order_id = v_o;
  IF v_rows <> 1 OR v_rung <> 3 THEN
    RAISE EXCEPTION 'issue_1791 T-ESC1: T+11 produced % row(s) at rung %', v_rows, v_rung;
  END IF;

  -- ...AND THEN IT STOPS. Not "slows down" — stops. An hour later, silence.
  UPDATE public.venue_orders
     SET created_at = now() - interval '3 hours',
         confirmed_at = now() - interval '3 hours'
   WHERE id = v_o;
  SELECT count(*) INTO v_rows FROM public.pg_venue_order_escalation_scan(now(), 50) s
   WHERE s.order_id = v_o;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'issue_1791 T-ESC1: the ladder kept nagging past rung 3';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_orders
                  WHERE id = v_o AND escalation_level = 3 AND escalated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_1791 T-ESC1 VACUITY: the order never reached rung 3 at all';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-ESC2 — WHAT THE LADDER MAY NEVER DO. This is the group that keeps the
-- three design corrections honest: NO auto-refund (D-7a), NO auto-pause
-- (D-7b), NO SMS (D-7c). The whole row is snapshotted before the sweep and
-- compared after: `escalation_level` and `escalated_at` are the ONLY columns
-- allowed to differ, on ANY row, anywhere.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_o uuid; v_before jsonb; v_after jsonb; v_diff text[]; v_rows int;
BEGIN
  v_o := pg_temp.mint_paid_order(4000, 500, now() - interval '12 minutes');
  -- Give the venue a settings row so "the sweep did not pause them" is a claim
  -- about a row that EXISTS rather than a vacuous absence.
  INSERT INTO public.venue_ordering_settings (venue_id, brand_id, ordering_enabled)
  VALUES (pg_temp.fx('venue'), pg_temp.fx('brand'), true)
  ON CONFLICT (venue_id) DO UPDATE SET ordering_enabled = true;

  SELECT to_jsonb(o) INTO v_before FROM public.venue_orders o WHERE o.id = v_o;

  SELECT count(*) INTO v_rows FROM public.pg_venue_order_escalation_scan(now(), 50) s
   WHERE s.order_id = v_o;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'issue_1791 T-ESC2 VACUITY: the sweep did not run on the order at all';
  END IF;

  SELECT to_jsonb(o) INTO v_after FROM public.venue_orders o WHERE o.id = v_o;
  -- `updated_at` is excluded because it is written by the SHARED touch trigger
  -- on every UPDATE of this table, not by the sweep's own SET list — it says
  -- "a row changed", which is the thing being measured, not evidence about
  -- WHAT changed. Every other column in the table is in scope.
  SELECT array_agg(b.key ORDER BY b.key) INTO v_diff
    FROM jsonb_each_text(v_before) b
   WHERE b.key <> 'updated_at'
     AND b.value IS DISTINCT FROM (v_after ->> b.key);
  IF v_diff IS DISTINCT FROM ARRAY['escalated_at','escalation_level'] THEN
    RAISE EXCEPTION
      'issue_1791 T-ESC2: the sweep wrote columns it may never write: %',
      array_to_string(v_diff, ', ');
  END IF;

  -- NO auto-refund. Not a queued one, not a prepared one, not a row at all.
  IF EXISTS (SELECT 1 FROM public.source_refunds
              WHERE source_type = 'venue_menu_order' AND source_id = v_o) THEN
    RAISE EXCEPTION 'issue_1791 T-ESC2: the escalation sweep started a refund on a TIMER';
  END IF;

  -- NO auto-pause. The venue's switch is untouched and ordering keeps flowing.
  IF EXISTS (SELECT 1 FROM public.venue_ordering_settings
              WHERE venue_id = pg_temp.fx('venue')
                AND (paused_at IS NOT NULL OR ordering_enabled = false)) THEN
    RAISE EXCEPTION 'issue_1791 T-ESC2: the escalation sweep switched off a venue''s ordering';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-ESC3 — an ACKNOWLEDGED order is never escalated, and neither is an unpaid
-- one. The ladder exists because money arrived where nobody was watching; a
-- ticket somebody has picked up, and a checkout nobody finished, are neither.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_acked uuid; v_pending uuid; v_rows int;
BEGIN
  v_acked := pg_temp.mint_paid_order(4000, 0, now() - interval '30 minutes');
  PERFORM pg_temp.act_as(pg_temp.fx('waiter'));
  PERFORM public.biz_venue_order_transition(v_acked, 'acknowledged', NULL);

  v_pending := pg_temp.mint_paid_order(4000, 0, now() - interval '30 minutes');
  UPDATE public.venue_orders SET payment_status = 'pending', confirmed_at = NULL
   WHERE id = v_pending;

  SELECT count(*) INTO v_rows FROM public.pg_venue_order_escalation_scan(now(), 50)
   WHERE order_id IN (v_acked, v_pending);
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'issue_1791 T-ESC3: the ladder escalated an acknowledged or unpaid order';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-ESC4 — the payload the sweep hands the push layer. A ticket with no spot
-- is a COUNTER PICKUP, and the alert has to say which one — a chef reading
-- "new order" with no destination has learned nothing (D-3a / D-3b).
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_o uuid; v_row record;
BEGIN
  v_o := pg_temp.mint_paid_order(2000, 0, now() - interval '4 minutes');
  UPDATE public.venue_orders
     SET qr_spot_id = NULL, spot_label_at_order = NULL, pickup_code = '42',
         source = 'guest_page', venue_table_id = NULL
   WHERE id = v_o;

  SELECT * INTO v_row FROM public.pg_venue_order_escalation_scan(now(), 50)
   WHERE order_id = v_o;
  IF v_row.order_id IS NULL THEN
    RAISE EXCEPTION 'issue_1791 T-ESC4 VACUITY: the counter-pickup order was never scanned';
  END IF;
  IF v_row.pickup_code <> '42' OR v_row.buyer_name <> 'Amara'
     OR v_row.venue_name <> 'The Brasserie' OR v_row.total_cents <= 0
     OR v_row.unacked_seconds < 120 THEN
    RAISE EXCEPTION
      'issue_1791 T-ESC4: the escalation payload cannot name the destination (code=%, name=%, venue=%, secs=%)',
      v_row.pickup_code, v_row.buyer_name, v_row.venue_name, v_row.unacked_seconds;
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-PAUSE1 — the venue's OWN pause switch, and its ONE writer (D-7b).
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_res jsonb; v_raised boolean;
BEGIN
  -- A rank-10 member cannot switch off their venue's takings.
  PERFORM pg_temp.act_as(pg_temp.fx('waiter'));
  v_raised := false;
  BEGIN PERFORM public.biz_venue_ordering_pause(pg_temp.fx('venue'), true);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM LIKE '%not_authorized%'; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1791 T-PAUSE1: a rank-10 member paused the venue';
  END IF;

  PERFORM pg_temp.act_as(pg_temp.fx('owner'));
  v_res := public.biz_venue_ordering_pause(pg_temp.fx('venue'), true);
  IF (v_res->>'paused')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'issue_1791 T-PAUSE1: pause did not report itself paused';
  END IF;
  -- The pause names WHO. An anonymous pause is not a venue decision.
  IF NOT EXISTS (SELECT 1 FROM public.venue_ordering_settings
                  WHERE venue_id = pg_temp.fx('venue')
                    AND paused_at IS NOT NULL
                    AND paused_by_user_id = pg_temp.fx('owner')) THEN
    RAISE EXCEPTION 'issue_1791 T-PAUSE1: the pause did not record the person who made it';
  END IF;

  v_res := public.biz_venue_ordering_pause(pg_temp.fx('venue'), false);
  IF (v_res->>'paused')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'issue_1791 T-PAUSE1: unpause did not clear the pause';
  END IF;
  IF EXISTS (SELECT 1 FROM public.venue_ordering_settings
              WHERE venue_id = pg_temp.fx('venue')
                AND (paused_at IS NOT NULL OR paused_by_user_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'issue_1791 T-PAUSE1: unpause left a half-cleared pause behind';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-OQ7 — the Phase-3 -> Phase-4 gate, made mechanical. `ordering_enabled`
-- has exactly one route to TRUE, it is manager-gated, and it refuses a venue
-- that would reject every order it let in.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_res jsonb; v_raised boolean; v_writers int;
BEGIN
  DELETE FROM public.venue_ordering_settings WHERE venue_id = pg_temp.fx('venue');

  PERFORM pg_temp.act_as(pg_temp.fx('waiter'));
  v_raised := false;
  BEGIN PERFORM public.biz_venue_ordering_set_enabled(pg_temp.fx('venue'), true);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM LIKE '%not_authorized%'; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1791 T-OQ7: a rank-10 member switched ordering ON';
  END IF;

  PERFORM pg_temp.act_as(pg_temp.fx('owner'));
  v_res := public.biz_venue_ordering_set_enabled(pg_temp.fx('venue'), true);
  IF (v_res->>'orderingEnabled')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'issue_1791 T-OQ7: the enable RPC did not enable ordering';
  END IF;

  -- An unverified venue would reject every order it let in (SPEC P-22 gate 2),
  -- so the switch refuses rather than creating a venue that takes money it
  -- cannot serve.
  -- 'pending_review' is a REAL pre-verification state from the venue_listings
  -- CHECK ('none','pending_review','verified','rejected','suspended','revoked') —
  -- i.e. a venue that has asked to be claimed but has not been approved yet,
  -- which is exactly the venue somebody would try to switch ordering on for.
  UPDATE public.venue_listings SET claim_status = 'pending_review' WHERE id = pg_temp.fx('venue');
  PERFORM public.biz_venue_ordering_set_enabled(pg_temp.fx('venue'), false);
  v_raised := false;
  BEGIN PERFORM public.biz_venue_ordering_set_enabled(pg_temp.fx('venue'), true);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM LIKE '%venue_not_orderable%'; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1791 T-OQ7: an unverified venue was switched on for ordering';
  END IF;
  UPDATE public.venue_listings SET claim_status = 'verified' WHERE id = pg_temp.fx('venue');

  -- SINGLE-WRITER PROOF: exactly ONE function body in the whole schema
  -- assigns venue_ordering_settings.paused_at, and exactly one sets
  -- ordering_enabled. A sweep that learned to pause a venue would show up here.
  SELECT count(*) INTO v_writers FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc ~ 'paused_by_user_id\s*=' ;
  IF v_writers <> 1 THEN
    RAISE EXCEPTION
      'issue_1791 T-OQ7: % function(s) write paused_by_user_id — D-7b says exactly ONE (the venue''s own switch)',
      v_writers;
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-GUEST1 — the guest's instant way out (D-7a). Cancel while nobody has
-- picked the order up: full refund INCLUDING the tip, no venue involvement.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_o uuid; v_res jsonb; v_refund public.source_refunds%ROWTYPE; v_total int;
BEGIN
  v_o := pg_temp.mint_paid_order(4000, 500);
  SELECT total_cents INTO v_total FROM public.venue_orders WHERE id = v_o;

  v_res := public.pg_venue_order_guest_action(
    v_o, pg_temp.guest_token(v_o), 'cancel', 'changed my mind');
  IF v_res->>'fulfillmentStatus' <> 'cancelled' THEN
    RAISE EXCEPTION 'issue_1791 T-GUEST1: the guest''s cancel did not cancel the order';
  END IF;

  SELECT * INTO v_refund FROM public.source_refunds
   WHERE source_type = 'venue_menu_order' AND source_id = v_o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'issue_1791 T-GUEST1: cancelling an unacknowledged order refunded nothing';
  END IF;
  IF v_refund.refund_kind <> 'venue_order_guest_cancel'
     OR v_refund.requested_by_type <> 'guest' THEN
    RAISE EXCEPTION 'issue_1791 T-GUEST1: the refund was minted with the wrong kind/actor';
  END IF;
  -- The TIP comes back too: nothing was served, so nothing was earned.
  IF v_refund.buyer_refund_requested_cents <> v_total THEN
    RAISE EXCEPTION
      'issue_1791 T-GUEST1: the guest was refunded % of a % order (the tip was kept)',
      v_refund.buyer_refund_requested_cents, v_total;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.source_refund_ledger_allocations
                  WHERE refund_id = v_refund.id AND allocation_type = 'buyer_refund') THEN
    RAISE EXCEPTION 'issue_1791 T-GUEST1: the refund has no buyer allocation to pay out';
  END IF;

  -- A replay of the same tap does not mint a second refund.
  v_res := public.pg_venue_order_guest_action(
    v_o, pg_temp.guest_token(v_o), 'cancel', NULL);
  IF (v_res->>'replayed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'issue_1791 T-GUEST1: a replayed cancel was not reported as a replay';
  END IF;
  IF (SELECT count(*) FROM public.source_refunds
       WHERE source_type = 'venue_menu_order' AND source_id = v_o) <> 1 THEN
    RAISE EXCEPTION 'issue_1791 T-GUEST1: a double-tap refunded the guest twice';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-GUEST2 — after acknowledgement the guest ASKS, and NO money moves until a
-- person decides. A wrong token gets nothing at all.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_o uuid; v_res jsonb; v_raised boolean;
BEGIN
  v_o := pg_temp.mint_paid_order(4000, 500);

  -- A stranger with a guessed token cannot touch somebody else's order.
  v_raised := false;
  BEGIN PERFORM public.pg_venue_order_guest_action(v_o, 'not-the-token', 'cancel', NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM LIKE '%not_authorized%'; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1791 T-GUEST2: a wrong cancel token was accepted';
  END IF;

  PERFORM pg_temp.act_as(pg_temp.fx('waiter'));
  PERFORM public.biz_venue_order_transition(v_o, 'acknowledged', NULL);

  -- Cancel is now off the table — the kitchen may already have fired it.
  v_raised := false;
  BEGIN PERFORM public.pg_venue_order_guest_action(
    v_o, pg_temp.guest_token(v_o), 'cancel', NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM LIKE '%transition_not_allowed%'; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1791 T-GUEST2: a guest cancelled an order the kitchen had picked up';
  END IF;

  v_res := public.pg_venue_order_guest_action(
    v_o, pg_temp.guest_token(v_o), 'request_refund', 'took too long');
  IF v_res->>'refundRequestedAt' IS NULL THEN
    RAISE EXCEPTION 'issue_1791 T-GUEST2: the refund request was not recorded';
  END IF;
  -- NOT ONE PENNY has moved.
  IF EXISTS (SELECT 1 FROM public.source_refunds
              WHERE source_type = 'venue_menu_order' AND source_id = v_o) THEN
    RAISE EXCEPTION 'issue_1791 T-GUEST2: a refund REQUEST moved money before a person decided';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_orders
                  WHERE id = v_o AND refund_requested_at IS NOT NULL
                    AND refund_decision IS NULL
                    AND metadata->>'guest_refund_reason' = 'took too long') THEN
    RAISE EXCEPTION 'issue_1791 T-GUEST2: the request did not land on the ticket as a decision';
  END IF;

  -- A delivered order is past self-service entirely.
  PERFORM public.biz_venue_order_transition(v_o, 'ready', NULL);
  PERFORM public.biz_venue_order_transition(v_o, 'delivered', NULL);
  UPDATE public.venue_orders SET refund_requested_at = NULL WHERE id = v_o;
  v_raised := false;
  BEGIN PERFORM public.pg_venue_order_guest_action(
    v_o, pg_temp.guest_token(v_o), 'request_refund', NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM LIKE '%refund_window_closed%'; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1791 T-GUEST2: a delivered order still offered self-service refunds';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-REF1 — the venue's APPROVE-OR-EXPLAIN. A decline must carry a reason,
-- because the guest reads it; an approval mints the refund on the shipped rail.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_o uuid; v_o2 uuid; v_raised boolean; v_res jsonb;
BEGIN
  -- (a) DECLINE.
  v_o := pg_temp.mint_paid_order(4000, 0);
  PERFORM pg_temp.act_as(pg_temp.fx('waiter'));
  PERFORM public.biz_venue_order_transition(v_o, 'acknowledged', NULL);
  PERFORM public.pg_venue_order_guest_action(
    v_o, pg_temp.guest_token(v_o), 'request_refund', 'cold');

  -- A rank-10 member does not decide money.
  v_raised := false;
  BEGIN PERFORM public.biz_venue_order_refund_decision(v_o, 'approved', NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM LIKE '%not_authorized%'; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1791 T-REF1: a rank-10 member approved a refund';
  END IF;

  PERFORM pg_temp.act_as(pg_temp.fx('owner'));
  v_raised := false;
  BEGIN PERFORM public.biz_venue_order_refund_decision(v_o, 'declined', NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM LIKE '%decline_reason_required%'; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1791 T-REF1: a refund was declined with no reason for the guest';
  END IF;

  PERFORM public.biz_venue_order_refund_decision(v_o, 'declined', 'It was made to order and served hot.');
  IF NOT EXISTS (SELECT 1 FROM public.venue_orders
                  WHERE id = v_o AND refund_decision = 'declined'
                    AND refund_decided_by_user_id = pg_temp.fx('owner')
                    AND metadata->>'refund_decision_note' IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_1791 T-REF1: the decline did not record who decided and why';
  END IF;
  IF EXISTS (SELECT 1 FROM public.source_refunds
              WHERE source_type = 'venue_menu_order' AND source_id = v_o) THEN
    RAISE EXCEPTION 'issue_1791 T-REF1: a DECLINED refund still moved money';
  END IF;

  -- (b) APPROVE.
  v_o2 := pg_temp.mint_paid_order(4000, 0);
  PERFORM pg_temp.act_as(pg_temp.fx('waiter'));
  PERFORM public.biz_venue_order_transition(v_o2, 'acknowledged', NULL);
  PERFORM public.pg_venue_order_guest_action(
    v_o2, pg_temp.guest_token(v_o2), 'request_refund', 'wrong dish');
  PERFORM pg_temp.act_as(pg_temp.fx('owner'));
  v_res := public.biz_venue_order_refund_decision(v_o2, 'approved', 'Our mistake.');
  IF v_res->>'decision' <> 'approved' THEN
    RAISE EXCEPTION 'issue_1791 T-REF1: the approval did not report itself';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.source_refunds
                  WHERE source_type = 'venue_menu_order' AND source_id = v_o2
                    AND refund_kind = 'venue_order_venue_approved'
                    AND requested_by_type = 'brand_staff'
                    AND requested_by_user_id = pg_temp.fx('owner')) THEN
    RAISE EXCEPTION 'issue_1791 T-REF1: an APPROVED refund minted nothing on the refund rail';
  END IF;

  -- A decision is made once.
  v_res := public.biz_venue_order_refund_decision(v_o2, 'declined', 'changed my mind');
  IF (v_res->>'replayed')::boolean IS NOT TRUE
     OR v_res->>'decision' <> 'approved' THEN
    RAISE EXCEPTION 'issue_1791 T-REF1: a decided refund was re-decided';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-SD1 — the LIVE ACL, not the presence of a REVOKE line. `REVOKE ... FROM
-- PUBLIC` alone does NOT clear the explicit `anon=X` entry that this project's
-- ALTER DEFAULT PRIVILEGES writes for every new public function — anon must be
-- named. #1790 found six functions left anon-executable exactly this way.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_fn text;
  v_service_only text[] := ARRAY[
    'pg_venue_order_escalation_scan',
    'pg_venue_order_mint_refund',
    'pg_venue_order_guest_action'];
  v_authed text[] := ARRAY[
    'biz_venue_order_transition',
    'biz_venue_order_refund_decision',
    'biz_venue_ordering_pause',
    'biz_venue_ordering_set_enabled'];
BEGIN
  FOREACH v_fn IN ARRAY (v_service_only || v_authed) LOOP
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = v_fn
         AND has_function_privilege('anon', p.oid, 'EXECUTE')) THEN
      RAISE EXCEPTION 'issue_1791 T-SD1: public.% is EXECUTE-able by anon', v_fn;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = v_fn) THEN
      RAISE EXCEPTION 'issue_1791 T-SD1 VACUITY: public.% does not exist', v_fn;
    END IF;
  END LOOP;

  -- The service-only three must NOT be reachable by a signed-in user: they
  -- take a user id or a token as an ARGUMENT, so an authenticated caller could
  -- otherwise act as somebody else.
  FOREACH v_fn IN ARRAY v_service_only LOOP
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = v_fn
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
      RAISE EXCEPTION
        'issue_1791 T-SD1: public.% is EXECUTE-able by authenticated — it takes identity as an argument', v_fn;
    END IF;
  END LOOP;

  -- ...and the four staff RPCs must STAY reachable by `authenticated`: they
  -- read auth.uid(), and revoking them would break the queue silently.
  FOREACH v_fn IN ARRAY v_authed LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = v_fn
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
      RAISE EXCEPTION 'issue_1791 T-SD1: public.% is no longer reachable by authenticated', v_fn;
    END IF;
  END LOOP;
END $t$;

-- ---------------------------------------------------------------------------
-- T-CAT1 — the two push types, and the reason neither carries 'sms' (D-7c).
-- The channel array is what makes "no SMS to staff" structural rather than a
-- code convention: `can_send()` reads this matrix.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_key text;
  v_channels text[];
BEGIN
  FOREACH v_key IN ARRAY ARRAY['business.venue_order_placed',
                               'business.venue_order_unacknowledged'] LOOP
    SELECT default_channels INTO v_channels
      FROM public.notification_categories WHERE key = v_key;
    IF v_channels IS NULL THEN
      RAISE EXCEPTION 'issue_1791 T-CAT1: notification category % was never seeded', v_key;
    END IF;
    IF 'sms' = ANY(v_channels) THEN
      RAISE EXCEPTION 'issue_1791 T-CAT1: % can reach SMS — D-7c dropped SMS from staff alerting', v_key;
    END IF;
    IF NOT ('push' = ANY(v_channels)) OR NOT ('inapp' = ANY(v_channels)) THEN
      RAISE EXCEPTION 'issue_1791 T-CAT1: % lost push or in-app — the ladder would go silent', v_key;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.notification_categories
                  WHERE key = 'business.venue_order_unacknowledged'
                    AND reach_mode = 'escalate_on_no_engagement') THEN
    RAISE EXCEPTION 'issue_1791 T-CAT1: the escalation type is not marked as escalating';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-RT1 — the realtime publication + the brand-member SELECT policy. Without
-- BOTH, the queue receives no realtime events AT ALL, silently — the exact
-- failure class ORCH-0854 exists to prevent.
-- ---------------------------------------------------------------------------
DO $t$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                    AND tablename = 'venue_orders') THEN
    RAISE EXCEPTION 'issue_1791 T-RT1: venue_orders is not in supabase_realtime — the queue is deaf';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'venue_orders'
                    AND cmd = 'SELECT') THEN
    RAISE EXCEPTION 'issue_1791 T-RT1: venue_orders has no SELECT policy — realtime delivers nothing';
  END IF;
  -- Writes stay service-role only: a client that could UPDATE an order could
  -- acknowledge one without a human.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'venue_orders'
                AND cmd IN ('UPDATE', 'INSERT', 'DELETE', 'ALL')) THEN
    RAISE EXCEPTION 'issue_1791 T-RT1: venue_orders grew a client write policy';
  END IF;
END $t$;

ROLLBACK;
