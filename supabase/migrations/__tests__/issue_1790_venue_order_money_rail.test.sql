-- ===========================================================================
-- Issue #1790 (SPEC #1788 Phase 2) — the venue_orders money rail, executed.
--
-- Every group names the change it guards and FAILS when that change is
-- reverted. This is a BEHAVIOURAL suite: it writes real rows through the real
-- CHECKs, runs the real payout sweep, and reverts each of the FIVE payout
-- widenings in turn to prove each one fails LOUDLY rather than silently
-- skipping money (T-P3).
--
-- Runs inside ONE transaction and ROLLBACKs — it leaves no rows behind.
-- ===========================================================================
BEGIN;

-- Fixtures shared by every group.
CREATE TEMP TABLE t1790_fx (k text PRIMARY KEY, v uuid);

DO $seed$
DECLARE
  v_brand uuid; v_venue uuid; v_table uuid; v_spot uuid; v_menu uuid;
  v_item uuid; v_group uuid; v_mod uuid; v_user uuid; v_res uuid;
BEGIN
  INSERT INTO auth.users DEFAULT VALUES RETURNING id INTO v_user;
  INSERT INTO public.brands (name, payment_provider, payout_hold_cutover_at)
  VALUES ('issue-1790 brand', 'stripe', now() - interval '365 days')
  RETURNING id INTO v_brand;
  INSERT INTO public.venue_listings (brand_id, claim_status)
  VALUES (v_brand, 'verified') RETURNING id INTO v_venue;
  INSERT INTO public.venue_tables (brand_id, venue_id, name, zone)
  VALUES (v_brand, v_venue, 'Table 12', 'indoor') RETURNING id INTO v_table;
  -- #1789's P-7c auto-provision trigger mints the spot for a new table, and
  -- qr_spots_table_uniq means there is AT MOST ONE per physical unit. Take the
  -- one the trigger made rather than racing it — the venue never manages two
  -- lists, and a fixture that inserted its own would be testing a shape the
  -- product cannot produce.
  SELECT id INTO v_spot FROM public.qr_spots WHERE venue_table_id = v_table;
  IF v_spot IS NULL THEN
    INSERT INTO public.qr_spots (brand_id, venue_id, kind, venue_table_id, label,
                                 serving_venue_id, code)
    VALUES (v_brand, v_venue, 'table', v_table, 'Table 12', v_venue, 'kq7m3pd2xr')
    RETURNING id INTO v_spot;
  END IF;
  INSERT INTO public.menus (brand_id, venue_id, name)
  VALUES (v_brand, v_venue, 'All day') RETURNING id INTO v_menu;
  INSERT INTO public.menu_items (menu_id, brand_id, name, price_cents, currency)
  VALUES (v_menu, v_brand, 'Negroni', 1200, 'GBP') RETURNING id INTO v_item;
  INSERT INTO public.menu_modifier_groups (menu_item_id, brand_id, name, selection_mode, min_select, max_select)
  VALUES (v_item, v_brand, 'Ice', 'single', 1, 1) RETURNING id INTO v_group;
  INSERT INTO public.menu_modifiers (group_id, brand_id, name, price_delta_cents, currency)
  VALUES (v_group, v_brand, 'No ice', 0, 'GBP') RETURNING id INTO v_mod;
  INSERT INTO public.reservations (venue_id, party_size, status)
  VALUES (v_venue, 4, 'seated') RETURNING id INTO v_res;

  INSERT INTO t1790_fx VALUES
    ('brand', v_brand), ('venue', v_venue), ('table', v_table), ('spot', v_spot),
    ('menu', v_menu), ('item', v_item), ('group', v_group), ('modifier', v_mod),
    ('user', v_user), ('reservation', v_res);
END $seed$;

CREATE OR REPLACE FUNCTION pg_temp.fx(p_k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v FROM t1790_fx WHERE k = p_k $$;

-- A Mingla-path order that satisfies every CHECK. Callers override what they
-- are attacking. Returns the new order id.
CREATE OR REPLACE FUNCTION pg_temp.mint_order(
  p_session uuid,
  p_subtotal int DEFAULT 4000,
  p_service_charge int DEFAULT 500,
  p_tip int DEFAULT 0,
  p_take_rate_bps int DEFAULT 1000,
  p_service_fee_bps int DEFAULT 300,
  p_key text DEFAULT NULL,
  p_created timestamptz DEFAULT now()
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_basis int := p_subtotal + p_service_charge;
  v_fee int := round(v_basis::numeric * p_take_rate_bps / 10000);
  v_svc int := round(v_basis::numeric * p_service_fee_bps / 10000);
  v_buyer int := v_basis + v_fee + v_svc;   -- both fees PASSED
  v_id uuid;
BEGIN
  INSERT INTO public.venue_orders (
    session_id, brand_id, venue_id, qr_spot_id, spot_label_at_order,
    venue_table_id, zone_at_order, reservation_id, source,
    buyer_name, buyer_email, buyer_phone_e164,
    money_path, currency, subtotal_cents, service_charge_bps, service_charge_cents,
    tip_cents, effective_take_rate_bps, service_fee_bps, mingla_fee_cents,
    platform_service_fee_cents, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, tax_amount_cents, total_cents,
    provider, payment_status, confirmed_at, idempotency_key, created_at
  ) VALUES (
    p_session, pg_temp.fx('brand'), pg_temp.fx('venue'), pg_temp.fx('spot'), 'Table 12',
    pg_temp.fx('table'), 'indoor', pg_temp.fx('reservation'), 'guest_qr',
    'Ada', 'ada@example.test', '+12015550199',
    'mingla', 'GBP', p_subtotal, 1250, p_service_charge,
    p_tip, p_take_rate_bps, p_service_fee_bps, v_fee,
    v_svc, true, true, false,
    v_buyer, 0, v_buyer + p_tip,
    'stripe', 'paid', p_created, coalesce(p_key, 'idem:' || gen_random_uuid()::text), p_created
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.mint_session(p_currency text DEFAULT 'GBP')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.venue_order_sessions (brand_id, venue_id, qr_spot_id,
    reservation_id, party_size_claimed, currency)
  VALUES (pg_temp.fx('brand'), pg_temp.fx('venue'), pg_temp.fx('spot'),
    pg_temp.fx('reservation'), 4, p_currency)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- T-M1 — migration integrity: the family exists with the shapes the whole
-- programme is built on. A missing column here is a Phase 3-7 rewrite.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_missing text;
BEGIN
  FOR v_missing IN
    SELECT t FROM unnest(ARRAY[
      'venue_order_sessions','venue_orders','venue_order_items',
      'venue_order_item_modifiers','venue_order_rate_limits']) t
    WHERE to_regclass('public.' || t) IS NULL
  LOOP
    RAISE EXCEPTION 'issue_1790 T-M1: table public.% is missing', v_missing;
  END LOOP;

  -- P-56: the columns that cannot be retrofitted. Losing any of these makes
  -- every "measured" claim in Phase 6/7 a permanent guess.
  FOR v_missing IN
    SELECT c FROM unnest(ARRAY[
      'session_id','reservation_id','qr_spot_id','venue_table_id','stay_unit_id',
      'zone_at_order','spot_label_at_order','source','taken_by_user_id',
      'fulfillment_status','tip_cents','buyer_user_id','buyer_name','buyer_email',
      'buyer_phone_e164','entry_source','pickup_code']) c
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='venue_orders' AND column_name=c)
  LOOP
    RAISE EXCEPTION 'issue_1790 T-M1: venue_orders.% (P-56 bound column) is missing', v_missing;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='venue_order_sessions'
      AND column_name='party_size_claimed') THEN
    RAISE EXCEPTION 'issue_1790 T-M1: venue_order_sessions.party_size_claimed is missing';
  END IF;

  -- OQ-3 seam: the column exists and NOTHING in the repo writes a code into it.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='venue_order_items'
      AND column_name='tax_code' AND is_nullable='YES') THEN
    RAISE EXCEPTION 'issue_1790 T-M1: the nullable per-item tax_code seam (OQ-3) is missing';
  END IF;

  -- fee_basis_cents must be GENERATED, not a plain column a writer can set.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='venue_orders'
      AND column_name='fee_basis_cents' AND is_generated='ALWAYS') THEN
    RAISE EXCEPTION 'issue_1790 T-M1: fee_basis_cents is not GENERATED ALWAYS — a tip could be written into the fee basis';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-M2 — ROUNDING PARITY (P-3a). The CHECK compares a Postgres round(numeric)
