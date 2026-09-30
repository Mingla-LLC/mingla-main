-- Issue #3645 PR2 — cancel-review hold (PostgreSQL 17 TESTER adversarial).
-- Different angle from the implementor happy path: try to get money moving while the
-- batch is held, try to release it without authority, and prove the zero-work and
-- already-released paths are not broken by the hold. Every write rolls back.
--
--   ADV-1  claim leases NOTHING while awaiting_review, even on a far-future clock and
--          with stale-lease / failed_retryable rows forced into the progress table;
--          claim with no run row at all leases nothing
--   ADV-2  release authority: authenticated NON-admin -> not_authorized; anon ->
--          insufficient_privilege; admin with blank / invisible-only reason ->
--          reason_required; unknown event -> run_not_found. The run stays
--          awaiting_review and NO audit row is written after every refusal
--   ADV-3  release is single-shot: a second release -> not_awaiting_review; release
--          of a completed run -> not_awaiting_review
--   ADV-4  zero-object cancel still completes (completed_at stamped) and still freezes
--          sales
--   ADV-5  RSVP-only cancel is held; once its contribution is fully refunded, prepare
--          completes it
--   ADV-6  a run already released by #1179 (in_progress / failed_partial) is NEVER
--          pulled back into review by a re-prepare
--   ADV-7  the status CHECK accepts awaiting_review and rejects junk; the #1179
--          backstop cron command does not select awaiting_review
BEGIN;

