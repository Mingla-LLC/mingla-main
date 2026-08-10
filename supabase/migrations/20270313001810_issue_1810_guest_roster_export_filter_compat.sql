-- Issue #1810: make the #1770 audited export owner accept the exact
-- server-owned #873 guest-roster filter vocabulary. The roster row provider
-- remains a service-only extension hook and is intentionally implemented by
-- #873; this migration does not create a second export path.

CREATE OR REPLACE FUNCTION public.biz_export_brand_people(
  p_scope text,p_event_id uuid DEFAULT NULL,p_filter text DEFAULT 'all',p_search text DEFAULT NULL,
  p_sort text DEFAULT 'action_priority',p_filter_snapshot jsonb DEFAULT '{}'::jsonb,
  p_client_request_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $function$
DECLARE v_brand uuid; v_actor uuid:=auth.uid(); v_job public.brand_people_export_jobs%ROWTYPE; v_snapshot jsonb; v_hash text; v_search text;
BEGIN
  v_search:=lower(regexp_replace(btrim(COALESCE(p_search,'')),'\\s+',' ','g'));
  IF p_scope IS NULL OR p_filter IS NULL OR p_sort IS NULL
     OR p_scope NOT IN ('brand_book','offering_guest_roster')
     OR (p_scope='brand_book' AND (p_event_id IS NOT NULL OR p_filter NOT IN ('all','reachable','suppressed')))
     OR (p_scope='offering_guest_roster' AND (
       p_event_id IS NULL OR p_filter NOT IN (
         'all','rsvpd','ticketed','not_yet','suppressed',
         'needs_attention','no_response','confirmed','checked_in','not_checked_in',
         'delivery_failed','removed','going','maybe','awaiting_approval','waitlisted',
         'declined','denied','bought_ticket','refunded','cancelled','transferred'
       )
     ))
     OR p_sort NOT IN ('action_priority','name_asc','name_desc','recent_first')
     OR length(v_search)>200
     OR v_search~E'[\\x00-\\x1F\\x7F]'
     OR p_filter_snapshot IS NULL OR jsonb_typeof(p_filter_snapshot)<>'object' OR p_filter_snapshot<>'{}'::jsonb THEN
    RAISE EXCEPTION 'export_filter_invalid' USING ERRCODE='22023';
  END IF;
  IF p_scope='offering_guest_roster' THEN SELECT brand_id INTO v_brand FROM public.events WHERE id=p_event_id AND deleted_at IS NULL;
  ELSE SELECT b.id INTO v_brand FROM public.brands b WHERE b.account_id=v_actor AND b.deleted_at IS NULL ORDER BY b.created_at,b.id LIMIT 1; END IF;
  IF v_actor IS NULL OR v_brand IS NULL OR public.biz_brand_effective_rank(v_brand,v_actor)<public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'brand_people_export_forbidden' USING ERRCODE='42501';
  END IF;
  -- Persist only server-normalized query state. Caller-defined keys, row IDs,
  -- contacts, and query fragments never cross the request boundary.
  v_snapshot:=jsonb_build_object('filter',p_filter,'search',v_search,'sort',p_sort);
  v_hash:=encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO v_job FROM public.brand_people_export_jobs WHERE brand_id=v_brand AND client_request_id=p_client_request_id;
  IF FOUND THEN
    IF v_job.filter_hash<>v_hash OR v_job.export_kind<>p_scope OR v_job.scope_id IS DISTINCT FROM p_event_id THEN RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE='23505'; END IF;
  ELSE
    INSERT INTO public.brand_people_export_jobs(brand_id,export_kind,scope_id,filter_json,filter_hash,client_request_id,requested_by)
      VALUES(v_brand,p_scope,p_event_id,v_snapshot,v_hash,p_client_request_id,v_actor) RETURNING * INTO v_job;
  END IF;
  RETURN jsonb_build_object('jobId',v_job.id,'status',v_job.status,'exportableCount',v_job.row_count,
    'omittedPersonCount',v_job.omitted_person_count,'omittedFieldCount',v_job.omitted_field_count,
    'result',CASE WHEN v_job.status='ready' THEN jsonb_build_object('fileName',regexp_replace(v_job.storage_path,'^.*/',''),'expiresAt',v_job.expires_at) ELSE NULL END);
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid) TO authenticated,service_role;

-- Reassert the extension boundary. #873 may replace this function body only;
-- clients must never execute it directly.
REVOKE ALL ON FUNCTION public.biz_offering_guest_roster_export_rows(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_offering_guest_roster_export_rows(uuid) TO service_role;
