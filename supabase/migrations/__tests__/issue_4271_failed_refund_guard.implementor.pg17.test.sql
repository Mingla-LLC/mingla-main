-- Issue #4271 follow-up (PR #4303 rework) — a ticket refund Stripe never saw is
-- committed 'failed' atomically, and a refund that is not pending never reaches
-- Stripe again. Implementor proof for
-- 20280426004271_issue_4271_failed_refund_never_reaches_stripe.sql on the
-- replayed PG17 schema.
--
-- MINGLA-INVARIANT: I-4271-FAILED-REFUND-NEVER-REACHES-STRIPE | issue #4271 | a ticket refund is committed failed only in one transaction that holds the refunds row lock and proves no #2097 attempt was ever permitted to call Stripe and refunds.create was not reached, closing its open attempts; prepare and pre-refund state raise PT409 for any refund that is not pending, and claim answers not-claimed for its attempts that were never permitted and hold no buyer refund, while money Stripe already moved always settles; reconcile replays a refund only under the Stripe key it was first bound to.
--
-- Cases:
--   C1  Live repro: nothing reached Stripe -> 'failed' in one call, the
--       never-permitted pre-refund attempt is closed, and the tickets are free
--       (preview + a new refund for them succeed).
--   C2  An attempt that was permitted to call Stripe -> 'unknown', the row and
--       the attempt are untouched; a retry under a NEW key is refused with the
--       existing pending conflict (line_overrefund), never a second refund.
--   C3  p_provider_call_reached true, or a recorded Stripe refund -> 'unknown'.
--   C4  Replays: an already failed row answers 'failed'; a succeeded row 'unknown'.
--   C5  A row failed by issue_4271_commit_refund_failed can never reach Stripe:
--       prepare (new and existing fingerprint), pre-refund state, claim (even of
--       an attempt forced back open), record and finalize all refuse; prepare
--       and pre-refund state raise PT409, and nothing raises 40001. (Re-pointed
--       in round 3: a 'failed' row with a permitted attempt is cancel-trip-booking's
--       rollback after Stripe refunded, and must settle; tester D4/D5.)
--   C6  A pending refund still runs prepare -> record -> finalize to succeeded.
--   C7  The provider key binding: binds once, accepts the same key, refuses a
--       different key (PT409), a foreign key (22023) and an unbound non-pending row.
--   C8  Both new helpers are service-role only, SECURITY DEFINER, pinned search_path.
\set ON_ERROR_STOP on

CREATE FUNCTION pg_temp.t4271_fixture(p_tag int)
RETURNS jsonb LANGUAGE plpgsql AS $fx$
DECLARE
  v_owner uuid := ('42710000-0000-4000-8000-' || lpad(p_tag::text, 6, '0') || '000001')::uuid;
  v_brand uuid := ('42710000-0000-4000-8000-' || lpad(p_tag::text, 6, '0') || '000010')::uuid;
  v_event uuid := ('42710000-0000-4000-8000-' || lpad(p_tag::text, 6, '0') || '000020')::uuid;
  v_tt    uuid := ('42710000-0000-4000-8000-' || lpad(p_tag::text, 6, '0') || '000030')::uuid;
  v_order uuid := ('42710000-0000-4000-8000-' || lpad(p_tag::text, 6, '0') || '000040')::uuid;
  v_line  uuid := ('42710000-0000-4000-8000-' || lpad(p_tag::text, 6, '0') || '000050')::uuid;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'owner-4271g-' || p_tag || '@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-4271g-' || p_tag || '@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency)
  VALUES (v_brand, v_owner, 'Issue 4271 guard ' || p_tag, 'issue-4271-guard-' || p_tag, 'stripe', 'GB', 'GBP', 'GBP');
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'Issue 4271 guard ' || p_tag, 'issue-4271-guard-ev-' || p_tag, 'ended', 'GBP');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents) VALUES (v_tt, v_event, 'General', 1000);
  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, stripe_charge_id, source, stripe_application_fee_amount_cents)
  VALUES (v_order, v_event, 2000, 'GBP', 'paid', 'pi_4271g_' || p_tag, 'ch_4271g_' || p_tag, 'legacy', 30);
  INSERT INTO public.order_line_items(id, order_id, ticket_type_id, quantity, unit_price_cents, total_cents)
  VALUES (v_line, v_order, v_tt, 2, 1000, 2000);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  RETURN jsonb_build_object('owner', v_owner, 'order', v_order, 'line', v_line,
    'lines', jsonb_build_array(jsonb_build_object('order_line_item_id', v_line, 'quantity', 2)));