-- against the value the shipped TS engine wrote via
-- feeFromBps = Math.round((base*bps)/10000) (_shared/allInPricingEngine.ts:176-178).
-- Both must equal exact half-away-from-zero integer division on every input in
-- the spec's grid. The TS half of this parity runs in
-- supabase/functions/_shared/__tests__/issue_1790_venue_order_pricing.test.ts
-- over the SAME grid and the SAME exact-integer oracle, so the two runtimes
-- cannot drift without one of them going red.
-- Vacuity guard: the sweep must actually compare something.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_bad bigint;
  v_n bigint;
BEGIN
  SELECT count(*) INTO v_n
  FROM generate_series(0, 100000) AS basis(b)
  CROSS JOIN unnest(ARRAY[0, 250, 300, 500, 1000, 1500]) AS r(bps);
  IF v_n <> 600006 THEN
    RAISE EXCEPTION 'issue_1790 T-M2 VACUITY: grid is % rows, expected 600006', v_n;
  END IF;

  SELECT count(*) INTO v_bad
  FROM generate_series(0, 100000) AS basis(b)
  CROSS JOIN unnest(ARRAY[0, 250, 300, 500, 1000, 1500]) AS r(bps)
  WHERE round(b::numeric * bps / 10000) <> ((b::bigint * bps + 5000) / 10000);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'issue_1790 T-M2: SQL round() diverges from the exact half-up oracle on % of % points', v_bad, v_n;
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-T1 — A TIP IS NEVER FEE'D (I-PROPOSED-1767-NO-CUT-OF-A-TIP).
-- A GBP40 order with a 12.5% service charge and a GBP10 tip must carry exactly
-- the same mingla_fee_cents as the same order with no tip, and a hand-crafted
-- UPDATE that inflates the fee must be REJECTED by the database.
-- Reverting the GENERATED column or CHECK 1 makes this red.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_s uuid; v_tipped uuid; v_plain uuid;
  v_fee_tipped int; v_fee_plain int; v_basis int; v_total int;
  v_raised boolean := false;
BEGIN
  v_s := pg_temp.mint_session();
  v_tipped := pg_temp.mint_order(v_s, 4000, 500, 1000);
  v_plain  := pg_temp.mint_order(v_s, 4000, 500, 0);

  SELECT mingla_fee_cents, fee_basis_cents, total_cents
    INTO v_fee_tipped, v_basis, v_total FROM public.venue_orders WHERE id = v_tipped;
  SELECT mingla_fee_cents INTO v_fee_plain FROM public.venue_orders WHERE id = v_plain;

  IF v_basis <> 4500 THEN
    RAISE EXCEPTION 'issue_1790 T-T1: fee_basis_cents is % — expected 4500 (subtotal 4000 + service charge 500, tip EXCLUDED)', v_basis;
  END IF;
  IF v_fee_tipped <> v_fee_plain THEN
    RAISE EXCEPTION 'issue_1790 T-T1: a GBP10 tip changed the Mingla fee (% vs %) — the tip entered the fee basis', v_fee_tipped, v_fee_plain;
  END IF;
  IF v_fee_tipped <> 450 THEN
    RAISE EXCEPTION 'issue_1790 T-T1: mingla_fee_cents is % — expected round(4500 * 1000 / 10000) = 450', v_fee_tipped;
  END IF;
  IF v_total <> (SELECT buyer_subtotal_cents + tax_amount_cents + 1000 FROM public.venue_orders WHERE id = v_tipped) THEN
    RAISE EXCEPTION 'issue_1790 T-T1: the tip is not riding on top of the total';
  END IF;

  BEGIN
    UPDATE public.venue_orders SET mingla_fee_cents = 550 WHERE id = v_tipped;
  EXCEPTION WHEN check_violation THEN v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1790 T-T1: a fee inflated beyond the basis was ACCEPTED — venue_orders_fee_from_basis is gone';
  END IF;

  -- And the basis itself is unwritable.
  v_raised := false;
  BEGIN
    UPDATE public.venue_orders SET fee_basis_cents = 5500 WHERE id = v_tipped;
  EXCEPTION WHEN OTHERS THEN v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1790 T-T1: fee_basis_cents was directly writable';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-A1 — ACK IS A HUMAN TAP (I-PROPOSED-1767-ACK-IS-A-HUMAN-TAP).
