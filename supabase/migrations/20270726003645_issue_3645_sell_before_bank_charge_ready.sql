-- Issue #3645 PR6 — sell before bank: charge vs payout readiness.
--
-- Publish / discover / buyer bookable gates already call pg_brand_can_collect.
-- Today that admits Stripe charges_enabled OR a Paystack subaccount. Hold-rail
-- NG brands (payout_hold_cutover_at set) settle 100% to Mingla and already sell
-- at the edge when stamped, but SQL still blocks publish/discover without a
-- subaccount. Widen collect to admit the stamped hold rail; payout *execute*
-- stays behind bank / payouts_enabled / recipient (unchanged sweep).
--
-- Also: pg_brand_can_payout — bank/recipient readiness for surfaces that must
-- stay payout-gated (trip instalment plans).

BEGIN;

CREATE OR REPLACE FUNCTION public.pg_brand_can_collect(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    (
      public.pg_brand_can_charge(p_brand_id)
      OR EXISTS (
        SELECT 1
        FROM public.brands b
        WHERE b.id = p_brand_id
          AND (
            b.paystack_subaccount_code IS NOT NULL
            OR (
              b.payment_provider = 'paystack'
              AND b.payout_hold_cutover_at IS NOT NULL
            )
          )
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.brand_currency_reconciliations r
      WHERE r.brand_id = p_brand_id AND r.status = 'pending'
    );
$function$;

COMMENT ON FUNCTION public.pg_brand_can_collect(uuid) IS
  'Issue #3645 / #1919: provider-neutral charge readiness for publish/checkout/discover. Stripe charges_enabled, Paystack subaccount, or stamped Paystack hold-rail (no bank yet). Pending currency reconciliation fails closed. Payout execute remains separately bank-gated.';

GRANT EXECUTE ON FUNCTION public.pg_brand_can_collect(uuid)
  TO anon, authenticated, service_role;

-- Payout readiness (bank / Stripe payouts_enabled / Paystack subaccount OR
-- active brand_paystack_recipients row — matches claim_paystack_payout_releases).
-- Instalment plans and release execute stay behind this (or equivalent).
CREATE OR REPLACE FUNCTION public.pg_brand_can_payout(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    (
      EXISTS (
        SELECT 1
        FROM public.stripe_connect_accounts s
        WHERE s.brand_id = p_brand_id
          AND s.detached_at IS NULL
          AND s.stripe_account_id IS NOT NULL
          AND s.payouts_enabled IS TRUE
      )
      OR EXISTS (
        SELECT 1
        FROM public.brands b
        WHERE b.id = p_brand_id
          AND b.paystack_subaccount_code IS NOT NULL
      )
      OR EXISTS (
        SELECT 1
        FROM public.brand_paystack_recipients r
        WHERE r.brand_id = p_brand_id
          AND r.is_active IS TRUE
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.brand_currency_reconciliations r
      WHERE r.brand_id = p_brand_id AND r.status = 'pending'
    );
$function$;

COMMENT ON FUNCTION public.pg_brand_can_payout(uuid) IS
  'Issue #3645: organiser can receive payouts — Stripe payouts_enabled, Paystack subaccount, or active Paystack recipient, and no pending currency reconciliation. Used for instalment-plan bank gates; release sweep still fail-closes on execute.';

-- Default privileges grant EXECUTE to anon; REVOKE PUBLIC alone does not drop it.
REVOKE ALL ON FUNCTION public.pg_brand_can_payout(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pg_brand_can_payout(uuid)
  TO authenticated, service_role;

-- Self-check: hold-rail admission is present; charge helper unchanged contract.
DO $guard$
DECLARE
  v_collect text := pg_get_functiondef('public.pg_brand_can_collect(uuid)'::regprocedure);
  v_payout text := pg_get_functiondef('public.pg_brand_can_payout(uuid)'::regprocedure);
BEGIN
  IF position('payout_hold_cutover_at' IN v_collect) = 0 THEN
    RAISE EXCEPTION 'issue-3645: pg_brand_can_collect missing hold-rail admission';
  END IF;
  IF position('paystack_subaccount_code' IN v_collect) = 0 THEN
    RAISE EXCEPTION 'issue-3645: pg_brand_can_collect missing Paystack subaccount branch';
  END IF;
  IF position('payouts_enabled' IN v_payout) = 0 THEN
    RAISE EXCEPTION 'issue-3645: pg_brand_can_payout missing Stripe payouts_enabled';
  END IF;
  IF position('brand_paystack_recipients' IN v_payout) = 0 THEN
    RAISE EXCEPTION 'issue-3645: pg_brand_can_payout missing active recipient branch';
  END IF;
END
$guard$;

-- #3645 — trip instalment plans stay bank/payout-gated at the publish RPC
-- boundary (FOR UPDATE already held). Client UI is suspenders; this trigger is
-- the belt for any caller that bypasses the wizard.
CREATE OR REPLACE FUNCTION public.trg_trip_publish_installments_require_payout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.event_type = 'trip'
     AND NEW.status = 'scheduled'
     AND OLD.status = 'draft'
     AND EXISTS (
       SELECT 1
       FROM public.trip_pricing_tiers tpt
       WHERE tpt.event_id = NEW.id
         AND tpt.tier_metadata ? 'installments'
         AND tpt.tier_metadata->'installments' IS NOT NULL
         AND jsonb_typeof(tpt.tier_metadata->'installments') <> 'null'
     )
     AND NOT public.pg_brand_can_payout(NEW.brand_id) THEN
    RAISE EXCEPTION 'bank_required_for_installments'
      USING ERRCODE = 'P0001',
            HINT = 'Trip packages with an instalment plan require payout/bank readiness (pg_brand_can_payout).';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_trip_publish_installments_require_payout
  ON public.events;
CREATE TRIGGER trg_trip_publish_installments_require_payout
  BEFORE UPDATE OF status ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_trip_publish_installments_require_payout();

REVOKE ALL ON FUNCTION public.trg_trip_publish_installments_require_payout()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trg_trip_publish_installments_require_payout()
  TO authenticated, service_role;

-- #3645 — belt at metadata write: instalments on a live/scheduled trip must
-- also require payout readiness (biz_update_live_trip path bypasses draft→
-- scheduled). Keep the publish-transition trigger above.
CREATE OR REPLACE FUNCTION public.trg_trip_tier_installments_require_payout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_brand_id uuid;
  v_status text;
BEGIN
  IF NOT (
    NEW.tier_metadata ? 'installments'
    AND NEW.tier_metadata->'installments' IS NOT NULL
    AND jsonb_typeof(NEW.tier_metadata->'installments') <> 'null'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT e.brand_id, e.status::text
    INTO v_brand_id, v_status
  FROM public.events e
  WHERE e.id = NEW.event_id
    AND e.deleted_at IS NULL;

  IF v_brand_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_status IN ('scheduled', 'live')
     AND NOT public.pg_brand_can_payout(v_brand_id) THEN
    RAISE EXCEPTION 'bank_required_for_installments'
      USING ERRCODE = 'P0001',
            HINT = 'Trip packages with an instalment plan require payout/bank readiness (pg_brand_can_payout).';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_trip_tier_installments_require_payout
  ON public.trip_pricing_tiers;
CREATE TRIGGER trg_trip_tier_installments_require_payout
  BEFORE INSERT OR UPDATE OF tier_metadata ON public.trip_pricing_tiers
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_trip_tier_installments_require_payout();

REVOKE ALL ON FUNCTION public.trg_trip_tier_installments_require_payout()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trg_trip_tier_installments_require_payout()
  TO authenticated, service_role;

COMMIT;