END
$fx$;

-- A #2097 prepare exactly as executeTicketRefundWithFeeTruth sends it (permits the call).
CREATE FUNCTION pg_temp.t4271_prepare(p_refund uuid, p_fingerprint text, p_tag int)
RETURNS jsonb LANGUAGE sql AS $p$
  SELECT public.issue_2097_prepare_refund_attempt(p_refund, p_fingerprint, 'test', 'acct_4271g',
    'GBP', 'ch_4271g_' || p_tag, 'pi_4271g_' || p_tag, 'fee_4271g_' || p_tag, '30', '2000', '2000',
    '[]'::jsonb, '0', true, 1, gen_random_uuid());
$p$;

-- The SQLSTATE a statement raises ('' when it does not raise).
CREATE FUNCTION pg_temp.t4271_state(p_sql text) RETURNS text LANGUAGE plpgsql AS $s$
BEGIN
  EXECUTE p_sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END
$s$;

-- C1. Nothing reached Stripe: failed in one call, attempts closed, tickets free.
BEGIN;
DO $c1$
DECLARE
  f jsonb := pg_temp.t4271_fixture(1);
  v_refund uuid; v_pre jsonb; v_out jsonb; v_status text; v_fee_status text;
BEGIN
  v_refund := (public.biz_refund_order((f->>'order')::uuid, f->'lines', 'Guest could not make it', 'c1-key')->>'refund_id')::uuid;
  -- The fee was not visible yet: a never-permitted pre-refund attempt exists.
  v_pre := public.issue_2097_record_pre_refund_state(v_refund, 'c1-key', 'test', 'acct_4271g', 'GBP',
    'ch_4271g_1', 'pi_4271g_1', '30', '2000', '2000', 'awaiting_application_fee', 1, gen_random_uuid());
  IF (v_pre->>'provider_call_permitted')::boolean THEN RAISE EXCEPTION 'C1 setup: pre-refund state permitted a call'; END IF;
  v_out := public.issue_4271_commit_refund_failed(v_refund, false);
  IF v_out->>'outcome' <> 'failed' OR (v_out->>'closed_attempts')::int <> 1 THEN
    RAISE EXCEPTION 'C1: expected failed with one closed attempt, got %', v_out;
  END IF;
  SELECT status, application_fee_refund_status INTO v_status, v_fee_status FROM public.refunds WHERE id = v_refund;
  IF v_status <> 'failed' OR v_fee_status <> 'application_fee_timeout' THEN
    RAISE EXCEPTION 'C1: refund is %/%', v_status, v_fee_status;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_refund_attempts WHERE refund_id = v_refund
             AND status IN ('awaiting_application_fee', 'pending_visibility')) THEN
    RAISE EXCEPTION 'C1: an open attempt survived the failed commit';
  END IF;
  IF (public.refund_preview((f->>'order')::uuid, f->'lines')->>'amount_cents')::int <> 2000 THEN
    RAISE EXCEPTION 'C1: the failed row still holds its tickets';
  END IF;
  PERFORM public.biz_refund_order((f->>'order')::uuid, f->'lines', 'Second try after the error', 'c1-key-2');
END
$c1$;
ROLLBACK;

-- C2. A permitted attempt: unknown, untouched; a new key is refused, never a second refund.
BEGIN;
DO $c2$
DECLARE
  f jsonb := pg_temp.t4271_fixture(2);
  v_refund uuid; v_prep jsonb; v_out jsonb; v_state text; v_attempt text;
BEGIN
  v_refund := (public.biz_refund_order((f->>'order')::uuid, f->'lines', 'Guest could not make it', 'c2-key')->>'refund_id')::uuid;
  v_prep := pg_temp.t4271_prepare(v_refund, 'c2-key', 2);
  IF (v_prep->>'provider_call_permitted')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'C2 setup: %', v_prep; END IF;
  v_out := public.issue_4271_commit_refund_failed(v_refund, false);
  IF v_out->>'outcome' <> 'unknown' OR v_out->>'reason' <> 'provider_call_permitted' THEN
    RAISE EXCEPTION 'C2: a permitted attempt must stay unknown, got %', v_out;
  END IF;
  SELECT status INTO v_attempt FROM public.ticket_refund_attempts WHERE refund_id = v_refund;
  IF (SELECT status FROM public.refunds WHERE id = v_refund) <> 'pending' OR v_attempt <> 'awaiting_application_fee' THEN
    RAISE EXCEPTION 'C2: the unknown row or its attempt changed';
  END IF;
  v_state := pg_temp.t4271_state(format(
    'SELECT public.biz_refund_order(%L::uuid, %L::jsonb, %L, %L)',
    f->>'order', f->'lines', 'A retry under a new key', 'c2-new-key'));
  IF v_state NOT LIKE '%line_overrefund%' THEN
    RAISE EXCEPTION 'C2: a new key must be refused by the pending conflict, got %', coalesce(nullif(v_state, ''), 'success');
  END IF;