-- The unacknowledged-but-progressing state is not merely untested; it is
-- unwritable, even by a direct service-role UPDATE.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_s uuid; v_o uuid; v_raised boolean;
BEGIN
  v_s := pg_temp.mint_session();
  v_o := pg_temp.mint_order(v_s);

  v_raised := false;
  BEGIN
    UPDATE public.venue_orders
       SET fulfillment_status='acknowledged', acknowledged_at=now(),
           acknowledged_by_user_id=NULL
     WHERE id = v_o;
  EXCEPTION WHEN check_violation THEN v_raised := true; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1790 T-A1: an acknowledgement with a NULL user id was ACCEPTED';
  END IF;

  v_raised := false;
  BEGIN
    UPDATE public.venue_orders SET fulfillment_status='ready' WHERE id = v_o;
  EXCEPTION WHEN check_violation THEN v_raised := true; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1790 T-A1: an order advanced past `placed` with no acknowledgement';
  END IF;

  -- `cancelled` is the ONE legal exit from `placed` without a tap (the guest's
  -- own way out — D-7a). It must still work.
  UPDATE public.venue_orders SET fulfillment_status='cancelled', cancelled_at=now()
   WHERE id = v_o;

  -- A real tap, by a real person, is accepted.
  v_o := pg_temp.mint_order(v_s);
  UPDATE public.venue_orders
     SET fulfillment_status='acknowledged', acknowledged_at=now(),
         acknowledged_by_user_id=pg_temp.fx('user')
   WHERE id = v_o;
  IF NOT EXISTS (SELECT 1 FROM public.venue_orders
                 WHERE id=v_o AND acknowledged_by_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_1790 T-A1 VACUITY: a legitimate human ack did not persist';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-VC1 — VENUE-COLLECTED IS NOT MINGLA MONEY.
-- A venue_collected order cannot carry a provider, a Mingla fee, a platform
-- fee, Mingla-computed tax, or a refund. Each is a separate CHECK arm.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_s uuid; v_o uuid; v_raised boolean;
BEGIN
  v_s := pg_temp.mint_session();
  INSERT INTO public.venue_orders (
    session_id, brand_id, venue_id, qr_spot_id, source, taken_by_user_id,
    buyer_name, money_path, currency, subtotal_cents, service_charge_bps,
    service_charge_cents, tip_cents, effective_take_rate_bps, service_fee_bps,
    mingla_fee_cents, platform_service_fee_cents, pass_mingla_fee,
    pass_service_fee, pass_tax, buyer_subtotal_cents, tax_amount_cents,
    total_cents, payment_status, idempotency_key
  ) VALUES (
    v_s, pg_temp.fx('brand'), pg_temp.fx('venue'), pg_temp.fx('spot'), 'staff',
    pg_temp.fx('user'), 'Ada', 'venue_collected', 'GBP', 4000, 1250, 500, 0,
    0, 0, 0, 0, false, false, false, 4500, 0, 4500, 'pending',
    'idem:vc:' || gen_random_uuid()::text
  ) RETURNING id INTO v_o;

  v_raised := false;
  BEGIN UPDATE public.venue_orders SET provider='stripe' WHERE id=v_o;
  EXCEPTION WHEN check_violation THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'issue_1790 T-VC1: a venue_collected order accepted a PROVIDER'; END IF;

  v_raised := false;
  BEGIN UPDATE public.venue_orders SET effective_take_rate_bps=1000, mingla_fee_cents=450 WHERE id=v_o;
  EXCEPTION WHEN check_violation THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'issue_1790 T-VC1: a venue_collected order accepted a MINGLA FEE'; END IF;

  v_raised := false;
  BEGIN UPDATE public.venue_orders SET tax_amount_cents=100, total_cents=4600 WHERE id=v_o;
  EXCEPTION WHEN check_violation THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'issue_1790 T-VC1: a venue_collected order accepted MINGLA-COMPUTED TAX'; END IF;

  -- ...and a mingla-path order cannot exist without a provider.
  v_raised := false;
  BEGIN
    UPDATE public.venue_orders SET money_path='mingla' WHERE id=v_o;
  EXCEPTION WHEN check_violation THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'issue_1790 T-VC1: a mingla-path order with no provider was ACCEPTED'; END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-D1 — destination + source shapes. An order with neither a spot nor a
-- pickup code is unwritable; a staff order without a person is unwritable.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_s uuid; v_raised boolean;
BEGIN
  v_s := pg_temp.mint_session();

  v_raised := false;
  BEGIN
    INSERT INTO public.venue_orders (
      session_id, brand_id, venue_id, source, money_path, currency,
      subtotal_cents, service_charge_cents, effective_take_rate_bps,
      service_fee_bps, mingla_fee_cents, platform_service_fee_cents,
      pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents,
      total_cents, provider, idempotency_key
    ) VALUES (
      v_s, pg_temp.fx('brand'), pg_temp.fx('venue'), 'guest_page', 'mingla', 'GBP',
      1000, 0, 0, 0, 0, 0, false, false, false, 1000, 1000, 'stripe',
      'idem:nodest:' || gen_random_uuid()::text);
  EXCEPTION WHEN check_violation THEN v_raised := true; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1790 T-D1: an order with NEITHER a spot NOR a pickup code was accepted';
  END IF;

  v_raised := false;
  BEGIN
    INSERT INTO public.venue_orders (
      session_id, brand_id, venue_id, qr_spot_id, source, money_path, currency,
      subtotal_cents, service_charge_cents, effective_take_rate_bps,
      service_fee_bps, mingla_fee_cents, platform_service_fee_cents,
      pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents,
      total_cents, provider, idempotency_key
    ) VALUES (
      v_s, pg_temp.fx('brand'), pg_temp.fx('venue'), pg_temp.fx('spot'), 'staff',
      'mingla', 'GBP', 1000, 0, 0, 0, 0, 0, false, false, false, 1000, 1000,
      'stripe', 'idem:nostaff:' || gen_random_uuid()::text);
  EXCEPTION WHEN check_violation THEN v_raised := true; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1790 T-D1: a staff order with no taken_by_user_id was accepted';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-X1 — cross-brand splice. A brand can never stamp another brand's venue
-- onto a sitting or an order (P-3c).
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_other_brand uuid; v_raised boolean := false;
BEGIN
  INSERT INTO public.brands (name) VALUES ('issue-1790 other') RETURNING id INTO v_other_brand;
  BEGIN
    INSERT INTO public.venue_order_sessions (brand_id, venue_id, currency)
    VALUES (v_other_brand, pg_temp.fx('venue'), 'GBP');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM LIKE '%venue_brand_mismatch%'; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1790 T-X1: a cross-brand venue splice was accepted on venue_order_sessions';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-S1 — PRICE SNAPSHOT AT ORDER. A later rename / re-price never mutates a
-- historical line, and a menu item with sales history cannot be hard-deleted.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_s uuid; v_o uuid; v_line uuid; v_name text; v_price int; v_raised boolean := false;
BEGIN
  v_s := pg_temp.mint_session();
  v_o := pg_temp.mint_order(v_s, 1200, 0, 0);
  INSERT INTO public.venue_order_items (
    venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
    currency, quantity, modifiers_total_cents, line_total_cents)
  VALUES (v_o, pg_temp.fx('item'), 1, 'Negroni', 1200, 'GBP', 1, 0, 1200)
  RETURNING id INTO v_line;

  UPDATE public.menu_items SET name='Negroni Sbagliato', price_cents=1500
   WHERE id = pg_temp.fx('item');

  SELECT item_name_at_order, unit_price_cents INTO v_name, v_price
    FROM public.venue_order_items WHERE id = v_line;
  IF v_name <> 'Negroni' OR v_price <> 1200 THEN
    RAISE EXCEPTION 'issue_1790 T-S1: a menu edit mutated a historical order line (% / %)', v_name, v_price;
  END IF;

  BEGIN
    DELETE FROM public.menu_items WHERE id = pg_temp.fx('item');
  EXCEPTION WHEN foreign_key_violation THEN v_raised := true; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1790 T-S1: a menu item with sales history was hard-deleted out from under the numbers';
  END IF;

  -- The line arithmetic is enforced, not assumed.
  v_raised := false;
  BEGIN
    UPDATE public.venue_order_items SET quantity = 2 WHERE id = v_line;
  EXCEPTION WHEN check_violation THEN v_raised := true; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1790 T-S1: line_total_cents drifted from (unit + modifiers) * quantity';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-RL1 — the per-spot limiter (OQ-5). 10 per minute, and the 11th is refused.
-- The CALLER fails open when the limiter itself errors; that half is proved in
-- the Deno suite (the edge fn's try/catch).
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v jsonb; i int;
BEGIN
  FOR i IN 1..10 LOOP
    v := public.pg_venue_order_rate_limit_hit('spot:issue-1790', 10);
    IF (v->>'allowed')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'issue_1790 T-RL1: order % of 10 was refused inside the limit', i;
    END IF;
  END LOOP;
  v := public.pg_venue_order_rate_limit_hit('spot:issue-1790', 10);
  IF (v->>'allowed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'issue_1790 T-RL1: the 11th order in a minute was allowed';
  END IF;
  -- A DIFFERENT spot is unaffected — the limit is per spot, not per venue.
  v := public.pg_venue_order_rate_limit_hit('spot:issue-1790-other', 10);
  IF (v->>'allowed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'issue_1790 T-RL1: one busy table throttled a different table';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-TAB1 — the tab lifecycle (P-2a). A tab only exists because a human opened
-- it; `venue_collected` closes with no provider and no fee; `per_round` is not
-- a close method.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_s uuid; v_o uuid; v_res jsonb; v_raised boolean;
BEGIN
  PERFORM set_config('harness.uid', pg_temp.fx('user')::text, true);
  PERFORM set_config('harness.rank', '100', true);

  v_s := pg_temp.mint_session();

  -- No staff id => no tab, structurally.
  v_raised := false;
  BEGIN
    UPDATE public.venue_order_sessions SET tab_state='open' WHERE id=v_s;
  EXCEPTION WHEN check_violation THEN v_raised := true; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1790 T-TAB1: a tab opened with no staff user id';
  END IF;

  v_res := public.biz_venue_tab_open(v_s);
  IF v_res->>'tabState' <> 'open' THEN
    RAISE EXCEPTION 'issue_1790 T-TAB1: biz_venue_tab_open did not open the tab';
  END IF;

  INSERT INTO public.venue_orders (
    session_id, brand_id, venue_id, qr_spot_id, source, taken_by_user_id,
    buyer_name, money_path, currency, subtotal_cents, service_charge_bps,
    service_charge_cents, tip_cents, effective_take_rate_bps, service_fee_bps,
    mingla_fee_cents, platform_service_fee_cents, pass_mingla_fee,
    pass_service_fee, pass_tax, buyer_subtotal_cents, tax_amount_cents,
    total_cents, payment_status, idempotency_key
  ) VALUES (
    v_s, pg_temp.fx('brand'), pg_temp.fx('venue'), pg_temp.fx('spot'), 'staff',
    pg_temp.fx('user'), 'Ada', 'venue_collected', 'GBP', 3000, 0, 0, 0,
    0, 0, 0, 0, false, false, false, 3000, 0, 3000, 'pending',
    'idem:tab:' || gen_random_uuid()::text
  ) RETURNING id INTO v_o;

  v_raised := false;
  BEGIN PERFORM public.biz_venue_tab_close(v_s, 'per_round');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM LIKE '%invalid_settlement_method%'; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1790 T-TAB1: `per_round` was accepted as a close method';
  END IF;

  v_res := public.biz_venue_tab_close(v_s, 'venue_collected');
  IF v_res->>'tabState' <> 'closed' THEN
    RAISE EXCEPTION 'issue_1790 T-TAB1: a venue_collected tab did not close immediately';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_order_sessions
                 WHERE id=v_s AND closed_by_user_id IS NOT NULL
                   AND settlement_method='venue_collected') THEN
    RAISE EXCEPTION 'issue_1790 T-TAB1: a closed tab does not name who closed it and how';
  END IF;
  IF EXISTS (SELECT 1 FROM public.venue_orders
             WHERE id=v_o AND (provider IS NOT NULL OR mingla_fee_cents <> 0)) THEN
    RAISE EXCEPTION 'issue_1790 T-TAB1: a cash-settled tab produced a provider or a Mingla fee';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_orders WHERE id=v_o AND payment_status='paid') THEN
    RAISE EXCEPTION 'issue_1790 T-TAB1 VACUITY: the child order was never settled';
  END IF;

  -- A closed tab cannot be closed again.
  v_raised := false;
  BEGIN PERFORM public.biz_venue_tab_close(v_s, 'venue_collected');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM LIKE '%tab_not_open%'; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1790 T-TAB1: a closed tab was closed a second time';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-RF1 — the refund plane accepts `venue_menu_order` and its TWO kinds, and
-- there is no third, because there is no automatic one
-- (I-PROPOSED-1767-NO-MONEY-ON-A-TIMER). Widening 4 of five.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_s uuid; v_o uuid; v_raised boolean; v_kind text;
BEGIN
  v_s := pg_temp.mint_session();
  v_o := pg_temp.mint_order(v_s);

  FOREACH v_kind IN ARRAY ARRAY['venue_order_guest_cancel','venue_order_venue_approved'] LOOP
    INSERT INTO public.source_refunds (
      source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
      requested_by_type, reason, provider, currency, original_charge_cents,
      buyer_refund_requested_cents, provider_payment_reference, idempotency_key
    ) VALUES (
      'venue_menu_order', v_o, v_o, pg_temp.fx('brand'), pg_temp.fx('venue'), v_kind,
      CASE WHEN v_kind='venue_order_guest_cancel' THEN 'guest' ELSE 'brand_staff' END,
      'issue-1790 test', 'stripe', 'GBP', 5000, 5000,
      'pi_test_1790', 'idem:sr:' || v_kind || ':' || v_o::text);
  END LOOP;

  -- A venue-order refund must name a venue and NEVER an event.
  v_raised := false;
  BEGIN
    INSERT INTO public.source_refunds (
      source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
      requested_by_type, reason, provider, currency, original_charge_cents,
      buyer_refund_requested_cents, provider_payment_reference, idempotency_key
    ) VALUES (
      'venue_menu_order', v_o, v_o, pg_temp.fx('brand'), NULL, 'venue_order_guest_cancel',
      'guest', 'issue-1790 test', 'stripe', 'GBP', 5000, 5000,
      'pi_test_1790b', 'idem:sr:novenue:' || v_o::text);
  EXCEPTION WHEN check_violation THEN v_raised := true; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1790 T-RF1: a venue_menu_order refund with no venue_id was accepted';
  END IF;

  -- No third kind.
  v_raised := false;
  BEGIN
    INSERT INTO public.source_refunds (
      source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
      requested_by_type, reason, provider, currency, original_charge_cents,
      buyer_refund_requested_cents, provider_payment_reference, idempotency_key
    ) VALUES (
      'venue_menu_order', v_o, v_o, pg_temp.fx('brand'), pg_temp.fx('venue'),
      'venue_order_auto_timeout', 'system', 'issue-1790 test', 'stripe', 'GBP',
      5000, 5000, 'pi_test_1790c', 'idem:sr:auto:' || v_o::text);
  EXCEPTION WHEN check_violation THEN v_raised := true; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1790 T-RF1: an AUTOMATIC refund kind was accepted — I-PROPOSED-1767-NO-MONEY-ON-A-TIMER is unenforced';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-P1 — PAYOUT ATTACH. A paid Mingla-path order with a fee snapshot attaches
-- at exactly created_at + 3 days with surface='venue_menu_order',
-- occurrence_key='venue_order:<id>', event_id NULL, partner_share_cents = 0.
-- T-P2 — a venue_collected order past +4d produces ZERO candidates.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_s uuid; v_paid uuid; v_cash uuid; v_created timestamptz := now() - interval '10 days';
  v_res jsonb; v_rel record; v_cnt int;
BEGIN
  v_s := pg_temp.mint_session();
  v_paid := pg_temp.mint_order(v_s, 4000, 500, 1000, 1000, 300, 'idem:p1', v_created);
  INSERT INTO public.payout_source_fee_snapshots (source_type, source_id, provider_fee_cents)
  VALUES ('venue_menu_order', v_paid, 120);

  INSERT INTO public.venue_orders (
    session_id, brand_id, venue_id, qr_spot_id, source, taken_by_user_id,
    buyer_name, money_path, currency, subtotal_cents, service_charge_bps,
    service_charge_cents, tip_cents, effective_take_rate_bps, service_fee_bps,
    mingla_fee_cents, platform_service_fee_cents, pass_mingla_fee,
    pass_service_fee, pass_tax, buyer_subtotal_cents, tax_amount_cents,
    total_cents, payment_status, confirmed_at, idempotency_key, created_at
  ) VALUES (
    v_s, pg_temp.fx('brand'), pg_temp.fx('venue'), pg_temp.fx('spot'), 'staff',
    pg_temp.fx('user'), 'Ada', 'venue_collected', 'GBP', 9900, 0, 0, 0,
    0, 0, 0, 0, false, false, false, 9900, 0, 9900, 'paid', v_created,
    'idem:p2-cash', v_created
  ) RETURNING id INTO v_cash;

  -- ONE sweep, past +3d for both.
  v_res := public.run_payout_release_dark_sweep(now());

  SELECT * INTO v_rel FROM public.brand_payout_releases
   WHERE surface='venue_menu_order';
  IF v_rel IS NULL THEN
    RAISE EXCEPTION 'issue_1790 T-P1: the sweep produced NO venue_menu_order release';
  END IF;
  IF v_rel.event_id IS NOT NULL OR v_rel.event_date_id IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1790 T-P1: an event-less surface produced an event-keyed release';
  END IF;
  IF v_rel.occurrence_key <> ('venue_order:' || v_paid::text) THEN
    RAISE EXCEPTION 'issue_1790 T-P1: occurrence_key is % — expected venue_order:%', v_rel.occurrence_key, v_paid;
  END IF;
  IF v_rel.releasable_at <> v_created + interval '3 days' THEN
    RAISE EXCEPTION 'issue_1790 T-P1: releasable_at is % — the anchor is not created_at + 3 days', v_rel.releasable_at;
  END IF;
  IF v_rel.partner_share_cents <> 0 THEN
    RAISE EXCEPTION 'issue_1790 T-P1 / P-50: partner_share_cents is % — NG partner share must be 0 at launch', v_rel.partner_share_cents;
  END IF;
  IF v_rel.mingla_fee_cents <> 450 THEN
    RAISE EXCEPTION 'issue_1790 T-P1: mingla_fee_cents is % — the arm must use ORDER-arm semantics, not the reservation arm''s literal 0', v_rel.mingla_fee_cents;
  END IF;

  SELECT count(*) INTO v_cnt FROM public.payout_release_items
   WHERE source_type='venue_menu_order' AND source_id = v_cash;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'issue_1790 T-P2: a venue_collected order entered the payout ledger';
  END IF;
  SELECT count(*) INTO v_cnt FROM public.payout_source_fee_snapshots
   WHERE source_type='venue_menu_order' AND source_id = v_cash;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'issue_1790 T-P2: a venue_collected order produced a fee snapshot';
  END IF;

  -- Re-running the sweep is idempotent: no second release, no duplicate item.
  PERFORM public.run_payout_release_dark_sweep(now());
  SELECT count(*) INTO v_cnt FROM public.payout_release_items
   WHERE source_type='venue_menu_order';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'issue_1790 T-P1: a re-run of the sweep produced % items for one order', v_cnt;
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-P1b — an order that has NOT matured does not attach, and one with no fee
-- snapshot WAITS rather than releasing on a guess (P-49.3).
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_s uuid; v_young uuid; v_nosnap uuid; v_cnt int;
BEGIN
  v_s := pg_temp.mint_session();
  v_young  := pg_temp.mint_order(v_s, 1000, 0, 0, 1000, 300, 'idem:young',  now() - interval '1 day');
  v_nosnap := pg_temp.mint_order(v_s, 1000, 0, 0, 1000, 300, 'idem:nosnap', now() - interval '10 days');
  INSERT INTO public.payout_source_fee_snapshots (source_type, source_id, provider_fee_cents)
  VALUES ('venue_menu_order', v_young, 10);

  PERFORM public.run_payout_release_dark_sweep(now());

  SELECT count(*) INTO v_cnt FROM public.payout_release_items
   WHERE source_id IN (v_young, v_nosnap);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'issue_1790 T-P1b: % immature/snapshot-less orders released early', v_cnt;
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-P4 — HALF-REFUNDED ORDER. An unreconciled source_refunds row must exclude
-- the order via BOTH the arm predicate AND the per-row guard at the old :1843.
-- The guard is proved separately by feeding attach_payout_release a row the arm
-- predicate would have passed.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_s uuid; v_o uuid; v_cnt int; v_def text;
BEGIN
  v_s := pg_temp.mint_session();
  v_o := pg_temp.mint_order(v_s, 4000, 0, 0, 1000, 300, 'idem:halfrefund', now() - interval '10 days');
  INSERT INTO public.payout_source_fee_snapshots (source_type, source_id, provider_fee_cents)
  VALUES ('venue_menu_order', v_o, 50);
  INSERT INTO public.source_refunds (
    source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
    requested_by_type, reason, provider, currency, original_charge_cents,
    buyer_refund_requested_cents, financial_state, provider_payment_reference, idempotency_key
  ) VALUES (
    'venue_menu_order', v_o, v_o, pg_temp.fx('brand'), pg_temp.fx('venue'),
    'venue_order_venue_approved', 'brand_staff', 'partial', 'stripe', 'GBP',
    4400, 2000, 'pending', 'pi_half', 'idem:sr:half:' || v_o::text);

  PERFORM public.run_payout_release_dark_sweep(now());
  SELECT count(*) INTO v_cnt FROM public.payout_release_items WHERE source_id = v_o;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'issue_1790 T-P4: an order with an unreconciled refund attached at full gross';
  END IF;

  -- P-49.5: the per-row re-check guard's list must NAME venue_menu_order.
  -- Without it, an order whose refund landed between candidate selection and
  -- attach would be released at full gross.
  SELECT pg_get_functiondef('public.run_payout_release_dark_sweep(timestamptz)'::regprocedure)
    INTO v_def;
  IF v_def NOT LIKE '%v_row.source_type IN (''venue_reservation'',''rsvp_contribution'',''venue_menu_order'')%' THEN
    RAISE EXCEPTION 'issue_1790 T-P4 / P-49.5: the per-row re-check guard does not include venue_menu_order';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-P3 — THE FIVE WIDENINGS, REVERTED ONE AT A TIME.
-- Each revert must produce a HARD failure, never a silent skip. Widening 5 —
-- the plpgsql gate inside attach_payout_release that the forensics missed —
-- is the one that aborts the sweep for EVERY surface, not just ours.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_s uuid; v_o uuid; v_raised boolean; v_gate text;
  v_w1 boolean := false; v_w2 boolean := false; v_w3 boolean := false; v_w4 boolean := false;
BEGIN
  v_s := pg_temp.mint_session();
  v_o := pg_temp.mint_order(v_s, 2000, 0, 0, 1000, 300, 'idem:widen', now() - interval '10 days');

  -- Each revert runs in a plpgsql SUBTRANSACTION that is unwound by a sentinel
  -- exception, so the DDL never escapes the probe. plpgsql variables are not
  -- transactional, so the verdict survives the unwind.

  -- Widening 1 — payout_source_fee_snapshots.
  BEGIN
    ALTER TABLE public.payout_source_fee_snapshots
      DROP CONSTRAINT payout_source_fee_snapshots_source_type_check;
    ALTER TABLE public.payout_source_fee_snapshots
      ADD CONSTRAINT payout_source_fee_snapshots_source_type_check
      CHECK (source_type IN ('order','rsvp_contribution','venue_reservation','stay_reservation'))
      NOT VALID;   -- NOT VALID: probe the WRITE path; rows this suite already
                   -- wrote above are irrelevant to whether the gate still bites.
    BEGIN
      INSERT INTO public.payout_source_fee_snapshots (source_type, source_id, provider_fee_cents)
      VALUES ('venue_menu_order', v_o, 10);
    EXCEPTION WHEN check_violation THEN v_w1 := true; END;
    RAISE EXCEPTION 'issue_1790_probe_unwind';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'issue_1790_probe_unwind' THEN RAISE; END IF;
  END;
  IF NOT v_w1 THEN
    RAISE EXCEPTION 'issue_1790 T-P3(1): reverting the fee-snapshot widening did not fail loudly';
  END IF;

  -- Widening 4 — source_refunds.
  BEGIN
    ALTER TABLE public.source_refunds DROP CONSTRAINT source_refunds_source_type_check;
    ALTER TABLE public.source_refunds ADD CONSTRAINT source_refunds_source_type_check
      CHECK (source_type IN ('venue_reservation','rsvp_contribution','stay_reservation'))
      NOT VALID;
    BEGIN
      INSERT INTO public.source_refunds (
        source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
        requested_by_type, reason, provider, currency, original_charge_cents,
        buyer_refund_requested_cents, provider_payment_reference, idempotency_key
      ) VALUES (
        'venue_menu_order', v_o, v_o, pg_temp.fx('brand'), pg_temp.fx('venue'),
        'venue_order_guest_cancel', 'guest', 'revert probe', 'stripe', 'GBP',
        1000, 1000, 'pi_revert', 'idem:sr:revert:' || v_o::text);
    EXCEPTION WHEN check_violation THEN v_w4 := true; END;
    RAISE EXCEPTION 'issue_1790_probe_unwind';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'issue_1790_probe_unwind' THEN RAISE; END IF;
  END;
  IF NOT v_w4 THEN
    RAISE EXCEPTION 'issue_1790 T-P3(4): reverting the source_refunds widening did not fail loudly';
  END IF;

  -- Widenings 2 + 3, through the REAL attach call. Reverting either makes
  -- attach_payout_release raise rather than quietly dropping the money.
  BEGIN
    ALTER TABLE public.brand_payout_releases DROP CONSTRAINT brand_payout_releases_surface_check;
    ALTER TABLE public.brand_payout_releases ADD CONSTRAINT brand_payout_releases_surface_check
      CHECK (surface IN ('order','rsvp_contribution','venue_reservation','stay_reservation'))
      NOT VALID;
    BEGIN
      PERFORM public.attach_payout_release('venue_menu_order', v_o, pg_temp.fx('brand'),
        NULL, NULL, 'venue_order:w2:' || v_o::text, 'stripe', 'gbp',
        now() - interval '10 days', now() - interval '10 days', 2000, 0, 0, 200, 0, 30);
    EXCEPTION WHEN check_violation THEN v_w2 := true; END;
    RAISE EXCEPTION 'issue_1790_probe_unwind';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'issue_1790_probe_unwind' THEN RAISE; END IF;
  END;
  IF NOT v_w2 THEN
    RAISE EXCEPTION 'issue_1790 T-P3(2): reverting the brand_payout_releases.surface widening did not fail loudly';
  END IF;

  BEGIN
    ALTER TABLE public.payout_release_items DROP CONSTRAINT payout_release_items_source_type_check;
    ALTER TABLE public.payout_release_items ADD CONSTRAINT payout_release_items_source_type_check
      CHECK (source_type IN ('order','rsvp_contribution','venue_reservation','stay_reservation'))
      NOT VALID;
    BEGIN
      PERFORM public.attach_payout_release('venue_menu_order', v_o, pg_temp.fx('brand'),
        NULL, NULL, 'venue_order:w3:' || v_o::text, 'stripe', 'gbp',
        now() - interval '10 days', now() - interval '10 days', 2000, 0, 0, 200, 0, 30);
    EXCEPTION WHEN check_violation THEN v_w3 := true; END;
    RAISE EXCEPTION 'issue_1790_probe_unwind';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'issue_1790_probe_unwind' THEN RAISE; END IF;
  END;
  IF NOT v_w3 THEN
    RAISE EXCEPTION 'issue_1790 T-P3(3): reverting the payout_release_items widening did not fail loudly';
  END IF;

  -- Widening 5 — THE ONE THE FORENSICS MISSED. Source-of-truth assertion: the
  -- shipped function body must name venue_menu_order in its gate. Reverting it
  -- makes attach raise 22023 invalid_payout_source and abort the sweep loop
  -- mid-transaction, for EVERY surface.
  SELECT pg_get_functiondef((
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='attach_payout_release')) INTO v_gate;
  IF v_gate NOT LIKE '%p_source_type NOT IN (''order'',''rsvp_contribution'',''venue_reservation'',''venue_menu_order'')%' THEN
    RAISE EXCEPTION 'issue_1790 T-P3(5): attach_payout_release''s plpgsql source-type gate was never widened — a venue order raises invalid_payout_source and aborts the sweep for every surface';
  END IF;

  -- And prove the gate actually rejects an unknown type (it is a gate, not decor).
  v_raised := false;
  BEGIN
    PERFORM public.attach_payout_release('venue_menu_order_typo', v_o, pg_temp.fx('brand'),
      NULL, NULL, 'venue_order:typo', 'stripe', 'gbp',
      now() - interval '10 days', now() - interval '10 days', 2000, 0, 0, 200, 0, 30);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM LIKE '%invalid_payout_source%'; END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1790 T-P3(5) VACUITY: attach_payout_release accepted an unknown source type';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-FIN1 — pg_venue_order_finalize_payment (P-28 / P-49.3): flip + fee snapshot
-- in ONE transaction, idempotent on replay, and fail-closed on a wrong amount.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_s uuid; v_o uuid; v_r jsonb; v_total int; v_cnt int;
BEGIN
  v_s := pg_temp.mint_session();
  v_o := pg_temp.mint_order(v_s, 4000, 500, 1000);
  UPDATE public.venue_orders SET payment_status='pending', confirmed_at=NULL WHERE id=v_o;
  SELECT total_cents INTO v_total FROM public.venue_orders WHERE id=v_o;

  -- Wrong amount => order marked failed, NO snapshot, no payout exposure.
  v_r := public.pg_venue_order_finalize_payment(v_o, 'stripe', v_total - 1, 'GBP');
  IF v_r->>'status' <> 'amount_or_currency_mismatch' THEN
    RAISE EXCEPTION 'issue_1790 T-FIN1: a short payment was accepted (%)', v_r;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.payout_source_fee_snapshots WHERE source_id=v_o;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'issue_1790 T-FIN1: a mismatched payment still wrote a fee snapshot';
  END IF;

  UPDATE public.venue_orders SET payment_status='pending', failed_at=NULL WHERE id=v_o;
  v_r := public.pg_venue_order_finalize_payment(
    v_o, 'stripe', v_total, 'gbp', 'pi_1790', 'ch_1790', 145, 'txn_1790');
  IF v_r->>'status' <> 'finalized' THEN
    RAISE EXCEPTION 'issue_1790 T-FIN1: a correct payment did not finalize (%)', v_r;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_orders
                 WHERE id=v_o AND payment_status='paid' AND confirmed_at IS NOT NULL
                   AND stripe_charge_id='ch_1790') THEN
    RAISE EXCEPTION 'issue_1790 T-FIN1: the order was not flipped paid with its charge id';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payout_source_fee_snapshots
                 WHERE source_type='venue_menu_order' AND source_id=v_o
                   AND provider_fee_cents=145) THEN
    RAISE EXCEPTION 'issue_1790 T-FIN1 / P-49.3: the fee snapshot was not written in the same transaction as the flip';
  END IF;

  -- Replay is a no-op, not a second anything.
  v_r := public.pg_venue_order_finalize_payment(v_o, 'stripe', v_total, 'GBP', 'pi_1790', 'ch_1790', 145, 'txn_1790');
  IF v_r->>'status' <> 'replayed' THEN
    RAISE EXCEPTION 'issue_1790 T-FIN1: a replayed webhook was not recognised (%)', v_r;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.payout_source_fee_snapshots WHERE source_id=v_o;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'issue_1790 T-FIN1: a replay produced % fee snapshots', v_cnt;
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-FIN2 — MONEY IS NEVER RELEASED ON A GUESS (P-49.3). A finalize with an
-- UNKNOWN provider fee writes NO snapshot: a zero placeholder would over-release
-- the venue by exactly the processing cost. The order WAITS, and
-- list_missing_payout_source_fees is its exit — the shipped payout-release-sweep
-- fee-capture loop resolves the real per-charge fee.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_s uuid; v_o uuid; v_total int; v_cnt int; v_listed int;
BEGIN
  v_s := pg_temp.mint_session();
  v_o := pg_temp.mint_order(v_s, 2500, 0, 0);
  UPDATE public.venue_orders
     SET payment_status='pending', confirmed_at=NULL, stripe_charge_id='ch_wait_1790'
   WHERE id=v_o;
  SELECT total_cents INTO v_total FROM public.venue_orders WHERE id=v_o;

  PERFORM public.pg_venue_order_finalize_payment(v_o, 'stripe', v_total, 'GBP',
    'pi_wait_1790', 'ch_wait_1790', NULL, NULL);

  SELECT count(*) INTO v_cnt FROM public.payout_source_fee_snapshots WHERE source_id=v_o;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'issue_1790 T-FIN2: an unknown provider fee was recorded as a snapshot — the venue would be over-released by the processing cost';
  END IF;

  -- The order is paid, so it must appear in the fee-capture worklist.
  SELECT count(*) INTO v_listed FROM public.list_missing_payout_source_fees(500)
   WHERE source_type='venue_menu_order' AND source_id=v_o;
  IF v_listed <> 1 THEN
    RAISE EXCEPTION 'issue_1790 T-FIN2: a paid venue order with no fee snapshot is NOT in list_missing_payout_source_fees — it would wait forever';
  END IF;

  -- And the sweep will not release it while the snapshot is missing.
  PERFORM public.run_payout_release_dark_sweep(now());
  SELECT count(*) INTO v_cnt FROM public.payout_release_items WHERE source_id=v_o;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'issue_1790 T-FIN2: an order with no fee snapshot was released';
  END IF;

  -- A venue_collected order must NEVER appear in the fee worklist: there is no
  -- provider fee to resolve because there was no provider.
  SELECT count(*) INTO v_listed FROM public.list_missing_payout_source_fees(500) l
   JOIN public.venue_orders vo ON vo.id = l.source_id
   WHERE l.source_type='venue_menu_order' AND vo.money_path='venue_collected';
  IF v_listed <> 0 THEN
    RAISE EXCEPTION 'issue_1790 T-FIN2: a venue_collected order entered the provider-fee worklist';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-R2 — realtime publication (P-6 / P-66). A postgres_changes subscription on
