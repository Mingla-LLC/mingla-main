-- ORCH-1054 [partner splits ledger + Stripe Transfer pipeline].
-- META-ORCH-1048 sub-E.
--
-- Adds the partner_splits ledger that records every partner-share Transfer
-- (0.15% of GMV = 10% of the 1.5% Mingla application fee), the
-- resolve_partner_for_brand_at_time RPC that locks the partner relationship
-- to the time of the original charge, and three SECURITY DEFINER state-
-- transition helpers used by the stripe-webhook router. The actual Stripe
-- Transfer creation lives in the edge fn (_shared/partnerSplits.ts).
--
-- INVARIANT (DRAFT → ACTIVE on this close):
--   I-PROPOSED-PARTNER-TRANSFER-SOURCE-CURRENCY — the Stripe Transfer
--   currency MUST equal the source charge currency. Zero FX. Enforced at
--   the edge-fn boundary; this migration records the resolved currency on
--   every row so we have a forensic ledger.
--
-- IDEMPOTENCY: every object gated on IF [NOT] EXISTS / CREATE OR REPLACE.
--
-- Hard guards:
--   * creator_accounts.id IS auth.users.id (no separate user_id column).
--     RLS predicates use account_id = auth.uid() directly.
--   * Inline EXISTS in RLS predicates per
--     feedback_rls_returning_owner_gap.md (no SECURITY DEFINER helpers).
--   * The state-transition helpers are SECURITY DEFINER but write-only to
--     partner_splits and never expose the table to clients. Search path
--     locked.

BEGIN;

--------------------------------------------------------------------------------
-- 1. partner_splits — ledger of every partner share paid by Mingla.
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.partner_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL
    REFERENCES public.orders(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL,
  partner_account_id uuid NOT NULL
    REFERENCES public.creator_accounts(id) ON DELETE RESTRICT,
  mingla_fee_cents integer NOT NULL CHECK (mingla_fee_cents >= 0),
  partner_share_cents integer NOT NULL CHECK (partner_share_cents >= 0),
  transfer_currency text NOT NULL,
  stripe_transfer_id text,
  stripe_application_fee_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'transferred',
      'blocked_currency_mismatch',
      'blocked_no_stripe',
      'failed',
      'reversed',
      'reversed_pending'
    )),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  transferred_at timestamptz,
  reversed_at timestamptz
);

-- Idempotency key for the entire partner-split flow: the application_fee.id
-- of the source charge. Stripe guarantees this is unique per charge.
ALTER TABLE public.partner_splits
  DROP CONSTRAINT IF EXISTS partner_splits_application_fee_unique;
ALTER TABLE public.partner_splits
  ADD CONSTRAINT partner_splits_application_fee_unique
  UNIQUE (stripe_application_fee_id);

CREATE INDEX IF NOT EXISTS partner_splits_partner_status_idx
  ON public.partner_splits (partner_account_id, status);

CREATE INDEX IF NOT EXISTS partner_splits_brand_status_idx
  ON public.partner_splits (brand_id, status);

CREATE INDEX IF NOT EXISTS partner_splits_order_idx
  ON public.partner_splits (order_id);

CREATE INDEX IF NOT EXISTS partner_splits_partner_created_idx
  ON public.partner_splits (partner_account_id, created_at DESC);

COMMENT ON TABLE public.partner_splits IS
  'ORCH-1054: per-charge partner share ledger. mingla_fee_cents = 1.5% of GMV; partner_share_cents = 10% of mingla_fee. Transfer currency MUST equal source charge currency (I-PROPOSED-PARTNER-TRANSFER-SOURCE-CURRENCY).';
COMMENT ON COLUMN public.partner_splits.stripe_application_fee_id IS
  'ORCH-1054: idempotency key from the source charge.application_fee. UNIQUE.';
COMMENT ON COLUMN public.partner_splits.transfer_currency IS
  'ORCH-1054: lowercase ISO-4217 of the source charge. Equals Stripe Transfer.currency. Zero FX invariant.';

--------------------------------------------------------------------------------
-- 2. RLS on partner_splits.
--    SELECT: partner can self-read; brand_admin+ on the brand can read brand
--    history; superadmin can read all. Inline EXISTS per
--    feedback_rls_returning_owner_gap.md.
--    INSERT/UPDATE/DELETE: service role only (edge fn mediates).
--------------------------------------------------------------------------------

ALTER TABLE public.partner_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_splits FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_splits_partner_self_select
  ON public.partner_splits;
CREATE POLICY partner_splits_partner_self_select
  ON public.partner_splits
  FOR SELECT
  USING (
    partner_account_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.brand_team_members btm
       WHERE btm.brand_id = partner_splits.brand_id
         AND btm.user_id = auth.uid()
         AND btm.role IN ('brand_owner', 'brand_admin')
         AND btm.accepted_at IS NOT NULL
         AND btm.removed_at IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid()
         AND p.account_type = 'admin'
    )
  );

-- No permissive write policies. Edge fn writes via service role only.