END
$c2$;
ROLLBACK;

-- C3. refunds.create reached, or a Stripe refund recorded: unknown.
BEGIN;
DO $c3$
DECLARE
  f jsonb := pg_temp.t4271_fixture(3);
  v_refund uuid; v_out jsonb;
BEGIN
  v_refund := (public.biz_refund_order((f->>'order')::uuid, f->'lines', 'Guest could not make it', 'c3-key')->>'refund_id')::uuid;
  v_out := public.issue_4271_commit_refund_failed(v_refund, true);
  IF v_out->>'outcome' <> 'unknown' THEN RAISE EXCEPTION 'C3: reached create must be unknown, got %', v_out; END IF;
  v_out := public.issue_4271_commit_refund_failed(v_refund, NULL);
  IF v_out->>'outcome' <> 'unknown' THEN RAISE EXCEPTION 'C3: a NULL reached flag must be unknown, got %', v_out; END IF;
  UPDATE public.refunds SET stripe_refund_id = 're_c3' WHERE id = v_refund;
  v_out := public.issue_4271_commit_refund_failed(v_refund, false);
  IF v_out->>'outcome' <> 'unknown' THEN RAISE EXCEPTION 'C3: a recorded Stripe refund must be unknown, got %', v_out; END IF;
  IF (SELECT status FROM public.refunds WHERE id = v_refund) <> 'pending' THEN RAISE EXCEPTION 'C3: row changed'; END IF;
END
$c3$;
ROLLBACK;

-- C4. Replays.
BEGIN;
DO $c4$
DECLARE
  f jsonb := pg_temp.t4271_fixture(4);
  v_refund uuid; v_out jsonb;
