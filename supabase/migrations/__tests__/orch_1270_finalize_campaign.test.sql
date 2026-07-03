-- ORCH-1270 — SQL probe for the RC-2 honest-status finalizer.
-- Hand-run after `supabase db push --linked` (or in the CI baseline-apply DB).
-- Exercises the SPEC §5.2 status matrix and the never-`sent`-with-0 invariant.
--
-- Everything runs inside ONE transaction that ROLLBACKs at the end, with
-- session_replication_role='replica' so we can insert fixture campaigns
-- WITHOUT satisfying the account_id/brand_id/audience_id foreign keys. CHECK
-- constraints still fire (we only ever insert valid statuses).
--
-- fails-on-revert: if 20261203000000_orch_1270_sms_quiet_hours_defer.sql is
-- absent, mkt_finalize_campaign does not exist and CASE A RAISEs immediately.
-- If someone restores the old inline `status='sent'` unconditional write (RC-2
-- regression), the "never sent with 0" + deferred→scheduled assertions fail.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL session_replication_role = 'replica';

DO $$
DECLARE
  c uuid;
  v_status text;
  v_rc integer;
  v_sched timestamptz;
  v_sent timestamptz;
  v_ret text;
BEGIN
  -- Helper inline: fresh campaign in 'sending' (as the cron claim left it).
  -- ─── CASE A: only deferred → scheduled, rc=0 (delivered running), sent_at NULL,
  --            scheduled_for = MIN(next_attempt_at) ────────────────────────────
  c := gen_random_uuid();
  INSERT INTO public.marketing_campaigns (id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
    VALUES (c, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'A', 'sms', '{"kind":"sms","body":"x"}', 'sending');
  INSERT INTO public.marketing_messages (campaign_id, recipient_phone, channel, status, next_attempt_at) VALUES
    (c, '+15000000001', 'sms', 'deferred', timestamptz '2030-01-01 10:00:00+00'),
    (c, '+15000000002', 'sms', 'deferred', timestamptz '2030-01-01 08:00:00+00');
  v_ret := public.mkt_finalize_campaign(c);
  SELECT status, recipient_count, scheduled_for, sent_at INTO v_status, v_rc, v_sched, v_sent
    FROM public.marketing_campaigns WHERE id = c;
  IF v_ret <> 'scheduled' OR v_status <> 'scheduled' THEN
    RAISE EXCEPTION 'CASE A FAIL: expected scheduled, ret=% row=%', v_ret, v_status;
  END IF;
  IF v_rc <> 0 THEN RAISE EXCEPTION 'CASE A FAIL: recipient_count expected 0, got %', v_rc; END IF;
  IF v_sent IS NOT NULL THEN RAISE EXCEPTION 'CASE A FAIL: sent_at must be NULL for a deferred cohort'; END IF;
  IF v_sched <> timestamptz '2030-01-01 08:00:00+00' THEN
    RAISE EXCEPTION 'CASE A FAIL: scheduled_for expected MIN next_attempt (08:00), got %', v_sched;
  END IF;
  RAISE NOTICE 'CASE A PASS: deferred-only → scheduled, rc=0, scheduled_for=MIN(next_attempt), sent_at NULL';

  -- ─── CASE B: deferred + delivered → scheduled wins, rc = delivered (running) ──
  c := gen_random_uuid();
  INSERT INTO public.marketing_campaigns (id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
    VALUES (c, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'B', 'sms', '{"kind":"sms","body":"x"}', 'sending');
  INSERT INTO public.marketing_messages (campaign_id, recipient_phone, channel, status, next_attempt_at, sent_at) VALUES
    (c, '+15000000010', 'sms', 'sent', NULL, now()),
    (c, '+15000000011', 'sms', 'deferred', timestamptz '2030-02-02 09:00:00+00', NULL);
  v_ret := public.mkt_finalize_campaign(c);
  SELECT status, recipient_count, scheduled_for, sent_at INTO v_status, v_rc, v_sched, v_sent
    FROM public.marketing_campaigns WHERE id = c;
  IF v_status <> 'scheduled' THEN RAISE EXCEPTION 'CASE B FAIL: deferred must win, got %', v_status; END IF;
  IF v_rc <> 1 THEN RAISE EXCEPTION 'CASE B FAIL: recipient_count expected 1 (running delivered), got %', v_rc; END IF;
  IF v_sent IS NOT NULL THEN RAISE EXCEPTION 'CASE B FAIL: sent_at must stay NULL while deferred remain'; END IF;
  IF v_sched <> timestamptz '2030-02-02 09:00:00+00' THEN
    RAISE EXCEPTION 'CASE B FAIL: scheduled_for expected the deferred next_attempt, got %', v_sched;
  END IF;
  RAISE NOTICE 'CASE B PASS: deferred+delivered → scheduled, rc=1 running';

  -- ─── CASE C: only failed → failed, rc=0 ──────────────────────────────────────
  c := gen_random_uuid();
  INSERT INTO public.marketing_campaigns (id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
    VALUES (c, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'C', 'sms', '{"kind":"sms","body":"x"}', 'sending');
  INSERT INTO public.marketing_messages (campaign_id, recipient_phone, channel, status, failure_reason) VALUES
    (c, '+15000000020', 'sms', 'failed', 'unknown_timezone'),
    (c, '+15000000021', 'sms', 'failed', 'quiet_hours_unreachable');
  v_ret := public.mkt_finalize_campaign(c);
  SELECT status, recipient_count, sent_at INTO v_status, v_rc, v_sent
    FROM public.marketing_campaigns WHERE id = c;
  IF v_ret <> 'failed' OR v_status <> 'failed' THEN RAISE EXCEPTION 'CASE C FAIL: expected failed, got %', v_status; END IF;
  IF v_rc <> 0 THEN RAISE EXCEPTION 'CASE C FAIL: recipient_count expected 0, got %', v_rc; END IF;
  RAISE NOTICE 'CASE C PASS: failures-only → failed, rc=0';

  -- ─── CASE D: ≥1 delivered (+ a failure) → sent, rc = delivered > 0 ───────────
  c := gen_random_uuid();
  INSERT INTO public.marketing_campaigns (id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
    VALUES (c, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'D', 'sms', '{"kind":"sms","body":"x"}', 'sending');
  INSERT INTO public.marketing_messages (campaign_id, recipient_phone, channel, status, sent_at) VALUES
    (c, '+15000000030', 'sms', 'sent', now()),
    (c, '+15000000031', 'sms', 'delivered', now());
  INSERT INTO public.marketing_messages (campaign_id, recipient_phone, channel, status, failure_reason) VALUES
    (c, '+15000000032', 'sms', 'failed', 'sms_unknown_error');
  v_ret := public.mkt_finalize_campaign(c);
  SELECT status, recipient_count, sent_at INTO v_status, v_rc, v_sent
    FROM public.marketing_campaigns WHERE id = c;
  IF v_ret <> 'sent' OR v_status <> 'sent' THEN RAISE EXCEPTION 'CASE D FAIL: expected sent, got %', v_status; END IF;
  IF v_rc <> 2 THEN RAISE EXCEPTION 'CASE D FAIL: recipient_count expected 2 (sent+delivered), got %', v_rc; END IF;
  IF v_sent IS NULL THEN RAISE EXCEPTION 'CASE D FAIL: sent_at must be set on sent'; END IF;
  RAISE NOTICE 'CASE D PASS: delivered>0 → sent, rc=2, sent_at set';

  -- ─── CASE E: only preview_skipped → sent, rc = preview count ─────────────────
  c := gen_random_uuid();
  INSERT INTO public.marketing_campaigns (id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
    VALUES (c, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'E', 'sms', '{"kind":"sms","body":"x"}', 'sending');
  INSERT INTO public.marketing_messages (campaign_id, recipient_phone, channel, status) VALUES
    (c, '+15000000040', 'sms', 'preview_skipped'),
    (c, '+15000000041', 'sms', 'preview_skipped');
  v_ret := public.mkt_finalize_campaign(c);
  SELECT status, recipient_count INTO v_status, v_rc FROM public.marketing_campaigns WHERE id = c;
  IF v_status <> 'sent' THEN RAISE EXCEPTION 'CASE E FAIL: preview-only expected sent, got %', v_status; END IF;
  IF v_rc <> 2 THEN RAISE EXCEPTION 'CASE E FAIL: recipient_count expected 2 (preview), got %', v_rc; END IF;
  RAISE NOTICE 'CASE E PASS: preview_skipped-only → sent, rc=preview count';

  -- ─── CASE F (the headline invariant): empty campaign → failed, NEVER sent-w/-0 ─
  c := gen_random_uuid();
  INSERT INTO public.marketing_campaigns (id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
    VALUES (c, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'F', 'sms', '{"kind":"sms","body":"x"}', 'sending');
  v_ret := public.mkt_finalize_campaign(c);
  SELECT status, recipient_count INTO v_status, v_rc FROM public.marketing_campaigns WHERE id = c;
  IF v_status = 'sent' THEN RAISE EXCEPTION 'CASE F FAIL: a 0-message campaign must NEVER be sent (I-PROPOSED-1270-NO-EMPTY-SENT)'; END IF;
  IF v_status <> 'failed' OR v_rc <> 0 THEN RAISE EXCEPTION 'CASE F FAIL: empty campaign expected failed/0, got %/%', v_status, v_rc; END IF;
  RAISE NOTICE 'CASE F PASS: empty campaign → failed (never sent with recipient_count=0)';

  RAISE NOTICE 'ORCH-1270 finalizer probe: ALL CASES PASS';
END$$;

ROLLBACK;