-- an unpublished table is silently no-op; it has shipped that way twice.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_missing text;
BEGIN
  FOR v_missing IN
    SELECT t FROM unnest(ARRAY['venue_orders','venue_order_sessions']) t
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t)
  LOOP
    RAISE EXCEPTION 'issue_1790 T-R2: public.% is not in the supabase_realtime publication', v_missing;
  END LOOP;
END $t$;

-- ---------------------------------------------------------------------------
-- T-RLS1 — the order family is service-role-write only, and the brand-member
-- SELECT policy EXISTS (without it the Phase-3 queue receives no realtime
-- events at all, silently — the ORCH-0854 failure class).
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_t text; v_cnt int;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['venue_order_sessions','venue_orders','venue_order_items','venue_order_item_modifiers'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                   WHERE n.nspname='public' AND c.relname=v_t AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'issue_1790 T-RLS1: RLS is not enabled on public.%', v_t;
    END IF;
    SELECT count(*) INTO v_cnt FROM pg_policies
     WHERE schemaname='public' AND tablename=v_t AND cmd='SELECT'
       AND 'authenticated' = ANY(roles);
    IF v_cnt < 1 THEN
      RAISE EXCEPTION 'issue_1790 T-RLS1: public.% has no brand-member SELECT policy — realtime would be silently dead', v_t;
    END IF;
    SELECT count(*) INTO v_cnt FROM pg_policies
     WHERE schemaname='public' AND tablename=v_t AND cmd <> 'SELECT'
       AND (roles && ARRAY['anon','authenticated']::name[]);
    IF v_cnt > 0 THEN
      RAISE EXCEPTION 'issue_1790 T-RLS1: public.% grants a NON-SELECT policy to anon/authenticated — order writes must be service-role only', v_t;
    END IF;
  END LOOP;
END $t$;

-- ---------------------------------------------------------------------------
-- T-DT1 — DO-NOT-TOUCH. The ticket path's two NOT NULLs are the whole reason
-- this family exists. If either ever loses NOT NULL, #1767's D-1 decision was
-- quietly reversed on the two hottest live money tables.
-- ---------------------------------------------------------------------------
DO $t$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='orders'
               AND column_name='event_id' AND is_nullable='YES') THEN
    RAISE EXCEPTION 'issue_1790 T-DT1: orders.event_id lost NOT NULL — the ticket path was bent after all';
  END IF;
  IF to_regclass('public.order_line_items') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='order_line_items'
                   AND column_name='ticket_type_id' AND is_nullable='YES') THEN
    RAISE EXCEPTION 'issue_1790 T-DT1: order_line_items.ticket_type_id lost NOT NULL';
  END IF;
END $t$;

ROLLBACK;
