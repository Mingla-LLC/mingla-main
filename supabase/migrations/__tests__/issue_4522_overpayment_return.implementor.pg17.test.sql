-- MINGLA-INVARIANT: I-4522-OVERPAY-NEVER-PAID-OUT | issue #4522 | Money a trip order collected beyond what it owed never reaches a payout: the row that carried it stays out of payout candidates until it is returned, and afterwards pays out only what the plan owed.
-- MINGLA-INVARIANT: I-4522-OVERPAY-ALWAYS-RETURNED | issue #4522 | Overpayment is returned to the traveler in full, automatically and whatever the refund tier, exactly once; it never counts as paid toward the trip, never shrinks a policy refund, and never stalls the plan.
\set ON_ERROR_STOP on

-- issue #4522 N2 / N4 / N5 / N7 with the retester's numbers. Rolled back.
--   N2-PAYOUT  $600 flexible payment, $100 of it not owed: nothing of the row
--              pays out while the $100 is unreturned; after it is returned
--              the row pays out on $500 only.
--   N2-CANCEL  50% tier, $1,300 paid on a $1,200 trip: $600 policy refund +
--              $100 overpayment = $700 back (not $650).
--   N2-DOUBLE  $2,100 collected on a $1,200 trip (a payment confirmed late
--              after the traveler paid again): $900 returned, $1,200 kept.
--   N4         held money never blocks the cron, a due retry or a payment.
--   N5         paid and total exclude overpayment; heldCreditMinor shows it.
--   N7         one paid-in-full claim per order.
--   EDGE       a planned charge above a re-spread row: the excess is returned.
--
-- FAILS-ON-REVERT: drop the issue_4522_row_payout_blocked branch from
-- record_order_installment_provider_sale (N2-PAYOUT), drop
-- issue_4522_row_unreturned_overpayment from biz_compute_refund_for_cancel
-- (N2-CANCEL), restore the 'overpayment_held' branch of
-- issue_4522_collection_guard (N4), or drop the overpayment subtraction from
-- issue_4522_balance (N5) -> red.

BEGIN;

CREATE FUNCTION pg_temp.check(p_label text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL %: %', p_label, COALESCE(p_detail, '(no detail)');
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

INSERT INTO auth.users(id, email) VALUES
  ('4522b600-0000-4000-8000-000000000001', 'op-host@example.test'),
  ('4522b600-0000-4000-8000-000000000002', 'op-buyer@example.test');
INSERT INTO public.creator_accounts(id, email) VALUES ('4522b600-0000-4000-8000-000000000001', 'op-host@example.test');
INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES ('4522b600-0000-4000-8000-000000000002', '+2348000045222');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country, payout_hold_cutover_at)
VALUES ('4522b600-0000-4000-8000-000000000011', '4522b600-0000-4000-8000-000000000001', 'OP st', 'op-st-4522', 'USD', 'stripe', 'US', now() - interval '10 days');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency, refund_policy)
VALUES ('4522b600-0000-4000-8000-000000000021', '4522b600-0000-4000-8000-000000000011', '4522b600-0000-4000-8000-000000000001',
  'OP trip', 'op-trip', 'trip', 'scheduled', 'public', 'America/New_York', 'USD',
  '{"kind":"custom","tiers":[{"days_before_start":0,"refund_pct":50}]}');
INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, quantity_total, is_unlimited, min_purchase_qty, available_online, available_in_person)
VALUES ('4522b600-0000-4000-8000-000000000040', '4522b600-0000-4000-8000-000000000021', 'SA', 120000, 'USD', false, 20, false, 1, true, false),
       ('4522b600-0000-4000-8000-000000000041', '4522b600-0000-4000-8000-000000000021', 'SB', 120000, 'USD', false, 20, false, 1, true, false);
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
 ('4522b600-0000-4000-8000-000000000021', '2027-03-12T09:00Z', '2027-03-19T09:00Z', 'America/New_York', true);

