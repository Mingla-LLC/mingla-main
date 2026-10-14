-- Issue #3859 slice 1: one provider-neutral capability authority for trip
-- installments. Unsupported/unknown capability keeps stored schedules intact
-- while refusing new authoring, public exposure, and checkout creation.

BEGIN;

-- The provider mapping is intentionally private. Product-facing callers see
-- only supported/unavailable and a bounded provider-neutral refusal code.
CREATE OR REPLACE FUNCTION public.pg_trip_installments_supported(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE((
    SELECT b.payment_provider::text = 'stripe'
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
  'Issue #3859: provider-neutral trip-installment capability. Unknown/missing is false; service-side authority only.';

-- Authoring belt: a stale client may retain an existing schedule byte-for-byte,
-- but cannot add, remove, or edit one while capability is unavailable. This
-- preserves historical metadata rather than deleting or converting it.
CREATE OR REPLACE FUNCTION public.trg_trip_tier_installment_capability_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_new_schedule jsonb := NEW.tier_metadata -> 'installments';
  v_old_schedule jsonb := CASE
    WHEN TG_OP = 'UPDATE' THEN OLD.tier_metadata -> 'installments'
    ELSE NULL
  END;
  v_new_has_schedule boolean :=
    NEW.tier_metadata ? 'installments'
    AND NEW.tier_metadata -> 'installments' IS NOT NULL
    AND jsonb_typeof(NEW.tier_metadata -> 'installments') <> 'null';
  v_old_has_schedule boolean :=
    TG_OP = 'UPDATE'
    AND OLD.tier_metadata ? 'installments'
    AND OLD.tier_metadata -> 'installments' IS NOT NULL
    AND jsonb_typeof(OLD.tier_metadata -> 'installments') <> 'null';
BEGIN
  IF public.pg_trip_installments_supported(NEW.event_id) THEN
    RETURN NEW;
  END IF;

  IF NOT v_new_has_schedule AND NOT v_old_has_schedule THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND v_old_has_schedule
     AND v_new_has_schedule
     AND v_old_schedule IS NOT DISTINCT FROM v_new_schedule THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'installment_capability_unavailable'
    USING ERRCODE = 'P0001',
          HINT = 'The saved payment setup does not support trip installments.';
END
$fn$;

DROP TRIGGER IF EXISTS trg_trip_tier_installment_capability_guard
  ON public.trip_pricing_tiers;
CREATE TRIGGER trg_trip_tier_installment_capability_guard
  BEFORE INSERT OR UPDATE OF tier_metadata ON public.trip_pricing_tiers
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_trip_tier_installment_capability_guard();

REVOKE ALL ON FUNCTION public.trg_trip_tier_installment_capability_guard()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_trip_tier_installment_capability_guard()
  TO service_role;

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
     AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.visibility IS DISTINCT FROM NEW.visibility)
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

DROP TRIGGER IF EXISTS trg_trip_publish_installment_capability_guard
  ON public.events;
CREATE TRIGGER trg_trip_publish_installment_capability_guard
  BEFORE UPDATE OF status, visibility ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_trip_publish_installment_capability_guard();

REVOKE ALL ON FUNCTION public.trg_trip_publish_installment_capability_guard()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_trip_publish_installment_capability_guard()
  TO service_role;

-- Direct-RPC belt: if a caller bypasses the Edge preflight, the checkout RPC's
-- insert is refused transactionally before a session/capacity hold survives.
CREATE OR REPLACE FUNCTION public.trg_ticket_session_installment_capability_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.installment_schedule IS NOT NULL
     AND NOT public.pg_trip_installments_supported(NEW.event_id) THEN
    RAISE EXCEPTION 'installment_capability_unavailable'
      USING ERRCODE = 'P0001',
            HINT = 'The saved payment setup does not support trip installments.';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_ticket_session_installment_capability_guard
  ON public.ticket_checkout_sessions;
CREATE TRIGGER trg_ticket_session_installment_capability_guard
  BEFORE INSERT OR UPDATE OF installment_schedule
  ON public.ticket_checkout_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_ticket_session_installment_capability_guard();

REVOKE ALL ON FUNCTION public.trg_ticket_session_installment_capability_guard()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_ticket_session_installment_capability_guard()
  TO service_role;

-- Keep the one canonical public reader and its response shape. Patch only the
-- two schedule-bearing values in its latest installed definition: unsupported
-- schedules become null/absent to every web and native adapter, while the
-- underlying tier metadata remains unchanged for authorized Host/support reads.
DO $patch_public_trip_reader$
DECLARE
  v_oid oid := 'public.pg_public_trip_by_slug(text,text)'::regprocedure;
  v_def text := pg_get_functiondef(v_oid);
  v_metadata_old text := $$'tierMetadata', COALESCE(tiers.tier_metadata, '{}'::jsonb),$$;
  v_metadata_new text := $$'tierMetadata', CASE
            WHEN public.pg_trip_installments_supported(tr.id)
              THEN COALESCE(tiers.tier_metadata, '{}'::jsonb)
            ELSE COALESCE(tiers.tier_metadata, '{}'::jsonb) - 'installments'
          END,$$;
  v_schedule_old text := $$'installments', tiers.tier_metadata -> 'installments'$$;
  v_schedule_new text := $$'installments', CASE
            WHEN public.pg_trip_installments_supported(tr.id)
              THEN tiers.tier_metadata -> 'installments'
            ELSE NULL
          END$$;
BEGIN
  IF (length(v_def) - length(replace(v_def, v_metadata_old, ''))) <> length(v_metadata_old)
     OR (length(v_def) - length(replace(v_def, v_schedule_old, ''))) <> length(v_schedule_old) THEN
    RAISE EXCEPTION 'issue_3859_public_trip_reader_anchor_drift';
  END IF;
  v_def := replace(v_def, v_metadata_old, v_metadata_new);
  v_def := replace(v_def, v_schedule_old, v_schedule_new);
  EXECUTE v_def;
END
$patch_public_trip_reader$;

-- Aggregate-only operational census. No ids, buyer/Host data, references,
-- tokens, or provider names leave this function.
CREATE OR REPLACE FUNCTION public.issue_3859_trip_installment_census()
RETURNS TABLE(
  capability_state text,
  offering_state text,
  trip_count bigint,
  schedule_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT
    CASE
      WHEN public.pg_trip_installments_supported(e.id) THEN 'supported'
      ELSE 'unavailable'
    END AS capability_state,
    e.status::text AS offering_state,
    count(DISTINCT e.id)::bigint AS trip_count,
    count(*)::bigint AS schedule_count
  FROM public.events e
  JOIN public.trip_pricing_tiers tpt ON tpt.event_id = e.id
  WHERE e.event_type = 'trip'
    AND e.deleted_at IS NULL
    AND tpt.tier_metadata ? 'installments'
    AND tpt.tier_metadata -> 'installments' IS NOT NULL
    AND jsonb_typeof(tpt.tier_metadata -> 'installments') <> 'null'
  GROUP BY 1, e.status::text
  ORDER BY 1, 2
$fn$;

REVOKE ALL ON FUNCTION public.issue_3859_trip_installment_census()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3859_trip_installment_census()
  TO service_role;

COMMENT ON FUNCTION public.issue_3859_trip_installment_census() IS
  'Issue #3859 aggregate-only census of stored trip schedules by effective capability and offering state; no identifiers or personal data.';

DO $verify$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_proc p
   WHERE p.oid = 'public.pg_public_trip_by_slug(text,text)'::regprocedure;
  IF position('pg_trip_installments_supported(tr.id)' IN v_src) = 0
     OR position('- ''installments''' IN v_src) = 0 THEN
    RAISE EXCEPTION 'issue_3859_public_trip_reader_not_guarded';
  END IF;
  IF has_function_privilege('anon', 'public.pg_trip_installments_supported(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3859_trip_installment_census()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3859_capability_or_census_overexposed';
  END IF;
END
$verify$;

COMMIT;
