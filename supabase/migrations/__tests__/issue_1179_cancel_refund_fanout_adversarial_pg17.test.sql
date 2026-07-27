-- Issue #1179 (initiative #1013 sub-issue J) — cancellation refund fan-out.
-- PostgreSQL 17 ADVERSARIAL regression proof (TESTER-owned; a DIFFERENT ANGLE than
-- the implementor happy-path in issue_1179_cancel_refund_fanout_pg17.test.sql).
--
-- The implementor's happy-path proves the forward flow ONCE (release-stop, Stripe
-- conversion, Paystack-not-converted with recovered=0, enumerate, one claim/mark
-- lifecycle, re-prepare no-op, status-first). This test attacks the IDEMPOTENCY /
-- RESUME / NO-DOUBLE-WITHHOLD surface from angles the happy-path never exercises:
--
--   ADV-1  CRASH-MID-LIST RESUME + NO DOUBLE REFUND (SC-9 / SC-5): 3 orders, claim
--          all 3, mark ONE 'refunded', leave TWO stuck 'refunding' with a STALE lease
--          (crash between claim and mark). A re-drive on an advanced clock re-claims
--          ONLY the two stale rows — the already-'refunded' row is NEVER re-claimed
--          (the provider is never re-invoked for it) and its attempt_count does not
--          move again. Finish → run 'completed', refunded_objects=3.
--   ADV-2  FAILED_PARTIAL + terminal-not-reclaimed (SC-10): one order hard-declines
--          ('failed'), the rest refund ⇒ run 'failed_partial'; a re-drive re-claims
--          NOTHING (the terminal 'failed' row never loops / re-refunds).
--   ADV-3  RETRYABLE re-drivable + ATTEMPT CAP: a stale 'failed_retryable' row under
--          the attempt cap IS re-claimed; a 'failed_retryable' at attempt_count=8 is
--          NOT (bounded retries — no infinite loop).
--   ADV-4  3x RE-DRIVE CLAIM IDEMPOTENCY (SC-5 headline): after a run completes,
--          re-prepare + claim THREE times each yields ZERO claimable rows and never
--          grows the progress set — the fan-out gets nothing to refund on any
--          re-invoke, so exactly one refund per order can ever be issued.
--   ADV-5  NO DOUBLE WITHHOLD w/ PARTIAL-RECOVERED temp debt (SC-4 / T-adv-5): a
--          Stripe released occurrence whose temp postponement debt already has
--          recovered_cents>0. After J's conversion, Σ open permanent (principal −
--          recovered) ≤ organiser_cash_delivered_cents AND the recovered overlap is
--          carried onto the permanent debt — recovered cash is never re-withheld.
--   ADV-6  MATURITY RACE resolution (T-adv-4): if mature_postponement_debts closes
--          the temp debt BEFORE prepare, prepare creates NO post_release_cancellation
--          debt — exactly one path consumes the temp cash (no double withhold).
--   ADV-7  PAYSTACK NO SECOND DEBT under REPEATED re-drive (I-PROPOSED-1179-
--          NO-DOUBLE-WITHHOLD, Paystack clause): re-prepare a Paystack event 3x; J
--          NEVER creates a post_release_cancellation debt for a Paystack release
--          (F owns supersession via record_paystack_refund_outcome).
--
-- FAILS-ON-REVERT (tester angle, distinct from the implementor's):
--   * revert the claim RPC's status filter so it re-claims 'refunded'/terminal rows
--     ⇒ ADV-1 / ADV-2 / ADV-4 fail (double-refund exposure);
--   * drop the UNIQUE(source_type,source_id) guard ⇒ ADV-4 re-prepare grows the set.
-- Every write rolls back; any missing invariant raises and ON_ERROR_STOP fails.
BEGIN;

DO $test$
DECLARE
  v_owner   constant uuid := '11790000-0000-4000-8000-0000000000a1';
  v_brand   constant uuid := '11790000-0000-4000-8000-0000000000b1';  -- stripe
  v_pbrand  constant uuid := '11790000-0000-4000-8000-0000000000b2';  -- paystack
  -- ADV-1..4 stripe event with 3 orders
  v_ev1     constant uuid := '11790000-0000-4000-8000-0000000000c1';
  v_o1a     constant uuid := '11790000-0000-4000-8000-0000000000d1';
  v_o1b     constant uuid := '11790000-0000-4000-8000-0000000000d2';
  v_o1c     constant uuid := '11790000-0000-4000-8000-0000000000d3';
  -- ADV-2 stripe event with 3 orders (failed_partial)
  v_ev2     constant uuid := '11790000-0000-4000-8000-0000000000c2';
  v_o2a     constant uuid := '11790000-0000-4000-8000-0000000000d4';
  v_o2b     constant uuid := '11790000-0000-4000-8000-0000000000d5';
  v_o2c     constant uuid := '11790000-0000-4000-8000-0000000000d6';
  -- ADV-3 stripe event with 2 orders (retryable + cap)
  v_ev3     constant uuid := '11790000-0000-4000-8000-0000000000c3';
  v_o3a     constant uuid := '11790000-0000-4000-8000-0000000000d8';
  v_o3b     constant uuid := '11790000-0000-4000-8000-0000000000d9';
  -- ADV-5 stripe event (partial-recovered temp debt)
  v_ev5     constant uuid := '11790000-0000-4000-8000-0000000000c5';
  v_rel5    constant uuid := '11790000-0000-4000-8000-0000000000e5';
  -- ADV-6 stripe event (matured-first temp debt)
  v_ev6     constant uuid := '11790000-0000-4000-8000-0000000000c6';
  v_rel6    constant uuid := '11790000-0000-4000-8000-0000000000e6';
  -- ADV-7 paystack event
  v_ev7     constant uuid := '11790000-0000-4000-8000-0000000000c7';
  v_rel7    constant uuid := '11790000-0000-4000-8000-0000000000e7';
  v_o7      constant uuid := '11790000-0000-4000-8000-0000000000da';

  v_pids       uuid[];
  v_pid1       uuid;
  v_pid2       uuid;
  v_pid3a      uuid;
  v_pid3b      uuid;
  v_refunded_order uuid;
  v_claimed    integer;
  v_count      integer;
  v_status     text;
  v_att        integer;
  v_att_after  integer;
  v_perm_open  integer;
  v_perm_rec   integer;
  i            integer;
BEGIN
  -- ===========================================================================
  -- Seed owner + two brands.
  -- ===========================================================================
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'adv-1179@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region, pricing_currency, default_currency)
  VALUES
    (v_brand,  v_owner, 'Adv Stripe Brand',   'adv-1179-stripe',   'stripe',   'US', 'USD', 'USD'),
    (v_pbrand, v_owner, 'Adv Paystack Brand', 'adv-1179-paystack', 'paystack', 'NG', 'NGN', 'NGN');

  -- ===========================================================================
  -- ADV-1: crash-mid-list resume + no double refund.
  -- ===========================================================================
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_ev1, v_brand, 'Adv 3-order Event', 'adv-1179-ev1', 'cancelled', 'USD');
  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status, stripe_payment_intent_id, stripe_charge_id, source)
  VALUES
    (v_o1a, v_ev1, 6000, 'USD', 'paid', 'pi_adv_1a', 'ch_adv_1a', 'legacy'),
    (v_o1b, v_ev1, 4000, 'USD', 'paid', 'pi_adv_1b', 'ch_adv_1b', 'legacy'),
    (v_o1c, v_ev1, 5000, 'USD', 'paid', 'pi_adv_1c', 'ch_adv_1c', 'legacy');

  PERFORM public.cancel_event_refund_prepare(v_ev1);
  SELECT count(*) INTO v_count FROM public.event_cancel_refund_progress WHERE event_id = v_ev1;
  IF v_count <> 3 THEN RAISE EXCEPTION 'ADV1 setup: expected 3 progress rows got %', v_count; END IF;

  -- Claim all 3 (lease at now()).
  SELECT count(*) INTO v_claimed FROM public.cancel_event_refund_claim(v_ev1, 25, now());
  IF v_claimed <> 3 THEN RAISE EXCEPTION 'ADV1 initial claim expected 3 got %', v_claimed; END IF;

  -- Mark the FIRST refunded; the other two "crash" (stay 'refunding').
  SELECT id, source_id INTO v_pid1, v_refunded_order
    FROM public.event_cancel_refund_progress WHERE event_id = v_ev1 ORDER BY created_at, id LIMIT 1;
  PERFORM public.cancel_event_refund_mark(v_pid1, 'refunded', NULL, NULL);
  SELECT attempt_count INTO v_att FROM public.event_cancel_refund_progress WHERE id = v_pid1;

  -- Crash: the two unmarked rows are stuck 'refunding' with an OLD lease.
  UPDATE public.event_cancel_refund_progress
    SET leased_at = now() - interval '20 minutes'
    WHERE event_id = v_ev1 AND status = 'refunding';

  -- Re-drive on an advanced clock re-claims ONLY the two stale rows.
  SELECT array_agg(source_id) INTO v_pids
    FROM public.cancel_event_refund_claim(v_ev1, 25, now() + interval '11 minutes');
  SELECT count(*) INTO v_claimed FROM unnest(v_pids) x;
  IF v_claimed <> 2 THEN
    RAISE EXCEPTION 'ADV1 resume re-claimed % rows, expected exactly 2 (refunded row must not re-claim)', v_claimed;
  END IF;
  IF v_refunded_order = ANY(v_pids) THEN
    RAISE EXCEPTION 'ADV1 DOUBLE-REFUND EXPOSURE: the already-refunded order was re-claimed on resume';
  END IF;
  -- The refunded row's attempt_count did NOT move again.
  SELECT attempt_count INTO v_att_after FROM public.event_cancel_refund_progress WHERE id = v_pid1;
  IF v_att_after <> v_att THEN
    RAISE EXCEPTION 'ADV1 refunded row attempt_count changed % -> % on resume (should stay)', v_att, v_att_after;
  END IF;

  -- Finish the two resumed rows → run completes with exactly 3 refunded.
  PERFORM public.cancel_event_refund_mark(p.id, 'refunded', NULL, NULL)
    FROM public.event_cancel_refund_progress p
    WHERE p.event_id = v_ev1 AND p.status = 'refunding';
  SELECT status, refunded_objects INTO v_status, v_count
    FROM public.event_cancel_refund_runs WHERE event_id = v_ev1;
  IF v_status <> 'completed' THEN RAISE EXCEPTION 'ADV1 run not completed after resume, got %', v_status; END IF;
  IF v_count <> 3 THEN RAISE EXCEPTION 'ADV1 refunded_objects expected 3 got % (double/lost refund)', v_count; END IF;

  -- ADV-4: 3x re-drive of a COMPLETED run yields nothing to refund and never grows.
  FOR i IN 1..3 LOOP
    PERFORM public.cancel_event_refund_prepare(v_ev1);
    SELECT count(*) INTO v_claimed FROM public.cancel_event_refund_claim(v_ev1, 25, now() + interval '30 minutes');
    IF v_claimed <> 0 THEN
      RAISE EXCEPTION 'ADV4 re-drive #% claimed % rows from a completed run (double-refund exposure)', i, v_claimed;
    END IF;
    SELECT count(*) INTO v_count FROM public.event_cancel_refund_progress WHERE event_id = v_ev1;
    IF v_count <> 3 THEN RAISE EXCEPTION 'ADV4 re-drive #% grew progress rows to %', i, v_count; END IF;
    SELECT status INTO v_status FROM public.event_cancel_refund_runs WHERE event_id = v_ev1;
    IF v_status <> 'completed' THEN RAISE EXCEPTION 'ADV4 re-drive #% flipped completed run to %', i, v_status; END IF;
  END LOOP;

  -- ===========================================================================
  -- ADV-2: failed_partial + terminal 'failed' never reclaimed.
  -- ===========================================================================
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_ev2, v_brand, 'Adv Partial-Fail Event', 'adv-1179-ev2', 'cancelled', 'USD');
  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status, stripe_payment_intent_id, stripe_charge_id, source)
  VALUES
    (v_o2a, v_ev2, 3000, 'USD', 'paid', 'pi_adv_2a', 'ch_adv_2a', 'legacy'),
    (v_o2b, v_ev2, 3000, 'USD', 'paid', 'pi_adv_2b', 'ch_adv_2b', 'legacy'),
    (v_o2c, v_ev2, 3000, 'USD', 'paid', 'pi_adv_2c', 'ch_adv_2c', 'legacy');
  PERFORM public.cancel_event_refund_prepare(v_ev2);
  PERFORM public.cancel_event_refund_claim(v_ev2, 25, now());
  -- Two refund, one hard-declines (terminal 'failed').
  SELECT id INTO v_pid2 FROM public.event_cancel_refund_progress
    WHERE event_id = v_ev2 ORDER BY created_at, id LIMIT 1;
  PERFORM public.cancel_event_refund_mark(v_pid2, 'failed', NULL, 'card_declined_hard');
  PERFORM public.cancel_event_refund_mark(p.id, 'refunded', NULL, NULL)
    FROM public.event_cancel_refund_progress p
    WHERE p.event_id = v_ev2 AND p.status = 'refunding';
  SELECT status, failed_objects, refunded_objects INTO v_status, v_count, v_att
    FROM public.event_cancel_refund_runs WHERE event_id = v_ev2;
  IF v_status <> 'failed_partial' THEN RAISE EXCEPTION 'ADV2 run expected failed_partial got %', v_status; END IF;
  IF v_count <> 1 THEN RAISE EXCEPTION 'ADV2 failed_objects expected 1 got %', v_count; END IF;
  IF v_att <> 2 THEN RAISE EXCEPTION 'ADV2 refunded_objects expected 2 got %', v_att; END IF;
  -- Re-drive: NOTHING re-claims (terminal 'failed' never loops; refunded never re-refunds).
  SELECT count(*) INTO v_claimed FROM public.cancel_event_refund_claim(v_ev2, 25, now() + interval '30 minutes');
  IF v_claimed <> 0 THEN
    RAISE EXCEPTION 'ADV2 re-drive re-claimed % rows from failed_partial (terminal failed must not loop)', v_claimed;
  END IF;

  -- ===========================================================================
  -- ADV-3: retryable re-drivable + attempt cap.
  -- ===========================================================================
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_ev3, v_brand, 'Adv Retryable Event', 'adv-1179-ev3', 'cancelled', 'USD');
  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status, stripe_payment_intent_id, stripe_charge_id, source)
  VALUES
    (v_o3a, v_ev3, 2000, 'USD', 'paid', 'pi_adv_3a', 'ch_adv_3a', 'legacy'),
    (v_o3b, v_ev3, 2000, 'USD', 'paid', 'pi_adv_3b', 'ch_adv_3b', 'legacy');
  PERFORM public.cancel_event_refund_prepare(v_ev3);
  PERFORM public.cancel_event_refund_claim(v_ev3, 25, now());
  SELECT id INTO v_pid3a FROM public.event_cancel_refund_progress
    WHERE event_id = v_ev3 AND source_id = v_o3a;
  SELECT id INTO v_pid3b FROM public.event_cancel_refund_progress
    WHERE event_id = v_ev3 AND source_id = v_o3b;
  PERFORM public.cancel_event_refund_mark(v_pid3a, 'failed_retryable', NULL, 'temporary_provider_5xx');
  PERFORM public.cancel_event_refund_mark(v_pid3b, 'failed_retryable', NULL, 'temporary_provider_5xx');
  -- o3a: under the cap, stale lease → re-claimable. o3b: at the cap (attempt=8) → NOT.
  UPDATE public.event_cancel_refund_progress
    SET leased_at = now() - interval '20 minutes', attempt_count = 1 WHERE id = v_pid3a;
  UPDATE public.event_cancel_refund_progress
    SET leased_at = now() - interval '20 minutes', attempt_count = 8 WHERE id = v_pid3b;
  SELECT array_agg(source_id) INTO v_pids
    FROM public.cancel_event_refund_claim(v_ev3, 25, now() + interval '11 minutes');
  SELECT count(*) INTO v_claimed FROM unnest(v_pids) x;
  IF v_claimed <> 1 THEN RAISE EXCEPTION 'ADV3 expected exactly 1 re-claim (retryable under cap) got %', v_claimed; END IF;
  IF NOT (v_o3a = ANY(v_pids)) THEN RAISE EXCEPTION 'ADV3 retryable-under-cap row was not re-claimed'; END IF;
  IF v_o3b = ANY(v_pids) THEN RAISE EXCEPTION 'ADV3 ATTEMPT CAP BREACH: attempt_count=8 row was re-claimed'; END IF;

  -- ===========================================================================
  -- ADV-5: no double withhold with a PARTIAL-RECOVERED temp postponement debt.
  -- ===========================================================================
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_ev5, v_brand, 'Adv Partial-Recovered Event', 'adv-1179-ev5', 'cancelled', 'USD');
  INSERT INTO public.brand_payout_releases(
    id, brand_id, event_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, net_release_cents,
    organiser_cash_delivered_cents, status, released_at
  ) VALUES (
    v_rel5, v_brand, v_ev5, 'adv5-released-occ', 'order', 'stripe', 'usd',
    now() - interval '4 days', now() - interval '1 day', 8000, 8000, 8000,
    'released', now() - interval '1 day'
  );
  -- Future maturity so mature() (ADV-6) never touches it; then simulate 3000 recovered.
  PERFORM public.open_post_release_postponement_debt(v_rel5, now() + interval '10 days');
  UPDATE public.organiser_payout_debts
    SET recovered_cents = 3000
    WHERE origin_release_id = v_rel5 AND kind = 'post_release_postponement';

  PERFORM public.cancel_event_refund_prepare(v_ev5);

  -- Temp debt fully converted (principal drained to 0).
  SELECT status INTO v_status FROM public.organiser_payout_debts
    WHERE origin_release_id = v_rel5 AND kind = 'post_release_postponement';
  IF v_status <> 'converted' THEN RAISE EXCEPTION 'ADV5 temp debt not converted, got %', v_status; END IF;
  -- Permanent cancellation debt carries the recovered overlap (recovered=3000).
  SELECT principal_cents, recovered_cents INTO v_count, v_perm_rec FROM public.organiser_payout_debts
    WHERE origin_release_id = v_rel5 AND kind = 'post_release_cancellation';
  IF v_count <> 8000 THEN RAISE EXCEPTION 'ADV5 permanent principal expected 8000 got %', v_count; END IF;
  IF v_perm_rec <> 3000 THEN RAISE EXCEPTION 'ADV5 permanent recovered overlap expected 3000 got % (recovered cash lost/double-withheld)', v_perm_rec; END IF;
  -- Σ open permanent (principal − recovered) ≤ organiser_cash_delivered_cents.
  SELECT COALESCE(sum(principal_cents - recovered_cents), 0) INTO v_perm_open
    FROM public.organiser_payout_debts
    WHERE origin_release_id = v_rel5
      AND kind IN ('post_release_cancellation','post_release_refund','post_release_dispute')
      AND status = 'open';
  IF v_perm_open > 8000 THEN RAISE EXCEPTION 'ADV5 DOUBLE-WITHHOLD: open permanent % exceeds delivered cash 8000', v_perm_open; END IF;

  -- ===========================================================================
  -- ADV-6: maturity race — mature the temp debt FIRST → prepare converts nothing.
  -- ===========================================================================
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_ev6, v_brand, 'Adv Maturity-Race Event', 'adv-1179-ev6', 'cancelled', 'USD');
  INSERT INTO public.brand_payout_releases(
    id, brand_id, event_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, net_release_cents,
    organiser_cash_delivered_cents, status, released_at
  ) VALUES (
    v_rel6, v_brand, v_ev6, 'adv6-released-occ', 'order', 'stripe', 'usd',
    now() - interval '4 days', now() - interval '1 day', 6000, 6000, 6000,
    'released', now() - interval '1 day'
  );
  -- Past maturity → mature() closes it BEFORE cancellation prepare runs.
  PERFORM public.open_post_release_postponement_debt(v_rel6, now() - interval '4 days');
  PERFORM public.mature_postponement_debts(now());
  SELECT status INTO v_status FROM public.organiser_payout_debts
    WHERE origin_release_id = v_rel6 AND kind = 'post_release_postponement';
  IF v_status <> 'closed' THEN RAISE EXCEPTION 'ADV6 precondition: temp debt should be matured/closed, got %', v_status; END IF;

  PERFORM public.cancel_event_refund_prepare(v_ev6);
  -- prepare must NOT create a cancellation debt (maturity already consumed the cash).
  SELECT count(*) INTO v_count FROM public.organiser_payout_debts
    WHERE origin_release_id = v_rel6 AND kind = 'post_release_cancellation';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'ADV6 DOUBLE-WITHHOLD: prepare created % cancellation debt(s) after maturity already closed the temp debt', v_count;
  END IF;

  -- ===========================================================================
  -- ADV-7: Paystack — J never creates a cancellation debt, even across 3 re-drives.
  -- ===========================================================================
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_ev7, v_pbrand, 'Adv Paystack Event', 'adv-1179-ev7', 'cancelled', 'NGN');
  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status, stripe_payment_intent_id, stripe_charge_id, source)
  VALUES (v_o7, v_ev7, 500000, 'NGN', 'paid', 'ps_ref_adv7', NULL, 'legacy');
  INSERT INTO public.brand_payout_releases(
    id, brand_id, event_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, net_release_cents,
    organiser_cash_delivered_cents, status, released_at
  ) VALUES (
    v_rel7, v_pbrand, v_ev7, 'adv7-released-occ', 'order', 'paystack', 'ngn',
    now() - interval '4 days', now() - interval '1 day', 500000, 500000, 500000,
    'released', now() - interval '1 day'
  );
  PERFORM public.open_post_release_postponement_debt(v_rel7, now() + interval '10 days');

  FOR i IN 1..3 LOOP
    PERFORM public.cancel_event_refund_prepare(v_ev7);
    -- J must never convert a Paystack temp debt (F owns supersession).
    SELECT count(*) INTO v_count FROM public.organiser_payout_debts
      WHERE origin_release_id = v_rel7 AND kind = 'post_release_cancellation';
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'ADV7 re-drive #%: J wrongly created % Paystack cancellation debt(s) (double-withhold)', i, v_count;
    END IF;
    SELECT status INTO v_status FROM public.organiser_payout_debts
      WHERE origin_release_id = v_rel7 AND kind = 'post_release_postponement';
    IF v_status <> 'open' THEN
      RAISE EXCEPTION 'ADV7 re-drive #%: Paystack temp debt wrongly touched, status %', i, v_status;
    END IF;
    -- The Paystack order is enumerated exactly once regardless of re-drive count.
    SELECT count(*) INTO v_count FROM public.event_cancel_refund_progress WHERE event_id = v_ev7;
    IF v_count <> 1 THEN RAISE EXCEPTION 'ADV7 re-drive #%: progress rows for paystack event = %, expected 1', i, v_count; END IF;
  END LOOP;

  RAISE NOTICE 'issue_1179_adversarial_pg17_pass crash-resume + failed_partial + attempt-cap + 3x-redrive-idempotency + partial-recovered-no-double-withhold + maturity-race + paystack-no-second-debt';
END;
$test$;

ROLLBACK;
