-- ORCH-1270 [TESTER — adversarial] — direct attack on the double-send backbone.
-- Hand-run against a DB that already has base + 20261203000000 applied (same
-- convention as orch_1270_finalize_campaign.test.sql):
--   psql ... -v ON_ERROR_STOP=1 -f orch_1270_tester_double_send.test.sql
--
-- DIFFERENT ANGLE than the implementor's finalizer test (which exercises the
-- status matrix) and than the Deno idempotency test (which uses an in-memory
-- store). This one attacks the REAL Postgres UNIQUE INDEXES directly and
-- validates deviation D-1 (non-partial indexes) preserves the guarantee.
--
-- fails-on-revert (cite): DROP INDEX public.uq_mkt_msg_campaign_phone (or its
-- email twin) before running → the duplicate INSERT is ACCEPTED → ADV-1b/1c(ii)
-- RAISE EXCEPTION and the script exits non-zero. Also, a PARTIAL-index revert of
-- §6.4 makes the D-1 `ON CONFLICT (campaign_id, recipient_phone)` upsert raise
-- 42P10 (proven separately). Everything runs in ONE transaction, ROLLBACK'd.

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL session_replication_role = 'replica';

DO $$
DECLARE
  c uuid := gen_random_uuid();
  c2 uuid := gen_random_uuid();
  v_cnt integer;
  v_created1 timestamptz;
  v_created2 timestamptz;
  v_status text;
  caught boolean;
BEGIN
  INSERT INTO public.marketing_campaigns (id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
    VALUES (c,  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'ADV', 'sms',   '{"kind":"sms","body":"x"}', 'sending'),
           (c2, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'ADV2','email', '{"kind":"email"}',          'sending');

  -- ANGLE 1b — a duplicate (campaign_id, recipient_phone) INSERT is REJECTED.
  INSERT INTO public.marketing_messages (campaign_id, recipient_phone, channel, status) VALUES (c, '+14155550000', 'sms', 'sent');
  caught := false;
  BEGIN
    INSERT INTO public.marketing_messages (campaign_id, recipient_phone, channel, status) VALUES (c, '+14155550000', 'sms', 'sent');
  EXCEPTION WHEN unique_violation THEN caught := true; END;
  IF NOT caught THEN RAISE EXCEPTION 'ADV-1b FAIL: duplicate (campaign,phone) ACCEPTED — double-send index broken'; END IF;
  RAISE NOTICE 'ADV-1b PASS: duplicate (campaign_id, recipient_phone) rejected';

  -- ANGLE 1c(i) — two EMAIL rows (recipient_phone NULL, distinct emails) COEXIST (D-1 NULLs-distinct).
  INSERT INTO public.marketing_messages (campaign_id, recipient_email, channel, status) VALUES
    (c2, 'a@example.com', 'email', 'sent'), (c2, 'b@example.com', 'email', 'sent');
  SELECT count(*) INTO v_cnt FROM public.marketing_messages WHERE campaign_id = c2 AND recipient_phone IS NULL;
  IF v_cnt <> 2 THEN RAISE EXCEPTION 'ADV-1c(i) FAIL: distinct-email NULL-phone rows collided (got %)', v_cnt; END IF;
  RAISE NOTICE 'ADV-1c(i) PASS: 2 email rows (NULL phone, distinct emails) coexist';

  -- ANGLE 1c(ii) — duplicate EMAIL in one campaign REJECTED.
  caught := false;
  BEGIN
    INSERT INTO public.marketing_messages (campaign_id, recipient_email, channel, status) VALUES (c2, 'a@example.com', 'email', 'sent');
  EXCEPTION WHEN unique_violation THEN caught := true; END;
  IF NOT caught THEN RAISE EXCEPTION 'ADV-1c(ii) FAIL: duplicate (campaign,email) ACCEPTED'; END IF;
  RAISE NOTICE 'ADV-1c(ii) PASS: duplicate (campaign_id, recipient_email) rejected';

  -- ANGLE 1c(iii) — distinct-phone NULL-email SMS rows COEXIST (email index no false collision).
  INSERT INTO public.marketing_messages (campaign_id, recipient_phone, channel, status) VALUES
    (c, '+12125550001', 'sms', 'deferred'), (c, '+12125550002', 'sms', 'deferred');
  SELECT count(*) INTO v_cnt FROM public.marketing_messages WHERE campaign_id = c AND recipient_email IS NULL;
  IF v_cnt < 3 THEN RAISE EXCEPTION 'ADV-1c(iii) FAIL: distinct-phone NULL-email rows collided (got %)', v_cnt; END IF;
  RAISE NOTICE 'ADV-1c(iii) PASS: distinct-phone NULL-email rows coexist';

  -- D-1 — the mandated ON CONFLICT (campaign_id, recipient_phone) upsert is inferable by the
  -- NON-partial index, yields exactly 1 row across defer->queued, and PRESERVES created_at
  -- (the termination age bound depends on created_at surviving the conflict update).
  INSERT INTO public.marketing_messages (campaign_id, recipient_phone, channel, status, next_attempt_at, attempt_count)
    VALUES (c, '+13125559999', 'sms', 'deferred', now() + interval '3 hours', 1)
    ON CONFLICT (campaign_id, recipient_phone) DO UPDATE
      SET status = EXCLUDED.status, next_attempt_at = EXCLUDED.next_attempt_at, attempt_count = EXCLUDED.attempt_count;
  SELECT created_at INTO v_created1 FROM public.marketing_messages WHERE campaign_id = c AND recipient_phone = '+13125559999';
  PERFORM pg_sleep(0.05);
  INSERT INTO public.marketing_messages (campaign_id, recipient_phone, channel, status, next_attempt_at)
    VALUES (c, '+13125559999', 'sms', 'queued', NULL)
    ON CONFLICT (campaign_id, recipient_phone) DO UPDATE
      SET status = EXCLUDED.status, next_attempt_at = EXCLUDED.next_attempt_at;
  SELECT count(*), max(status), max(created_at) INTO v_cnt, v_status, v_created2
    FROM public.marketing_messages WHERE campaign_id = c AND recipient_phone = '+13125559999';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'D-1 FAIL: upsert produced % rows, expected 1', v_cnt; END IF;
  IF v_status <> 'queued' THEN RAISE EXCEPTION 'D-1 FAIL: deferred->queued transition wrong (%)', v_status; END IF;
  IF v_created1 IS DISTINCT FROM v_created2 THEN RAISE EXCEPTION 'D-1 FAIL: created_at changed across conflict-update — termination age would reset'; END IF;
  RAISE NOTICE 'D-1 PASS: ON CONFLICT inferable, 1 row, created_at preserved';

  RAISE NOTICE 'ORCH-1270 tester double-send attacks: ALL PASS';
END $$;

ROLLBACK;
