-- Issue #4271 follow-up (PR #4303) — TESTER ADVERSARIAL suite, reworked with the
-- implementor after the tester FAIL. Covers
-- 20280426004271_issue_4271_failed_refund_never_reaches_stripe.sql on the
-- replayed PG17 schema.
--
-- Different angle from the implementor suite: it attacks what a 'failed' commit
-- leaves behind and whether stuck rows are still counted, rather than the
-- single host happy path.
--
-- MINGLA-INVARIANT: I-4271-RESUME-NEVER-DOUBLES | issue #4271 | failing a stuck ticket refund never lets the same tickets be refunded twice: a refund committed 'failed' can never later reach Stripe or settle, and a stuck pending refund keeps holding its tickets until it is settled or provably failed.
--
-- Rework (the conductor dropped the resume feature, PR #4303):
--   G1  rewritten: the resume helpers are gone; the new failed-commit and
--       key-binding helpers are service-role only, SECURITY DEFINER with a pinned
--       search_path, and refund_preview is still not callable by anon.
--   G2  rewritten: two stuck rows on a 4-ticket line are BOTH counted (nothing
--       is resumable any more); a new key past capacity is refused.
--   G3  rewritten: answered and succeeded rows are always counted.
--   D1  removed: it only exercised the host resume path (issue_4271_resumable_refund),
--       which no longer exists, so no admin row can be handed to it.
--   D2  UNCHANGED: a row committed 'failed' must never settle later. Green now
--       because issue_2097_claim_refund_attempt answers not-claimed for a refund
--       that is not pending.
--   D3  removed: it only priced a resumable row in refund_preview; refund_preview
--       is no longer changed by this pull request.
\set ON_ERROR_STOP on

-- Session-scoped fixture builder (pg_temp; gone when the session ends).
CREATE FUNCTION pg_temp.t4303_fixture(p_tag int, p_line_qty int, p_unit int, p_second_line boolean)
RETURNS jsonb LANGUAGE plpgsql AS $fx$
DECLARE
  v_owner uuid := ('43030000-0000-4000-8000-' || lpad(p_tag::text, 6, '0') || '000001')::uuid;
  v_brand uuid := ('43030000-0000-4000-8000-' || lpad(p_tag::text, 6, '0') || '000010')::uuid;
  v_event uuid := ('43030000-0000-4000-8000-' || lpad(p_tag::text, 6, '0') || '000020')::uuid;
  v_tt    uuid := ('43030000-0000-4000-8000-' || lpad(p_tag::text, 6, '0') || '000030')::uuid;
  v_tt2   uuid := ('43030000-0000-4000-8000-' || lpad(p_tag::text, 6, '0') || '000031')::uuid;
  v_order uuid := ('43030000-0000-4000-8000-' || lpad(p_tag::text, 6, '0') || '000040')::uuid;
  v_line  uuid := ('43030000-0000-4000-8000-' || lpad(p_tag::text, 6, '0') || '000050')::uuid;
  v_line2 uuid := ('43030000-0000-4000-8000-' || lpad(p_tag::text, 6, '0') || '000051')::uuid;
  v_total int := p_line_qty * p_unit + CASE WHEN p_second_line THEN 5 * 2000 ELSE 0 END;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'owner-4303-' || p_tag || '@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-4303-' || p_tag || '@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency)
  VALUES (v_brand, v_owner, 'PR 4303 ' || p_tag, 'pr-4303-' || p_tag, 'stripe', 'GB', 'GBP', 'GBP');
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'PR 4303 ' || p_tag, 'pr-4303-ev-' || p_tag, 'ended', 'GBP');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents) VALUES (v_tt, v_event, 'General', p_unit);
  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, stripe_charge_id, source, stripe_application_fee_amount_cents)
  VALUES (v_order, v_event, v_total, 'GBP', 'paid', 'pi_4303_' || p_tag, 'ch_4303_' || p_tag, 'legacy', 30);
  INSERT INTO public.order_line_items(id, order_id, ticket_type_id, quantity, unit_price_cents, total_cents)
  VALUES (v_line, v_order, v_tt, p_line_qty, p_unit, p_line_qty * p_unit);
  IF p_second_line THEN
    INSERT INTO public.ticket_types(id, event_id, name, price_cents) VALUES (v_tt2, v_event, 'Standard', 2000);
    INSERT INTO public.order_line_items(id, order_id, ticket_type_id, quantity, unit_price_cents, total_cents)
    VALUES (v_line2, v_order, v_tt2, 5, 2000, 10000);
  END IF;
  RETURN jsonb_build_object('owner', v_owner, 'order', v_order, 'line', v_line, 'tt', v_tt, 'total', v_total);
