-- Cycle B2 — KYC stall reminder tracking (issue #47 J-B2.4).
ALTER TABLE public.stripe_connect_accounts
  ADD COLUMN IF NOT EXISTS kyc_stall_reminder_sent_at timestamptz;

COMMENT ON COLUMN public.stripe_connect_accounts.kyc_stall_reminder_sent_at IS
  'Set when KYC stall email sent; cleared when charges_enabled (webhook sync).';
