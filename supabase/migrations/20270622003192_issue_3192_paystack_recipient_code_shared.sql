-- Issue #3192 — let two brands settle to the same bank account.
--
-- WHY
-- Paystack de-duplicates transfer recipients per integration: creating one for
-- a bank account that already exists returns the EXISTING recipient_code with a
-- success status. Proven against our own test integration on 2026-09-11 — two
-- POST /transferrecipient calls on account 0000000000 / bank 057 under
-- different names both returned RCP_zrf3vmf1kjg3q15.
--
-- Our tables carried a UNIQUE index on recipient_code, so the second holder's
-- insert raised 23505 -> PostgREST 409 -> a 500 from the edge function. Worse,
-- the failure path then "rolled back" by deleting that recipient at Paystack —
-- destroying the FIRST holder's live payout destination while their row still
-- referenced the dead code.
--
-- SAFETY — nothing reads recipient_code as a key. Verified four ways before
-- dropping (see issue #3192 investigation comment):
--   1. TypeScript: zero `.eq("recipient_code", ...)` reverse lookups existed
--      across supabase/functions, mingla-business, mingla-admin, app-mobile.
--   2. claim_paystack_payout_releases — the function that actually moves money
--      — joins ON rec.brand_id = r.brand_id, never on recipient_code.
--   3. Transfer references are bprel_<release_id>_c<chunk>_a<attempt>
--      (payout-release-sweep/engine.ts), keyed on the release, not the recipient.
--   4. Webhook routing matches that reference, not recipient_code.
-- The uniqueness was therefore an artifact with no readers. Brand -> recipient
-- resolution stays 1:1 and unambiguous; only recipient -> brand becomes
-- one-to-many, and nothing performs that direction.
--
-- The per-owner uniqueness that DOES matter is untouched:
--   brand_paystack_recipients_brand_id_key    (one recipient per brand)
--   partner_paystack_accounts_account_id_key  (one recipient per partner)

BEGIN;

-- Replace each UNIQUE index with a plain btree on the same column. The index is
-- still needed: #3192 adds a shared-recipient lookup that filters by
-- recipient_code before any provider-side delete, so dropping the index
-- outright would turn every disconnect into a sequential scan.
DROP INDEX IF EXISTS public.brand_paystack_recipients_recipient_code_key;
CREATE INDEX IF NOT EXISTS brand_paystack_recipients_recipient_code_idx
  ON public.brand_paystack_recipients USING btree (recipient_code);

DROP INDEX IF EXISTS public.partner_paystack_accounts_recipient_code_key;
CREATE INDEX IF NOT EXISTS partner_paystack_accounts_recipient_code_idx
  ON public.partner_paystack_accounts USING btree (recipient_code);

-- Fail closed: if either UNIQUE index survived (for example because it was
-- backing a constraint rather than standing alone), stop now rather than ship a
-- migration that reports success while the 409 still reproduces.
DO $$
DECLARE
  lingering text;
BEGIN
  SELECT string_agg(indexname, ', ')
    INTO lingering
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN (
       'brand_paystack_recipients_recipient_code_key',
       'partner_paystack_accounts_recipient_code_key'
     );
  IF lingering IS NOT NULL THEN
    RAISE EXCEPTION
      'issue #3192: UNIQUE index(es) still present after drop: %. A constraint '
      'may own them — drop the CONSTRAINT instead.', lingering;
  END IF;
END $$;

COMMIT;

-- NOT DONE HERE, DELIBERATELY: no CHECK constraint on brands.contact_email.
-- Issue #3191 requires that a malformed brand record never block payout setup
-- (Seth, 2026-09-10). A CHECK would do the opposite — it would reject the edit
-- that FIXES a bad address, and it would fail against rows that already hold
-- one. Enforcement lives in _shared/organiserContactEmail.ts, which skips a
-- malformed value in favour of the caller's verified auth email.