BEGIN
  v_refund := (public.biz_refund_order((f->>'order')::uuid, f->'lines', 'Guest could not make it', 'c4-key')->>'refund_id')::uuid;
  PERFORM public.issue_4271_commit_refund_failed(v_refund, false);
  v_out := public.issue_4271_commit_refund_failed(v_refund, false);
  IF v_out->>'outcome' <> 'failed' OR (v_out->>'idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'C4: a failed row replays failed, got %', v_out;
  END IF;
  UPDATE public.refunds SET status = 'succeeded' WHERE id = v_refund;
  v_out := public.issue_4271_commit_refund_failed(v_refund, false);
  IF v_out->>'outcome' <> 'unknown' THEN RAISE EXCEPTION 'C4: a succeeded row is never failed, got %', v_out; END IF;
END
$c4$;
ROLLBACK;

-- C5. A row our commit failed can never reach Stripe again; nothing raises 40001.
BEGIN;
DO $c5$
DECLARE
  f jsonb := pg_temp.t4271_fixture(5);
  v_refund uuid; v_pre jsonb; v_r jsonb; v_state text; v_owner uuid := gen_random_uuid();
BEGIN
  v_refund := (public.biz_refund_order((f->>'order')::uuid, f->'lines', 'Guest could not make it', 'c5-key')->>'refund_id')::uuid;
  v_pre := public.issue_2097_record_pre_refund_state(v_refund, 'c5-key', 'test', 'acct_4271g', 'GBP',
    'ch_4271g_5', 'pi_4271g_5', '30', '2000', '2000', 'awaiting_application_fee', 1, gen_random_uuid());
  IF public.issue_4271_commit_refund_failed(v_refund, false)->>'outcome' <> 'failed' THEN
    RAISE EXCEPTION 'C5 setup: the row was not committed failed';
  END IF;
  UPDATE public.ticket_refund_attempts SET lease_expires_at = now() - interval '1 second' WHERE refund_id = v_refund;

  v_r := pg_temp.t4271_prepare(v_refund, 'c5-key', 5);
  IF (v_r->>'provider_call_permitted')::boolean OR v_r->>'refund_status' <> 'failed' THEN
    RAISE EXCEPTION 'C5: prepare replay on a failed row must not permit, got %', v_r;
  END IF;
  v_state := pg_temp.t4271_state(format('SELECT pg_temp.t4271_prepare(%L::uuid, %L, 5)', v_refund, 'c5-other-key'));
  IF v_state NOT LIKE 'PT409 refund_not_pending%' THEN RAISE EXCEPTION 'C5: prepare (new) gave %', v_state; END IF;
  v_state := pg_temp.t4271_state(format(
    'SELECT public.issue_2097_record_pre_refund_state(%L::uuid, %L, ''test'', ''acct_4271g'', ''GBP'', ''ch_4271g_5'', ''pi_4271g_5'', ''30'', ''2000'', ''2000'', ''awaiting_application_fee'', 1, gen_random_uuid())',
    v_refund, 'c5-pre-key'));
  IF v_state NOT LIKE 'PT409 refund_not_pending%' THEN RAISE EXCEPTION 'C5: pre-refund state gave %', v_state; END IF;
  v_r := public.issue_2097_claim_refund_attempt((v_pre->>'attempt_id')::uuid, v_owner);
  IF (v_r->>'claimed')::boolean THEN
    RAISE EXCEPTION 'C5: claim of a failed row''s closed attempt must not claim, got %', v_r;
  END IF;
  -- Defence in depth: even an attempt forced back open is refused by the status
  -- guard, because it was never permitted and holds no buyer refund.
  UPDATE public.ticket_refund_attempts SET status = 'awaiting_application_fee', next_observation_at = NULL,
    lease_expires_at = now() - interval '1 second' WHERE id = (v_pre->>'attempt_id')::uuid;
  v_r := public.issue_2097_claim_refund_attempt((v_pre->>'attempt_id')::uuid, v_owner);
  IF (v_r->>'claimed')::boolean OR (v_r->>'refund_not_pending')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'C5: claim of a reopened never-permitted attempt must answer refund_not_pending, got %', v_r;
  END IF;
  v_state := pg_temp.t4271_state(format(
    'SELECT public.issue_2097_record_buyer_refund(%L::uuid, %L::uuid, %s, ''re_c5'', ''2000'')',
    v_pre->>'attempt_id', v_owner, coalesce(v_pre->>'lease_epoch', '0')));
  IF v_state = '' OR v_state LIKE '40001%' THEN RAISE EXCEPTION 'C5: record gave %', coalesce(nullif(v_state, ''), 'success'); END IF;
  v_state := pg_temp.t4271_state(format(
    'SELECT public.issue_2097_finalize_refund_attempt(%L::uuid, %L::uuid, %s, ''succeeded_positive'', ''fr_c5'', ''30'', ''30'', NULL)',
    v_pre->>'attempt_id', v_owner, coalesce(v_pre->>'lease_epoch', '0')));
  IF v_state = '' OR v_state LIKE '40001%' THEN RAISE EXCEPTION 'C5: finalize gave %', coalesce(nullif(v_state, ''), 'success'); END IF;
  IF (SELECT status FROM public.refunds WHERE id = v_refund) <> 'failed'
     OR (SELECT stripe_refund_id FROM public.refunds WHERE id = v_refund) IS NOT NULL THEN
    RAISE EXCEPTION 'C5: the failed row changed';
  END IF;
END
$c5$;
ROLLBACK;

-- C6. A pending refund still settles through the guarded functions.
BEGIN;
DO $c6$
DECLARE
  f jsonb := pg_temp.t4271_fixture(6);
  v_refund uuid; v_owner uuid := gen_random_uuid(); v_prep jsonb; v_fin jsonb;
BEGIN
  v_refund := (public.biz_refund_order((f->>'order')::uuid, f->'lines', 'Guest could not make it', 'c6-key')->>'refund_id')::uuid;
  v_prep := public.issue_2097_prepare_refund_attempt(v_refund, 'c6-key', 'test', 'acct_4271g',
    'GBP', 'ch_4271g_6', 'pi_4271g_6', 'fee_4271g_6', '30', '2000', '2000', '[]'::jsonb, '0', true, 1, v_owner);
  PERFORM public.issue_2097_record_buyer_refund((v_prep->>'attempt_id')::uuid, v_owner,
    (v_prep->>'lease_epoch')::bigint, 're_c6', '2000');
  v_fin := public.issue_2097_finalize_refund_attempt((v_prep->>'attempt_id')::uuid, v_owner,
    (v_prep->>'lease_epoch')::bigint, 'succeeded_positive', 'fr_c6', '30', '30', NULL);
  IF v_fin->>'aggregate_status' <> 'succeeded_positive'
     OR (SELECT status FROM public.refunds WHERE id = v_refund) <> 'succeeded' THEN
    RAISE EXCEPTION 'C6: a pending refund must settle, got %', v_fin;
  END IF;
  IF public.issue_4271_commit_refund_failed(v_refund, false)->>'outcome' <> 'unknown' THEN
    RAISE EXCEPTION 'C6: a settled refund is never failed';
  END IF;
END
$c6$;
ROLLBACK;

-- C7. The provider key binding.
BEGIN;
DO $c7$
DECLARE
  f jsonb := pg_temp.t4271_fixture(7);
  v_refund uuid; v_other uuid; v_r jsonb; v_state text;
BEGIN
  v_refund := (public.biz_refund_order((f->>'order')::uuid, jsonb_build_array(jsonb_build_object(
    'order_line_item_id', f->>'line', 'quantity', 1)), 'Guest could not make it', 'c7-key')->>'refund_id')::uuid;
  v_r := public.issue_4271_bind_refund_provider_key(v_refund, 'ticket_refund:' || v_refund);
  IF (v_r->>'bound')::boolean IS NOT TRUE
     OR (SELECT metadata->>'provider_idempotency_key' FROM public.refunds WHERE id = v_refund) <> 'ticket_refund:' || v_refund THEN
    RAISE EXCEPTION 'C7: the key was not bound, got %', v_r;
  END IF;
  v_r := public.issue_4271_bind_refund_provider_key(v_refund, 'ticket_refund:' || v_refund);
  IF (v_r->>'bound')::boolean THEN RAISE EXCEPTION 'C7: the same key re-bound'; END IF;
  v_state := pg_temp.t4271_state(format('SELECT public.issue_4271_bind_refund_provider_key(%L::uuid, %L)',
    v_refund, 'admin_refund:' || v_refund));
  IF v_state NOT LIKE 'PT409 provider_key_conflict%' THEN RAISE EXCEPTION 'C7: a second key gave %', v_state; END IF;
  v_state := pg_temp.t4271_state(format('SELECT public.issue_4271_bind_refund_provider_key(%L::uuid, %L)',
    v_refund, 'cancel_refund:' || v_refund));
  IF v_state NOT LIKE '22023 invalid_provider_key%' THEN RAISE EXCEPTION 'C7: a foreign key gave %', v_state; END IF;
  v_other := (public.biz_refund_order((f->>'order')::uuid, jsonb_build_array(jsonb_build_object(
    'order_line_item_id', f->>'line', 'quantity', 1)), 'The other ticket too', 'c7-key-2')->>'refund_id')::uuid;
  PERFORM public.issue_4271_commit_refund_failed(v_other, false);
  v_state := pg_temp.t4271_state(format('SELECT public.issue_4271_bind_refund_provider_key(%L::uuid, %L)',
    v_other, 'admin_refund:' || v_other));
  IF v_state NOT LIKE 'PT409 refund_not_pending%' THEN RAISE EXCEPTION 'C7: a failed unbound row gave %', v_state; END IF;
END
$c7$;
ROLLBACK;

-- C8. Grants and definer hygiene.
BEGIN;
DO $c8$
DECLARE r record;
BEGIN
  FOR r IN SELECT unnest(ARRAY['public.issue_4271_commit_refund_failed(uuid,boolean)',
                               'public.issue_4271_bind_refund_provider_key(uuid,text)']) AS fn LOOP
    IF has_function_privilege('anon', r.fn, 'EXECUTE') OR has_function_privilege('authenticated', r.fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'C8: % is callable by a client role', r.fn;
    END IF;
    IF NOT has_function_privilege('service_role', r.fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'C8: service_role cannot call %', r.fn;
    END IF;
  END LOOP;
  FOR r IN SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('issue_4271_commit_refund_failed', 'issue_4271_bind_refund_provider_key') LOOP
    IF NOT r.prosecdef OR NOT EXISTS (SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE 'search_path=%') THEN
      RAISE EXCEPTION 'C8: % must be SECURITY DEFINER with a pinned search_path', r.proname;
    END IF;
  END LOOP;
END
$c8$;
ROLLBACK;