-- A $1,200 trip: $300 deposit paid, rows as given (Stripe, flexible on).
CREATE FUNCTION pg_temp.seed(p_order uuid, p_rows jsonb) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
    currency, payment_method, payment_status, source, installment_plan_root, payment_plan_terms, stripe_payment_intent_id)
  VALUES (p_order, '4522b600-0000-4000-8000-000000000021', '4522b600-0000-4000-8000-000000000002',
    'op-buyer@example.test', 'OP Buyer', '+2348000045222', 30000, 'USD', 'online_card', 'paid', 'online_checkout', true,
    '{"v":2,"flex_enabled":true,"min_payment_minor":5000,"auto_adjust":true,"deposit_minor":30000}', 'pi_dep_' || p_order::text);
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
    collection_method, planned_application_fee_cents, ticket_type_id, addon_portion_minor)
  SELECT p_order, o::int, (r->>'amt')::bigint, 'USD', (r->>'due')::timestamptz, 'scheduled', 'stripe', 'auto_card',
         (r->>'amt')::bigint * 45 / 1000, (r->>'tt')::uuid, 0
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY a(r, o);
END $$;
CREATE FUNCTION pg_temp.row_id(p_order uuid, p_ord int) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.order_installments WHERE order_id = p_order AND ordinal = p_ord $$;
-- The success webhook: collect, then record the provider sale.
CREATE FUNCTION pg_temp.collect(p_id uuid, p_pi text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.order_installments SET status = 'collected', collected_at = now() - interval '3 days',
         stripe_payment_intent_id = p_pi, stripe_charge_id = 'ch_' || p_pi
   WHERE id = p_id AND status IN ('scheduled', 'failed');
  PERFORM public.record_order_installment_provider_sale(p_id,
    (SELECT (amount_cents * 45 / 1000)::int FROM public.order_installments WHERE id = p_id), 0);
  INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents, captured_at)
  VALUES ('order_installment', p_id, 0, now()) ON CONFLICT DO NOTHING;
