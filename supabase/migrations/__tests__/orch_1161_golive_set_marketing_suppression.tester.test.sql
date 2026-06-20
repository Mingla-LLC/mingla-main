-- META-ORCH-1161 go-live-prep — TESTER adversarial regression (real-Postgres).
--
-- WHY THIS TEST EXISTS / WHY IT IS DIFFERENT FROM THE IMPLEMENTOR'S TESTS:
-- The implementor's can_send test
--   (supabase/migrations/__tests__/orch_1161_golive_can_send_marketing_optout.test.ts)
-- is a TypeScript RE-IMPLEMENTATION of the SQL logic plus `sql.includes(...)`
-- anti-drift text anchors — it NEVER compiles or executes the actual migration
-- SQL against a Postgres backend. That is precisely the gap that let two real
-- defects ship green:
--   (1) P0 — `set_marketing_suppression` fails to COMPILE: it uses
--       `GET DIAGNOSTICS v_affected = v_affected + ROW_COUNT;` which is invalid
--       PL/pgSQL (GET DIAGNOSTICS accepts only a bare diagnostic-item assignment,
--       not an expression). The whole migration aborts on apply.
--   (2) P1 — the contact-keyed suppression row is NEVER written. The RPC inserts
--       two rows (user_id+NULL contact, then user_id+contact) but the production
--       unique index `channel_suppressions_uniq_idx` keys on
--       COALESCE(user_id::text, contact) — identical for both rows — so the second
--       INSERT collapses under ON CONFLICT DO NOTHING. The contact-keyed audience
--       resolver (resolveSuppressedPhones, keyed on channel_suppressions.contact)
--       then never finds the user → the SMS marketing blast still sends.
--
-- This test runs the ACTUAL migration against a real Postgres backend with the
-- production channel_suppressions unique index, then asserts the RPC exists and
-- the contact-keyed row persists.
--
-- HOW TO RUN (hand-run / CI — applies the real migration):
--   psql -v ON_ERROR_STOP=1 -f <minimal-schema.sql>
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261113000000_orch_1161_golive_marketing_optout.sql
--   psql -v ON_ERROR_STOP=1 -f this_file
-- (The orchestrator/implementor's CI applies all migrations in order before the
--  __tests__/*.test.sql files run, mirroring the existing orch_1116/orch_1150
--  real-Postgres test precedent.)
--
-- fails-on-revert (REVERSE sense): this test FAILS on the buggy migration as
-- shipped (the migration does not even apply → set_marketing_suppression is
-- absent → G-01 RAISEs) and PASSES only once BOTH defects are fixed
-- (GET DIAGNOSTICS corrected AND the contact-keyed row given its own unique key,
-- e.g. user_id=NULL on the contact row, or an explicit conflict target).

\set ON_ERROR_STOP on

-- ─── G-01: the RPC must EXIST (catches the P0 compile failure). ──────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.proname = 'set_marketing_suppression'
      AND pg_get_function_identity_arguments(p.oid) = 'p_channel text, p_suppress boolean'
  ) THEN
    RAISE EXCEPTION 'G-01 FAIL: set_marketing_suppression(text, boolean) does not exist — the migration failed to apply (likely the GET DIAGNOSTICS expression compile error).';
  END IF;
END $$;

-- ─── G-02: opting OUT of SMS marketing must persist a CONTACT-KEYED row so the
--           contact-keyed audience resolver (resolveSuppressedPhones) excludes
--           the user. (Catches the two-row ON CONFLICT collapse.) ─────────────
DO $$
DECLARE
  v_uid uuid := '11111111-1111-1111-1111-111111111111';
  v_contact_rows int;
  v_total_rows   int;
BEGIN
  -- Seed a caller with a phone on auth.users. (Assumes the harness created
  -- auth.users + a session-local auth.uid() override; the orch_1116 precedent
  -- does the same via SET LOCAL ROLE / current_setting.)
  PERFORM set_config('test.uid', v_uid::text, true);

  PERFORM public.set_marketing_suppression('sms', true);

  -- The audience resolver (resolveSuppressedPhones) matches on
  -- channel_suppressions.contact REGARDLESS of user_id, so what must persist is
  -- a row whose contact = the caller's phone. (Whether that row carries the
  -- caller's user_id or NULL is an implementation choice; the unique index keys
  -- on COALESCE(user_id, contact) so the two cannot coexist on the same key.)
  SELECT count(*) INTO v_contact_rows
    FROM public.channel_suppressions
   WHERE channel = 'sms' AND scope = 'marketing'
     AND contact = '+15551234567';

  SELECT count(*) INTO v_total_rows
    FROM public.channel_suppressions
   WHERE channel = 'sms' AND scope = 'marketing'
     AND (user_id = v_uid OR contact = '+15551234567');

  IF v_contact_rows < 1 THEN
    RAISE EXCEPTION 'G-02 FAIL: no contact-keyed sms marketing suppression row persisted (got % total rows, % contact-keyed) — the contact row was dropped by ON CONFLICT (unique index keys on COALESCE(user_id, contact)); the SMS blast resolver keys on contact and will NOT exclude this user.', v_total_rows, v_contact_rows;
  END IF;

  -- Cleanup (this DO block is meant to run in a harness that rolls back, but be
  -- defensive if applied autocommit).
  DELETE FROM public.channel_suppressions WHERE user_id = v_uid;
END $$;

-- ─── G-03: cross-user safety — the RPC keys off auth.uid() only; it must never
--           write a row for any user_id other than the caller. ────────────────
DO $$
DECLARE
  v_caller uuid := '11111111-1111-1111-1111-111111111111';
  v_other  int;
BEGIN
  PERFORM set_config('test.uid', v_caller::text, true);
  PERFORM public.set_marketing_suppression('email', true);

  -- A real cross-user leak = a row carrying a DIFFERENT, non-NULL user_id. A
  -- contact-keyed row with user_id=NULL (for the caller's own contact) is fine.
  SELECT count(*) INTO v_other
    FROM public.channel_suppressions
   WHERE user_id IS NOT NULL AND user_id <> v_caller;

  IF v_other > 0 THEN
    RAISE EXCEPTION 'G-03 FAIL: RPC wrote % suppression row(s) for a non-NULL user_id other than the caller — cross-user write leak.', v_other;
  END IF;

  DELETE FROM public.channel_suppressions WHERE user_id = v_caller;
END $$;

\echo 'orch_1161 tester adversarial: ALL GUARDS PASSED'
