-- Issue #3645 — trip payment plan capability on both rails (M3 of 4), and
-- #4040: the publish belt refuses only transitions that increase buyer exposure.
--
-- Re-emitted from 20271015003859_issue_3859_installment_capability_refusal.sql:
--   pg_trip_installments_supported — one hunk: Paystack follows the readiness
--     switch issue_3645_paystack_installments_enabled() (ships false).
--   trg_trip_publish_installment_capability_guard — one hunk: the transition
--     predicate. Leaving public/discover (to hidden/draft/private) is always
--     allowed; entering a more exposed state stays refused while unsupported.
-- The three #3859 belts and the public reader inherit the capability unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.pg_trip_installments_supported(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE((
    SELECT CASE b.payment_provider::text
             WHEN 'stripe' THEN true
             WHEN 'paystack' THEN public.issue_3645_paystack_installments_enabled()
             ELSE false END
      FROM public.events e
      JOIN public.brands b ON b.id = e.brand_id
     WHERE e.id = p_event_id
       AND e.event_type = 'trip'
       AND e.deleted_at IS NULL
       AND b.deleted_at IS NULL
     LIMIT 1
  ), false)
$fn$;

REVOKE ALL ON FUNCTION public.pg_trip_installments_supported(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_trip_installments_supported(uuid)
  TO service_role;

COMMENT ON FUNCTION public.pg_trip_installments_supported(uuid) IS
  'Issue #3859 / #3645: provider-neutral trip-installment capability. Stripe true; Paystack follows issue_3645_paystack_installments_enabled(); unknown/missing is false; service-side authority only.';

-- Publish belt: an unsupported saved schedule is a suspended draft artifact,
-- never an effective published buyer option.
CREATE OR REPLACE FUNCTION public.trg_trip_publish_installment_capability_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.event_type = 'trip'
     AND NEW.status IN ('scheduled', 'live')
     -- #4040: refuse only a transition that increases buyer exposure
     -- (draft/hidden 0 < private 1 < public/discover 2).
     AND (
       (OLD.status NOT IN ('scheduled', 'live')
        AND (CASE WHEN NEW.visibility IN ('public', 'discover') THEN 2
                  WHEN NEW.visibility = 'private' THEN 1 ELSE 0 END) > 0)
       OR (CASE WHEN NEW.visibility IN ('public', 'discover') THEN 2
                WHEN NEW.visibility = 'private' THEN 1 ELSE 0 END)
          > (CASE WHEN OLD.visibility IN ('public', 'discover') THEN 2
                  WHEN OLD.visibility = 'private' THEN 1 ELSE 0 END)
     )
     AND EXISTS (
       SELECT 1
         FROM public.trip_pricing_tiers tpt
        WHERE tpt.event_id = NEW.id
          AND tpt.tier_metadata ? 'installments'
          AND tpt.tier_metadata -> 'installments' IS NOT NULL
          AND jsonb_typeof(tpt.tier_metadata -> 'installments') <> 'null'
     )
     AND NOT public.pg_trip_installments_supported(NEW.id) THEN
    RAISE EXCEPTION 'installment_capability_unavailable'
      USING ERRCODE = 'P0001',
            HINT = 'The saved payment setup does not support trip installments.';
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.trg_trip_publish_installment_capability_guard()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_trip_publish_installment_capability_guard()
  TO service_role;

-- Host authoring reads the same answer the database enforces, so the editor
-- never offers a plan the belts will refuse. Members only; false otherwise.
CREATE OR REPLACE FUNCTION public.biz_trip_installments_supported_for_brand(p_brand_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_provider text;
BEGIN
  IF p_brand_id IS NULL OR NOT public.biz_is_brand_member_for_read_for_caller(p_brand_id) THEN
    RETURN false;
  END IF;
  SELECT b.payment_provider::text INTO v_provider
    FROM public.brands b
   WHERE b.id = p_brand_id AND b.deleted_at IS NULL;
  RETURN CASE v_provider
    WHEN 'stripe' THEN true
    WHEN 'paystack' THEN public.issue_3645_paystack_installments_enabled()
    ELSE false END;
END
$fn$;

REVOKE ALL ON FUNCTION public.biz_trip_installments_supported_for_brand(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_trip_installments_supported_for_brand(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.biz_trip_installments_supported_for_brand(uuid) IS
  'Issue #3645: whether this brand can offer trip payment plans (same rule as pg_trip_installments_supported). False for non-members.';

COMMIT;