END
$fx$;

CREATE FUNCTION pg_temp.t4303_as(p_sub uuid) RETURNS void LANGUAGE sql AS $as$
  SELECT set_config('request.jwt.claim.sub', COALESCE(p_sub::text, ''), true),
         set_config('request.jwt.claims',
           CASE WHEN p_sub IS NULL THEN '' ELSE jsonb_build_object('sub', p_sub, 'role', 'authenticated')::text END,
           true);
$as$;

-- G1. Grants and definer hygiene.
BEGIN;
DO $g1$
DECLARE r record;
BEGIN
  IF to_regproc('public.issue_4271_resumable_refund') IS NOT NULL
     OR to_regproc('public.issue_4271_resumable_refund_id') IS NOT NULL THEN
    RAISE EXCEPTION 'G1: a dropped resume helper still exists';
  END IF;
  FOR r IN SELECT unnest(ARRAY['anon', 'authenticated']) AS role_name LOOP
    IF has_function_privilege(r.role_name, 'public.issue_4271_commit_refund_failed(uuid, boolean)', 'EXECUTE')
       OR has_function_privilege(r.role_name, 'public.issue_4271_bind_refund_provider_key(uuid, text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'G1: % can execute a #4271 helper', r.role_name;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.refund_preview(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G1: anon can call refund_preview';
  END IF;
  FOR r IN SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('issue_4271_commit_refund_failed', 'issue_4271_bind_refund_provider_key', 'refund_preview') LOOP
    IF NOT r.prosecdef OR r.proconfig IS NULL
       OR NOT EXISTS (SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE 'search_path=%') THEN
      RAISE EXCEPTION 'G1: % must be SECURITY DEFINER with a pinned search_path', r.proname;
    END IF;
  END LOOP;
END
$g1$;
ROLLBACK;

-- G2. Two identical stuck rows on a 4-ticket line are both counted.
BEGIN;
DO $g2$
DECLARE
  f jsonb := pg_temp.t4303_fixture(2, 4, 1000, false);
  v_order uuid := (f->>'order')::uuid;
  v_lines jsonb := jsonb_build_array(jsonb_build_object('order_line_item_id', f->>'line', 'quantity', 2));
  v_lines1 jsonb := jsonb_build_array(jsonb_build_object('order_line_item_id', f->>'line', 'quantity', 1));
  v_raised text;
BEGIN
  PERFORM pg_temp.t4303_as((f->>'owner')::uuid);
  PERFORM public.biz_refund_order(v_order, v_lines, 'Guest asked for a refund', 'g2-key-one');
  PERFORM public.biz_refund_order(v_order, v_lines, 'Second guest asked too', 'g2-key-two');
  v_raised := NULL;
  BEGIN PERFORM public.refund_preview(v_order, v_lines1); EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised NOT LIKE 'line_overrefund%' THEN
    RAISE EXCEPTION 'G2: two stuck 2-ticket rows fill a 4-ticket line; a 1-ticket preview must overrefund, got %', coalesce(v_raised, 'success');
  END IF;
  v_raised := NULL;
  BEGIN PERFORM public.biz_refund_order(v_order, v_lines, 'A third attempt here', 'g2-key-three'); EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised NOT LIKE 'line_overrefund%' THEN
    RAISE EXCEPTION 'G2: a new key past capacity must refuse, got %', coalesce(v_raised, 'success');
  END IF;
END
$g2$;
ROLLBACK;

-- G3. Answered or settled rows are always counted.
BEGIN;
DO $g3$
DECLARE
  f jsonb := pg_temp.t4303_fixture(3, 2, 1000, false);
  v_order uuid := (f->>'order')::uuid;
  v_lines jsonb := jsonb_build_array(jsonb_build_object('order_line_item_id', f->>'line', 'quantity', 2));
  v_id uuid; v_raised text;
BEGIN
  PERFORM pg_temp.t4303_as((f->>'owner')::uuid);
  v_id := (public.biz_refund_order(v_order, v_lines, 'Guest asked for a refund', 'g3-key-one')->>'refund_id')::uuid;
  UPDATE public.refunds SET stripe_refund_id = 're_g3_answered' WHERE id = v_id;
  v_raised := NULL;
  BEGIN PERFORM public.refund_preview(v_order, v_lines); EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised NOT LIKE 'line_overrefund%' THEN
    RAISE EXCEPTION 'G3: a row Stripe answered must be counted, got %', coalesce(v_raised, 'success');
  END IF;
  IF public.issue_4271_commit_refund_failed(v_id, false)->>'outcome' <> 'unknown' THEN
    RAISE EXCEPTION 'G3: a row Stripe answered must never be failed';
  END IF;
  -- (the #2097 fee truth settles the fee status before the commit)
  UPDATE public.refunds SET application_fee_refund_status = 'succeeded_positive',
    application_fee_refunded_cents = 30 WHERE id = v_id;
  PERFORM public.biz_refund_order_commit(v_id, 're_g3_answered', 30, 'succeeded');
  v_raised := NULL;
  BEGIN PERFORM public.refund_preview(v_order, v_lines); EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised NOT LIKE 'line_overrefund%' THEN
    RAISE EXCEPTION 'G3: a succeeded refund must be counted, got %', coalesce(v_raised, 'success');
  END IF;
END
$g3$;
ROLLBACK;

-- D2. A refund committed 'failed' must never settle later.
BEGIN;
DO $d2$
DECLARE
  f jsonb := pg_temp.t4303_fixture(12, 2, 1000, false);
  v_order uuid := (f->>'order')::uuid;
  v_lines jsonb := jsonb_build_array(jsonb_build_object('order_line_item_id', f->>'line', 'quantity', 2));
  v_r1 uuid; v_r2 uuid; v_prep jsonb; v_claim jsonb; v_owner2 uuid := gen_random_uuid();
  v_refunded int; v_errors text := '';
BEGIN
  PERFORM pg_temp.t4303_as((f->>'owner')::uuid);
  v_r1 := (public.biz_refund_order(v_order, v_lines, 'Guest asked for a refund', 'd2-key-one')->>'refund_id')::uuid;
  -- refund-order prepared the #2097 attempt (provider call permitted), then
  -- refunds.create threw a StripePermissionError: the row is committed failed.
  v_prep := public.issue_2097_prepare_refund_attempt(v_r1, 'd2-key-one', 'test', 'acct_4303',
    'GBP', 'ch_4303_12', 'pi_4303_12', 'fee_4303_12', '30', '2000', '2000', '[]'::jsonb, '0', true, 1,
    gen_random_uuid());
  IF (v_prep->>'provider_call_permitted')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D2 setup: prepare did not permit, got %', v_prep;
  END IF;
  PERFORM public.biz_refund_order_commit(v_r1, NULL, 0, 'failed');

  -- The tickets are free again: the host refunds them under a new row and it settles.
  v_r2 := (public.biz_refund_order(v_order, v_lines, 'Refund again after error', 'd2-key-two')->>'refund_id')::uuid;
  UPDATE public.refunds SET application_fee_refund_status = 'succeeded_positive',
    application_fee_refunded_cents = 30 WHERE id = v_r2;
  PERFORM public.biz_refund_order_commit(v_r2, 're_d2_second', 30, 'succeeded');

  -- Later (same-key Send in the still-open sheet, or admin-reconcile-ticket-refund)
  -- the failed row's attempt is claimed again once its lease lapsed.
  UPDATE public.ticket_refund_attempts SET lease_expires_at = now() - interval '1 second'
   WHERE refund_id = v_r1;
  v_claim := public.issue_2097_claim_refund_attempt((v_prep->>'attempt_id')::uuid, v_owner2);
  IF (v_claim->>'claimed')::boolean THEN
    v_errors := v_errors || format('claim of the failed row''s attempt succeeded (%s); ', v_claim);
    -- (refunds.create is called here in the edge function: a second Stripe refund.)
    PERFORM public.issue_2097_record_buyer_refund((v_prep->>'attempt_id')::uuid, v_owner2,
      (v_claim->>'lease_epoch')::bigint, 're_d2_late', '2000');
    IF (SELECT stripe_refund_id FROM public.refunds WHERE id = v_r1) = 're_d2_late' THEN
      v_errors := v_errors || 'a second buyer refund was recorded on the failed row; ';
    END IF;
    BEGIN
      PERFORM public.issue_2097_finalize_refund_attempt((v_prep->>'attempt_id')::uuid, v_owner2,
        (v_claim->>'lease_epoch')::bigint, 'succeeded_positive', 'fr_d2_late', '30', '30', NULL);
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || format('finalize then refused (%s), so the money left twice and the ledger is stuck; ', SQLERRM);
    END;
  END IF;
  SELECT refunded_amount_cents INTO v_refunded FROM public.orders WHERE id = v_order;
  IF v_refunded > (f->>'total')::int THEN
    v_errors := v_errors || format('order refunded %s of a %s charge (failed row %s now %s); ',
      v_refunded, f->>'total', v_r1, (SELECT status FROM public.refunds WHERE id = v_r1));
  END IF;
  IF v_errors <> '' THEN RAISE EXCEPTION 'DEFECT D2: %', v_errors; END IF;
END
$d2$;
ROLLBACK;
