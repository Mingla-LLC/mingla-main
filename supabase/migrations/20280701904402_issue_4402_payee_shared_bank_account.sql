-- Issue #4402 — let creators and referral payees connect a bank account that
-- another Mingla account already uses.
--
-- WHY
-- Paystack de-duplicates transfer recipients per integration: the same bank
-- account always returns the same recipient_code (_shared/paystackRecipientSharing.ts,
-- #3192). #3199 dropped the UNIQUE on brand_paystack_recipients.recipient_code
-- and partner_paystack_accounts.recipient_code for exactly this reason.
-- #3872 (20271219003872) then created payee_accounts.paystack_recipient_code
-- text UNIQUE, which reintroduced the bug: on 2026-11-12 Paystack returned
-- three 201s, then the save raised
--     duplicate key value violates unique constraint
--     "payee_accounts_paystack_recipient_code_key"
-- and payee-account-paystack-recipient answered 500 internal_error.
--
-- CONSTRAINT, NOT INDEX. The inline `UNIQUE` is a constraint
-- (pg_constraint.contype = 'u'); its backing index cannot be dropped on its
-- own, so drop the CONSTRAINT (it takes the index with it), as #3192 learned.
--
-- SAFETY — nothing reads paystack_recipient_code as a key:
--   1. The payout sweep/release (20271221003872) and gig-release select the
--      payee row by user_id and only read the code.
--   2. The delete path already calls isPaystackRecipientShared with the payee
--      holder, so a shared code is never deleted at Paystack.
-- Per-owner uniqueness (user_id PRIMARY KEY, one payout account per person)
-- is untouched and asserted below.

BEGIN;

ALTER TABLE public.payee_accounts
  DROP CONSTRAINT IF EXISTS payee_accounts_paystack_recipient_code_key;
-- Keep the column indexed: the shared-recipient check filters by it before
-- any provider-side delete.
CREATE INDEX IF NOT EXISTS payee_accounts_paystack_recipient_code_idx
  ON public.payee_accounts USING btree (paystack_recipient_code);

-- Fail closed: a migration that reports success while the 500 still
-- reproduces is worse than one that fails. Check BOTH catalogs, and any
-- unique index whose only key is this column, whatever its name.
DO $$
DECLARE
  lingering text;
BEGIN
  SELECT string_agg(name, ', ')
    INTO lingering
    FROM (
      SELECT c.conname::text AS name
        FROM pg_constraint c
       WHERE c.contype = 'u'
         AND c.conrelid = 'public.payee_accounts'::regclass
         AND c.conkey = ARRAY[(
           SELECT a.attnum FROM pg_attribute a
            WHERE a.attrelid = 'public.payee_accounts'::regclass
              AND a.attname = 'paystack_recipient_code'
         )]::int2[]
      UNION
      SELECT i.indexrelid::regclass::text AS name
        FROM pg_index i
        JOIN pg_attribute a
          ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
       WHERE i.indrelid = 'public.payee_accounts'::regclass
         AND i.indisunique
         AND NOT i.indisprimary
         AND a.attname = 'paystack_recipient_code'
    ) AS remaining;

  IF lingering IS NOT NULL THEN
    RAISE EXCEPTION
      'issue #4402: payee_accounts.paystack_recipient_code uniqueness still present after drop: %',
      lingering;
  END IF;
END $$;

-- And the per-owner key SURVIVED: one payee_accounts row per user, or every
-- user -> recipient read in the payout path becomes ambiguous.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.payee_accounts'::regclass
       AND contype = 'p'
  ) THEN
    RAISE EXCEPTION 'issue #4402: payee_accounts primary key (user_id) must remain intact';
  END IF;
END $$;

COMMIT;