END $$;
CREATE FUNCTION pg_temp.payout_net(p_id uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT s.net_cents FROM public.issue_3645_unattached_payout_sources(now() + interval '2 days') s
   WHERE s.source_type = 'order_installment' AND s.source_id = p_id $$;
-- The edge's refund lane for one order, with the provider answering "succeeded".
CREATE FUNCTION pg_temp.return_all(p_order uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE r jsonb; b jsonb; n integer := 0;
BEGIN
  FOR r IN SELECT x FROM jsonb_array_elements(public.issue_4522_overpayments_due(p_order, now(), 50)) x LOOP
    b := public.issue_4522_begin_overpayment_refund((r->>'overpaymentId')::uuid);
    IF (b->>'done')::boolean THEN CONTINUE; END IF;
    PERFORM public.issue_4522_finish_overpayment_refund((b->>'overpaymentId')::uuid, (b->>'attemptNo')::int,
      'succeeded', 're_' || (b->>'overpaymentId') || '_' || (b->>'attemptNo'));
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

DO $t$
DECLARE
  o1 uuid := '4522b600-0000-4000-8000-0000000000c1';
  o2 uuid := '4522b600-0000-4000-8000-0000000000c2';
  o3 uuid := '4522b600-0000-4000-8000-0000000000c3';
  o4 uuid := '4522b600-0000-4000-8000-0000000000c4';
  o5 uuid := '4522b600-0000-4000-8000-0000000000c5';
  v jsonb; v_flex uuid; v_old uuid; v_n bigint;
BEGIN
  -- ── N2-PAYOUT / N2-CANCEL / N5: a $1,200 trip, $300 deposit; $900 owed as
  --    SA $200 + $200 and SB $500. A $600 flexible payment (SA $300 / SB $300)
  --    lands after SA's first $200 row was charged: SA can take only $200 of
  --    its $300, so $100 of the $600 was not owed.
  PERFORM pg_temp.seed(o1, '[{"tt":"4522b600-0000-4000-8000-000000000040","due":"2026-11-21T08:00Z","amt":20000},
                             {"tt":"4522b600-0000-4000-8000-000000000040","due":"2027-02-10T08:00Z","amt":20000},
                             {"tt":"4522b600-0000-4000-8000-000000000041","due":"2027-02-10T08:00Z","amt":50000}]');
  v := public.issue_4522_begin_flex_payment(o1, 60000, 90000, 'op-key-0001', 'auto_card');
  v_flex := (v->>'installmentId')::uuid;
  UPDATE public.order_installments SET line_allocation =
    '[{"ticket_type_id":"4522b600-0000-4000-8000-000000000040","net_minor":30000,"addon_minor":0},
      {"ticket_type_id":"4522b600-0000-4000-8000-000000000041","net_minor":30000,"addon_minor":0}]'
   WHERE id = v_flex;
  PERFORM pg_temp.collect(pg_temp.row_id(o1, 1), 'pi_o1_row1');
  PERFORM pg_temp.collect(v_flex, 'pi_o1_flex');
  PERFORM pg_temp.check('N2 the unsettled payment is not a payout candidate', pg_temp.payout_net(v_flex) IS NULL);
  v := public.issue_4522_settle_flex_payment(v_flex);
  PERFORM pg_temp.check('N2 settle holds the $100 not owed', (v->>'heldMinor')::bigint = 10000
    AND (v->>'remainingMinor')::bigint = 20000, v::text);
  PERFORM pg_temp.check('N2-PAYOUT nothing of the $600 row pays out while $100 is unreturned',
    pg_temp.payout_net(v_flex) IS NULL
    AND (SELECT payout_accounting_state FROM public.order_installments WHERE id = v_flex) = 'pending');
  v := public.issue_4522_balance(o1);
  PERFORM pg_temp.check('N5 paid excludes the $100 ($300 + $200 + $500)', (v->>'paidMinor')::bigint = 100000, v::text);
  PERFORM pg_temp.check('N5 total is the trip price', (v->>'totalMinor')::bigint = 120000
    AND (v->>'remainingMinor')::bigint = 20000, v::text);
  PERFORM pg_temp.check('N5 heldCreditMinor shows the $100 being returned', (v->>'heldCreditMinor')::bigint = 10000
    AND jsonb_array_length(v->'overpayments') = 1 AND v->'overpayments'->0->>'state' = 'held', v::text);

  v := public.issue_4522_compute_refund_for_cancel_as(o1, now(), 'buyer');
  PERFORM pg_temp.check('N2-CANCEL the policy base excludes the $100',
    (v->>'paid_total_cents')::bigint = 100000 AND (v->>'refund_total_cents')::bigint = 50000, v::text);
  PERFORM pg_temp.check('N2-CANCEL the $100 comes back in full on top',
    (v->>'overpayment_return_cents')::bigint = 10000 AND (v->>'total_back_cents')::bigint = 60000, v::text);

  -- The lane returns it; afterwards the row pays out on $500 only and the
  -- policy base is unchanged (no double refund).
  PERFORM pg_temp.check('N2 the lane returns it once', pg_temp.return_all(o1) = 1 AND pg_temp.return_all(o1) = 0);
  v_n := pg_temp.payout_net(v_flex);
  PERFORM pg_temp.check('N2-PAYOUT after the return the row pays out on $500 only ($500 - the $27 fee)',
    v_n = 50000 - (60000 * 45 / 1000), COALESCE(v_n::text, 'null'));
  v := public.issue_4522_compute_refund_for_cancel_as(o1, now(), 'buyer');
  PERFORM pg_temp.check('N2-CANCEL after the return: same policy refund, nothing more to return',
    (v->>'refund_total_cents')::bigint = 50000 AND NOT (v ? 'overpayment_return_cents'), v::text);
  v := public.issue_4522_balance(o1);
  PERFORM pg_temp.check('N5 returned money is its own field', (v->>'heldCreditMinor')::bigint = 0
    AND (v->>'overpaymentRefundedMinor')::bigint = 10000 AND (v->>'paidMinor')::bigint = 100000, v::text);

  -- ── The retester's exact case: 50% tier, $1,300 paid on a $1,200 trip.
  PERFORM pg_temp.seed(o5, '[{"tt":"4522b600-0000-4000-8000-000000000040","due":"2027-02-10T08:00Z","amt":90000}]');
  v := public.issue_4522_begin_flex_payment(o5, 90000, 90000, 'op-key-0050', 'auto_card');
  v_flex := (v->>'installmentId')::uuid;
  -- a $100 planned charge landed above the row before the settle (held)
  PERFORM pg_temp.collect(v_flex, 'pi_o5_flex');
  v := public.issue_4522_settle_flex_payment(v_flex);
  PERFORM public.issue_4522_hold_overpayment(v_flex, 'superseded_row_collected', 10000, 'pi_o5_extra', '{}'::jsonb, 10000);
  v := public.issue_4522_compute_refund_for_cancel_as(o5, now(), 'buyer');
  PERFORM pg_temp.check('N2-CANCEL retester case: $1,300 on $1,200 at 50% gives $700 back',
    (v->>'paid_total_cents')::bigint = 120000 AND (v->>'refund_total_cents')::bigint = 60000
    AND (v->>'total_back_cents')::bigint = 70000, v::text);

  -- ── N2-DOUBLE: $900 paid, confirmed late after the traveler paid $900 again.
  PERFORM pg_temp.seed(o2, '[{"tt":"4522b600-0000-4000-8000-000000000040","due":"2027-01-13T08:00Z","amt":45000},
                             {"tt":"4522b600-0000-4000-8000-000000000040","due":"2027-02-10T08:00Z","amt":45000}]');
  PERFORM public.issue_4522_begin_flex_payment(o2, 90000, 90000, 'op-key-0002', 'auto_card', now() - interval '20 minutes');
  v_old := (SELECT id FROM public.order_installments WHERE order_id = o2 AND flex_client_key = 'op-key-0002');
  UPDATE public.order_installments SET stripe_payment_intent_id = 'pi_o2_old' WHERE id = v_old;
  -- N3: a cancel the provider confirmed is the only way the first payment frees.
  PERFORM public.issue_4522_release_flex_verified(v_old, 'provider_canceled', 'pi_o2_old');
  v := public.issue_4522_begin_flex_payment(o2, 90000, 90000, 'op-key-0003', 'auto_card');
  PERFORM pg_temp.collect((v->>'installmentId')::uuid, 'pi_o2_new');
  PERFORM public.issue_4522_settle_flex_payment((v->>'installmentId')::uuid);
  v := public.issue_4522_record_late_collection(v_old, 90000, 'pi_o2_old');
  PERFORM pg_temp.check('N2-DOUBLE the late $900 is wholly held', (v->'settle'->>'heldMinor')::bigint = 90000, v::text);
  v := public.issue_4522_balance(o2);
  PERFORM pg_temp.check('N2-DOUBLE paid stays $1,200 and $900 is being returned',
    (v->>'paidMinor')::bigint = 120000 AND (v->>'heldCreditMinor')::bigint = 90000, v::text);
  PERFORM pg_temp.check('N2-DOUBLE the lane returns it', pg_temp.return_all(o2) = 1);
  PERFORM pg_temp.check('N2-DOUBLE returned', (public.issue_4522_balance(o2)->>'overpaymentRefundedMinor')::bigint = 90000);

  -- ── N4: the retester's deadlock — held money plus a failed row whose retry
  --    is due. The cron claims it, so the plan moves.
  PERFORM pg_temp.seed(o3, '[{"tt":"4522b600-0000-4000-8000-000000000040","due":"2026-11-21T08:00Z","amt":30000},
                             {"tt":"4522b600-0000-4000-8000-000000000040","due":"2027-02-10T08:00Z","amt":30000},
                             {"tt":"4522b600-0000-4000-8000-000000000041","due":"2026-11-01T08:00Z","amt":30000}]');
  UPDATE public.order_installments SET status = 'failed', retry_count = 1, failure_reason = 'card_declined', failed_at = now(),
         next_retry_at = now() + interval '1 day' WHERE id = pg_temp.row_id(o3, 3);
  v := public.issue_4522_begin_flex_payment(o3, 60000, 90000, 'op-key-0004', 'auto_card');
  PERFORM pg_temp.collect(pg_temp.row_id(o3, 1), 'pi_o3_row1');
  PERFORM pg_temp.collect((v->>'installmentId')::uuid, 'pi_o3_flex');
  v := public.issue_4522_settle_flex_payment((v->>'installmentId')::uuid);
  PERFORM pg_temp.check('N4 setup: money held', (v->>'heldMinor')::bigint = 10000, v::text);
  UPDATE public.order_installments SET next_retry_at = now() - interval '1 minute'
   WHERE order_id = o3 AND kind = 'scheduled' AND status = 'failed';
  v := public.claim_order_installment_for_charge((SELECT id FROM public.order_installments
         WHERE order_id = o3 AND kind = 'scheduled' AND status = 'failed'));
  PERFORM pg_temp.check('N4 the due retry is claimed (no deadlock)', (v->>'ok')::boolean, v::text);
  PERFORM pg_temp.check('N4 nothing is guarded by held money', public.issue_4522_collection_guard(o3) IS NULL);

  -- ── N7: one claim per order, only when nothing is left to pay.
  PERFORM pg_temp.check('N7 not claimable while rows are open',
    NOT public.issue_4522_claim_paid_in_full_notice(o3, 'test'));
  PERFORM pg_temp.check('N7 claimed once when paid in full',
    public.issue_4522_claim_paid_in_full_notice(o2, 'late_success')
    AND NOT public.issue_4522_claim_paid_in_full_notice(o2, 'replay'));

  -- ── EDGE: the cron's charge for a row lands for more than the row now
  --    owes (a flexible payment re-spread it between the claim and saving the
  --    PaymentIntent id): the row is collected for its amount, the excess is
  --    held and returned.
  PERFORM pg_temp.seed(o4, '[{"tt":"4522b600-0000-4000-8000-000000000040","due":"2026-11-21T08:00Z","amt":45000},
                             {"tt":"4522b600-0000-4000-8000-000000000040","due":"2027-02-10T08:00Z","amt":45000}]');
  v := public.claim_order_installment_for_charge(pg_temp.row_id(o4, 1));
  PERFORM pg_temp.check('EDGE the cron claimed row 1 for $450', (v->>'amount_cents')::bigint = 45000, v::text);
  -- ...the flexible payment begins before the PaymentIntent id is saved
  v := public.issue_4522_begin_flex_payment(o4, 30000, 90000, 'op-key-0005', 'auto_card');
  PERFORM pg_temp.collect((v->>'installmentId')::uuid, 'pi_o4_flex');
  PERFORM public.issue_4522_settle_flex_payment((v->>'installmentId')::uuid);
  PERFORM pg_temp.check('EDGE row 1 was re-spread to $300',
    (SELECT amount_cents FROM public.order_installments WHERE id = pg_temp.row_id(o4, 1)) = 30000);
  -- ...the $450 charge lands on the re-spread row
  PERFORM pg_temp.collect(pg_temp.row_id(o4, 1), 'pi_o4_row1');
  v := public.issue_4522_hold_collected_excess(pg_temp.row_id(o4, 1), 45000, 'pi_o4_row1');
  PERFORM pg_temp.check('EDGE the $150 excess is held for return', (v->>'heldMinor')::bigint = 15000, v::text);
  PERFORM pg_temp.check('EDGE replay holds nothing more',
    (public.issue_4522_hold_collected_excess(pg_temp.row_id(o4, 1), 45000, 'pi_o4_row1')->>'overpaymentId') IS NULL);
  v := public.issue_4522_balance(o4);
  PERFORM pg_temp.check('EDGE paid counts the row''s own $300, not $450', (v->>'paidMinor')::bigint = 30000 + 30000 + 30000
    AND (v->>'heldCreditMinor')::bigint = 15000, v::text);
  PERFORM pg_temp.check('EDGE returned', pg_temp.return_all(o4) = 1);
END
$t$;

-- N9: no client role and no service_role table access to the new tables.
DO $t$
BEGIN
  PERFORM pg_temp.check('N9 order_overpayments is closed to every client role and to direct service_role access',
    NOT has_table_privilege('anon', 'public.order_overpayments', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.order_overpayments', 'SELECT')
    AND NOT has_table_privilege('service_role', 'public.order_overpayments', 'SELECT')
    AND NOT has_table_privilege('service_role', 'public.order_overpayments', 'UPDATE')
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.order_overpayments'::regclass));
  PERFORM pg_temp.check('N9 order_paid_in_full_notices is closed',
    NOT has_table_privilege('authenticated', 'public.order_paid_in_full_notices', 'SELECT')
    AND NOT has_table_privilege('service_role', 'public.order_paid_in_full_notices', 'INSERT'));
  PERFORM pg_temp.check('N9 no client role executes the lane',
    NOT has_function_privilege('authenticated', 'public.issue_4522_begin_overpayment_refund(uuid, integer, timestamptz)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4522_release_flex_verified(uuid, text, text, timestamptz)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_4522_release_flex_verified(uuid, text, text, timestamptz)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.issue_4522_release_flex_verified(uuid, text, text, timestamptz)', 'EXECUTE'));
END
$t$;

ROLLBACK;
