-- Issue #1392: make the seven-stage Stay rollout controls effective at the
-- authoritative reservation boundary and keep cancellation/refund obligations
-- drainable after new Stay writes are disabled.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_1389_flag_enabled(p_flag text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_flag = 'STAY_RESERVE_WRITES'
      AND current_setting('mingla.stay_obligation_drain', true)
        = 'cancel_existing_obligation'
      THEN true
    ELSE COALESCE((
      SELECT flag.is_enabled
      FROM public.feature_flags flag
      WHERE flag.flag_key = p_flag
    ), false)
  END;
$function$;

COMMENT ON FUNCTION public.issue_1389_flag_enabled(text) IS
  'Stay release-flag authority. Fail-closed for missing flags. The transaction-local cancel_existing_obligation context is set only by the permissioned #1392 cancellation drain wrappers so disabling new reservation writes never strands an accepted cancellation/refund obligation.';

CREATE OR REPLACE FUNCTION public.biz_manage_stay_reservation(
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_expected_version bigint DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_action text := lower(pg_catalog.btrim(COALESCE(p_action, '')));
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF p_request_id IS NOT NULL THEN
    PERFORM set_config('mingla.request_id', p_request_id::text, true);
  END IF;

  IF v_action = 'quote' THEN
    IF NOT public.issue_1389_flag_enabled('STAY_RESERVE_READS') THEN
      RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
    END IF;
    RETURN public.issue_1388_quote_stay_cart(
      (p_payload->>'venueId')::uuid,
      p_payload->'lines',
      p_payload->>'idempotencyKey',
      p_request_id
    );
  ELSIF v_action = 'create_group' THEN
    IF NOT public.issue_1389_flag_enabled('STAY_RESERVE_WRITES') THEN
      RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
    END IF;
    v_result := public.issue_1388_create_stay_group(
      (p_payload->>'quoteId')::uuid,
      p_payload->>'idempotencyKey',
      p_payload->'guest',
      p_expected_version,
      p_request_id
    );
    IF NULLIF(
      pg_catalog.btrim(p_payload->>'attributionClickId'), ''
    ) IS NOT NULL THEN
      PERFORM public.issue_1431_attach_stay_attribution(
        (v_result->>'groupId')::uuid,
        p_payload->>'attributionClickId'
      );
    END IF;
    RETURN v_result;
  ELSIF v_action IN ('approve_request', 'decline_request') THEN
    RETURN public.issue_1388_manage_request(
      v_action,
      (p_payload->>'groupId')::uuid,
      p_expected_version,
      p_payload->>'idempotencyKey',
      p_request_id
    );
  ELSIF v_action = 'get_group' THEN
    RETURN public.issue_1388_group_projection(
      (p_payload->>'groupId')::uuid
    );
  END IF;
  RAISE EXCEPTION 'stay_invalid_action' USING ERRCODE = '22023';
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
END;
$function$;

COMMENT ON FUNCTION public.biz_manage_stay_reservation(
  text, jsonb, bigint, uuid
) IS
  'Authenticated Stay reservation boundary. #1392 gates quote creation/replay on STAY_RESERVE_READS and new group creation on STAY_RESERVE_WRITES before invoking the existing atomic #1388 contracts, while preserving #1431 attribution attachment.';

ALTER FUNCTION public.issue_1426_cancel_preview(
  uuid, uuid[], bigint, uuid
) RENAME TO issue_1392_cancel_preview_base;
ALTER FUNCTION public.issue_1426_cancel(
  uuid, text, text, text, uuid
) RENAME TO issue_1392_cancel_base;

CREATE OR REPLACE FUNCTION public.issue_1426_cancel_preview(
  p_group_id uuid,
  p_selected_line_ids uuid[],
  p_expected_group_version bigint,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config(
    'mingla.stay_obligation_drain',
    'cancel_existing_obligation',
    true
  );
  RETURN public.issue_1392_cancel_preview_base(
    p_group_id,
    p_selected_line_ids,
    p_expected_group_version,
    p_request_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1426_cancel(
  p_preview_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_reason text,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config(
    'mingla.stay_obligation_drain',
    'cancel_existing_obligation',
    true
  );
  RETURN public.issue_1392_cancel_base(
    p_preview_id,
    p_preview_hash,
    p_idempotency_key,
    p_reason,
    p_request_id
  );
END;
$function$;

COMMENT ON FUNCTION public.issue_1426_cancel_preview(
  uuid, uuid[], bigint, uuid
) IS
  'Permission-preserving Stay cancellation preview wrapper. It opens only the existing-obligation cancellation path while new quote/group/payment writes remain controlled by their rollout flags.';
COMMENT ON FUNCTION public.issue_1426_cancel(
  uuid, text, text, text, uuid
) IS
  'Permission-preserving Stay cancellation/refund wrapper. It keeps accepted obligations drainable after the new-write kill switch is disabled.';

REVOKE ALL ON FUNCTION public.issue_1392_cancel_preview_base(
  uuid, uuid[], bigint, uuid
) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1392_cancel_base(
  uuid, text, text, text, uuid
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1392_cancel_preview_base(
  uuid, uuid[], bigint, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_1392_cancel_base(
  uuid, text, text, text, uuid
) TO service_role;
REVOKE ALL ON FUNCTION public.issue_1426_cancel_preview(
  uuid, uuid[], bigint, uuid
) FROM public, anon;
REVOKE ALL ON FUNCTION public.issue_1426_cancel(
  uuid, text, text, text, uuid
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.issue_1426_cancel_preview(
  uuid, uuid[], bigint, uuid
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_1426_cancel(
  uuid, text, text, text, uuid
) TO authenticated, service_role;

UPDATE public.feature_flags
SET description = 'New Stay reservation groups, payment preparation, and cancellation-safe rollout control'
WHERE flag_key = 'STAY_RESERVE_WRITES';

COMMIT;

NOTIFY pgrst, 'reload schema';
