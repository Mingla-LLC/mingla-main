-- Issue #1174 — defer partner payouts until the organiser occurrence releases.
-- #1029 pre-work: Stripe partner shares move from platform balance and never
-- reference a connected-account direct charge as source_transaction.

BEGIN;

ALTER TABLE public.partner_splits
  ADD COLUMN IF NOT EXISTS release_id uuid
    REFERENCES public.brand_payout_releases(id) ON DELETE RESTRICT;

DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.partner_splits'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
      AND pg_get_constraintdef(oid) LIKE '%pending%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.partner_splits DROP CONSTRAINT %I',
      v_name
    );
  END LOOP;
END$$;

ALTER TABLE public.partner_splits
  ADD CONSTRAINT partner_splits_status_check
  CHECK (status IN (
    'held',
    'pending',
    'transferred',
    'blocked_currency_mismatch',
    'blocked_no_stripe',
    'blocked_no_paystack',
    'failed',
    'reversed',
    'reversed_pending',
    'cancelled_refund'
  ));

CREATE INDEX IF NOT EXISTS partner_splits_release_status_idx
  ON public.partner_splits (release_id, status);

COMMENT ON COLUMN public.partner_splits.release_id IS
  'Issue #1174: organiser occurrence release that made this held partner share eligible.';

CREATE OR REPLACE FUNCTION public.record_held_partner_split(
  p_key text,
  p_order_id uuid,
  p_brand_id uuid,
  p_partner_account_id uuid,
  p_mingla_fee_cents integer,
  p_partner_share_cents integer,
  p_currency text,
  p_provider text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
BEGIN
  IF p_key IS NULL OR length(p_key) = 0 THEN
    RAISE EXCEPTION 'partner_split_key_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_provider NOT IN ('stripe', 'paystack') THEN
    RAISE EXCEPTION 'invalid_partner_split_provider' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.partner_splits (
    order_id,
    brand_id,
    partner_account_id,
    mingla_fee_cents,
    partner_share_cents,
    transfer_currency,
    stripe_application_fee_id,
    status,
    provider
  )
  VALUES (
    p_order_id,
    p_brand_id,
    p_partner_account_id,
    p_mingla_fee_cents,
    p_partner_share_cents,
    lower(p_currency),
    p_key,
    'held',
    p_provider
  )
  ON CONFLICT (stripe_application_fee_id) DO NOTHING;

  SELECT id, status, stripe_transfer_id, attempt_count, payout_reference,
         error_message, release_id
    INTO v_row
  FROM public.partner_splits
  WHERE stripe_application_fee_id = p_key;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'stripe_transfer_id', v_row.stripe_transfer_id,
    'attempt_count', v_row.attempt_count,
    'payout_reference', v_row.payout_reference,
    'error_message', v_row.error_message,
    'release_id', v_row.release_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_held_partner_split(
  text, uuid, uuid, uuid, integer, integer, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_held_partner_split(
  text, uuid, uuid, uuid, integer, integer, text, text
) TO service_role;

COMMENT ON FUNCTION public.record_held_partner_split(
  text, uuid, uuid, uuid, integer, integer, text, text
) IS
  'Issue #1174: idempotently records a post-cutover partner share as held. It performs no provider movement.';

CREATE OR REPLACE FUNCTION public.plan_pending_payout_partner_legs(
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_release record;
  v_split record;
  v_planned integer := 0;
  v_fee integer;
  v_stamp integer;
  v_partner_cost integer;
BEGIN
  FOR v_release IN
    SELECT r.id
    FROM public.brand_payout_releases r
    WHERE r.status = 'pending'
    ORDER BY r.releasable_at, r.id
    LIMIT greatest(1, least(p_limit, 500))
    FOR UPDATE SKIP LOCKED
  LOOP
    FOR v_split IN
      SELECT DISTINCT ps.id, ps.provider, ps.partner_share_cents
      FROM public.payout_release_items i
      JOIN public.partner_splits ps
        ON ps.order_id = i.source_id
       AND i.source_type = 'order'
      WHERE i.release_id = v_release.id
        AND ps.status = 'held'
        AND ps.release_id IS NULL
      ORDER BY ps.id
    LOOP
      -- Paystack cannot move a partner leg below its verified ₦50 floor.
      -- The split remains held and incurs no fee until a later contract
      -- explicitly aggregates sub-floor partner principal.
      IF v_split.provider = 'paystack'
         AND v_split.partner_share_cents < 5000 THEN
        CONTINUE;
      END IF;

      IF v_split.provider = 'paystack' THEN
        v_fee := CASE
          WHEN v_split.partner_share_cents <= 500000 THEN 1000
          WHEN v_split.partner_share_cents <= 5000000 THEN 2500
          ELSE 5000
        END;
        v_stamp := CASE
          WHEN v_split.partner_share_cents >= 1000000 THEN 5000
          ELSE 0
        END;
      ELSE
        v_fee := 0;
        v_stamp := 0;
      END IF;

      INSERT INTO public.payout_transfer_legs (
        release_id,
        partner_split_id,
        kind,
        chunk_index,
        principal_cents,
        estimated_fee_cents,
        stamp_duty_cents,
        fee_schedule_version
      )
      VALUES (
        v_release.id,
        v_split.id,
        'partner',
        0,
        v_split.partner_share_cents,
        v_fee,
        v_stamp,
        CASE
          WHEN v_split.provider = 'paystack' THEN 'verified-2026-07-24'
          ELSE 'stripe-platform-transfer-v1'
        END
      )
      ON CONFLICT (release_id, kind, partner_split_id, chunk_index)
      DO NOTHING;
      IF FOUND THEN v_planned := v_planned + 1; END IF;
    END LOOP;

    SELECT coalesce(sum(estimated_fee_cents + stamp_duty_cents), 0)::integer
      INTO v_partner_cost
    FROM public.payout_transfer_legs
    WHERE release_id = v_release.id
      AND kind = 'partner';

    -- Rebuild from internal ledger truth so retries never double-deduct fees.
    -- Partner principal is untouched; only its outbound movement cost reduces
    -- organiser cash on Paystack.
    UPDATE public.brand_payout_releases
    SET net_release_cents = greatest(
          0,
          gross_cents - refunded_cents - disputed_cents - mingla_fee_cents
          - partner_share_cents - provider_fee_cents
          - permanent_debt_withheld_cents - temporary_debt_withheld_cents
          + maturity_recredit_cents - v_partner_cost
        ),
        updated_at = now()
    WHERE id = v_release.id;
  END LOOP;

  RETURN jsonb_build_object('planned_partner_legs', v_planned);
END;
$function$;

REVOKE ALL ON FUNCTION public.plan_pending_payout_partner_legs(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_pending_payout_partner_legs(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.release_partner_splits_for_organiser_release(
  p_release_id uuid
)
RETURNS TABLE (
  id uuid,
  provider text,
  stripe_application_fee_id text,
  order_id uuid,
  brand_id uuid,
  partner_account_id uuid,
  partner_share_cents integer,
  transfer_currency text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.brand_payout_releases r
    WHERE r.id = p_release_id
      AND r.status = 'released'
  ) THEN
    RETURN;
  END IF;

  UPDATE public.partner_splits ps
  SET status = 'pending',
      release_id = p_release_id,
      error_message = NULL
  WHERE ps.status = 'held'
    AND EXISTS (
      SELECT 1
      FROM public.payout_release_items i
      WHERE i.release_id = p_release_id
        AND i.source_type = 'order'
        AND i.source_id = ps.order_id
    )
    AND EXISTS (
      SELECT 1
      FROM public.payout_transfer_legs l
      WHERE l.release_id = p_release_id
        AND l.kind = 'partner'
        AND l.partner_split_id = ps.id
    );

  RETURN QUERY
  SELECT ps.id, ps.provider, ps.stripe_application_fee_id, ps.order_id,
         ps.brand_id, ps.partner_account_id, ps.partner_share_cents,
         ps.transfer_currency
  FROM public.partner_splits ps
  WHERE ps.release_id = p_release_id
    AND ps.status = 'pending'
  ORDER BY ps.created_at, ps.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_partner_splits_for_organiser_release(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_partner_splits_for_organiser_release(uuid)
  TO service_role;

-- Held refunds never moved money, so record a terminal cancellation rather
-- than fabricating a reversal. Legacy pending/transferred behavior is retained.
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
        WHEN status = 'held' THEN 'cancelled_refund'
        WHEN p_reversal_transfer_id IS NOT NULL THEN 'reversed'
        WHEN status = 'transferred' THEN 'reversed'
        ELSE 'reversed_pending'
      END,
      reversed_at = COALESCE(reversed_at, now()),
      stripe_transfer_id = COALESCE(
        p_reversal_transfer_id,
        stripe_transfer_id
      )
  WHERE stripe_application_fee_id = p_application_fee_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_partner_split_reversed(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_partner_split_reversed(text, text)
  TO service_role;

COMMIT;
