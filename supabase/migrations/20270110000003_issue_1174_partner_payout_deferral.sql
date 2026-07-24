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

-- payout_release_items is intentionally immutable. If its snapshot wins the
-- race against the partner webhook, reserve the missing partner principal as
-- an additive ledger adjustment instead of rewriting the item.
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.payout_ledger_adjustments'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%kind%'
      AND pg_get_constraintdef(oid) LIKE '%post_release_refund%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.payout_ledger_adjustments DROP CONSTRAINT %I',
      v_name
    );
  END LOOP;
END$$;

ALTER TABLE public.payout_ledger_adjustments
  ADD CONSTRAINT payout_ledger_adjustments_kind_check
  CHECK (kind IN (
    'post_release_refund',
    'post_release_dispute',
    'dispute_reversal',
    'transfer_fee_debit',
    'transfer_fee_credit',
    'maturity_recredit',
    'debt_writeoff',
    'partner_principal_correction'
  ));

-- One immutable provider-authoritative sale pin per order. Both the webhook
-- path and payout planner consume this row, including an explicit no-partner
-- outcome, so order.created_at can never stand in for Stripe charge.created
-- or verified Paystack paid_at.
CREATE TABLE public.payout_partner_attributions (
  order_id uuid PRIMARY KEY
    REFERENCES public.orders(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL
    REFERENCES public.brands(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('stripe', 'paystack')),
  provider_key text NOT NULL UNIQUE CHECK (length(provider_key) > 0),
  provider_sale_at timestamptz NOT NULL,
  partner_account_id uuid
    REFERENCES public.creator_accounts(id) ON DELETE RESTRICT,
  outcome text NOT NULL CHECK (outcome IN ('partner', 'no_partner')),
  mingla_fee_cents integer NOT NULL CHECK (mingla_fee_cents >= 0),
  partner_share_cents integer NOT NULL CHECK (partner_share_cents >= 0),
  currency text NOT NULL CHECK (length(currency) = 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_partner_attribution_outcome_check CHECK (
    (outcome = 'partner'
      AND partner_account_id IS NOT NULL
      AND partner_share_cents =
        round(mingla_fee_cents::numeric * 0.10)::integer)
    OR
    (outcome = 'no_partner'
      AND partner_account_id IS NULL
      AND partner_share_cents = 0)
  )
);

ALTER TABLE public.payout_partner_attributions ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER payout_partner_attributions_append_only
  BEFORE UPDATE OR DELETE ON public.payout_partner_attributions
  FOR EACH ROW EXECUTE FUNCTION public.reject_payout_append_only_mutation();

REVOKE ALL ON TABLE public.payout_partner_attributions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.payout_partner_attributions TO service_role;

CREATE OR REPLACE FUNCTION public.record_payout_partner_attribution(
  p_key text,
  p_order_id uuid,
  p_brand_id uuid,
  p_partner_account_id uuid,
  p_provider_sale_at timestamptz,
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
  v_row public.payout_partner_attributions%ROWTYPE;
  v_outcome text;
BEGIN
  IF p_key IS NULL OR length(p_key) = 0 THEN
    RAISE EXCEPTION 'partner_attribution_key_required' USING ERRCODE = '22023';
  END IF;
  IF p_provider NOT IN ('stripe', 'paystack') THEN
    RAISE EXCEPTION 'invalid_partner_attribution_provider'
      USING ERRCODE = '22023';
  END IF;
  IF p_provider_sale_at IS NULL THEN
    RAISE EXCEPTION 'provider_sale_at_required' USING ERRCODE = '22023';
  END IF;
  IF p_mingla_fee_cents < 0 OR p_partner_share_cents < 0 THEN
    RAISE EXCEPTION 'invalid_partner_attribution_amount'
      USING ERRCODE = '22023';
  END IF;

  v_outcome := CASE
    WHEN p_partner_account_id IS NULL THEN 'no_partner'
    ELSE 'partner'
  END;

  -- Replay comparison happens before new-row formula validation so every
  -- changed canonical field on an existing provider sale fails with the same
  -- immutable replay-mismatch class and leaves both tables untouched.
  SELECT * INTO v_row
  FROM public.payout_partner_attributions
  WHERE order_id = p_order_id
     OR provider_key = p_key
  ORDER BY (order_id = p_order_id AND provider_key = p_key) DESC
  LIMIT 1;
  IF FOUND THEN
    IF v_row.order_id IS DISTINCT FROM p_order_id
       OR v_row.brand_id IS DISTINCT FROM p_brand_id
       OR v_row.provider IS DISTINCT FROM p_provider
       OR v_row.provider_key IS DISTINCT FROM p_key
       OR v_row.provider_sale_at IS DISTINCT FROM p_provider_sale_at
       OR v_row.partner_account_id IS DISTINCT FROM p_partner_account_id
       OR v_row.outcome IS DISTINCT FROM v_outcome
       OR v_row.mingla_fee_cents IS DISTINCT FROM p_mingla_fee_cents
       OR v_row.partner_share_cents IS DISTINCT FROM p_partner_share_cents
       OR v_row.currency IS DISTINCT FROM lower(p_currency) THEN
      RAISE EXCEPTION 'partner_attribution_replay_mismatch'
        USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object(
      'order_id', v_row.order_id,
      'outcome', v_row.outcome,
      'provider_sale_at', v_row.provider_sale_at,
      'partner_account_id', v_row.partner_account_id,
      'partner_share_cents', v_row.partner_share_cents
    );
  END IF;

  IF (
    v_outcome = 'no_partner' AND p_partner_share_cents <> 0
  ) OR (
    v_outcome = 'partner'
    AND p_partner_share_cents <>
      round(p_mingla_fee_cents::numeric * 0.10)::integer
  ) THEN
    RAISE EXCEPTION 'partner_attribution_share_mismatch'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payout_partner_attributions (
    order_id,
    brand_id,
    provider,
    provider_key,
    provider_sale_at,
    partner_account_id,
    outcome,
    mingla_fee_cents,
    partner_share_cents,
    currency
  )
  VALUES (
    p_order_id,
    p_brand_id,
    p_provider,
    p_key,
    p_provider_sale_at,
    p_partner_account_id,
    v_outcome,
    p_mingla_fee_cents,
    p_partner_share_cents,
    lower(p_currency)
  )
  ON CONFLICT DO NOTHING;

  SELECT * INTO STRICT v_row
  FROM public.payout_partner_attributions
  WHERE order_id = p_order_id
     OR provider_key = p_key
  ORDER BY (order_id = p_order_id AND provider_key = p_key) DESC
  LIMIT 1;

  -- A concurrent call may have won either unique key while this statement
  -- waited. Compare the now-visible winner before returning.
  IF v_row.order_id IS DISTINCT FROM p_order_id
     OR v_row.brand_id IS DISTINCT FROM p_brand_id
     OR v_row.provider IS DISTINCT FROM p_provider
     OR v_row.provider_key IS DISTINCT FROM p_key
     OR v_row.provider_sale_at IS DISTINCT FROM p_provider_sale_at
     OR v_row.partner_account_id IS DISTINCT FROM p_partner_account_id
     OR v_row.outcome IS DISTINCT FROM v_outcome
     OR v_row.mingla_fee_cents IS DISTINCT FROM p_mingla_fee_cents
     OR v_row.partner_share_cents IS DISTINCT FROM p_partner_share_cents
     OR v_row.currency IS DISTINCT FROM lower(p_currency) THEN
    RAISE EXCEPTION 'partner_attribution_replay_mismatch'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_row.order_id,
    'outcome', v_row.outcome,
    'provider_sale_at', v_row.provider_sale_at,
    'partner_account_id', v_row.partner_account_id,
    'partner_share_cents', v_row.partner_share_cents
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_payout_partner_attribution(
  text, uuid, uuid, uuid, timestamptz, integer, integer, text, text
) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.record_payout_partner_attribution(
  text, uuid, uuid, uuid, timestamptz, integer, integer, text, text
) IS
  'Issue #1174: records the immutable provider-sale-time partner or no-partner outcome consumed by payout reconciliation.';

CREATE OR REPLACE FUNCTION public.reconcile_payout_partner_principal(
  p_release_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inserted integer := 0;
BEGIN
  -- The release row is the serialization boundary shared with partner-leg
  -- planning. The deterministic sale-time lookup means a late webhook cannot
  -- make organiser cash executable before its partner principal is reserved.
  PERFORM 1
  FROM public.brand_payout_releases
  WHERE id = p_release_id
    AND status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  WITH attributable AS (
    SELECT
      i.release_id,
      i.source_id,
      r.brand_id,
      r.currency,
      i.partner_share_cents,
      a.partner_share_cents AS expected_partner_share_cents
    FROM public.payout_release_items i
    JOIN public.brand_payout_releases r ON r.id = i.release_id
    JOIN public.payout_partner_attributions a
      ON a.order_id = i.source_id
     AND a.brand_id = r.brand_id
     AND a.provider = r.provider
     AND a.outcome = 'partner'
    WHERE i.release_id = p_release_id
      AND i.source_type = 'order'
      AND i.refunded_cents = 0
  )
  INSERT INTO public.payout_ledger_adjustments (
    release_id,
    brand_id,
    currency,
    kind,
    amount_cents,
    provider_ref,
    idempotency_key
  )
  SELECT
    a.release_id,
    a.brand_id,
    a.currency,
    'partner_principal_correction',
    a.expected_partner_share_cents - a.partner_share_cents,
    'order:' || a.source_id::text,
    'partner-principal:' || a.release_id::text || ':' || a.source_id::text
  FROM attributable a
  WHERE a.expected_partner_share_cents > a.partner_share_cents
  ON CONFLICT (idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_payout_partner_principal(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_payout_partner_principal(uuid)
  TO service_role;

COMMENT ON FUNCTION public.reconcile_payout_partner_principal(uuid) IS
  'Issue #1174: appends an idempotent correction when an immutable payout item predates its attributable held partner split.';

CREATE OR REPLACE FUNCTION public.record_held_partner_split(
  p_key text,
  p_order_id uuid,
  p_brand_id uuid,
  p_partner_account_id uuid,
  p_mingla_fee_cents integer,
  p_partner_share_cents integer,
  p_currency text,
  p_provider text,
  p_provider_sale_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.partner_splits%ROWTYPE;
  v_attribution public.payout_partner_attributions%ROWTYPE;
BEGIN
  IF p_key IS NULL OR length(p_key) = 0 THEN
    RAISE EXCEPTION 'partner_split_key_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_provider NOT IN ('stripe', 'paystack') THEN
    RAISE EXCEPTION 'invalid_partner_split_provider' USING ERRCODE = '22023';
  END IF;
  IF p_partner_share_cents <> round(p_mingla_fee_cents::numeric * 0.10)::integer
  THEN
    RAISE EXCEPTION 'partner_share_formula_mismatch' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_attribution
  FROM public.payout_partner_attributions
  WHERE order_id = p_order_id;
  IF NOT FOUND
     OR v_attribution.brand_id IS DISTINCT FROM p_brand_id
     OR v_attribution.provider IS DISTINCT FROM p_provider
     OR v_attribution.provider_key IS DISTINCT FROM p_key
     OR v_attribution.provider_sale_at IS DISTINCT FROM p_provider_sale_at
     OR v_attribution.partner_account_id IS DISTINCT FROM p_partner_account_id
     OR v_attribution.outcome IS DISTINCT FROM 'partner'
     OR v_attribution.mingla_fee_cents IS DISTINCT FROM p_mingla_fee_cents
     OR v_attribution.partner_share_cents IS DISTINCT FROM p_partner_share_cents
     OR v_attribution.currency IS DISTINCT FROM lower(p_currency) THEN
    RAISE EXCEPTION 'held_split_attribution_mismatch'
      USING ERRCODE = 'P0001';
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

  SELECT * INTO STRICT v_row
  FROM public.partner_splits
  WHERE stripe_application_fee_id = p_key;

  IF v_row.order_id IS DISTINCT FROM p_order_id
     OR v_row.brand_id IS DISTINCT FROM p_brand_id
     OR v_row.partner_account_id IS DISTINCT FROM p_partner_account_id
     OR v_row.mingla_fee_cents IS DISTINCT FROM p_mingla_fee_cents
     OR v_row.partner_share_cents IS DISTINCT FROM p_partner_share_cents
     OR v_row.transfer_currency IS DISTINCT FROM lower(p_currency)
     OR v_row.stripe_application_fee_id IS DISTINCT FROM p_key
     OR v_row.provider IS DISTINCT FROM p_provider THEN
    RAISE EXCEPTION 'held_split_replay_mismatch'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.reconcile_payout_partner_principal(i.release_id)
  FROM public.payout_release_items i
  WHERE i.source_type = 'order'
    AND i.source_id = p_order_id;

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
  text, uuid, uuid, uuid, integer, integer, text, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.record_held_partner_split(
  text, uuid, uuid, uuid, integer, integer, text, text, timestamptz
) IS
  'Issue #1174: idempotently records a post-cutover partner share as held. It performs no provider movement.';

CREATE OR REPLACE FUNCTION public.record_payout_partner_outcome(
  p_key text,
  p_order_id uuid,
  p_brand_id uuid,
  p_partner_account_id uuid,
  p_provider_sale_at timestamptz,
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
  v_attribution jsonb;
  v_held jsonb := NULL;
BEGIN
  -- This function is the sole service-role write boundary. PostgreSQL keeps
  -- both lower writes in this statement's transaction, so a planner observes
  -- neither row until both the attribution and held obligation are valid.
  v_attribution := public.record_payout_partner_attribution(
    p_key,
    p_order_id,
    p_brand_id,
    p_partner_account_id,
    p_provider_sale_at,
    p_mingla_fee_cents,
    p_partner_share_cents,
    p_currency,
    p_provider
  );

  IF p_partner_account_id IS NOT NULL THEN
    v_held := public.record_held_partner_split(
      p_key,
      p_order_id,
      p_brand_id,
      p_partner_account_id,
      p_mingla_fee_cents,
      p_partner_share_cents,
      p_currency,
      p_provider,
      p_provider_sale_at
    );
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_attribution->>'order_id',
    'outcome', v_attribution->>'outcome',
    'provider_sale_at', v_attribution->>'provider_sale_at',
    'partner_account_id', v_attribution->>'partner_account_id',
    'partner_share_cents',
      (v_attribution->>'partner_share_cents')::integer,
    'held_split_id', v_held->>'id',
    'held_status', v_held->>'status'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_payout_partner_outcome(
  text, uuid, uuid, uuid, timestamptz, integer, integer, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payout_partner_outcome(
  text, uuid, uuid, uuid, timestamptz, integer, integer, text, text
) TO service_role;

COMMENT ON FUNCTION public.record_payout_partner_outcome(
  text, uuid, uuid, uuid, timestamptz, integer, integer, text, text
) IS
  'Issue #1174: atomically records the immutable provider-sale attribution and its exact held split, or an explicit no-partner outcome.';

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
  v_principal_corrections integer := 0;
  v_new_corrections integer;
  v_gross integer;
  v_refunded integer;
  v_disputed integer;
  v_mingla_fee integer;
  v_item_partner_share integer;
  v_provider_fee integer;
  v_missing_attributions integer;
  v_blocked_attributions integer := 0;
BEGIN
  FOR v_release IN
    SELECT r.id
    FROM public.brand_payout_releases r
    WHERE r.status = 'pending'
    ORDER BY r.releasable_at, r.id
    LIMIT greatest(1, least(p_limit, 500))
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT count(*)::integer
      INTO v_missing_attributions
    FROM public.payout_release_items i
    LEFT JOIN public.payout_partner_attributions a
      ON a.order_id = i.source_id
    WHERE i.release_id = v_release.id
      AND i.source_type = 'order'
      AND i.mingla_fee_cents > 0
      AND a.order_id IS NULL;
    IF v_missing_attributions > 0 THEN
      v_blocked_attributions :=
        v_blocked_attributions + v_missing_attributions;
      CONTINUE;
    END IF;

    v_new_corrections :=
      public.reconcile_payout_partner_principal(v_release.id);
    v_principal_corrections :=
      v_principal_corrections + v_new_corrections;

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

    SELECT
      coalesce(sum(gross_cents), 0)::integer,
      coalesce(sum(refunded_cents), 0)::integer,
      coalesce(sum(disputed_cents), 0)::integer,
      coalesce(sum(mingla_fee_cents), 0)::integer,
      coalesce(sum(partner_share_cents), 0)::integer,
      coalesce(sum(provider_fee_cents), 0)::integer
    INTO
      v_gross,
      v_refunded,
      v_disputed,
      v_mingla_fee,
      v_item_partner_share,
      v_provider_fee
    FROM public.payout_release_items
    WHERE release_id = v_release.id;

    SELECT coalesce(sum(amount_cents), 0)::integer
      INTO v_new_corrections
    FROM public.payout_ledger_adjustments
    WHERE release_id = v_release.id
      AND kind = 'partner_principal_correction';

    -- Rebuild from immutable items plus append-only corrections so retries
    -- cannot double-deduct either principal or transfer costs.
    UPDATE public.brand_payout_releases
    SET gross_cents = v_gross,
        refunded_cents = v_refunded,
        disputed_cents = v_disputed,
        mingla_fee_cents = v_mingla_fee,
        partner_share_cents = v_item_partner_share + v_new_corrections,
        provider_fee_cents = v_provider_fee,
        net_release_cents = greatest(
          0,
          v_gross - v_refunded - v_disputed - v_mingla_fee
          - v_item_partner_share - v_new_corrections - v_provider_fee
          - permanent_debt_withheld_cents - temporary_debt_withheld_cents
          + maturity_recredit_cents - v_partner_cost
        ),
        updated_at = now()
    WHERE id = v_release.id;
  END LOOP;

  RETURN jsonb_build_object(
    'planned_partner_legs', v_planned,
    'partner_principal_corrections', v_principal_corrections,
    'blocked_partner_attributions', v_blocked_attributions
  );
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