DO $test$
DECLARE
  v_owner   constant uuid := '36450000-0000-4000-8000-0000000000a1';
  v_admin   constant uuid := '36450000-0000-4000-8000-0000000000a2';
  v_member  constant uuid := '36450000-0000-4000-8000-0000000000a3';
  v_brand   constant uuid := '36450000-0000-4000-8000-0000000000b1';
  v_ev_hold constant uuid := '36450000-0000-4000-8000-0000000000c1';
  v_ev_zero constant uuid := '36450000-0000-4000-8000-0000000000c2';
  v_ev_rsvp constant uuid := '36450000-0000-4000-8000-0000000000c3';
  v_ev_prog constant uuid := '36450000-0000-4000-8000-0000000000c4';
  v_ev_part constant uuid := '36450000-0000-4000-8000-0000000000c5';
  v_ev_none constant uuid := '36450000-0000-4000-8000-0000000000c6';
  v_ev_unknown constant uuid := '36450000-0000-4000-8000-0000000000ff';
  v_o_hold  constant uuid := '36450000-0000-4000-8000-0000000000d1';
  v_o_prog  constant uuid := '36450000-0000-4000-8000-0000000000d2';
  v_o_part  constant uuid := '36450000-0000-4000-8000-0000000000d3';
  v_tt_zero constant uuid := '36450000-0000-4000-8000-0000000000e1';
  v_contrib constant uuid := '36450000-0000-4000-8000-0000000000f1';
  v_prep    jsonb;
  v_status  text;
  v_count   integer;
  v_audits  integer;
  v_cmd     text;
  v_bool    boolean;
  v_ts      timestamptz;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-3645a@example.test');
  INSERT INTO auth.users(id, email) VALUES
    (v_admin,  'admin-3645a@example.test'),
    (v_member, 'member-3645a@example.test');
  INSERT INTO public.admin_users(email, role, status)
  VALUES ('admin-3645a@example.test', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 Adversarial Brand', 'issue-3645-adv-brand',
    'stripe', 'US', 'USD', 'USD'
  );
  INSERT INTO public.events(id, brand_id, title, slug, status, currency) VALUES
    (v_ev_hold, v_brand, 'Adv Hold',      'issue-3645a-hold', 'cancelled', 'USD'),
    (v_ev_zero, v_brand, 'Adv Zero',      'issue-3645a-zero', 'cancelled', 'USD'),
    (v_ev_rsvp, v_brand, 'Adv RSVP',      'issue-3645a-rsvp', 'cancelled', 'USD'),
    (v_ev_prog, v_brand, 'Adv InProg',    'issue-3645a-prog', 'cancelled', 'USD'),
    (v_ev_part, v_brand, 'Adv Partial',   'issue-3645a-part', 'cancelled', 'USD'),
    (v_ev_none, v_brand, 'Adv NoRun',     'issue-3645a-none', 'cancelled', 'USD');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents)
  VALUES (v_tt_zero, v_ev_zero, 'GA', 1000);
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, stripe_charge_id, source
  ) VALUES
    (v_o_hold, v_ev_hold, 4000, 'USD', 'paid', 'pi_3645a_hold', 'ch_3645a_hold', 'legacy'),
    (v_o_prog, v_ev_prog, 4000, 'USD', 'paid', 'pi_3645a_prog', 'ch_3645a_prog', 'legacy'),
    (v_o_part, v_ev_part, 4000, 'USD', 'paid', 'pi_3645a_part', 'ch_3645a_part', 'legacy');

  ------------------------------------------------------------------------------
  -- ADV-1: the hold — claim leases nothing.
  ------------------------------------------------------------------------------
  v_prep := public.cancel_event_refund_prepare(v_ev_hold);
  IF v_prep->>'run_status' <> 'awaiting_review' THEN
    RAISE EXCEPTION 'ADV1 setup: expected awaiting_review got %', v_prep->>'run_status';
  END IF;
  SELECT count(*) INTO v_count
    FROM public.cancel_event_refund_claim(v_ev_hold, 25, now() + interval '30 days');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'ADV1 HOLD BREACH: claim leased % rows while awaiting_review', v_count;
  END IF;
  -- Force a stale-lease refunding row and an under-cap failed_retryable row: the
  -- reclaim branches must not bypass the hold either.
  INSERT INTO public.event_cancel_refund_progress(
    event_id, source_type, source_id, provider, amount_cents, status,
    attempt_count, leased_at
  ) VALUES
    (v_ev_hold, 'order', gen_random_uuid(), 'stripe', 100, 'refunding', 1,
     now() - interval '1 day'),
    (v_ev_hold, 'order', gen_random_uuid(), 'stripe', 100, 'failed_retryable', 1,
     now() - interval '1 day');
  SELECT count(*) INTO v_count
    FROM public.cancel_event_refund_claim(v_ev_hold, 25, now() + interval '30 days');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'ADV1 HOLD BREACH: stale/retryable reclaim leased % rows while held', v_count;
  END IF;
  DELETE FROM public.event_cancel_refund_progress
   WHERE event_id = v_ev_hold AND status IN ('refunding','failed_retryable');

  -- No run row at all: nothing to claim.
  SELECT count(*) INTO v_count FROM public.cancel_event_refund_claim(v_ev_none, 25);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'ADV1 claim with no run row leased % rows', v_count;
  END IF;

  ------------------------------------------------------------------------------
  -- ADV-2: release authority. Nothing changes after any refusal.
  ------------------------------------------------------------------------------
  -- (a) authenticated non-admin
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  BEGIN
    PERFORM public.admin_release_event_cancel_refund_batch(v_ev_hold, 'sneaky release');
    RAISE EXCEPTION 'ADV2a FAIL: non-admin released the held batch';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%not_authorized%' THEN
      RAISE EXCEPTION 'ADV2a expected not_authorized got %', SQLERRM;
    END IF;
  END;
  RESET ROLE;

  -- (b) anon — blocked by the ACL even with a spoofed admin sub
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  BEGIN
    PERFORM public.admin_release_event_cancel_refund_batch(v_ev_hold, 'anon release');
    RAISE EXCEPTION 'ADV2b FAIL: anon released the held batch';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;

  -- (c) admin with blank / invisible-only reason, (d) unknown event
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  BEGIN
    PERFORM public.admin_release_event_cancel_refund_batch(v_ev_hold, '   ');
    RAISE EXCEPTION 'ADV2c FAIL: blank reason accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%reason_required%' THEN
      RAISE EXCEPTION 'ADV2c expected reason_required got %', SQLERRM;
    END IF;
  END;
  BEGIN
    PERFORM public.admin_release_event_cancel_refund_batch(v_ev_hold, NULL);
    RAISE EXCEPTION 'ADV2c FAIL: NULL reason accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%reason_required%' THEN
      RAISE EXCEPTION 'ADV2c expected reason_required got %', SQLERRM;
    END IF;
  END;
  BEGIN
    -- invisible-only reason (NBSP + ZWSP): rejected by the audit primitive's reason gate,
    -- which aborts the whole release (the status flip rolls back with it).
    PERFORM public.admin_release_event_cancel_refund_batch(
      v_ev_hold, chr(160) || chr(8203) || chr(160));
    RAISE EXCEPTION 'ADV2c FAIL: invisible-only reason accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%reason_required%' THEN
      RAISE EXCEPTION 'ADV2c expected reason_required for invisible reason got %', SQLERRM;
    END IF;
  END;
  BEGIN
    PERFORM public.admin_release_event_cancel_refund_batch(v_ev_unknown, 'no such run');
    RAISE EXCEPTION 'ADV2d FAIL: unknown event released';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%run_not_found%' THEN
      RAISE EXCEPTION 'ADV2d expected run_not_found got %', SQLERRM;
    END IF;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  SELECT status INTO v_status FROM public.event_cancel_refund_runs WHERE event_id = v_ev_hold;
  IF v_status <> 'awaiting_review' THEN
    RAISE EXCEPTION 'ADV2 run left awaiting_review after refused releases: %', v_status;
  END IF;
  SELECT count(*) INTO v_audits FROM public.admin_audit_log
   WHERE action = 'offering.cancel_refund_release';
  IF v_audits <> 0 THEN
    RAISE EXCEPTION 'ADV2 refused releases wrote % audit rows', v_audits;
  END IF;
  SELECT count(*) INTO v_count FROM public.cancel_event_refund_claim(v_ev_hold, 25);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'ADV2 claim leased % rows after refused releases', v_count;
  END IF;

  ------------------------------------------------------------------------------
  -- ADV-3: release is single-shot; a completed run cannot be "released".
  ------------------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.admin_release_event_cancel_refund_batch(v_ev_hold, 'Reviewed and approved');
  BEGIN
    PERFORM public.admin_release_event_cancel_refund_batch(v_ev_hold, 'double release');
    RAISE EXCEPTION 'ADV3 FAIL: second release accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%not_awaiting_review%' THEN
      RAISE EXCEPTION 'ADV3 expected not_awaiting_review got %', SQLERRM;
    END IF;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT count(*) INTO v_audits FROM public.admin_audit_log
   WHERE action = 'offering.cancel_refund_release' AND target_id = v_ev_hold::text;
  IF v_audits <> 1 THEN
    RAISE EXCEPTION 'ADV3 expected exactly 1 audit row for the single release, got %', v_audits;
  END IF;
  SELECT count(*) INTO v_count FROM public.cancel_event_refund_claim(v_ev_hold, 25);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ADV3 claim after release expected 1 got %', v_count;
  END IF;

  ------------------------------------------------------------------------------
  -- ADV-4: zero refund work completes immediately and still freezes sales.
  ------------------------------------------------------------------------------
  v_prep := public.cancel_event_refund_prepare(v_ev_zero);
  IF v_prep->>'run_status' <> 'completed' THEN
    RAISE EXCEPTION 'ADV4 zero-work cancel expected completed got %', v_prep->>'run_status';
  END IF;
  SELECT completed_at INTO v_ts FROM public.event_cancel_refund_runs WHERE event_id = v_ev_zero;
  IF v_ts IS NULL THEN
    RAISE EXCEPTION 'ADV4 zero-work completed run has no completed_at';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ticket_types WHERE id = v_tt_zero AND is_disabled AND sale_end_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ADV4 zero-work cancel did not freeze ticket sales';
  END IF;
  SELECT bookings_closed INTO v_bool FROM public.events WHERE id = v_ev_zero;
  IF v_bool IS NOT TRUE THEN
    RAISE EXCEPTION 'ADV4 zero-work cancel did not close bookings';
  END IF;

  -- and a completed run cannot be released.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  BEGIN
    PERFORM public.admin_release_event_cancel_refund_batch(v_ev_zero, 'release completed');
    RAISE EXCEPTION 'ADV3b FAIL: completed run released';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%not_awaiting_review%' THEN
      RAISE EXCEPTION 'ADV3b expected not_awaiting_review got %', SQLERRM;
    END IF;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  ------------------------------------------------------------------------------
  -- ADV-5: RSVP-only cancel is held; fully refunded -> completes.
  ------------------------------------------------------------------------------
  INSERT INTO public.event_rsvp_contributions(
    id, event_id, brand_id, provider, currency, amount_cents, buyer_total_cents,
    pricing_breakdown, status, stripe_payment_intent_id, paid_at
  ) VALUES (
    v_contrib, v_ev_rsvp, v_brand, 'stripe', 'USD', 2500, 2500,
    '{"tax_basis":"voluntary_contribution","tax_cents":0}'::jsonb, 'paid',
    'pi_3645a_rsvp', now()
  );
  v_prep := public.cancel_event_refund_prepare(v_ev_rsvp);
  IF v_prep->>'run_status' <> 'awaiting_review' OR (v_prep->>'rsvp_pending_count')::int <> 1 THEN
    RAISE EXCEPTION 'ADV5 RSVP-only cancel expected held, got %', v_prep;
  END IF;
  SELECT count(*) INTO v_count FROM public.cancel_event_refund_claim(v_ev_rsvp, 25);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'ADV5 claim leased % rows for a held RSVP-only run', v_count;
  END IF;
  UPDATE public.event_rsvp_contributions
     SET status = 'refunded', refunded_amount_cents = 2500 WHERE id = v_contrib;
  v_prep := public.cancel_event_refund_prepare(v_ev_rsvp);
  IF v_prep->>'run_status' <> 'completed' THEN
    RAISE EXCEPTION 'ADV5 fully-refunded RSVP run expected completed got %', v_prep->>'run_status';
  END IF;

  ------------------------------------------------------------------------------
  -- ADV-6: a run already released (by #1179 or an admin) is never re-held.
  ------------------------------------------------------------------------------
  INSERT INTO public.event_cancel_refund_runs(event_id, status, opened_at)
  VALUES (v_ev_prog, 'in_progress', now() - interval '1 hour');
  v_prep := public.cancel_event_refund_prepare(v_ev_prog);
  IF v_prep->>'run_status' <> 'in_progress' THEN
    RAISE EXCEPTION 'ADV6 in_progress run pulled to % by re-prepare', v_prep->>'run_status';
  END IF;
  SELECT count(*) INTO v_count FROM public.cancel_event_refund_claim(v_ev_prog, 25);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ADV6 already-released run must still drain, claimed %', v_count;
  END IF;

  INSERT INTO public.event_cancel_refund_runs(event_id, status, opened_at)
  VALUES (v_ev_part, 'failed_partial', now() - interval '1 hour');
  v_prep := public.cancel_event_refund_prepare(v_ev_part);
  IF v_prep->>'run_status' <> 'failed_partial' THEN
    RAISE EXCEPTION 'ADV6 failed_partial run pulled to % by re-prepare', v_prep->>'run_status';
  END IF;

  ------------------------------------------------------------------------------
  -- ADV-7: status CHECK + backstop cron scope.
  ------------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.event_cancel_refund_runs(event_id, status)
    VALUES (v_ev_none, 'not_a_status');
    RAISE EXCEPTION 'ADV7 FAIL: junk run status accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  INSERT INTO public.event_cancel_refund_runs(event_id, status)
  VALUES (v_ev_none, 'awaiting_review');

  SELECT command INTO v_cmd FROM cron.job
   WHERE jobname = 'issue_1179_cancel_refund_fanout_backstop' LIMIT 1;
  IF v_cmd IS NULL THEN
    RAISE EXCEPTION 'ADV7 backstop cron job missing';
  END IF;
  IF position('awaiting_review' IN v_cmd) > 0 THEN
    RAISE EXCEPTION 'ADV7 backstop cron selects awaiting_review runs';
  END IF;
  IF position('''pending'',''in_progress'',''failed_partial''' IN v_cmd) = 0 THEN
    RAISE EXCEPTION 'ADV7 backstop cron status filter drifted: %', v_cmd;
  END IF;

  RAISE NOTICE 'issue_3645_cancel_review_adversarial_pass hold-on-claim + release authority/reason/single-shot + zero-work completes + rsvp hold + no re-hold + check/cron scope';
END;
$test$;

ROLLBACK;
