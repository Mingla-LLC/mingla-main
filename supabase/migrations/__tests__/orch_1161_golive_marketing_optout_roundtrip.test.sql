-- META-ORCH-1161 go-live-prep — IMPLEMENTOR happy-path regression (real Postgres).
--
-- Proves the full prefs-UI marketing opt-out / opt-in ROUND TRIP against a real
-- Postgres backend with the production channel_suppressions unique index, after
-- applying the actual 20261113000000 migration:
--   R-1  opt-OUT(sms) writes BOTH a user_id-keyed row AND a user_id=NULL
--        contact-keyed row (distinct unique-index keys; affected = 2).
--   R-2  can_send(marketing,sms) = FALSE after opt-out (user_id branch honored).
--   R-3  the contact-keyed SMS row (the blast resolver's key) is present.
--   R-4  opt-IN(sms) removes BOTH rows (affected = 2; 0 remaining).
--   R-5  opt-OUT(email) writes a contact-keyed email row + can_send(email)=FALSE.
--   R-6  scope isolation — a marketing opt-out does NOT block transactional.
--
-- Distinct from the tester's adversarial .tester.test.sql (which targets the P0
-- compile failure + the P1 single-key collapse). This one asserts the positive
-- contract end-to-end.
--
-- fails-on-revert (verified by the implementor against real Postgres 15):
--   * revert P0 (GET DIAGNOSTICS expression) → migration aborts → these RPC calls
--     error (function absent).
--   * revert P1 (contact row carries user_id instead of NULL) → R-1 affected = 1
--     and R-3 finds 0 contact rows → R-1/R-3 RAISE.
--
-- HOW TO RUN (mirrors the tester header):
--   psql -v ON_ERROR_STOP=1 -f <minimal-schema-with-auth.uid-stub-and-seeded-user>
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261113000000_orch_1161_golive_marketing_optout.sql
--   psql -v ON_ERROR_STOP=1 -f this_file
-- (Harness seeds auth.users id=1111…1111 with phone 15551234567 + email
--  alice@example.com, an auth.uid() reading current_setting('test.uid'), and the
--  notification_categories marketing_blast / buyer_receipt rows.)

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_uid uuid := '11111111-1111-1111-1111-111111111111';
  v_n   int;
  v_c   int;
  v_b   boolean;
BEGIN
  DELETE FROM public.channel_suppressions WHERE user_id = v_uid OR contact IN ('+15551234567','alice@example.com');
  PERFORM set_config('test.uid', v_uid::text, true);

  -- R-1: opt OUT of SMS marketing → BOTH rows land.
  SELECT public.set_marketing_suppression('sms', true) INTO v_n;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'R-1 FAIL: opt-out(sms) affected % rows, expected 2 (user_id-keyed + contact-keyed). The contact row was dropped (P1 collapse).', v_n;
  END IF;

  -- R-3: the contact-keyed SMS row (blast resolver keys on contact) is present.
  SELECT count(*) INTO v_c FROM public.channel_suppressions
   WHERE channel='sms' AND scope='marketing' AND contact='+15551234567';
  IF v_c <> 1 THEN
    RAISE EXCEPTION 'R-3 FAIL: % contact-keyed sms marketing rows, expected 1 (the SMS blast resolver would not exclude this user).', v_c;
  END IF;

  -- R-2: can_send(marketing,sms) FALSE after opt-out.
  SELECT public.can_send(v_uid,'marketing_blast','sms','+15551234567') INTO v_b;
  IF v_b IS NOT FALSE THEN
    RAISE EXCEPTION 'R-2 FAIL: can_send(marketing,sms) = % after opt-out, expected false.', v_b;
  END IF;

  -- R-6: scope isolation — transactional still allowed.
  SELECT public.can_send(v_uid,'buyer_receipt','email','alice@example.com') INTO v_b;
  IF v_b IS NOT TRUE THEN
    RAISE EXCEPTION 'R-6 FAIL: can_send(buyer_receipt,email) = % — a marketing opt-out wrongly blocked transactional.', v_b;
  END IF;

  -- R-4: opt back IN removes BOTH rows.
  SELECT public.set_marketing_suppression('sms', false) INTO v_n;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'R-4 FAIL: opt-in(sms) removed % rows, expected 2 (both user_id-keyed and contact-keyed).', v_n;
  END IF;
  SELECT count(*) INTO v_c FROM public.channel_suppressions WHERE channel='sms' AND scope='marketing'
     AND (user_id = v_uid OR contact='+15551234567');
  IF v_c <> 0 THEN
    RAISE EXCEPTION 'R-4 FAIL: % sms marketing rows remain after opt-in, expected 0.', v_c;
  END IF;

  -- R-5: email opt-out → contact-keyed email row + can_send(email) FALSE.
  SELECT public.set_marketing_suppression('email', true) INTO v_n;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'R-5 FAIL: opt-out(email) affected % rows, expected 2.', v_n;
  END IF;
  SELECT count(*) INTO v_c FROM public.channel_suppressions
   WHERE channel='email' AND scope='marketing' AND contact='alice@example.com';
  IF v_c <> 1 THEN
    RAISE EXCEPTION 'R-5 FAIL: % contact-keyed email marketing rows, expected 1 (the email blast resolver would not exclude this user).', v_c;
  END IF;
  SELECT public.can_send(v_uid,'marketing_blast','email','alice@example.com') INTO v_b;
  IF v_b IS NOT FALSE THEN
    RAISE EXCEPTION 'R-5 FAIL: can_send(marketing,email) = % after opt-out, expected false.', v_b;
  END IF;

  DELETE FROM public.channel_suppressions WHERE user_id = v_uid OR contact IN ('+15551234567','alice@example.com');
END $$;

\echo 'orch_1161 implementor round-trip: ALL CHECKS PASSED'
