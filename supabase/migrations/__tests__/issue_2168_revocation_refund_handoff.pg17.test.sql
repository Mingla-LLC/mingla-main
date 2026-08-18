-- =====================================================================
-- issue #2168 -- executable coverage for the revocation -> refund handoff.
--
-- EVERY assertion EXECUTES the objects against real rows. Per #2113 nothing
-- here asserts on migration text or pg_get_functiondef output: this issue
-- exists BECAUSE a comment describing a handoff was mistaken for the handoff.
-- A source-text assertion satisfies no criterion in this file.
--
-- Both directions per #2113: each criterion states the mutation that reds it.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f <this file>
-- after applying every migration in timestamp order to supabase/postgres:17.4.1.075.
-- =====================================================================
\set ON_ERROR_STOP on
\timing off

DO $suite$
DECLARE
  v_fail int := 0;
  v_asserted int := 0;
  v_user uuid; v_brand uuid; v_event uuid; v_paid uuid; v_free uuid;
  v_ob_paid uuid; v_ob_free uuid;
  v_out text; v_n int; v_cnt int;
  v_buyer bigint; v_absorb bigint; v_state text; v_ops text;
BEGIN
  RAISE NOTICE '=== issue #2168 revocation refund handoff -- executable suite ===';

  -- ---------- fixtures ----------
  -- Built here, never borrowed. A suite that reuses whatever rows happen to
  -- exist is conditionally falsifiable -- it passes or fails on a property of
  -- the database rather than of the code (#2113).
  -- brands.account_id -> creator_accounts.id -> auth.users.id, so the whole
  -- chain is built rather than assumed.
  v_user := gen_random_uuid();
  INSERT INTO auth.users(id, instance_id, aud, role, email)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'i2168-'||replace(v_user::text,'-','')||'@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);

  INSERT INTO public.brands(id, account_id, name, slug)
  VALUES (gen_random_uuid(), v_user, 'issue-2168 fixture',
          'issue-2168-'||replace(gen_random_uuid()::text,'-',''))
  RETURNING id INTO v_brand;

  INSERT INTO public.events(id, brand_id, title, slug)
  VALUES (gen_random_uuid(), v_brand, 'issue-2168 fixture event',
          'issue-2168-evt-'||replace(gen_random_uuid()::text,'-',''))
  RETURNING id INTO v_event;

  IF v_brand IS NULL OR v_event IS NULL THEN
    RAISE EXCEPTION 'VACUITY: fixture construction produced no rows';
  END IF;

  INSERT INTO public.ticket_checkout_sessions(
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
    expires_at, subtotal_cents,
    application_fee_amount_cents, total_cents, currency, status,
    idempotency_key, reversal_state)
  VALUES (gen_random_uuid(), v_event, v_brand, 'Paid Fixture',
          'i2168-paid@example.test', '+2348000000001',
          now() + interval '1 day', 9000, 1000, 10000, 'NGN', 'failed',
          'i2168-paid-'||gen_random_uuid(), 'neutralization_pending')
  RETURNING id INTO v_paid;

  INSERT INTO public.ticket_checkout_sessions(
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
    expires_at, subtotal_cents,
    application_fee_amount_cents, total_cents, currency, status,
    idempotency_key, reversal_state)
  VALUES (gen_random_uuid(), v_event, v_brand, 'Free Fixture',
          'i2168-free@example.test', '+2348000000002',
          now() + interval '1 day', 0, 0, 0, 'NGN', 'failed',
          'i2168-free-'||gen_random_uuid(), 'neutralization_pending')
  RETURNING id INTO v_free;

  INSERT INTO public.checkout_sale_revocation_outbox(
    id, subject_type, subject_id, event_id, target_epoch, reason, state)
  VALUES (gen_random_uuid(),'ticket_checkout_session', v_paid, v_event, 1,
          'paid_provider_reference_missing','provider_unknown')
  RETURNING id INTO v_ob_paid;

  INSERT INTO public.checkout_sale_revocation_outbox(
    id, subject_type, subject_id, event_id, target_epoch, reason, state)
  VALUES (gen_random_uuid(),'ticket_checkout_session', v_free, v_event, 1,
          'paid_provider_reference_missing','provider_unknown')
  RETURNING id INTO v_ob_free;

  -- ---------- T-1: a paid row produces exactly one attention artifact ----------
  -- Reds if: the handoff is removed, or it inserts at any state other than
  -- needs_attention, or it routes anywhere but Mingla's review queue.
  v_out := public.issue_2168_handoff_revocation_attention(v_ob_paid);
  v_asserted := v_asserted + 1;
  IF v_out <> 'attention_created' THEN
    v_fail := v_fail + 1; RAISE WARNING 'T-1 FAIL: outcome % (want attention_created)', v_out;
  END IF;

  SELECT count(*), max(buyer_refund_requested_cents), max(platform_fee_absorption_cents),
         max(buyer_state), max(ops_status)
    INTO v_cnt, v_buyer, v_absorb, v_state, v_ops
    FROM public.source_refunds
   WHERE source_id = v_paid AND refund_kind = 'checkout_provider_reference_unresolved';

  v_asserted := v_asserted + 1;
  IF v_cnt <> 1 THEN
    v_fail := v_fail + 1; RAISE WARNING 'T-1 FAIL: % attention rows (want 1)', v_cnt;
  END IF;

  -- ---------- T-2: decision 1 -- a human authorizes before money moves ----------
  -- Reds if: the row is created at `queued`, which would let money move unattended.
  v_asserted := v_asserted + 1;
  IF v_state <> 'needs_attention' THEN
    v_fail := v_fail + 1; RAISE WARNING 'T-2 FAIL: buyer_state % (want needs_attention)', v_state;
  END IF;

  -- ---------- T-3: decision 2 -- it lands on Mingla's desk ----------
  v_asserted := v_asserted + 1;
  IF v_ops <> 'needs_review' THEN
    v_fail := v_fail + 1; RAISE WARNING 'T-3 FAIL: ops_status % (want needs_review)', v_ops;
  END IF;

  -- ---------- T-4: decision 5 -- organiser's portion, Mingla retains its fee ----------
  -- 10000 total, 1000 fee -> buyer is owed 9000 and absorption is 0.
  -- Reds if: anyone "corrects" this to whole-amount parity with
  -- late_payment_no_value. That divergence is deliberate and contractual.
  v_asserted := v_asserted + 1;
  IF v_buyer <> 9000 OR v_absorb <> 0 THEN
    v_fail := v_fail + 1;
    RAISE WARNING 'T-4 FAIL: buyer % absorb % (want 9000 / 0)', v_buyer, v_absorb;
  END IF;

  -- ---------- T-5: idempotent under retry ----------
  -- Reds if: ON CONFLICT is dropped. The worker retries; a duplicate refund row
  -- for one session is a double-refund hazard.
  PERFORM public.issue_2168_handoff_revocation_attention(v_ob_paid);
  PERFORM public.issue_2168_handoff_revocation_attention(v_ob_paid);
  SELECT count(*) INTO v_cnt FROM public.source_refunds
   WHERE source_id = v_paid AND refund_kind = 'checkout_provider_reference_unresolved';
  v_asserted := v_asserted + 1;
  IF v_cnt <> 1 THEN
    v_fail := v_fail + 1; RAISE WARNING 'T-5 FAIL: % rows after 3 deliveries (want 1)', v_cnt;
  END IF;

  -- ---------- T-6: no money owed -> no attention row, and no crash ----------
  -- A free ticket cannot owe the buyer anything, and source_refunds forbids a
  -- zero-value refund by CHECK. Reds if the handoff tries to insert anyway
  -- (constraint violation) or invents a non-zero amount.
  v_out := public.issue_2168_handoff_revocation_attention(v_ob_free);
  v_asserted := v_asserted + 1;
  IF v_out <> 'no_money' THEN
    v_fail := v_fail + 1; RAISE WARNING 'T-6 FAIL: outcome % (want no_money)', v_out;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.source_refunds WHERE source_id = v_free;
  v_asserted := v_asserted + 1;
  IF v_cnt <> 0 THEN
    v_fail := v_fail + 1; RAISE WARNING 'T-6 FAIL: % rows for a zero-value session (want 0)', v_cnt;
  END IF;

  -- ---------- T-7: decision 4 -- the 72-hour deadline speaks ----------
  -- Reds if: the escalation is removed, or its window is widened past 72h.
  UPDATE public.source_refunds SET requested_at = now() - interval '73 hours'
   WHERE source_id = v_paid AND refund_kind = 'checkout_provider_reference_unresolved';
  v_n := public.issue_2168_escalate_overdue_revocation_attention();
  SELECT ops_status INTO v_ops FROM public.source_refunds
   WHERE source_id = v_paid AND refund_kind = 'checkout_provider_reference_unresolved';
  v_asserted := v_asserted + 1;
  IF v_n < 1 OR v_ops <> 'escalated' THEN
    v_fail := v_fail + 1;
    RAISE WARNING 'T-7 FAIL: escalated % rows, ops_status % (want >=1 / escalated)', v_n, v_ops;
  END IF;

  -- ---------- T-8: inside 72 hours it stays quiet ----------
  -- Reds if the window is made unconditional -- an escalation that always fires
  -- carries no more information than one that never fires.
  UPDATE public.source_refunds
     SET requested_at = now() - interval '1 hour', ops_status = 'needs_review'
   WHERE source_id = v_paid AND refund_kind = 'checkout_provider_reference_unresolved';
  PERFORM public.issue_2168_escalate_overdue_revocation_attention();
  SELECT ops_status INTO v_ops FROM public.source_refunds
   WHERE source_id = v_paid AND refund_kind = 'checkout_provider_reference_unresolved';
  v_asserted := v_asserted + 1;
  IF v_ops <> 'needs_review' THEN
    v_fail := v_fail + 1; RAISE WARNING 'T-8 FAIL: ops_status % at 1h (want needs_review)', v_ops;
  END IF;

  -- ---------- T-9: anon and authenticated cannot execute the handoff ----------
  v_asserted := v_asserted + 1;
  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('issue_2168_handoff_revocation_attention',
                       'issue_2168_escalate_overdue_revocation_attention')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_cnt <> 0 THEN
    v_fail := v_fail + 1; RAISE WARNING 'T-9 FAIL: % handoff fn(s) reachable by anon/authenticated', v_cnt;
  END IF;

  -- ---------- T-10: the worker actually has a caller ----------
  -- The whole issue is that a capability with no caller looks armed and is not.
  -- A scheduling claim that passes with no cron.job row would be exactly the
  -- #2113 class this file is written against.
  v_asserted := v_asserted + 1;
  SELECT count(*) INTO v_cnt FROM cron.job
   WHERE jobname = 'issue_2168_checkout_revocation_sweep'
     AND active
     AND schedule = '*/5 * * * *'
     AND command LIKE '%/functions/v1/checkout-sale-revocation%';
  IF v_cnt <> 1 THEN
    v_fail := v_fail + 1; RAISE WARNING 'T-10 FAIL: % matching cron rows (want 1)', v_cnt;
  END IF;

  v_asserted := v_asserted + 1;
  SELECT count(*) INTO v_cnt FROM cron.job
   WHERE jobname = 'issue_2168_revocation_attention_escalation' AND active;
  IF v_cnt <> 1 THEN
    v_fail := v_fail + 1; RAISE WARNING 'T-10 FAIL: escalation cron missing'; END IF;

  -- ---------- vacuity floor ----------
  IF v_asserted < 12 THEN
    RAISE EXCEPTION 'VACUITY: only % assertions ran (expected >= 12)', v_asserted;
  END IF;

  IF v_fail > 0 THEN
    RAISE EXCEPTION 'issue #2168 suite FAILED: % of % assertions', v_fail, v_asserted;
  END IF;
  RAISE NOTICE 'issue #2168 suite PASSED: %/% assertions', v_asserted, v_asserted;
END $suite$;