--------------------------------------------------------------------------------
-- 3. resolve_partner_for_brand_at_time — pins the partner relationship to
--    the moment of the original charge so a partner removed AFTER the sale
--    still gets paid for sales that happened DURING their tenure.
--
--    Returns the partner_account_id of the brand_team_members row where:
--      - role = 'brand_admin'                  (partners hold brand_admin)
--      - accepted_at <= p_at                   (was a partner at sale time)
--      - removed_at IS NULL OR > p_at          (still a partner then)
--      - creator_accounts.partner_enabled=true (flagged partner today)
--
--    Tie-break (multiple partners on one brand): accepted_at ASC, then
--    user_id ASC. Returns NULL if no eligible partner exists.
--
--    SECURITY DEFINER: read-only lookup; never writes; never bypasses RLS
--    for the caller (it returns a single uuid, not a row).
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_partner_for_brand_at_time(
  p_brand_id uuid,
  p_at timestamptz
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT btm.user_id
    FROM public.brand_team_members btm
    JOIN public.creator_accounts a
      ON a.id = btm.user_id
   WHERE btm.brand_id = p_brand_id
     AND btm.role = 'brand_admin'
     AND a.partner_enabled = true
     AND btm.accepted_at IS NOT NULL
     AND btm.accepted_at <= p_at
     AND (btm.removed_at IS NULL OR btm.removed_at > p_at)
   ORDER BY btm.accepted_at ASC, btm.user_id ASC
   LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.resolve_partner_for_brand_at_time(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_partner_for_brand_at_time(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_partner_for_brand_at_time(uuid, timestamptz) TO service_role;

COMMENT ON FUNCTION public.resolve_partner_for_brand_at_time(uuid, timestamptz) IS
  'ORCH-1054: returns the partner_account_id for a brand at a given moment. Deterministic tie-break by accepted_at then user_id. Returns NULL when none.';

--------------------------------------------------------------------------------
-- 4. record_partner_split_attempt — INSERT a 'pending' row keyed by the
--    application_fee_id. Used by the webhook before it calls Stripe Transfer.
--    ON CONFLICT DO NOTHING for webhook-replay idempotency.
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_partner_split_attempt(
  p_application_fee_id text,
  p_order_id uuid,
  p_brand_id uuid,
  p_partner_account_id uuid,
  p_mingla_fee_cents integer,
  p_partner_share_cents integer,
  p_currency text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
BEGIN
  IF p_application_fee_id IS NULL OR length(p_application_fee_id) = 0 THEN
    RAISE EXCEPTION 'application_fee_id_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.partner_splits (
    order_id,
    brand_id,
    partner_account_id,
    mingla_fee_cents,
    partner_share_cents,
    transfer_currency,
    stripe_application_fee_id,
    status
  )
  VALUES (
    p_order_id,
    p_brand_id,
    p_partner_account_id,
    p_mingla_fee_cents,
    p_partner_share_cents,
    lower(p_currency),
    p_application_fee_id,
    'pending'
  )
  ON CONFLICT (stripe_application_fee_id) DO NOTHING;

  SELECT id, status, stripe_transfer_id
    INTO v_row
  FROM public.partner_splits
  WHERE stripe_application_fee_id = p_application_fee_id;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'stripe_transfer_id', v_row.stripe_transfer_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_partner_split_attempt(
  text, uuid, uuid, uuid, integer, integer, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_partner_split_attempt(
  text, uuid, uuid, uuid, integer, integer, text
) TO service_role;

COMMENT ON FUNCTION public.record_partner_split_attempt(
  text, uuid, uuid, uuid, integer, integer, text
) IS
  'ORCH-1054: insert a pending partner_splits row keyed by application_fee_id. Idempotent (ON CONFLICT DO NOTHING). Returns current row status.';

--------------------------------------------------------------------------------
-- 5. mark_partner_split_transferred — flip to 'transferred' + timestamp.
--    Idempotent: re-running with the same transfer_id is a no-op.
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_partner_split_transferred(
  p_application_fee_id text,
  p_transfer_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.partner_splits
  SET status = 'transferred',
      stripe_transfer_id = p_transfer_id,
      transferred_at = COALESCE(transferred_at, now()),
      error_message = NULL
  WHERE stripe_application_fee_id = p_application_fee_id
    AND status IN ('pending', 'failed');
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_partner_split_transferred(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_partner_split_transferred(text, text) TO service_role;

--------------------------------------------------------------------------------
-- 6. mark_partner_split_failed — non-retryable failure (e.g. account no longer
--    eligible). Records reason in status + error_message.
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_partner_split_failed(
  p_application_fee_id text,
  p_reason text,
  p_error_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.partner_splits
  SET status = CASE
        WHEN p_reason IN (
          'blocked_currency_mismatch',
          'blocked_no_stripe',
          'failed'
        ) THEN p_reason
        ELSE 'failed'
      END,
      error_message = p_error_message
  WHERE stripe_application_fee_id = p_application_fee_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_partner_split_failed(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_partner_split_failed(text, text, text) TO service_role;

--------------------------------------------------------------------------------
-- 7. mark_partner_split_reversed — refund/dispute path. If status was
--    'transferred' we record the reversal transfer id; otherwise we mark
--    'reversed_pending' (no Transfer existed to reverse).
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_partner_split_reversed(
  p_application_fee_id text,
  p_reversal_transfer_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.partner_splits
  SET status = CASE
        WHEN p_reversal_transfer_id IS NOT NULL THEN 'reversed'
        WHEN status = 'transferred' THEN 'reversed'
        ELSE 'reversed_pending'
      END,
      reversed_at = COALESCE(reversed_at, now()),
      stripe_transfer_id = COALESCE(p_reversal_transfer_id, stripe_transfer_id)
  WHERE stripe_application_fee_id = p_application_fee_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_partner_split_reversed(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_partner_split_reversed(text, text) TO service_role;

COMMIT;
