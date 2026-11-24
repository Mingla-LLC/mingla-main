-- issue #4522 slice 12 — validate v2 trip plans against the final package
-- price on live edits and on publish. The draft graph already owns this check.
--
-- The live command writes tier metadata and ticket price in separate statements,
-- so two INITIALLY DEFERRED constraint triggers validate the transaction's final
-- state atomically. The publish trigger validates before increasing exposure.
-- The v2 rollout switch remains false; no plan can become active from this file.

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $drift$
DECLARE v_actual text;
BEGIN
  SELECT md5(pg_get_functiondef(
    'public.trg_trip_publish_installment_capability_guard()'::regprocedure
  )) INTO v_actual;
  IF v_actual IS DISTINCT FROM 'd4c8152dc0c57cdef07fb276dc786581' THEN
    RAISE EXCEPTION
      'issue #4522 slice 12 publish guard drift: expected %, got %',
      'd4c8152dc0c57cdef07fb276dc786581', v_actual;
  END IF;
END;
$drift$;

CREATE FUNCTION public.issue_4522_validate_trip_plan_prices(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tier record;
BEGIN
  FOR v_tier IN
    SELECT t.tier_metadata, t.tier_name, tt.price_cents
      FROM public.trip_pricing_tiers t
      JOIN public.ticket_types tt
        ON tt.id = t.ticket_type_id
       AND tt.deleted_at IS NULL
     WHERE t.event_id = p_event_id
       AND t.tier_metadata ? 'payment_plan'
       AND jsonb_typeof(t.tier_metadata->'payment_plan') <> 'null'
     ORDER BY tt.display_order, tt.created_at, tt.id
  LOOP
    -- This preserves the server switch and shape-conflict checks. A live write
    -- cannot bypass payment_plan_v2_unavailable while the rollout is off.
    PERFORM public.biz_validate_trip_installment_schedule(v_tier.tier_metadata);
    BEGIN
      PERFORM public.biz_validate_trip_plan_against_price(
        v_tier.tier_metadata,
        v_tier.price_cents
      );
    EXCEPTION WHEN invalid_parameter_value THEN
      RAISE EXCEPTION '%', SQLERRM
        USING ERRCODE = '22023', HINT = v_tier.tier_name;
    END;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_4522_validate_trip_plan_prices(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_validate_trip_plan_prices(uuid)
  TO service_role;
COMMENT ON FUNCTION public.issue_4522_validate_trip_plan_prices(uuid) IS
  'Issue #4522: validates every v2 plan on a trip against its final package price; price errors name the package in HINT.';

CREATE FUNCTION public.issue_4522_live_plan_price_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'trip_pricing_tiers' THEN
    v_event_id := COALESCE(NEW.event_id, OLD.event_id);
  ELSE
    SELECT t.event_id INTO v_event_id
      FROM public.trip_pricing_tiers t
     WHERE t.ticket_type_id = COALESCE(NEW.id, OLD.id)
     LIMIT 1;
  END IF;

  IF v_event_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.events e
     WHERE e.id = v_event_id
       AND e.event_type = 'trip'
       AND e.status IN ('scheduled', 'live')
       AND e.deleted_at IS NULL
  ) THEN
    PERFORM public.issue_4522_validate_trip_plan_prices(v_event_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_4522_live_plan_price_guard()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_live_plan_price_guard()
  TO service_role;

CREATE CONSTRAINT TRIGGER issue_4522_live_tier_plan_price_guard
AFTER INSERT OR UPDATE ON public.trip_pricing_tiers
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.issue_4522_live_plan_price_guard();

CREATE CONSTRAINT TRIGGER issue_4522_live_price_plan_guard
AFTER UPDATE OF price_cents ON public.ticket_types
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.issue_4522_live_plan_price_guard();

CREATE OR REPLACE FUNCTION public.trg_trip_publish_installment_capability_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.event_type = 'trip'
     AND NEW.status IN ('scheduled', 'live')
     -- #4040: validate only a transition that increases buyer exposure
     -- (draft/hidden 0 < private 1 < public/discover 2).
     AND (
       (OLD.status NOT IN ('scheduled', 'live')
        AND (CASE WHEN NEW.visibility IN ('public', 'discover') THEN 2
                  WHEN NEW.visibility = 'private' THEN 1 ELSE 0 END) > 0)
       OR (CASE WHEN NEW.visibility IN ('public', 'discover') THEN 2
                WHEN NEW.visibility = 'private' THEN 1 ELSE 0 END)
          > (CASE WHEN OLD.visibility IN ('public', 'discover') THEN 2
                  WHEN OLD.visibility = 'private' THEN 1 ELSE 0 END)
     ) THEN
    -- issue #4522: publish cannot expose a plan that does not fit its package.
    PERFORM public.issue_4522_validate_trip_plan_prices(NEW.id);

    IF EXISTS (
      SELECT 1
        FROM public.trip_pricing_tiers tpt
       WHERE tpt.event_id = NEW.id
         AND (
           (tpt.tier_metadata ? 'installments'
            AND tpt.tier_metadata -> 'installments' IS NOT NULL
            AND jsonb_typeof(tpt.tier_metadata -> 'installments') <> 'null')
           OR (tpt.tier_metadata ? 'payment_plan'
               AND jsonb_typeof(tpt.tier_metadata -> 'payment_plan') <> 'null')
         )
    ) AND NOT public.pg_trip_installments_supported(NEW.id) THEN
      RAISE EXCEPTION 'installment_capability_unavailable'
        USING ERRCODE = 'P0001',
              HINT = 'The saved payment setup does not support trip installments.';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.trg_trip_publish_installment_capability_guard()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_trip_publish_installment_capability_guard()
  TO service_role;

COMMENT ON FUNCTION public.trg_trip_publish_installment_capability_guard() IS
  'Issue #4522/#4040: before increasing trip exposure, validate v1/v2 installment capability and every v2 plan against its package price.';

COMMIT;
