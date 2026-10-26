\set ON_ERROR_STOP on

-- Issue #4114 simulator QA: a friend invite remembers whether its text went out.
--
--   S-01  pending_pair_invites.sms_status exists, is nullable, and accepts only
--         'sent' / 'failed'.
--   S-02  re-running the migration is a no-op.
--
-- FAILS-ON-REVERT: drop 20271230084114_issue_4114_invite_sms_status.sql from
-- the chain and S-01 fails.
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

DO $s01$
DECLARE
  v_inviter uuid := gen_random_uuid();
  v_ok boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pending_pair_invites'
      AND column_name = 'sms_status' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'S-01: pending_pair_invites.sms_status missing or NOT NULL';
  END IF;

  INSERT INTO auth.users (id, email) VALUES (v_inviter, 'qa4114-' || v_inviter || '@example.test');
  INSERT INTO public.pending_pair_invites (inviter_id, phone_e164, status, sms_status)
  VALUES (v_inviter, '+15550004114', 'pending', 'failed');
  UPDATE public.pending_pair_invites SET sms_status = 'sent' WHERE inviter_id = v_inviter;

  BEGIN
    UPDATE public.pending_pair_invites SET sms_status = 'maybe' WHERE inviter_id = v_inviter;
  EXCEPTION WHEN check_violation THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'S-01: sms_status accepted a value other than sent / failed';
  END IF;
END $s01$;

\ir ../20271230084114_issue_4114_invite_sms_status.sql

DO $s02$
BEGIN
  IF (SELECT count(*) FROM pg_constraint
      WHERE conrelid = 'public.pending_pair_invites'::regclass
        AND conname = 'pending_pair_invites_sms_status_check') <> 1 THEN
    RAISE EXCEPTION 'S-02: re-running the migration duplicated the check';
  END IF;
END $s02$;

ROLLBACK;
