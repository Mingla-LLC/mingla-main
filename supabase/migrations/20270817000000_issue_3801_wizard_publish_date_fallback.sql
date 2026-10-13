-- issue #3801 — "No trip can be published"
--
-- The wizard draft-save path historically wrote trip dates only into
-- events.theme.business_trip (JSONB) via the `event` draft-graph group, while
-- biz_publish_trip_command read the canonical public.event_dates table. A
-- draft dated through the wizard alone therefore had no event_dates master row
-- and publish raised trip_dates_required.
--
-- This migration makes the publish command fall back to the legacy JSONB home
-- when no master event_dates row exists (migrating the dates into the canonical
-- table in the same command), so pre-fix wizard drafts can still publish.

CREATE OR REPLACE FUNCTION public.biz_publish_trip_command(
  p_event_id uuid,p_expected_updated_at timestamptz,p_operation_id uuid,
  p_invite_selection_revision bigint,p_invite_selection_confirmed boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE
  v_event public.events%ROWTYPE; v_begin jsonb; v_result jsonb; v_start timestamptz;
  v_end timestamptz; v_payload jsonb; v_command_payload jsonb; v_fallback boolean;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'trip_not_found'; END IF;
  IF v_event.event_type<>'trip' THEN RAISE EXCEPTION 'event_not_a_trip'; END IF;
  PERFORM public.biz_trip_require_manager(v_event.brand_id);
  v_command_payload:=jsonb_build_object('expected_updated_at',p_expected_updated_at);
  IF p_invite_selection_revision IS NOT NULL OR COALESCE(p_invite_selection_confirmed,false) THEN
    v_command_payload:=v_command_payload||jsonb_build_object(
      'invite_selection_revision',p_invite_selection_revision,
      'invite_selection_confirmed',COALESCE(p_invite_selection_confirmed,false));
  END IF;
  v_begin:=public.biz_trip_command_begin(
    p_operation_id,'publish_trip',v_event.brand_id,p_event_id,v_command_payload);
  IF (v_begin->>'replay')::boolean THEN RETURN v_begin->'result'; END IF;
  IF p_expected_updated_at IS NULL OR v_event.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'trip_revision_conflict' USING ERRCODE='40001';
  END IF;
  SELECT start_at,end_at INTO v_start,v_end FROM public.event_dates
    WHERE event_id=p_event_id AND is_master=true ORDER BY start_at LIMIT 1;
  -- [#3801] Legacy wizard drafts keep their dates in theme.business_trip JSONB.
  -- When no canonical master row exists, read from there and migrate the dates
  -- into event_dates so every later reader sees them without a fallback.
  v_fallback := v_start IS NULL;
  IF v_fallback THEN
    v_start := NULLIF(v_event.theme#>'{business_trip,startAt}', '')::timestamptz;
    v_end := NULLIF(v_event.theme#>'{business_trip,endAt}', '')::timestamptz;
    IF v_start IS NOT NULL AND v_end IS NOT NULL THEN
      INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
      VALUES (p_event_id, v_start, v_end, v_event.timezone, true);
    END IF;
  END IF;
  v_payload:=jsonb_build_object(
    'title',v_event.title,'description',v_event.description,'timezone',v_event.timezone,
    'cover_media_url',v_event.cover_media_url,'cover_media_poster_url',v_event.cover_media_poster_url,
    'cover_media_type',v_event.cover_media_type,'cover_media_provider',v_event.cover_media_provider,
    'cover_media_source_url',v_event.cover_media_source_url,'cover_media_credit',v_event.cover_media_credit,
    'cover_media_credit_url',v_event.cover_media_credit_url,'cover_media_alt',v_event.cover_media_alt,
    'cover_media_gallery',v_event.cover_media_gallery,
    'theme',jsonb_set(COALESCE(v_event.theme,'{}'::jsonb),'{business_trip}',
      COALESCE(v_event.theme->'business_trip','{}'::jsonb)||jsonb_build_object(
        'destinationLocationText',v_event.destination_text,'departureLocationText',v_event.departure_text,
        'startAt',v_start,'endAt',v_end),true));
  v_result:=public.issue_1719_publish_trip_with_poster(p_event_id,v_payload,NULL);
  IF COALESCE((v_result->>'ok')::boolean,true) THEN
    v_result:=v_result||jsonb_build_object(
      'graph',public.biz_get_trip_draft_graph(p_event_id),
      'revision',(SELECT updated_at FROM public.events WHERE id=p_event_id))
      ||private.enqueue_wizard_invites_on_publish_v1(
        p_event_id,p_invite_selection_revision,p_invite_selection_confirmed);
  END IF;
  RETURN public.biz_trip_command_finish(p_operation_id,v_result);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.biz_publish_trip_command(
  p_event_id uuid,p_expected_updated_at timestamptz,p_operation_id uuid
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
  SELECT public.biz_publish_trip_command(
    p_event_id,p_expected_updated_at,p_operation_id,NULL::bigint,false)
$fn$;

REVOKE ALL ON FUNCTION public.biz_publish_trip_command(uuid,timestamptz,uuid),
  public.biz_publish_trip_command(uuid,timestamptz,uuid,bigint,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_publish_trip_command(uuid,timestamptz,uuid),
  public.biz_publish_trip_command(uuid,timestamptz,uuid,bigint,boolean) TO authenticated,service_role;