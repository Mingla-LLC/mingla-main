-- Issue #1176 — Paystack transfer-recipient identity for Nigerian organisers.
-- The legacy brands.paystack_subaccount_code is deliberately preserved.

BEGIN;

CREATE TABLE public.brand_paystack_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL UNIQUE REFERENCES public.brands(id) ON DELETE CASCADE,
  recipient_code text NOT NULL UNIQUE CHECK (recipient_code LIKE 'RCP\_%' ESCAPE '\'),
  bank_code text NOT NULL CHECK (length(bank_code) > 0),
  account_number_masked text NOT NULL
    CHECK (account_number_masked ~ '^••••[0-9]{4}$'),
  account_name text NOT NULL CHECK (length(btrim(account_name)) > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.brand_paystack_recipients IS
  '#1176: one Paystack Transfer Recipient (RCP_) mirror per Nigerian organiser brand. Full NUBAN values are never stored; legacy ACCT_ subaccount history remains on brands.';
COMMENT ON COLUMN public.brand_paystack_recipients.account_number_masked IS
  '#1176: bullet mask plus last four digits only; never a full NUBAN.';

ALTER TABLE public.brand_paystack_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_paystack_recipients FORCE ROW LEVEL SECURITY;

CREATE POLICY brand_paystack_recipients_payment_manager_read
  ON public.brand_paystack_recipients
  FOR SELECT
  TO authenticated
  USING (
    public.biz_can_manage_payments_for_brand_for_caller(brand_id)
    OR public.is_admin_user()
  );

-- Writes are service-role mediated through brand-paystack-onboard. No
-- INSERT/UPDATE/DELETE policy is intentional.

DO $$
BEGIN
  IF to_regclass('public.brand_paystack_recipients') IS NULL THEN
    RAISE EXCEPTION '#1176 probe failed: brand_paystack_recipients missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.brand_paystack_recipients'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) LIKE '%(brand_id)%'
  ) THEN
    RAISE EXCEPTION '#1176 probe failed: brand_id uniqueness missing';
  END IF;
  IF (
    SELECT count(*)
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'brand_paystack_recipients'
       AND cmd <> 'SELECT'
  ) <> 0 THEN
    RAISE EXCEPTION '#1176 probe failed: client write policy present';
  END IF;
END$$;

COMMIT;
