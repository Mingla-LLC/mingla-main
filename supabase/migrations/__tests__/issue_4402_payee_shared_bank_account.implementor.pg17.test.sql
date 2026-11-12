-- #4402: two Mingla accounts can connect the same bank account. Paystack
-- returns the same recipient_code for the same bank account, so the second
-- payee_accounts save must succeed and no UNIQUE may survive on the column.
-- MINGLA-INVARIANT: I-4402-PAYEE-RECIPIENT-SHARED | issue #4402 | Paystack recipient codes may be shared across payee_accounts rows; never re-add a UNIQUE on payee_accounts.paystack_recipient_code.
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES
  ('44020000-0000-4000-8000-0000000000a1','shared-bank-one@mingla.test'),
  ('44020000-0000-4000-8000-0000000000a2','shared-bank-two@mingla.test');
SET LOCAL session_replication_role = origin;

-- The same upsert shape payee-account-paystack-recipient sends.
INSERT INTO public.payee_accounts(user_id,paystack_recipient_code,paystack_status,bank_name,bank_account_last4,paystack_country,paystack_currency)
VALUES('44020000-0000-4000-8000-0000000000a1','RCP_shared4402','verified','Test Bank','0000','NG','NGN')
ON CONFLICT(user_id) DO UPDATE SET paystack_recipient_code=excluded.paystack_recipient_code,paystack_status=excluded.paystack_status;
INSERT INTO public.payee_accounts(user_id,paystack_recipient_code,paystack_status,bank_name,bank_account_last4,paystack_country,paystack_currency)
VALUES('44020000-0000-4000-8000-0000000000a2','RCP_shared4402','verified','Test Bank','0000','NG','NGN')
ON CONFLICT(user_id) DO UPDATE SET paystack_recipient_code=excluded.paystack_recipient_code,paystack_status=excluded.paystack_status;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.payee_accounts WHERE paystack_recipient_code='RCP_shared4402' AND paystack_status='verified';
  IF n <> 2 THEN RAISE EXCEPTION 'issue #4402: expected both payees to hold the shared recipient code, found %', n; END IF;
END $$;

-- A user re-saving the same shared code (change bank back) still succeeds.
UPDATE public.payee_accounts SET paystack_recipient_code='RCP_shared4402'
 WHERE user_id='44020000-0000-4000-8000-0000000000a2';

-- No UNIQUE survives on the column, in either catalog, under any name.
DO $$
DECLARE lingering text;
BEGIN
  SELECT string_agg(name, ', ') INTO lingering FROM (
    SELECT c.conname::text AS name FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE c.conrelid='public.payee_accounts'::regclass AND c.contype='u' AND a.attname='paystack_recipient_code'
    UNION
    SELECT i.indexrelid::regclass::text FROM pg_index i
     JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid='public.payee_accounts'::regclass AND i.indisunique AND a.attname='paystack_recipient_code'
  ) r;
  IF lingering IS NOT NULL THEN RAISE EXCEPTION 'issue #4402: UNIQUE survives on payee_accounts.paystack_recipient_code: %', lingering; END IF;
END $$;

-- The plain lookup index exists and is not unique.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i WHERE i.indexrelid='public.payee_accounts_paystack_recipient_code_idx'::regclass AND NOT i.indisunique
  ) THEN RAISE EXCEPTION 'issue #4402: payee_accounts_paystack_recipient_code_idx missing or unique'; END IF;
END $$;

-- Per-owner uniqueness is intact: one payout account per user.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.payee_accounts(user_id,paystack_recipient_code,paystack_status)
    VALUES('44020000-0000-4000-8000-0000000000a1','RCP_other4402','verified');
    RAISE EXCEPTION 'issue #4402: a second payee_accounts row for one user was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

ROLLBACK;
