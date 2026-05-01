-- Cycle B1 Phase 1 — Accounts & identity (BUSINESS_PROJECT_PLAN §B.1).
-- Extends creator_accounts; adds account_deletion_requests (edge/service-role writes only).

ALTER TABLE public.creator_accounts
  ADD COLUMN IF NOT EXISTS phone_e164 text,
  ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.creator_accounts.phone_e164 IS 'E.164 phone for organiser contact (B1).';
COMMENT ON COLUMN public.creator_accounts.marketing_opt_in IS 'Marketing opt-in (B1).';
COMMENT ON COLUMN public.creator_accounts.deleted_at IS 'Soft-delete timestamp for creator account (B1).';

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  scheduled_hard_delete_at timestamptz,
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT account_deletion_requests_status_check
      CHECK (status IN ('pending', 'cancelled', 'completed')),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_user_id
  ON public.account_deletion_requests (user_id);

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_status
  ON public.account_deletion_requests (status);

COMMENT ON TABLE public.account_deletion_requests IS
  'Account deletion pipeline; rows inserted/updated by service role (edge) only (B1 §B.1).';

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

-- Owner can read own deletion requests; no direct client writes (service role bypasses RLS).
DROP POLICY IF EXISTS "Account owner can read own deletion requests"
  ON public.account_deletion_requests;

CREATE POLICY "Account owner can read own deletion requests"
  ON public.account_deletion_requests
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
